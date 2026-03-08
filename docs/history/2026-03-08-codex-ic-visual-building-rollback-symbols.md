# Work Log: codex-ic-visual-building-rollback-symbols
## Task: ic-visual-building-rollback-symbols (IronCommand)
## Branch: feat/ic-visual-building-rollback-symbols
---

### [Step 1] Baseline repo scan and target identification
- **Files changed:** /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Verified branch status and enumerated source files to locate building rendering and setup/HUD UI components.
- **Why:** Needed precise file targets before editing to avoid regressions.
- **Decisions:** Focused on `src/entities/Building.ts`, `src/scenes/SetupScene.ts`, and `src/ui/HUD.ts` as likely touch points.
- **Issues found:** None; worktree was clean at start.

### [Step 2] Deep inspection of rendering/UI targets and prior branch history
- **Files changed:** /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Reviewed `src/entities/Building.ts`, `src/scenes/SetupScene.ts`, and `src/scenes/HUDScene.ts` plus related docs history to identify current visual regressions and reusable patterns.
- **Why:** Needed to confirm exactly where transparent ellipse rendering and setup-screen overlap are introduced before patching.
- **Decisions:** Implement rollback in `Building.ts` (shadow + low-power indicator + facility symbols), reserve non-overlapping preview dock in `SetupScene.ts`, and increase build-grid text readability in `HUDScene.ts`.
- **Issues found:** Found transparent ellipse shadow + low-power ellipse in building renderer; setup map preview currently overlays settings controls due shared screen region.

### [Step 3] Rolled back building visuals to solid box style + facility differentiation
- **Files changed:** src/entities/Building.ts, /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Reworked building draw pipeline to remove ellipse-based body visuals (drop shadow ellipse + low-power ellipse ring), kept opaque iso-box blocks, added facility-type classification (`factory`, `barracks`, `refinery`, `power`, `radar`, `lab`, `defense`), and rendered per-type roof symbols with type-based palette shading.
- **Why:** Requested rollback to solid readable block rendering while preserving quick visual identification of facility roles.
- **Decisions:** Used only lightweight primitive geometry for symbols/shadows and retained existing gameplay/combat behavior; also removed noisy debug logs in `drawBody`/`updateCombat`.
- **Issues found:** Needed to include `nuclear_reactor` in the same box-height adjustment family as other power buildings for silhouette consistency.

### [Step 4] Reworked skirmish setup layout + build menu text readability
- **Files changed:** src/scenes/SetupScene.ts, src/scenes/HUDScene.ts, /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Added a reserved map-preview dock in setup panel (with responsive fallback placement) so map preview no longer overlays options; made alliance row geometry dynamic against settings content width; improved radio-group sizing guardrails for narrow widths; increased HUD build-grid font sizes/strokes for item name/cost/hotkey/queue/ready labels.
- **Why:** Fix overlap between preview/minimap and options, and improve in-game build menu readability.
- **Decisions:** Preserved existing control flow and interactions, changing only layout math and text styling.
- **Issues found:** Existing setup UI is desktop-heavy; added defensive width clamps to avoid negative control widths on smaller viewports.

### [Step 5] Validated build and captured UI artifact
- **Files changed:** docs/screenshots/ic-visual-building-rollback-symbols.png, /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Ran `npm run build` successfully (TypeScript + Vite build) and captured a headless screenshot at `docs/screenshots/ic-visual-building-rollback-symbols.png`.
- **Why:** Confirm compile safety and provide required visual artifact for PR review of UI changes.
- **Decisions:** Stored screenshot in-repo under `docs/screenshots/` for stable PR markdown linking.
- **Issues found:** Existing Vite large-chunk warning persists; unrelated to this task.

### [Step 6] Committed and pushed implementation branch
- **Files changed:** src/entities/Building.ts, src/scenes/SetupScene.ts, src/scenes/HUDScene.ts, docs/screenshots/ic-visual-building-rollback-symbols.png, /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Committed changes as `8354989` with message `Rollback building visuals and improve setup/HUD readability` and pushed branch `feat/ic-visual-building-rollback-symbols` to origin.
- **Why:** Publish a reviewable atomic changeset for integration.
- **Decisions:** Kept commit scoped to renderer/layout/readability changes plus required screenshot artifact.
- **Issues found:** None during commit/push.

### [Step 7] Opened PR and attached screenshot details
- **Files changed:** /tmp/worklog-codex-ic-visual-building-rollback-symbols.md
- **What:** Opened PR #35 (`https://github.com/linkbag/IronCommand/pull/35`) and updated PR body with summary, build validation, and screenshot markdown.
- **Why:** Complete delivery workflow and provide reviewer-visible UI proof.
- **Decisions:** Used `gh api` PATCH fallback to update PR body because `gh pr edit` fails in this environment.
- **Issues found:** `gh pr edit` fails due GitHub Projects Classic GraphQL deprecation path (`repository.pullRequest.projectCards`).

## Summary
- **Total files changed:** 4
- **Key changes:**
  - Restored building visuals to solid opaque box blocks and removed transparent ellipse-based body visuals.
  - Added facility classification and roof symbols for factories/barracks/refineries/power/radar/labs/defenses with shade variants for readability.
  - Updated skirmish setup layout to reserve dedicated preview space and prevent preview/options overlap.
  - Increased build-menu text readability for labels, costs, queue badges, hotkeys, and ready indicators.
  - Added screenshot artifact at `docs/screenshots/ic-visual-building-rollback-symbols.png`.
- **Build status:** pass (`npm run build`)
- **Known issues:** Existing Vite chunk-size warning remains; unrelated to this task. `gh pr edit` is unreliable due deprecated Projects Classic GraphQL field.
- **Integration notes:** Branch `feat/ic-visual-building-rollback-symbols`, commit `8354989`, PR `https://github.com/linkbag/IronCommand/pull/35`.

### Review+Fix Round 1
- **Reviewer:** codex-ic-visual-building-rollback-symbols-review-1
- **Timestamp:** 2026-03-08 10:34:00
- **Files reviewed:** src/entities/Building.ts, src/scenes/HUDScene.ts, src/scenes/SetupScene.ts
- **Issues found:**
  1. Dead/redundant double `store.forEach` in `createRadioGroup` (SetupScene.ts). The first loop cleared and partially redrew buttons using a buggy `bx` calculation (used the captured closure bx of the clicked option, then subtracted the index offset — producing wrong x positions). The second loop immediately did `g.clear()` again and correctly redrew all buttons. The first loop was fully dead/overwritten but also incorrect in itself.
  2. No TypeScript errors. No memory leaks. No missing imports.
  3. `nuclear_silo` is classified as 'power' visual type because its id contains 'nuclear', but gets a superweapon palette override and an explicit id-based tall tower landmark — acceptable outcome.
  4. The `accentDark` variable is correctly used (passed as `lineColor` to `drawFacilitySymbol`). Not dead.
  5. HUDScene changes are pure readability tweaks (larger font sizes, added stroke) — no logic issues.
- **Fixes applied:** Removed the dead first `store.forEach` loop, keeping only the correct second loop. Saved ~10 redundant lines and eliminated the misleading comment.
- **Build status:** TypeScript clean before and after fix.
- **Remaining concerns:** None. The `nuclear_silo` visual-type ambiguity (classified as 'power') is minor — it still renders distinctly via the explicit id check for the tall tower.
