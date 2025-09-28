// Cloudflare Worker API client - handles requests to the AI proxy

import type { ContextBundle } from './context-bundler'
import type { AutomationAction } from '../../../shared/automation'

export interface WorkerIntent {
  kind: string
  confidence?: number
  payload?: Record<string, unknown>
  tabQuery?: string
}

export interface WorkerAnswer {
  answer?: string
  intent?: WorkerIntent
  model?: string
  source?: string
  cached?: boolean
  requestId?: string
  tokens?: {
    in: number
    out: number
  }
  citations?: Array<{ title: string; url: string }>
  payloadPreview?: unknown
  steps?: Array<{ title?: string; status?: 'pending' | 'completed' | 'failed' }>
  latencyMs?: number
  rawResponse?: unknown
}

const workerEnv = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
const WORKER_URL = (workerEnv.VITE_WORKER_URL || '').trim()

const resolveWorkerEndpoint = (path: string): string => {
  if (!WORKER_URL) {
    return ''
  }

  const normalizedPath = `/${path.replace(/^\//, '')}`

  try {
    const url = new URL(WORKER_URL)
    url.pathname = normalizedPath
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch (error) {
    if (WORKER_URL.endsWith('/ask')) {
      const base = WORKER_URL.replace(/\/ask$/, '')
      return `${base}${normalizedPath}`
    }
    return `${WORKER_URL.replace(/\/?$/, '')}${normalizedPath}`
  }
}

const PLAN_URL = resolveWorkerEndpoint('api/plan')

interface WorkerAskPayload {
  request_id?: string
  answer?: string
  model_used?: string
  source?: string
  cached?: boolean
  tokens_in?: number
  tokens_out?: number
  citations?: Array<{ title: string; url: string }>
  payload_preview?: unknown
  steps?: unknown
  intent?: WorkerIntent
}

const offlineAnswer = (query: string, context: ContextBundle): WorkerAnswer => ({
  answer: `Nebula is ready! (offline mode)\n\nQuery: ${query}\nContext samples: ${(context.headings ?? []).join(', ')}`,
  model: 'offline-dev',
  source: 'stub'
})

export interface WorkerPlan {
  steps: AutomationAction[]
  model?: string
  source?: string
  cached?: boolean
  requestId?: string
  tokens?: {
    in: number
    out: number
  }
}

const offlinePlan = (): WorkerPlan => ({
  steps: [],
  model: 'offline-dev',
  source: 'stub',
  cached: false,
})

let lastWorkerFailureLog = 0
const WORKER_FAILURE_LOG_INTERVAL_MS = 30_000

const logWorkerFailure = (message: string, error?: unknown): void => {
  const now = Date.now()
  if (now - lastWorkerFailureLog < WORKER_FAILURE_LOG_INTERVAL_MS) {
    return
  }
  lastWorkerFailureLog = now
  if (error) {
    console.warn(message, error)
  } else {
    console.warn(message)
  }
}

const resetWorkerFailureLog = (): void => {
  lastWorkerFailureLog = 0
}

type AskWorkerOptions = {
  mode?: 'ask' | 'intent'
  expectedKinds?: string[]
}

export async function askWorker(query: string, context: ContextBundle, options: AskWorkerOptions = {}): Promise<WorkerAnswer> {
  const mode = options.mode ?? 'ask'

  if (!WORKER_URL) {
    if (mode === 'intent') {
      return {
        intent: { kind: 'unknown', confidence: 0, payload: { reason: 'offline' } },
        model: 'offline-dev',
        source: 'stub',
        cached: false,
        tokens: { in: 0, out: 0 },
      }
    }
    return offlineAnswer(query, context)
  }

  const payload: Record<string, unknown> = {
    query,
    context,
  }

  if (options.mode) {
    payload.mode = options.mode
  }
  if (options.expectedKinds?.length) {
    payload.expectedKinds = options.expectedKinds
  }

  let response: Response
  try {
    response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit'
    })
  } catch (error) {
    logWorkerFailure('Nebula worker unreachable, continuing in offline mode.', error)
    if (mode === 'intent') {
      return {
        intent: { kind: 'unknown', confidence: 0, payload: { reason: 'offline' } },
        model: 'offline-dev',
        source: 'stub',
        cached: false,
        tokens: { in: 0, out: 0 },
      }
    }
    return offlineAnswer(query, context)
  }

  if (!response.ok) {
    const text = await safeReadText(response)
    logWorkerFailure(`Nebula worker responded with ${response.status}; using offline mode.`, text)
    if (mode === 'intent') {
      return {
        intent: { kind: 'unknown', confidence: 0, payload: { reason: 'offline' } },
        model: 'offline-dev',
        source: 'stub',
        cached: false,
        tokens: { in: 0, out: 0 },
      }
    }
    return offlineAnswer(query, context)
  }

  let json: WorkerAskPayload | null = null
  try {
    json = await response.json() as WorkerAskPayload
  } catch (error) {
    logWorkerFailure('Nebula worker returned invalid JSON; falling back to offline mode.', error)
    if (mode === 'intent') {
      return {
        intent: { kind: 'unknown', confidence: 0, payload: { reason: 'invalid-json' } },
        model: 'offline-dev',
        source: 'stub',
        cached: false,
        tokens: { in: 0, out: 0 },
      }
    }
    return offlineAnswer(query, context)
  }

  resetWorkerFailureLog()

  const baseTokens = {
    in: json?.tokens_in ?? 0,
    out: json?.tokens_out ?? 0,
  }

  const result: WorkerAnswer = {
    answer: json?.answer,
    model: json?.model_used,
    rawResponse: json,
    source: json?.source,
    cached: json?.cached,
    requestId: json?.request_id,
    tokens: baseTokens,
    citations: json?.citations,
    payloadPreview: json?.payload_preview,
    steps: Array.isArray(json?.steps) ? json?.steps : undefined,
    intent: json?.intent,
  }

  if (!result.answer && mode === 'ask') {
    const fallback = offlineAnswer(query, context)
    result.answer = fallback.answer
    result.model = result.model ?? fallback.model
    result.source = result.source ?? fallback.source
    result.cached = result.cached ?? false
    result.tokens = result.tokens ?? { in: 0, out: 0 }
  }

  return result
}

export async function planWorker(goal: string, context: ContextBundle): Promise<WorkerPlan> {
  if (!PLAN_URL) {
    return offlinePlan()
  }

  const payload = {
    goal,
    context,
  }

  let response: Response
  try {
    response = await fetch(PLAN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit',
    })
  } catch (error) {
    logWorkerFailure('Nebula planner unreachable, using offline plan.', error)
    return offlinePlan()
  }

  if (!response.ok) {
    const text = await safeReadText(response)
    logWorkerFailure(`Nebula planner returned ${response.status}; using offline plan.`, text)
    return offlinePlan()
  }

  type WorkerPlanPayload = {
    request_id?: string
    steps?: AutomationAction[]
    model_used?: string
    source?: string
    cached?: boolean
    tokens_in?: number
    tokens_out?: number
  }

  let json: WorkerPlanPayload | null = null
  try {
    json = await response.json() as WorkerPlanPayload
  } catch (error) {
    logWorkerFailure('Nebula planner returned invalid JSON; using offline plan.', error)
    return offlinePlan()
  }

  resetWorkerFailureLog()

  return {
    steps: Array.isArray(json?.steps) ? json!.steps : [],
    model: json?.model_used,
    source: json?.source,
    cached: json?.cached,
    requestId: json?.request_id,
    tokens: {
      in: json?.tokens_in ?? 0,
      out: json?.tokens_out ?? 0,
    },
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<no-body>'
  }
}
