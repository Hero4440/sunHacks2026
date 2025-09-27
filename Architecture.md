# Naros  — System Architecture (Hackathon MVP+)
_Date:_ 27 Sep 2025 · _Team:_ 2 people · _Build window:_ ~24 hours · _Target:_ Chrome Extension (MV3)

> **Goal:** A site‑agnostic, privacy‑first AI copilot that acts like a human (scroll, focus, type, click, tab) and a Spotlight‑style navigator (switch to tabs, reopen from history, open settings) — with strong guardrails, explicit consent, and graceful fallbacks.

---

## 1) Constraints & Assumptions
- **Time/Team:** 24h, 2 devs. Optimize for *reliability + polish*, not breadth.
- **Platform:** Chrome Extension **MV3** (service worker lifecycle; no persistent background page). No injection on `chrome://` or restricted origins.
- **Site‑agnostic:** No per‑site hardcoding. Natural language → generic intents; a universal resolver finds targets.
- **Human‑mode only:** Simulate user input/events; **no DOM mutation** for content; **no auto‑submit**.
- **Privacy:** Local‑first. Minimal context leaves device with PII masked. Opt‑in telemetry only.
- **Network resilience:** Cloudflare Worker proxy; KV cache; Workers AI fallback; offline fixtures for demo.
- **Sponsor alignment:** Gemini (LLM), Cloudflare (proxy/cache/fallback/Pages), Snowflake (opt‑in telemetry), GoDaddy (domain).

---

## 2) High‑Level Architecture (text diagram)
```
[User] ── hotkey ─▶ [Command Palette / Spotlight (React)]
   │                                  │
   │                                  ├─▶ [Local Indexes] open tabs ▸ history ▸ sessions ▸ settings map
   │                                  │
   │                                  └─▶ [Context Bundler]
   │                                              │
   │                                              └─▶ HTTPS → [Cloudflare Worker]
   │                                                            ├─ PII Redaction
   │                                                            ├─ KV Cache
   │                                                            ├─ Gemini (primary)
   │                                                            └─ Workers AI (fallback)
   │
   └─▶ [Content Script]
        ├─ Universal Resolver (semantic+proximity scoring)
        ├─ Human Interaction Engine (scroll/focus/type/click/tab)
        ├─ Shadow‑DOM overlay (coach marks; no site CSS pollution)
        └─ IndexedDB (timeline, topic tags, cached TL;DR)
```

---

## 3) Extension Modules (MV3)
### 3.1 Service Worker (Background)
- Event hub: `chrome.runtime.onMessage`, `tabs`, `sessions`, `history`, `commands`.
- Hosts **Spotlight** engine (index, rank, intent parser) and **Context Bundler**.
- Calls Cloudflare Worker (`/api/ask`, `/api/plan`, `/api/summarize`).
- Enforces **rate limits**, token budgets, and feature flags (Safe Mode, per‑site allow/deny).

### 3.2 Content Script
- Extracts **visible** text structure (title, top headings, selection bounds) — *never full DOM*.
- Renders **sidebar/popup** UI container and **overlay** in a Shadow DOM island.
- Runs **Universal Resolver** (score targets) and **Human Interaction Engine** (simulate events) with **undo** and **timeouts**.
- Detects CSP/iframe constraints and auto‑falls back to sidebar‑only instructions.

### 3.3 UI (React)
- **Command Palette** + **Answers Panel**; quick tabs: Answers ▸ Steps ▸ Spotlight ▸ Sent Log ▸ Settings.
- **Spotlight** results: open tabs, recently closed, history, settings deep‑links, commands.
- **What Was Sent** inspector: payload preview (masked), tokens, `model_used`, cache/fallback flags.

### 3.4 Storage
- **IndexedDB** (idb) for timeline (`pages{url,title,tldr,ts}`), topicTags, cached TL;DR, UI prefs.
- **chrome.storage.local** for lightweight prefs, Safe Mode, per‑site allow/deny.

### 3.5 Permissions (MV3)
`activeTab`, `scripting`, `tabs`, `storage`, `commands`, `history`, `sessions`, optional `downloads`, `clipboardWrite`; host permissions: `<all_urls>`.

---

## 4) Spotlight / Universal Navigator
### 4.1 Data Sources
- **Open tabs:** `chrome.tabs.query` (title, URL, lastActive, audible, pinned, windowId).
- **History:** `chrome.history.search` (last 14 days by default).
- **Recently closed:** `chrome.sessions.getRecentlyClosed` + `chrome.sessions.restore`.
- **Settings map:** static list + `chrome://settings/?search=<term>` deep‑linker.

### 4.2 Index & Rank
- Maintain in‑memory index (per window and global). Update on `onActivated`, `onUpdated`, `onRemoved`.
- Rank = fuzzy(title/url) + recency + frequency + topicTag match (+ audible/pinned boosts when relevant).
- **Latency budget:** index lookup ≤50ms; tab activation ≤150ms.

### 4.3 Intent Parser
- Fast grammar for common forms (no LLM):
  - `take|switch to <q>` → `switch_tab`
  - `reopen <q>` → `reopen_tab`
  - `open settings [for|about] <q>` → `open_settings`
  - `screenshot [full|visible]` → `screenshot`
  - `zoom to <n>%` → `zoom`; `back|forward|reload` → `nav`
- When ambiguous, call Gemini to return structured intent JSON.

### 4.4 Execution
- `switch_tab` → activate best match; tie → quick picker; raise window.
- `reopen_tab` → try sessions, else history → open new tab.
- `open_settings` → `chrome://settings/?search=<q>` (no injection on `chrome://`).
- Provide **Undo navigation** (return to previous tab+scroll).

---

## 5) Context Bundler
- Inputs: `title`, `url`, top 2–3 headings (+ 200‑char previews), selection (≤1k chars), 1–2 topicTags.
- Budget: ≤2.5k input tokens. Trim: oldest timeline ▸ extra headings ▸ selection tail.
- PII masking (email/phone/SSN/address patterns) **client‑side** before send; **re‑mask** server‑side.
- Preview payload in **What Was Sent**; hash id ties client and server logs.

---

## 6) Human Interaction Engine (no DOM mutation)
- **Targeting:** Universal Resolver scores label/`for`, `aria-*`, `name`, `placeholder`, nearby text, role/type bias, visibility.
- **Actions:** `scroll`, `focus`, `type` (per‑char + native setter per word + `input/change`), `click`, `tab`, `wait(ms)`; never auto‑submit.
- **Consent:** require **Start Assist**; destructive actions require `confirm:true`.
- **Safety:** block password/payment fields; time‑box each step (5s); abort after 2 failures.
- **Fallback:** if synthetic events rejected → numbered step list; highlight targets only.

---

## 7) Backend — Cloudflare Worker
### 7.1 Endpoints
- `POST /api/ask` → Q&A; returns `{answer, model_used, tokens_in/out, cached}`.
- `POST /api/plan` → returns **Action Plan JSON** (allowed acts only).
- `POST /api/summarize` → per‑URL TL;DR (KV‑cached by URL hash).

### 7.2 Middleware & Services
- **PII Redaction** (server‑side double check) → drop/mask sensitive strings.
- **KV Cache** for `/summarize` and short‑lived `/ask`.
- **Model routing:** Gemini primary; Workers AI fallback; expose `model_used`.
- **Durable Object** (optional): per‑user rate limit / token meter.
- **Observability:** structured logs (req id, timings, tokens, cache hit, model, minimal URL hash).

### 7.3 Error Model
- `429` rate limit; `413` payload too large; `5xx` provider error; response includes `retry_after_ms` when applicable.

---

## 8) Data Schemas
### 8.1 Action Plan (JSON)
```json
[
  {"act":"find","target":"student id"},
  {"act":"scroll","to":"center"},
  {"act":"focus"},
  {"act":"type","text":"12345678","perChar":true},
  {"act":"find","target":"save"},
  {"act":"click","confirm":true}
]
```

### 8.2 IndexedDB (local)
- `timeline`: `{url, title, tldr, ts}` (max 5)
- `topicTags`: `{urlHash: string, tags: string[]}`
- `cache`: `{urlHash, tldr, cachedAt}`

### 8.3 Snowflake (opt‑in telemetry)
```sql
create table Naros _events (
  user_hash string,
  ts timestamp,
  url_hash string,
  site_tag string,
  op string,          -- ask|plan|summarize|spotlight
  token_in int,
  token_out int,
  pii_present boolean,
  kept_local boolean
);
```

---

## 9) Security, Privacy & Compliance
- **Least privilege:** MV3 permissions only as needed; incognito off by default.
- **No keys client‑side:** All model calls via Worker; origin checks; key rotation.
- **PII posture:** Mask client‑side; scrub server‑side; never log raw content.
- **Per‑site allow/deny** and **Safe Mode** enforced at entry points (palette, proactive chip, Spotlight actions).
- **No interaction** with password/payment fields; no injection on `chrome://`.
- **“What Was Sent”** must match server log by hash id; local logs auto‑purge after 24h.

---

## 10) Performance & Resilience Budgets
- **Latency:** P50 answer ≤1.5s; P90 ≤3.5s. Spotlight parse ≤50ms; tab activation ≤150ms.
- **Token budget:** ≤2.5k in / ≤512 out; truncate with “partial” badge.
- **Caching:** `/summarize` TTL 60–300s; optimistic prefetch on tab switch.
- **Backpressure:** cancel in‑flight calls on navigation; exponential backoff on failures.
- **Offline:** fixtures (mirrored HTML + canned responses) for demo.

---

## 11) Failure Modes → Fallbacks
| Failure | Symptom | Fallback |
|---|---|---|
| CSP blocks overlays | No chip/overlay | Sidebar‑only numbered steps + banner |
| Model outage/quota | Answers/plans time out | Workers AI → local heuristic TL;DR |
| Token overrun | Slow/$$ | Send selection + title only; mark as partial |
| Resolver low confidence | Ambiguous target | Ask user to click the element once |
| Synthetic events rejected | No change after type/click | Switch to instruction mode |
| Network down | Requests fail | Offline fixtures; cached summaries |
| Full‑page stitch fails | Misaligned capture | Visible‑area screenshot |
| `chrome://` restrictions | No injection/capture | Navigate only; explain limitation |

---

## 12) Accessibility & UX
- Keyboard‑first: ⌘/Ctrl+Shift+Space; Esc to close; Tab order logical.
- ARIA roles for tooltips/landmarks; high‑contrast theme; reduced motion toggle.
- Non‑intrusive proactive chips; per‑site frequency caps.

---

## 13) Build & Repo Layout
```
/extension
  manifest.json
  /src
    background.ts          # SW: spotlight, bundler, messaging
    content.ts             # resolver + actor + overlay
    /ui
      sidebar/App.tsx      # answers, steps, sent log, settings
      popup/App.tsx
    /lib
      contextBundler.ts
      spotlight.ts         # index, rank, grammar
      resolver.ts          # scoring & disambiguation
      actor.ts             # scroll/focus/type/click/tab
      pii.ts               # client masks
      storage.ts           # idb + chrome.storage
/worker
  index.ts                 # CF Worker: ask/plan/summarize, PII, KV, fallback, logs
/docs
  Features.md, Goals.md, Architecture.md
```

---

## 14) Deployment & Keys
- **Cloudflare Pages** hosts landing site at GoDaddy domain.
- **CF Worker** deployed with environment secrets; restrict by origin; rotate as needed.
- **Extension** built with Vite/TS; MV3 ZIP for submission. Optional incognito support (user‑enabled).

---

## 15) Testing Plan (fit for hackathon)
- **Unit:** resolver scoring, PII mask regexes, bundler trimming.
- **Integration:** /ask and /summarize round‑trip; KV cache hit path; fallback path.
- **E2E (manual + script):** Spotlight “chess tab”, settings deep‑link, history reopen, human‑mode typing on a generic form.
- **A11y:** axe‑lite on panel; keyboard flows.

---

## 16) Risk Register (top 10)
1. **Over‑scope** → lock MVP; cut list ready (drop stitched screenshots; limit Spotlight to 14‑day history).
2. **CSP/iframes** → overlay fallback + instruction mode.
3. **Trusted input checks** → switch to user‑assisted mode when `isTrusted` required.
4. **Model cost/latency** → token caps, KV cache, fallback model, local TL;DR.
5. **Privacy objections** → payload preview, Safe Mode, Forget All, opt‑in telemetry.
6. **Incognito surprises** → keep disabled by default; clear banner when enabled.
7. **Permissions friction** → staged onboarding; request only when needed.
8. **API key leakage** → keys only in Worker; origin checks; rotate keys.
9. **Demo Wi‑Fi issues** → offline fixtures; recorded backup video.
10. **chrome:// variability** → prefer search deep‑link; handle version differences gracefully.

---

## 17) Advanced Enhancements (beyond MVP)
### 17.1 Service Worker Lifecycle & Queues
- **Problem:** MV3 unloads the SW when idle.
- **Approach:** Use event‑driven work only; keep short‑lived tasks. For long tasks, checkpoint progress in `chrome.storage.session` and resume on next event.
- **Queues:** In‑memory queue for spotlight intents; persist backlog (max 1) to storage with `reqId` and `deadlineMs`.
- **Keepalive:** Avoid artificial keepalives; rely on user‑initiated events and alarms (only for periodic cache cleanup).

### 17.2 Messaging Protocol (Content ⇄ SW ⇄ UI)
- **Envelope:** `{id, source, kind, ts, payload}`; responses mirror `id`.
- **Timeouts:** 5s default; retries with backoff for Worker calls.
- **Streamed answers:** optional chunked updates via `chrome.runtime.Port` for progressive rendering.

### 17.3 Action Executor FSM
```
Idle → ResolveTarget → Scroll → Focus → Type/Click → WaitForSettle → Done
           │               │        │         │            │
           ├──> NeedsUserTap ───────┴─────────┴────────────┴──> Abort (with reason)
```
- **Guards:** element visibility; enabled; within viewport after scroll; `confirm:true` for risky steps.
- **Settle:** wait for microtasks + animation frame + 150ms debounce or DOM stable mutation count.

### 17.4 Universal Resolver — Scoring
- **Features:** label/`for`, `aria-label`, `role`, `name`, `placeholder`, nearby text (within 120px), tag/type bias, visibility.
- **Weights:** start with (3.0, 2.0, 0.8, 1.5, 1.0, 0.6) and tune empirically.
- **Confidence:** <2.5 → request user tap; ≥4.0 → allow proactive chip.

### 17.5 Spotlight Index — Ranking
- **Score:** `0.5*fuzzy(title/url) + 0.3*recency + 0.1*frequency + 0.1*topicTag` (+0.2 audible/pinned boost when relevant).
- **Windows:** search all windows; activate and raise owning window.

### 17.6 Privacy/Data Flow — Classification
| Data | At rest | In transit | Retention |
|---|---|---|---|
| Timeline (title,url,tldr) | IndexedDB (local) | n/a | 24h or until Forget All |
| TopicTags | IndexedDB (local) | n/a | 24h |
| Payload → Worker | masked JSON | HTTPS | ephemeral; not logged raw |
| Telemetry (opt‑in) | Snowflake (hashed) | HTTPS | per org policy |

### 17.7 Threat Model & Mitigations
- **Prompt‑injection:** sanitize page text; fixed system prompt; tool whitelist; cap length; refuse hidden content.
- **XSS in extension UI:** no `innerHTML`; DOMPurify‑like sanitize if needed; strict CSP for extension pages.
- **Exfiltration risk:** payload preview; denylist patterns; per‑site allowlist; Safe Mode.
- **Supply chain:** lock dependencies; content‑hash builds; review 3rd‑party code.
- **Abuse:** rate limit per origin; user token caps; action confirmation on risky ops.

### 17.8 Permissions & Onboarding
- Stage requests: start with `activeTab,tabs,storage,commands`; gate `history,sessions` behind **Enable Spotlight recall** checkbox; optional `downloads,clipboardWrite` for screenshots.
- Clear explainer for each toggle; link to chrome://extensions/shortcuts for hotkeys.

### 17.9 Structured Errors (client ↔ worker)
```json
{ "code":"RATE_LIMIT", "http":429, "retry_after_ms":30000, "message":"Daily token cap reached" }
```
- Client maps to friendly toasts and suggests remedies (enable cache, try later).

### 17.10 Profiling & Budgets
- Instrument: parse/bundle time, resolver time, actor step times, Worker RTT, cache hit rate.
- Surface a small **Health** badge (online/cache/fallback/latency bucket).

---

## 18) Roadmap Notes
- **v1.1:** stitched screenshots, tab groups, incognito polish, voice to palette, richer error UI.
- **v2:** Electron browser shell reusing resolver/actor; tabs, omnibox, internal pages, account/sync (encrypted).

```
