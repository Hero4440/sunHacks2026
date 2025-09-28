// Cloudflare Worker API client - handles requests to the AI proxy

import type { ContextBundle } from './context-bundler'

export interface WorkerAnswer {
  answer: string
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
}

const offlineAnswer = (query: string, context: ContextBundle): WorkerAnswer => ({
  answer: `Nebula is ready! (offline mode)\n\nQuery: ${query}\nContext samples: ${(context.headings ?? []).join(', ')}`,
  model: 'offline-dev',
  source: 'stub'
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

export async function askWorker(query: string, context: ContextBundle): Promise<WorkerAnswer> {
  if (!WORKER_URL) {
    return offlineAnswer(query, context)
  }

  const payload = {
    query,
    context
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
    return offlineAnswer(query, context)
  }

  if (!response.ok) {
    const text = await safeReadText(response)
    logWorkerFailure(`Nebula worker responded with ${response.status}; using offline mode.`, text)
    return offlineAnswer(query, context)
  }

  let json: WorkerAskPayload | null = null
  try {
    json = await response.json() as WorkerAskPayload
  } catch (error) {
    logWorkerFailure('Nebula worker returned invalid JSON; falling back to offline mode.', error)
    return offlineAnswer(query, context)
  }

  resetWorkerFailureLog()

  return {
    answer: json?.answer ?? offlineAnswer(query, context).answer,
    model: json?.model_used,
    rawResponse: json,
    source: json?.source,
    cached: json?.cached,
    requestId: json?.request_id,
    tokens: {
      in: json?.tokens_in ?? 0,
      out: json?.tokens_out ?? 0
    },
    citations: json?.citations,
    payloadPreview: json?.payload_preview,
    steps: Array.isArray(json?.steps) ? json?.steps : undefined
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<no-body>'
  }
}
