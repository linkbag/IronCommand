# Iron Command 🎖️

A real-time strategy (RTS) game inspired by the classic C&C era. Build bases, harvest resources, train armies, and conquer the battlefield with 15 unique factions.

## Tech Stack
- **Phaser 3** — HTML5 game framework (rendering, input, camera, sprites)
- **TypeScript** — type-safe game logic
- **Vite** — fast dev server and bundler

## Run Locally
```bash
npm install
npm run dev
# Opens http://localhost:3000
```

## Architecture
```
src/
├── main.ts              # Phaser game bootstrap
├── types/index.ts       # Shared type definitions (ALL agents use these)
├── data/
│   └── factions.ts      # 15 faction definitions
├── engine/              # Core game engine (Agent 1)
│   ├── GameMap.ts       # Tilemap generation, terrain, fog of war
│   ├── Pathfinding.ts   # A* pathfinding on tile grid
│   ├── Selection.ts     # Box select, click select, selection groups
│   ├── Camera.ts        # RTS camera (edge scroll, minimap click, zoom)
│   └── Minimap.ts       # Minimap renderer
├── entities/            # Units & Buildings (Agent 2)
│   ├── Unit.ts          # Base unit class
│   ├── Building.ts      # Base building class
│   ├── UnitDefs.ts      # All unit type definitions
│   └── BuildingDefs.ts  # All building type definitions
├── combat/              # Combat system (Agent 2)
│   ├── Combat.ts        # Damage calculation, projectiles
│   └── AI.ts            # Enemy AI (build order, attack timing)
├── economy/             # Resource system (Agent 2)
│   ├── Economy.ts       # Credits, ore harvesting, refinery
│   └── Production.ts    # Build queues, tech prerequisites
├── ui/                  # In-game UI (Agent 3)
│   ├── HUD.ts           # Sidebar, build panels, resource display
│   ├── HealthBars.ts    # Unit/building health bars
│   └── SelectionBox.ts  # Drag selection rectangle
├── scenes/              # Phaser scenes (Agent 3)
│   ├── BootScene.ts     # Asset loading
│   ├── MenuScene.ts     # Main menu
│   ├── SetupScene.ts    # Skirmish setup (faction pick, map, AI)
│   ├── GameScene.ts     # Main gameplay scene
│   └── HUDScene.ts      # HUD overlay scene
└── assets/              # Generated placeholder sprites
    ├── sprites/
    ├── audio/
    └── maps/
```

## 15 Factions
🇨🇳 China · 🇯🇵 Japan · 🇺🇸 USA · 🇷🇺 Russia · 🇮🇷 Iran · 🇲🇽 Mexico · 🇫🇷 France · 🇬🇧 UK · 🇩🇪 Germany · 🇮🇳 India · 🇮🇶 Iraq · 🇿🇦 South Africa · 🇪🇸 Spain · 🇮🇹 Italy · 🇰🇷 Korea

Each faction has unique units, a special superweapon, and a passive bonus.
