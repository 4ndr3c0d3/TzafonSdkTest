import http from 'node:http';
import { URL } from 'node:url';

type Json = any;

type CreateReq = { token?: string; base_url?: string; kind?: 'browser' };
type CloseReq = { token?: string; base_url?: string; id: string };

function readJson(req: http.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: Json) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
}

async function createComputer(body: CreateReq) {
  const base = (body.base_url || process.env.TZAFON_BASE_URL || 'https://v2.tzafon.ai').replace(/\/$/, '');
  const token = body.token || process.env.TZAFON_API_KEY || process.env.TOKEN;
  const kind = body.kind || 'browser';
  if (!token) throw new Error('Missing token (body.token or TZAFON_API_KEY)');

  const resp = await fetch(`${base}/v1/computers`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ kind }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`create failed: ${resp.status} ${text.slice(0,200)}`);
  const data = JSON.parse(text);
  const id: string = data.id;
  const cdp_url = `${base}/v1/computers/${id}/cdp?token=${token}`;
  return { id, cdp_url, base_url: base, kind };
}

async function closeComputer(body: CloseReq) {
  const base = (body.base_url || process.env.TZAFON_BASE_URL || 'https://v2.tzafon.ai').replace(/\/$/, '');
  const token = body.token || process.env.TZAFON_API_KEY || process.env.TOKEN;
  const id = body.id;
  if (!token) throw new Error('Missing token');
  if (!id) throw new Error('Missing id');
  const resp = await fetch(`${base}/v1/computers/${id}`, {
    method: 'DELETE',
    headers: { 'authorization': `Bearer ${token}`, 'accept': 'application/json' },
  });
  if (resp.status === 404 || resp.status === 410) return { success: true, closed: true };
  if (!resp.ok) {
    const text = await resp.text();
    return { success: false, closed: false, error: `${resp.status} ${text.slice(0,200)}` };
  }
  return { success: true, closed: true };
}

const PORT = parseInt(process.env.TZAFON_SERVICE_PORT || '8003', 10);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 404, { error: 'not found' });
    const { method } = req;
    const url = new URL(req.url, 'http://localhost');

    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'POST' && url.pathname === '/computers/create') {
      const body = await readJson(req);
      const result = await createComputer(body);
      return sendJson(res, 200, result);
    }

    if (method === 'POST' && url.pathname === '/computers/close') {
      const body = await readJson(req);
      const result = await closeComputer(body);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err: any) {
    return sendJson(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[tzafon-api-service] listening on :${PORT}`);
});

