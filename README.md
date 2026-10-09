# Smart Data Extractor

An LLM-powered toolkit that transforms messy, unstructured text into clean, validated, structured data — with per-field confidence scores, format validation, cost tracking, and a bilingual (EN/ZH) web UI.

**Live demo**: deployed on Render (see `render.yaml`) · **Stack**: FastAPI · Pydantic-AI · React + TypeScript · SQLite

## Features

- **Preset scenarios** — Contact, Invoice, Lead extraction schemas out of the box, with bilingual field display names
- **Custom schemas** — define your own fields, or let the AI **infer a schema from a sample text** (`/schema/infer`)
- **Confidence scoring** — every extracted field carries a `confidence ∈ [0.0, 1.0]`; null values auto-zero their confidence
- **Format validation** — email/phone/url/ISO-date validators attached dynamically via a `format → validator` registry
- **Cost tracking** — per-extraction token usage and USD cost, aggregated across batches
- **Batch processing** — concurrent extraction with a process-wide concurrency limiter; per-item error tolerance (partial results survive)
- **File input** — plain text, PDF (text layer with OCR fallback per page), and images (PNG/JPEG/BMP) via GLM vision OCR
- **Export** — JSON and Excel (two sheets: results + field confidences), named `templateName-timestamp`
- **Bilingual UI** — English / 中文, persisted preference, language-aware LLM prompts
- **History** — last 20 runs in localStorage, one-click restore

## Architecture

```
Text / PDF / Image
        │
        ▼
┌─────────────────────────┐
│  FastAPI  (api/)        │  /extract /batch_extract /schema/resolve
│  SPA static files       │  /schema/infer /parse_pdf /parse_image /presets /health
└───────────┬─────────────┘
            ▼
┌─────────────────────────┐
│  extraction/            │  extract_data · batch_extract · OCR
│  presets/ · models/     │  DB-backed preset schemas · dynamic Pydantic models
└───────────┬─────────────┘
            ▼
      Pydantic-AI Agent ──► LLM (DeepSeek / OpenAI / …) — temperature=0
            │
            ▼
   Validated JSON + per-field confidence + usage/cost
```

Dependency direction is strictly one-way: `config → validators → models → presets → extraction → api / cli`.

## Quick Start

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync                      # install backend deps
# create a .env with your keys (see Environment below) — .env is gitignored
uv run pytest                # 210+ tests, all offline (TestModel)
```

### Web app

```bash
cd frontend && npm install && npm run build   # build the SPA
cd .. && uv run uvicorn smart_data_extractor.api:app --reload
# → http://localhost:8000  (API + frontend served same-origin)
```

For frontend development with hot reload: `cd frontend && npm run dev` (Vite proxies `/api` to the backend).

### CLI

```bash
uv run smart-data-extractor extract --text "Jane Doe, jane@acme.com, +1-415-555-0132" --preset contact
uv run smart-data-extractor batch --input leads.jsonl --preset lead --output results.json
```

Exit codes: `0` success · `1` extraction/business error (batch partial results still written) · `2` usage error. Data goes to stdout, diagnostics to stderr.

### API

| Endpoint | Purpose |
|---|---|
| `POST /extract` | Single-text extraction |
| `POST /batch_extract` | Concurrent batch, per-item tolerance |
| `POST /schema/resolve` | Validate + normalize a custom schema |
| `POST /schema/infer` | AI-infer a schema from sample text |
| `POST /parse_pdf` / `POST /parse_image` | File → text (OCR fallback) |
| `GET /presets` · `GET /presets/{name}/schema` | Preset metadata & fields |
| `GET /health` | Health check |

All endpoints are also reachable under the `/api` prefix (used by the frontend).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `MODEL` | no | Pydantic-AI model ref; default `openai:gpt-4o-mini`. This project runs `deepseek:deepseek-chat` (uses `DEEPSEEK_API_KEY`) |
| `OPENAI_API_KEY` | yes* | *Required by config schema; a placeholder value works when using DeepSeek |
| `DEEPSEEK_API_KEY` | DeepSeek setups | API key for `deepseek:*` models |
| `GLM_API_KEY` | optional | Enables PDF/image OCR via free `glm-4v-flash` |
| `MAX_CONCURRENCY` | no | Global concurrency cap (default 5) |
| `DATABASE_URL` | no | SQLAlchemy URL (default local SQLite) |
| `DAILY_QUOTA_PER_IP` | no | DEMO-STAGE guard: requests per visitor IP per UTC day (default 50, 0 disables) |
| `DAILY_QUOTA_GLOBAL` | no | DEMO-STAGE guard: total requests per UTC day (default 1000, 0 disables) |
| `ADMIN_STATS_TOKEN` | no | When set, enables `GET /stats?token=...` (today's traffic: usage, unique IPs, per-endpoint counts). Counters are in-memory and reset on deploy — replace with per-user quotas before public promotion (see `.harness/decisions.md` D-019) |

## Testing

```bash
uv run pytest                                    # backend: fully offline via pydantic-ai TestModel
cd frontend && npx vitest run && npx tsc -b      # frontend: 175+ tests + typecheck
```

Offline guarantee: deleting `OPENAI_API_KEY` still passes the whole backend suite — no test ever spends real API money. A real-API smoke test exists behind `RUN_INTEGRATION=1`.

## Deployment (Render)

Single-service deployment: FastAPI serves both the API and the built SPA — no CORS, one cold start.

1. Push this repo (contains `render.yaml` Blueprint)
2. Render Dashboard → **New → Blueprint** → pick the repo
3. Fill in `DEEPSEEK_API_KEY` (required) and `GLM_API_KEY` (optional, for OCR)
4. Apply → verify `/health`

Free tier notes: the service spins down after 15 min idle (first hit takes ~30–50s), and the SQLite file resets on redeploy — preset schemas are re-seeded automatically on startup, and user data (history, custom templates) lives in browser localStorage.

## Project Notes

Engineering decisions are logged in [`.harness/decisions.md`](.harness/decisions.md) (D-001 … D-018), progress in [`.harness/state.md`](.harness/state.md). Development followed TDD throughout (red → green → refactor), with `uv.lock` pinning backend dependencies.
