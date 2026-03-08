# Work Log: codex-ic-building-boxes-v3-symbol-labels
## Task: ic-building-boxes-v3-symbol-labels (IronCommand)
## Branch: feat/ic-building-boxes-v3-symbol-labels
---

### [Step 1] Audited current building renderer and prior visual history
- **Files changed:** /tmp/worklog-codex-ic-building-boxes-v3-symbol-labels.md
- **What:** Reviewed `src/entities/Building.ts`, `src/entities/BuildingDefs.ts`, minimap/map renderer files, and historical notes in `docs/history/2026-03-07-codex-ic-bldg-symbols.md` and `docs/history/2026-03-08-codex-ic-bldg-box-symbols-v2.md`.
- **Why:** Needed to identify the exact rendering path and compare current prism-like visuals against prior box/symbol iterations.
- **Decisions:** Scope changes to `Building.ts` rendering methods only, preserving gameplay/combat/economy logic.
- **Issues found:** Current `drawBody()` includes detailed prism shading and small text labels (`def.name.slice(0,4)`), which is less readable than requested large overlays.
