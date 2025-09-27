# Naros  — Feature Specification (v1)

> **Positioning:** Site‑agnostic, privacy‑first AI that lives in Chrome. No DOM surgery. Interacts like a human (scroll, focus, type, click, tab) with explicit consent. Ready for sponsor tracks: Gemini, Cloudflare, Snowflake, GoDaddy.

---

## 1) Core Product Principles
- **Site‑agnostic:** No per‑site hardcoding. The agent plans in natural language; a universal resolver finds targets.
- **Human‑mode interactions:** Simulate real user input; never auto‑submit; sensitive fields are guide‑only.
- **Local‑first privacy:** Only send the minimal context with PII masked; transparent payload logs; one‑click Forget All.
- **Graceful degradation:** Clear fallbacks when overlays are blocked, models fail, or events are rejected.
- **Sponsor‑aligned:** Gemini for planning/answers, Cloudflare Worker proxy+cache+fallback, optional Snowflake telemetry, GoDaddy domain for polish.

---

## 2) Feature Map (overview)
1. **Command Palette** (⌘/Ctrl+Shift+Space) anywhere.
2. **Context Capture & Bundler** (title, URL, headings, selection; token‑budgeted).
3. **Answers Panel** (sidebar/popup) with **Session Timeline** (last 5 pages).
4. **Human Interaction Engine** (scroll/focus/type/click/tab; undo; no auto‑submit).
5. **Universal Element Resolver** (semantic + proximity scoring; disambiguation tap).
6. **LLM Planner → Action Plan JSON** (site‑agnostic steps; time‑boxed; confirm gate).
7. **Proactive Chip** (non‑intrusive; confidence and frequency caps; Safe Mode aware).
8. **Privacy Suite** (per‑site allow/deny, What Was Sent inspector, PII masking, Forget All, Safe Mode).
9. **Cloudflare Worker API** (PII redaction, KV caching, Workers AI fallback; keys server‑side only).
10. **(Opt‑in) Snowflake Topic Cards** (hashed minimal telemetry → recurring intent surfacing).
11. **Performance & Cost Controls** (token budgets, caching, latency targets).
12. **Accessibility & UX** (keyboard, ARIA, high contrast, reduced motion).
13. **Screenshots & Capture** (visible area + optional full‑page stitch, with redaction & export).
14. **Chrome Actions (System Ops)** (new/close/switch tab, reload, back/forward, zoom, history/downloads/extensions, settings navigation).
15. **Universal Navigator / Spotlight** (open‑tabs + history + settings + commands in one super‑search).
16. **Tab Intelligence & Memory** (open‑tab indexing, topic tags, fast recall like “the chess tab”).
17. **History Reopen & Sessions** (search history/recently‑closed; reopen with context pre‑warm).
18. **Settings Deep‑Links** (robust navigation to relevant Chrome settings pages).
19. **Context Pre‑Warm** (prepare summaries & topic cards before/at switch for instant readiness).
20. **Command Grammar & Examples** (natural phrases → structured intents for Spotlight & actions).
21. **MV3 Permissions & APIs** (explicit permission set and API usage per feature).
22. **Security Constraints & Guardrails** (hard rules that protect users & sites).

---

## 3) Detailed Feature Specs

### 3.1 Command Palette
**Description:** Global hotkey opens Naros  on any page. Supports free‑text questions and verbs ("explain", "summarize", "fill", "navigate").

**Flows:**
- **Ask:** selection → palette → /api/ask → answer in panel.
- **Act:** user intent → /api/plan → action preview → **Start Assist** → human‑mode execution.

**Acceptance Criteria:**
- Opens in ≤120ms after hotkey.
- Works with and without a selection (falls back to page TL;DR).
- Dismisses with Esc; remembers last query per page.

---

### 3.2 Context Capture & Bundler
**Inputs:** `title`, `url`, top 2–3 headings (+ up to 200 chars previews), user `selection` (≤1,000 chars), last 1–2 **Topic Cards**.

**Budget:** ≤2.5k input tokens (trim in order: oldest timeline → extra headings → selection tail).

**PII Handling:** client‑side masking (email, phone, SSN patterns) + server‑side re‑mask.

**Acceptance Criteria:**
- Never sends full DOM; shows preview in **What Was Sent** before/after call.
- Bundling completes in ≤50ms on typical pages.

---

### 3.3 Answers Panel & Session Timeline
**Panel:** Injected sidebar (Shadow DOM) or popup fallback. Shows answers, planned steps, and controls.

**Timeline:** Last 5 pages with: title, url, mini TL;DR, timestamp.

**Controls:** **Start Assist**, **Stop**, **Undo**, **Safe Mode**, per‑site toggle, **What Was Sent**, **Forget All**.

**Acceptance Criteria:**
- Sidebar loads without layout shift >0.1.
- Timeline persists during the session; cleared by Forget All.

---

### 3.4 Human Interaction Engine (no DOM mutation)
**Ops:** `scroll`, `focus`, `type`, `click`, `tab`, `wait(ms)`; **no** auto‑submit.

**Typing:** per‑char events with 15–40ms jitter; once per word apply native value setter to satisfy controlled inputs, then dispatch `input`/`change`.

**Clicking:** prefer clicking the `<label>` for inputs; otherwise click the input/button node; radios/checkboxes use native `click()`.

**Keyboard:** `Tab` to move focus; `Enter` only with `confirm:true`.

**Sensitive Fields:** password/payment: guide‑only (scroll+focus+tooltip); never type.

**Safety:** require **Start Assist**; time‑box each step (default 5s); abort on 2 consecutive failures.

**Acceptance Criteria:**
- React/Vue inputs update reliably; validators fire.
- No auto‑submit occurs without user confirmation.

---

### 3.5 Universal Element Resolver (site‑agnostic)
**Goal:** Map natural targets ("student id", "save") to elements on any page.

**Signals & Weights (initial):**
- Label/`for`/`aria-label` exact match **+3.0**; contains **+2.0**
- `name`/`placeholder` contains **+1.5**; `id`/`data-*` contains **+1.0**
- Role/type bias (button for save, input for id) **+0.8**
- Nearby text within 120px **+0.6**
- Visible & enabled **required**

**Confidence:** if score < 2.5 → request user tap to disambiguate.

**Edge Cases:** multiple matches, offscreen elements (auto scroll), hidden/disabled (pause with reason).

**Acceptance Criteria:**
- Resolves common targets on unfamiliar pages in ≤200ms.
- Disambiguation UI appears when needed and binds to the user’s click.

---

### 3.6 Planner → Action Plan JSON
**LLM Prompting:** Gemini JSON‑mode with strict schema; low temp for plans.

**Schema:**
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

**Execution:** Engine resolves each `find` to a selector, previews actions, and only proceeds after **Start Assist**.

**Acceptance Criteria:**
- Plans never include free‑form JS/HTML; only allowed acts.
- User can preview and cancel before any action.

---

### 3.7 Proactive Chip (non‑intrusive)
**When:** High confidence + allowed site + not in Safe Mode + not more than 1 suggestion per page per 3 minutes.

**Examples:** "Summarize this section?", "Fill visible fields?" (opens plan preview).

**Acceptance Criteria:**
- Chip never obscures critical UI; dismiss persists for that page for 24h.

---

### 3.8 Privacy Suite
**Per‑site Allow/Deny:** default allowlist off; user opts in per site.

**What Was Sent:** exact payload, masks, token counts, `model_used`, cache/fallback flags.

**Forget All:** clears IndexedDB memory/timeline/logs.

**Safe Mode:** disables proactive chips and automation; answers only.

**Acceptance Criteria:**
- Payload viewer matches server‑logged payload (hash id);
- Forget All completes in ≤200ms.

---

### 3.9 Cloudflare Worker API
**Endpoints:**
- `POST /api/ask` → answers (with `model_used`, `tokens_in/out`, `cached`).
- `POST /api/plan` → action plan (JSON acts only).
- `POST /api/summarize` → per‑URL TL;DR (KV‑cached by URL hash).

**Pipeline:** client PII mask → Worker PII re‑mask → KV cache → Gemini → fallback Workers AI on error.

**Errors:** 429 (rate limit), 413 (payload too large), 5xx (model/provider).

**Acceptance Criteria:**
- Keys never ship to client; origin checks enforced; per‑user rate limits active.

---

### 3.10 Performance & Cost
**Latency Targets:** P50 answer ≤1.5s; P90 ≤3.5s.

**Token Budget:** ≤2.5k input, ≤512 output; hard truncate with "partial" badge.

**Caching:** per‑URL summary TTL 60–300s; action plans not cached.

**Offline Fixtures:** mirrored HTML + canned responses for demo.

**Acceptance Criteria:**
- Cost meter shows today’s tokens; fallback badge visible when used.

---

### 3.11 Snowflake Topic Cards (opt‑in)
**Telemetry (minimal, hashed):** `user_hash`, `ts`, `url_hash`, `site_tag`, `op`, `tokens_in/out`, `pii_present`, `kept_local`.

**Cards:** derive recurring intents (e.g., CPT, Job Hunt) and surface 1–2 in context bundle.

**Acceptance Criteria:**
- Works entirely locally if Snowflake unavailable; shows "Cloud sync unavailable" badge.

---

### 3.12 Accessibility & UX
**Keyboard:** full navigation; Esc closes; focus rings visible.

**ARIA:** tooltips `role="tooltip"` + `aria-describedby`; landmarks for panel.

**Visuals:** high‑contrast, reduced motion toggle, minimal layout shift.

**Acceptance Criteria:**
- axe‑lite finds no critical issues on panel; tab order is logical.

---

### 3.13 Screenshots & Capture
**Goal:** Let users capture the current view or an entire page without site hacks.

**APIs & Permissions:** `tabs` + `activeTab` → `chrome.tabs.captureVisibleTab()` for visible area; optional stitched capture by scrolling viewport and composing images locally. (No capture on `chrome://` or restricted pages.)

**Modes:**
- **Visible Area Screenshot** (fast, default)
- **Full‑Page (Stitched)** (best‑effort; handles long pages; warns about dynamic content)

**Privacy:**
- Local‑only by default. If sharing, allow user to **redact** (blur boxes) before export.
- Never send screenshots to LLM unless the user explicitly opts in for vision features (stretch goal).

**Export:** PNG (default) or JPG; copy to clipboard or download; filename includes domain + timestamp.

**Acceptance Criteria:**
- Visible capture works on regular https pages in ≤300ms.
- Full‑page stitch aligns sections with ≤2px seam error on typical docs.

---

### 3.14 Chrome Actions (System Ops)
**Goal:** Offer common Chrome actions via natural language or palette without per‑site code.

**Supported (v1):**
- **Navigation:** open URL, new tab, close tab, switch tab (by index/title match), back, forward, reload.
- **Pages:** open **History** (`chrome://history`), **Downloads** (`chrome://downloads`), **Extensions** (`chrome://extensions`).
- **Settings:** open **Chrome Settings** with search prefilled: `chrome://settings/?search=<query>` (we do not inject into chrome://; we only navigate there).
- **Zoom:** set zoom (50–200%) via `chrome.tabs.setZoom`.
- **Find in Page (assist):** trigger browser Find (instruct Ctrl/⌘+F) or provide our own highlighter overlay when requested text exists.

**Safety:** never execute actions without confirmation; incognito windows only on explicit user ask and if extension is allowed in incognito.

**Acceptance Criteria:**
- Opening `chrome://settings/?search=javascript` places the term in Settings’ search box.
- Back/forward/reload/new/close work on the active tab with clear toasts.
- Zoom changes persist for the tab session and are reversible.

---

### 3.15 Universal Navigator / Spotlight (Open tabs + History + Settings)
**Goal:** A single, ultra‑fast launcher that understands natural language ("take me to the chess tab", "open cookie settings", "reopen last PDF").

**Data sources & permissions:**
- **Open tabs:** `chrome.tabs.query` (title, URL, favicon, lastActive time)
- **History:** `chrome.history.search` (last 14 days by default)
- **Recently closed:** `chrome.sessions.getRecentlyClosed`
- **Settings / chrome pages:** static list + search param deep‑link (no injection)
- *(Optional later: bookmarks via `bookmarks`)*

**Indexing:** maintain a local in‑memory index of open tabs; update on `onActivated`, `onUpdated`, `onRemoved`. Keep a rolling cache of last N history entries.

**Ranking:** hybrid scoring (fuzzy text + recency + frequency):
- Fuzzy match on title/URL (normalized) → base score
- + recency boost (open tabs > recently‑closed > history)
- + frequency boost (domains you visit often)
- + topic tag match (from Tab Intelligence)

**Intent parser:** lightweight rules for speed ("take me to", "switch to", "open settings", "reopen") → if ambiguous, call Gemini to produce a structured intent:
{"kind":"switch_tab","query":"chess","scope":"open|recent|history"}

**Execution:**
- `switch_tab` → activate best‑ranked open tab; tie → quick picker overlay.
- `reopen_tab` → restore from sessions; fallback → open top history result.
- `open_settings` → navigate `chrome://settings/?search=<term>` or known deep‑link.

**Acceptance Criteria:**
- Query "chess" switches to a tab with chess.com/lichess if open; otherwise offers top two recent candidates in ≤200ms.
- Query "open cookie settings" opens Settings with the search box focused and "cookies" typed.
- Query "reopen the UML diagram" opens the best match from recently‑closed or history within ≤400ms.

---

### 3.16 Tab Intelligence & Memory (for recall like “the chess tab”)
**Goal:** Make tab recall robust even when titles are generic.

**Per‑tab record:** `{tabId, url, title, favicon, domain, lastActiveAt, visitCount, topicTags[], miniTLDR?}`

**Topic tagging:** extract keywords from title + meta (if accessible) and from our own mini page TL;DR (≤240 chars) when the tab becomes active (never full DOM). Store locally.

**Usage:** Spotlight boosts matches when `query` overlaps `topicTags`.

**Acceptance Criteria:**
- Regular sites (mail, docs, chess) gain stable tags after first focus.
- Spotlight recall latency remains ≤200ms with 50+ open tabs.

---

### 3.17 History Reopen & Sessions
**Goal:** Let users say "open the tab from history about …" and get it back quickly.

**APIs:**
- `chrome.sessions.getRecentlyClosed({maxResults: 10})`
- `chrome.history.search({text, startTime, maxResults})`

**Strategy:** prefer sessions → then history (last 14 days) → else ask to widen the time range.

**Acceptance Criteria:**
- "Reopen the PDF Syllabus" restores a recently closed tab when available; if not, opens the top history match in ≤400ms.

---

### 3.18 Settings Deep‑Links
**Goal:** Natural language to precise settings.

**Default path:** `chrome://settings/?search=<query>`

**Known shortcuts (best‑effort; may vary by Chrome version):**
- **Cookies / Site data:** `chrome://settings/cookies` *or* search:"cookies"
- **Privacy & security:** `chrome://settings/privacy`
- **Passwords:** `chrome://settings/passwords`
- **Notifications:** `chrome://settings/content/notifications` *or* search:"notifications"
- **Extensions:** `chrome://extensions`

**Acceptance Criteria:**
- For common terms (cookies, passwords, notifications), either open the direct page or reliably prefill the Settings search.

---

### 3.19 Context Pre‑Warm (fast readiness after navigation)
**Goal:** When switching/opening a tab via Spotlight, have context and a mini summary ready.

**Mechanism:**
- On planned switch, queue `/api/summarize` for the destination URL (KV‑cached) and pre‑compute 1–2 topic tags.
- Upon activation, sidebar shows the cached TL;DR instantly.

**Acceptance Criteria:**
- After a Spotlight switch, the sidebar renders a TL;DR within ≤300ms for pages seen before, ≤800ms for new pages (network permitting).

---

### 3.20 Command Grammar & Examples
**Goal:** Natural phrases map to precise intents for tabs, settings, screenshots, and actions.

**Patterns (fast rules; Gemini only when ambiguous):**
- `take me to|switch to <thing>` → {"kind":"switch_tab","query":"<thing>","scope":"open|recent|history"}
- `reopen <thing>`/`open again <thing>` → {"kind":"reopen_tab","query":"<thing>"}
- `open settings|take me to settings [for|about] <term>` → {"kind":"open_settings","query":"<term>"}
- `screenshot [full page|visible]` → {"kind":"screenshot","mode":"full|visible"}
- `zoom to <percent>%` → {"kind":"zoom","value":<percent>}
- `go back|forward|reload` → {"kind":"nav","action":"back|forward|reload"}

**Examples:**
- "take me to the **chess** tab" → switch to open tab matching chess.com/lichess (or offer recent/history).
- "open settings for **cookies**" → `chrome://settings/?search=cookies`.
- "reopen the **CPT letter** page" → restore from sessions or open best history match.
- "screenshot **full page**" → stitched capture; else visible area.
- "zoom to **125%**" → `chrome.tabs.setZoom(1.25)`.

**Acceptance Criteria:**
- Common phrasings resolve without calling the LLM; ambiguous cases fall back to Gemini intent JSON.
- Intent preview is shown before execution; user confirms with Enter/Click.

---

### 3.21 MV3 Permissions & APIs
**Required permissions:**
- `activeTab`, `scripting`, `tabs`, `storage`, `commands`
- `history`, `sessions` (for Spotlight recall)
- Optional: `downloads` (export screenshots), `clipboardWrite` (copy images/text)
- **Host permissions:** `<all_urls>`

**APIs by feature:**
- **Screenshots:** `chrome.tabs.captureVisibleTab()` (visible area), optional stitched capture via scripted scrolling in content script.
- **Spotlight (open tabs):** `chrome.tabs.query`, `chrome.tabs.update`, `chrome.tabs.highlight`.
- **History/Recently closed:** `chrome.history.search`, `chrome.sessions.getRecentlyClosed`, `chrome.sessions.restore`.
- **Settings/Chrome pages:** navigate with `chrome.tabs.update({url: 'chrome://…'})` (no injection allowed on `chrome://`).
- **Zoom:** `chrome.tabs.setZoom`, `chrome.tabs.getZoom`.
- **Hotkeys:** `commands` for ⌘/Ctrl+Shift+Space.
- **Storage:** `chrome.storage.local` (prefs, topic tags), IndexedDB (timeline/cache).

**Acceptance Criteria:**
- Manifest builds without warnings; permissions align with used APIs; blocks on `chrome://` injection are respected.

---

### 3.22 Security Constraints & Guardrails
**Hard rules:**
- No interaction with password or payment fields (guide-only).
- Never auto-submit forms; destructive clicks require `confirm:true`.
- No code injection or DOM mutation on `chrome://`, extension pages, or restricted origins.
- Keys never stored client-side; all LLM calls go through Cloudflare Worker.
- Local-first by default; Snowflake telemetry is opt-in and contains no raw content.
- Per-site allow/deny and **Safe Mode** must be honored by all features (automation off).

**Monitoring:**
- “What Was Sent” log must match Worker-side hash IDs; local logs auto-purge after 24h.

**Acceptance Criteria:**
- Attempted violations are blocked with a clear toast and logged locally (without sensitive data).

---

## 4) Failure → Fallback Matrix
| Failure | Detect | Fallback |
|---|---|---|
| Overlays blocked by CSP | injection error | Sidebar‑only steps; banner notice |
| Model outage/quota | API timeout/error | Workers AI fallback → local TL;DR |
| Token overrun | bundler exceeds cap | Send selection + title only; "partial" badge |
| Resolver low confidence | score < threshold | Ask user to click target once |
| Synthetic events rejected | no input change | Switch to instruction mode (numbered steps) |
| Network down | fetch fails | Offline fixtures; cached summaries |
| Full‑page stitch fails | scroll capture mismatch | Fall back to visible‑area screenshot |
| chrome:// restrictions | capture blocked or injection blocked | Navigate only; inform user that injection is not allowed |

---

## 5) Settings (defaults)
- Allow on this site: **off** (user opt‑in)
- Safe Mode: **off**
- Proactive chips: **on** (per‑site capped)
- Token cap/day: **10k**
- Cache TTL: **180s**
- Logs retention: **24h** (local only)
- Screenshot redaction: **on** (prompt before share)
- Spotlight sources: **open tabs + sessions + history (14 days)**

---

## 6) Sponsor Mapping
- **Gemini:** /ask (answers), /plan (action JSON), /summarize (TL;DR). JSON‑mode with schema.
- **Cloudflare:** Worker proxy, PII redaction, KV cache, Workers AI fallback, Pages hosting for landing at GoDaddy domain.
- **Snowflake (opt‑in):** hashed telemetry → Topic Cards.
- **GoDaddy:** brand domain + landing + privacy docs.

---

## 7) Roadmap
- **v1.1:** Vision assist for canvas/bitmap UIs (optional OCR), smarter plan repair, richer Topic Cards.
-- **v2:** Electron browser shell (tabs, omnibox, internal pages), account/sync (encrypted), adapter marketplace.


---

## 8) Deferred (AI‑Heavy) — TODO After Hackathon
> These items rely primarily on LLM/vision intelligence. We’ll ship the non‑AI baseline in v1 and tackle these next.

- [ ] **AI Q&A (/api/ask)** — rich answers/citations beyond heuristic TL;DR. (Related: §3.1, §3.9)
- [ ] **AI Planner (/api/plan)** — generate multi‑step action plans; add repair/branching & retries. (Related: §3.6, §3.4)
- [ ] **AI Summaries (/api/summarize)** — high‑quality per‑URL TL;DRs + **Context Pre‑Warm**. (Related: §3.2, §3.19)
- [ ] **Proactive Chip via LLM signals** — detect opportunities (“Fill these fields?”, “Summarize?”) using model‑scored confidence. (Related: §3.7)
- [ ] **Topic Cards (LLM‑enriched)** — classify recurring intents (CPT, Job Hunt) and synthesize 1‑liners. (Related: §3.11)
- [ ] **Tab Intelligence (LLM tags)** — derive `topicTags` from mini summaries for better Spotlight recall. (Related: §3.16, §3.15)
- [ ] **Ambiguity resolver with LLM** — when Spotlight intent is unclear, call Gemini to emit structured intent JSON. (Related: §3.20)
- [ ] **AI‑assisted Element Resolver** — backstop the heuristic resolver with label/near‑text embeddings or vision.
- [ ] **Vision/OCR assist** — handle canvas/bitmap UIs by screenshot + OCR/vision model for element finding. (Stretch from §7 Roadmap v1.1)
- [ ] **Model routing & cost governor** — pick Gemini vs Workers AI by task/size; enforce per‑user token budgets. (Related: §3.10)
- [ ] **Personalization** — few‑shot style prefs (tone/level), kept local; optional server hints without raw content.
- [ ] **On‑device mini model (offline)** — WASM/transformers.js TL;DR fallback for airplane mode demos.