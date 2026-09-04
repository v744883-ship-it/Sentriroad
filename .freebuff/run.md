# Sentriroad — Preview Run Doc

How to run the web app for live preview (mock data, no external credentials).

## What the preview is

Two processes, both started from this workspace (`C:\tools`):

| Process | Dir | URL | Role |
|---|---|---|---|
| Mock API server | `mock-server/` | `http://localhost:4000` | In-memory fixture data (users, reports, work orders, feedback, uploads). Serves `/api/v1/*` and stored uploads. |
| Frontend dev server | `frontend/` | `http://localhost:5173` | Vite + React. Proxies `/api` and `/uploads` to `:4000` (see `frontend/vite.config.ts`). |

Demo sign-in (password for every seeded account: `123`):
- citizen → `ravi@example.com`
- authority → `suresh.authority@bbmp.gov.in`
- crew → `ramesh.crew@bbmp.gov.in`
- drone operator → `kavya.drone@bbmp.gov.in` (Drone Operations Console at `/operator`)
- admin → `admin@sentriroad.app`

Login is role-first; a mismatch (e.g. citizen email in the Authority portal)
is rejected with `403 ROLE_MISMATCH`.

## Reproduce the artifacts a fresh checkout needs

There are **no secret env files required** for the mock-data preview:

- `frontend/` — needs no `.env`/`.env.local`; `src/api/client.ts` defaults
  `BASE_URL` to `/api/v1` and Vite proxies it to the mock server.
- `mock-server/` — needs no env; data lives in `mock-server/data/*.json`.
- The real backend (`backend/`) with Supabase is **not** part of this
  preview; its `.env` (Supabase keys) is only needed when running the real
  backend instead of the mock.

Install dependencies if `node_modules` is missing in either package:

```bash
cd mock-server && npm install
cd frontend && npm install
```

## Run the servers

Start the mock API first, then the frontend (detached, log to file):

```bash
cd /c/tools/mock-server && nohup npm start > /c/tools/.freebuff/mock-server.log 2>&1 &
cd /c/tools/frontend  && nohup npm run dev  > /c/tools/.freebuff/vite.log 2>&1 &
```

Wait until both answer, then register the preview:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/   # expect 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/   # expect 200
```

If `:5173` is taken, Vite auto-increments (5174, 5175…) — read
`.freebuff/vite.log` for the actual port and register that instead. If
`:4000` is taken (e.g. the real backend), stop the other process first or
the mock will exit with `EADDRINUSE`.

Register the preview in Freebuff with `http://localhost:5173` and the Vite
process id.
