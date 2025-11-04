Tzafon SDK Automation Workspace

What’s included
- Python and TypeScript projects side‑by‑side
- Five browser automations (Wikipedia, NYTimes, Airbnb, GitHub, Reddit)
- Concurrent runners for 10 and 50 browsers
- Results folders where screenshots and logs are saved

Prerequisites
- Set your API key in the shell before running:
  - `export TZAFON_API_KEY=sk_your_api_key_here`

Python quickstart
- Create and activate a virtualenv (optional):
  - `python3 -m venv .venv && source .venv/bin/activate`
- Install deps: `pip install -r python/requirements.txt`
- Run a single automation:
  - `python python/wikipedia.py`
  - `python python/nytimes.py`
  - `python python/airbnb.py`
  - `python python/github.py`
  - `python python/reddit.py`
- Run concurrent examples:
  - `python python/concurrent_10.py`
  - `python python/concurrent_50.py`
- Screenshots/logs: `python/results/`

TypeScript quickstart
- From `typescript/`:
  - Install deps: `npm install`
  - Run a single automation:
    - `npm run wiki`
    - `npm run nytimes`
    - `npm run airbnb`
    - `npm run github`
    - `npm run reddit`
  - Run concurrent examples:
    - `npm run concurrent:10`
    - `npm run concurrent:50`
- Screenshots/logs: `typescript/results/`

Notes
- Scripts use Immediate Execution mode (`navigate()` and other actions run immediately).
- Results folders are created on demand; screenshots are timestamped per run.
- If your tzafon SDK exposes a different screenshot method name, the helpers try common fallbacks automatically.

