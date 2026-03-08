# Work Log: codex-ic-ai-grand-strategy-goals
## Task: ic-ai-grand-strategy-goals (IronCommand)
## Branch: feat/ic-ai-grand-strategy-goals
---

### [Step 1] Mapped AI strategy/economy code paths
- **Files changed:** none
- **What:** Inspected `src/combat/AI.ts` end-to-end, especially `tick()`, `executePriorityLadder()`, `spendFloatingCredits()`, `expandEconomy()`, `ensureHarvesting()`, `rebalanceHarvesterAssignments()`, and build/queue helpers.
- **Why:** Needed exact current behavior before reworking priorities to enforce spend-first + resource depletion goals.
- **Decisions:** Focus implementation on `AI.ts` since the priority ladder and all relevant levers already live there.
- **Issues found:** User requirement text appears truncated after "smart h"; inferred intended focus is smart harvesting/exhausting ore+gems.

### [Step 2] Reworked AI economy priorities to spend faster and mine out map resources
- **Files changed:** `src/combat/AI.ts`
- **What:**
  - Lowered float thresholds and introduced reserve-based spending via `CREDIT_RESERVE_TARGET` + `getCreditReserveTarget()`.
  - Reworked `spendFloatingCredits()` to always apply queue pressure, deepen queues under overflow, and prioritize refinery expansion when uncovered remote hotspots exist.
  - Updated `buildArmy()` so army-cap checks no longer block spending when credits are above reserve.
  - Increased harvester pressure in `ensureHarvesting()` (higher per-ref targets, remote hotspot bonus, deeper queue allowance).
  - Made `expandEconomy()` dynamic with hotspot-derived remote pressure and an adaptive refinery cap (up to 8) instead of fixed hard caps.
  - Strengthened refinery producer behavior in `chooseUnitForProducer()` to allow more harvesters before throttling.
  - Improved depletion behavior: `rebalanceHarvesterAssignments()` now retasks on value delta (not just empty vicinity), `hasNearbyResources()` now checks weighted nearby value, and hotspots are tracked deeper (`RESOURCE_HOTSPOT_TRACK_LIMIT`).
  - Reworked `findExpansionOreTarget()` to score real hotspots (value + distance - danger/contestation) rather than nearest-ore anchors.
  - Lowered ore anchor cutoff in `getOreFieldAnchors()` to keep expansion logic active on smaller remaining fields.
- **Why:** Existing logic had the right high-level order but still allowed credit float and conservative resource utilization; these changes make behavior match the intended priorities operationally.
- **Decisions:** Kept all changes inside AI strategy layer to avoid cross-system refactors; reused existing telemetry/hotspot systems rather than introducing new map scans.
- **Issues found:** No structural blockers; build-time chunk size warning remains pre-existing and unrelated.

### [Step 3] Validation
- **Files changed:** none
- **What:** Ran `npm run build` (`tsc --noEmit && vite build`).
- **Why:** Confirmed no TypeScript/runtime build regressions after AI strategy changes.
- **Decisions:** Used full build script rather than only `tsc` to validate bundling path too.
- **Issues found:** Vite reports large chunk warning (`dist/assets/index-*.js` > 500 kB), pre-existing/non-blocking.

## Summary
- **Total files changed:** 1
- **Key changes:**
  - Reworked AI spend logic with lower float thresholds and reserve-based overflow spending (`spendFloatingCredits`, `getCreditReserveTarget`).
  - Increased economic pressure toward map depletion with dynamic refinery expansion caps and uncovered-hotspot pressure scoring (`expandEconomy`, `shouldExpandForRemoteResources`, `getRemoteResourcePressure`).
  - Increased harvester target counts and smarter reassignment away from low-value pockets (`ensureHarvesting`, `rebalanceHarvesterAssignments`, `hasNearbyResources`, `getHotspotScoreNear`).
  - Reworked expansion target selection to choose high-value remote hotspots under risk constraints (`findExpansionOreTarget`).
- **Build status:** pass (`npm run build`)
- **Known issues:** existing non-blocking Vite chunk size warning (>500 kB) persists.
- **Integration notes:**
  - Commit: `9f29af3` on `feat/ic-ai-grand-strategy-goals`.
  - Branch pushed to origin.
  - `gh pr create --fill` detected existing PR: https://github.com/linkbag/IronCommand/pull/32 (no new PR created).

### Review+Fix Round 1
- **Reviewer:** codex-ic-ai-grand-strategy-goals-review-1
- **Timestamp:** 2026-03-08 05:04:08
- **Files reviewed:** src/combat/AI.ts
- **Issues found:**
  - Bug in `spendFloatingCredits`: condition `if (this.needsMorePower() || mildFloat)` caused `buildExtraPower()` to be called any time credits exceeded the reserve target, even when power was ample. This would cause the AI to spam unnecessary power plants as its primary credit sink. The `mildFloat` branch belongs to the production building / queue-pressure logic below it, not to the power-building call.
- **Fixes applied:**
  - Reverted condition to `if (this.needsMorePower())` — power plants are only built when the AI actually needs power. The mildFloat spending path (war factory, barracks, ore refinery, queue pressure) is unaffected. Commit `8441315`.
- **Build status:** `npx tsc --noEmit` → exit 0 (pass). Full `npm run build` not re-run (builder already confirmed clean build on the same codebase; only 1-line logic change).
- **Remaining concerns:**
  - `findExpansionOreTarget` scoring mixes hotspot value + normalized distance. Distance bonus is small relative to score magnitude, so expansion targeting is effectively value-greedy. Functionally fine but may not always push expansion to the far side of the map as originally intended.
  - `shouldExpandForRemoteResources` called with default args inside `spendFloatingCredits` (separate hotspot scan from `expandEconomy`'s scan). Cache TTL of 8 s limits redundancy, so no correctness issue, just a minor duplicate-scan possibility within the same tick if cache is stale.
  - No other correctness, safety, or structural issues found.
