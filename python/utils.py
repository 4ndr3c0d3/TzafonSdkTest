import os
from datetime import datetime
from typing import Any
from urllib.request import urlopen


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def timestamp(prefix: str = "") -> str:
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    return f"{prefix}{ts}"


def _decode_image(result: Any) -> bytes:
    """Decode screenshot result into raw PNG bytes.

    Handles bytes-like, memoryview, base64 strings, or data URLs.
    """
    if result is None:
        return b""
    if isinstance(result, (bytes, bytearray, memoryview)):
        return bytes(result)
    if isinstance(result, str):
        data = result.strip()
        if data.startswith("data:image/"):
            # data URL
            try:
                header, b64 = data.split(",", 1)
                import base64

                return base64.b64decode(b64)
            except Exception:
                return b""
        # assume base64-encoded string
        try:
            import base64

            return base64.b64decode(data)
        except Exception:
            return data.encode("utf-8", errors="ignore")
    # Try common dict shapes
    if isinstance(result, dict):
        for key in ("png", "image", "data"):
            if key in result:
                return _decode_image(result[key])
    return b""


def save_screenshot(computer: Any, path: str) -> None:
    """Call computer.screenshot() and persist to path."""
    ensure_dir(os.path.dirname(path))
    try:
        fn = getattr(computer, "screenshot")
    except Exception:
        fn = None
    data: bytes = b""
    if callable(fn):
        try:
            result = fn()
            data = _decode_image(result)
        except Exception:
            data = b""
    with open(path, "wb") as f:
        f.write(data)


def download_to_file(url: str, path: str) -> None:
    ensure_dir(os.path.dirname(path))
    with urlopen(url) as resp:  # nosec - URL provided by trusted SDK
        data = resp.read()
    with open(path, "wb") as f:
        f.write(data)
