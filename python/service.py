import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict

from utils import ensure_dir, timestamp, download_to_file

try:
    from tzafon import Computer
except Exception as e:  # pragma: no cover - runtime import
    Computer = None  # type: ignore


def read_json(body: bytes) -> Dict[str, Any]:
    if not body:
        return {}
    try:
        return json.loads(body.decode('utf-8'))
    except Exception:
        return {}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: Dict[str, Any]):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        if self.path == '/health':
            return self._send(200, {'ok': True})
        return self._send(404, {'error': 'not found'})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get('content-length') or '0')
        raw = self.rfile.read(length) if length > 0 else b''
        body = read_json(raw)

        if self.path == '/screenshot':
            try:
                return self._handle_screenshot(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        return self._send(404, {'error': 'not found'})

    def _handle_screenshot(self, body: Dict[str, Any]):
        if Computer is None:
            raise RuntimeError('tzafon package not available')
        url = body.get('url')
        if not url:
            raise ValueError('Missing url')

        out_dir = os.path.join(os.path.dirname(__file__), 'results', 'service_python')
        ensure_dir(out_dir)

        client = Computer()
        computer = client.create(kind='browser')
        computer.navigate(url)
        try:
            computer.wait(2)
        except Exception:
            pass
        result = computer.screenshot()
        shot_url = None
        try:
            shot_url = result.result.get('screenshot_url')
        except Exception:
            shot_url = None

        file = ''
        if shot_url:
            file = os.path.join(out_dir, f"{timestamp('py_')}.png")
            download_to_file(shot_url, file)

        try:
            computer.close()
        except Exception:
            pass

        return self._send(200, {'engine': 'tzafon', 'image': file})


def main() -> None:
    port = int(os.environ.get('PY_SERVICE_PORT', '8001'))
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f"[python-service] listening on :{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()

