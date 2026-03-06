// ============================================================
// IRON COMMAND — Computer AI
// Build orders, harvesting, scouting, and attack waves
// 3 difficulty levels: easy / medium / hard
// ============================================================

import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from '../economy/Economy'
import type { Production } from '../economy/Production'
import type { GameState, FactionSide, FactionId } from '../types'
import { TILE_SIZE } from '../types'
import { UNIT_DEFS, getBasicInfantryDefId, getMainTankDefId, getHarvesterDefId } from '../entities/UnitDefs'
import { BUILDING_DEFS, getPowerBuildingDefId } from '../entities/BuildingDefs'
import { FACTIONS } from '../data/factions'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

type AIPhase = 'early' | 'mid' | 'late'

// Build order: what to build and in what order (side-aware)
function getBuildOrder(difficulty: AIDifficulty, side: FactionSide): string[] {
  const power = getPowerBuildingDefId(side)
  const techBuilding = side === 'alliance' ? 'air_force_command' : 'radar_tower'

  const orders: Record<AIDifficulty, string[]> = {
    easy: [
      power, 'barracks', 'ore_refinery', power,
      'war_factory', 'barracks', techBuilding,
    ],
    medium: [
      power, 'barracks', 'ore_refinery', 'war_factory',
      power, 'barracks', techBuilding, 'battle_lab',
    ],
    hard: [
      power, 'barracks', 'ore_refinery', 'war_factory',
      power, techBuilding, 'barracks', 'battle_lab',
      power, side === 'alliance' ? 'weather_device' : 'nuclear_silo',
    ],
  }
  return orders[difficulty]
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
  private side: FactionSide
  private factionId: FactionId
  private em: EntityManager
  private economy: Economy
  private production: Production

  private phase: AIPhase
  private buildOrder: string[]
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
    factionId: FactionId,
  ) {
    this.playerId = playerId
    this.difficulty = difficulty
    this.factionId = factionId
    this.side = FACTIONS[factionId].side
    this.em = entityManager
    this.economy = economy
    this.production = production

    this.phase = 'early'
    this.buildOrder = getBuildOrder(difficulty, this.side)
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
    // Skip if player has no CY and no buildings at all — they're defeated
    const buildings = this.em.getBuildingsForPlayer(this.playerId)
    if (buildings.length === 0) return

    this.updatePhase(gameState)
    this.ensureHarvesting(gameState)
    this.rebuildLostBuildings(gameState)
    this.updateBuildOrder(gameState)
    this.buildArmy(gameState)
    this.considerAttacking(gameState)
    if (this.phase === 'mid' || this.phase === 'late') {
      this.considerScouting(gameState)
    }
    // Hard AI uses multi-prong attacks
    if (this.difficulty === 'hard' && this.isAttacking) {
      this.considerMultiProng(gameState)
    }
  }

  // ── Phase management ─────────────────────────────────────────

  private updatePhase(_gameState: GameState): void {
    const buildings = this.em.getBuildingsForPlayer(this.playerId)
    const hasWarFactory = buildings.some(b => b.def.id === 'war_factory' && b.state === 'active')
    const hasBattleLab = buildings.some(b => b.def.id === 'battle_lab' && b.state === 'active')

    if (hasBattleLab) {
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
      // Try to queue a harvester (side-appropriate type)
      const harvesterDefId = getHarvesterDefId(this.side)
      for (const refinery of refineries) {
        if (refinery.productionQueue.length === 0) {
          this.production.queueProduction(
            this.playerId,
            refinery.id,
            harvesterDefId,
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

  // ── Rebuild lost buildings ──────────────────────────────────

  private rebuildLostBuildings(_gameState: GameState): void {
    // RA2: AI rebuilds critical structures that were destroyed
    const powerBuilding = getPowerBuildingDefId(this.side)
    const essentialBuildings = [powerBuilding, 'barracks', 'ore_refinery', 'war_factory']
    const activeIds = this.em.getPlayerActiveBuildingIds(this.playerId)
    const hasCY = activeIds.includes('construction_yard')
    if (!hasCY) return  // can't rebuild without CY

    for (const defId of essentialBuildings) {
      if (!activeIds.includes(defId)) {
        // Check if we previously had it (build order index past it)
        const orderIdx = this.buildOrder.indexOf(defId)
        if (orderIdx >= 0 && orderIdx < this.buildOrderIndex) {
          // Prerequisites still met?
          if (this.production.checkPrerequisites(this.playerId, defId)) {
            this.tryBuildBuilding(defId)
            return  // one rebuild per tick
          }
        }
      }
    }
  }

  // ── Build order ──────────────────────────────────────────────

  private updateBuildOrder(_gameState: GameState): void {
    if (this.buildOrderIndex >= this.buildOrder.length) return

    const nextBuildingId = this.buildOrder[this.buildOrderIndex]
    const def = BUILDING_DEFS[nextBuildingId]
    if (!def) return

    // Check if already built
    if (this.em.playerHasBuilding(this.playerId, nextBuildingId)) {
      this.buildOrderIndex++
      return
    }

    // Check prerequisites (side-aware)
    if (!this.production.checkPrerequisites(this.playerId, nextBuildingId)) return

    // Check credits
    const credits = this.economy.getCredits(this.playerId)
    if (credits < def.stats.cost) return

    // Check power
    const powerBalance = this.economy.getPowerBalance(this.playerId)
    if (powerBalance + def.providespower < 0 && def.category !== 'power') {
      // Build side-appropriate power building first
      this.tryBuildBuilding(getPowerBuildingDefId(this.side))
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
      const building = this.em.createBuilding(this.playerId, defId, placeTile.col, placeTile.row)
      // AI buildings are instantly active (no construction delay)
      if (building) {
        building.state = 'active'
        building.setAlpha(1)
      }
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
    const anchorCol = Math.floor(anchor.x / TILE_SIZE)
    const anchorRow = Math.floor(anchor.y / TILE_SIZE)

    // Spiral outward to find empty space (step by footprint + gap)
    const stepW = def.footprint.w + 1
    const stepH = def.footprint.h + 1
    for (let radius = 1; radius <= 10; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
          const col = anchorCol + dc * stepW
          const row = anchorRow + dr * stepH
          if (col < 1 || row < 1 || col + def.footprint.w > 250 || row + def.footprint.h > 250) continue
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

    // Side-appropriate unit IDs
    const basicInf = getBasicInfantryDefId(this.side)
    const mainTank = getMainTankDefId(this.side)
    // RA2: Alliance has Rocketeer, Collective has Flak Trooper as anti-air infantry
    const antiAirInf = this.side === 'alliance' ? 'rocketeer' : 'flak_trooper'
    // Late-game heavy: Alliance has no direct equivalent to Apocalypse, uses IFV mix
    const heavyUnit = this.side === 'alliance' ? 'ifv' : 'apocalypse_tank'
    // Long-range: Alliance has Prism Tower (building), Collective has V3 Launcher
    const siegeUnit = this.side === 'alliance' ? mainTank : 'v3_launcher'

    if (this.phase === 'early') {
      return hasBarracks ? basicInf : null
    }

    if (this.phase === 'mid') {
      if (hasWarFactory && vehicleCount < infantryCount * 0.5) return mainTank
      if (hasBarracks && infantryCount < 4) return antiAirInf
      if (hasWarFactory) return mainTank
      return hasBarracks ? basicInf : null
    }

    // Late game — mix heavy units, siege, and anti-air
    if (hasWarFactory) {
      if (vehicleCount < 4) return mainTank
      const siegeCount = units.filter(u => u.def.id === siegeUnit).length
      if (siegeCount < 2) return siegeUnit
      if (vehicleCount < 8) return mainTank
      return Math.random() < 0.5 ? heavyUnit : mainTank
    }
    if (hasBarracks) {
      const aaCount = units.filter(u => u.def.id === antiAirInf).length
      if (aaCount < infantryCount * 0.4) return antiAirInf
      return basicInf
    }
    return null
  }

  private findProducerFor(unitDefId: string): import('../entities/Building').Building | null {
    const unitDef = UNIT_DEFS[unitDefId]
    if (!unitDef) return null

    const producingBuildingIds: Record<string, string[]> = {
      infantry: ['barracks'],
      vehicle: ['war_factory'],
      aircraft: [this.side === 'alliance' ? 'air_force_command' : 'war_factory'],
      naval: ['naval_shipyard'],
      harvester: ['ore_refinery', 'war_factory'],
    }

    const buildingIds = producingBuildingIds[unitDef.category] ?? []
    const buildings = this.em.getBuildingsForPlayer(this.playerId)

    for (const bId of buildingIds) {
      // Prefer buildings that aren't already producing (shorter queue)
      const candidates = buildings.filter(b => b.def.id === bId && b.state === 'active')
      const free = candidates.find(b => b.productionQueue.length === 0) ?? candidates[0]
      if (free) return free
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
