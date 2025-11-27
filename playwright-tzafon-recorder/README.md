# Playwright → Tzafon Recorder (Standalone)

A self-contained Playwright recorder that runs locally and emits tzafon-style steps from your interactions. Frontend is a React SPA (Chakra UI + React Router) served by the Node service after building. No dependencies on your other projects or the tzafon SDK.

## Setup
```
# backend (service)
npm install
npm run playwright:install

# frontend
cd frontend
npm install
```

## Run (two options)
1) **Dev with Vite (recommended while editing UI)**
   - Terminal A: `npm run service:recorder` (defaults: port `8010`, set `RECORDER_HEADLESS=false` to see Chromium)
   - Terminal B: `cd frontend && npm run dev` (default `5173`, proxies `/api` to `8010`)
   - Open `http://localhost:5173/`

2) **Serve built SPA from the service**
   - `cd frontend && npm run build` (outputs to `frontend/dist`)
   - From repo root: `npm run service:recorder`
   - Open `http://127.0.0.1:8010/`

## Usage
- Enter a URL, start a session, then click/scroll/type on the preview. The right pane shows tzafon steps you can copy.
- Screenshots are saved under `results/recorder/` in this folder.

## Notes
- All endpoints are local (`/api/*`); there is no outbound connection to tzafon or the other repo.
- Generated tzafon snippets omit the `Computer.create()`/`close()` boilerplate—wrap them with your lifecycle when you paste elsewhere.
