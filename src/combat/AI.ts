// ============================================================
// IRON COMMAND — Computer AI
// Full tech tree, defenses, harassment, adaptation, smart targeting,
// base defense reaction, economy expansion, advanced army composition
// ============================================================

import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from '../economy/Economy'
import type { Production } from '../economy/Production'
import type { GameState, FactionSide, FactionId } from '../types'
import { TILE_SIZE } from '../types'
import { UNIT_DEFS, getBasicInfantryDefId, getMainTankDefId, getHarvesterDefId, getFactionUnitIds } from '../entities/UnitDefs'
import { BUILDING_DEFS, getPowerBuildingDefId } from '../entities/BuildingDefs'
import { FACTIONS } from '../data/factions'
import type { Unit } from '../entities/Unit'
import type { Building } from '../entities/Building'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

type AIPhase = 'early' | 'mid' | 'late'

type PendingWave = {
  groups: Array<{ unitIds: string[]; target: { x: number; y: number } }>
  holdMs: number
}

type AttackGroup = {
  unitIds: string[]
  initialCount: number
}

// ── Constants ──────────────────────────────────────────────────

const TICK_INTERVAL: Record<AIDifficulty, number> = {
  easy: 3000,
  medium: 2000,
  hard: 1200,
}

const INFANTRY_BEFORE_WAR_FACTORY: Record<AIDifficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 6,
}

const ATTACK_INTERVAL_MS: Record<AIDifficulty, { min: number; max: number }> = {
  easy: { min: 120000, max: 170000 },
  medium: { min: 75000, max: 120000 },
  hard: { min: 40000, max: 70000 },     // faster attacks on hard (was 55-90s)
}

// Hard: first attack comes at 2 minutes
const FIRST_ATTACK_MS: Record<AIDifficulty, number> = {
  easy: 300000,
  medium: 180000,
  hard: 120000,
}

const ATTACK_WAVE_SIZE: Record<AIDifficulty, { min: number; max: number }> = {
  easy: { min: 4, max: 8 },
  medium: { min: 6, max: 12 },
  hard: { min: 8, max: 20 },
}

const STAGING_HOLD_MS = 5000

const HARASS_INTERVAL_MS: Record<AIDifficulty, number> = {
  easy: 100000,
  medium: 60000,
  hard: 25000,                           // more frequent harassment (was 35s)
}

const DEFENSE_TARGET: Record<AIDifficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
}

const MAX_ARMY: Record<AIDifficulty, number> = {
  easy: 18,
  medium: 28,
  hard: 50,                              // bigger army cap (was 40)
}

const BASE_DEFENSE_RADIUS: Record<AIDifficulty, number> = {
  easy: 8,
  medium: 12,
  hard: 15,
}

const DEFENDER_RESPONSE_RADIUS: Record<AIDifficulty, number> = {
  easy: 15,
  medium: 25,
  hard: 40,
}

const RETREAT_HEALTH_PCT = 0.35
const REBUILD_RECOVERY_MS: Record<AIDifficulty, number> = {
  easy: 70000,
  medium: 50000,
  hard: 40000,
}

// ── Helpers ────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return Math.sqrt(dx * dx + dy * dy)
}

// ══════════════════════════════════════════════════════════════

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
  private harassTimer: number
  private isAttacking: boolean

  private nextAttackWindowMs: number
  private pendingWave: PendingWave | null
  private lastStandTriggered: boolean
  private updateLogged: boolean

  private mapWidthTiles = 0
  private mapHeightTiles = 0

  private enemyComposition: { infantry: number; vehicles: number; aircraft: number; defenses: number }
  private superweaponTimers: Map<string, number> = new Map()
  private superweaponReady: Set<string> = new Set()
  private matchTimer: number
  private waveCount: number
  private rebuildUntilMs: number
  private aggressionUntilMs: number
  private activeAttackGroups: AttackGroup[]

  private static readonly SW_COOLDOWNS: Record<string, number> = {
    nuclear_silo: 300000,
    weather_device: 300000,
    chronosphere: 180000,
    iron_curtain: 180000,
  }
  private static readonly SW_IDS = Object.keys(AI.SW_COOLDOWNS)

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
    this.harassTimer = 0
    this.isAttacking = false

    this.nextAttackWindowMs = FIRST_ATTACK_MS[difficulty]
    this.pendingWave = null
    this.lastStandTriggered = false
    this.updateLogged = false

    this.enemyComposition = { infantry: 0, vehicles: 0, aircraft: 0, defenses: 0 }
    this.matchTimer = 0
    this.waveCount = 0
    this.rebuildUntilMs = 0
    this.aggressionUntilMs = 0
    this.activeAttackGroups = []
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
    this.harassTimer += delta
    this.matchTimer += delta

    this.updatePendingWave(delta)

    const interval = TICK_INTERVAL[this.difficulty]
    if (this.tickTimer >= interval) {
      this.tickTimer = 0
      this.tick(gameState)
    }
  }

  // ── AI tick ───────────────────────────────────────────────────

  private tick(gameState: GameState): void {
    const buildings = this.em.getBuildingsForPlayer(this.playerId)
    if (buildings.length === 0) return

    this.updatePhase()
    this.assessEnemyComposition(gameState)
    this.ensureHarvesting(gameState)

    if (this.handleLastStand(gameState)) return

    this.updateAttackGroups()
    this.retreatDamagedUnits()
    this.defendBase(gameState)
    this.followTechTree(gameState)
    this.expandEconomy(gameState)
    this.buildDefenses()
    this.buildArmy(gameState)
    this.considerHarassment(gameState)
    this.considerAttacking(gameState)
    this.rebuildDestroyedBuildings(gameState)

    if (this.phase === 'mid' || this.phase === 'late') {
      this.considerScouting(gameState)
    }

      // Superweapon management (medium/hard only)
    if (this.difficulty !== 'easy') {
      this.tickSuperweapons(gameState)
    }
  }

  // ── Phase management ─────────────────────────────────────────

  private updatePhase(): void {
    const hasBattleLab = this.hasActiveBuilding('battle_lab')
    const hasMidTech = this.side === 'alliance'
      ? this.hasActiveBuilding('air_force_command')
      : this.hasActiveBuilding('radar_tower')
    const hasWarFactory = this.hasActiveBuilding('war_factory')

    if (hasBattleLab) this.phase = 'late'
    else if (hasMidTech || hasWarFactory) this.phase = 'mid'
    else this.phase = 'early'
  }

  // ── Enemy assessment ─────────────────────────────────────────

  private assessEnemyComposition(gameState: GameState): void {
    let infantry = 0, vehicles = 0, aircraft = 0, defenses = 0
    for (const p of gameState.players) {
      if (p.id === this.playerId || p.isDefeated) continue
      for (const u of this.em.getUnitsForPlayer(p.id)) {
        if (u.state === 'dying') continue
        if (u.def.category === 'infantry') infantry++
        else if (u.def.category === 'vehicle') vehicles++
        else if (u.def.category === 'aircraft') aircraft++
      }
      for (const b of this.em.getBuildingsForPlayer(p.id)) {
        if (b.state !== 'dying' && b.def.category === 'defense') defenses++
      }
    }
    this.enemyComposition = { infantry, vehicles, aircraft, defenses }
  }

  // ── Economy / harvesting ─────────────────────────────────────

  private ensureHarvesting(gameState: GameState): void {
    const harvesters = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category === 'harvester' && u.state !== 'dying',
    )

    const refineries = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'ore_refinery' && b.state === 'active',
    )

    const desiredHarvesters = Math.max(2, refineries.length * 2)

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

  // ── Economy expansion ────────────────────────────────────────

  private expandEconomy(gameState: GameState): void {
    const credits = this.economy.getCredits(this.playerId)
    const refCount = this.countBuildings('ore_refinery')
    const threshold = this.difficulty === 'easy' ? 3500 : 2500
    const maxRef = this.difficulty === 'hard' ? 4 : this.difficulty === 'medium' ? 3 : 2

    if (credits > threshold && refCount < maxRef) {
      if (this.tryBuildBuilding('ore_refinery', true)) {
        console.log(`[AI] Player ${this.playerId} expanding economy — refinery #${refCount + 1}`)
      }
    }
  }

  // ── Tech tree ────────────────────────────────────────────────

  private followTechTree(gameState: GameState): void {
    const powerId = getPowerBuildingDefId(this.side)
    const basicInfantry = getBasicInfantryDefId(this.side)

    // 1. Power first
    if (!this.hasBuildingPlacedOrConstructing(powerId)) {
      this.tryBuildBuilding(powerId)
      return
    }

    // 2. Barracks
    if (!this.hasBuildingPlacedOrConstructing('barracks')) {
      this.tryBuildBuilding('barracks')
      return
    }

    // 3. Ore Refinery
    if (!this.hasBuildingPlacedOrConstructing('ore_refinery')) {
      this.tryBuildBuilding('ore_refinery')
      return
    }

    // 4. Some infantry before War Factory
    const infantryCount = this.getCombatInfantryCount()
    if (infantryCount < INFANTRY_BEFORE_WAR_FACTORY[this.difficulty]) {
      this.queueUnitIfPossible(basicInfantry, gameState)
      return
    }

    // 5. War Factory
    if (!this.hasBuildingPlacedOrConstructing('war_factory')) {
      this.tryBuildBuilding('war_factory')
      return
    }

    // 6. Extra power if needed before mid-tech
    if (this.needsMorePower()) {
      this.buildExtraPower()
      return
    }

    // 7. Mid-game tech building
    const midTechId = this.side === 'alliance' ? 'air_force_command' : 'radar_tower'
    if (!this.hasBuildingPlacedOrConstructing(midTechId)) {
      const tanksNeeded = this.difficulty === 'easy' ? 3 : 1
      if (this.countUnitsByCategory('vehicle') >= tanksNeeded) {
        this.tryBuildBuilding(midTechId)
      }
      return
    }

    // 8. More power for late-game
    if (this.needsMorePower()) {
      this.buildExtraPower()
      return
    }

    // 9. Battle Lab
    if (!this.hasBuildingPlacedOrConstructing('battle_lab')) {
      if (this.difficulty !== 'easy' || this.getCombatUnits().length >= 12) {
        this.tryBuildBuilding('battle_lab')
      }
    }

    // 10. Hard mode: build superweapons aggressively once battle lab is up
    if (this.difficulty === 'hard' && this.hasActiveBuilding('battle_lab')) {
      for (const swId of AI.SW_IDS) {
        const swDef = BUILDING_DEFS[swId]
        if (!swDef) continue
        const sideMatch = swDef.side === null || swDef.side === this.side
        if (!sideMatch) continue
        if (!this.hasBuildingPlacedOrConstructing(swId)) {
          if (this.tryBuildBuilding(swId)) {
            console.log(`[AI] Player ${this.playerId} building superweapon: ${swId}`)
            break
          }
        }
      }
    }
  }

  // ── Power management ─────────────────────────────────────────

  private needsMorePower(): boolean {
    const buildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state === 'active')
    let totalPower = 0
    for (const b of buildings) {
      totalPower += b.def.providespower
    }
    return totalPower < 50
  }

  private buildExtraPower(): boolean {
    // Collective late-game: prefer nuclear reactor (500 power)
    if (this.side === 'collective' && this.hasActiveBuilding('radar_tower')) {
      if (this.tryBuildBuilding('nuclear_reactor', true)) return true
    }
    return this.tryBuildBuilding(getPowerBuildingDefId(this.side), true)
  }

  // ── Defenses ─────────────────────────────────────────────────

  private buildDefenses(): void {
    if (!this.hasActiveBuilding('war_factory')) return

    const target = DEFENSE_TARGET[this.difficulty]

    // Early defenses (cheap, available after barracks)
    const earlyDefId = this.side === 'alliance' ? 'pillbox' : 'sentry_gun'
    const earlyCount = this.countBuildings(earlyDefId)
    if (earlyCount < Math.min(2, target)) {
      this.tryBuildBuilding(earlyDefId, true)
      return
    }

    // Late defenses (require mid-tech building)
    const midTechId = this.side === 'alliance' ? 'air_force_command' : 'radar_tower'
    if (!this.hasActiveBuilding(midTechId)) return

    const lateDefId = this.side === 'alliance' ? 'prism_tower' : 'tesla_coil'
    const lateCount = this.countBuildings(lateDefId)
    if (lateCount + earlyCount < target) {
      this.tryBuildBuilding(lateDefId, true)
    }
  }

  // ── Base defense reaction ────────────────────────────────────

  private defendBase(gameState: GameState): void {
    const buildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state !== 'dying')
    if (buildings.length === 0) return

    const baseRadiusPx = BASE_DEFENSE_RADIUS[this.difficulty] * TILE_SIZE
    let threatPos: { x: number; y: number } | null = null

    outer:
    for (const p of gameState.players) {
      if (p.id === this.playerId || p.isDefeated) continue
      for (const eu of this.em.getUnitsForPlayer(p.id)) {
        if (eu.state === 'dying' || !eu.def.attack) continue
        for (const b of buildings) {
          if (dist(eu.x, eu.y, b.x, b.y) < baseRadiusPx) {
            threatPos = { x: eu.x, y: eu.y }
            break outer
          }
        }
      }
    }

    if (!threatPos) return

    const responseRadiusPx = DEFENDER_RESPONSE_RADIUS[this.difficulty] * TILE_SIZE
    const defenders = this.getCombatUnits().filter(u => u.state === 'idle')
    let rallied = 0

    for (const u of defenders) {
      if (dist(u.x, u.y, threatPos.x, threatPos.y) < responseRadiusPx) {
        u.giveOrder({ type: 'attackMove', target: threatPos })
        rallied++
      }
    }

    if (rallied > 0) {
      console.log(`[AI] Player ${this.playerId} rallied ${rallied} units to defend base`)
    }
  }

  // ── Army building ────────────────────────────────────────────

  private buildArmy(gameState: GameState): void {
    const combatUnits = this.getCombatUnits()
    if (combatUnits.length >= MAX_ARMY[this.difficulty]) return

    // AI should continuously build and spend credits — queue multiple units per tick
    // Queue units from all available production buildings simultaneously
    const maxQueuePerTick = this.difficulty === 'hard' ? 5 : this.difficulty === 'medium' ? 3 : 2
    let queued = 0

    for (let i = 0; i < maxQueuePerTick; i++) {
      const unitToBuild = this.chooseUnitToBuild()
      if (!unitToBuild) break

      const player = gameState.players.find(p => p.id === this.playerId)
      const unitDef = UNIT_DEFS[unitToBuild]
      if (!player || !unitDef || player.credits < unitDef.stats.cost) break

      if (this.queueUnitIfPossible(unitToBuild, gameState)) {
        queued++
        // Don't let credits sit idle — keep spending
        if (combatUnits.length + queued >= MAX_ARMY[this.difficulty]) break
      } else {
        break
      }
    }
  }

  private chooseUnitToBuild(): string | null {
    const hasBarracks = this.hasActiveBuilding('barracks')
    const hasWarFactory = this.hasActiveBuilding('war_factory')
    if (!hasBarracks && !hasWarFactory) return null

    const basicInf = getBasicInfantryDefId(this.side)
    const mainTank = getMainTankDefId(this.side)

    // Easy mode: simple mix with slight variety
    if (this.difficulty === 'easy') {
      if (!hasWarFactory) return hasBarracks ? basicInf : null
      const vehicles = this.countUnitsByCategory('vehicle')
      if (vehicles < 3) return mainTank
      return Math.random() < 0.7 ? basicInf : mainTank
    }

    // Medium/Hard: weighted pool with counters and advanced units
    const pool = this.buildUnitPool()
    if (pool.length === 0) return hasBarracks ? basicInf : mainTank

    return pool[randomInt(0, pool.length - 1)]
  }

  private buildUnitPool(): string[] {
    const pool: string[] = []
    const basicInf = getBasicInfantryDefId(this.side)
    const mainTank = getMainTankDefId(this.side)

    // Core units always heavily weighted
    if (this.canProduceUnit(basicInf)) {
      pool.push(basicInf, basicInf)
    }
    if (this.canProduceUnit(mainTank)) {
      pool.push(mainTank, mainTank, mainTank)
    }

    // ── Side-specific mid-tier ──
    if (this.side === 'alliance') {
      if (this.canProduceUnit('ifv')) pool.push('ifv')
      if (this.canProduceUnit('rocketeer')) pool.push('rocketeer')
      if (this.canProduceUnit('mirage_tank')) pool.push('mirage_tank')
    } else {
      if (this.canProduceUnit('flak_track')) pool.push('flak_track')
      if (this.canProduceUnit('tesla_trooper')) pool.push('tesla_trooper', 'tesla_trooper')
      if (this.canProduceUnit('v3_launcher')) pool.push('v3_launcher')
    }

    // ── Late-tier heavy units ──
    if (this.phase === 'late') {
      if (this.side === 'collective') {
        if (this.canProduceUnit('apocalypse_tank')) pool.push('apocalypse_tank', 'apocalypse_tank')
        if (this.canProduceUnit('kirov')) pool.push('kirov')
      }
    }

    // ── Faction-exclusive units ──
    const exclusives = getFactionUnitIds(this.factionId)
    for (const id of exclusives) {
      const def = UNIT_DEFS[id]
      if (def?.attack && this.canProduceUnit(id)) {
        pool.push(id)
        if (this.difficulty === 'hard') pool.push(id) // double weight on hard
      }
    }

    // ── Counter-based adjustments ──
    const { infantry: ei, vehicles: ev, aircraft: ea, defenses: ed } = this.enemyComposition

    // Enemy heavy vehicles → more anti-tank
    if (ev > ei + 2) {
      if (this.side === 'collective') {
        if (this.canProduceUnit('tesla_trooper')) pool.push('tesla_trooper', 'tesla_trooper')
      } else {
        if (this.canProduceUnit('mirage_tank')) pool.push('mirage_tank')
      }
    }

    // Enemy heavy infantry → splash damage
    if (ei > ev + 3) {
      if (this.side === 'collective') {
        if (this.canProduceUnit('flak_track')) pool.push('flak_track', 'flak_track')
      } else {
        if (this.canProduceUnit('ifv')) pool.push('ifv')
      }
    }

    // Enemy aircraft → anti-air
    if (ea > 2) {
      if (this.side === 'alliance') {
        if (this.canProduceUnit('ifv')) pool.push('ifv', 'ifv', 'ifv')
        if (this.canProduceUnit('rocketeer')) pool.push('rocketeer', 'rocketeer')
      } else {
        if (this.canProduceUnit('flak_track')) pool.push('flak_track', 'flak_track', 'flak_track')
        if (this.canProduceUnit('flak_trooper')) pool.push('flak_trooper', 'flak_trooper')
      }
    }

    // Enemy turtling (many defenses) -> siege bias
    if (ed >= 4) {
      if (this.side === 'collective') {
        if (this.canProduceUnit('v3_launcher')) pool.push('v3_launcher', 'v3_launcher')
        if (this.canProduceUnit('dreadnought')) pool.push('dreadnought')
      } else {
        if (this.canProduceUnit('prism_tank')) pool.push('prism_tank', 'prism_tank')
        if (this.canProduceUnit('destroyer')) pool.push('destroyer')
      }
    }

    // If naval/air production exists, mix those units in instead of mono land spam.
    if (this.hasActiveBuilding('naval_shipyard')) {
      if (this.side === 'collective') {
        if (this.canProduceUnit('dreadnought')) pool.push('dreadnought')
        if (this.canProduceUnit('typhoon_sub')) pool.push('typhoon_sub')
      } else {
        if (this.canProduceUnit('destroyer')) pool.push('destroyer')
        if (this.canProduceUnit('aegis_cruiser')) pool.push('aegis_cruiser')
      }
    }

    if (this.hasActiveBuilding('air_force_command')) {
      if (this.canProduceUnit('rocketeer')) pool.push('rocketeer')
      if (this.canProduceUnit('black_eagle')) pool.push('black_eagle')
    }

    return pool
  }

  private canProduceUnit(defId: string): boolean {
    const def = UNIT_DEFS[defId]
    if (!def) return false

    // Faction availability
    const sideMatch = def.side === this.side || def.side === null
    const exclusiveMatch = def.factionExclusive === null || def.factionExclusive === this.factionId
    if (!sideMatch || !exclusiveMatch) return false

    // Producer building exists and active
    if (!this.findProducerFor(defId)) return false

    // Prerequisite buildings active
    for (const prereq of def.stats.prerequisites) {
      if (!this.hasActiveBuilding(prereq)) return false
    }

    return true
  }

  // ── Harassment ───────────────────────────────────────────────

  private considerHarassment(gameState: GameState): void {
    if (this.harassTimer < HARASS_INTERVAL_MS[this.difficulty]) return
    this.harassTimer = 0

    // Need enough army before diverting units (lower threshold on hard)
    const armyThreshold = this.difficulty === 'hard' ? 3 : 5
    if (this.getCombatUnits().length < armyThreshold) return

    // Find fast idle units for raiding (lower speed threshold on hard)
    const speedReq = this.difficulty === 'hard' ? 2.5 : 3
    const fastUnits = this.getCombatUnits().filter(
      u => u.state === 'idle' && u.def.stats.speed >= speedReq,
    )
    if (fastUnits.length < 2) return

    const target = this.findHarassTarget(gameState)
    if (!target) return

    const raidSize = clamp(
      this.difficulty === 'hard' ? 5 : this.difficulty === 'medium' ? 3 : 2,
      2,
      fastUnits.length,
    )

    for (let i = 0; i < raidSize; i++) {
      fastUnits[i].giveOrder({ type: 'attackMove', target })
    }

    console.log(`[AI] Player ${this.playerId} sending ${raidSize}-unit harassment raid`)
  }

  private findHarassTarget(gameState: GameState): { x: number; y: number } | null {
    for (const p of gameState.players) {
      if (p.id === this.playerId || p.isDefeated) continue

      // Prefer enemy harvesters
      const harvesters = this.em.getUnitsForPlayer(p.id).filter(
        u => u.def.category === 'harvester' && u.state !== 'dying',
      )
      if (harvesters.length > 0) {
        const h = harvesters[randomInt(0, harvesters.length - 1)]
        return { x: h.x, y: h.y }
      }

      // Otherwise target ore refineries
      const refineries = this.em.getBuildingsForPlayer(p.id).filter(
        b => b.def.id === 'ore_refinery' && b.state !== 'dying',
      )
      if (refineries.length > 0) {
        const r = refineries[randomInt(0, refineries.length - 1)]
        return { x: r.x, y: r.y }
      }
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

    if (this.matchTimer < FIRST_ATTACK_MS[this.difficulty]) return
    if (this.matchTimer < this.rebuildUntilMs) return
    if (this.attackTimer < this.nextAttackWindowMs) return

    const target = this.findAttackTarget(gameState)
    if (!target) return

    const waveSizeTarget = this.getScaledWaveSize(combatUnits.length)
    if (waveSizeTarget <= 0) return

    const waveUnits = this.pickWaveUnits(combatUnits, waveSizeTarget)
    if (waveUnits.length === 0) return

    const groups = this.buildAttackGroups(waveUnits, target, gameState)
    const pendingGroups: Array<{ unitIds: string[]; target: { x: number; y: number } }> = []

    for (const group of groups) {
      const staging = this.computeStagingPoint(group.target, gameState)
      for (const u of group.units) {
        u.giveOrder({ type: 'move', target: staging })
      }
      const ids = group.units.map(u => u.id)
      pendingGroups.push({ unitIds: ids, target: group.target })
      this.activeAttackGroups.push({ unitIds: ids, initialCount: ids.length })
    }

    this.pendingWave = {
      groups: pendingGroups,
      holdMs: STAGING_HOLD_MS,
    }

    this.isAttacking = true
    this.attackTimer = 0
    this.waveCount++
    this.nextAttackWindowMs = this.nextAttackWindow()

    console.log(
      `[AI] Player ${this.playerId} staged attack (${waveUnits.length} units, ${groups.length} prong(s))`,
    )
  }

  private updatePendingWave(delta: number): void {
    if (!this.pendingWave) return

    this.pendingWave.holdMs -= delta
    if (this.pendingWave.holdMs > 0) return

    let sent = 0
    for (const group of this.pendingWave.groups) {
      for (const id of group.unitIds) {
        const u = this.em.getUnit(id)
        if (!u || u.state === 'dying') continue
        u.giveOrder({ type: 'attackMove', target: group.target })
        sent++
      }
    }

    this.pendingWave = null
    this.isAttacking = sent > 0
  }

  private getScaledWaveSize(available: number): number {
    const cfg = ATTACK_WAVE_SIZE[this.difficulty]
    const elapsedMinutes = this.matchTimer / 60000
    const timeScale = Math.min(1, elapsedMinutes / 10)
    const waveScale = Math.min(1, this.waveCount / 6)
    const growth = Math.max(timeScale, waveScale)
    const dynamicMin = Math.min(cfg.max, cfg.min + Math.floor((cfg.max - cfg.min) * growth))
    const dynamicMax = Math.min(cfg.max, dynamicMin + Math.max(2, Math.floor((cfg.max - cfg.min) * 0.35)))
    const requested = randomInt(dynamicMin, dynamicMax)
    return Math.min(available, requested)
  }

  private buildAttackGroups(
    waveUnits: Unit[],
    target: { x: number; y: number },
    gameState: GameState,
  ): Array<{ units: Unit[]; target: { x: number; y: number } }> {
    if (this.difficulty !== 'hard' || waveUnits.length < 10) {
      return [{ units: waveUnits, target }]
    }
    const split = Math.floor(waveUnits.length / 2)
    const first = waveUnits.slice(0, split)
    const second = waveUnits.slice(split)
    const flank = this.computeFlankTarget(target, gameState, 6 * TILE_SIZE)
    return [
      { units: first, target },
      { units: second, target: flank },
    ]
  }

  private computeFlankTarget(
    target: { x: number; y: number },
    gameState: GameState,
    offset: number,
  ): { x: number; y: number } {
    const mapW = gameState.map.width * TILE_SIZE
    const mapH = gameState.map.height * TILE_SIZE
    const sign = Math.random() < 0.5 ? -1 : 1
    return {
      x: clamp(target.x + offset * sign, TILE_SIZE, Math.max(TILE_SIZE, mapW - TILE_SIZE)),
      y: clamp(target.y + offset * -sign * 0.6, TILE_SIZE, Math.max(TILE_SIZE, mapH - TILE_SIZE)),
    }
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

  // ── Strategic attack targeting ───────────────────────────────

  private findAttackTarget(gameState: GameState): { x: number; y: number } | null {
    const allEnemyBuildings: Building[] = []
    for (const p of gameState.players) {
      if (p.id === this.playerId || p.isDefeated) continue
      allEnemyBuildings.push(
        ...this.em.getBuildingsForPlayer(p.id).filter(b => b.state !== 'dying'),
      )
    }

    if (allEnemyBuildings.length === 0) return null

    // Priority: power plants -> refineries -> war factories -> CY -> any building.
    const priorities = [
      ['power_plant', 'tesla_reactor', 'nuclear_reactor'],
      ['ore_refinery'],
      ['war_factory'],
      ['construction_yard'],
    ]

    for (const group of priorities) {
      const target = allEnemyBuildings.find(b => group.includes(b.def.id))
      if (target) return { x: target.x, y: target.y }
    }

    // Fallback: any building
    const any = allEnemyBuildings[0]
    return { x: any.x, y: any.y }
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

  private retreatDamagedUnits(): void {
    const fallback = this.getFallbackPosition()
    if (!fallback) return
    for (const u of this.getCombatUnits()) {
      if (u.state === 'dying') continue
      const hpPct = u.hp / Math.max(1, u.def.stats.maxHp)
      if (hpPct <= RETREAT_HEALTH_PCT) {
        u.giveOrder({ type: 'move', target: fallback })
      }
    }
  }

  // ── Scouting ─────────────────────────────────────────────────

  private considerScouting(gameState: GameState): void {
    const scoutInterval = this.difficulty === 'hard' ? 12000 : 20000
    if (this.scoutTimer < scoutInterval) return
    this.scoutTimer = 0

    const units = this.em.getUnitsForPlayer(this.playerId)
    // Hard: also use fast infantry for scouting
    const speedReq = this.difficulty === 'hard' ? 2.5 : 3.5
    const fastUnit = units.find(
      u => u.state === 'idle' && u.def.stats.speed >= speedReq &&
        (u.def.category === 'vehicle' || (this.difficulty === 'hard' && u.def.category === 'infantry')),
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

    const units = this.getCombatUnits().filter(u => u.state === 'idle')
    if (units.length < ATTACK_WAVE_SIZE.hard.min) return

    const target = this.findAttackTarget(gameState)
    if (!target) return

    // Split into 3 groups for pincer attacks
    const third = Math.floor(units.length / 3)
    const group1 = units.slice(0, third)
    const group2 = units.slice(third, third * 2)
    const group3 = units.slice(third * 2)

    const offset = 250
    for (const u of group1) {
      u.giveOrder({ type: 'attackMove', target: { x: target.x + offset, y: target.y } })
    }
    for (const u of group2) {
      u.giveOrder({ type: 'attackMove', target: { x: target.x, y: target.y + offset } })
    }
    for (const u of group3) {
      u.giveOrder({ type: 'attackMove', target: { x: target.x - offset, y: target.y } })
    }
  }

  // ── Building construction ────────────────────────────────────

  private tryBuildBuilding(defId: string, allowDuplicate = false): boolean {
    const def = BUILDING_DEFS[defId]
    if (!def) return false

    const sideMatch = def.side === null || def.side === this.side
    const exclusiveMatch = def.factionExclusive === null || def.factionExclusive === this.factionId
    if (!sideMatch || !exclusiveMatch) return false

    if (!this.hasActiveBuilding('construction_yard')) return false
    if (!allowDuplicate && this.hasBuildingPlacedOrConstructing(defId)) return false

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

    if (def.category === 'defense') {
      const defensePlacement = this.findDefensePlacement(def)
      if (defensePlacement) return defensePlacement
    }

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

  private findDefensePlacement(def: Building['def']): { col: number; row: number } | null {
    const ownBuildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state !== 'dying')
    const cy = ownBuildings.find(b => b.def.id === 'construction_yard' && b.state === 'active') ?? ownBuildings[0]
    if (!cy) return null

    const enemyTarget = this.findEnemyBaseAnchor()
    const toX = (enemyTarget?.x ?? cy.x + TILE_SIZE * 8) - cy.x
    const toY = (enemyTarget?.y ?? cy.y) - cy.y
    const len = Math.max(1, Math.sqrt(toX * toX + toY * toY))
    const nx = toX / len
    const ny = toY / len

    const ringDist = 5 * TILE_SIZE
    const centerX = cy.x + nx * ringDist
    const centerY = cy.y + ny * ringDist
    const perpX = -ny
    const perpY = nx
    const lateral = [0, 2, -2, 4, -4]

    for (const tileOffset of lateral) {
      const wx = centerX + perpX * tileOffset * TILE_SIZE
      const wy = centerY + perpY * tileOffset * TILE_SIZE
      const col = Math.floor(wx / TILE_SIZE - def.footprint.w / 2)
      const row = Math.floor(wy / TILE_SIZE - def.footprint.h / 2)
      if (!this.isPlacementWithinMap(col, row, def.footprint.w, def.footprint.h)) continue
      if (this.isTileFree(col, row, def.footprint.w, def.footprint.h)) {
        return { col, row }
      }
    }

    return null
  }

  private findEnemyBaseAnchor(): { x: number; y: number } | null {
    for (const p of this.em.getAllBuildings()) {
      if (p.playerId === this.playerId || p.state === 'dying') continue
      if (p.def.id === 'construction_yard') return { x: p.x, y: p.y }
    }
    const fallback = this.em.getAllBuildings().find(b => b.playerId !== this.playerId && b.state !== 'dying')
    return fallback ? { x: fallback.x, y: fallback.y } : null
  }

  private isPlacementWithinMap(col: number, row: number, w: number, h: number): boolean {
    if (col < 0 || row < 0) return false
    if (this.mapWidthTiles > 0 && col + w > this.mapWidthTiles) return false
    if (this.mapHeightTiles > 0 && row + h > this.mapHeightTiles) return false
    return true
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

  // ── Rebuild destroyed buildings ────────────────────────────

  private rebuildDestroyedBuildings(_gameState: GameState): void {
    if (this.difficulty === 'easy') return
    if (!this.hasActiveBuilding('construction_yard')) return

    // Check for missing critical buildings and rebuild them
    const critical = [
      getPowerBuildingDefId(this.side),
      'barracks',
      'ore_refinery',
      'war_factory',
    ]

    for (const defId of critical) {
      if (!this.hasBuildingPlacedOrConstructing(defId)) {
        if (this.tryBuildBuilding(defId)) {
          console.log(`[AI] Player ${this.playerId} rebuilding destroyed ${defId}`)
          return  // One rebuild per tick
        }
      }
    }

    // Hard mode: also rebuild mid-tech and battle lab
    if (this.difficulty === 'hard') {
      const midTechId = this.side === 'alliance' ? 'air_force_command' : 'radar_tower'
      if (this.phase !== 'early' && !this.hasBuildingPlacedOrConstructing(midTechId)) {
        this.tryBuildBuilding(midTechId)
        return
      }
      if (this.phase === 'late' && !this.hasBuildingPlacedOrConstructing('battle_lab')) {
        this.tryBuildBuilding('battle_lab')
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private nextAttackWindow(): number {
    const w = ATTACK_INTERVAL_MS[this.difficulty]
    if (this.matchTimer < this.aggressionUntilMs) {
      return randomInt(Math.floor(w.min * 0.55), Math.floor(w.max * 0.7))
    }
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

  private countBuildings(defId: string): number {
    return this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === defId && b.state !== 'dying',
    ).length
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

  private countUnitsByCategory(category: string): number {
    return this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.state !== 'dying' && u.def.category === category,
    ).length
  }

  // ── Superweapon management ──────────────────────────────────

  private tickSuperweapons(gameState: GameState): void {
    const interval = TICK_INTERVAL[this.difficulty]

    // Track superweapon buildings and countdown timers
    for (const swId of AI.SW_IDS) {
      const hasBuilding = this.hasActiveBuilding(swId)
      if (hasBuilding && !this.superweaponTimers.has(swId) && !this.superweaponReady.has(swId)) {
        this.superweaponTimers.set(swId, AI.SW_COOLDOWNS[swId])
      }
      if (!hasBuilding) {
        this.superweaponTimers.delete(swId)
        this.superweaponReady.delete(swId)
      }
    }

    // Tick down timers
    for (const [swId, remaining] of this.superweaponTimers) {
      const newRemaining = remaining - interval
      if (newRemaining <= 0) {
        this.superweaponTimers.delete(swId)
        this.superweaponReady.add(swId)
        console.log(`[AI] Player ${this.playerId} superweapon ${swId} READY`)
      } else {
        this.superweaponTimers.set(swId, newRemaining)
      }
    }

    // Fire ready superweapons
    for (const swId of this.superweaponReady) {
      const target = this.findSuperweaponTarget(gameState, swId)
      if (!target) continue

      // Emit event for GameScene to handle
      this.em.emit('ai_fire_superweapon', {
        defId: swId,
        targetX: target.x,
        targetY: target.y,
        playerId: this.playerId,
      })
      this.superweaponReady.delete(swId)
      this.superweaponTimers.set(swId, AI.SW_COOLDOWNS[swId])
      console.log(`[AI] Player ${this.playerId} fired ${swId} at (${Math.round(target.x)}, ${Math.round(target.y)})`)
      break // Only fire one per tick
    }
  }

  private findSuperweaponTarget(gameState: GameState, swId: string): { x: number; y: number } | null {
    if (swId === 'iron_curtain') {
      // Target own army concentration — use on attack wave units if pending
      const units = this.pendingWave
        ? this.pendingWave.groups.flatMap(g => g.unitIds).map(id => this.em.getUnit(id)).filter((u): u is Unit => !!u && u.state !== 'dying')
        : this.getCombatUnits()
      if (units.length >= 3) {
        const cx = units.reduce((s, u) => s + u.x, 0) / units.length
        const cy = units.reduce((s, u) => s + u.y, 0) / units.length
        return { x: cx, y: cy }
      }
      return null
    }

    if (swId === 'chronosphere') {
      // Teleport tanks directly into enemy base
      const tanks = this.getCombatUnits().filter(u =>
        u.def.category === 'vehicle' && u.state !== 'dying'
      ).slice(0, 5)
      if (tanks.length < 2) return null

      // Find enemy CY to teleport near
      for (const p of gameState.players) {
        if (p.id === this.playerId || p.isDefeated) continue
        const enemyBuildings = this.em.getBuildingsForPlayer(p.id).filter(b => b.state !== 'dying')
        const cy = enemyBuildings.find(b => b.def.id === 'construction_yard')
        if (cy) return { x: cy.x, y: cy.y }
        if (enemyBuildings.length > 0) return { x: enemyBuildings[0].x, y: enemyBuildings[0].y }
      }
      return null
    }

    // Nuclear/Weather: target area with highest concentration of enemy entities
    for (const p of gameState.players) {
      if (p.id === this.playerId || p.isDefeated) continue
      const enemyBuildings = this.em.getBuildingsForPlayer(p.id).filter(b => b.state !== 'dying')
      const enemyUnits = this.em.getUnitsForPlayer(p.id).filter(u => u.state !== 'dying')
      if (enemyBuildings.length === 0 && enemyUnits.length === 0) continue

      // Score each enemy building location by nearby entity density
      let bestScore = 0
      let bestTarget: { x: number; y: number } | null = null
      const radiusPx = 6 * TILE_SIZE

      for (const b of enemyBuildings) {
        let score = 0
        for (const ob of enemyBuildings) {
          if (dist(b.x, b.y, ob.x, ob.y) <= radiusPx) score += 2
        }
        for (const u of enemyUnits) {
          if (dist(b.x, b.y, u.x, u.y) <= radiusPx) score += 1
        }
        // Bonus for high-value targets
        if (b.def.id === 'construction_yard') score += 5
        if (b.def.category === 'production') score += 3
        if (b.def.category === 'power') score += 2

        if (score > bestScore) {
          bestScore = score
          bestTarget = { x: b.x, y: b.y }
        }
      }

      if (bestTarget) return bestTarget
      if (enemyBuildings.length > 0) return { x: enemyBuildings[0].x, y: enemyBuildings[0].y }
    }
    return null
  }

  /** Expose hard-mode attack split hook for external callers. */
  triggerMultiProng(gameState: GameState): void {
    this.considerMultiProng(gameState)
  }

  setAggressiveFor(durationMs: number): void {
    this.aggressionUntilMs = Math.max(this.aggressionUntilMs, this.matchTimer + durationMs)
    this.rebuildUntilMs = 0
    this.attackTimer = Math.max(this.attackTimer, this.nextAttackWindowMs)
  }

  private updateAttackGroups(): void {
    if (this.activeAttackGroups.length === 0) return
    const fallback = this.getFallbackPosition()
    this.activeAttackGroups = this.activeAttackGroups.filter(group => {
      const alive = group.unitIds
        .map(id => this.em.getUnit(id))
        .filter((u): u is Unit => !!u && u.state !== 'dying')
      if (alive.length === 0) return false

      if (alive.length <= Math.floor(group.initialCount / 2)) {
        if (fallback) {
          for (const u of alive) {
            u.giveOrder({ type: 'move', target: fallback })
          }
        }
        this.rebuildUntilMs = Math.max(this.rebuildUntilMs, this.matchTimer + REBUILD_RECOVERY_MS[this.difficulty])
        this.isAttacking = false
        return false
      }
      return true
    })
  }

  private getFallbackPosition(): { x: number; y: number } | null {
    const cy = this.em.getBuildingsForPlayer(this.playerId)
      .find(b => b.def.id === 'construction_yard' && b.state !== 'dying')
    if (cy) return { x: cy.x, y: cy.y }
    const any = this.em.getBuildingsForPlayer(this.playerId).find(b => b.state !== 'dying')
    return any ? { x: any.x, y: any.y } : null
  }
}
