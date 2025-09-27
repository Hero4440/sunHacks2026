# Nebula Tech Stack
*Chrome Extension AI Copilot - Optimized for 24h Hackathon Development*

## Core Architecture Decision

### Hybrid Approach: Extension + Landing Page
- **Primary Product**: Chrome Extension (MV3) - the core AI copilot
- **Secondary**: Next.js Landing Page - leverages existing boilerplate for marketing

## 🏗 Service Architecture Overview

### Frontend Services (Client-Side)
1. **Chrome Extension UI** - React components in Shadow DOM
2. **Content Scripts** - Page interaction and element detection
3. **Service Worker** - Background coordination and API communication
4. **Landing Page** (Optional) - Next.js marketing site

### Backend Services (Server-Side)
1. **Cloudflare Worker API** - Edge computing proxy for AI models
2. **Gemini API Integration** - Google's AI for natural language processing
3. **Cloudflare KV Cache** - Global distributed caching layer
4. **Snowflake Analytics** (Optional) - Privacy-preserving telemetry

### Data Flow Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Edge Layer    │    │   AI Services   │
│                 │    │                 │    │                 │
│ Chrome Extension│───▶│Cloudflare Worker│───▶│ Gemini API      │
│ - UI Components │    │ - PII Redaction │    │ - Q&A           │
│ - Content Script│    │ - Rate Limiting │    │ - Action Plans  │
│ - Service Worker│    │ - KV Caching    │    │ - Summarization │
│                 │    │ - Error Handling│    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         │              │ Fallback Layer  │              │
         └──────────────│Workers AI Model │──────────────┘
                        │ (Local Edge AI) │
                        └─────────────────┘
```

## 📍 Detailed Service Breakdown

### 🖥️ FRONTEND (Client-Side) - What Runs in the Browser

#### 1. Chrome Extension UI (React + Shadow DOM)
**Location**: User's Chrome browser
**Purpose**: All user-facing interfaces
**Components**:
- **Command Palette** - Global hotkey (⌘/Ctrl+Shift+Space) overlay
- **Sidebar Panel** - Q&A responses, action plan preview, settings
- **Popup Window** - Quick access when clicking extension icon
- **Tooltip Overlays** - Element highlighting and disambiguation
- **Settings Interface** - Privacy controls, per-site permissions

**Technologies**: React 18, Radix UI, Tailwind CSS, Shadow DOM
**Storage**: IndexedDB for timeline, chrome.storage for settings

#### 2. Content Scripts (Page Interaction)
**Location**: Injected into every web page
**Purpose**: Interact with page elements like a human
**Responsibilities**:
- **Element Detection** - Find inputs, buttons using natural language
- **Human Simulation** - Type, click, scroll with realistic timing
- **Context Extraction** - Capture page title, headings, selected text
- **Privacy Protection** - PII masking before sending to backend
- **Error Handling** - Graceful fallbacks when actions fail

**Technologies**: TypeScript, Chrome APIs, DOM manipulation

#### 3. Service Worker (Background Coordination)
**Location**: Chrome extension background (MV3)
**Purpose**: Coordinate between UI and backend, manage state
**Responsibilities**:
- **Spotlight Search** - Index open tabs, history, settings
- **API Communication** - Route requests to Cloudflare Worker
- **Context Bundling** - Prepare AI-ready payloads (≤2.5k tokens)
- **Rate Limiting** - Enforce user token budgets
- **Tab Management** - Switch tabs, reopen from history
- **Message Routing** - Connect content scripts with UI

**Technologies**: TypeScript, Chrome APIs, Event-driven architecture

#### 4. Landing Page (Optional Marketing)
**Location**: Static hosting (Cloudflare Pages)
**Purpose**: Marketing, documentation, Chrome Web Store funnel
**Content**:
- **Feature Showcase** - Interactive demos, screenshots
- **Privacy Policy** - Transparent data handling explanation
- **Installation Guide** - Direct Chrome Web Store integration
- **Documentation** - Usage examples, keyboard shortcuts

**Technologies**: Next.js 14, React 18, Tailwind CSS, Static generation

---

### ☁️ BACKEND (Server-Side) - What Runs in the Cloud

#### 1. Cloudflare Worker API (Edge Proxy)
**Location**: Cloudflare global edge network (190+ cities)
**Purpose**: Privacy-first AI proxy with intelligent caching
**Endpoints**:
```typescript
POST / api / ask; // Q&A with context
POST / api / plan; // Generate action steps
POST / api / summarize; // Page TL;DR with caching
GET / api / health; // Service status
```

**Responsibilities**:
- **PII Redaction** - Server-side double-check for sensitive data
- **Model Routing** - Gemini primary → Workers AI fallback
- **Rate Limiting** - Per-user quotas and abuse prevention
- **Response Caching** - KV storage for expensive operations
- **Error Handling** - Structured error codes with retry logic
- **Logging** - Performance metrics without sensitive data

**Technologies**: Cloudflare Workers, Hono framework, TypeScript

#### 2. Google Gemini API Integration
**Location**: Google Cloud (called via Cloudflare Worker)
**Purpose**: Advanced AI capabilities for natural language processing
**Use Cases**:
- **Q&A Responses** - Answer questions about page content (temp: 0.3)
- **Action Planning** - Convert intents to step-by-step JSON (temp: 0.1)
- **Page Summarization** - Generate concise TL;DR (temp: 0.2)
- **Intent Parsing** - Understand ambiguous Spotlight queries (temp: 0.1)

**Features**:
- **JSON Mode** - Structured responses for action plans
- **Function Calling** - Tool use for web interactions
- **Context Window** - Large context for rich page understanding
- **Safety Filters** - Built-in content safety

#### 3. Cloudflare KV Cache (Global Storage)
**Location**: Cloudflare global edge network
**Purpose**: Intelligent caching for performance and cost optimization
**Cached Data**:
- **Page Summaries** - URL-based caching (TTL: 60-300s)
- **User Preferences** - Settings sync across devices
- **API Responses** - Common queries to reduce AI costs
- **Error Patterns** - Known failures to prevent retries

**Benefits**:
- **Global Distribution** - Sub-100ms cache hits worldwide
- **Cost Reduction** - 70%+ cache hit rate saves AI API costs
- **Performance** - Instant responses for cached content
- **Resilience** - Fallback content when AI services are down

#### 4. Workers AI (Fallback Model)
**Location**: Cloudflare edge workers
**Purpose**: Local AI inference when Gemini is unavailable
**Capabilities**:
- **Text Generation** - Basic Q&A and summarization
- **Embedding Generation** - Semantic search for elements
- **Translation** - Multi-language support
- **Code Analysis** - Understanding page structure

**Advantages**:
- **Zero Cold Start** - Always ready at the edge
- **Cost Effective** - Flat pricing, no per-token charges
- **Privacy** - Data never leaves Cloudflare network
- **Reliability** - 99.9% uptime guarantee

#### 5. Snowflake Analytics (Optional Telemetry)
**Location**: Snowflake cloud data warehouse
**Purpose**: Privacy-preserving usage analytics and ML insights
**Data Collected** (Opt-in only):
```sql
CREATE TABLE nebula_events (
  user_hash VARCHAR(64),     -- Hashed user ID (no PII)
  timestamp TIMESTAMP,
  url_hash VARCHAR(64),      -- Hashed URL (no actual URLs)
  site_category VARCHAR(50), -- Domain category (news, social, etc.)
  operation VARCHAR(20),     -- ask, plan, summarize, spotlight
  tokens_used INT,
  model_used VARCHAR(20),
  success BOOLEAN,
  error_code VARCHAR(20)
);
```

**Insights Generated**:
- **Topic Cards** - Recurring user intents (Job Hunt, Research, etc.)
- **Performance Optimization** - Slow queries and common failures
- **Feature Usage** - Most/least used capabilities
- **Cost Analysis** - Token usage patterns and optimization opportunities

---

## 🔄 Inter-Service Communication

### Frontend → Backend Flow
1. **User Action** - Hotkey pressed or element clicked
2. **Context Bundling** - Service worker extracts relevant page data
3. **PII Masking** - Client-side redaction of sensitive information
4. **API Request** - HTTPS call to Cloudflare Worker with context
5. **Response Handling** - Display results in extension UI
6. **Error Recovery** - Fallback to offline fixtures or simplified responses

### Backend Processing Pipeline
1. **Request Validation** - Origin check, rate limiting, payload size
2. **PII Re-masking** - Server-side double-check for missed sensitive data
3. **Cache Lookup** - Check KV storage for existing responses
4. **AI Processing** - Route to Gemini or Workers AI based on load
5. **Response Caching** - Store results in KV for future requests
6. **Structured Response** - JSON with metadata (tokens, model, cache status)

### Error Handling & Fallbacks
```typescript
// Graceful degradation strategy
if (geminiDown) {
  response = await workersAI(prompt);
} else if (networkDown) {
  response = await offlineFixtures.get(requestType);
} else if (quotaExceeded) {
  response = { error: 'RATE_LIMIT', retryAfter: 3600 };
}
```

---

## 🎯 Chrome Extension Stack (Primary)

### Frontend Framework
- **React 18.3** - Component-based UI development
- **TypeScript 5.6** - Type safety and better DX
- **Vite** - Fast build tool with HMR for extension development
- **Shadow DOM** - Isolated UI rendering to avoid site CSS conflicts

### UI Component Library
- **Radix UI Primitives** (already in package.json)
  - `@radix-ui/react-dropdown-menu` - Command palette dropdowns
  - `@radix-ui/react-tooltip` - Help tooltips and element highlights
  - `@radix-ui/react-accordion` - Settings panels
  - `@radix-ui/react-separator` - Visual hierarchy
  - `@radix-ui/react-label` - Form accessibility
  - `@radix-ui/react-slot` - Flexible composition

### Styling & Design System
- **Tailwind CSS 3.4** - Utility-first styling
- **Tailwind Animate** - Smooth micro-interactions
- **Lucide React** (already included) - Consistent iconography
- **Tailwind Merge** - Dynamic class composition
- **CSS-in-JS Alternative**: Inline styles for critical Shadow DOM isolation

### Extension APIs & Storage
- **Chrome Extension APIs**:
  - `chrome.tabs` - Tab management and switching
  - `chrome.history` - Browser history access
  - `chrome.sessions` - Recently closed tabs
  - `chrome.storage` - Settings and preferences
  - `chrome.scripting` - Content script injection
  - `chrome.commands` - Global hotkey registration
- **IndexedDB** (via `idb` wrapper) - Local timeline and cache storage
- **Web Storage API** - Temporary state management

### State Management
- **React Context + useReducer** - Lightweight state for extension UI
- **Chrome Message Passing** - Communication between extension components
- **Event-driven Architecture** - MV3-compatible service worker design

---

## 🚀 Backend & AI Stack

### Edge Computing Platform
- **Cloudflare Workers** - Global edge computing
- **Cloudflare KV** - Distributed caching layer
- **Cloudflare Pages** - Landing page hosting

### AI & Language Models
- **Google Gemini API** (Primary)
  - Q&A responses (temperature: 0.3)
  - Action plan generation (JSON mode, temperature: 0.1)
  - Page summarization (temperature: 0.2)
  - Intent parsing for ambiguous queries
- **Cloudflare Workers AI** (Fallback)
  - Local inference when Gemini unavailable
  - Cost optimization for high-frequency requests

### API Architecture
- **REST Endpoints**:
  - `POST /api/ask` - Conversational Q&A
  - `POST /api/plan` - Action plan generation
  - `POST /api/summarize` - Page TL;DR with caching
- **Security**:
  - Origin validation
  - Rate limiting per user
  - PII redaction pipeline
  - API key rotation

---

## 📱 Landing Page Stack (Secondary - Optional)

### Framework (Existing Boilerplate)
- **Next.js 14.2** - React framework with App Router
- **React 18.3** - Component library
- **TypeScript 5.6** - Type safety

### UI Library (Already Configured)
- **Shadcn/UI Components** (Radix-based):
  - Pre-built, accessible components
  - Consistent with extension UI
  - Dark/light mode support
- **Tailwind CSS 3.4** - Utility-first styling
- **Lucide React** - Icon system

### Existing Infrastructure to Leverage
- **Authentication**: Clerk (for future user accounts)
- **Database**: Drizzle ORM + PostgreSQL (for user preferences)
- **Testing**: Vitest + React Testing Library
- **Deployment**: Vercel or Cloudflare Pages

---

## 🛠 Development Tools & DX

### Build & Bundling
- **Vite** - Fast extension builds with TypeScript
- **Rollup** - Production bundling and tree-shaking
- **PostCSS** - CSS processing with Tailwind
- **ESLint + Prettier** - Code quality and formatting

### Testing Strategy
- **Vitest** - Unit testing framework
- **React Testing Library** - Component testing
- **Playwright** - E2E testing for extension flows
- **Manual Testing** - Chrome DevTools extension debugging

### Development Workflow
- **Chrome Extension Reloader** - Auto-reload during development
- **Hot Module Replacement** - Fast UI iteration
- **Source Maps** - Debugging in Chrome DevTools
- **TypeScript Strict Mode** - Catch errors early

---

## 🔒 Security & Privacy Stack

### Data Protection
- **Client-side PII Masking** - Regex-based redaction before API calls
- **Server-side PII Re-masking** - Double-check at Worker level
- **Zero-logs Policy** - No raw content stored server-side
- **Local-first Storage** - IndexedDB for sensitive timeline data

### Extension Security
- **Content Security Policy** - Strict CSP for extension pages
- **Manifest V3 Compliance** - No eval(), restricted permissions
- **Shadow DOM Isolation** - Prevent site CSS/JS conflicts
- **Origin Validation** - API calls restricted to extension origin

### API Security
- **Rate Limiting** - Per-user token budgets
- **Request Signing** - Origin validation with headers
- **Environment Secrets** - API keys only in Workers environment
- **Structured Error Handling** - No sensitive data in error responses

---

## 📊 Analytics & Monitoring (Optional)

### Telemetry (Opt-in Only)
- **Snowflake Data Warehouse** - Privacy-preserving analytics
- **Hashed User IDs** - No personally identifiable information
- **Usage Patterns** - Feature adoption and performance metrics
- **Topic Cards** - ML-driven intent classification

### Performance Monitoring
- **Web Vitals** - Core performance metrics
- **Error Tracking** - Client-side error collection
- **API Latency** - Response time monitoring
- **Cache Hit Rates** - Optimization metrics

---

## 🎨 Design System Rationale

### Why Radix UI + Tailwind?
1. **Accessibility First** - ARIA compliant out of the box
2. **Unstyled Primitives** - Full design control with Tailwind
3. **Tree-shakeable** - Small bundle size for extension
4. **TypeScript Native** - Excellent type definitions
5. **Headless Architecture** - Works in Shadow DOM

### Component Strategy
```tsx
// Extension-specific component approach
export const CommandPalette = () => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger className="nebula-hotkey-trigger">
      ⌘K
    </DropdownMenu.Trigger>
    <DropdownMenu.Content className="nebula-palette">
      {/* Isolated styling via className prefix */}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
);
```

### CSS Architecture
- **Tailwind Utilities** - Rapid prototyping and consistency
- **Component Classes** - `nebula-*` prefix for isolation
- **CSS Custom Properties** - Theme tokens for dark/light modes
- **Minimal Global Styles** - Avoid conflicts with host pages

---

## 📦 Package Dependencies Strategy

### Extension Core Dependencies
```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "@radix-ui/react-*": "latest",
  "lucide-react": "^0.453.0",
  "tailwindcss": "^3.4.14",
  "clsx": "^2.1.1",
  "tailwind-merge": "^2.5.4"
}
```

### Development Dependencies
```json
{
  "vite": "^5.0.0",
  "typescript": "^5.6.3",
  "eslint": "^8.57.1",
  "@types/chrome": "^0.0.250",
  "vitest": "^2.1.9"
}
```

### Worker Dependencies
```json
{
  "@cloudflare/workers-types": "^4.0.0",
  "zod": "^3.23.8",
  "hono": "^3.0.0"
}
```

---

## 🚦 Performance Considerations

### Bundle Size Optimization
- **Tree Shaking** - Import only used Radix components
- **Code Splitting** - Lazy load non-critical features
- **Dynamic Imports** - Load AI features on demand
- **Asset Optimization** - Compress icons and images

### Runtime Performance
- **Shadow DOM** - Isolated rendering context
- **Virtual Scrolling** - Handle large tab lists efficiently
- **Debounced Search** - Optimize Spotlight queries
- **Memoization** - Cache expensive computations

### Memory Management
- **Event Cleanup** - Remove listeners in useEffect cleanup
- **IndexedDB Limits** - Auto-purge old timeline entries
- **Service Worker Lifecycle** - Event-driven architecture only
- **Garbage Collection** - Avoid memory leaks in content scripts

---

## 🔄 Integration Points

### Extension ↔ Worker Communication
```typescript
// Structured messaging protocol
type APIRequest = {
  id: string;
  endpoint: '/api/ask' | '/api/plan' | '/api/summarize';
  payload: ContextBundle;
  timestamp: number;
};

type APIResponse = {
  id: string;
  success: boolean;
  data?: any;
  error?: ErrorCode;
  metadata: {
    model_used: 'gemini' | 'workers-ai';
    tokens_in: number;
    tokens_out: number;
    cached: boolean;
  };
};
```

### Landing Page ↔ Extension
- **Installation Flow** - Direct link to Chrome Web Store
- **Feature Documentation** - Live demos and screenshots
- **Privacy Policy** - Transparent data handling explanation
- **Support Links** - GitHub issues and feedback channels

---

## 🎯 Success Metrics by Component

### Extension Performance
- **Load Time**: Content script injection <100ms
- **Hotkey Response**: Palette opens <120ms
- **API Latency**: P90 <2s, P50 <1.5s
- **Memory Usage**: <50MB active extension memory

### UI/UX Quality
- **Accessibility**: axe-core violations = 0
- **Visual Consistency**: Design system compliance 100%
- **Error States**: Graceful fallbacks for all failure modes
- **User Feedback**: Clear progress indicators and confirmations

### AI Integration
- **Model Accuracy**: Element resolution >85% confidence
- **Cost Efficiency**: <$0.01 per user session
- **Cache Hit Rate**: >70% for summaries
- **Fallback Coverage**: 100% uptime via Workers AI

---

This tech stack provides the optimal balance of **development speed**, **performance**, **maintainability**, and **hackathon success**. The combination of Radix UI + Tailwind gives us production-quality components quickly, while the Cloudflare stack ensures global performance and reliability.

## Quick Start Commands

### Extension Development
```bash
cd extension
npm install
npm run dev    # Vite dev build with HMR
```

### Worker Development
```bash
cd worker
npm install
npx wrangler dev    # Local development server
```

### Landing Page (Optional)
```bash
npm run dev    # Next.js development server
```
