// ============================================================
// IRON COMMAND — GameScene (RA2 Mechanics Overhaul)
// Wires real engine + entity + economy + combat + AI modules
// Full HUD ↔ GameScene event integration
// ============================================================

import Phaser from 'phaser'
import { GameMap } from '../engine/GameMap'
import { Pathfinder } from '../engine/Pathfinding'
import { EntityManager } from '../entities/EntityManager'
import { Combat } from '../combat/Combat'
import { Economy } from '../economy/Economy'
import { Production } from '../economy/Production'
import { AI } from '../combat/AI'
import { BUILDING_DEFS, getPowerBuildingDefId } from '../entities/BuildingDefs'
import { UNIT_DEFS, getHarvesterDefId, getBasicInfantryDefId } from '../entities/UnitDefs'
import type { Position, TileCoord, GameState, Player, GamePhase, FactionId, FactionSide } from '../types'
import { TILE_SIZE, STARTING_CREDITS, TerrainType } from '../types'
import { FACTIONS } from '../data/factions'
import type { SkirmishConfig } from './SetupScene'

// Unit acknowledgment lines
const ACK_LINES: Record<string, string[]> = {
  infantry: ['Yes sir!', 'Affirmative', 'Moving out', 'On it!', 'Copy that'],
  vehicle: ['Rolling out', 'Moving', 'Acknowledged', 'On the way'],
  aircraft: ['Airborne!', 'Wilco', 'Roger that'],
  harvester: ['Returning', 'Harvesting', 'On my way'],
}

export class GameScene extends Phaser.Scene {
  // ── IRTSScene interface (Unit.ts calls these via scene cast) ──
  findPath: (from: TileCoord, to: TileCoord, playerId?: number) => TileCoord[] =
    () => []
  worldToTile: (x: number, y: number) => TileCoord =
    (x, y) => ({ col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) })
  tileToWorld: (col: number, row: number) => Position =
    (col, row) => ({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 })

  // ── Systems ─────────────────────────────────────────────────
  private gameMap!: GameMap
  private pathfinder!: Pathfinder
  private entityMgr!: EntityManager
  private combat!: Combat
  private economy!: Economy
  private production!: Production
  private aiCommanders: AI[] = []

  // ── Game state ──────────────────────────────────────────────
  private gameState!: GameState
  private skirmishCfg!: SkirmishConfig

  // ── Camera ──────────────────────────────────────────────────
  private camX = 0
  private camY = 0
  private camSpeed = 400  // px/s

  // ── Input ───────────────────────────────────────────────────
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>
  private isDragging = false
  private isLeftPointerActive = false
  private dragAnchorScreen = { x: 0, y: 0 }
  private dragAnchorWorld = { x: 0, y: 0 }
  private cursorMode: string = 'normal'

  // ── Selection ───────────────────────────────────────────────
  private selectionRect!: Phaser.GameObjects.Graphics
  private selectedIds: Set<string> = new Set()

  // ── Last alert position (for Space key) ────────────────────
  private lastAlertPos: Position | null = null
  private fogAnchorSources: Array<{ pos: TileCoord; range: number }> = []
  private waypointMode = false

  constructor() {
    super({ key: 'GameScene' })
  }

  init(data: { config: SkirmishConfig }) {
    this.skirmishCfg = data?.config ?? {
      playerFaction: 'usa',
      mapSize: 'small',
      aiCount: 1,
      aiDifficulty: 'medium',
      startingCredits: STARTING_CREDITS,
    }
    // Reset per-session state
    this.aiCommanders = []
    this.selectedIds = new Set()
    this.camX = 0
    this.camY = 0
    this.cursorMode = 'normal'
    this.lastAlertPos = null
    this.fogAnchorSources = []
    this.waypointMode = false
  }

  create() {
    const cfg = this.skirmishCfg

    // ── 1. Procedural map ─────────────────────────────────────
    const mapDims: Record<string, number> = { small: 64, medium: 128, large: 256 }
    const mapSize = mapDims[cfg.mapSize] ?? 64
    const seed = Math.floor(Math.random() * 99999) + 1
    this.gameMap = new GameMap(this, mapSize, mapSize, seed)
    this.gameMap.renderTerrain()
    // NOTE: Don't pre-render fog as full black here. All tiles start HIDDEN.
    // updateFogOfWar() at the end of create() will reveal + render fog properly.

    // ── 2. Pathfinder ─────────────────────────────────────────
    this.pathfinder = new Pathfinder(this.gameMap)

    // Wire IRTSScene methods (Unit calls these via scene cast)
    this.findPath  = (from, to) => this.pathfinder.findPath(from, to)
    this.worldToTile = (x, y) => this.gameMap.worldToTile(x, y)
    this.tileToWorld = (col, row) => this.gameMap.tileToWorld(col, row)

    // ── 3. Entity manager ─────────────────────────────────────
    this.entityMgr = new EntityManager(this)

    // ── 4. Combat system ──────────────────────────────────────
    this.combat = new Combat(this, this.entityMgr)

    // ── 5. Build player list ──────────────────────────────────
    const playerFaction = cfg.playerFaction
    const factionKeys = Object.keys(FACTIONS) as FactionId[]

    const humanPlayer: Player = {
      id: 0, name: 'Commander', faction: playerFaction,
      color: FACTIONS[playerFaction].color, credits: cfg.startingCredits,
      power: 0, powerGenerated: 0, powerConsumed: 0,
      isAI: false, isDefeated: false, entities: [], buildQueue: [],
    }

    const aiPlayers: Player[] = []
    for (let i = 0; i < cfg.aiCount; i++) {
      const fac = factionKeys[(factionKeys.indexOf(playerFaction) + i + 1) % factionKeys.length]
      aiPlayers.push({
        id: i + 1, name: `AI ${i + 1}`, faction: fac,
        color: FACTIONS[fac].color, credits: cfg.startingCredits,
        power: 0, powerGenerated: 0, powerConsumed: 0,
        isAI: true, isDefeated: false, entities: [], buildQueue: [],
      })
    }
    const allPlayers = [humanPlayer, ...aiPlayers]

    // ── 6. Economy ────────────────────────────────────────────
    const playerIds = allPlayers.map(p => p.id)
    this.economy = new Economy(this.entityMgr, playerIds)
    // Patch if custom starting credits differ from default
    if (cfg.startingCredits !== STARTING_CREDITS) {
      const delta = cfg.startingCredits - STARTING_CREDITS
      if (delta !== 0) {
        for (const p of allPlayers) {
          if (delta > 0) this.economy.addCredits(p.id, delta)
          else this.economy.deductCredits(p.id, Math.abs(delta))
        }
      }
    }

    // ── 7. Production ─────────────────────────────────────────
    this.production = new Production(this.entityMgr, this.economy)

    // ── 8. AI commanders ──────────────────────────────────────
    this.aiCommanders = aiPlayers.map(p =>
      new AI(p.id, cfg.aiDifficulty, this.entityMgr, this.economy, this.production, p.faction)
    )

    // ── 9. Game state ─────────────────────────────────────────
    this.gameState = {
      phase: 'playing' as GamePhase,
      tick: 0,
      players: allPlayers,
      localPlayerId: 0,
      selectedEntityIds: [],
      map: this.gameMap.data,
    }

    // ── 10. Event wiring ──────────────────────────────────────
    this.wireEntityEvents()
    this.wireOreEvents()
    this.wireEconomyEvents()
    this.wireHUDEvents()
    this.wireProductionEvents()

    // ── 11. Spawn starting entities ───────────────────────────
    this.spawnStartingEntities()

    // ── 12. Input ─────────────────────────────────────────────
    this.setupInput()

    // ── 13. UI elements (fixed to screen, don't scroll) ───────
    this.selectionRect = this.add.graphics()
    this.selectionRect.setScrollFactor(0).setDepth(200)

    // ── 14. Camera at player spawn ────────────────────────────
    const startPos = this.gameMap.data.startPositions[0]
    if (startPos) {
      this.camX = startPos.x - this.scale.width / 2
      this.camY = startPos.y - this.scale.height / 2
    }
    this.cameras.main.setScroll(this.camX, this.camY)

    // ── 15. Launch HUD overlay ────────────────────────────────
    this.scene.launch('HUDScene', { gameState: this.gameState })

    // ── 16. Initial fog reveal around player base ─────────────
    console.log('[IC] Units:', this.entityMgr.getAllUnits().length,
                'Buildings:', this.entityMgr.getAllBuildings().length)
    console.log('[IC] StartPos[0]:', this.gameMap.data.startPositions[0])
    console.log('[IC] TERRAIN rendered:', (this.gameMap as any)['renderedTiles'])
    console.log('[IC] Fog layer depth:', (this.gameMap as any)['fogLayer']?.depth)
    console.log('[IC] Terrain depth:', (this.gameMap as any)['terrainGraphics']?.depth)

    // Keep a visible "home sector" so the opening view is playable on large monitors.
    // Without this, the initial revealed area can be too small and appear as a black screen.
    const localSpawn = this.gameMap.data.startPositions[this.gameState.localPlayerId]
      ?? this.gameMap.data.startPositions[0]
    if (localSpawn) {
      const anchorRange = Math.max(
        16,
        Math.ceil(Math.hypot(this.scale.width, this.scale.height) / (TILE_SIZE * 3)),
      )
      this.fogAnchorSources = [{
        pos: this.gameMap.worldToTile(localSpawn.x, localSpawn.y),
        range: anchorRange,
      }]
      console.log('[IC] Fog anchor set:', this.fogAnchorSources[0])
    }

    // Reveal fog around player entities
    this.updateFogOfWar()

    // DEBUG: If no tiles were revealed, force-reveal everything so the game is playable
    const visibleCount = this.gameMap.data.tiles.flat().filter(t => t.fogState === 2).length
    console.log('[IC] Fog updated. Visible tiles:', visibleCount)
    if (visibleCount === 0) {
      console.warn('[IC] WARNING: No tiles revealed! Force-revealing entire map.')
      this.gameMap.revealAll()
    }

    // Push initial camera to registry for HUD
    this.registry.set('camX', this.camX)
    this.registry.set('camY', this.camY)

    console.log('[IC] Camera at:', this.camX, this.camY)
    console.log('[IC] Map world size:', this.gameMap.worldWidth, 'x', this.gameMap.worldHeight)

    // Prevent browser context menu on the game canvas
    this.game.canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault())

    this.cameras.main.fadeIn(500)
  }

  update(_time: number, delta: number) {
    if (this.gameState.phase !== 'playing') return

    this.gameState.tick++

    // Handle camera target from HUD (minimap click, H key)
    this.handleCameraTarget()

    // Camera scroll + clamp to map bounds
    this.handleCameraScroll(delta)
    const maxX = this.gameMap.worldWidth - this.scale.width
    const maxY = this.gameMap.worldHeight - this.scale.height
    this.camX = Phaser.Math.Clamp(this.camX, 0, Math.max(0, maxX))
    this.camY = Phaser.Math.Clamp(this.camY, 0, Math.max(0, maxY))
    this.cameras.main.setScroll(this.camX, this.camY)

    // Pathfinder cache maintenance
    this.pathfinder.tick()

    // Entity systems (movement, combat state machines, harvest loops)
    this.entityMgr.update(delta)

    // Projectile travel + explosion effects
    this.combat.update(delta)

    // Power calculation + credit conversion
    this.economy.update(delta, this.gameState)

    // Build queue progress
    this.production.update(delta, this.gameState)

    // AI decision making
    for (const ai of this.aiCommanders) {
      ai.update(delta, this.gameState)
    }
    if (this.gameState.tick % 600 === 0 && this.aiCommanders.length > 0) {
      console.log(`[IC] AI updates running for ${this.aiCommanders.length} commander(s)`)
    }

    // Fog of war (every 30 ticks ≈ 0.5s at 60fps)
    if (this.gameState.tick % 30 === 0) {
      this.updateFogOfWar()
    }

    // Win/loss check (every 120 ticks ≈ 2s)
    if (this.gameState.tick % 120 === 0) {
      this.checkWinCondition()
    }

    // Push live state to HUD via registry
    this.registry.set('gameState', this.gameState)
    this.registry.set('economy', this.economy)
    this.registry.set('production', this.production)
    this.registry.set('entityMgr', this.entityMgr)
    this.registry.set('selectedIds', Array.from(this.selectedIds))
    this.registry.set('camX', this.camX)
    this.registry.set('camY', this.camY)
  }

  // ── Camera target from registry (minimap click, H key) ──────

  private handleCameraTarget(): void {
    const tx = this.registry.get('camTargetX') as number | undefined
    const ty = this.registry.get('camTargetY') as number | undefined
    if (tx !== undefined && ty !== undefined) {
      this.camX = tx
      this.camY = ty
      this.registry.remove('camTargetX')
      this.registry.remove('camTargetY')
    }
  }

  // ── Entity event wiring ───────────────────────────────────────

  private wireEntityEvents(): void {
    // Track entity IDs per player for win condition checks
    this.entityMgr.on('unit_created', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p && !p.entities.includes(entityId)) p.entities.push(entityId)
    })

    this.entityMgr.on('building_placed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p && !p.entities.includes(entityId)) p.entities.push(entityId)
    })

    this.entityMgr.on('unit_destroyed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.entities = p.entities.filter(id => id !== entityId)
      // Notify HUD
      if (playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Unit lost', type: 'danger' })
      }
    })

    this.entityMgr.on('building_destroyed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.entities = p.entities.filter(id => id !== entityId)
      if (playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('buildingLost', { defId: entityId })
      }
    })

    // Building under attack — alert if player's building
    this.entityMgr.on('building_died', (b: { playerId: number; x: number; y: number }) => {
      if (b.playerId === 0) {
        this.lastAlertPos = { x: b.x, y: b.y }
        this.registry.set('lastAlertPos', this.lastAlertPos)
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('underAttack')
      }
    })
  }

  // ── Economy event wiring ─────────────────────────────────────

  private wireEconomyEvents(): void {
    // Keep gameState.players in sync with Economy's credit/power state
    this.economy.on('credits_changed', (playerId: number, newAmount: number) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.credits = newAmount
    })

    this.economy.on('power_state_changed', (playerId: number) => {
      const ps = this.economy.getPowerState(playerId)
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) {
        p.powerGenerated = ps.generated
        p.powerConsumed = ps.consumed
        p.power = ps.generated - ps.consumed
      }
    })
  }

  // ── HUD → GameScene event wiring ──────────────────────────────

  private wireHUDEvents(): void {
    // Place building from HUD placement mode
    this.events.on('placeBuilding', (data: { defId: string; tileCol: number; tileRow: number }) => {
      const def = BUILDING_DEFS[data.defId]
      if (!def) return

      // Adjacency check: must be within 3 tiles of existing building
      if (!this.isAdjacentToOwnBuildings(data.tileCol, data.tileRow, def.footprint.w, def.footprint.h, 0)) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Must build near existing structures', type: 'danger' })
        return
      }

      // Check tiles are buildable
      for (let r = 0; r < def.footprint.h; r++) {
        for (let c = 0; c < def.footprint.w; c++) {
          if (!this.gameMap.isBuildable(data.tileCol + c, data.tileRow + r)) {
            const hud = this.scene.get('HUDScene')
            if (hud) hud.events.emit('evaAlert', { message: 'Cannot build here', type: 'danger' })
            return
          }
        }
      }

      const building = this.entityMgr.createBuilding(0, data.defId, data.tileCol, data.tileRow)
      if (building) {
        // Mark tiles as occupied
        for (const tile of building.occupiedTiles) {
          this.gameMap.setOccupied(tile.col, tile.row, building.id)
        }

        const hud = this.scene.get('HUDScene')
        if (hud) {
          hud.events.emit('evaAlert', { message: 'Construction complete', type: 'success' })
          hud.events.emit('productionComplete', { defId: data.defId })
        }

        // RA2: Refinery spawns a free harvester
        if (data.defId === 'ore_refinery') {
          this.spawnFreeHarvester(building)
        }
      }
    })

    // Sell building
    this.events.on('sellBuilding', (data: { entityId: string }) => {
      const building = this.entityMgr.getBuilding(data.entityId)
      if (!building || building.playerId !== 0) return
      const refund = building.sell()
      if (refund > 0) {
        this.economy.addCredits(0, refund)
        // Free occupied tiles
        for (const tile of building.occupiedTiles) {
          this.gameMap.setOccupied(tile.col, tile.row, null)
        }
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: `Building sold ($${refund})`, type: 'warning' })
      }
    })

    // Unit produced from HUD build panel
    this.events.on('unitProduced', (data: { defId: string }) => {
      console.log('[Pipeline] HUD -> GameScene unitProduced', data)

      const producer = this.findProducerForUnit(0, data.defId)
      if (!producer) {
        console.warn(`[Pipeline] No active producer found for unit ${data.defId}`)
        return
      }

      const spawn = this.getProducerExitSpawn(producer)
      const unit = this.entityMgr.createUnit(0, data.defId, spawn.x, spawn.y)
      if (unit) {
        // Auto-harvest if harvester
        if (unit.def.category === 'harvester') {
          const refinery = this.entityMgr.getNearestRefinery(unit.x, unit.y, 0)
          if (refinery) unit.setRefineryId(refinery.id)
          unit.emit('find_ore_field', unit.x, unit.y, (target: Position | null) => {
            if (target) unit.giveOrder({ type: 'harvest', target })
          })
        }

        // Rally point
        if (producer.rallyPoint && unit.def.category !== 'harvester') {
          unit.giveOrder({ type: 'move', target: producer.rallyPoint })
        }

        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Unit ready', type: 'success' })
      }
    })

    // Issue order from HUD (guard, stop, etc.)
    this.events.on('issueOrder', (data: { ids: string[]; type: string; target?: Position }) => {
      for (const id of data.ids) {
        const unit = this.entityMgr.getUnit(id)
        if (!unit || unit.playerId !== 0) continue
        unit.giveOrder({ type: data.type as any, target: data.target })
      }
    })

    // Cursor mode changed from HUD
    this.events.on('cursorModeChanged', (data: { mode: string }) => {
      this.cursorMode = data.mode
    })

    // Start production event from HUD (for build queue tracking)
    this.events.on('startProduction', (data: { defId: string; type: string }) => {
      // HUDScene currently owns the progress bar timing; GameScene receives this for pipeline tracing.
      console.log('[Pipeline] HUD -> GameScene startProduction', data)
    })

    // Cancel production event from HUD (for queue/progress tracking)
    this.events.on('cancelProduction', (_data: { defId: string; type: string; refund: number }) => {
      // HUDScene currently owns player build queue/progress state.
    })
  }

  // ── Production system event wiring ─────────────────────────────

  private wireProductionEvents(): void {
    this.production.on('unit_produced', (
      producerId: string, defId: string, unitId: string, playerId: number
    ) => {
      console.log('[Pipeline] Production -> GameScene unit_produced', { producerId, defId, unitId, playerId })
      if (playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Unit ready', type: 'success' })
      }
    })
  }

  // ── Ore event wiring (harvester ↔ tile map) ──────────────────

  private wireOreEvents(): void {
    const { tiles, width, height } = this.gameMap.data

    // Harvester asks: "how much ore is near me?" (called every harvest tick)
    this.entityMgr.on('check_ore_at', (x: number, y: number, cb: (amount: number, pos: Position) => void) => {
      const origin = this.gameMap.worldToTile(x, y)
      const searchR = 2
      let bestOre = 0
      let bestPos: Position = { x, y }

      for (let dr = -searchR; dr <= searchR; dr++) {
        for (let dc = -searchR; dc <= searchR; dc++) {
          const tc = origin.col + dc
          const tr = origin.row + dr
          if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
          const t = tiles[tr]?.[tc]
          if (t && t.oreAmount > bestOre) {
            bestOre = t.oreAmount
            bestPos = this.gameMap.tileToWorld(tc, tr)
          }
        }
      }
      cb(bestOre, bestPos)
    })

    // Harvester depletes ore from the tile it harvested
    this.entityMgr.on('ore_harvested', (tilePos: Position, amount: number) => {
      const tc = this.gameMap.worldToTile(tilePos.x, tilePos.y)
      const tileData = this.gameMap.getTile(tc.col, tc.row)
      if (tileData && tileData.oreAmount > 0) {
        tileData.oreAmount = Math.max(0, tileData.oreAmount - amount)
      }
    })

    // Harvester asks: "where is the nearest ore field?"
    this.entityMgr.on('find_ore_field', (x: number, y: number, cb: (pos: Position | null) => void) => {
      const origin = this.gameMap.worldToTile(x, y)
      let foundPos: Position | null = null
      const maxRadius = Math.min(width, height) / 2

      for (let radius = 1; radius <= maxRadius && foundPos === null; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
            const tc = origin.col + dc
            const tr = origin.row + dr
            if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
            const t = tiles[tr]?.[tc]
            if (t && t.oreAmount > 100) {
              foundPos = this.gameMap.tileToWorld(tc, tr)
            }
          }
          if (foundPos !== null) break
        }
      }

      cb(foundPos)
    })
  }

  // ── Building adjacency check ────────────────────────────────────

  private isAdjacentToOwnBuildings(
    col: number, row: number, w: number, h: number, playerId: number
  ): boolean {
    const maxDist = 3  // tiles
    const buildings = this.entityMgr.getBuildingsForPlayer(playerId)
    if (buildings.length === 0) return true  // first building can go anywhere

    for (const b of buildings) {
      if (b.state === 'dying') continue
      for (const tile of b.occupiedTiles) {
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const dc = Math.abs(tile.col - (col + c))
            const dr = Math.abs(tile.row - (row + r))
            if (dc <= maxDist && dr <= maxDist) return true
          }
        }
      }
    }
    return false
  }

  // ── Free harvester on refinery placement (RA2 authentic) ────────

  private spawnFreeHarvester(refinery: import('../entities/Building').Building): void {
    const { tiles, width, height } = this.gameMap.data
    const spawnX = refinery.x + refinery.def.footprint.w * TILE_SIZE / 2 + TILE_SIZE
    const spawnY = refinery.y
    // Use side-appropriate harvester type
    const player = this.gameState.players.find(p => p.id === refinery.playerId)
    const side: FactionSide = player ? FACTIONS[player.faction].side : 'alliance'
    const harvesterDefId = getHarvesterDefId(side)
    const hv = this.entityMgr.createUnit(refinery.playerId, harvesterDefId, spawnX, spawnY)
    if (hv) {
      hv.setRefineryId(refinery.id)
      // Find nearest ore
      const origin = this.gameMap.worldToTile(hv.x, hv.y)
      let sent = false
      for (let radius = 1; radius <= 40 && !sent; radius++) {
        for (let dr = -radius; dr <= radius && !sent; dr++) {
          for (let dc = -radius; dc <= radius && !sent; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
            const tc = origin.col + dc, tr = origin.row + dr
            if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
            if ((tiles[tr]?.[tc]?.oreAmount ?? 0) > 100) {
              hv.giveOrder({ type: 'harvest', target: this.gameMap.tileToWorld(tc, tr) })
              sent = true
            }
          }
        }
      }

      if (refinery.playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Harvester deployed', type: 'info' })
      }
    }
  }

  private findProducerForUnit(
    playerId: number,
    defId: string,
  ): import('../entities/Building').Building | null {
    const unitDef = UNIT_DEFS[defId]
    if (!unitDef) return null

    const buildings = this.entityMgr.getBuildingsForPlayer(playerId)
      .filter(b => b.state === 'active')

    const producerByCategory: Record<string, string[]> = {
      infantry: ['barracks'],
      vehicle: ['war_factory'],
      aircraft: ['air_force_command', 'war_factory'],
      naval: ['naval_shipyard'],
      harvester: ['ore_refinery', 'war_factory'],
    }

    const candidates = producerByCategory[unitDef.category] ?? []
    for (const producerDefId of candidates) {
      const found = buildings.find(b => b.def.id === producerDefId)
      if (found) return found
    }

    return null
  }

  private getProducerExitSpawn(
    producer: import('../entities/Building').Building,
  ): Position {
    const spawn = {
      x: producer.x + producer.def.footprint.w * TILE_SIZE / 2 + TILE_SIZE,
      y: producer.y,
    }

    const maxX = this.gameMap.worldWidth - TILE_SIZE
    const maxY = this.gameMap.worldHeight - TILE_SIZE

    return {
      x: Phaser.Math.Clamp(spawn.x, TILE_SIZE, Math.max(TILE_SIZE, maxX)),
      y: Phaser.Math.Clamp(spawn.y, TILE_SIZE, Math.max(TILE_SIZE, maxY)),
    }
  }

  // ── Spawn starting entities ───────────────────────────────────

  private spawnStartingEntities(): void {
    const { startPositions } = this.gameMap.data
    const { tiles, width, height } = this.gameMap.data
    const players = this.gameState.players

    console.log('[IC] spawnStartingEntities:', players.length, 'players,',
      startPositions.length, 'start positions')

    players.forEach((player, i) => {
      const spawnWorld = startPositions[i] ?? startPositions[0]
      const st = this.gameMap.worldToTile(spawnWorld.x, spawnWorld.y)
      const side: FactionSide = FACTIONS[player.faction].side
      console.log(`[IC] Player ${player.id} (${player.faction}/${side}) spawn: tile(${st.col},${st.row}) world(${spawnWorld.x},${spawnWorld.y})`)

      // Construction Yard — start active
      const cy = this.entityMgr.createBuilding(player.id, 'construction_yard',
        st.col - 1, st.row - 1)
      if (cy) cy.state = 'active'
      else console.error(`[IC] FAILED to create Construction Yard for player ${player.id}`)

      // Side-appropriate Power Building — start active
      const powerDefId = getPowerBuildingDefId(side)
      const pp = this.entityMgr.createBuilding(player.id, powerDefId,
        st.col + 3, st.row - 1)
      if (pp) pp.state = 'active'

      // Ore Refinery — start active
      const ref = this.entityMgr.createBuilding(player.id, 'ore_refinery',
        st.col - 1, st.row + 3)
      if (ref) ref.state = 'active'

      // Side-appropriate Harvester — find nearest ore and auto-send
      const harvesterDefId = getHarvesterDefId(side)
      const hv = this.entityMgr.createUnit(player.id, harvesterDefId,
        spawnWorld.x + TILE_SIZE * 2, spawnWorld.y + TILE_SIZE * 3)
      if (hv) {
        if (ref) hv.setRefineryId(ref.id)
        // Find nearest ore tile and send harvester there immediately
        const origin = this.gameMap.worldToTile(hv.x, hv.y)
        let sent = false
        for (let radius = 1; radius <= 40 && !sent; radius++) {
          for (let dr = -radius; dr <= radius && !sent; dr++) {
            for (let dc = -radius; dc <= radius && !sent; dc++) {
              if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
              const tc = origin.col + dc, tr = origin.row + dr
              if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
              if ((tiles[tr]?.[tc]?.oreAmount ?? 0) > 100) {
                hv.giveOrder({ type: 'harvest', target: this.gameMap.tileToWorld(tc, tr) })
                sent = true
              }
            }
          }
        }
      }

      // 2 basic infantry flanking the base (side-appropriate)
      const infantryDefId = getBasicInfantryDefId(side)
      for (let j = 0; j < 2; j++) {
        this.entityMgr.createUnit(player.id, infantryDefId,
          spawnWorld.x - TILE_SIZE * 3 + j * TILE_SIZE * 2,
          spawnWorld.y + TILE_SIZE)
      }
    })
  }

  // ── Fog of War ────────────────────────────────────────────────

  private updateFogOfWar(): void {
    const sources: Array<{ pos: TileCoord; range: number }> = []
    const localId = this.gameState.localPlayerId

    // Scan all units + buildings belonging to human player
    for (const u of this.entityMgr.getAllUnits()) {
      if (u.playerId === localId && u.hp > 0) {
        const pos = this.gameMap.worldToTile(u.x, u.y)
        sources.push({ pos, range: u.def.stats.sightRange })
      }
    }
    for (const b of this.entityMgr.getAllBuildings()) {
      if (b.playerId === localId && b.hp > 0) {
        const pos = this.gameMap.worldToTile(b.x, b.y)
        sources.push({ pos, range: b.def.stats.sightRange })
      }
    }
    sources.push(...this.fogAnchorSources)

    // Always call updateFog — even with 0 sources, it resets VISIBLE→EXPLORED
    // and re-renders. Skipping it when sources=0 would leave stale full-black fog.
    this.gameMap.updateFog(sources)
  }

  // (duplicate wireHUDEvents removed — kept the comprehensive version above)

  // ── Input ─────────────────────────────────────────────────────

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D,H') as Record<string, Phaser.Input.Keyboard.Key>
    this.input.mouse?.disableContextMenu()

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const mouseEvent = ptr.event as MouseEvent | undefined
      const button = ptr.button ?? mouseEvent?.button ?? -1

      if (button === 2 || ptr.rightButtonDown()) {
        this.handleRightClick(ptr)
        return
      }

      if (button !== 0 && !ptr.leftButtonDown()) return

      // Sell/repair cursor modes
      if (this.cursorMode === 'sell') {
        this.handleSellClick(ptr)
        return
      }
      if (this.cursorMode === 'repair') {
        this.handleRepairClick(ptr)
        return
      }

      // Ctrl+click = force fire
      if (mouseEvent?.ctrlKey && this.selectedIds.size > 0) {
        this.handleForceAttack(ptr)
        return
      }

      this.startDragSelect(ptr)
    })

    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.isLeftPointerActive || !ptr.leftButtonDown()) return
      this.updateDragSelect(ptr)
    })

    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if (!this.isLeftPointerActive) return

      if (this.isDragging) {
        this.endDragSelect(ptr)
      } else {
        this.handleLeftClick(ptr)
      }

      this.isLeftPointerActive = false
      this.isDragging = false
      this.selectionRect.clear()
    })

    // ESC — deselect all
    this.input.keyboard!.on('keydown-ESC', () => this.deselectAll())

    // S — stop selected units (only if units selected; otherwise let WASD handle camera)
    this.input.keyboard!.on('keydown-S', () => {
      if (this.selectedIds.size > 0) {
        this.selectedIds.forEach(id => {
          this.entityMgr.getUnit(id)?.giveOrder({ type: 'stop' })
        })
      }
    })

    // H — snap camera to home base
    this.input.keyboard!.on('keydown-H', () => {
      const home = this.gameMap.data.startPositions[0]
      if (home) {
        this.camX = home.x - this.scale.width / 2
        this.camY = home.y - this.scale.height / 2
      }
    })

    // A — attack-move: enter attack-move cursor mode
    this.input.keyboard!.on('keydown-A', () => {
      if (this.selectedIds.size === 0) return
      this.cursorMode = 'attackMove'
    })

    // G — guard mode: units hold position and auto-engage
    this.input.keyboard!.on('keydown-G', () => {
      this.selectedIds.forEach(id => {
        const unit = this.entityMgr.getUnit(id)
        if (unit && unit.playerId === 0) {
          unit.giveOrder({ type: 'guard' })
        }
      })
      if (this.selectedIds.size > 0) this.showUnitAck('Guard position')
    })

    // D — deploy (GI/Conscript toggle fortified, MCV deploy/undeploy)
    this.input.keyboard!.on('keydown-D', () => {
      this.selectedIds.forEach(id => {
        const unit = this.entityMgr.getUnit(id)
        if (!unit || unit.playerId !== 0) return
        // Toggle guard mode as "deploy" (fortified position: can't move, auto-engage)
        if (unit.def.category === 'infantry' || unit.def.id === 'mcv') {
          if (unit.state === 'idle') {
            unit.giveOrder({ type: 'guard' })
            this.showUnitAck('Deployed')
          } else {
            unit.giveOrder({ type: 'stop' })
            this.showUnitAck('Undeployed')
          }
        }
      })
    })

    // X — scatter: units spread out (anti-splash)
    this.input.keyboard!.on('keydown-X', () => {
      this.selectedIds.forEach(id => {
        const unit = this.entityMgr.getUnit(id)
        if (unit && unit.playerId === 0) {
          // Move to a random nearby position
          const angle = Math.random() * Math.PI * 2
          const dist = TILE_SIZE * 2 + Math.random() * TILE_SIZE * 2
          unit.giveOrder({
            type: 'move',
            target: {
              x: unit.x + Math.cos(angle) * dist,
              y: unit.y + Math.sin(angle) * dist,
            },
          })
        }
      })
      if (this.selectedIds.size > 0) this.showUnitAck('Scatter!')
    })

    // Z — waypoint mode: hold Z, click multiple points, units queue move orders
    this.input.keyboard!.on('keydown-Z', () => {
      if (this.selectedIds.size === 0) return
      this.waypointMode = true
      this.showUnitAck('Waypoint mode')
    })
    this.input.keyboard!.on('keyup-Z', () => {
      this.waypointMode = false
    })
  }

  // ── Ctrl+click force fire ──────────────────────────────────────

  private handleForceAttack(ptr: Phaser.Input.Pointer): void {
    const worldX = ptr.worldX
    const worldY = ptr.worldY

    // Find ANY entity near click (friendly or enemy)
    const allUnits = this.entityMgr.getUnitsInRange(worldX, worldY, TILE_SIZE * 2)
    const allBuildings = this.entityMgr.getBuildingsInRange(worldX, worldY, TILE_SIZE * 2)
    const target = allUnits[0] ?? allBuildings[0]

    this.selectedIds.forEach(id => {
      const unit = this.entityMgr.getUnit(id)
      if (!unit || unit.playerId !== 0) return
      if (target) {
        unit.giveOrder({ type: 'attack', targetEntityId: target.id })
      }
    })
    this.showUnitAck('Attacking')
  }

  // ── Sell mode click ──────────────────────────────────────────────
  private handleSellClick(ptr: Phaser.Input.Pointer): void {
    const worldX = ptr.worldX
    const worldY = ptr.worldY
    const buildings = this.entityMgr.getBuildingsInRange(worldX, worldY, TILE_SIZE * 2)
      .filter(b => b.playerId === 0 && b.state !== 'dying')

    if (buildings.length > 0) {
      const building = buildings[0]
      const refund = building.sell()
      if (refund > 0) {
        this.economy.addCredits(0, refund)
        for (const tile of building.occupiedTiles) {
          this.gameMap.setOccupied(tile.col, tile.row, null)
        }
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: `Building sold ($${refund})`, type: 'warning' })
      }
    }
    this.cursorMode = 'normal'
  }

  // ── Repair mode click ─────────────────────────────────────────────
  private handleRepairClick(ptr: Phaser.Input.Pointer): void {
    const worldX = ptr.worldX
    const worldY = ptr.worldY
    const buildings = this.entityMgr.getBuildingsInRange(worldX, worldY, TILE_SIZE * 2)
      .filter(b => b.playerId === 0 && b.state !== 'dying')

    if (buildings.length > 0) {
      const building = buildings[0]
      const credits = this.economy.getCredits(0)
      const cost = building.repair(credits)
      if (cost > 0) {
        this.economy.deductCredits(0, cost)
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: `Repaired ($${cost})`, type: 'success' })
      } else {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'No repairs needed', type: 'info' })
      }
    }
    this.cursorMode = 'normal'
  }

  private handleRightClick(ptr: Phaser.Input.Pointer): void {
    ;(ptr.event as MouseEvent | undefined)?.preventDefault()
    this.cursorMode = 'normal'
    this.deselectAll()
  }

  // ── Unit acknowledgment text popup ─────────────────────────────

  private showUnitAck(msg: string): void {
    if (this.selectedIds.size === 0) return

    // Show near first selected unit
    const firstId = Array.from(this.selectedIds)[0]
    const unit = this.entityMgr.getUnit(firstId)
    if (!unit) return

    // Pick a random ack line or use the provided message
    const category = unit.def.category
    const lines = ACK_LINES[category] ?? ACK_LINES['infantry']
    const line = msg || lines[Math.floor(Math.random() * lines.length)]

    const text = this.add.text(unit.x, unit.y - 24, line, {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(100)

    this.tweens.add({
      targets: text,
      y: text.y - 20,
      alpha: 0,
      duration: 1200,
      onComplete: () => text.destroy(),
    })
  }

  private startDragSelect(ptr: Phaser.Input.Pointer): void {
    this.isLeftPointerActive = true
    this.isDragging = false
    this.dragAnchorScreen = { x: ptr.x, y: ptr.y }
    this.dragAnchorWorld  = { x: ptr.worldX, y: ptr.worldY }
  }

  private updateDragSelect(ptr: Phaser.Input.Pointer): void {
    const dragDist = Phaser.Math.Distance.Between(
      this.dragAnchorScreen.x, this.dragAnchorScreen.y, ptr.x, ptr.y,
    )
    if (!this.isDragging && dragDist <= 5) return
    this.isDragging = true

    // Draw in screen space (scroll-factor 0)
    const sx1 = Math.min(this.dragAnchorScreen.x, ptr.x)
    const sy1 = Math.min(this.dragAnchorScreen.y, ptr.y)
    const sx2 = Math.max(this.dragAnchorScreen.x, ptr.x)
    const sy2 = Math.max(this.dragAnchorScreen.y, ptr.y)

    this.selectionRect.clear()
    this.selectionRect.fillStyle(0x00ff00, 0.1)
    this.selectionRect.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1)
    this.selectionRect.lineStyle(1, 0x00ff00, 0.8)
    this.selectionRect.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1)
  }

  private endDragSelect(ptr: Phaser.Input.Pointer): void {
    const shiftHeld = !!(ptr.event as MouseEvent)?.shiftKey
    const x1 = Math.min(this.dragAnchorWorld.x, ptr.worldX)
    const y1 = Math.min(this.dragAnchorWorld.y, ptr.worldY)
    const x2 = Math.max(this.dragAnchorWorld.x, ptr.worldX)
    const y2 = Math.max(this.dragAnchorWorld.y, ptr.worldY)

    if (!shiftHeld) this.deselectAll()

    // Select player 0 units within the drag rect
    const units = this.entityMgr.getUnitsForPlayer(0)
    units.forEach(u => {
      if (u.x >= x1 && u.x <= x2 && u.y >= y1 && u.y <= y2) {
        this.selectedIds.add(u.id)
        u.setSelected(true)
      }
    })

    this.syncSelectionState()
  }

  private handleLeftClick(ptr: Phaser.Input.Pointer): void {
    const worldX = ptr.worldX
    const worldY = ptr.worldY
    const shiftHeld = !!(ptr.event as MouseEvent)?.shiftKey

    // Attack-move mode consumes the next left click.
    if (this.cursorMode === 'attackMove') {
      this.selectedIds.forEach(id => {
        this.entityMgr.getUnit(id)?.giveOrder({
          type: 'attackMove',
          target: { x: worldX, y: worldY },
        })
      })
      this.cursorMode = 'normal'
      this.showUnitAck('Attack-moving')
      return
    }

    const ownUnit = this.getOwnUnitAt(worldX, worldY)
    if (ownUnit) {
      if (!shiftHeld) this.deselectAll()
      if (shiftHeld && this.selectedIds.has(ownUnit.id)) {
        this.selectedIds.delete(ownUnit.id)
        ownUnit.setSelected(false)
      } else {
        this.selectedIds.add(ownUnit.id)
        ownUnit.setSelected(true)
      }
      this.syncSelectionState()
      return
    }

    if (this.selectedIds.size === 0) {
      if (!shiftHeld) this.deselectAll()
      return
    }

    const clickRadius = TILE_SIZE * 2
    const enemies = this.entityMgr.getEnemyUnitsInRange(worldX, worldY, clickRadius, 0)
    const enemyBuilds = this.entityMgr.getEnemyBuildingsInRange(worldX, worldY, clickRadius, 0)
    const attackTarget = enemies[0] ?? enemyBuilds[0]
    if (attackTarget) {
      this.selectedIds.forEach(id => {
        const unit = this.entityMgr.getUnit(id)
        if (!unit || unit.playerId !== 0) return
        unit.giveOrder({ type: 'attack', targetEntityId: attackTarget.id })
      })
      this.showUnitAck('Attacking')
      return
    }

    const clickTile = this.gameMap.worldToTile(worldX, worldY)
    const tile = this.gameMap.getTile(clickTile.col, clickTile.row)
    let harvestIssued = false
    let moveIssued = false

    this.selectedIds.forEach(id => {
      const unit = this.entityMgr.getUnit(id)
      if (!unit || unit.playerId !== 0) return

      if (tile?.terrain === TerrainType.ORE && unit.def.category === 'harvester') {
        unit.giveOrder({ type: 'harvest', target: { x: worldX, y: worldY } })
        harvestIssued = true
      } else {
        unit.giveOrder({ type: 'move', target: { x: worldX, y: worldY } })
        moveIssued = true
      }
    })

    if (harvestIssued && !moveIssued) this.showUnitAck('Harvesting')
    else this.showUnitAck('Moving out')
  }

  private getOwnUnitAt(worldX: number, worldY: number): import('../entities/Unit').Unit | null {
    const hitRadius = TILE_SIZE * 0.75
    let bestUnit: import('../entities/Unit').Unit | null = null
    let bestDist = Infinity

    for (const unit of this.entityMgr.getUnitsForPlayer(0)) {
      const dist = Phaser.Math.Distance.Between(worldX, worldY, unit.x, unit.y)
      if (dist <= hitRadius && dist < bestDist) {
        bestUnit = unit
        bestDist = dist
      }
    }

    return bestUnit
  }

  private syncSelectionState(): void {
    this.gameState.selectedEntityIds = Array.from(this.selectedIds)
    this.registry.set('selectedIds', this.gameState.selectedEntityIds)
  }

  private deselectAll(): void {
    this.selectedIds.forEach(id => this.entityMgr.getUnit(id)?.setSelected(false))
    this.selectedIds.clear()
    this.syncSelectionState()
  }

  private handleCameraScroll(delta: number): void {
    // Camera target snap is handled by handleCameraTarget() already
    const dt = delta / 1000
    const speed = this.camSpeed
    let dx = 0, dy = 0

    if (this.cursors.left.isDown  || this.wasdKeys['A']?.isDown) dx -= speed * dt
    if (this.cursors.right.isDown || this.wasdKeys['D']?.isDown) dx += speed * dt
    if (this.cursors.up.isDown    || this.wasdKeys['W']?.isDown) dy -= speed * dt
    if (this.cursors.down.isDown  || this.wasdKeys['S']?.isDown) dy += speed * dt

    // Edge scrolling (20px border)
    const ptr = this.input.activePointer
    const edgeW = 20
    const W = this.scale.width
    const H = this.scale.height
    if (ptr.x < edgeW)     dx -= speed * dt
    if (ptr.x > W - edgeW) dx += speed * dt
    if (ptr.y < edgeW)     dy -= speed * dt
    if (ptr.y > H - edgeW) dy += speed * dt

    this.camX += dx
    this.camY += dy
  }

  // ── Win / Loss ────────────────────────────────────────────────

  private checkWinCondition(): void {
    const players = this.gameState.players

    // Mark AI players as defeated if no buildings remain
    players.filter(p => p.isAI).forEach(p => {
      const aliveBuildings = this.entityMgr.getBuildingsForPlayer(p.id)
        .filter(b => b.state !== 'dying')
      if (aliveBuildings.length === 0 && p.entities.length > 0) {
        p.isDefeated = true
      }
    })

    if (players.filter(p => p.isAI).every(p => p.isDefeated)) {
      this.triggerVictory()
      return
    }

    const humanBuildings = this.entityMgr.getBuildingsForPlayer(0)
      .filter(b => b.state !== 'dying')
    const human = players.find(p => p.id === 0)!
    if (humanBuildings.length === 0 && human.entities.length > 0) {
      this.triggerDefeat()
    }
  }

  private triggerVictory(): void {
    if (this.gameState.phase !== 'playing') return
    this.gameState.phase = 'victory'
    this.showEndScreen('MISSION COMPLETE', '#44ee44')
  }

  private triggerDefeat(): void {
    if (this.gameState.phase !== 'playing') return
    this.gameState.phase = 'defeat'
    this.showEndScreen('MISSION FAILED', '#ee4444')
  }

  private showEndScreen(msg: string, color: string): void {
    const { width, height } = this.scale

    const overlay = this.add.graphics()
    overlay.setScrollFactor(0).setDepth(200)
    overlay.fillStyle(0x000000, 0.7)
    overlay.fillRect(0, 0, width, height)

    this.add.text(width / 2, height / 2 - 40, msg, {
      fontFamily: 'monospace', fontSize: '48px', color,
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0)

    this.time.delayedCall(4000, () => {
      this.scene.stop('HUDScene')
      this.scene.start('MenuScene')
    })
  }
}
