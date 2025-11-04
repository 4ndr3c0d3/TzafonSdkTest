import os
import random
import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Tuple, Dict

from tzafon import Computer
from utils import ensure_dir, timestamp, download_to_file


URLS = [
    ("wikipedia", "https://www.wikipedia.org/"),
    ("nytimes", "https://www.nytimes.com/"),
    ("airbnb", "https://www.airbnb.com/"),
    ("github", "https://github.com/"),
    ("reddit", "https://www.reddit.com/"),
]


def _select_site_arg(site: str | None) -> Tuple[str, str]:
    label_to_url: Dict[str, str] = {k: v for k, v in URLS}
    if site:
        # Allow label or full URL
        if site in label_to_url:
            return site, label_to_url[site]
        if site.startswith("http://") or site.startswith("https://"):
            # Derive a label from hostname
            try:
                from urllib.parse import urlparse

                host = urlparse(site).hostname or "site"
                label = host.split(".")[-2] if "." in host else host
            except Exception:
                label = "site"
            return label, site
    # Interactive prompt
    print("Choose a site to screenshot concurrently (10 shots):")
    for idx, (lbl, url) in enumerate(URLS, start=1):
        print(f"  {idx}. {lbl} -> {url}")
    choice = input("Enter number (1-{}): ".format(len(URLS))).strip()
    try:
        i = int(choice)
        assert 1 <= i <= len(URLS)
    except Exception:
        i = 1
    return URLS[i - 1]


def _cleanup(client: object, c: object) -> None:
    for obj in (c, client):
        for name in ("close", "quit", "shutdown", "destroy", "stop", "end", "exit", "delete", "dispose"):
            try:
                fn = getattr(obj, name, None)
                if callable(fn):
                    fn()
            except Exception:
                pass
    # Try client.delete(computer) or client.delete(id)
    try:
        delete = getattr(client, "delete", None)
        if callable(delete):
            try:
                delete(c)
            except Exception:
                comp_id = getattr(c, "id", None)
                if comp_id is not None:
                    try:
                        delete(comp_id)
                    except Exception:
                        pass
    except Exception:
        pass


def _create_browser_with_retry(client: object, retries: int = 6) -> object:
    delay = 2.0
    for attempt in range(retries):
        try:
            return client.create(kind="browser")
        except Exception as e:  # Handle 429 concurrent limit with backoff
            msg = str(e).lower()
            if "429" in msg or "concurrent" in msg or "limit" in msg:
                time.sleep(delay)
                delay = min(delay * 2, 30.0)
                continue
            raise
    # Final attempt (let exception bubble if any)
    return client.create(kind="browser")


def _is_capacity_error(e: Exception) -> bool:
    msg = str(e).lower()
    return ("429" in msg) or ("concurrent" in msg and "computer" in msg) or ("limit" in msg)


def _take_one(i: int, label: str, url: str, client: object | None = None) -> str:
    base = os.path.join(os.path.dirname(__file__), "results", f"concurrent_10_{label}")
    ensure_dir(base)
    client = client or Computer()
    c = _create_browser_with_retry(client)
    c.navigate(url)
    try:
        c.wait(2)
    except Exception:
        pass
    try:
        result = c.screenshot()
        try:
            shot_url = result.result["screenshot_url"]
        except Exception:
            shot_url = None
        if shot_url:
            img = os.path.join(base, f"{timestamp(f'{label}_{i}_')}.png")
            download_to_file(shot_url, img)
            return img
        return ""
    finally:
        _cleanup(client, c)


def run(n: int = 10, site: str | None = None, mode: str = "sequential") -> List[str]:
    label, url = _select_site_arg(site)
    imgs: List[str] = []
    if mode == "concurrent":
        with ThreadPoolExecutor(max_workers=n) as ex:
            shared_client = Computer()
            futures = [ex.submit(_take_one, i, label, url, shared_client) for i in range(n)]
            for f in as_completed(futures):
                try:
                    imgs.append(f.result())
                except Exception as e:
                    print(f"Worker failed: {e}")
    else:
        shared_client = Computer()
        for i in range(n):
            delay = 2.0
            attempts = 0
            while True:
                try:
                    imgs.append(_take_one(i, label, url, shared_client))
                    break
                except Exception as e:
                    if _is_capacity_error(e) and attempts < 12:
                        attempts += 1
                        print(f"Capacity limit; retrying iteration {i} after {delay:.1f}s (attempt {attempts}/12)")
                        import time as _t
                        _t.sleep(delay)
                        delay = min(delay * 1.7, 60.0)
                        continue
                    print(f"Iteration {i} failed: {e}")
                    break
    return imgs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Take 10 screenshots of a chosen site (sequential by default).")
    parser.add_argument("--site", help="Site label (wikipedia, nytimes, airbnb, github, reddit) or full URL", default=None)
    parser.add_argument("--n", type=int, help="Number of screenshots", default=10)
    parser.add_argument("--mode", choices=["sequential", "concurrent"], default="sequential", help="Execution mode")
    args = parser.parse_args()

    paths = run(args.n, args.site, args.mode)
    for p in paths:
        print(f"Saved: {p}")
