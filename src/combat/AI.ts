// ============================================================
// IRON COMMAND — Computer AI
// Build order, harvesting, scouting, and timed attack waves
// ============================================================

import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from '../economy/Economy'
import type { Production } from '../economy/Production'
import type { GameState, FactionSide, FactionId } from '../types'
import { TILE_SIZE } from '../types'
import { UNIT_DEFS, getBasicInfantryDefId, getMainTankDefId, getHarvesterDefId } from '../entities/UnitDefs'
import { BUILDING_DEFS, getPowerBuildingDefId } from '../entities/BuildingDefs'
import { FACTIONS } from '../data/factions'
import type { Unit } from '../entities/Unit'
import type { Building } from '../entities/Building'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

type AIPhase = 'early' | 'mid' | 'late'

type PendingWave = {
  unitIds: string[]
  target: { x: number; y: number }
  holdMs: number
}

const TICK_INTERVAL: Record<AIDifficulty, number> = {
  easy: 4000,
  medium: 2500,
  hard: 1500,
}

const INFANTRY_BEFORE_WAR_FACTORY: Record<AIDifficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 6,
}

const TANKS_BEFORE_ATTACK: Record<AIDifficulty, number> = {
  easy: 2,
  medium: 3,
  hard: 5,
}

const ATTACK_INTERVAL_MS: Record<AIDifficulty, { min: number; max: number }> = {
  easy: { min: 180000, max: 240000 },
  medium: { min: 120000, max: 180000 }, // 2-3 minutes
  hard: { min: 90000, max: 130000 },
}

const ATTACK_WAVE_SIZE: Record<AIDifficulty, { min: number; max: number }> = {
  easy: { min: 4, max: 6 },
  medium: { min: 5, max: 10 },
  hard: { min: 10, max: 16 },
}

const STAGING_HOLD_MS = 9000

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
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
  private tickTimer: number
  private attackTimer: number
  private scoutTimer: number
  private isAttacking: boolean

  private nextAttackWindowMs: number
  private pendingWave: PendingWave | null
  private lastStandTriggered: boolean
  private updateLogged: boolean

  private mapWidthTiles = 0
  private mapHeightTiles = 0

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
    this.tickTimer = 0
    this.attackTimer = 0
    this.scoutTimer = 0
    this.isAttacking = false

    this.nextAttackWindowMs = this.nextAttackWindow()
    this.pendingWave = null
    this.lastStandTriggered = false
    this.updateLogged = false
  }

  // ── Main update ──────────────────────────────────────────────

  update(delta: number, gameState: GameState): void {
    if (!this.updateLogged) {
      console.log(`[AI] update() active for player ${this.playerId} (${this.difficulty})`)
      this.updateLogged = true
    }

    this.mapWidthTiles = gameState.map.width
    this.mapHeightTiles = gameState.map.height

    this.tickTimer += delta
    this.attackTimer += delta
    this.scoutTimer += delta

    this.updatePendingWave(delta)

    const interval = TICK_INTERVAL[this.difficulty]
    if (this.tickTimer >= interval) {
      this.tickTimer = 0
      this.tick(gameState)
    }
  }

  // ── AI tick ───────────────────────────────────────────────────

  private tick(gameState: GameState): void {
    // Skip if player has no CY and no buildings at all — they're defeated
    const buildings = this.em.getBuildingsForPlayer(this.playerId)
    if (buildings.length === 0) return

    this.updatePhase(gameState)
    this.ensureHarvesting(gameState)

    if (this.handleLastStand(gameState)) {
      return
    }

    this.followBuildOrder(gameState)
    this.buildArmy(gameState)
    this.considerAttacking(gameState)

    if (this.phase === 'mid' || this.phase === 'late') {
      this.considerScouting(gameState)
    }

    if (this.difficulty === 'hard' && this.isAttacking) {
      this.considerMultiProng(gameState)
    }
  }

  // ── Phase management ─────────────────────────────────────────

  private updatePhase(): void {
    const hasWarFactory = this.hasActiveBuilding('war_factory')
    const hasBattleLab = this.hasActiveBuilding('battle_lab')

    if (hasBattleLab) this.phase = 'late'
    else if (hasWarFactory) this.phase = 'mid'
    else this.phase = 'early'
  }

  // ── Economy / harvesting ─────────────────────────────────────

  private ensureHarvesting(gameState: GameState): void {
    const harvesters = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category === 'harvester' && u.state !== 'dying',
    )

    const refineries = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'ore_refinery' && b.state === 'active',
    )

    const desiredHarvesters = Math.max(1, refineries.length)
    if (harvesters.length < desiredHarvesters) {
      this.queueUnitIfPossible(getHarvesterDefId(this.side), gameState)
    }

    for (const h of harvesters) {
      if (h.state !== 'idle') continue
      h.emit('find_ore_field', h.x, h.y, (target: { x: number; y: number } | null) => {
        if (target) {
          h.giveOrder({ type: 'harvest', target })
        }
      })
    }
  }

  // ── Build order ──────────────────────────────────────────────

  private followBuildOrder(gameState: GameState): void {
    const powerId = getPowerBuildingDefId(this.side)
    const basicInfantry = getBasicInfantryDefId(this.side)
    const mainTank = getMainTankDefId(this.side)

    // Required sequence: Power → Barracks → Infantry → War Factory → Tanks → Attack
    if (!this.hasBuildingPlacedOrConstructing(powerId)) {
      this.tryBuildBuilding(powerId)
      return
    }

    if (!this.hasBuildingPlacedOrConstructing('barracks')) {
      this.tryBuildBuilding('barracks')
      return
    }

    const infantryCount = this.getCombatInfantryCount()
    if (infantryCount < INFANTRY_BEFORE_WAR_FACTORY[this.difficulty]) {
      this.queueUnitIfPossible(basicInfantry, gameState)
      return
    }

    if (!this.hasBuildingPlacedOrConstructing('war_factory')) {
      this.tryBuildBuilding('war_factory')
      return
    }

    const tankCount = this.countUnitsByDef(mainTank)
    if (tankCount < TANKS_BEFORE_ATTACK[this.difficulty]) {
      this.queueUnitIfPossible(mainTank, gameState)
    }
  }

  private tryBuildBuilding(defId: string): boolean {
    const def = BUILDING_DEFS[defId]
    if (!def) return false

    if (!this.hasActiveBuilding('construction_yard')) return false
    if (this.hasBuildingPlacedOrConstructing(defId)) return false

    if (!this.production.checkPrerequisites(this.playerId, defId)) return false
    if (this.economy.getCredits(this.playerId) < def.stats.cost) return false

    const placeTile = this.findBuildingPlacement(defId)
    if (!placeTile) return false

    // Deduct credits and place
    if (this.economy.deductCredits(this.playerId, def.stats.cost)) {
      const building = this.em.createBuilding(this.playerId, defId, placeTile.col, placeTile.row)
      // AI buildings are instantly active (no construction delay)
      if (building) {
        building.state = 'active'
        building.setAlpha(1)
        console.log(`[AI] Player ${this.playerId} started ${defId} at (${placeTile.col}, ${placeTile.row})`)
      }
      return true
    }

    this.economy.addCredits(this.playerId, def.stats.cost)
    return false
  }

  private findBuildingPlacement(defId: string): { col: number; row: number } | null {
    const def = BUILDING_DEFS[defId]
    if (!def) return null

    const buildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state !== 'dying')
    if (buildings.length === 0) return null

    const anchor = buildings.find(b => b.def.id === 'construction_yard' && b.state === 'active') ?? buildings[0]
    const anchorCol = Math.floor((anchor.x - anchor.def.footprint.w * TILE_SIZE / 2) / TILE_SIZE)
    const anchorRow = Math.floor((anchor.y - anchor.def.footprint.h * TILE_SIZE / 2) / TILE_SIZE)

    for (let radius = 1; radius <= 15; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue

          const col = anchorCol + dc * (def.footprint.w + 1)
          const row = anchorRow + dr * (def.footprint.h + 1)

          if (col < 0 || row < 0) continue
          if (this.mapWidthTiles > 0 && col + def.footprint.w > this.mapWidthTiles) continue
          if (this.mapHeightTiles > 0 && row + def.footprint.h > this.mapHeightTiles) continue

          if (this.isTileFree(col, row, def.footprint.w, def.footprint.h)) {
            return { col, row }
          }
        }
      }
    }

    return null
  }

  private isTileFree(col: number, row: number, w: number, h: number): boolean {
    for (const b of this.em.getAllBuildings()) {
      if (b.state === 'dying') continue
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

  private queueUnitIfPossible(defId: string, gameState: GameState): boolean {
    const def = UNIT_DEFS[defId]
    if (!def) return false

    const producer = this.findProducerFor(defId)
    if (!producer) return false

    // Keep queues short so the AI can react and mix units.
    if (producer.productionQueue.length >= 3) return false

    if (this.economy.getCredits(this.playerId) < def.stats.cost) return false

    return this.production.queueProduction(
      this.playerId,
      producer.id,
      defId,
      gameState,
    )
  }

  // ── Army building ────────────────────────────────────────────

  private buildArmy(gameState: GameState): void {
    const combatUnits = this.getCombatUnits()
    const maxArmyByDifficulty: Record<AIDifficulty, number> = {
      easy: 18,
      medium: 28,
      hard: 40,
    }

    if (combatUnits.length >= maxArmyByDifficulty[this.difficulty]) return

    const unitToBuild = this.chooseUnitToBuild()
    if (!unitToBuild) return

    this.queueUnitIfPossible(unitToBuild, gameState)
  }

  private chooseUnitToBuild(): string | null {
    const hasBarracks = this.hasActiveBuilding('barracks')
    const hasWarFactory = this.hasActiveBuilding('war_factory')

    if (!hasBarracks && !hasWarFactory) return null

    const basicInf = getBasicInfantryDefId(this.side)
    const mainTank = getMainTankDefId(this.side)
    const antiAirInf = this.side === 'alliance' ? 'rocketeer' : 'flak_trooper'

    const units = this.em.getUnitsForPlayer(this.playerId).filter(u => u.state !== 'dying')
    const infantryCount = units.filter(u => u.def.category === 'infantry').length
    const vehicleCount = units.filter(u => u.def.category === 'vehicle').length

    if (!hasWarFactory) return hasBarracks ? basicInf : null
    if (!hasBarracks) return mainTank

    if (this.difficulty === 'easy') {
      return vehicleCount < 2 ? mainTank : basicInf
    }

    if (this.difficulty === 'medium') {
      if (vehicleCount < Math.max(3, Math.floor(infantryCount * 0.6))) return mainTank
      if (infantryCount < 6) return basicInf
      return Math.random() < 0.6 ? mainTank : antiAirInf
    }

    // hard
    if (vehicleCount < Math.max(6, infantryCount)) return mainTank
    return Math.random() < 0.7 ? mainTank : antiAirInf
  }

  private findProducerFor(unitDefId: string): Building | null {
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
    if (this.pendingWave) return

    const combatUnits = this.getCombatUnits()
    if (combatUnits.length === 0) {
      this.isAttacking = false
      return
    }

    if (this.attackTimer < this.nextAttackWindowMs) return

    const target = this.findAttackTarget(gameState)
    if (!target) return

    const waveCfg = ATTACK_WAVE_SIZE[this.difficulty]
    if (combatUnits.length < waveCfg.min) return

    const waveSize = randomInt(waveCfg.min, Math.min(waveCfg.max, combatUnits.length))
    const waveUnits = this.pickWaveUnits(combatUnits, waveSize)
    if (waveUnits.length === 0) return

    const staging = this.computeStagingPoint(target, gameState)
    for (const u of waveUnits) {
      u.giveOrder({ type: 'move', target: staging })
    }

    this.pendingWave = {
      unitIds: waveUnits.map(u => u.id),
      target,
      holdMs: STAGING_HOLD_MS,
    }

    this.isAttacking = true
    this.attackTimer = 0
    this.nextAttackWindowMs = this.nextAttackWindow()

    console.log(
      `[AI] Player ${this.playerId} staged attack (${waveUnits.length} units) at (${Math.round(staging.x)}, ${Math.round(staging.y)})`,
    )
  }

  private updatePendingWave(delta: number): void {
    if (!this.pendingWave) return

    this.pendingWave.holdMs -= delta
    if (this.pendingWave.holdMs > 0) return

    let sent = 0
    for (const id of this.pendingWave.unitIds) {
      const u = this.em.getUnit(id)
      if (!u || u.state === 'dying') continue
      u.giveOrder({ type: 'attackMove', target: this.pendingWave.target })
      sent++
    }

    this.pendingWave = null
    this.isAttacking = sent > 0
  }

  private pickWaveUnits(units: Unit[], desiredSize: number): Unit[] {
    const infantry = units.filter(u => u.def.category === 'infantry')
    const vehicles = units.filter(u => u.def.category === 'vehicle')
    const selected: Unit[] = []
    const selectedIds = new Set<string>()

    const addRandom = (pool: Unit[], amount: number) => {
      const local = [...pool]
      while (local.length > 0 && amount > 0) {
        const idx = randomInt(0, local.length - 1)
        const candidate = local.splice(idx, 1)[0]
        if (selectedIds.has(candidate.id)) continue
        selected.push(candidate)
        selectedIds.add(candidate.id)
        amount--
      }
    }

    const infantryTarget = Math.min(infantry.length, Math.floor(desiredSize * 0.5))
    const vehicleTarget = Math.min(vehicles.length, Math.max(1, Math.floor(desiredSize * 0.35)))

    addRandom(infantry, infantryTarget)
    addRandom(vehicles, vehicleTarget)

    const remainder = units.filter(u => !selectedIds.has(u.id))
    addRandom(remainder, desiredSize - selected.length)

    return selected
  }

  private computeStagingPoint(
    target: { x: number; y: number },
    gameState: GameState,
  ): { x: number; y: number } {
    const aiCY = this.em.getBuildingsForPlayer(this.playerId)
      .find(b => b.def.id === 'construction_yard' && b.state === 'active')

    const fallback = this.em.getBuildingsForPlayer(this.playerId)[0] ?? this.em.getUnitsForPlayer(this.playerId)[0]
    const anchorX = aiCY?.x ?? fallback?.x ?? target.x
    const anchorY = aiCY?.y ?? fallback?.y ?? target.y

    const jitter = TILE_SIZE * 3
    const rawX = anchorX + (target.x - anchorX) * 0.6 + randomInt(-jitter, jitter)
    const rawY = anchorY + (target.y - anchorY) * 0.6 + randomInt(-jitter, jitter)

    const mapW = gameState.map.width * TILE_SIZE
    const mapH = gameState.map.height * TILE_SIZE

    return {
      x: clamp(rawX, TILE_SIZE, Math.max(TILE_SIZE, mapW - TILE_SIZE)),
      y: clamp(rawY, TILE_SIZE, Math.max(TILE_SIZE, mapH - TILE_SIZE)),
    }
  }

  private findAttackTarget(gameState: GameState): { x: number; y: number } | null {
    const enemyPlayer = gameState.players.find(
      p => p.id !== this.playerId && !p.isDefeated,
    )
    if (!enemyPlayer) return null

    const enemyBuildings = this.em.getBuildingsForPlayer(enemyPlayer.id)
    if (enemyBuildings.length === 0) return null

    const cyard = enemyBuildings.find(b => b.def.id === 'construction_yard' && b.state !== 'dying')
    const target = cyard ?? enemyBuildings.find(b => b.state !== 'dying')
    if (!target) return null

    return { x: target.x, y: target.y }
  }

  // ── Last stand ───────────────────────────────────────────────

  private handleLastStand(gameState: GameState): boolean {
    if (this.hasActiveBuilding('construction_yard')) {
      this.lastStandTriggered = false
      return false
    }

    if (this.lastStandTriggered) return true

    const target = this.findAttackTarget(gameState)
    const survivors = this.getCombatUnits()

    if (target) {
      for (const u of survivors) {
        u.giveOrder({ type: 'attackMove', target })
      }
      this.isAttacking = survivors.length > 0
      console.warn(`[AI] Player ${this.playerId} last stand: ${survivors.length} units sent`)
    }

    this.lastStandTriggered = true
    return true
  }

  // ── Scouting ─────────────────────────────────────────────────

  private considerScouting(gameState: GameState): void {
    if (this.scoutTimer < 20000) return
    this.scoutTimer = 0

    const units = this.em.getUnitsForPlayer(this.playerId)
    const fastUnit = units.find(
      u => u.state === 'idle' && u.def.stats.speed >= 3.5 && u.def.category === 'vehicle',
    )
    if (!fastUnit) return

    const mapW = gameState.map.width * TILE_SIZE
    const mapH = gameState.map.height * TILE_SIZE
    const corners = [
      { x: TILE_SIZE, y: TILE_SIZE },
      { x: mapW - TILE_SIZE, y: TILE_SIZE },
      { x: TILE_SIZE, y: mapH - TILE_SIZE },
      { x: mapW - TILE_SIZE, y: mapH - TILE_SIZE },
    ]

    const target = corners[randomInt(0, corners.length - 1)]
    fastUnit.giveOrder({ type: 'move', target })
  }

  // ── Hard-mode multi-prong ────────────────────────────────────

  private considerMultiProng(gameState: GameState): void {
    if (this.difficulty !== 'hard') return

    const units = this.getCombatUnits()
    if (units.length < ATTACK_WAVE_SIZE.hard.min) return

    const target = this.findAttackTarget(gameState)
    if (!target) return

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

  private nextAttackWindow(): number {
    const w = ATTACK_INTERVAL_MS[this.difficulty]
    return randomInt(w.min, w.max)
  }

  private hasActiveBuilding(defId: string): boolean {
    return this.em.getBuildingsForPlayer(this.playerId).some(
      b => b.def.id === defId && b.state === 'active',
    )
  }

  private hasBuildingPlacedOrConstructing(defId: string): boolean {
    return this.em.getBuildingsForPlayer(this.playerId).some(
      b => b.def.id === defId && b.state !== 'dying',
    )
  }

  private getCombatUnits(): Unit[] {
    return this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.state !== 'dying' && u.def.category !== 'harvester' && u.def.attack !== null,
    )
  }

  private getCombatInfantryCount(): number {
    return this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.state !== 'dying' && u.def.category === 'infantry' && u.def.attack !== null,
    ).length
  }

  private countUnitsByDef(defId: string): number {
    return this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.state !== 'dying' && u.def.id === defId,
    ).length
  }

  /** Expose hard-mode attack split hook for external callers. */
  triggerMultiProng(gameState: GameState): void {
    this.considerMultiProng(gameState)
  }
}
