// ============================================================
// IRON COMMAND — Computer AI
// Build orders, harvesting, scouting, and attack waves
// 3 difficulty levels: easy / medium / hard
// ============================================================

import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from '../economy/Economy'
import type { Production } from '../economy/Production'
import type { GameState } from '../types'
import { TILE_SIZE } from '../types'
import { UNIT_DEFS } from '../entities/UnitDefs'
import { BUILDING_DEFS } from '../entities/BuildingDefs'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

type AIPhase = 'early' | 'mid' | 'late'

interface BuildStep {
  type: 'building' | 'unit'
  defId: string
  /** building ID that should produce this (for units) */
  producerId?: string
}

// Build order: what to build and in what order
const BUILD_ORDER: Record<AIDifficulty, string[]> = {
  easy: [
    'power_plant',
    'barracks',
    'ore_refinery',
    'power_plant',
    'war_factory',
    'barracks',
    'radar_tower',
  ],
  medium: [
    'power_plant',
    'barracks',
    'ore_refinery',
    'war_factory',
    'power_plant',
    'barracks',
    'radar_tower',
    'tech_center',
  ],
  hard: [
    'power_plant',
    'barracks',
    'ore_refinery',
    'war_factory',
    'power_plant',
    'radar_tower',
    'barracks',
    'tech_center',
    'advanced_power',
    'superweapon',
  ],
}

// Army composition: how many of each unit to build before attacking
const ARMY_THRESHOLD: Record<AIDifficulty, number> = {
  easy: 6,
  medium: 12,
  hard: 20,
}

// How often (ms) the AI "ticks" its decision-making
const TICK_INTERVAL: Record<AIDifficulty, number> = {
  easy: 4000,
  medium: 2500,
  hard: 1500,
}

export class AI {
  private playerId: number
  private difficulty: AIDifficulty
  private em: EntityManager
  private economy: Economy
  private production: Production

  private phase: AIPhase
  private buildOrderIndex: number
  private armyUnits: string[]  // unit IDs in AI's army
  private tickTimer: number
  private attackTimer: number
  private scoutTimer: number
  private isAttacking: boolean

  constructor(
    playerId: number,
    difficulty: AIDifficulty,
    entityManager: EntityManager,
    economy: Economy,
    production: Production,
  ) {
    this.playerId = playerId
    this.difficulty = difficulty
    this.em = entityManager
    this.economy = economy
    this.production = production

    this.phase = 'early'
    this.buildOrderIndex = 0
    this.armyUnits = []
    this.tickTimer = 0
    this.attackTimer = 0
    this.scoutTimer = 0
    this.isAttacking = false
  }

  // ── Main update ──────────────────────────────────────────────

  update(delta: number, gameState: GameState): void {
    this.tickTimer += delta
    this.attackTimer += delta
    this.scoutTimer += delta

    const interval = TICK_INTERVAL[this.difficulty]

    if (this.tickTimer >= interval) {
      this.tickTimer = 0
      this.tick(gameState)
    }
  }

  // ── AI tick (decision making) ────────────────────────────────

  private tick(gameState: GameState): void {
    this.updatePhase(gameState)
    this.ensureHarvesting(gameState)
    this.updateBuildOrder(gameState)
    this.buildArmy(gameState)
    this.considerAttacking(gameState)
    if (this.phase === 'mid' || this.phase === 'late') {
      this.considerScouting(gameState)
    }
  }

  // ── Phase management ─────────────────────────────────────────

  private updatePhase(gameState: GameState): void {
    const buildings = this.em.getBuildingsForPlayer(this.playerId)
    const hasWarFactory = buildings.some(b => b.def.id === 'war_factory' && b.state === 'active')
    const hasTechCenter = buildings.some(b => b.def.id === 'tech_center' && b.state === 'active')

    if (hasTechCenter) {
      this.phase = 'late'
    } else if (hasWarFactory) {
      this.phase = 'mid'
    } else {
      this.phase = 'early'
    }
  }

  // ── Harvesting ───────────────────────────────────────────────

  private ensureHarvesting(_gameState: GameState): void {
    const harvesters = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category === 'harvester'
    )

    // Ensure at least 1 harvester per refinery
    const refineries = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'ore_refinery' && b.state === 'active'
    )

    if (harvesters.length < refineries.length) {
      // Try to queue a harvester
      for (const refinery of refineries) {
        if (refinery.productionQueue.length === 0) {
          this.production.queueProduction(
            this.playerId,
            refinery.id,
            'harvester',
            this.buildFakeGameState(),
          )
        }
      }
    }

    // Send idle harvesters to ore
    for (const h of harvesters) {
      if (h.state === 'idle') {
        h.emit('find_ore_field', h.x, h.y, (target: { x: number; y: number } | null) => {
          if (target) {
            h.giveOrder({ type: 'harvest', target })
          }
        })
      }
    }
  }

  // ── Build order ──────────────────────────────────────────────

  private updateBuildOrder(_gameState: GameState): void {
    const order = BUILD_ORDER[this.difficulty]
    if (this.buildOrderIndex >= order.length) return

    const nextBuildingId = order[this.buildOrderIndex]
    const def = BUILDING_DEFS[nextBuildingId]
    if (!def) return

    // Check if already built
    if (this.em.playerHasBuilding(this.playerId, nextBuildingId)) {
      this.buildOrderIndex++
      return
    }

    // Check prerequisites
    const activeBuildingIds = this.em.getPlayerActiveBuildingIds(this.playerId)
    const prereqsMet = def.stats.prerequisites.every(req => activeBuildingIds.includes(req))
    if (!prereqsMet) return

    // Check credits
    const credits = this.economy.getCredits(this.playerId)
    if (credits < def.stats.cost) return

    // Check power
    const powerBalance = this.economy.getPowerBalance(this.playerId)
    if (powerBalance + def.providespower < 0 && def.category !== 'power') {
      // Build power plant first
      this.tryBuildBuilding('power_plant')
      return
    }

    // Place the building near the construction yard
    if (this.tryBuildBuilding(nextBuildingId)) {
      this.buildOrderIndex++
    }
  }

  private tryBuildBuilding(defId: string): boolean {
    const def = BUILDING_DEFS[defId]
    if (!def) return false

    const credits = this.economy.getCredits(this.playerId)
    if (credits < def.stats.cost) return false

    // Find a construction yard to queue from
    const constructionYards = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'construction_yard' && b.state === 'active'
    )
    if (constructionYards.length === 0) return false

    const cyard = constructionYards[0]

    // Find a placement position near existing buildings
    const placeTile = this.findBuildingPlacement(defId)
    if (!placeTile) return false

    // Deduct credits and place
    if (this.economy.deductCredits(this.playerId, def.stats.cost)) {
      this.em.createBuilding(this.playerId, defId, placeTile.col, placeTile.row)
      return true
    }
    void cyard
    return false
  }

  private findBuildingPlacement(defId: string): { col: number; row: number } | null {
    const def = BUILDING_DEFS[defId]
    if (!def) return null

    // Get construction yard position as anchor
    const buildings = this.em.getBuildingsForPlayer(this.playerId)
    if (buildings.length === 0) return null

    const anchor = buildings[0]
    const anchorCol = Math.floor((anchor.x - def.footprint.w * TILE_SIZE / 2) / TILE_SIZE)
    const anchorRow = Math.floor((anchor.y - def.footprint.h * TILE_SIZE / 2) / TILE_SIZE)

    // Spiral outward to find empty space
    for (let radius = 1; radius <= 15; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
          const col = anchorCol + dc * (def.footprint.w + 1)
          const row = anchorRow + dr * (def.footprint.h + 1)
          if (col < 0 || row < 0) continue
          if (this.isTileFree(col, row, def.footprint.w, def.footprint.h)) {
            return { col, row }
          }
        }
      }
    }
    return null
  }

  private isTileFree(col: number, row: number, w: number, h: number): boolean {
    // Check against existing buildings
    for (const b of this.em.getAllBuildings()) {
      for (const tile of b.occupiedTiles) {
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            if (tile.col === col + c && tile.row === row + r) {
              return false
            }
          }
        }
      }
    }
    return true
  }

  // ── Army building ────────────────────────────────────────────

  private buildArmy(_gameState: GameState): void {
    const units = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category !== 'harvester'
    )

    const threshold = ARMY_THRESHOLD[this.difficulty]
    if (units.length >= threshold * 1.5) return  // cap army size

    // Pick unit to build based on phase
    const unitToBuild = this.chooseUnitToBuild()
    if (!unitToBuild) return

    const unitDef = UNIT_DEFS[unitToBuild]
    if (!unitDef) return

    const credits = this.economy.getCredits(this.playerId)
    if (credits < unitDef.stats.cost) return

    // Find appropriate production building
    const producer = this.findProducerFor(unitToBuild)
    if (!producer) return

    this.production.queueProduction(
      this.playerId,
      producer.id,
      unitToBuild,
      this.buildFakeGameState(),
    )
  }

  private chooseUnitToBuild(): string | null {
    const units = this.em.getUnitsForPlayer(this.playerId)
    const infantryCount = units.filter(u => u.def.category === 'infantry').length
    const vehicleCount = units.filter(u => u.def.category === 'vehicle').length

    const hasWarFactory = this.em.playerHasBuilding(this.playerId, 'war_factory')
    const hasBarracks = this.em.playerHasBuilding(this.playerId, 'barracks')

    if (this.phase === 'early') {
      return hasBarracks ? 'rifle_soldier' : null
    }

    if (this.phase === 'mid') {
      if (hasWarFactory && vehicleCount < infantryCount * 0.5) return 'light_tank'
      if (hasBarracks && infantryCount < 4) return 'rocket_soldier'
      if (hasWarFactory) return 'light_tank'
      return hasBarracks ? 'rifle_soldier' : null
    }

    // Late game
    if (hasWarFactory) {
      if (vehicleCount < 6) return 'heavy_tank'
      return 'light_tank'
    }
    return hasBarracks ? 'rifle_soldier' : null
  }

  private findProducerFor(unitDefId: string): import('../entities/Building').Building | null {
    const unitDef = UNIT_DEFS[unitDefId]
    if (!unitDef) return null

    const producingBuildingIds: Record<string, string[]> = {
      infantry: ['barracks'],
      vehicle: ['war_factory'],
      aircraft: ['airfield'],
      naval: ['naval_yard'],
      harvester: ['ore_refinery'],
    }

    const buildingIds = producingBuildingIds[unitDef.category] ?? []
    const buildings = this.em.getBuildingsForPlayer(this.playerId)

    for (const bId of buildingIds) {
      const found = buildings.find(b => b.def.id === bId && b.state === 'active')
      if (found) return found
    }
    return null
  }

  // ── Attack logic ─────────────────────────────────────────────

  private considerAttacking(gameState: GameState): void {
    const units = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category !== 'harvester' && u.def.attack !== null
    )

    const threshold = ARMY_THRESHOLD[this.difficulty]

    if (units.length >= threshold && !this.isAttacking) {
      const target = this.findAttackTarget(gameState)
      if (target) {
        this.isAttacking = true
        this.attackTimer = 0
        for (const unit of units) {
          unit.giveOrder({ type: 'attackMove', target: { x: target.x, y: target.y } })
        }
      }
    }

    // If attacking and army is wiped, reset
    if (this.isAttacking && units.length < Math.floor(threshold * 0.3)) {
      this.isAttacking = false
    }
  }

  private findAttackTarget(
    gameState: GameState,
  ): { x: number; y: number } | null {
    // Find an enemy player
    const enemyPlayer = gameState.players.find(
      p => p.id !== this.playerId && !p.isDefeated
    )
    if (!enemyPlayer) return null

    // Target their construction yard or any building
    const enemyBuildings = this.em.getBuildingsForPlayer(enemyPlayer.id)
    if (enemyBuildings.length === 0) return null

    // Prefer construction yard
    const cyard = enemyBuildings.find(b => b.def.id === 'construction_yard')
    const target = cyard ?? enemyBuildings[0]
    return { x: target.x, y: target.y }
  }

  // ── Scouting ─────────────────────────────────────────────────

  private considerScouting(gameState: GameState): void {
    if (this.scoutTimer < 20000) return  // scout every 20s
    this.scoutTimer = 0

    const units = this.em.getUnitsForPlayer(this.playerId)
    const fastUnit = units.find(
      u => u.state === 'idle' && u.def.stats.speed >= 3.5 && u.def.category === 'vehicle'
    )
    if (!fastUnit) return

    // Move to random map corner (explore fog)
    const mapW = (gameState.map.width * TILE_SIZE) || 4096
    const mapH = (gameState.map.height * TILE_SIZE) || 4096
    const corners = [
      { x: 0, y: 0 },
      { x: mapW, y: 0 },
      { x: 0, y: mapH },
      { x: mapW, y: mapH },
    ]
    const target = corners[Math.floor(Math.random() * corners.length)]
    fastUnit.giveOrder({ type: 'move', target })
  }

  // ── Hard-mode multi-prong ────────────────────────────────────

  private considerMultiProng(gameState: GameState): void {
    if (this.difficulty !== 'hard') return

    const units = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category !== 'harvester' && u.def.attack !== null
    )
    if (units.length < ARMY_THRESHOLD.hard) return

    const target = this.findAttackTarget(gameState)
    if (!target) return

    // Split army into two groups attacking from different angles
    const half = Math.floor(units.length / 2)
    const group1 = units.slice(0, half)
    const group2 = units.slice(half)

    const offset = 200
    for (const u of group1) {
      u.giveOrder({ type: 'attackMove', target: { x: target.x + offset, y: target.y } })
    }
    for (const u of group2) {
      u.giveOrder({ type: 'attackMove', target: { x: target.x, y: target.y + offset } })
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  /** Build a minimal GameState-like object for Production.queueProduction */
  private buildFakeGameState(): GameState {
    return {
      phase: 'playing',
      tick: 0,
      players: [],
      localPlayerId: this.playerId,
      selectedEntityIds: [],
      map: {
        name: '',
        width: 128,
        height: 128,
        tileSize: TILE_SIZE,
        tiles: [],
        startPositions: [],
      },
    }
  }

  /** Expose multi-prong for hard AI tick */
  triggerMultiProng(gameState: GameState): void {
    this.considerMultiProng(gameState)
  }
}
