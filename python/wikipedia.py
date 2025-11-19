import os
from tzafon import Computer
from utils import ensure_dir, timestamp, download_to_file
from urllib.error import HTTPError, URLError


def run() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "results", "wikipedia")
    ensure_dir(out_dir)

    client = Computer()  # Auto-reads TZAFON_API_KEY
    computer = client.create(kind="browser")
    computer.navigate("https://www.wikipedia.org/")  # Immediate execution
    try:
        computer.wait(2)
    except Exception:
        pass

    # Take screenshot with HTTP error code logging if SDK raises
    result = None
    try:
        result = computer.screenshot()
    except Exception as e:
        # Best-effort extraction of HTTP status code from the SDK exception
        code = None
        for attr in ("status_code", "http_status", "status", "code"):
            try:
                val = getattr(e, attr, None)
                if isinstance(val, int):
                    code = val
                    break
            except Exception:
                pass
        try:
            resp = getattr(e, "response", None)
            if resp is not None:
                code = getattr(resp, "status", getattr(resp, "status_code", code))
        except Exception:
            pass
        print(f"SDK error during screenshot: {e} (http_status={code})")

    # Attempt to extract URL and log SDK error details if missing
    try:
        url = result.result["screenshot_url"] if result is not None else None
    except Exception:
        url = None

    # Best-effort extraction of SDK-provided diagnostics
    status = None
    error_message = None
    request_id = None
    try:
        status = getattr(result, "status", None) if result is not None else None
    except Exception:
        pass
    try:
        error_message = getattr(result, "error_message", None) if result is not None else None
    except Exception:
        pass
    try:
        request_id = getattr(result, "request_id", None) if result is not None else None
    except Exception:
        pass

    print(f"Screenshot: {url}")
    if not url and result is not None:
        try:
            print(f"SDK status: {status}")
            print(f"SDK error_message: {error_message}")
            print(f"SDK request_id: {request_id}")
            payload = getattr(result, "result", None)
            if isinstance(payload, dict):
                print(f"SDK result payload keys: {list(payload.keys())}")
        except Exception:
            pass

    if url:
        img = os.path.join(out_dir, f"{timestamp('wiki_')}.png")
        try:
            download_to_file(url, img)
            print(f"Saved: {img}")
        except HTTPError as he:
            # Explicitly log HTTP error code from download failure
            print(f"Download failed: HTTP {he.code} - {he.reason}")
        except URLError as ue:
            print(f"Download failed: URL error - {ue.reason}")
        except Exception as e:
            print(f"Download failed: {e}")


if __name__ == "__main__":
    run()
