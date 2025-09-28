# Nebula Implementation Plan
*Date: 27 Sep 2025 · Target: Chrome Extension (MV3) + Landing Page*

## Project Analysis

### Current State
- **Repository**: Contains a Next.js SaaS boilerplate with authentication, payments, and dashboard
- **Documentation**: Describes "Naros" - a Chrome Extension AI copilot for browser automation
- **Mismatch**: The codebase and documentation describe completely different projects

### Decision: Hybrid Implementation Strategy
Since we have existing Next.js infrastructure and need a Chrome extension, we'll implement both:
1. **Chrome Extension** (primary product) - as described in Architecture.md and Features.md
2. **Landing Page** (secondary) - leverage existing Next.js boilerplate for marketing site

---

## Implementation Strategy

### Phase 1: Extension Core (Priority 1 - Hackathon MVP)
Can be worked in **parallel** by 2 developers:

#### Team Member A: Extension Foundation
1. **Extension Manifest & Structure** (2-3 hours)
2. **Service Worker (Background)** (3-4 hours)
3. **Content Script & UI** (4-5 hours)
4. **Local Storage & IndexedDB** (2 hours)

#### Team Member B: Backend & AI Integration
1. **Cloudflare Worker API** (3-4 hours)
2. **Gemini Integration** (2-3 hours)
3. **Universal Element Resolver** (4-5 hours)
4. **Human Interaction Engine** (3-4 hours)

### Phase 2: Core Features Integration (Priority 2)
After Phase 1, integrate components:
- Command Palette & Context Bundler
- Spotlight/Universal Navigator
- Privacy & Security Features

### Additional MVP Essentials (Do before Phase 2 finishes)
These are small but critical polish items judges expect.

- **Onboarding & Permissions**
  - Welcome screen (what Nebula does, privacy stance, Safe Mode toggle)
  - Staged permission requests: start with `activeTab,tabs,storage,commands`; ask for `history,sessions` only when user enables Spotlight recall
  - Link to `chrome://extensions/shortcuts` to customize the hotkey
  - Clear "Enable in Incognito" guidance (optional; off by default)

- **Settings Panel (basic)**
  - Per‑site allow/deny, Safe Mode, proactive chips on/off, screenshot redaction on/off
  - Token cap/day and cache TTL selectors
  - Reset to defaults; Export/Import settings (JSON)

- **Health & Error Toasters**
  - Badges: cache hit, fallback model, nearing token cap, offline mode
  - Friendly toasts for: chrome:// injection blocked, screenshot blocked, low resolver confidence ("tap element"), denied permissions

- **Undo Navigation**
  - After Spotlight switch/open, show one-click "Back to where I was" (tab + scroll)

---

### Phase 2.5: Remaining Feature Gaps (post-MVP polish)

- **Planner Execution Loop**
  - Trigger `/api/plan` after successful Q&A when the user wants automation
  - Surface returned steps in the sidebar with a **Start Assist** button
  - Pipe plans to the content script using `EXECUTE_ACTION_PLAN` and track per-step status

- **Summaries & Context Pre-Warm**
  - Call `/api/summarize` for active tabs and Spotlight switches
  - Store TL;DRs in `NebulaStorage` and render them in the timeline/Answers panel
  - Prefetch summaries during tab switches to meet the <800 ms readiness target

- **Privacy Inspector**
  - Build the "What Was Sent" view backed by `NebulaStorage` logs
  - Show payload hashes, token counts, cache/fallback badges, and Forget All actions

- **Proactive Chip & Health Badges**
  - Implement the high-confidence suggestion chip with Safe Mode and per-site caps
  - Add badges/toasts for offline mode, cache hits, fallback model, and permission denials

- **Token Budget Enforcement**
  - Enforce `tokenCapPerDay` and `cacheTTL` settings inside the worker/background
  - Display usage meter and friendly warnings as limits approach

- **Screenshot Enhancements**
  - Add stitched full-page capture and optional redaction tools before export
  - Provide copy-to-clipboard/download flows with filenames per spec

- **Snowflake Telemetry (Opt-In)**
  - Capture hashed usage events when the user opts in and surface topic cards locally

- **Accessibility & UX Polish**
  - Ensure high-contrast/reduced-motion toggles, ARIA roles, focus traps, and keyboard-only flows across palette/sidebar

- **Landing Page Alignment**
  - Replace the boilerplate Next.js marketing site with Nebula-specific copy, privacy policy, and install instructions

- **Testing & Automation**
  - Add unit/integration tests for resolver, bundler, worker endpoints, and action execution
  - Set up lint/test scripts (CI optional) to guard future changes

---

## Detailed Work Breakdown

### A1: Extension Manifest & Structure (2-3 hours)
**Files to create:**
```
/extension/
  manifest.json                 # MV3 manifest
  /src/
    background.ts              # Service worker
    content.ts                 # Content script
    /ui/
      sidebar/App.tsx          # React sidebar
      popup/App.tsx            # Popup UI
    /lib/
      storage.ts               # IndexedDB wrapper
      messaging.ts             # Runtime messaging
  /public/
    icons/                     # Extension icons
```

**Tasks:**
- [ ] Create MV3 manifest.json with required permissions
- [ ] Set up TypeScript + React build pipeline (Vite)
- [ ] Create basic extension structure
- [ ] Test extension loading in Chrome

**Permissions needed:**
```json
{
  "permissions": ["activeTab", "scripting", "tabs", "storage", "commands", "history", "sessions"],
  "host_permissions": ["<all_urls>"],
  "optional_permissions": ["downloads", "clipboardWrite"]
}
```

### A2: Service Worker (Background) (3-4 hours)
**Core responsibilities:**
- Spotlight engine (tab indexing, ranking)
- Context bundler (prepare API payloads)
- Message routing between content scripts and UI
- API calls to Cloudflare Worker

**Key components:**
- [ ] Tab indexing system (chrome.tabs API)
- [ ] History/sessions integration
- [ ] Intent parser for Spotlight commands
- [ ] Rate limiting and token budgets
- [ ] Context bundling logic

### A3: Content Script & UI (4-5 hours)
**Shadow DOM UI:**
- [ ] Sidebar injection system
- [ ] Command palette overlay
- [ ] Settings panel
- [ ] CSP/iframe fallback detection

**React Components:**
- [ ] Command Palette (⌘/Ctrl+Shift+Space trigger)
- [ ] Answers Panel with tabs (Answers, Steps, Spotlight, Logs, Settings)
- [ ] Session Timeline (last 5 pages)
- [ ] Privacy controls (What Was Sent inspector)

### A4: Local Storage & IndexedDB (2 hours)
**Data structures:**
- [ ] Timeline: `{url, title, tldr, ts}` (max 5)
- [ ] Topic Tags: `{urlHash: string, tags: string[]}`
- [ ] Cache: `{urlHash, tldr, cachedAt}`
- [ ] Settings: Safe Mode, per-site allow/deny

**Storage wrapper:**
- [ ] IndexedDB abstraction layer
- [ ] Chrome storage sync for settings
- [ ] Data expiration/cleanup (24h retention)

### B1: Cloudflare Worker API (3-4 hours)
**Endpoints to implement:**
```typescript
POST /api/ask        // Q&A responses
POST /api/plan       // Action plan JSON
POST /api/summarize  // Page TL;DR (KV cached)
```

**Pipeline features:**
- [ ] PII redaction (server-side double-check)
- [ ] KV caching for summaries
- [ ] Gemini primary + Workers AI fallback
- [ ] Rate limiting per user
- [ ] Structured error responses

**Environment setup:**
- [ ] Cloudflare account + domain
- [ ] Gemini API keys
- [ ] KV namespace configuration

### B2: Gemini Integration (2-3 hours)
**API integrations:**
- [ ] Q&A with context (temperature: 0.3)
- [ ] Action plan generation (JSON mode, temperature: 0.1)
- [ ] Page summarization (temperature: 0.2)
- [ ] Intent parsing for ambiguous Spotlight queries

**Prompt engineering:**
- [ ] System prompts for each endpoint
- [ ] JSON schema validation for action plans
- [ ] Token counting and budget enforcement
- [ ] Fallback prompts for Workers AI

### B3: Universal Element Resolver (4-5 hours)
**Scoring algorithm:**
```typescript
interface ScoringWeights {
  labelExact: 3.0      // Label/for/aria-label exact match
  labelContains: 2.0   // Label contains target
  nameContains: 1.5    // name/placeholder contains
  idContains: 1.0      // id/data-* contains
  roleBias: 0.8        // Button for "save", input for "id"
  nearbyText: 0.6      // Text within 120px
}
```

**Implementation:**
- [ ] Element scoring system with configurable weights
- [ ] Visibility and interaction checks
- [ ] Confidence thresholding (score < 2.5 = user disambiguation)
- [ ] Disambiguation UI overlay
- [ ] Performance optimization (≤200ms resolution)

### B4: Human Interaction Engine (3-4 hours)
**Actions to implement:**
```typescript
type ActionPlan = Array<{
  act: 'find' | 'scroll' | 'focus' | 'type' | 'click' | 'tab' | 'wait'
  target?: string
  text?: string
  to?: 'center' | 'top' | 'bottom'
  perChar?: boolean
  confirm?: boolean
}>
```

**Safety features:**
- [ ] Require "Start Assist" before execution
- [ ] Password/payment field detection (guide-only)
- [ ] 5-second timeout per step
- [ ] Undo functionality
- [ ] Never auto-submit forms

**Event simulation:**
- [ ] Natural typing with jitter (15-40ms)
- [ ] React/Vue compatible input events
- [ ] Scroll-to-element with smooth behavior
- [ ] Click coordination (prefer labels for inputs)

---

## Phase 2: Feature Integration (8-10 hours total)

### Command Palette & Context Bundler (3 hours)
- [ ] Global hotkey registration (⌘/Ctrl+Shift+Space)
- [ ] Context extraction (title, headings, selection)
- [ ] PII masking client-side
- [ ] Token budget enforcement (≤2.5k input)
- [ ] Payload preview in "What Was Sent"

### Spotlight/Universal Navigator (3 hours)
- [ ] Intent parser grammar (fast local rules)
- [ ] Tab switching with window raising
- [ ] History search and reopen
- [ ] Settings deep-linking
- [ ] Fuzzy matching with recency/frequency boosts

### Privacy & Security (2 hours)
- [ ] Per-site allow/deny lists
- [ ] Safe Mode (answers only, no automation)
- [ ] "Forget All" implementation
- [ ] Payload logging with hash IDs
- [ ] CSP/iframe constraint detection

### Performance & Resilience (2 hours)
- [ ] Latency budgets (P50 ≤1.5s, P90 ≤3.5s)
- [ ] Offline fixtures for demo
- [ ] Graceful fallbacks for failures
- [ ] Background task cancellation on navigation

---

## Testing & QA Matrix (fit for hackathon)

| Area | What we test | How | Pass criteria |
|---|---|---|---|
| Spotlight switch | "take me to the chess tab" | 3 tabs incl. chess.com; run via palette | Switches in ≤150ms; correct window raised |
| Reopen from history | "reopen CPT letter" | Close a known tab; use history/sessions | Restores from sessions or opens top history in ≤400ms |
| Settings deep‑link | "open settings for cookies" | From any page | Navigates to `chrome://settings/?search=cookies` |
| Human typing | Fill a generic form | Type per‑char; React controlled input | Field updates; no auto‑submit; validators fire |
| Payload privacy | What Was Sent panel | Compare to Worker hash id | Exact match; PII placeholders visible |
| CSP fallback | Page with strict CSP | Inject sidebar overlay | Sidebar‑only guidance shows with banner |
| Offline fixtures | Simulate Worker down | Toggle fixture mode | TL;DR loads from local fixture |

---

## Phase 3: Landing Page (Optional - 4-6 hours)

### Leverage Existing Next.js Boilerplate
The current codebase has excellent infrastructure we can repurpose:

**Keep & Modify:**
- [ ] Landing page design (modify for Naros branding)
- [ ] Authentication system (for future user accounts)
- [ ] Tailwind + Shadcn UI components
- [ ] Deploy pipeline to Vercel/Cloudflare Pages

**Remove/Replace:**
- [ ] Dashboard components (not needed for extension)
- [ ] Stripe integration (extension is free)
- [ ] Multi-tenancy features

**Add for Extension:**
- [ ] Extension download/install flow
- [ ] Privacy policy specific to extension
- [ ] Documentation and feature showcase
- [ ] Chrome Web Store integration

---

## Technology Stack Summary

### Chrome Extension
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Build**: Vite (fast HMR for development)
- **Storage**: IndexedDB + chrome.storage APIs
- **UI**: Shadow DOM + Radix UI components

### Backend API
- **Platform**: Cloudflare Workers (edge computing)
- **Cache**: Cloudflare KV (global distribution)
- **AI**: Google Gemini (primary) + Workers AI (fallback)
- **Security**: Origin validation, rate limiting

### Landing Page (Optional)
- **Framework**: Next.js 14 (existing codebase)
- **Styling**: Tailwind CSS + Shadcn UI
- **Deploy**: Cloudflare Pages + GoDaddy domain
- **Analytics**: Optional Snowflake integration

---

## Parallel Work Strategy

### Day 1 (Hackathon Start - 12 hours)
**Team Member A** (Extension Frontend):
- Hours 1-3: Extension structure + manifest
- Hours 4-7: Service worker + messaging
- Hours 8-12: Content script + React UI

**Team Member B** (Backend + AI):
- Hours 1-4: Cloudflare Worker setup + endpoints
- Hours 5-7: Gemini integration + prompts
- Hours 8-12: Element resolver + interaction engine

### Day 2 (Integration - 12 hours)
**Both team members**:
- Hours 1-6: Integration testing + bug fixes
- Hours 7-9: Core features (Command Palette, Spotlight)
- Hours 10-12: Polish + demo preparation

### Deployment Strategy
1. **Extension**: Manual loading for development, Chrome Web Store for production
2. **Worker**: Deploy to Cloudflare with environment secrets
3. **Landing**: Deploy to Cloudflare Pages with GoDaddy domain

---

## Risk Mitigation

### Technical Risks
1. **CSP blocks overlays** → Sidebar-only fallback mode
2. **MV3 service worker lifecycle** → Event-driven architecture only
3. **Synthetic event rejection** → Instruction mode fallback
4. **Model API outages** → Local heuristics + Workers AI fallback

### Scope Risks
1. **Over-engineering** → Focus on MVP features only
2. **Time constraints** → Pre-built component library (Radix UI)
3. **Demo environment** → Offline fixtures for network issues

### Success Metrics (MVP)
- [ ] Extension loads and injects on any website
- [ ] Command palette opens with hotkey
- [ ] Basic Q&A works with Gemini
- [ ] Simple automation (find field, type, click) works
- [ ] Spotlight can switch between open tabs

---

## Deliverables Checklist

### Core Extension (Required for Hackathon)
- [ ] Chrome Extension (MV3) with working manifest
- [ ] Command Palette with ⌘/Ctrl+Shift+Space hotkey
- [ ] Basic AI Q&A via Cloudflare Worker + Gemini
- [ ] Element resolver + simple automation
- [ ] Tab switching via Spotlight

### Advanced Features (Stretch Goals)
- [ ] Full action plan execution
- [ ] Screenshot capture with redaction
- [ ] History/session management
- [ ] Privacy controls and settings

### Supporting Infrastructure
- [ ] Cloudflare Worker deployed with API endpoints
- [ ] Landing page (optional)
- [ ] Demo video and documentation

---

## Development Commands

### Extension Development
```bash
cd extension
npm install
npm run dev          # Development build with HMR
npm run build        # Production build
npm run package      # Create ZIP for Chrome Web Store
```

### Worker Development
```bash
cd worker
npm install
npx wrangler dev     # Local development
npx wrangler deploy  # Deploy to Cloudflare
```

### Landing Page (Optional)
```bash
# Use existing Next.js commands
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
```

This implementation plan provides a clear path to build Naros as a Chrome Extension while optionally leveraging the existing Next.js infrastructure for a marketing landing page. The parallel work strategy maximizes the 24-hour hackathon timeframe.

---

## Sponsor Track Alignment & Bonus Points

### Gemini Track Requirements
- [ ] **Core Integration**: Use Gemini API for Q&A, action planning, and summarization
- [ ] **Advanced Features**: JSON-mode prompting, multi-turn context, temperature tuning per use case
- [ ] **Innovation Points**: Site-agnostic element resolution using natural language, privacy-first AI interaction

### Cloudflare Track Requirements
- [ ] **Workers**: API proxy with PII redaction, rate limiting, model fallback
- [ ] **KV Storage**: Intelligent caching for summaries and user preferences
- [ ] **Pages**: Landing page deployment with custom domain
- [ ] **Innovation Points**: Edge computing for privacy, global latency optimization

### Snowflake Track (Optional Bonus)
- [ ] **Analytics**: Opt-in telemetry with privacy-preserving data aggregation
- [ ] **Topic Cards**: ML-driven intent classification from usage patterns
- [ ] **Innovation Points**: Zero-PII analytics, local-first with cloud insights

### GoDaddy Track
- [ ] **Custom Domain**: Professional branding for landing page
- [ ] **SSL/Security**: Proper domain setup with security headers
- [ ] **Innovation Points**: Extension-to-web integration, professional polish

## Submission & Demo Checklist (Sunhacks)
- [ ] **Devpost Early**: Project created with sponsor tags, compelling description
- [ ] **90-sec Video**: Spotlight → settings deep-link → form assist → privacy inspector
- [ ] **README**: Architecture diagram, sponsor usage examples, privacy guarantees
- [ ] **Live Demo Script**: 3-min demo + 2-min Q&A, offline fixtures ready
- [ ] **Sponsor Mentions**: Clear callouts of how each sponsor tech is used innovatively

## Structured Error Codes (client ↔ worker)
```json
{ "code":"RATE_LIMIT", "http":429, "retry_after_ms":30000, "message":"Daily token cap reached" }
```
- Map to user messages and toasts; always include `req_id` for logs

## Manifest & CSP Notes
- MV3 `permissions`: `activeTab`, `scripting`, `tabs`, `storage`, `commands`, `history`, `sessions`; optional `downloads`, `clipboardWrite`
- Host permissions: `<all_urls>`; enforce **no injection** on `chrome://` and restricted origins
- Extension pages CSP: avoid `unsafe-inline`; React builds with hashed assets

## Critical Success Metrics (Judge Evaluation)

### Technical Excellence (30%)
- [ ] **Extension loads reliably** across different websites
- [ ] **Performance**: Command palette <120ms, API responses <2s P90
- [ ] **Error handling**: Graceful fallbacks, clear user feedback
- [ ] **Security**: No XSS, proper CSP, PII protection demonstrated

### Innovation & Problem Solving (25%)
- [ ] **Site-agnostic automation** (works on any website without hardcoding)
- [ ] **Privacy-first AI** (local context bundling, transparent logging)
- [ ] **Universal element resolution** (natural language → UI elements)
- [ ] **Graceful degradation** (CSP blocks → instruction mode)

### User Experience (25%)
- [ ] **Intuitive UX**: One hotkey, clear visual feedback, logical flow
- [ ] **Onboarding**: User understands privacy model and core features
- [ ] **Accessibility**: Keyboard navigation, screen reader compatible
- [ ] **Polish**: Smooth animations, consistent design, error states

### Business Viability (20%)
- [ ] **Clear value prop**: Saves time, works everywhere, protects privacy
- [ ] **Scalable architecture**: Edge computing, efficient caching
- [ ] **Monetization path**: Premium features, enterprise deployment
- [ ] **Market fit**: Browser automation is a real pain point

## Potential Failure Modes & Contingencies

### High-Risk Issues
1. **MV3 Service Worker Lifecycle**
   - Risk: Worker terminates unexpectedly, losing state
   - Mitigation: Event-driven only, persist critical state to chrome.storage

2. **CSP/Content Security Policy Blocks**
   - Risk: Major sites block our overlays
   - Mitigation: Sidebar-only mode + instruction fallback

3. **Gemini API Quota/Costs**
   - Risk: High usage costs, rate limits during demo
   - Mitigation: Aggressive caching, Workers AI fallback, demo fixtures

4. **Element Resolution Accuracy**
   - Risk: Can't find elements reliably on diverse sites
   - Mitigation: User disambiguation UI, confidence thresholds

### Demo Day Contingencies
- [ ] **Offline fixtures**: Pre-recorded API responses for network issues
- [ ] **Multiple test sites**: Don't rely on one demo site staying the same
- [ ] **Backup video**: Screen recording in case live demo fails
- [ ] **Judge-friendly sites**: Test on sites judges likely use (Gmail, LinkedIn, etc.)

## Post‑MVP Spotlight++ Backlog (later)
- Bookmarks & Reading List providers; batch tab ops; tab groups & workspaces
- Audio tab controls (mute/switch); peek previews; omnibox keyword `nebula`
- Find‑across‑open‑tabs (local); optional local embeddings for better recall
- Provider SDK for custom sources (Jira, GitHub) running locally or via Worker proxy
