import os
from tzafon import Computer
from utils import ensure_dir, timestamp, download_to_file


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

    result = computer.screenshot()
    try:
        url = result.result["screenshot_url"]
    except Exception:
        url = None
    print(f"Screenshot: {url}")
    if url:
        img = os.path.join(out_dir, f"{timestamp('wiki_')}.png")
        download_to_file(url, img)
        print(f"Saved: {img}")


if __name__ == "__main__":
    run()
