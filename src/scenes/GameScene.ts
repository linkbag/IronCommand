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
import { BUILDING_DEFS, getPowerBuildingDefId, SUPERWEAPON_BUILDING_IDS } from '../entities/BuildingDefs'
import { UNIT_DEFS, getHarvesterDefId, getBasicInfantryDefId } from '../entities/UnitDefs'
import type { Position, TileCoord, GameState, Player, GamePhase, FactionId, FactionSide } from '../types'
import { TILE_SIZE, STARTING_CREDITS, TerrainType, FogState, DamageType, NEUTRAL_PLAYER_ID } from '../types'
import { cartToScreen, screenToCart, getIsoWorldBounds } from '../engine/IsoUtils'
import { FACTIONS } from '../data/factions'
import type { SkirmishConfig } from './SetupScene'

// Unit acknowledgment lines
const ACK_LINES: Record<string, string[]> = {
  infantry: ['Yes sir!', 'Affirmative', 'Moving out', 'On it!', 'Copy that'],
  vehicle: ['Rolling out', 'Moving', 'Acknowledged', 'On the way'],
  aircraft: ['Airborne!', 'Wilco', 'Roger that'],
  harvester: ['Returning', 'Harvesting', 'On my way'],
}
const PLAYER_TINT = 0x4488ff
const AI_TINTS = [0xff4444, 0xff8800, 0xaa44ff, 0x44cc44, 0xffdd00, 0x44dddd, 0xff66aa] // red, orange, purple, green, yellow, cyan, pink
const PRODUCER_BUILDING_IDS = ['barracks', 'war_factory', 'air_force_command', 'naval_shipyard', 'ore_refinery'] as const

export class GameScene extends Phaser.Scene {
  // ── IRTSScene interface (Unit.ts calls these via scene cast) ──
  findPath: (from: TileCoord, to: TileCoord, playerId?: number, unitId?: string) => TileCoord[] =
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
  private camTargetX = 0
  private camTargetY = 0
  private camSpeed = 400  // px/s
  private camLerp = 0.16
  private edgeFadeOverlay!: Phaser.GameObjects.Graphics

  // ── Input ───────────────────────────────────────────────────
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>
  private isDragging = false
  private isLeftPointerActive = false
  private dragAnchorScreen = { x: 0, y: 0 }
  private cursorMode: string = 'normal'
  private patrolAnchorByUnit: Map<string, Position> = new Map()

  // ── Selection ───────────────────────────────────────────────
  private selectionRect!: Phaser.GameObjects.Graphics
  private rallyOverlay!: Phaser.GameObjects.Graphics
  private selectedIds: Set<string> = new Set()
  private selectionPulseTweens: Map<string, Phaser.Tweens.Tween> = new Map()

  // ── Last alert position (for Space key) ────────────────────
  private lastAlertPos: Position | null = null
  private lastUnderAttackAlertMs = 0
  private fogAnchorSources: Array<{ pos: TileCoord; range: number }> = []
  private playerSpawnIndexById: Map<number, number> = new Map()
  private waypointMode = false
  private paratrooperCooldownMs: Map<number, number> = new Map()
  private gameOver = false
  private matchStartMs = 0
  private playerUnitsKilled = 0
  private playerBuildingsDestroyed = 0
  private lastCombatMs = 0
  private staleMateBoostActive = false
  private paused = false
  private pauseOverlay?: Phaser.GameObjects.Rectangle
  private pauseText?: Phaser.GameObjects.Text
  private blockerNudgeCooldownMs: Map<string, number> = new Map()
  private forceFullMapReveal = false
  private silentDespawnIds: Set<string> = new Set()

  constructor() {
    super({ key: 'GameScene' })
  }

  init(data: { config: SkirmishConfig }) {
    this.skirmishCfg = data?.config ?? {
      playerFaction: 'usa',
      mapSize: 'small',
      revealMap: false,
      mapTemplate: 'continental',
      mapSeed: Math.floor(Math.random() * 99999) + 1,
      playerSpawn: -1,
      aiCount: 1,
      aiDifficulty: 'medium',
      startingCredits: STARTING_CREDITS,
      allyPlayerIds: [],
    }
    // Reset per-session state
    this.aiCommanders = []
    this.selectedIds = new Set()
    this.camX = 0
    this.camY = 0
    this.camTargetX = 0
    this.camTargetY = 0
    this.cursorMode = 'normal'
    this.patrolAnchorByUnit = new Map()
    this.selectionPulseTweens.forEach(tw => tw.stop())
    this.selectionPulseTweens = new Map()
    this.lastAlertPos = null
    this.lastUnderAttackAlertMs = 0
    this.fogAnchorSources = []
    this.playerSpawnIndexById = new Map()
    this.waypointMode = false
    this.paratrooperCooldownMs = new Map()
    this.gameOver = false
    this.matchStartMs = 0
    this.playerUnitsKilled = 0
    this.playerBuildingsDestroyed = 0
    this.lastCombatMs = 0
    this.staleMateBoostActive = false
    this.paused = false
    this.pauseOverlay?.destroy()
    this.pauseOverlay = undefined
    this.pauseText?.destroy()
    this.pauseText = undefined
    this.rallyOverlay?.destroy()
    this.blockerNudgeCooldownMs = new Map()
    this.forceFullMapReveal = false
    this.silentDespawnIds = new Set()
  }

  create() {
    try { this._createInternal() } catch (e) {
      console.error('[IC] FATAL: GameScene.create() crashed:', e)
      // Show error on screen so user can see it
      this.add.text(100, 100, `CRASH: ${e}`, {
        fontFamily: 'monospace', fontSize: '14px', color: '#ff4444',
        wordWrap: { width: this.scale.width - 200 }
      }).setScrollFactor(0).setDepth(9999)
    }
  }

  private _createInternal() {
    const cfg = this.skirmishCfg

    // ── 1. Procedural map ─────────────────────────────────────
    try {
    const mapDims: Record<string, number> = { small: 64, medium: 128, large: 256 }
    const mapSize = mapDims[cfg.mapSize] ?? 64
    const seed = cfg.mapSeed ?? Math.floor(Math.random() * 99999) + 1
    this.gameMap = new GameMap(this, mapSize, mapSize, seed, cfg.mapTemplate)
    this.gameMap.renderTerrain()
    // NOTE: Don't pre-render fog as full black here. All tiles start HIDDEN.
    // updateFogOfWar() at the end of create() will reveal + render fog properly.
    } catch (e) { console.error('[IC] CRASH in section 1 (map):', e); throw e }

    // ── 2. Pathfinder ─────────────────────────────────────────
    try {
    this.pathfinder = new Pathfinder(this.gameMap)

    // Wire IRTSScene methods (Unit calls these via scene cast)
    this.findPath = (from, to, playerId, unitId) => {
      // Determine movement mode: air ignores terrain, naval needs water
      let isAir = false
      let isNaval = false
      if (unitId) {
        const unit = this.entityMgr?.getUnit(unitId)
        if (unit) {
          isAir = unit.def.category === 'aircraft'
          isNaval = unit.def.category === 'naval'
        }
      }
      return this.pathfinder.findPath(from, to, isAir, unitId, playerId, isNaval)
    }
    this.worldToTile = (x, y) => this.gameMap.worldToTile(x, y)
    this.tileToWorld = (col, row) => this.gameMap.tileToWorld(col, row)
    } catch (e) { console.error('[IC] CRASH in section 2 (pathfinder):', e); throw e }

    // ── 3. Entity manager ─────────────────────────────────────
    try {
    this.entityMgr = new EntityManager(this)
    this.pathfinder.setUnitTileProvider(() =>
      this.entityMgr.getAllUnits()
        .filter(u => u.hp > 0 && u.state !== 'dying')
        .map(u => ({ id: u.id, col: Math.floor(u.x / TILE_SIZE), row: Math.floor(u.y / TILE_SIZE), state: u.state }))
    )
    this.pathfinder.setIdleUnitNudgeHandler((tile, excludeUnitId) => this.nudgeIdleBlocker(tile, excludeUnitId))
    } catch (e) { console.error('[IC] CRASH in section 3 (entity manager):', e); throw e }

    // ── 4. Combat system ──────────────────────────────────────
    try {
    this.combat = new Combat(this, this.entityMgr)
    } catch (e) { console.error('[IC] CRASH in section 4 (combat):', e); throw e }

    // ── 5. Build player list ──────────────────────────────────
    let allPlayers: Player[]
    let aiPlayers: Player[]
    try {
    const playerFaction = cfg.playerFaction
    const factionKeys = Object.keys(FACTIONS) as FactionId[]

    const humanPlayer: Player = {
      id: 0, name: 'Commander', faction: playerFaction,
      color: PLAYER_TINT, credits: cfg.startingCredits,
      power: 0, powerGenerated: 0, powerConsumed: 0,
      isAI: false, isDefeated: false, entities: [], buildQueue: [],
    }

    aiPlayers = []
    for (let i = 0; i < cfg.aiCount; i++) {
      const fac = factionKeys[(factionKeys.indexOf(playerFaction) + i + 1) % factionKeys.length]
      aiPlayers.push({
        id: i + 1, name: `AI ${i + 1}`, faction: fac,
        color: AI_TINTS[i] ?? 0xff4444, credits: cfg.startingCredits,
        power: 0, powerGenerated: 0, powerConsumed: 0,
        isAI: true, isDefeated: false, entities: [], buildQueue: [],
      })
    }
    allPlayers = [humanPlayer, ...aiPlayers]

    // ── 5b. Explicit alliances ────────────────────────────────
    const validAiIds = new Set(aiPlayers.map(p => p.id))
    const maxAllies = Math.max(0, aiPlayers.length - 1)
    const allyAiIds = [...new Set(cfg.allyPlayerIds ?? [])]
      .filter(id => validAiIds.has(id))
      .sort((a, b) => a - b)
      .slice(0, maxAllies)
    const alliedPairs: Array<[number, number]> = []
    for (const allyId of allyAiIds) alliedPairs.push([0, allyId])
    for (let i = 0; i < allyAiIds.length; i++) {
      for (let j = i + 1; j < allyAiIds.length; j++) {
        alliedPairs.push([allyAiIds[i], allyAiIds[j]])
      }
    }
    this.entityMgr.setAllianceMode(alliedPairs)
    } catch (e) { console.error('[IC] CRASH in section 5 (players):', e); throw e }

    // ── 6. Economy ────────────────────────────────────────────
    try {
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
    } catch (e) { console.error('[IC] CRASH in section 6 (economy):', e); throw e }

    // ── 7. Production ─────────────────────────────────────────
    try {
    this.production = new Production(this.entityMgr, this.economy)
    } catch (e) { console.error('[IC] CRASH in section 7 (production):', e); throw e }

    // ── 8. AI commanders ──────────────────────────────────────
    try {
    this.aiCommanders = aiPlayers.map(p =>
      new AI(p.id, cfg.aiDifficulty, this.entityMgr, this.economy, this.production, p.faction)
    )
    for (const p of aiPlayers) {
      this.economy.setAIDifficulty(p.id, cfg.aiDifficulty)
      const buildSpeed = cfg.aiDifficulty === 'hard' ? 1.3 : 1.0
      this.production.setPlayerBuildSpeedMultiplier(p.id, buildSpeed)
    }
    } catch (e) { console.error('[IC] CRASH in section 8 (AI):', e); throw e }

    // ── 9. Game state ─────────────────────────────────────────
    try {
    this.gameState = {
      phase: 'playing' as GamePhase,
      tick: 0,
      players: allPlayers,
      localPlayerId: 0,
      selectedEntityIds: [],
      map: this.gameMap.data,
    }
    this.matchStartMs = this.time.now
    this.lastCombatMs = this.matchStartMs
    } catch (e) { console.error('[IC] CRASH in section 9 (game state):', e); throw e }

    // ── 10. Event wiring ──────────────────────────────────────
    try {
    this.wireEntityEvents()
    this.wireOreEvents()
    this.wireEconomyEvents()
    this.wireHUDEvents()
    this.wireProductionEvents()
    } catch (e) { console.error('[IC] CRASH in section 10 (event wiring):', e); throw e }

    // AI superweapon fire events
    this.entityMgr.on('ai_fire_superweapon', (data: { defId: string; targetX: number; targetY: number; playerId: number }) => {
      this.executeSuperweapon(data.defId, data.targetX, data.targetY, data.playerId)
      const hud = this.scene.get('HUDScene')
      if (hud) hud.events.emit('evaAlert', { message: `Enemy ${data.defId.replace(/_/g, ' ')} detected!`, type: 'danger' })
    })

    // Engineer capture event
    this.entityMgr.on('engineer_capture', (data: { engineerId: string; buildingId: string; newPlayerId: number }) => {
      const engineer = this.entityMgr.getUnit(data.engineerId)
      const building = this.entityMgr.getBuilding(data.buildingId)
      if (!engineer || !building) return

      // Transfer building ownership
      const prevOwner = building.playerId
      ;(building as any).playerId = data.newPlayerId
      const prevPlayer = this.gameState.players.find(p => p.id === prevOwner)
      if (prevPlayer) prevPlayer.entities = prevPlayer.entities.filter(id => id !== building.id)
      const newPlayer = this.gameState.players.find(p => p.id === data.newPlayerId)
      if (newPlayer && !newPlayer.entities.includes(building.id)) {
        newPlayer.entities.push(building.id)
      }

      // Sacrifice the engineer
      engineer.takeDamage(engineer.hp + 100, engineer.playerId)

      const hud = this.scene.get('HUDScene')
      if (data.newPlayerId === 0) {
        if (hud) hud.events.emit('evaAlert', { message: `Building captured!`, type: 'success' })
      } else {
        if (hud) hud.events.emit('evaAlert', { message: `Building captured by enemy!`, type: 'danger' })
      }
      console.log(`[Engineer] Building ${data.buildingId} captured by player ${data.newPlayerId}`)
    })

    this.entityMgr.on('engineer_repair_target', (
      engineer: import('../entities/Unit').Unit,
      target: import('../entities/Unit').Unit | import('../entities/Building').Building,
      cb: (done: boolean) => void,
    ) => {
      const building = this.entityMgr.getBuilding(target.id)
      if (!building || building.state === 'dying') {
        cb(true)
        return
      }
      if (!this.entityMgr.isAlly(engineer.playerId, building.playerId)) {
        cb(true)
        return
      }
      if (building.hp >= building.def.stats.maxHp) {
        cb(true)
        return
      }
      building.repair(22)
      cb(building.hp >= building.def.stats.maxHp)
    })

    this.entityMgr.on('engineer_repair_bridge', (
      engineer: import('../entities/Unit').Unit,
      targetPos: Position,
      cb: (done: boolean) => void,
    ) => {
      const repaired = this.gameMap.repairDamagedBridgeNear(targetPos.x, targetPos.y, 2)
      if (repaired && engineer.playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Bridge repaired', type: 'success' })
      }
      cb(!!repaired)
    })

    // Yuri mind control
    this.entityMgr.on('yuri_mind_control', (data: { yuriId: string; yuriPlayerId: number; targetId: string }) => {
      const yuri = this.entityMgr.getUnit(data.yuriId)
      const target = this.entityMgr.getUnit(data.targetId)
      if (!yuri || !target || target.state === 'dying') return

      // Release any previously controlled unit by this Yuri
      for (const u of this.entityMgr.getAllUnits()) {
        if (u.mindControlledBy === data.yuriId) {
          u.releaseMindControl()
          console.log(`[Yuri] Released previous target ${u.id}`)
        }
      }

      // Mind control the target
      target.setMindControlled(data.yuriId, data.yuriPlayerId)

      // Visual: purple glow overlay on controlled unit
      const mcGlow = this.add.graphics()
      mcGlow.fillStyle(0xcc44ff, 0.35)
      mcGlow.fillCircle(0, 0, 14)
      mcGlow.setDepth(target.depth + 1)
      target.add(mcGlow)
      ;(target as any)._mcGlow = mcGlow

      // When Yuri dies, release controlled unit
      const onYuriDied = () => {
        if (target.mindControlledBy === data.yuriId) {
          target.releaseMindControl()
          const glow = (target as any)._mcGlow as Phaser.GameObjects.Graphics | undefined
          if (glow) { glow.destroy(); (target as any)._mcGlow = null }
          console.log(`[Yuri] Died — released ${target.id}`)
        }
      }
      yuri.once('yuri_died', onYuriDied)

      const hud = this.scene.get('HUDScene')
      if (data.yuriPlayerId === 0) {
        if (hud) hud.events.emit('evaAlert', { message: 'Unit mind-controlled!', type: 'success' })
      } else {
        if (hud) hud.events.emit('evaAlert', { message: 'Unit mind-controlled by enemy!', type: 'danger' })
      }
      console.log(`[Yuri] Mind control: ${data.targetId} now belongs to player ${data.yuriPlayerId}`)
    })

    // Kirov EVA announcement when built
    this.entityMgr.on('unit_created', (data: { entityId: string; playerId: number }) => {
      const unit = this.entityMgr.getUnit(data.entityId)
      if (unit && unit.def.id === 'kirov') {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Kirov reporting!', type: 'danger' })
        console.log('[EVA] Kirov reporting!')
      }
    })

    // Spy infiltration — reveal enemy base for 30 seconds
    this.entityMgr.on('spy_infiltrate', (spy: import('../entities/Unit').Unit, target: import('../entities/Unit').Unit | import('../entities/Building').Building) => {
      if (!this.entityMgr.isEnemy(spy.playerId, target.playerId)) return
      // Add temporary sight source at the enemy building
      const pos = this.gameMap.worldToTile(target.x, target.y)
      const sightSource = { pos, range: 12 }
      this.fogAnchorSources.push(sightSource)
      // Remove after 30 seconds
      this.time.delayedCall(30000, () => {
        const idx = this.fogAnchorSources.indexOf(sightSource)
        if (idx >= 0) this.fogAnchorSources.splice(idx, 1)
      })

      if ('footprint' in target.def) {
        if (target.def.id === 'barracks' || target.def.id === 'war_factory') {
          this.production.grantSpyVeterancyBonus(spy.playerId, target.def.id)
        }
        if (target.def.id === 'ore_refinery') {
          const victimCredits = this.economy.getCredits(target.playerId)
          const stolen = Math.min(2000, victimCredits)
          if (stolen > 0) {
            this.economy.deductCredits(target.playerId, stolen)
            this.economy.addCredits(spy.playerId, stolen)
          }
        }
        if (target.def.id === 'battle_lab') {
          this.economy.addCredits(spy.playerId, 1000)
        }
      }

      // Sacrifice the spy
      spy.takeDamage(spy.hp + 100, spy.playerId)
      const hud = this.scene.get('HUDScene')
      if (hud) hud.events.emit('evaAlert', { message: 'Spy infiltration successful.', type: 'success' })
      console.log(`[Spy] Infiltrated building at (${target.x}, ${target.y}) owned by player ${target.playerId}`)
    })

    // ── 11. Spawn starting entities ───────────────────────────
    try {
    this.spawnStartingEntities()
    } catch (e) { console.error('[IC] CRASH in section 11a (spawnStartingEntities):', e); throw e }
    try {
    this.spawnNeutralBuildings()
    } catch (e) { console.error('[IC] CRASH in section 11b (spawnNeutralBuildings):', e); throw e }

    // ── 12. Input ─────────────────────────────────────────────
    try {
    this.setupInput()
    } catch (e) { console.error('[IC] CRASH in section 12 (setupInput):', e); throw e }

    // ── 13. UI elements (fixed to screen, don't scroll) ───────
    try {
    this.selectionRect = this.add.graphics()
    this.selectionRect.setScrollFactor(0).setDepth(200)
    this.rallyOverlay = this.add.graphics()
    this.rallyOverlay.setScrollFactor(0).setDepth(190)
    this.edgeFadeOverlay = this.add.graphics().setScrollFactor(0).setDepth(189)

    this.pauseOverlay = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0.45,
    ).setScrollFactor(0).setDepth(9000).setVisible(false)
    this.pauseText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'PAUSED', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(9001).setVisible(false)

    // ── 14. Camera at player spawn (convert to iso coords) ────
    const startPos = this.getSpawnPositionForPlayer(this.gameState.localPlayerId)
    if (startPos) {
      // Convert Cartesian start position to isometric screen position (with map offset)
      const screenStart = cartToScreen(startPos.x, startPos.y)
      this.camX = screenStart.x - this.scale.width / 2
      this.camY = screenStart.y - this.scale.height / 2
    }
    // Clamp initial camera immediately so first visible frame cannot land outside iso bounds.
    const initMaxX = this.gameMap.isoWorldWidth - this.scale.width
    const initMaxY = this.gameMap.isoWorldHeight - this.scale.height
    this.camX = Phaser.Math.Clamp(this.camX, 0, Math.max(0, initMaxX))
    this.camY = Phaser.Math.Clamp(this.camY, 0, Math.max(0, initMaxY))
    this.camTargetX = this.camX
    this.camTargetY = this.camY
    this.cameras.main.setScroll(this.camX, this.camY)
    } catch (e) { console.error('[IC] CRASH in section 13-14 (UI/camera):', e); throw e }

    // ── 15. Launch HUD overlay ────────────────────────────────
    try {
    this.scene.launch('HUDScene', { gameState: this.gameState })
    } catch (e) { console.error('[IC] CRASH in section 15 (HUD launch):', e); throw e }

    // ── 16. Initial fog reveal around player base ─────────────
    try {
    console.log('[IC] Units:', this.entityMgr.getAllUnits().length,
                'Buildings:', this.entityMgr.getAllBuildings().length)
    console.log('[IC] StartPos[0]:', this.gameMap.data.startPositions[0])
    console.log('[IC] TERRAIN rendered:', (this.gameMap as any)['renderedTiles'])
    console.log('[IC] Fog layer depth:', (this.gameMap as any)['fogLayer']?.depth)
    console.log('[IC] Terrain depth:', (this.gameMap as any)['terrainGraphics']?.depth)

    // Keep a visible "home sector" so the opening view is playable on large monitors.
    // Without this, the initial revealed area can be too small and appear as a black screen.
    const localSpawn = this.getSpawnPositionForPlayer(this.gameState.localPlayerId)
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

    if (this.isMapRevealActive()) {
      this.gameMap.revealAll()
      this.updateEntityVisibility()
    } else {
      // Reveal fog around player entities
      this.updateFogOfWar()

      // DEBUG: If no tiles were revealed, force-reveal everything so the game is playable
      const visibleCount = this.gameMap.data.tiles.flat().filter(t => t.fogState === 2).length
      console.log('[IC] Fog updated. Visible tiles:', visibleCount)
      if (visibleCount === 0) {
        console.warn('[IC] WARNING: No tiles revealed! Force-revealing entire map.')
        this.gameMap.revealAll()
      }
    }
    } catch (e) { console.error('[IC] CRASH in section 16 (fog):', e); throw e }

    // Push initial camera to registry for HUD
    this.registry.set('camX', this.camX)
    this.registry.set('camY', this.camY)

    console.log('[IC] Camera at:', this.camX, this.camY)
    console.log('[IC] Map world size:', this.gameMap.worldWidth, 'x', this.gameMap.worldHeight)
    console.log('[IC] Iso world size:', this.gameMap.isoWorldWidth, 'x', this.gameMap.isoWorldHeight)
    console.log('[IC] Iso offsetX:', this.gameMap.isoOffsetX)

    // Prevent browser context menu on the game canvas
    this.game.canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault())

    this.cameras.main.fadeIn(500)
  }

  update(_time: number, delta: number) {
    if (this.paused) return
    try { this._updateInternal(delta) } catch (e) {
      console.error('[IC] update() error:', e)
      this.gameOver = true  // Stop further updates
      this.add.text(100, 150, `UPDATE CRASH: ${e}`, {
        fontFamily: 'monospace', fontSize: '14px', color: '#ff4444',
        wordWrap: { width: this.scale.width - 200 }
      }).setScrollFactor(0).setDepth(9999)
    }
  }

  private _updateInternal(delta: number) {
    if (!this.cursors || !this.gameMap) return  // create() didn't finish
    if (this.gameOver || this.gameState.phase !== 'playing') return

    this.gameState.tick++

    // Handle camera target from HUD (minimap click, H key)
    this.handleCameraTarget()

    // Camera scroll + clamp to isometric map bounds
    this.handleCameraScroll(delta)
    const maxX = this.gameMap.isoWorldWidth - this.scale.width
    const maxY = this.gameMap.isoWorldHeight - this.scale.height
    this.camTargetX = Phaser.Math.Clamp(this.camTargetX, 0, Math.max(0, maxX))
    this.camTargetY = Phaser.Math.Clamp(this.camTargetY, 0, Math.max(0, maxY))
    const lerpFactor = 1 - Math.pow(1 - this.camLerp, Math.max(1, delta / 16.67))
    this.camX = Phaser.Math.Linear(this.camX, this.camTargetX, lerpFactor)
    this.camY = Phaser.Math.Linear(this.camY, this.camTargetY, lerpFactor)
    if (Math.abs(this.camX - this.camTargetX) < 0.4) this.camX = this.camTargetX
    if (Math.abs(this.camY - this.camTargetY) < 0.4) this.camY = this.camTargetY
    this.cameras.main.setScroll(this.camX, this.camY)
    this.drawRallyOverlay()
    this.drawEdgeBoundaryFade(Math.max(0, maxX), Math.max(0, maxY))

    // Pathfinder cache maintenance
    this.pathfinder.tick()

    // Entity systems (movement, combat state machines, harvest loops)
    this.entityMgr.update(delta)
    this.gameMap.update(delta)

    // Projectile travel + explosion effects
    this.combat.update(delta)

    // Power calculation + credit conversion
    this.economy.update(delta, this.gameState)

    // Build queue progress
    this.production.update(delta, this.gameState)

    // Country passive abilities (e.g., USA paratroopers)
    this.updateParatroopers(delta)

    // Neutral building effects (hospital heal, repair depot)
    this.updateNeutralEffects(delta)

    // AI decision making
    for (const ai of this.aiCommanders) {
      ai.update(delta, this.gameState)
    }
    if (this.gameState.tick % 600 === 0 && this.aiCommanders.length > 0) {
      console.log(`[IC] AI updates running for ${this.aiCommanders.length} commander(s)`)
    }

    // Fog of war (every 30 ticks ≈ 0.5s at 60fps)
    if (!this.isMapRevealActive() && this.gameState.tick % 30 === 0) {
      this.updateFogOfWar()
    }

    // Hide enemy entities in fog
    this.updateEntityVisibility()

    // Win/loss check (every 120 ticks ≈ 2s)
    if (this.gameState.tick % 120 === 0) {
      this.checkWinCondition()
      this.updateStalematePressure()
    }

    // Push live state to HUD via registry
    this.registry.set('gameState', this.gameState)
    this.registry.set('economy', this.economy)
    this.registry.set('production', this.production)
    this.registry.set('entityMgr', this.entityMgr)
    this.registry.set('canPlaceBuilding', (defId: string, col: number, row: number) => {
      const def = BUILDING_DEFS[defId]
      if (!def) return false
      const isShipyard = defId === 'naval_shipyard'
      // Shipyard requires water tiles; other buildings require land
      if (!isShipyard) {
        if (!this.isAdjacentToOwnBuildings(col, row, def.footprint.w, def.footprint.h, 0)) return false
      }
      for (let r = 0; r < def.footprint.h; r++) {
        for (let c = 0; c < def.footprint.w; c++) {
          const tile = this.gameMap.getTile(col + c, row + r)
          if (!tile) return false
          if (isShipyard) {
            // Shipyard must be placed on water
            if (tile.terrain !== TerrainType.WATER) return false
          } else {
            if (!this.gameMap.isBuildable(col + c, row + r)) return false
          }
        }
      }
      // Shipyard must be adjacent to own buildings OR to shoreline (within 3 tiles of land)
      if (isShipyard) {
        let nearLand = false
        for (let r = -3; r <= def.footprint.h + 2 && !nearLand; r++) {
          for (let c = -3; c <= def.footprint.w + 2 && !nearLand; c++) {
            const t = this.gameMap.getTile(col + c, row + r)
            if (t && t.terrain !== TerrainType.WATER && t.passable) nearLand = true
          }
        }
        if (!nearLand) return false
      }
      return true
    })
    this.registry.set('selectedIds', Array.from(this.selectedIds))
    this.registry.set('camX', this.camX)
    this.registry.set('camY', this.camY)
  }

  // ── Camera target from registry (minimap click, H key) ──────

  private handleCameraTarget(): void {
    const tx = this.registry.get('camTargetX') as number | undefined
    const ty = this.registry.get('camTargetY') as number | undefined
    if (tx !== undefined && ty !== undefined) {
      this.camTargetX = tx
      this.camTargetY = ty
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
    this.entityMgr.on('construction_complete', (building: import('../entities/Building').Building) => {
      this.onBuildingActivated(building)
    })

    this.entityMgr.on('unit_destroyed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const silent = this.silentDespawnIds.delete(entityId)
      if (!silent) {
        this.lastCombatMs = this.time.now
        this.staleMateBoostActive = false
      }
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.entities = p.entities.filter(id => id !== entityId)
      if (!silent && playerId !== this.gameState.localPlayerId) {
        this.playerUnitsKilled++
      }
      // Notify HUD
      if (!silent && playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Unit lost', type: 'danger' })
      }
    })

    this.entityMgr.on('building_destroyed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const silent = this.silentDespawnIds.delete(entityId)
      if (!silent) {
        this.lastCombatMs = this.time.now
        this.staleMateBoostActive = false
      }
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.entities = p.entities.filter(id => id !== entityId)
      if (this.selectedIds.delete(entityId)) this.syncSelectionState()
      if (!silent && playerId !== this.gameState.localPlayerId) {
        this.playerBuildingsDestroyed++
      }
      if (!silent && playerId === 0) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('buildingLost', { defId: entityId })
      }
    })

    // Building under attack — alert on damage with cooldown.
    this.entityMgr.on('building_damaged', (payload: { building: { playerId: number; x: number; y: number }; sourcePlayerId: number; amount: number }) => {
      const b = payload.building
      if (b.playerId !== 0 || payload.amount <= 0) return
      this.lastAlertPos = { x: b.x, y: b.y }
      this.registry.set('lastAlertPos', this.lastAlertPos)
      if (this.time.now - this.lastUnderAttackAlertMs < 3000) return
      this.lastUnderAttackAlertMs = this.time.now
      const hud = this.scene.get('HUDScene')
      if (hud) hud.events.emit('underAttack')
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
    // Clear selection when entering building placement mode
    this.events.on('clearSelection', () => this.deselectAll())
    this.events.on('selectUnitTypeMapWide', (data: { defId: string }) => {
      if (!data?.defId) return
      this.selectMapWideByUnitDef(data.defId)
    })

    // Place building from HUD placement mode
    this.events.on('placeBuilding', (data: { defId: string; tileCol: number; tileRow: number }) => {
      const def = BUILDING_DEFS[data.defId]
      if (!def) return
      if (!this.isDefAvailableToPlayer(0, data.defId)) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Faction restriction: unavailable', type: 'danger' })
        return
      }
      if (!this.production.checkPrerequisites(0, data.defId, this.gameState)) {
        const hud = this.scene.get('HUDScene')
        if (hud) hud.events.emit('evaAlert', { message: 'Prerequisites not met', type: 'danger' })
        return
      }

      const isShipyard = data.defId === 'naval_shipyard'

      // Shipyard skips adjacency check but needs water; others need build radius
      if (!isShipyard) {
        if (!this.isAdjacentToOwnBuildings(data.tileCol, data.tileRow, def.footprint.w, def.footprint.h, 0)) {
          const hud = this.scene.get('HUDScene')
          if (hud) {
            hud.events.emit('evaAlert', { message: 'Must build near existing structures', type: 'danger' })
            hud.events.emit('placementRejected', { defId: data.defId })
          }
          return
        }
      }

      // Check tiles — shipyard needs water, others need buildable land
      for (let r = 0; r < def.footprint.h; r++) {
        for (let c = 0; c < def.footprint.w; c++) {
          const tile = this.gameMap.getTile(data.tileCol + c, data.tileRow + r)
          const blocked = isShipyard
            ? (!tile || tile.terrain !== TerrainType.WATER)
            : (!tile || !this.gameMap.isBuildable(data.tileCol + c, data.tileRow + r))
          if (blocked) {
            const hud = this.scene.get('HUDScene')
            if (hud) {
              hud.events.emit('evaAlert', { message: isShipyard ? 'Shipyard must be on water' : 'Cannot build here', type: 'danger' })
              hud.events.emit('placementRejected', { defId: data.defId })
            }
            return
          }
        }
      }

      const building = this.entityMgr.createBuilding(0, data.defId, data.tileCol, data.tileRow)
      if (building) {
        // HUD already handled the build timer — building is ready, set active immediately
        building.state = 'active'
        building.setAlpha(1)
        this.onBuildingActivated(building)

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
      if (!this.isDefAvailableToPlayer(0, data.defId)) {
        console.warn(`[Pipeline] Faction-restricted unit blocked: ${data.defId}`)
        return
      }
      if (!this.production.checkPrerequisites(0, data.defId, this.gameState)) {
        console.warn(`[Pipeline] Prerequisite check failed for unit: ${data.defId}`)
        return
      }

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

    // Superweapon fired from HUD
    this.events.on('fireSuperweapon', (data: { defId: string; targetX: number; targetY: number }) => {
      this.executeSuperweapon(data.defId, data.targetX, data.targetY, 0)
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
    this.entityMgr.on('check_ore_at', (x: number, y: number, cb: (amount: number, pos: Position, isGems?: boolean) => void) => {
      const origin = this.gameMap.worldToTile(x, y)
      const searchR = 2
      let bestOre = 0
      let bestPos: Position = { x, y }
      let bestIsGems = false

      for (let dr = -searchR; dr <= searchR; dr++) {
        for (let dc = -searchR; dc <= searchR; dc++) {
          const tc = origin.col + dc
          const tr = origin.row + dr
          if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
          const t = tiles[tr]?.[tc]
          if (t && t.oreAmount > bestOre) {
            bestOre = t.oreAmount
            bestPos = this.gameMap.tileToWorld(tc, tr)
            bestIsGems = t.terrain === TerrainType.GEMS
          }
        }
      }
      cb(bestOre, bestPos, bestIsGems)
    })

    // Harvester depletes ore from the tile it harvested
    this.entityMgr.on('ore_harvested', (tilePos: Position, amount: number) => {
      const tc = this.gameMap.worldToTile(tilePos.x, tilePos.y)
      this.gameMap.harvestOreAt(tc.col, tc.row, amount)
    })

    // Harvester asks: "where is the nearest ore field?"
    this.entityMgr.on('find_ore_field', (
      x: number,
      y: number,
      cb: (pos: Position | null) => void,
      opts?: { maxRadiusTiles?: number; minOreAmount?: number },
    ) => {
      const origin = this.gameMap.worldToTile(x, y)
      const hardMaxRadius = Math.floor(Math.min(width, height) / 2)
      const preferredMaxRadius = Math.max(1, Math.floor(opts?.maxRadiusTiles ?? hardMaxRadius))
      const minOreAmount = Math.max(1, Math.floor(opts?.minOreAmount ?? 1))

      let foundPos: Position | null = null
      let bestOre = -1

      // Prefer richer nearby ore first when caller asks for a threshold.
      const preferredSearchMax = Math.min(hardMaxRadius, preferredMaxRadius)
      for (let radius = 1; radius <= preferredSearchMax; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
            const tc = origin.col + dc
            const tr = origin.row + dr
            if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
            const t = tiles[tr]?.[tc]
            if (!t) continue
            if (t.oreAmount >= minOreAmount && t.oreAmount > bestOre) {
              bestOre = t.oreAmount
              foundPos = this.gameMap.tileToWorld(tc, tr)
            }
          }
        }
        if (foundPos) break
      }

      // Fallback: any ore field map-wide.
      if (!foundPos) {
        for (let radius = 1; radius <= hardMaxRadius && !foundPos; radius++) {
          for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
              if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
              const tc = origin.col + dc
              const tr = origin.row + dr
              if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
              const t = tiles[tr]?.[tc]
              if (t && t.oreAmount > 0) {
                foundPos = this.gameMap.tileToWorld(tc, tr)
                break
              }
            }
            if (foundPos) break
          }
        }
      }

      cb(foundPos)
    })
  }

  // ── Building placement radius check ─────────────────────────────

  private getBuildRadiusForBuilding(defId: string): number {
    return defId === 'construction_yard' ? 8 : 5
  }

  private getFootprintBounds(col: number, row: number, w: number, h: number): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    return {
      minCol: col,
      maxCol: col + w - 1,
      minRow: row,
      maxRow: row + h - 1,
    }
  }

  private isAdjacentToOwnBuildings(
    col: number, row: number, w: number, h: number, playerId: number
  ): boolean {
    const buildings = this.entityMgr.getBuildingsForPlayer(playerId)
    if (buildings.length === 0) return true  // first building can go anywhere

    const proposed = this.getFootprintBounds(col, row, w, h)

    for (const b of buildings) {
      if (b.state === 'dying') continue
      const existing = this.getFootprintBounds(
        b.occupiedTiles[0].col,
        b.occupiedTiles[0].row,
        b.def.footprint.w,
        b.def.footprint.h,
      )

      // Edge-to-edge Chebyshev distance between existing and proposed footprints.
      const dx = proposed.minCol > existing.maxCol
        ? proposed.minCol - existing.maxCol
        : existing.minCol > proposed.maxCol
          ? existing.minCol - proposed.maxCol
          : 0
      const dy = proposed.minRow > existing.maxRow
        ? proposed.minRow - existing.maxRow
        : existing.minRow > proposed.maxRow
          ? existing.minRow - proposed.maxRow
          : 0

      const edgeDist = Math.max(dx, dy)
      const maxDist = this.getBuildRadiusForBuilding(b.def.id)
      if (edgeDist <= maxDist) return true
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
            if ((tiles[tr]?.[tc]?.oreAmount ?? 0) > 0) {
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
      .filter(b => b.state === 'active' || b.state === 'low_power')

    const producerByCategory: Record<string, Array<typeof PRODUCER_BUILDING_IDS[number]>> = {
      infantry: ['barracks'],
      vehicle: ['war_factory'],
      aircraft: ['air_force_command', 'war_factory'],
      naval: ['naval_shipyard'],
      harvester: ['ore_refinery', 'war_factory'],
    }

    const candidates = producerByCategory[unitDef.category] ?? []
    for (const producerDefId of candidates) {
      const primaryId = this.production.getPrimaryProducer(playerId, producerDefId)
      if (primaryId) {
        const primary = this.entityMgr.getBuilding(primaryId)
        if (primary && (primary.state === 'active' || primary.state === 'low_power')) {
          return primary
        }
      }
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
    const spawnAssignment = this.computeSpawnAssignment(players.length, startPositions.length)

    console.log('[IC] spawnStartingEntities:', players.length, 'players,',
      startPositions.length, 'start positions')

    players.forEach((player, i) => {
      const spawnIdx = spawnAssignment[i] ?? 0
      this.playerSpawnIndexById.set(player.id, spawnIdx)
      const spawnWorld = startPositions[spawnIdx] ?? startPositions[0]
      const st = this.gameMap.worldToTile(spawnWorld.x, spawnWorld.y)
      const side: FactionSide = FACTIONS[player.faction].side
      console.log(`[IC] Player ${player.id} (${player.faction}/${side}) spawn[${spawnIdx}]: tile(${st.col},${st.row}) world(${spawnWorld.x},${spawnWorld.y})`)

      // Construction Yard — start active
      const cy = this.entityMgr.createBuilding(player.id, 'construction_yard',
        st.col - 1, st.row - 1)
      if (cy) {
        cy.state = 'active'
        this.onBuildingActivated(cy)
      }
      else console.error(`[IC] FAILED to create Construction Yard for player ${player.id}`)

      // Side-appropriate Power Building — start active
      const powerDefId = getPowerBuildingDefId(side)
      const pp = this.entityMgr.createBuilding(player.id, powerDefId,
        st.col + 3, st.row - 1)
      if (pp) {
        pp.state = 'active'
        this.onBuildingActivated(pp)
      }

      // Ore Refinery — start active
      const ref = this.entityMgr.createBuilding(player.id, 'ore_refinery',
        st.col - 1, st.row + 3)
      if (ref) {
        ref.state = 'active'
        this.onBuildingActivated(ref)
      }

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
              if ((tiles[tr]?.[tc]?.oreAmount ?? 0) > 0) {
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

  // ── Neutral building spawning ───────────────────────────────

  private spawnNeutralBuildings(): void {
    const { width, height } = this.gameMap.data
    const startPositions = this.gameMap.data.startPositions
    const mapClass = Math.max(width, height) <= 64 ? 'small' :
      Math.max(width, height) <= 128 ? 'medium' : 'large'
    const countRanges: Record<'small' | 'medium' | 'large', { min: number; max: number }> = {
      small: { min: 3, max: 4 },
      medium: { min: 5, max: 6 },
      large: { min: 8, max: 10 },
    }
    const range = countRanges[mapClass]
    const targetCount = Phaser.Math.Between(range.min, range.max)
    const neutralDefs = this.buildNeutralSpawnList(mapClass, targetCount)
    const minDistFromBase = 20  // tiles

    let placed = 0
    for (const defId of neutralDefs) {
      const def = BUILDING_DEFS[defId]
      if (!def) continue

      // Try random placement away from all player bases
      for (let attempt = 0; attempt < 80; attempt++) {
        const col = Math.floor(Math.random() * (width - def.footprint.w - 4)) + 2
        const row = Math.floor(Math.random() * (height - def.footprint.h - 4)) + 2

        // Check distance from all bases
        let tooClose = false
        for (const sp of startPositions) {
          const spTile = this.gameMap.worldToTile(sp.x, sp.y)
          const dc = Math.abs(col - spTile.col)
          const dr = Math.abs(row - spTile.row)
          if (dc < minDistFromBase && dr < minDistFromBase) {
            tooClose = true
            break
          }
        }
        if (tooClose) continue

        // Check tiles are passable and buildable
        let canPlace = true
        for (let r = 0; r < def.footprint.h && canPlace; r++) {
          for (let c = 0; c < def.footprint.w && canPlace; c++) {
            const tile = this.gameMap.data.tiles[row + r]?.[col + c]
            if (!tile || !tile.passable || !tile.buildable) canPlace = false
          }
        }
        if (!canPlace) continue

        // Check not overlapping other buildings
        let overlaps = false
        for (const b of this.entityMgr.getAllBuildings()) {
          for (const bt of b.occupiedTiles) {
            for (let r = 0; r < def.footprint.h; r++) {
              for (let c = 0; c < def.footprint.w; c++) {
                if (bt.col === col + c && bt.row === row + r) overlaps = true
              }
            }
          }
        }
        if (overlaps) continue

        const building = this.entityMgr.createBuilding(NEUTRAL_PLAYER_ID, defId, col, row)
        if (building) {
          building.state = 'active'
          this.onBuildingActivated(building)
          placed++
          console.log(`[Neutral] Placed ${defId} at (${col}, ${row})`)
        }
        break
      }
    }
    console.log(`[Neutral] Map=${mapClass} target=${targetCount}, placed ${placed} neutral buildings`)
  }

  private buildNeutralSpawnList(
    mapClass: 'small' | 'medium' | 'large',
    targetCount: number,
  ): string[] {
    // Always include capturable tech variety, then scale up mostly with oil derricks.
    const base = ['oil_derrick', 'tech_center', 'neutral_hospital']
    if (mapClass !== 'small' || targetCount >= 4) base.push('neutral_repair_depot')

    const defs = base.slice(0, targetCount)
    while (defs.length < targetCount) {
      if (mapClass === 'large') {
        defs.push(Math.random() < 0.8 ? 'oil_derrick' : 'tech_center')
      } else if (mapClass === 'medium') {
        defs.push(Math.random() < 0.75 ? 'oil_derrick' : 'neutral_repair_depot')
      } else {
        defs.push('oil_derrick')
      }
    }
    return defs
  }

  // ── Neutral building effects (hospital heal, repair depot) ──

  private neutralEffectTimer = 0
  private static readonly NEUTRAL_EFFECT_INTERVAL = 2000  // 2 seconds

  private updateNeutralEffects(delta: number): void {
    this.neutralEffectTimer += delta
    if (this.neutralEffectTimer < GameScene.NEUTRAL_EFFECT_INTERVAL) return
    this.neutralEffectTimer = 0

    for (const b of this.entityMgr.getAllBuildings()) {
      if (b.state !== 'active' || b.playerId < 0) continue

      if (b.def.id === 'neutral_hospital') {
        // Heal infantry near hospital (+5 HP every 2s)
        const units = this.entityMgr.getUnitsInRange(b.x, b.y, 4 * TILE_SIZE)
        for (const u of units) {
          if (u.playerId !== b.playerId || u.def.category !== 'infantry') continue
          if (u.hp < u.def.stats.maxHp && u.state !== 'dying') {
            u.heal(5)
          }
        }
      }

      if (b.def.id === 'neutral_repair_depot') {
        // Repair vehicles near depot (+10 HP every 2s)
        const units = this.entityMgr.getUnitsInRange(b.x, b.y, 4 * TILE_SIZE)
        for (const u of units) {
          if (u.playerId !== b.playerId) continue
          if ((u.def.category === 'vehicle' || u.def.category === 'harvester') && u.state !== 'dying') {
            if (u.hp < u.def.stats.maxHp) {
              u.heal(10)
            }
          }
        }
      }
    }
  }

  // ── Fog of War ────────────────────────────────────────────────

  private updateFogOfWar(): void {
    if (this.isMapRevealActive()) return
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

    // Defensive fallback: if opening entities failed to spawn, keep the starting view playable.
    if (sources.length === 0) {
      const fallbackSpawn = this.getSpawnPositionForPlayer(localId)
      if (fallbackSpawn) {
        sources.push({
          pos: this.gameMap.worldToTile(fallbackSpawn.x, fallbackSpawn.y),
          range: 14,
        })
      } else {
        const camCenterIsoX = this.camX + this.scale.width / 2
        const camCenterIsoY = this.camY + this.scale.height / 2
        const camCenterCart = screenToCart(camCenterIsoX, camCenterIsoY)
        sources.push({
          pos: this.gameMap.worldToTile(camCenterCart.x, camCenterCart.y),
          range: 12,
        })
      }
    }

    // Always call updateFog — even with 0 sources, it resets VISIBLE→EXPLORED
    // and re-renders. Skipping it when sources=0 would leave stale full-black fog.
    this.gameMap.updateFog(sources)
  }

  // ── Superweapon execution ────────────────────────────────────

  private executeSuperweapon(defId: string, targetX: number, targetY: number, playerId: number): void {
    const radiusPx = 6 * TILE_SIZE  // 6-tile blast radius
    const hud = this.scene.get('HUDScene')

    if (defId === 'nuclear_silo' || defId === 'weather_device') {
      // Massive area damage
      const damage = defId === 'nuclear_silo' ? 1000 : 800
      this.combat.dealSplashDamage(
        { x: targetX, y: targetY }, radiusPx, damage,
        defId === 'nuclear_silo' ? DamageType.EXPLOSIVE : DamageType.ELECTRIC,
        playerId,
      )
      const bridgesDamaged = this.gameMap.damageBridgesInRadius(targetX, targetY, radiusPx)
      // Big explosion visual — central + ring of 12 staggered blasts
      this.combat.createExplosion(targetX, targetY, 'large')
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12
        const d = radiusPx * (0.3 + Math.random() * 0.4)
        this.time.delayedCall(i * 80, () => {
          this.combat.createExplosion(
            targetX + Math.cos(angle) * d,
            targetY + Math.sin(angle) * d,
            i % 3 === 0 ? 'large' : 'medium',
          )
        })
      }
      // Scorched area visual (lingering)
      const scorchIso = cartToScreen(targetX, targetY)
      const scorch = this.add.graphics()
      scorch.fillStyle(defId === 'nuclear_silo' ? 0x331100 : 0x112244, 0.3)
      scorch.fillCircle(scorchIso.x, scorchIso.y, radiusPx * 0.7)
      scorch.setDepth(2)
      this.tweens.add({ targets: scorch, alpha: 0, duration: 15000, onComplete: () => scorch.destroy() })

      // EVA alert to ALL players
      const weaponName = defId === 'nuclear_silo' ? 'Nuclear missile launched!' : 'Lightning storm created!'
      if (hud) hud.events.emit('evaAlert', { message: weaponName, type: 'danger' })
      if (bridgesDamaged > 0 && hud) {
        hud.events.emit('evaAlert', { message: `Bridges destroyed: ${bridgesDamaged}`, type: 'warning' })
      }
      console.log(`[Superweapon] ${defId} fired at (${Math.round(targetX)}, ${Math.round(targetY)}) by player ${playerId}`)

    } else if (defId === 'iron_curtain') {
      // Make friendly units near target invulnerable for 20 seconds
      const units = this.entityMgr.getUnitsInRange(targetX, targetY, 3 * TILE_SIZE)
        .filter(u => u.playerId === playerId && u.state !== 'dying')
      for (const u of units) {
        u.setInvulnerable(20000)
        // Red glow overlay + pulsing alpha while invulnerable
        const icGlow = this.add.graphics()
        icGlow.fillStyle(0xff2222, 0.4)
        icGlow.fillCircle(0, 0, 16)
        icGlow.setDepth(u.depth + 1)
        u.add(icGlow)
        const pulse = this.tweens.add({
          targets: u,
          alpha: { from: 1, to: 0.6 },
          duration: 400,
          yoyo: true,
          repeat: -1,
        })
        this.time.delayedCall(20000, () => {
          pulse.stop()
          u.setAlpha(1)
          icGlow.destroy()
        })
      }
      // Visual effect — red flash
      const icIso = cartToScreen(targetX, targetY)
      const flash = this.add.graphics()
      flash.fillStyle(0xff4444, 0.5)
      flash.fillCircle(icIso.x, icIso.y, 3 * TILE_SIZE)
      flash.setDepth(45)
      this.tweens.add({ targets: flash, alpha: 0, duration: 2000, onComplete: () => flash.destroy() })
      if (hud) hud.events.emit('evaAlert', { message: 'Iron Curtain activated!', type: playerId === 0 ? 'success' : 'danger' })
      console.log(`[Superweapon] Iron Curtain: ${units.length} units made invulnerable for 20s`)

    } else if (defId === 'chronosphere') {
      // Teleport friendly units from selected to target
      const selectedArr = Array.from(this.selectedIds)
      let units = selectedArr
        .map(id => this.entityMgr.getUnit(id))
        .filter((u): u is import('../entities/Unit').Unit =>
          u !== undefined && u.playerId === playerId && u.state !== 'dying')
      if (units.length === 0) {
        // Fallback: teleport units within 4-tile radius of player's base
        units = this.entityMgr.getUnitsForPlayer(playerId)
          .filter(u => u.state !== 'dying' && u.def.category !== 'harvester')
          .slice(0, 5)
      }

      // Blue flash at source locations
      const sourcePositions = units.map(u => ({ x: u.x, y: u.y }))
      for (const pos of sourcePositions) {
        const srcIso = cartToScreen(pos.x, pos.y)
        const srcFlash = this.add.graphics()
        srcFlash.fillStyle(0x44ddff, 0.6)
        srcFlash.fillCircle(srcIso.x, srcIso.y, TILE_SIZE)
        srcFlash.setDepth(45)
        this.tweens.add({ targets: srcFlash, alpha: 0, scaleX: 2, scaleY: 2, duration: 800, onComplete: () => srcFlash.destroy() })
      }

      // Teleport
      for (const u of units) {
        u.setPosition(targetX + (Math.random() - 0.5) * 64, targetY + (Math.random() - 0.5) * 64)
        u.giveOrder({ type: 'stop' })
      }

      // Blue flash at destination
      const destIso = cartToScreen(targetX, targetY)
      const flash = this.add.graphics()
      flash.fillStyle(0x44ddff, 0.6)
      flash.fillCircle(destIso.x, destIso.y, 3 * TILE_SIZE)
      flash.setDepth(45)
      this.tweens.add({ targets: flash, alpha: 0, duration: 1500, onComplete: () => flash.destroy() })
      if (hud) hud.events.emit('evaAlert', { message: 'Chronosphere activated!', type: playerId === 0 ? 'info' : 'danger' })
      console.log(`[Superweapon] Chronosphere teleported ${units.length} units to (${Math.round(targetX)}, ${Math.round(targetY)})`)
    }
  }

  // ── Entity visibility based on fog ────────────────────────────

  private updateEntityVisibility(): void {
    if (this.isMapRevealActive()) {
      for (const u of this.entityMgr.getAllUnits()) {
        u.setVisible(true)
        if (!u.invulnerable && !u.mindControlledBy) u.setAlpha(1)
      }
      for (const b of this.entityMgr.getAllBuildings()) {
        b.setVisible(true)
        b.setAlpha(1)
      }
      return
    }

    const localId = this.gameState.localPlayerId
    const { tiles, width, height } = this.gameMap.data

    // Units
    for (const u of this.entityMgr.getAllUnits()) {
      if (u.playerId === localId) {
        u.setVisible(true)
        // Don't reset alpha if invulnerable (pulsing) or mind-controlled
        if (!u.invulnerable && !u.mindControlledBy) u.setAlpha(1)
        continue
      }
      const tc = Math.floor(u.x / TILE_SIZE)
      const tr = Math.floor(u.y / TILE_SIZE)
      if (tc < 0 || tc >= width || tr < 0 || tr >= height) { u.setVisible(false); continue }
      const fog = tiles[tr]?.[tc]?.fogState ?? FogState.HIDDEN
      if (fog === FogState.VISIBLE || fog === FogState.EXPLORED) {
        // Mirage Tank stealth: nearly invisible when stationary (enemy perspective)
        if (u.stealthed && u.def.id === 'mirage_tank') {
          u.setVisible(true)
          u.setAlpha(0.15) // barely visible shimmer
        } else {
          u.setVisible(true)
          if (!u.invulnerable) u.setAlpha(fog === FogState.EXPLORED ? 0.6 : 1)
        }
      } else { u.setVisible(false) }
    }

    // Buildings
    for (const b of this.entityMgr.getAllBuildings()) {
      if (b.playerId === localId) { b.setVisible(true); b.setAlpha(1); continue }
      const tc = Math.floor(b.x / TILE_SIZE)
      const tr = Math.floor(b.y / TILE_SIZE)
      if (tc < 0 || tc >= width || tr < 0 || tr >= height) { b.setVisible(false); continue }
      const fog = tiles[tr]?.[tc]?.fogState ?? FogState.HIDDEN
      if (fog === FogState.VISIBLE) { b.setVisible(true); b.setAlpha(1) }
      else if (fog === FogState.EXPLORED) { b.setVisible(true); b.setAlpha(0.5) }
      else { b.setVisible(false) }
    }
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

    // ESC / P — toggle pause
    this.input.keyboard!.on('keydown-ESC', () => this.togglePause())
    this.input.keyboard!.on('keydown-P', () => this.togglePause())

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
      const home = this.getSpawnPositionForPlayer(this.gameState.localPlayerId)
      if (home) {
        const isoHome = cartToScreen(home.x, home.y)
        this.camTargetX = isoHome.x - this.scale.width / 2
        this.camTargetY = isoHome.y - this.scale.height / 2
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
      let changedSelection = false
      this.selectedIds.forEach(id => {
        const unit = this.entityMgr.getUnit(id)
        if (!unit || unit.playerId !== 0) return
        if (unit.def.id === 'mcv') {
          if (this.deployMCV(unit)) changedSelection = true
          return
        }
        // Toggle guard mode as "deploy" (fortified position: can't move, auto-engage)
        if (unit.def.category === 'infantry') {
          if (unit.state === 'idle') {
            unit.giveOrder({ type: 'guard' })
            this.showUnitAck('Deployed')
          } else {
            unit.giveOrder({ type: 'stop' })
            this.showUnitAck('Undeployed')
          }
        }
      })

      this.selectedIds.forEach(id => {
        const building = this.entityMgr.getBuilding(id)
        if (!building || building.playerId !== 0) return
        if (building.def.id === 'construction_yard') {
          if (this.undeployConstructionYard(building)) changedSelection = true
        }
      })

      if (changedSelection) this.syncSelectionState()
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

  private togglePause(): void {
    this.paused = !this.paused
    this.pauseOverlay?.setVisible(this.paused)
    this.pauseText?.setVisible(this.paused)
  }

  // ── Isometric input helper ───────────────────────────────────────

  /** Convert pointer's world position (isometric screen space) to Cartesian game coordinates */
  private ptrToCart(ptr: Phaser.Input.Pointer): { x: number; y: number } {
    return screenToCart(ptr.worldX, ptr.worldY)
  }

  // ── Ctrl+click force fire ──────────────────────────────────────

  private handleForceAttack(ptr: Phaser.Input.Pointer): void {
    const { x: worldX, y: worldY } = this.ptrToCart(ptr)

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
    const { x: worldX, y: worldY } = this.ptrToCart(ptr)
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
    const { x: worldX, y: worldY } = this.ptrToCart(ptr)
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

    const { x: worldX, y: worldY } = this.ptrToCart(ptr)
    if (this.selectedIds.size === 0) return

    const rallyProducer = this.getSelectedProductionBuildingForRally()
    if (rallyProducer) {
      const rallyPoint = {
        x: Phaser.Math.Clamp(worldX, TILE_SIZE, this.gameMap.worldWidth - TILE_SIZE),
        y: Phaser.Math.Clamp(worldY, TILE_SIZE, this.gameMap.worldHeight - TILE_SIZE),
      }
      rallyProducer.setRallyPoint(rallyPoint)
      const hud = this.scene.get('HUDScene')
      if (hud) hud.events.emit('evaAlert', { message: 'Rally point set', type: 'info' })
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
        unit.giveOrder({ type: 'attack', targetEntityId: attackTarget.id }, this.waypointMode)
      })
      this.showUnitAck('Attacking')
      return
    }

    const selectedEngineers = this.getSelectedEngineers()
    if (selectedEngineers.length > 0) {
      const damagedFriendlyBuilding = this.entityMgr.getBuildingsInRange(worldX, worldY, clickRadius)
        .find(b =>
          b.state !== 'dying' &&
          b.playerId >= 0 &&
          this.entityMgr.isAlly(0, b.playerId) &&
          b.hp < b.def.stats.maxHp
        )
      if (damagedFriendlyBuilding) {
        for (const engineer of selectedEngineers) {
          engineer.giveOrder({ type: 'repair', targetEntityId: damagedFriendlyBuilding.id }, this.waypointMode)
        }
        this.showUnitAck('Repairing structure')
        return
      }

      const damagedBridge = this.gameMap.findDamagedBridgeNear(worldX, worldY, 2)
      if (damagedBridge) {
        for (const engineer of selectedEngineers) {
          engineer.giveOrder({ type: 'repair', target: damagedBridge }, this.waypointMode)
        }
        this.showUnitAck('Repairing bridge')
        return
      }
    }

    // Right-click on empty ground clears current selection.
    this.deselectAll()
  }

  // ── Formation spreading ──────────────────────────────────────────
  // Compute offsets so grouped units fan out around a target position
  // instead of stacking on the same tile.

  private computeFormationOffsets(count: number): Array<{ dx: number; dy: number }> {
    if (count <= 1) return [{ dx: 0, dy: 0 }]

    const spacing = TILE_SIZE * 1.2  // gap between units
    const offsets: Array<{ dx: number; dy: number }> = []

    // Place units in concentric rings around center
    offsets.push({ dx: 0, dy: 0 })  // first unit goes to exact target
    let ring = 1
    while (offsets.length < count) {
      // Each ring has up to 6*ring slots (hexagonal-ish)
      const slots = 6 * ring
      const angleStep = (Math.PI * 2) / slots
      for (let s = 0; s < slots && offsets.length < count; s++) {
        const angle = angleStep * s
        offsets.push({
          dx: Math.cos(angle) * spacing * ring,
          dy: Math.sin(angle) * spacing * ring,
        })
      }
      ring++
    }
    return offsets
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

    const ackPos = cartToScreen(unit.x, unit.y)
    const text = this.add.text(ackPos.x, ackPos.y - 24, line, {
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

  private showFloatingText(msg: string, screenX: number, screenY: number): void {
    const text = this.add.text(screenX, screenY, msg, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#66ffff',
      stroke: '#001018',
      strokeThickness: 3,
    }).setScrollFactor(0).setDepth(220).setOrigin(0.5)
    this.tweens.add({
      targets: text,
      y: text.y - 16,
      alpha: 0,
      duration: 850,
      onComplete: () => text.destroy(),
    })
  }

  private startDragSelect(ptr: Phaser.Input.Pointer): void {
    this.isLeftPointerActive = true
    this.isDragging = false
    this.dragAnchorScreen = { x: ptr.x, y: ptr.y }
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
    const sx1 = Math.min(this.dragAnchorScreen.x, ptr.x)
    const sy1 = Math.min(this.dragAnchorScreen.y, ptr.y)
    const sx2 = Math.max(this.dragAnchorScreen.x, ptr.x)
    const sy2 = Math.max(this.dragAnchorScreen.y, ptr.y)

    if (!shiftHeld) this.deselectAll()

    // Drag box is drawn in screen space, so test unit positions in iso screen space.
    const units = this.entityMgr.getUnitsForPlayer(0)
    units.forEach(u => {
      const screenPos = cartToScreen(u.x, u.y)
      const screenX = screenPos.x - this.camX
      const screenY = screenPos.y - this.camY
      if (screenX >= sx1 && screenX <= sx2 && screenY >= sy1 && screenY <= sy2) {
        this.selectedIds.add(u.id)
        u.setSelected(true)
      }
    })

    this.syncSelectionState()
    if (this.selectedIds.size > 1) {
      this.showFloatingText(`${this.selectedIds.size} UNITS`, sx2 + 10, sy1 - 8)
    }
  }

  private handleLeftClick(ptr: Phaser.Input.Pointer): void {
    const { x: worldX, y: worldY } = this.ptrToCart(ptr)
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

    if (this.cursorMode === 'patrol') {
      this.selectedIds.forEach(id => {
        const unit = this.entityMgr.getUnit(id)
        if (!unit || unit.playerId !== 0) return
        const anchor = this.patrolAnchorByUnit.get(id) ?? { x: unit.x, y: unit.y }
        unit.giveOrder({ type: 'move', target: { x: worldX, y: worldY } })
        unit.giveOrder({ type: 'move', target: anchor }, true)
      })
      this.cursorMode = 'normal'
      this.showUnitAck('Patrolling')
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

    // Check if clicking on own production building → set as primary producer
    const ownBuilding = this.getOwnBuildingAt(worldX, worldY)
    if (ownBuilding) {
      if (PRODUCER_BUILDING_IDS.includes(ownBuilding.def.id as typeof PRODUCER_BUILDING_IDS[number])) {
        this.production.setPrimaryProducer(0, ownBuilding.id)
        const hudScene = this.scene.get('HUDScene')
        if (hudScene) {
          hudScene.events.emit('evaAlert', {
            message: `${ownBuilding.def.name} set as primary`,
            type: 'success',
          })
        }
      }
      // Select the building for info display
      this.deselectAll()
      this.selectedIds.add(ownBuilding.id)
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
    const appendOrder = this.waypointMode
    let harvestIssued = false
    let moveIssued = false

    // Compute formation offsets so units spread out around the target
    const unitIds = Array.from(this.selectedIds)
    const moveUnits = unitIds
      .map(id => this.entityMgr.getUnit(id))
      .filter((u): u is NonNullable<typeof u> => !!u && u.playerId === 0)
    const offsets = this.computeFormationOffsets(moveUnits.length)

    let idx = 0
    this.selectedIds.forEach(id => {
      const unit = this.entityMgr.getUnit(id)
      if (!unit || unit.playerId !== 0) return

      const offset = offsets[idx++] ?? { dx: 0, dy: 0 }
      if (tile?.terrain === TerrainType.ORE && unit.def.category === 'harvester') {
        unit.giveOrder({ type: 'harvest', target: { x: worldX + offset.dx, y: worldY + offset.dy } }, appendOrder)
        harvestIssued = true
      } else {
        unit.giveOrder({ type: 'move', target: { x: worldX + offset.dx, y: worldY + offset.dy } }, appendOrder)
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

  private getOwnBuildingAt(worldX: number, worldY: number): import('../entities/Building').Building | null {
    for (const building of this.entityMgr.getBuildingsForPlayer(0)) {
      if (building.state === 'dying') continue
      const bx = building.x
      const by = building.y
      const bw = building.def.footprint.w * TILE_SIZE
      const bh = building.def.footprint.h * TILE_SIZE
      if (worldX >= bx && worldX <= bx + bw && worldY >= by && worldY <= by + bh) {
        return building
      }
    }
    return null
  }

  private getSelectedEngineers(): Array<import('../entities/Unit').Unit> {
    const engineers: Array<import('../entities/Unit').Unit> = []
    for (const id of this.selectedIds) {
      const unit = this.entityMgr.getUnit(id)
      if (!unit || unit.playerId !== 0 || unit.state === 'dying') continue
      if (unit.def.id === 'engineer') engineers.push(unit)
    }
    return engineers
  }

  private selectMapWideByUnitDef(defId: string): void {
    this.deselectAll()
    for (const unit of this.entityMgr.getUnitsForPlayer(0)) {
      if (unit.state === 'dying' || unit.def.id !== defId) continue
      this.selectedIds.add(unit.id)
      unit.setSelected(true)
    }
    this.syncSelectionState()
    if (this.selectedIds.size > 0) {
      this.showFloatingText(`${this.selectedIds.size} ${defId.replace(/_/g, ' ').toUpperCase()}`, 120, this.scale.height - 70)
    }
  }

  private syncSelectionState(): void {
    this.refreshBuildingSelectionVisuals()
    this.gameState.selectedEntityIds = Array.from(this.selectedIds)
    this.registry.set('selectedIds', this.gameState.selectedEntityIds)
    this.updateSelectionPulse()
  }

  private deselectAll(): void {
    this.selectedIds.forEach(id => {
      this.entityMgr.getUnit(id)?.setSelected(false)
      this.entityMgr.getBuilding(id)?.setSelected(false)
    })
    this.selectedIds.clear()
    this.syncSelectionState()
  }

  private refreshBuildingSelectionVisuals(): void {
    const selected = this.selectedIds
    for (const building of this.entityMgr.getAllBuildings()) {
      building.setSelected(selected.has(building.id))
    }
  }

  private getSelectedProductionBuildingForRally(): import('../entities/Building').Building | null {
    if (this.selectedIds.size !== 1) return null
    const selectedId = Array.from(this.selectedIds)[0]
    const building = this.entityMgr.getBuilding(selectedId)
    if (!building || building.playerId !== 0) return null
    if (building.state === 'dying' || building.state === 'constructing') return null
    if (!PRODUCER_BUILDING_IDS.includes(building.def.id as typeof PRODUCER_BUILDING_IDS[number])) return null
    return building
  }

  private drawRallyOverlay(): void {
    const g = this.rallyOverlay
    if (!g) return
    g.clear()

    const pulse = 0.5 + 0.5 * Math.sin(this.time.now / 180)
    for (const building of this.entityMgr.getBuildingsForPlayer(0)) {
      if ((building.state !== 'active' && building.state !== 'low_power') || !building.rallyPoint) continue
      if (!PRODUCER_BUILDING_IDS.includes(building.def.id as typeof PRODUCER_BUILDING_IDS[number])) continue

      const fromIso = cartToScreen(building.x, building.y)
      const toIso = cartToScreen(building.rallyPoint.x, building.rallyPoint.y)
      const fromX = fromIso.x - this.camX
      const fromY = fromIso.y - this.camY + 8
      const toX = toIso.x - this.camX
      const toY = toIso.y - this.camY
      const isSelected = this.selectedIds.has(building.id)
      const alpha = isSelected ? 0.9 : 0.5

      g.lineStyle(isSelected ? 2 : 1, 0x8fdfff, alpha)
      g.beginPath()
      g.moveTo(fromX, fromY)
      g.lineTo(toX, toY)
      g.strokePath()
      g.fillStyle(0x8fdfff, Math.min(1, alpha + 0.2))
      g.fillCircle(toX, toY, 3 + pulse * 2)
      g.lineStyle(1, 0xdaf5ff, alpha)
      g.strokeCircle(toX, toY, 6 + pulse * 2)
    }
  }

  private updateSelectionPulse(): void {
    // Stop pulse on units no longer selected.
    for (const [id, tw] of this.selectionPulseTweens) {
      if (!this.selectedIds.has(id)) {
        tw.stop()
        this.selectionPulseTweens.delete(id)
        const unit = this.entityMgr.getUnit(id)
        if (unit) unit.setAlpha(1)
      }
    }
    // Start subtle pulse on newly selected units.
    this.selectedIds.forEach(id => {
      if (this.selectionPulseTweens.has(id)) return
      const unit = this.entityMgr.getUnit(id)
      if (!unit) return
      this.patrolAnchorByUnit.set(id, { x: unit.x, y: unit.y })
      const tw = this.tweens.add({
        targets: unit,
        alpha: { from: 1, to: 0.8 },
        duration: 180,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          unit.setAlpha(1)
          this.selectionPulseTweens.delete(id)
        },
      })
      this.selectionPulseTweens.set(id, tw)
    })
  }

  private handleCameraScroll(delta: number): void {
    if (!this.cursors) return  // setupInput() hasn't run yet (create crashed)
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

    this.camTargetX += dx
    this.camTargetY += dy
  }

  private drawEdgeBoundaryFade(maxX: number, maxY: number): void {
    const g = this.edgeFadeOverlay
    g.clear()
    const w = this.scale.width
    const h = this.scale.height
    const fadeDist = 90
    const leftAmt = Phaser.Math.Clamp(1 - this.camX / fadeDist, 0, 1)
    const rightAmt = Phaser.Math.Clamp(1 - (maxX - this.camX) / fadeDist, 0, 1)
    const topAmt = Phaser.Math.Clamp(1 - this.camY / fadeDist, 0, 1)
    const botAmt = Phaser.Math.Clamp(1 - (maxY - this.camY) / fadeDist, 0, 1)

    const drawSide = (amount: number, horizontal: boolean, invert: boolean) => {
      if (amount <= 0) return
      const strips = 14
      for (let i = 0; i < strips; i++) {
        const t = (i + 1) / strips
        const alpha = amount * 0.16 * (1 - t)
        g.fillStyle(0x000000, alpha)
        if (horizontal) {
          const y = invert ? h - t * fadeDist : (t - 1 / strips) * fadeDist
          g.fillRect(0, y, w, fadeDist / strips + 1)
        } else {
          const x = invert ? w - t * fadeDist : (t - 1 / strips) * fadeDist
          g.fillRect(x, 0, fadeDist / strips + 1, h)
        }
      }
    }

    drawSide(leftAmt, false, false)
    drawSide(rightAmt, false, true)
    drawSide(topAmt, true, false)
    drawSide(botAmt, true, true)
  }

  // ── Win / Loss ────────────────────────────────────────────────

  private checkWinCondition(): void {
    if (this.gameOver) return
    const players = this.gameState.players
    const localId = this.gameState.localPlayerId

    for (const p of players) {
      const aliveBuildings = this.entityMgr.getBuildingsForPlayer(p.id)
        .filter(b => b.state !== 'dying')
      const aliveMcvs = this.entityMgr.getUnitsForPlayer(p.id)
        .filter(u => u.state !== 'dying' && u.def.id === 'mcv')
      p.isDefeated = aliveBuildings.length === 0 && aliveMcvs.length === 0
    }

    const localPlayer = players.find(p => p.id === localId)
    if (localPlayer?.isDefeated) {
      this.triggerDefeat()
      return
    }

    // Player coalition (player + chosen allies) wins when all enemies are defeated.
    const opponents = players.filter(p => this.entityMgr.isEnemy(localId, p.id))
    if (opponents.length > 0 && opponents.every(p => p.isDefeated)) {
      this.triggerVictory()
    }
  }

  private updateStalematePressure(): void {
    if (this.gameOver || this.gameState.phase !== 'playing') return
    if (this.aiCommanders.length === 0) return

    const STALEMATE_MS = 5 * 60 * 1000
    const now = this.time.now
    const stalled = now - this.lastCombatMs >= STALEMATE_MS
    if (!stalled || this.staleMateBoostActive) return

    for (const ai of this.aiCommanders) {
      ai.setAggressiveFor(2 * 60 * 1000)
    }
    this.staleMateBoostActive = true

    const hud = this.scene.get('HUDScene')
    if (hud) hud.events.emit('evaAlert', { message: 'Enemy forces are escalating!', type: 'warning' })
  }

  private triggerVictory(): void {
    if (this.gameOver || this.gameState.phase !== 'playing') return
    this.gameOver = true
    this.gameState.phase = 'victory'
    const hud = this.scene.get('HUDScene')
    if (hud) hud.events.emit('evaAlert', { message: 'Mission accomplished', type: 'success' })
    this.showEndScreen(true)
  }

  private triggerDefeat(): void {
    if (this.gameOver || this.gameState.phase !== 'playing') return
    this.gameOver = true
    this.gameState.phase = 'defeat'
    const hud = this.scene.get('HUDScene')
    if (hud) hud.events.emit('evaAlert', { message: 'Mission failed', type: 'danger' })
    this.showEndScreen(false)
  }

  private showEndScreen(victory: boolean): void {
    const { width, height } = this.scale
    const title = victory ? 'VICTORY' : 'DEFEAT'
    const titleColor = victory ? '#ffd700' : '#ff4444'
    const accentColor = victory ? 0x44ee44 : 0xcc2222
    const elapsedMs = Math.max(0, this.time.now - this.matchStartMs)
    const totalSeconds = Math.floor(elapsedMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const timeText = `${minutes}:${seconds.toString().padStart(2, '0')}`

    const overlay = this.add.graphics()
    overlay.setScrollFactor(0).setDepth(200)
    overlay.fillStyle(0x000000, 0.7)
    overlay.fillRect(0, 0, width, height)
    overlay.fillStyle(0x0c1220, 0.95)
    overlay.fillRect(width / 2 - 270, height / 2 - 170, 540, 340)
    overlay.lineStyle(4, accentColor, 0.9)
    overlay.strokeRect(width / 2 - 270, height / 2 - 170, 540, 340)

    this.add.text(width / 2, height / 2 - 100, title, {
      fontFamily: 'monospace', fontSize: '74px', color: titleColor,
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0)

    this.add.text(width / 2, height / 2 - 18, `Time Elapsed: ${timeText}`, {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0)

    this.add.text(width / 2, height / 2 + 20, `Units Killed: ${this.playerUnitsKilled}`, {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0)

    this.add.text(width / 2, height / 2 + 58, `Buildings Destroyed: ${this.playerBuildingsDestroyed}`, {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0)

    const btnBg = this.add.rectangle(width / 2, height / 2 + 120, 280, 52, 0x1f2a44, 1)
      .setStrokeStyle(2, 0xffffff, 0.7)
      .setDepth(201)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })

    const btnLabel = this.add.text(width / 2, height / 2 + 120, 'Return to Menu', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(202).setScrollFactor(0)

    btnBg.on('pointerover', () => btnBg.setFillStyle(0x2d3d64, 1))
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x1f2a44, 1))
    btnBg.on('pointerdown', () => {
      this.scene.stop('HUDScene')
      this.scene.start('MenuScene')
    })

    void btnLabel
  }

  private isDefAvailableToPlayer(playerId: number, defId: string): boolean {
    const player = this.gameState.players.find(p => p.id === playerId)
    if (!player) return false

    const unitDef = UNIT_DEFS[defId]
    if (unitDef) {
      const sideMatch = unitDef.side === null || unitDef.side === FACTIONS[player.faction].side
      const exclusiveMatch = unitDef.factionExclusive === null || unitDef.factionExclusive === player.faction
      return sideMatch && exclusiveMatch
    }

    const buildingDef = BUILDING_DEFS[defId]
    if (buildingDef) {
      const sideMatch = buildingDef.side === null || buildingDef.side === FACTIONS[player.faction].side
      const exclusiveMatch = buildingDef.factionExclusive === null || buildingDef.factionExclusive === player.faction
      return sideMatch && exclusiveMatch
    }

    return false
  }

  private deployMCV(unit: import('../entities/Unit').Unit): boolean {
    const tile = this.gameMap.worldToTile(unit.x, unit.y)
    const def = BUILDING_DEFS['construction_yard']
    const col = tile.col - Math.floor(def.footprint.w / 2)
    const row = tile.row - Math.floor(def.footprint.h / 2)

    for (let r = 0; r < def.footprint.h; r++) {
      for (let c = 0; c < def.footprint.w; c++) {
        if (!this.gameMap.isBuildable(col + c, row + r)) {
          this.showUnitAck('Cannot deploy here')
          return false
        }
      }
    }

    const cy = this.entityMgr.createBuilding(unit.playerId, 'construction_yard', col, row)
    if (!cy) return false
    cy.state = 'active'
    cy.setAlpha(1)
    this.onBuildingActivated(cy)
    for (const occ of cy.occupiedTiles) {
      this.gameMap.setOccupied(occ.col, occ.row, cy.id)
    }
    this.silentDespawnIds.add(unit.id)
    this.entityMgr.removeEntity(unit.id)
    unit.destroy()
    this.selectedIds.delete(unit.id)
    this.selectedIds.add(cy.id)
    this.showUnitAck('Construction Yard deployed')
    console.log('[MCV] Deployed into Construction Yard', { playerId: unit.playerId, col, row })
    return true
  }

  private undeployConstructionYard(building: import('../entities/Building').Building): boolean {
    if (building.state === 'dying' || building.state === 'constructing') return false

    for (const occ of building.occupiedTiles) {
      this.gameMap.setOccupied(occ.col, occ.row, null)
    }
    const spawnTile = this.findNearestOpenTile(building.x, building.y, 4)
    if (!spawnTile) {
      for (const occ of building.occupiedTiles) {
        this.gameMap.setOccupied(occ.col, occ.row, building.id)
      }
      this.showUnitAck('Cannot undeploy here')
      return false
    }

    this.selectedIds.delete(building.id)
    this.silentDespawnIds.add(building.id)
    this.entityMgr.removeEntity(building.id)
    building.destroy()

    const spawnPos = this.gameMap.tileToWorld(spawnTile.col, spawnTile.row)
    const mcv = this.entityMgr.createUnit(building.playerId, 'mcv', spawnPos.x, spawnPos.y)
    if (!mcv) return false

    this.selectedIds.add(mcv.id)
    this.showUnitAck('Construction Yard packed')
    console.log('[MCV] Packed Construction Yard into MCV', { playerId: building.playerId, col: spawnTile.col, row: spawnTile.row })
    return true
  }

  private findNearestOpenTile(worldX: number, worldY: number, maxRadiusTiles: number): TileCoord | null {
    const origin = this.gameMap.worldToTile(worldX, worldY)
    for (let radius = 0; radius <= maxRadiusTiles; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
          const tc = origin.col + dc
          const tr = origin.row + dr
          const tile = this.gameMap.getTile(tc, tr)
          if (!tile) continue
          if (!tile.passable || tile.occupiedBy) continue
          return { col: tc, row: tr }
        }
      }
    }
    return null
  }

  private onBuildingActivated(building: import('../entities/Building').Building): void {
    if (building.def.id !== 'spy_satellite') return
    if (building.playerId !== this.gameState.localPlayerId) return
    this.forceFullMapReveal = true
    this.gameMap.revealAll()
    this.updateEntityVisibility()
  }

  private isMapRevealActive(): boolean {
    return this.skirmishCfg.revealMap || this.forceFullMapReveal
  }

  private nudgeIdleBlocker(tile: TileCoord, excludeUnitId?: string): boolean {
    const blocker = this.entityMgr.getAllUnits().find(u => {
      if (u.id === excludeUnitId || u.hp <= 0 || u.state !== 'idle') return false
      const tc = Math.floor(u.x / TILE_SIZE)
      const tr = Math.floor(u.y / TILE_SIZE)
      return tc === tile.col && tr === tile.row
    })
    if (!blocker) return false

    const nextAllowed = this.blockerNudgeCooldownMs.get(blocker.id) ?? 0
    if (this.time.now < nextAllowed) return false

    const candidates: TileCoord[] = []
    for (const radius of [1, 2]) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (dc === 0 && dr === 0) continue
          if (Math.abs(dc) + Math.abs(dr) !== radius) continue
          candidates.push({ col: tile.col + dc, row: tile.row + dr })
        }
      }
    }
    Phaser.Utils.Array.Shuffle(candidates)

    for (const dest of candidates) {
      const mapTile = this.gameMap.getTile(dest.col, dest.row)
      if (!mapTile || !mapTile.passable || mapTile.occupiedBy) continue
      const occupiedByUnit = this.entityMgr.getAllUnits().some(other => {
        if (other.id === blocker.id || other.hp <= 0 || other.state === 'dying') return false
        const otc = Math.floor(other.x / TILE_SIZE)
        const otr = Math.floor(other.y / TILE_SIZE)
        return otc === dest.col && otr === dest.row
      })
      if (occupiedByUnit) continue
      blocker.giveOrder({ type: 'move', target: this.gameMap.tileToWorld(dest.col, dest.row) })
      this.blockerNudgeCooldownMs.set(blocker.id, this.time.now + 2000)
      return true
    }

    return false
  }

  private updateParatroopers(delta: number): void {
    for (const player of this.gameState.players) {
      const isUsa = player.faction === 'usa'
      if (!isUsa) continue
      if (!this.entityMgr.playerHasBuilding(player.id, 'air_force_command')) continue

      const prev = this.paratrooperCooldownMs.get(player.id) ?? 0
      const next = prev - delta
      if (next > 0) {
        this.paratrooperCooldownMs.set(player.id, next)
        continue
      }

      this.spawnParatrooperDrop(player.id)
      this.paratrooperCooldownMs.set(player.id, 240000)
    }
  }

  private computeSpawnAssignment(playerCount: number, spawnCount: number): number[] {
    const assignments: number[] = []
    if (spawnCount <= 0 || playerCount <= 0) return assignments

    const preferred = this.skirmishCfg.playerSpawn
    const localSpawnIdx = Number.isInteger(preferred) && preferred >= 0 && preferred < spawnCount
      ? preferred
      : 0

    const used = new Set<number>()
    assignments[0] = localSpawnIdx
    used.add(localSpawnIdx)

    let cursor = 0
    for (let i = 1; i < playerCount; i++) {
      while (used.has(cursor) && cursor < spawnCount) cursor++
      const idx = cursor < spawnCount ? cursor : localSpawnIdx
      assignments[i] = idx
      used.add(idx)
    }

    return assignments
  }

  private getSpawnPositionForPlayer(playerId: number): Position | null {
    const positions = this.gameMap.data.startPositions
    if (positions.length === 0) return null
    const idx = this.playerSpawnIndexById.get(playerId)
    if (idx !== undefined && idx >= 0 && idx < positions.length) {
      return positions[idx]
    }
    const fallback = Phaser.Math.Clamp(playerId, 0, positions.length - 1)
    return positions[fallback] ?? positions[0]
  }

  private spawnParatrooperDrop(playerId: number): void {
    const enemyTargets = this.entityMgr.getAllBuildings()
      .filter(b => this.entityMgr.isEnemy(playerId, b.playerId) && b.state !== 'dying')
    let cx: number
    let cy: number
    if (enemyTargets.length > 0) {
      const t = Phaser.Utils.Array.GetRandom(enemyTargets)
      cx = t.x + Phaser.Math.Between(-TILE_SIZE * 2, TILE_SIZE * 2)
      cy = t.y + Phaser.Math.Between(-TILE_SIZE * 2, TILE_SIZE * 2)
    } else {
      const spawn = this.getSpawnPositionForPlayer(playerId) ?? this.gameMap.data.startPositions[0]
      cx = spawn.x + TILE_SIZE * 4
      cy = spawn.y + TILE_SIZE * 2
    }

    const count = 5
    for (let i = 0; i < count; i++) {
      const ox = Phaser.Math.Between(-20, 20)
      const oy = Phaser.Math.Between(-20, 20)
      const u = this.entityMgr.createUnit(playerId, 'gi', cx + ox, cy + oy)
      if (u && enemyTargets.length > 0) {
        const t = Phaser.Utils.Array.GetRandom(enemyTargets)
        u.giveOrder({ type: 'attackMove', target: { x: t.x, y: t.y } })
      }
    }

    const flare = this.add.graphics()
    flare.fillStyle(0x99ddff, 0.5)
    flare.fillCircle(cx, cy, TILE_SIZE * 2.5)
    flare.setDepth(45)
    this.tweens.add({ targets: flare, alpha: 0, duration: 1800, onComplete: () => flare.destroy() })

    if (playerId === 0) {
      const hud = this.scene.get('HUDScene')
      if (hud) hud.events.emit('evaAlert', { message: 'Paratroopers inbound!', type: 'success' })
    }
    console.log('[USA] Paratroopers deployed', { playerId, x: Math.round(cx), y: Math.round(cy), count })
  }
}
