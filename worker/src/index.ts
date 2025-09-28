import type { Ai, AiModels } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import type { AutomationAction, AutomationPlan } from '../../shared/automation';

// Bindings expected in Wrangler
type EnvBindings = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  SUMMARIES_KV?: KVNamespace;
  WORKERS_AI_MODEL?: string;
  AI?: Ai;
};

type AllowedOriginsCache = string[];

type LLMSource = 'gemini' | 'workers-ai' | 'stub';

type ResponseMeta = {
  model_used: string;
  source: LLMSource;
  tokens_in: number;
  tokens_out: number;
  cached: boolean;
};

type ActionStep = AutomationAction;

type AskResult = ResponseMeta & { answer: string };
type PlanResult = ResponseMeta & { steps: AutomationPlan };
type SummarizeResult = ResponseMeta & { summary: string };

const contextSchema = z.object({
  url: z.string().optional(),
  title: z.string().min(1).optional(),
  selection: z.string().optional(),
  headings: z.array(z.string()).max(5).optional(),
  timeline: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        tldr: z.string().optional(),
        timestamp: z.number().int().optional(),
      }),
    )
    .max(5)
    .optional(),
});

const askSchema = z.object({
  query: z.string().min(1),
  context: contextSchema.optional(),
});

const planSchema = z.object({
  goal: z.string().min(1),
  context: contextSchema.optional(),
});

const summarizeSchema = z.object({
  url: z.string().url(),
  context: contextSchema.optional(),
  forceRefresh: z.boolean().optional(),
});

const app = new Hono<{ Bindings: EnvBindings; Variables: { allowedOrigins?: AllowedOriginsCache } }>();

let allowedOriginsCache: AllowedOriginsCache | undefined;

const isOriginAllowed = (origin: string | null, allowed: string[]): boolean => {
  if (!origin) {
    return allowed.includes('*') || allowed.includes('chrome-extension://*');
  }
  if (allowed.includes(origin)) {
    return true;
  }
  if (allowed.includes('chrome-extension://*') && origin.startsWith('chrome-extension://')) {
    return true;
  }
  return false;
};

app.use('*', (c, next) => {
  if (!allowedOriginsCache) {
    allowedOriginsCache = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
  }
  c.set('allowedOrigins', allowedOriginsCache ?? []);

  if (c.req.method !== 'OPTIONS') {
    if (!isOriginAllowed(c.req.header('origin'), c.get('allowedOrigins'))) {
      throw new HTTPException(403, { message: 'Origin not allowed' });
    }
  }

  return next();
});

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!isOriginAllowed(origin, c.get('allowedOrigins'))) {
        return '';
      }
      return origin ?? '*';
    },
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400,
  }),
);

app.post('/api/ask', async (c) => {
  const reqId = nanoid();
  const input = askSchema.safeParse(await c.req.json());
  if (!input.success) {
    throw new HTTPException(400, { message: 'Invalid request payload', cause: input.error.flatten() });
  }

  const { redactedPayload } = applyRedaction(input.data);
  const result = await executeAsk(c.env, input.data);

  const body = {
    request_id: reqId,
    ...result,
    payload_preview: redactedPayload,
  } as const;

  c.header('x-request-id', reqId);
  return c.json(body);
});

app.post('/api/plan', async (c) => {
  const reqId = nanoid();
  const input = planSchema.safeParse(await c.req.json());
  if (!input.success) {
    throw new HTTPException(400, { message: 'Invalid request payload', cause: input.error.flatten() });
  }

  const { redactedPayload } = applyRedaction(input.data);
  const result = await executePlan(c.env, input.data);

  const body = {
    request_id: reqId,
    ...result,
    payload_preview: redactedPayload,
  } as const;

  c.header('x-request-id', reqId);
  return c.json(body);
});

app.post('/api/summarize', async (c) => {
  const reqId = nanoid();
  const input = summarizeSchema.safeParse(await c.req.json());
  if (!input.success) {
    throw new HTTPException(400, { message: 'Invalid request payload', cause: input.error.flatten() });
  }

  const { redactedPayload } = applyRedaction(input.data);
  const result = await executeSummarize(c.env, input.data);

  const body = {
    request_id: reqId,
    ...result,
    payload_preview: redactedPayload,
  } as const;

  c.header('x-request-id', reqId);
  return c.json(body);
});

async function executeAsk(env: EnvBindings, request: z.infer<typeof askSchema>) {
  const prompt = buildAskPrompt(request);
  const fallback = {
    answer: 'LLM integration pending — returning canned response.',
    model_used: 'stub',
    source: 'stub' as const,
    tokens_in: 0,
    tokens_out: 0,
    cached: false,
  } satisfies AskResult;

  if (!env.GEMINI_API_KEY) {
    return fallback;
  }

  const llm = await callGemini<string>(env, {
    label: 'ask',
    prompt,
    temperature: 0.3,
    defaultValue: fallback.answer,
    extract: resp => extractText(resp),
  });

  if (llm) {
    return {
      answer: llm.data,
      ...llm.meta,
    } satisfies AskResult;
  }

  const workers = await callWorkersAI<string>(env, {
    label: 'ask',
    prompt,
    temperature: 0.3,
    defaultValue: fallback.answer,
    extract: resp => extractWorkersText(resp),
  });

  if (workers) {
    return {
      answer: workers.data,
      ...workers.meta,
    } satisfies AskResult;
  }

  return fallback;
}

async function executePlan(env: EnvBindings, request: z.infer<typeof planSchema>) {
  const prompt = buildPlanPrompt(request);
  const fallbackSteps: AutomationPlan = [
    { act: 'find', target: 'TODO integrate Gemini planner' },
  ];
  const fallback = {
    steps: fallbackSteps,
    model_used: 'stub',
    source: 'stub' as const,
    tokens_in: 0,
    tokens_out: 0,
    cached: false,
  } satisfies PlanResult;

  if (!env.GEMINI_API_KEY) {
    return fallback;
  }

  const llm = await callGemini<AutomationPlan>(env, {
    label: 'plan',
    prompt,
    temperature: 0.1,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          act: { enum: ['find', 'scroll', 'focus', 'type', 'click', 'tab', 'wait'] },
          target: { type: 'string' },
          to: { enum: ['center', 'top', 'bottom'] },
          text: { type: 'string' },
          perChar: { type: 'boolean' },
          confirm: { type: 'boolean' },
          waitMs: { type: 'number' },
        },
        required: ['act'],
        additionalProperties: false,
      },
    },
    defaultValue: fallbackSteps,
    extract: resp => extractJson<ActionStep[]>(resp),
  });

  if (llm) {
    return {
      steps: llm.data,
      ...llm.meta,
    } satisfies PlanResult;
  }

  const workers = await callWorkersAI<AutomationPlan>(env, {
    label: 'plan',
    prompt,
    temperature: 0.1,
    defaultValue: fallbackSteps,
    extract: resp => extractWorkersJson<AutomationPlan>(resp),
  });

  if (workers) {
    return {
      steps: workers.data,
      ...workers.meta,
    } satisfies PlanResult;
  }

  return fallback;
}

async function executeSummarize(env: EnvBindings, request: z.infer<typeof summarizeSchema>) {
  // KV cache best effort
  if (!request.forceRefresh && env.SUMMARIES_KV) {
    const cached = await env.SUMMARIES_KV.get(request.url, 'json');
    if (cached && typeof cached === 'object' && 'summary' in cached) {
      return {
        summary: (cached as { summary: string }).summary,
        model_used: 'cache',
        source: 'gemini' as const,
        tokens_in: 0,
        tokens_out: 0,
        cached: true,
      } satisfies SummarizeResult;
    }
  }

  const prompt = buildSummarizePrompt(request);
  const fallback = {
    summary: 'Summary placeholder while Gemini integration is pending.',
    model_used: 'stub',
    source: 'stub' as const,
    tokens_in: 0,
    tokens_out: 0,
    cached: false,
  } satisfies SummarizeResult;

  if (!env.GEMINI_API_KEY) {
    return fallback;
  }

  const llm = await callGemini<string>(env, {
    label: 'summarize',
    prompt,
    temperature: 0.2,
    defaultValue: fallback.summary,
    extract: resp => extractText(resp),
  });

  if (llm) {
    if (env.SUMMARIES_KV) {
      env.SUMMARIES_KV.put(request.url, JSON.stringify({ summary: llm.data }), {
        expirationTtl: 300,
      }).catch(err => console.warn('KV put failed', err));
    }

    return {
      summary: llm.data,
      ...llm.meta,
    } satisfies SummarizeResult;
  }

  const workers = await callWorkersAI<string>(env, {
    label: 'summarize',
    prompt,
    temperature: 0.2,
    defaultValue: fallback.summary,
    extract: resp => extractWorkersText(resp),
  });

  if (workers) {
    if (env.SUMMARIES_KV) {
      env.SUMMARIES_KV.put(request.url, JSON.stringify({ summary: workers.data }), {
        expirationTtl: 300,
      }).catch(err => console.warn('KV put failed', err));
    }

    return {
      summary: workers.data,
      ...workers.meta,
    } satisfies SummarizeResult;
  }

  return fallback;
}

app.onError((err, c) => {
  const reqId = nanoid();
  console.error(`[Worker] ${reqId}`, err);
  const status = err instanceof HTTPException ? err.status : 500;
  const message = err instanceof HTTPException ? err.message : 'Internal Server Error';
  c.header('x-request-id', reqId);
  return c.json(
    {
      request_id: reqId,
      code: status === 400 ? 'BAD_REQUEST' : status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR',
      message,
    },
    status,
  );
});

export default app;

function applyRedaction<T extends { context?: Record<string, unknown> }>(payload: T) {
  // Minimal stub for redaction; to be replaced with full logic alongside Gemini integration.
  if (!payload.context) {
    return { redactedPayload: payload };
  }

  const clone = structuredClone(payload);
  const redact = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      return value;
    }

    const emailMask = value.replace(/[\w.%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
    const phoneMask = emailMask.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]');
    const ssnMask = phoneMask.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
    return ssnMask;
  };

  if (clone.context && typeof clone.context === 'object') {
    for (const [key, value] of Object.entries(clone.context)) {
      if (typeof value === 'string') {
        (clone.context as Record<string, unknown>)[key] = redact(value);
      }
      if (Array.isArray(value)) {
        (clone.context as Record<string, unknown>)[key] = value.map((entry) => {
          if (typeof entry === 'string') {
            return redact(entry);
          }
          if (typeof entry === 'object' && entry !== null) {
            const nested: Record<string, unknown> = {};
            for (const [nestedKey, nestedValue] of Object.entries(entry)) {
              nested[nestedKey] = typeof nestedValue === 'string' ? redact(nestedValue) : nestedValue;
            }
            return nested;
          }
          return entry;
        });
      }
    }
  }

  return { redactedPayload: clone };
}

function parseAllowedOrigins(rawOrigins?: string): AllowedOriginsCache {
  const defaults = ['chrome-extension://*'];
  const parsed = rawOrigins
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean) ?? [];

  return Array.from(new Set([...defaults, ...parsed]));
}

function buildAskPrompt(request: z.infer<typeof askSchema>) {
  const lines: string[] = [
    'You are Naros, a privacy-first browsing copilot. Answer the user succinctly using the provided context. If context is missing, respond with helpful guidance.',
    `User question: ${request.query}`,
  ];

  if (request.context) {
    const { title, url, selection, headings, timeline } = request.context;
    if (title) {
      lines.push(`Page title: ${title}`);
    }
    if (url) {
      lines.push(`Page URL: ${url}`);
    }
    if (headings && headings.length) {
      lines.push('Headings:');
      headings.forEach(h => lines.push(`- ${h}`));
    }
    if (selection) {
      lines.push(`Selection: ${selection}`);
    }
    if (timeline && timeline.length) {
      lines.push('Recent timeline:');
      timeline.forEach(item => lines.push(`- ${item.title} (${item.url})`));
    }
  }

  lines.push('Respond in markdown with concise paragraphs.');
  return lines.join('\n');
}

function buildPlanPrompt(request: z.infer<typeof planSchema>) {
  const lines: string[] = [
    'You are Naros, a site-agnostic browsing assistant. Produce a short JSON plan that uses only the allowed acts.',
    'Allowed acts: find, scroll, focus, type, click, tab, wait.',
    'Never include JavaScript, CSS selectors, or DOM manipulation. Plans should be human-like steps.',
    `User goal: ${request.goal}`,
  ];

  if (request.context) {
    const { title, url, selection, headings } = request.context;
    if (title) {
      lines.push(`Page title: ${title}`);
    }
    if (url) {
      lines.push(`Page URL: ${url}`);
    }
    if (headings?.length) {
      lines.push('Visible headings:');
      headings.forEach(h => lines.push(`- ${h}`));
    }
    if (selection) {
      lines.push(`User selection: ${selection}`);
    }
  }

  lines.push('Output JSON only, no comments.');
  return lines.join('\n');
}

function buildSummarizePrompt(request: z.infer<typeof summarizeSchema>) {
  const lines: string[] = [
    'You are Naros. Summarize the current page in 3 bullet points focusing on key takeaways.',
    `Target URL: ${request.url}`,
  ];

  if (request.context) {
    const { title, headings, selection } = request.context;
    if (title) {
      lines.push(`Title: ${title}`);
    }
    if (headings?.length) {
      lines.push('Headings:');
      headings.forEach(h => lines.push(`- ${h}`));
    }
    if (selection) {
      lines.push(`Highlighted content: ${selection}`);
    }
  }

  lines.push('Output format: Markdown bullet list, max 60 words total.');
  return lines.join('\n');
}

type GeminiCallOptions<T> = {
  label: 'ask' | 'plan' | 'summarize';
  prompt: string;
  temperature?: number;
  responseMimeType?: 'application/json';
  responseSchema?: unknown;
  defaultValue: T;
  extract: (response: GeminiContentResponse) => T | undefined;
};

type GeminiContentResponse = {
  modelVersion?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

async function callGemini<T>(env: EnvBindings, options: GeminiCallOptions<T>) {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  const model = env.GEMINI_MODEL ?? 'gemini-1.5-flash-latest';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? 0.3,
  };

  if (options.responseMimeType) {
    generationConfig.responseMimeType = options.responseMimeType;
    if (options.responseSchema) {
      generationConfig.responseSchema = options.responseSchema;
    }
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: options.prompt }],
      },
    ],
    generationConfig,
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Gemini ${options.label} call failed`, response.status, await response.text());
      return null;
    }

    const json = (await response.json()) as GeminiContentResponse;
    const data = options.extract(json) ?? options.defaultValue;

    const meta: ResponseMeta = {
      model_used: json.modelVersion ?? model,
      source: 'gemini',
      tokens_in: json.usageMetadata?.promptTokenCount ?? 0,
      tokens_out: json.usageMetadata?.candidatesTokenCount ?? 0,
      cached: false,
    };

    return { data, meta };
  } catch (error) {
    console.error(`Gemini ${options.label} error`, error);
    return null;
  }
}

function extractText(response: GeminiContentResponse) {
  const text = response.candidates
    ?.flatMap(candidate => candidate.content?.parts?.map(part => part.text ?? '') ?? [])
    .join('\n')
    .trim();
  return text && text.length > 0 ? text : undefined;
}

function extractJson<T>(response: GeminiContentResponse) {
  const text = extractText(response);
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Failed to parse Gemini JSON payload', error, text);
    return undefined;
  }
}

type WorkersAICallOptions<T> = {
  label: 'ask' | 'plan' | 'summarize';
  prompt: string;
  temperature?: number;
  defaultValue: T;
  extract: (response: WorkersAIResponse) => T | undefined;
};

type WorkersAIResponse = string | {
  response?: string;
  result?: string;
  text?: string;
  output_text?: string;
  outputs?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

async function callWorkersAI<T>(env: EnvBindings, options: WorkersAICallOptions<T>) {
  const model = (env.WORKERS_AI_MODEL ?? '@cf/meta/llama-3.1-8b-instruct') as keyof AiModels;
  if (!env.AI) {
    return null;
  }

  try {
    const raw = await env.AI.run(model, {
      prompt: options.prompt,
      temperature: options.temperature ?? 0.2,
    });

    const normalized = raw as WorkersAIResponse;
    const data = options.extract(normalized) ?? options.defaultValue;

    const usage = typeof normalized === 'object' && normalized && 'usage' in normalized
      ? (normalized as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
      : undefined;

    const meta: ResponseMeta = {
      model_used: model,
      source: 'workers-ai',
      tokens_in: usage?.input_tokens ?? 0,
      tokens_out: usage?.output_tokens ?? 0,
      cached: false,
    };

    return { data, meta };
  } catch (error) {
    console.warn(`Workers AI ${options.label} error`, error);
    return null;
  }
}

function extractWorkersText(response: WorkersAIResponse) {
  if (typeof response === 'string') {
    return response.trim() || undefined;
  }

  const text = response.response
    ?? response.result
    ?? response.text
    ?? response.output_text
    ?? response.outputs?.map(item => item.text ?? '').join('\n');

  return text && text.trim().length > 0 ? text.trim() : undefined;
}

function extractWorkersJson<T>(response: WorkersAIResponse) {
  const text = extractWorkersText(response);
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Workers AI JSON parse failed', error, text);
    return undefined;
  }
}
