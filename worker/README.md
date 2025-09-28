# Nebula Worker

Cloudflare Worker that proxies Gemini, handles KV caching, and exposes `/api/ask`, `/api/plan`, and `/api/summarize` for the Chrome extension.

## Setup

```bash
cd worker
npm install
npm run typecheck
```

### Environment Secrets

Create `.dev.vars` (ignored) for local development and set the following:

```
GEMINI_API_KEY=your-google-api-key
GEMINI_MODEL=gemini-1.5-flash-latest   # override if your key lacks access
ALLOWED_ORIGINS=chrome-extension://<dev-extension-id>,http://localhost:3000
WORKERS_AI_MODEL=@cf/meta/llama-3.1-8b-instruct
```

In production, configure these in the Cloudflare dashboard/`wrangler secret`.
If you see `Gemini ... 404` errors, downgrade `GEMINI_MODEL` to one your key can use (for example `gemini-1.0-pro`).

### Workers AI Binding (Fallback)

Add the [AI binding](https://developers.cloudflare.com/workers-ai/reference/workers-configuration/) in Cloudflare or via `wrangler.toml`:

```toml
[[ai]]
binding = "AI"
```

This allows the worker to call `env.AI.run(...)` when Gemini is unavailable.

### KV Namespace

Provision a KV namespace for cached summaries:

```bash
wrangler kv:namespace create nebula_summaries
wrangler kv:namespace create nebula_summaries --preview
```

Copy the `id` and `preview_id` into `wrangler.toml` under the `SUMMARIES_KV` binding.

## Local Smoke Test

1. Start the worker in local mode: `npm run dev`
2. In another terminal, call `/api/summarize` twice to see the cache in action:

```bash
curl -X POST http://127.0.0.1:8787/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","context":{"title":"Example","headings":["Sample"],"selection":"Lorem"}}'
```

- First call should fetch from Gemini/Workers AI and populate KV.
- Second call (same payload) should return `cached: true` in the response.

Check the worker logs for `KV put`/hits while testing.

## Endpoint Reference

- `POST /api/ask` – Free-form Q&A. Fields: `query`, optional `context`.
- `POST /api/plan` – Action plan JSON using the shared `AutomationPlan` contract.
- `POST /api/summarize` – Page TL;DR with KV caching and force refresh toggle.

All responses include `request_id`, model metadata, and the redacted payload preview for the extension UI.

## Deployment

```bash
npm run deploy
```

Ensure secrets (Gemini key, allowed origins) and bindings (KV, AI) are set in the target environment before deploying.
