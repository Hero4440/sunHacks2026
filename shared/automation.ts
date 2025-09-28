/**
 * Shared automation contracts between the Worker (planner) and the Chrome extension runtime.
 * These types give both Team Member A and B a stable interface to build against.
 */

export type ActionVerb = 'find' | 'scroll' | 'focus' | 'type' | 'click' | 'tab' | 'wait';

export type ScrollTarget = 'center' | 'top' | 'bottom';

export interface AutomationAction {
  act: ActionVerb;
  /** Natural language target (resolved by universal resolver). */
  target?: string;
  /** Optional scroll anchor. */
  to?: ScrollTarget;
  /** Text to type (respecting privacy guardrails). */
  text?: string;
  /** Whether to simulate per-character typing with jitter. */
  perChar?: boolean;
  /** Require explicit user confirmation before executing the step. */
  confirm?: boolean;
  /** Manual wait in milliseconds (for animations/network). */
  waitMs?: number;
}

export type AutomationPlan = AutomationAction[];

export interface AutomationMetadata {
  requestId: string;
  modelUsed: string;
  source: 'gemini' | 'workers-ai' | 'stub';
  tokensIn: number;
  tokensOut: number;
  cached: boolean;
}

export interface ExecutionOptions {
  allowAutomation: boolean;
  safeMode: boolean;
  /**
   * If true, do not execute automation immediately – only preview/highlight.
   * Useful for "Start Assist" gating.
   */
  dryRun?: boolean;
}

export enum ExecutionAbortReason {
  UserCancelled = 'user_cancelled',
  ResolverConfidenceLow = 'resolver_confidence_low',
  TargetUnavailable = 'target_unavailable',
  Timeout = 'timeout',
  PermissionDenied = 'permission_denied',
  Unknown = 'unknown_error',
}

export interface ExecutionStepResult {
  action: AutomationAction;
  status: 'success' | 'skipped' | 'failed';
  message?: string;
}

export interface ExecutionSummary {
  completed: boolean;
  abortReason?: ExecutionAbortReason;
  steps: ExecutionStepResult[];
  durationMs: number;
}

/**
 * Contract for the universal resolver injected by Team Member A.
 * It takes a natural language target and returns a DOM reference plus metadata.
 */
export interface ResolverQuery {
  target: string;
  intent?: 'primary' | 'secondary';
  /** Optional hints coming from the planner (e.g. expected role, form field name). */
  hints?: Record<string, string>;
}

export interface ResolverMatch {
  /** Reference to the DOM element; stored abstractly to avoid leaking Element into the worker. */
  handle: unknown;
  /** Confidence score 0-1. */
  confidence: number;
  /** How the match was found (label, aria-label, nearby text, etc.). */
  rationale: string[];
  /** Bounding box for previews/overlays. */
  rect?: DOMRectLike;
}

export interface DOMRectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ResolverResult {
  match?: ResolverMatch;
  needsDisambiguation?: boolean;
  candidates?: ResolverMatch[];
}

export interface UniversalResolver {
  resolve(query: ResolverQuery): Promise<ResolverResult>;
  /** Optional hook so the Human Interaction Engine can reuse scoring heuristics. */
  score?(query: ResolverQuery, element: unknown): number;
}

export interface HumanInteractionEngine {
  preview(plan: AutomationPlan): Promise<void>;
  execute(plan: AutomationPlan, options: ExecutionOptions): Promise<ExecutionSummary>;
  cancel(): Promise<void>;
}
