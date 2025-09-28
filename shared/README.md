# Shared Contracts

Type definitions that both the Cloudflare Worker (Team Member B) and the Chrome extension runtime (Team Member A) rely on.

- `automation.ts` — shapes for LLM-generated action plans, execution metadata, and resolver / interaction engine contracts. Import these types when implementing the service worker, content script, or planner so both sides stay in sync.

## Integration Notes for Team Member A (Extension)

```ts
// service-worker/background entry
import type { AutomationPlan, HumanInteractionEngine, UniversalResolver } from '../shared/automation';

// Example message payload sent to the content script when a plan comes back from the worker API
type ExecuteAutomationMessage = {
  kind: 'executePlan';
  plan: AutomationPlan;
  metadata: AutomationMetadata;
};
```

1. **Resolvers** – Implement `UniversalResolver.resolve(query)` in the content script. Return `needsDisambiguation` with candidate list when confidence < threshold. The worker already sends natural-language targets (no CSS selectors).
2. **Interaction Engine** – Build `HumanInteractionEngine.execute(plan, options)` to run the actions emitted by `/api/plan`. Honor `options.safeMode` by short-circuiting and only showing a preview.
3. **Dry Run / Preview** – Before full automation, call `preview(plan)` to highlight each step using the resolver’s `rect` data. This matches the “Start Assist” flow described in `ImplementationPlan.md` §B4.
4. **Messaging Contract** – Include `requestId` from `AutomationMetadata` in acknowledgements so the worker/UI can correlate progress logs.

For quick validation, mock a `plan` array locally (no network call) and ensure the resolver + interaction engine can execute/abort gracefully before wiring the real worker responses.
