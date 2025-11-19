import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional

import time
import socket
import uuid
import requests
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError  # type: ignore
from utils import ensure_dir, timestamp

# In-memory registry for locally launched CDP-enabled Chromium instances
LOCAL_CDP: dict[str, dict[str, Any]] = {}

def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


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

    def log_message(self, format: str, *args: Any) -> None:  # quieter default logging
        return

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

        if self.path == '/scrape/sayro':
            try:
                return self._handle_scrape_sayro(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        if self.path == '/cdp/create':
            try:
                return self._handle_cdp_create(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        if self.path == '/cdp/screenshot':
            try:
                return self._handle_cdp_screenshot(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        if self.path == '/cdp/close':
            try:
                return self._handle_cdp_close(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        if self.path == '/local-cdp/create':
            try:
                return self._handle_local_cdp_create(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        if self.path == '/local-cdp/screenshot':
            try:
                return self._handle_local_cdp_screenshot(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        if self.path == '/local-cdp/close':
            try:
                return self._handle_local_cdp_close(body)
            except Exception as e:
                return self._send(500, {'error': str(e)})

        return self._send(404, {'error': 'not found'})

    def _handle_screenshot(self, body: Dict[str, Any]):
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError('playwright not installed. Run: pip install playwright && playwright install') from e

        url = body.get('url')
        if not url:
            raise ValueError('Missing url')
        tabs = body.get('tabs') or 1
        try:
            tabs = max(1, min(50, int(tabs)))
        except Exception:
            tabs = 1
        full_page = bool(body.get('fullPage'))

        out_dir = os.path.join(os.path.dirname(__file__), 'results', 'service_playwright')
        ensure_dir(out_dir)

        images = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1366, 'height': 768})
            try:
                for i in range(tabs):
                    page = context.new_page()
                    page.goto(url, wait_until='domcontentloaded')
                    try:
                        page.wait_for_timeout(1000)
                    except Exception:
                        pass
                    file = os.path.join(out_dir, f"{timestamp(f'play_{i}_')}.png")
                    page.screenshot(path=file, full_page=full_page)
                    page.close()
                    images.append(file)
            finally:
                context.close()
                browser.close()

        return self._send(200, {'engine': 'playwright', 'images': images})

    # --- tzafon CDP: Sayro scraper ---
    def _create_computer(self, base_url: str, token: str, attempts: int = 3, timeout_s: int = 180) -> str:
        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        url = f"{base_url.rstrip('/')}/v1/computers"
        last_err: Optional[Exception] = None
        for i in range(1, max(1, attempts) + 1):
            try:
                resp = requests.request(
                    'POST', url,
                    json={'kind': 'browser'},
                    headers=headers,
                    timeout=timeout_s,
                )
                # Retry on 5xx
                if 500 <= resp.status_code < 600:
                    last_err = requests.HTTPError(f"{resp.status_code} Server Error: {resp.text[:200]}")
                    if i < attempts:
                        time.sleep(min(2 ** i, 8))
                        continue
                resp.raise_for_status()
                data = resp.json()
                return data['id']
            except Exception as e:  # noqa: BLE001
                last_err = e
                if i < attempts:
                    time.sleep(min(2 ** i, 8))
                    continue
                break
        raise RuntimeError(f"Failed to create computer via {url}: {last_err}")

    def _scrape_sayro_site(self, playwright, cdp_url: str, computer_id: str) -> Dict[str, Any]:
        out_dir = os.path.join(os.path.dirname(__file__), 'results', 'service_playwright')
        ensure_dir(out_dir)
        browser = playwright.chromium.connect_over_cdp(cdp_url)
        context = browser.new_context()
        page = context.new_page()
        try:
            page.goto('https://sayro-web.vercel.app/', timeout=10000)
            page.wait_for_function(
                "document.readyState === 'complete' || document.readyState === 'interactive'",
                timeout=8000,
            )
            page.wait_for_selector('section', timeout=8000)
            projects = page.evaluate(
                """
                () => {
                  const cards = Array.from(document.querySelectorAll('.project-card, .card, .project'));
                  return cards.map(card => ({
                    title: card.querySelector('h3, h2')?.innerText || null,
                    description: card.querySelector('p')?.innerText || null,
                    link: card.querySelector('a')?.href || null,
                  }));
                }
                """
            )
            screenshot_path = os.path.join(out_dir, f"sayro_{computer_id}.png")
            page.screenshot(path=screenshot_path, full_page=True)
            return {
                'success': True,
                'computer_id': computer_id,
                'data': { 'projects': projects },
                'screenshot': screenshot_path,
            }
        except PlaywrightTimeoutError as e:
            return {
                'success': False,
                'computer_id': computer_id,
                'error_type': 'TimeoutError',
                'error': str(e),
            }
        except Exception as e:  # noqa: BLE001
            return {
                'success': False,
                'computer_id': computer_id,
                'error_type': 'GeneralError',
                'error': str(e),
            }
        finally:
            try:
                context.close()
            except Exception:
                pass
            try:
                browser.close()
            except Exception:
                pass

    def _handle_scrape_sayro(self, body: Dict[str, Any]):
        # Allow token from request body or environment
        base_url: str = body.get('base_url') or os.environ.get('TZAFON_BASE_URL') or 'https://v2.tzafon.ai'
        token: Optional[str] = body.get('token') or os.environ.get('TZAFON_API_KEY') or os.environ.get('TOKEN')
        if not token:
            raise ValueError('Missing token (set body.token or TZAFON_API_KEY)')

        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError('playwright not installed. Run: pip install playwright && playwright install') from e

        computer_id = self._create_computer(base_url, token)
        cdp_url = f"{base_url}/v1/computers/{computer_id}/cdp?token={token}"

        with sync_playwright() as p:
            result = self._scrape_sayro_site(p, cdp_url, computer_id)

        return self._send(200, result)

    # --- Generic CDP microservice endpoints ---
    def _handle_cdp_create(self, body: Dict[str, Any]):
        base_url: str = body.get('base_url') or os.environ.get('TZAFON_BASE_URL') or 'https://v2.tzafon.ai'
        token: Optional[str] = body.get('token') or os.environ.get('TZAFON_API_KEY') or os.environ.get('TOKEN')
        if not token:
            raise ValueError('Missing token (set body.token or TZAFON_API_KEY)')
        kind = body.get('kind') or 'browser'
        # Reuse creator with retries
        computer_id = self._create_computer(base_url, token)
        cdp_url = f"{base_url.rstrip('/')}/v1/computers/{computer_id}/cdp?token={token}"
        return self._send(200, {
            'success': True,
            'computer_id': computer_id,
            'cdp_url': cdp_url,
            'base_url': base_url,
            'kind': kind,
        })

    def _handle_cdp_screenshot(self, body: Dict[str, Any]):
        cdp_url: Optional[str] = body.get('cdp_url')
        url: Optional[str] = body.get('url')
        full_page: bool = bool(body.get('fullPage'))
        if not cdp_url:
            raise ValueError('Missing cdp_url')
        if not url:
            raise ValueError('Missing url')
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError('playwright not installed. Run: pip install playwright && playwright install') from e

        out_dir = os.path.join(os.path.dirname(__file__), 'results', 'service_cdp')
        ensure_dir(out_dir)
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(cdp_url)
            context = browser.new_context()
            page = context.new_page()
            try:
                page.goto(url, timeout=15000)
                try:
                    page.wait_for_function(
                        "document.readyState === 'complete' || document.readyState === 'interactive'",
                        timeout=8000,
                    )
                except Exception:
                    pass
                file = os.path.join(out_dir, f"{timestamp('cdp_')}.png")
                page.screenshot(path=file, full_page=full_page)
                return self._send(200, { 'success': True, 'image': file })
            finally:
                try:
                    context.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass

    def _handle_cdp_close(self, body: Dict[str, Any]):
        base_url: str = body.get('base_url') or os.environ.get('TZAFON_BASE_URL') or 'https://v2.tzafon.ai'
        token: Optional[str] = body.get('token') or os.environ.get('TZAFON_API_KEY') or os.environ.get('TOKEN')
        computer_id: Optional[str] = body.get('computer_id')
        if not token:
            raise ValueError('Missing token (set body.token or TZAFON_API_KEY)')
        if not computer_id:
            raise ValueError('Missing computer_id')
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
        }
        url = f"{base_url.rstrip('/')}/v1/computers/{computer_id}"
        try:
            resp = requests.request('DELETE', url, headers=headers, timeout=30)
            # 404/410 treat as already closed
            if resp.status_code in (404, 410):
                return self._send(200, { 'success': True, 'closed': True })
            resp.raise_for_status()
        except Exception:
            # Best-effort close, still reply success=false but not crash
            return self._send(200, { 'success': False, 'closed': False })
        return self._send(200, { 'success': True, 'closed': True })

    # --- Local CDP management (no tzafon) ---
    def _handle_local_cdp_create(self, body: Dict[str, Any]):
        headless = bool(body.get('headless', True))
        port = int(body.get('port') or 0) or _find_free_port()
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError('playwright not installed. Run: pip install playwright && playwright install') from e

        # Start a dedicated Playwright instance for this browser
        p = sync_playwright().start()
        browser = None
        try:
            browser = p.chromium.launch(headless=headless, args=[f'--remote-debugging-port={port}'])
        except Exception:
            # Cleanup playwright on failure
            try:
                p.stop()
            except Exception:
                pass
            raise

        # Fetch WS debugger URL
        ws_url: Optional[str] = None
        try:
            meta = requests.get(f'http://127.0.0.1:{port}/json/version', timeout=5).json()
            ws_url = meta.get('webSocketDebuggerUrl')
        except Exception:
            ws_url = None

        instance_id = uuid.uuid4().hex[:12]
        LOCAL_CDP[instance_id] = { 'p': p, 'browser': browser, 'port': port, 'headless': headless }
        return self._send(200, {
            'success': True,
            'id': instance_id,
            'cdp_url': f'http://127.0.0.1:{port}',
            'ws_url': ws_url,
            'port': port,
            'headless': headless,
        })

    def _handle_local_cdp_screenshot(self, body: Dict[str, Any]):
        # Accept either id (server-managed) or raw cdp_url/ws_url
        instance_id: Optional[str] = body.get('id')
        cdp_url: Optional[str] = body.get('cdp_url')
        ws_url: Optional[str] = body.get('ws_url')
        url: Optional[str] = body.get('url')
        full_page: bool = bool(body.get('fullPage'))
        if not url:
            raise ValueError('Missing url')

        if not cdp_url and not ws_url:
            if not instance_id:
                raise ValueError('Provide id or cdp_url/ws_url')
            entry = LOCAL_CDP.get(instance_id)
            if not entry:
                raise ValueError('Unknown id')
            cdp_url = f"http://127.0.0.1:{entry['port']}"

        # Connect over CDP and take screenshot
        out_dir = os.path.join(os.path.dirname(__file__), 'results', 'service_local_cdp')
        ensure_dir(out_dir)
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError('playwright not installed. Run: pip install playwright && playwright install') from e

        with sync_playwright() as p:
            endpoint = ws_url or cdp_url
            assert endpoint is not None
            browser = p.chromium.connect_over_cdp(endpoint)
            context = browser.new_context()
            page = context.new_page()
            try:
                page.goto(url, timeout=15000)
                try:
                    page.wait_for_function(
                        "document.readyState === 'complete' || document.readyState === 'interactive'",
                        timeout=8000,
                    )
                except Exception:
                    pass
                file = os.path.join(out_dir, f"{timestamp('localcdp_')}.png")
                page.screenshot(path=file, full_page=full_page)
                return self._send(200, { 'success': True, 'image': file })
            finally:
                try:
                    context.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass

    def _handle_local_cdp_close(self, body: Dict[str, Any]):
        instance_id: Optional[str] = body.get('id')
        if not instance_id:
            raise ValueError('Missing id')
        entry = LOCAL_CDP.pop(instance_id, None)
        if not entry:
            return self._send(200, { 'success': True, 'closed': True })
        # Close browser and stop playwright
        try:
            entry['browser'].close()
        except Exception:
            pass
        try:
            entry['p'].stop()
        except Exception:
            pass
        return self._send(200, { 'success': True, 'closed': True })


def main() -> None:
    port = int(os.environ.get('PLAYWRIGHT_SERVICE_PORT', '8002'))
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f"[py-playwright-service] listening on :{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
