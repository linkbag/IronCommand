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
import { BUILDING_DEFS, NEUTRAL_BUILDING_IDS, getPowerBuildingDefId } from '../entities/BuildingDefs'
import { FACTIONS } from '../data/factions'
import { Unit } from '../entities/Unit'
import type { Building } from '../entities/Building'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

type AIPhase = 'early' | 'mid' | 'late'

type PendingWave = {
  groups: Array<{ unitIds: string[]; target: { x: number; y: number } }>
  holdMs: number
}

type AttackGroup = {
  waveId: number
  unitIds: string[]
  initialCount: number
  target: { x: number; y: number }
  retreating: boolean
  focusTargetId: string | null
  focusRetargetMs: number
}

type DangerZone = {
  x: number
  y: number
  intensity: number
  ttlMs: number
}

type TargetChoice = {
  x: number
  y: number
  entityId?: string
}

type AIStrategicDoctrine = 'economy' | 'power' | 'production' | 'collapse'

type EnemyMacroIntel = {
  combatUnits: number
  productionBuildings: number
  refineries: number
  powerBuildings: number
  lowPowerPlayers: number
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
const RETREAT_WAVE_LOSS_THRESHOLD = 0.5
const OPENING_SECOND_HARVESTER_DEADLINE_MS = 120000
const ECONOMY_SAMPLE_WINDOW_MS = 15000
const EXPANSION_MIN_DISTANCE_TILES = 10
const ORE_NEAR_BASE_RADIUS_TILES = 10
const ORE_DEPLETION_DISTANCE_TILES = 16
const HIGH_CREDIT_THRESHOLD = 5000
const GROUP_RETREAT_THRESHOLD = 0.5
const GROUP_REGROUP_HEALTH_PCT = 0.8
const KITE_REISSUE_MS = 750
const FORMATION_ARC_DEGREES = 120
const OVERWHELMED_FORCE_RATIO = 1.3
const BASE_THREAT_RADIUS_TILES = 14
const AA_RESPONSE_RADIUS_TILES = 24
const EMERGENCY_SELL_COOLDOWN_MS = 15000
const REBUILD_RECOVERY_MS: Record<AIDifficulty, number> = {
  easy: 70000,
  medium: 50000,
  hard: 40000,
}
const DANGER_ZONE_RADIUS = 5 * TILE_SIZE
const DANGER_ZONE_TTL_MS = 120000
const DANGER_ZONE_DECAY_PER_TICK = 0.93
const FOCUS_FIRE_INTERVAL_MS = 900
const MAP_CONTROL_INTERVAL_MS = 15000
const SCOUT_REVISIT_MS = 90000
const OPPORTUNISTIC_FORCE_RATIO = 1.28
const OPPORTUNISTIC_MIN_ARMY: Record<AIDifficulty, number> = {
  easy: 8,
  medium: 7,
  hard: 6,
}
const MIN_HOME_GARRISON: Record<AIDifficulty, number> = {
  easy: 1,
  medium: 3,
  hard: 5,
}
const MAX_DEFENDER_COMMIT: Record<AIDifficulty, number> = {
  easy: 4,
  medium: 8,
  hard: 12,
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
  private nextWaveId: number
  private rebuildUntilMs: number
  private aggressionUntilMs: number
  private activeAttackGroups: AttackGroup[]
  private waveInitialCounts: Map<number, number>
  private focusFireTimer: number
  private mapControlTimer: number
  private knownDangerZones: DangerZone[]
  private lastKnownUnitPositions: Map<string, { x: number; y: number }>
  private enemyKillPressure: Map<string, number>
  private enemyHasAirSuperiority: boolean
  private enemyIsTurtling: boolean
  private enemyIsRushing: boolean
  private strategicDoctrine: AIStrategicDoctrine
  private enemyMacroIntel: EnemyMacroIntel
  private lastCredits: number
  private economySampleMs: number
  private incomeAccum: number
  private spendingAccum: number
  private incomePerMinute: number
  private spendingPerMinute: number
  private openingHarvesterQueued: boolean
  private lastBuildingCount: number
  private losingBuildingsUntilMs: number
  private harvesterHpSnapshot: Map<string, number>
  private expansionAnchor: { x: number; y: number } | null
  private unitKiteUntilMs: Map<string, number>
  private antiAirEmergencyUntilMs: number
  private lastEmergencySellMs: number
  private scoutVisitMs: Map<string, number>

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
    this.nextWaveId = 1
    this.rebuildUntilMs = 0
    this.aggressionUntilMs = 0
    this.activeAttackGroups = []
    this.waveInitialCounts = new Map()
    this.focusFireTimer = 0
    this.mapControlTimer = 0
    this.knownDangerZones = []
    this.lastKnownUnitPositions = new Map()
    this.enemyKillPressure = new Map()
    this.enemyHasAirSuperiority = false
    this.enemyIsTurtling = false
    this.enemyIsRushing = false
    this.strategicDoctrine = 'economy'
    this.enemyMacroIntel = {
      combatUnits: 0,
      productionBuildings: 0,
      refineries: 0,
      powerBuildings: 0,
      lowPowerPlayers: 0,
    }
    this.lastCredits = this.economy.getCredits(this.playerId)
    this.economySampleMs = 0
    this.incomeAccum = 0
    this.spendingAccum = 0
    this.incomePerMinute = 0
    this.spendingPerMinute = 0
    this.openingHarvesterQueued = false
    this.lastBuildingCount = 0
    this.losingBuildingsUntilMs = 0
    this.harvesterHpSnapshot = new Map()
    this.expansionAnchor = null
    this.unitKiteUntilMs = new Map()
    this.antiAirEmergencyUntilMs = 0
    this.lastEmergencySellMs = -EMERGENCY_SELL_COOLDOWN_MS
    this.scoutVisitMs = new Map()
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
    this.focusFireTimer += delta
    this.mapControlTimer += delta
    this.matchTimer += delta
    this.updateEconomyTelemetry(delta)

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
    this.trackBaseLossState(buildings.length)

    this.updatePhase()
    this.updateBattlefieldIntel(gameState)
    this.assessEnemyComposition(gameState)
    this.updateStrategicDoctrine(gameState)
    this.ensureHarvesting(gameState)
    this.protectHarvesters(gameState)
    this.microSpecialUnits(gameState)
    this.handleAntiAirResponse(gameState)

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
    this.contestMapControl(gameState)
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

  private updateBattlefieldIntel(gameState: GameState): void {
    const currentUnits = this.getCombatUnits()
    const currentIds = new Set(currentUnits.map(u => u.id))

    // Track where our combat units died to identify danger corridors.
    for (const [id, lastPos] of this.lastKnownUnitPositions.entries()) {
      if (currentIds.has(id)) continue
      this.addDangerZone(lastPos.x, lastPos.y, 1.25)
      this.recordLikelyKillSource(gameState, lastPos.x, lastPos.y)
      this.lastKnownUnitPositions.delete(id)
    }

    for (const u of currentUnits) {
      this.lastKnownUnitPositions.set(u.id, { x: u.x, y: u.y })
    }

    for (const zone of this.knownDangerZones) {
      zone.intensity *= DANGER_ZONE_DECAY_PER_TICK
      zone.ttlMs -= TICK_INTERVAL[this.difficulty]
    }
    this.knownDangerZones = this.knownDangerZones.filter(z => z.ttlMs > 0 && z.intensity > 0.15)
  }

  private addDangerZone(x: number, y: number, amount: number): void {
    const existing = this.knownDangerZones.find(z => dist(z.x, z.y, x, y) <= DANGER_ZONE_RADIUS)
    if (existing) {
      existing.x = (existing.x * existing.intensity + x * amount) / (existing.intensity + amount)
      existing.y = (existing.y * existing.intensity + y * amount) / (existing.intensity + amount)
      existing.intensity = Math.min(5, existing.intensity + amount)
      existing.ttlMs = Math.max(existing.ttlMs, DANGER_ZONE_TTL_MS)
      return
    }
    this.knownDangerZones.push({ x, y, intensity: amount, ttlMs: DANGER_ZONE_TTL_MS })
  }

  private recordLikelyKillSource(gameState: GameState, x: number, y: number): void {
    const radius = 6 * TILE_SIZE
    const counts = new Map<string, number>()
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      for (const eu of this.em.getUnitsForPlayer(p.id)) {
        if (eu.state === 'dying' || !eu.def.attack) continue
        if (dist(eu.x, eu.y, x, y) > radius) continue
        counts.set(eu.def.id, (counts.get(eu.def.id) ?? 0) + 2)
      }
      for (const eb of this.em.getBuildingsForPlayer(p.id)) {
        if (eb.state === 'dying' || !eb.def.attack) continue
        if (dist(eb.x, eb.y, x, y) > radius) continue
        counts.set(eb.def.id, (counts.get(eb.def.id) ?? 0) + 1)
      }
    }
    for (const [id, score] of counts.entries()) {
      this.enemyKillPressure.set(id, (this.enemyKillPressure.get(id) ?? 0) + score)
    }
  }

  private assessEnemyComposition(gameState: GameState): void {
    let infantry = 0, vehicles = 0, aircraft = 0, defenses = 0
    let aggressionNearBase = 0
    const ownAnchor = this.getFallbackPosition()
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      for (const u of this.em.getUnitsForPlayer(p.id)) {
        if (u.state === 'dying') continue
        if (u.def.category === 'infantry') infantry++
        else if (u.def.category === 'vehicle') vehicles++
        else if (u.def.category === 'aircraft') aircraft++
        if (ownAnchor && dist(u.x, u.y, ownAnchor.x, ownAnchor.y) <= 12 * TILE_SIZE) aggressionNearBase++
      }
      for (const b of this.em.getBuildingsForPlayer(p.id)) {
        if (b.state !== 'dying' && b.def.category === 'defense') defenses++
      }
    }
    this.enemyComposition = { infantry, vehicles, aircraft, defenses }
    const enemyArmy = infantry + vehicles + aircraft
    this.enemyIsTurtling = defenses >= 4 && enemyArmy <= Math.max(6, defenses + 2) && this.matchTimer > 180000
    this.enemyIsRushing = this.matchTimer < 240000 && aggressionNearBase >= (this.difficulty === 'easy' ? 3 : 5)
    this.enemyHasAirSuperiority = aircraft >= Math.max(4, vehicles + 1)

  }

  private updateStrategicDoctrine(gameState: GameState): void {
    let enemyCombat = 0
    let enemyProd = 0
    let enemyRef = 0
    let enemyPower = 0
    let enemyLowPowerPlayers = 0

    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      const ps = this.economy.getPowerState(p.id)
      const powerRatio = ps.generated <= 0 ? 0 : ps.generated / Math.max(1, ps.generated + ps.consumed)
      if (ps.isLow || powerRatio < 0.62) enemyLowPowerPlayers++

      enemyCombat += this.em.getUnitsForPlayer(p.id).filter(u => u.state !== 'dying' && !!u.def.attack).length
      for (const b of this.em.getBuildingsForPlayer(p.id)) {
        if (b.state === 'dying') continue
        if (b.def.category === 'production') enemyProd++
        if (b.def.category === 'power') enemyPower++
        if (b.def.id === 'ore_refinery') enemyRef++
      }
    }

    this.enemyMacroIntel = {
      combatUnits: enemyCombat,
      productionBuildings: enemyProd,
      refineries: enemyRef,
      powerBuildings: enemyPower,
      lowPowerPlayers: enemyLowPowerPlayers,
    }

    const ownCombat = this.getCombatUnits().length
    const forceRatio = ownCombat / Math.max(1, enemyCombat)

    let doctrine: AIStrategicDoctrine = 'production'
    if (enemyLowPowerPlayers > 0 && enemyPower >= 2 && forceRatio >= 0.9) {
      doctrine = 'power'
    } else if ((enemyRef >= 2 && this.phase !== 'late') || (this.phase === 'early' && enemyRef > 0)) {
      doctrine = 'economy'
    } else if (this.enemyIsTurtling || enemyProd >= 3) {
      doctrine = 'production'
    } else if (forceRatio >= OPPORTUNISTIC_FORCE_RATIO || this.matchTimer >= 9 * 60000) {
      doctrine = 'collapse'
    }

    if (this.enemyIsRushing && this.phase === 'early' && doctrine === 'collapse') {
      doctrine = 'economy'
    }

    this.strategicDoctrine = doctrine
  }

  // ── Economy / harvesting ─────────────────────────────────────

  private ensureHarvesting(gameState: GameState): void {
    const harvesters = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category === 'harvester' && u.state !== 'dying',
    )

    const refineries = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'ore_refinery' && b.state === 'active',
    )

    const perRefTarget = this.difficulty === 'hard' ? 3 : 2
    const desiredHarvesters = Math.max(2, refineries.length * perRefTarget)
    const openingNeedsSecondHarvester =
      this.matchTimer <= OPENING_SECOND_HARVESTER_DEADLINE_MS &&
      harvesters.length < 2 &&
      this.hasActiveBuilding('ore_refinery')

    if (openingNeedsSecondHarvester && !this.openingHarvesterQueued) {
      this.openingHarvesterQueued = this.queueUnitIfPossible(getHarvesterDefId(this.side), gameState)
    } else if (harvesters.length < desiredHarvesters) {
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

    if (harvesters.length >= 2) {
      this.openingHarvesterQueued = true
    }
  }

  // ── Economy expansion ────────────────────────────────────────

  private expandEconomy(gameState: GameState): void {
    const credits = this.economy.getCredits(this.playerId)
    const refCount = this.countBuildings('ore_refinery')
    const baseMaxRef = this.difficulty === 'hard' ? 5 : this.difficulty === 'medium' ? 4 : 3
    const maxRef = this.enemyIsTurtling ? baseMaxRef + 1 : baseMaxRef
    if (refCount >= maxRef || !this.hasActiveBuilding('construction_yard')) return

    const armyReady = this.getCombatUnits().length >= (this.difficulty === 'hard' ? 8 : 6)
    const baseOreDepleted = this.isBaseOreRunningLow()
    const timedExpansion = this.shouldExpandByTime()
    const ecoFloating = this.incomePerMinute > this.spendingPerMinute && credits > 2500
    const ecoStrained = this.incomePerMinute > 0 && this.incomePerMinute < this.spendingPerMinute
    const needMoreHarvesters = this.shouldPrioritizeHarvesters()

    if (ecoStrained && needMoreHarvesters) {
      this.queueUnitIfPossible(getHarvesterDefId(this.side), gameState)
      return
    }

    const shouldExpand =
      (baseOreDepleted || timedExpansion || (ecoFloating && credits > 3200) || credits > HIGH_CREDIT_THRESHOLD) &&
      (armyReady || credits > HIGH_CREDIT_THRESHOLD)

    if (!shouldExpand) return

    const oreTarget = this.findExpansionOreTarget(gameState)
    if (oreTarget) {
      this.expansionAnchor = oreTarget
    }

    const expanded = this.tryBuildRefineryExpansion(gameState) || this.tryBuildBuilding('ore_refinery', true)
    if (expanded) {
      console.log(`[AI] Player ${this.playerId} expanding economy — refinery #${refCount + 1}`)
      this.expansionAnchor = null
    }
  }

  private tryBuildRefineryExpansion(gameState: GameState): boolean {
    const placement = this.findOreExpansionPlacement(gameState)
    if (!placement) return false
    return this.tryBuildBuildingAt('ore_refinery', placement.col, placement.row)
  }

  private contestMapControl(gameState: GameState): void {
    if (this.mapControlTimer < MAP_CONTROL_INTERVAL_MS) return
    this.mapControlTimer = 0
    const idle = this.getCombatUnits().filter(u => u.state === 'idle')
    if (idle.length < 3) return

    const keyPoints = [
      ...this.getOreFieldAnchors(gameState, 2),
      { x: gameState.map.width * TILE_SIZE * 0.5, y: gameState.map.height * TILE_SIZE * 0.5 },
      { x: gameState.map.width * TILE_SIZE * 0.25, y: gameState.map.height * TILE_SIZE * 0.5 },
      { x: gameState.map.width * TILE_SIZE * 0.75, y: gameState.map.height * TILE_SIZE * 0.5 },
    ]

    for (const point of keyPoints) {
      if (!this.isPointContested(point.x, point.y)) continue
      if (this.getDangerScore(point.x, point.y) > 2.2) continue
      const squadSize = this.difficulty === 'hard' ? 4 : 3
      const squad = idle.splice(0, Math.min(idle.length, squadSize))
      if (squad.length < 2) break
      for (const u of squad) {
        u.giveOrder({ type: 'attackMove', target: point })
      }
      if (idle.length < 2) break
    }
  }

  // ── Tech tree ────────────────────────────────────────────────

  private followTechTree(gameState: GameState): void {
    const powerId = getPowerBuildingDefId(this.side)
    const basicInfantry = getBasicInfantryDefId(this.side)
    const underEarlyPressure = this.isUnderEarlyPressure(gameState)
    const hardOpening = this.difficulty === 'hard' && this.matchTimer < 210000

    // 1. Power first
    if (!this.hasBuildingPlacedOrConstructing(powerId)) {
      this.tryBuildBuilding(powerId)
      return
    }

    // 2. Refinery before production if somehow missing
    if (!this.hasBuildingPlacedOrConstructing('ore_refinery')) {
      this.tryBuildBuilding('ore_refinery')
      return
    }

    // 3. Barracks
    if (!this.hasBuildingPlacedOrConstructing('barracks')) {
      this.tryBuildBuilding('barracks')
      return
    }

    // 3b. Rush defense: build a cheap defense if enemy is rushing
    if (this.enemyIsRushing && this.countBuildings(this.side === 'alliance' ? 'pillbox' : 'sentry_gun') < 1) {
      if (this.tryBuildBuilding(this.side === 'alliance' ? 'pillbox' : 'sentry_gun', true)) return
    }

    // 4. Preemptive power reserve (80% usage threshold)
    if (this.needsMorePower()) {
      this.buildExtraPower()
      return
    }

    // 5. Early pressure response: infantry and defense first
    if (underEarlyPressure) {
      const rushInfantryTarget = this.difficulty === 'hard' ? 10 : 7
      if (this.getCombatInfantryCount() < rushInfantryTarget) {
        this.queueUnitIfPossible(basicInfantry, gameState)
        return
      }
      if (!this.hasBuildingPlacedOrConstructing('war_factory') && this.getCombatInfantryCount() < rushInfantryTarget + 2) {
        return
      }
    }

    // 6. Ensure 2nd harvester in opening (within first two minutes)
    const harvesters = this.countUnitsByCategory('harvester')
    if (this.matchTimer <= OPENING_SECOND_HARVESTER_DEADLINE_MS && harvesters < 2) {
      this.queueUnitIfPossible(getHarvesterDefId(this.side), gameState)
      return
    }

    // 7. Some infantry before War Factory
    const infantryCount = this.getCombatInfantryCount()
    const infantryBeforeWF = hardOpening
      ? Math.max(2, INFANTRY_BEFORE_WAR_FACTORY[this.difficulty] - 2)
      : INFANTRY_BEFORE_WAR_FACTORY[this.difficulty]
    if (infantryCount < infantryBeforeWF) {
      this.queueUnitIfPossible(basicInfantry, gameState)
      return
    }

    // 8. War Factory
    if (!this.hasBuildingPlacedOrConstructing('war_factory')) {
      this.tryBuildBuilding('war_factory')
      return
    }

    // 9. Opportunistic second production lines when economy is strong
    if (this.shouldAddProductionStructures()) {
      const barracksTarget = this.difficulty === 'hard' ? 2 : 1
      const warFactoryTarget = this.difficulty === 'hard' ? 2 : 1
      if (this.countBuildings('barracks') < barracksTarget) {
        this.tryBuildBuilding('barracks', true)
        return
      }
      if (this.countBuildings('war_factory') < warFactoryTarget) {
        this.tryBuildBuilding('war_factory', true)
        return
      }
    }

    // 10. Extra power if needed before mid-tech
    if (this.needsMorePower()) {
      this.buildExtraPower()
      return
    }

    // 11. Mid-game tech building
    const midTechId = this.side === 'alliance' ? 'air_force_command' : 'radar_tower'
    if (!this.hasBuildingPlacedOrConstructing(midTechId)) {
      const tanksNeeded = this.difficulty === 'easy' ? 3 : 1
      if (this.countUnitsByCategory('vehicle') >= tanksNeeded) {
        this.tryBuildBuilding(midTechId)
      }
      return
    }

    // 12. More power for late-game
    if (this.needsMorePower()) {
      this.buildExtraPower()
      return
    }

    // 13. Battle Lab
    if (!this.hasBuildingPlacedOrConstructing('battle_lab')) {
      if (this.difficulty !== 'easy' || this.getCombatUnits().length >= 12) {
        this.tryBuildBuilding('battle_lab')
      }
      return
    }

    // 14. Don't float excess cash once core army exists.
    if (this.economy.getCredits(this.playerId) > HIGH_CREDIT_THRESHOLD && this.getCombatUnits().length >= 12) {
      if (this.tryBuildBuilding('ore_refinery', true)) return
      this.tryBuildBuilding(this.side === 'alliance' ? 'air_force_command' : 'radar_tower', true)
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
    const powerState = this.economy.getPowerState(this.playerId)
    const generated = Math.max(0, powerState.generated)
    const consumed = Math.max(0, powerState.consumed)
    if (generated <= 0) return true
    const usage = consumed / Math.max(1, generated)
    return usage >= 0.8 || powerState.isLow
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

    const target = DEFENSE_TARGET[this.difficulty] + (this.enemyIsRushing ? 1 : 0)

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

    const enemyAttackers = this.getEnemyCombatUnits(gameState)
    if (enemyAttackers.length === 0) return

    const threatRadiusPx = BASE_THREAT_RADIUS_TILES * TILE_SIZE
    const threatened: Array<{ enemy: Unit; building: Building; d: number }> = []
    for (const enemy of enemyAttackers) {
      let nearest: Building | null = null
      let nearestDist = Infinity
      for (const b of buildings) {
        const d = dist(enemy.x, enemy.y, b.x, b.y)
        if (d < nearestDist) {
          nearestDist = d
          nearest = b
        }
      }
      if (nearest && nearestDist <= threatRadiusPx) {
        threatened.push({ enemy, building: nearest, d: nearestDist })
      }
    }
    if (threatened.length === 0) return

    const prioritized = threatened
      .slice()
      .sort((a, b) => {
        const ap = this.getDefensePriority(a.building)
        const bp = this.getDefensePriority(b.building)
        if (ap !== bp) return ap - bp
        return a.d - b.d
      })[0]

    const threatPos = { x: prioritized.enemy.x, y: prioritized.enemy.y }
    const defenders = this.selectDefendersForThreat(threatPos, threatened.length)
    if (defenders.length === 0) return
    this.issueFormationApproach(defenders, threatPos)

    const enemyStrength = threatened.length
    const ownStrength = Math.max(1, defenders.length)
    if (enemyStrength > ownStrength * OVERWHELMED_FORCE_RATIO) {
      this.sellExpendableBuildingForEmergency()
      this.queueEmergencyDefenseUnits(gameState)
    }

    console.log(`[AI] Player ${this.playerId} defending base with ${defenders.length} units`)
  }

  private selectDefendersForThreat(threatPos: { x: number; y: number }, threatStrength: number): Unit[] {
    const combat = this.getCombatUnits().filter(u => !this.isUnitInRetreatingGroup(u.id))
    if (combat.length === 0) return []

    const committed = this.getCommittedAttackUnitIds()
    const nearThreatRadius = 8 * TILE_SIZE
    let pool = combat.filter(u =>
      !committed.has(u.id) || dist(u.x, u.y, threatPos.x, threatPos.y) <= nearThreatRadius,
    )
    if (pool.length === 0) {
      pool = combat
    }

    pool.sort((a, b) =>
      dist(a.x, a.y, threatPos.x, threatPos.y) - dist(b.x, b.y, threatPos.x, threatPos.y),
    )

    const baselineNeed = clamp(
      threatStrength + (this.enemyIsRushing ? 2 : 1),
      2,
      MAX_DEFENDER_COMMIT[this.difficulty],
    )
    let desired = Math.min(pool.length, baselineNeed)
    const keepReserve = MIN_HOME_GARRISON[this.difficulty]
    const maxCommit = Math.max(1, combat.length - keepReserve)
    if (threatStrength <= combat.length && desired > maxCommit) {
      desired = maxCommit
    }
    return pool.slice(0, desired)
  }

  private getCommittedAttackUnitIds(): Set<string> {
    const ids = new Set<string>()
    for (const group of this.activeAttackGroups) {
      if (group.retreating) continue
      for (const id of group.unitIds) ids.add(id)
    }
    if (this.pendingWave) {
      for (const group of this.pendingWave.groups) {
        for (const id of group.unitIds) ids.add(id)
      }
    }
    return ids
  }

  // ── Army building ────────────────────────────────────────────

  private buildArmy(gameState: GameState): void {
    const combatUnits = this.getCombatUnits()
    const emergencySpend = this.shouldEmergencySpendOnArmy(gameState)
    if (!emergencySpend && combatUnits.length >= MAX_ARMY[this.difficulty]) return

    // AI should continuously build and spend credits — queue multiple units per tick
    // Queue units from all available production buildings simultaneously
    const maxQueuePerTick = emergencySpend
      ? (this.difficulty === 'hard' ? 8 : 6)
      : this.difficulty === 'hard' ? 5 : this.difficulty === 'medium' ? 3 : 2
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
        if (!emergencySpend && combatUnits.length + queued >= MAX_ARMY[this.difficulty]) break
      } else {
        break
      }
    }
  }

  private chooseUnitToBuild(): string | null {
    const hasBarracks = this.hasActiveBuilding('barracks')
    const hasWarFactory = this.hasActiveBuilding('war_factory')
    if (!hasBarracks && !hasWarFactory) return null

    if (this.matchTimer < this.antiAirEmergencyUntilMs) {
      const emergencyAA = this.chooseEmergencyAntiAirUnit()
      if (emergencyAA) return emergencyAA
    }

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

    if (this.enemyHasAirSuperiority) {
      if (this.side === 'alliance') {
        if (this.canProduceUnit('ifv')) pool.push('ifv', 'ifv', 'ifv', 'ifv')
        if (this.canProduceUnit('rocketeer')) pool.push('rocketeer', 'rocketeer', 'rocketeer')
      } else {
        if (this.canProduceUnit('flak_track')) pool.push('flak_track', 'flak_track', 'flak_track', 'flak_track')
        if (this.canProduceUnit('flak_trooper')) pool.push('flak_trooper', 'flak_trooper', 'flak_trooper')
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

    if (this.enemyIsTurtling) {
      if (this.side === 'collective') {
        if (this.canProduceUnit('v3_launcher')) pool.push('v3_launcher', 'v3_launcher', 'v3_launcher')
        if (this.canProduceUnit('dreadnought')) pool.push('dreadnought', 'dreadnought')
      } else {
        if (this.canProduceUnit('prism_tank')) pool.push('prism_tank', 'prism_tank', 'prism_tank')
        if (this.canProduceUnit('destroyer')) pool.push('destroyer', 'destroyer')
      }
    }

    if (this.enemyIsRushing && this.phase === 'early') {
      if (this.side === 'alliance') {
        if (this.canProduceUnit('ifv')) pool.push('ifv', 'ifv')
      } else {
        if (this.canProduceUnit('tesla_trooper')) pool.push('tesla_trooper', 'tesla_trooper')
      }
      if (this.canProduceUnit(mainTank)) pool.push(mainTank, mainTank)
    }

    for (const [killerId, pressure] of this.enemyKillPressure.entries()) {
      if (pressure < 3) continue
      const def = UNIT_DEFS[killerId]
      const category = def?.category
      if (category === 'aircraft') {
        if (this.side === 'alliance' && this.canProduceUnit('ifv')) pool.push('ifv', 'ifv')
        if (this.side === 'collective' && this.canProduceUnit('flak_track')) pool.push('flak_track', 'flak_track')
      } else if (category === 'vehicle') {
        if (this.side === 'collective' && this.canProduceUnit('tesla_trooper')) pool.push('tesla_trooper', 'tesla_trooper')
        if (this.side === 'alliance' && this.canProduceUnit('mirage_tank')) pool.push('mirage_tank', 'mirage_tank')
      } else if (category === 'infantry') {
        if (this.side === 'alliance' && this.canProduceUnit('ifv')) pool.push('ifv')
        if (this.side === 'collective' && this.canProduceUnit('flak_track')) pool.push('flak_track')
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
    fastUnits.sort((a, b) => {
      if (b.veterancy !== a.veterancy) return b.veterancy - a.veterancy
      return b.def.stats.speed - a.def.stats.speed
    })

    const target = this.findHarassTarget(gameState)
    if (!target) return

    const raidSize = clamp(
      this.difficulty === 'hard' ? 5 : this.difficulty === 'medium' ? 3 : 2,
      2,
      fastUnits.length,
    )
    const fallback = this.getFallbackPosition()
    if (fallback && raidSize <= 3 && this.isRouteHighRisk(fallback, target)) return

    for (let i = 0; i < raidSize; i++) {
      fastUnits[i].giveOrder({ type: 'attackMove', target })
    }

    console.log(`[AI] Player ${this.playerId} sending ${raidSize}-unit harassment raid`)
  }

  private findHarassTarget(gameState: GameState): { x: number; y: number } | null {
    if (this.difficulty === 'hard' || this.strategicDoctrine === 'economy') {
      const hunted = this.findEnemyHarvesterTarget(gameState)
      if (hunted) return hunted
    }

    if (this.strategicDoctrine === 'power') {
      for (const p of gameState.players) {
        if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
        const powerBuildings = this.em.getBuildingsForPlayer(p.id).filter(
          b => b.def.category === 'power' && b.state !== 'dying',
        )
        if (powerBuildings.length > 0) {
          const target = powerBuildings[randomInt(0, powerBuildings.length - 1)]
          return { x: target.x, y: target.y }
        }
      }
    }

    if (this.strategicDoctrine === 'production' || this.strategicDoctrine === 'collapse') {
      for (const p of gameState.players) {
        if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
        const producers = this.em.getBuildingsForPlayer(p.id).filter(
          b => b.def.category === 'production' && b.state !== 'dying',
        )
        if (producers.length > 0) {
          const target = producers[randomInt(0, producers.length - 1)]
          return { x: target.x, y: target.y }
        }
      }
    }

    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue

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

    const opportunistic = this.shouldLaunchOpportunisticAttack(combatUnits.length)
    if (!opportunistic && this.matchTimer < FIRST_ATTACK_MS[this.difficulty]) return
    if (!opportunistic && this.matchTimer < this.rebuildUntilMs) return
    if (!opportunistic && this.attackTimer < this.nextAttackWindowMs) return

    const target = this.findAttackTarget(gameState)
    if (!target) return

    const waveSizeTarget = this.getScaledWaveSize(combatUnits.length, opportunistic)
    if (waveSizeTarget <= 0) return

    const waveUnits = this.pickWaveUnits(combatUnits, waveSizeTarget)
    if (waveUnits.length === 0) return
    const fallback = this.getFallbackPosition()
    if (fallback && waveUnits.length < 7 && this.isRouteHighRisk(fallback, target) && !opportunistic) {
      return
    }

    const waveId = this.nextWaveId++
    const groups = this.buildAttackGroups(waveUnits, target, gameState)
    const pendingGroups: Array<{ unitIds: string[]; target: { x: number; y: number } }> = []

    for (const group of groups) {
      const staging = this.computeStagingPoint(group.target, gameState)
      for (const u of group.units) {
        u.giveOrder({ type: 'move', target: staging })
      }
      const ids = group.units.map(u => u.id)
      pendingGroups.push({ unitIds: ids, target: group.target })
      this.activeAttackGroups.push({
        waveId,
        unitIds: ids,
        initialCount: ids.length,
        target: group.target,
        retreating: false,
        focusTargetId: null,
        focusRetargetMs: 0,
      })
    }
    this.waveInitialCounts.set(waveId, waveUnits.length)

    this.pendingWave = {
      groups: pendingGroups,
      holdMs: STAGING_HOLD_MS,
    }

    this.isAttacking = true
    this.attackTimer = 0
    this.waveCount++
    this.nextAttackWindowMs = opportunistic
      ? randomInt(
        Math.floor(ATTACK_INTERVAL_MS[this.difficulty].min * 0.85),
        ATTACK_INTERVAL_MS[this.difficulty].max,
      )
      : this.nextAttackWindow()

    console.log(
      `[AI] Player ${this.playerId} staged attack (${waveUnits.length} units, ${groups.length} prong(s), wave ${waveId})`,
    )
  }

  private updatePendingWave(delta: number): void {
    if (!this.pendingWave) return

    this.pendingWave.holdMs -= delta
    if (this.pendingWave.holdMs > 0) return

    let sent = 0
    for (const group of this.pendingWave.groups) {
      const units = group.unitIds
        .map(id => this.em.getUnit(id))
        .filter((u): u is Unit => !!u && u.state !== 'dying')
      if (units.length === 0) continue
      this.issueFormationApproach(units, group.target)
      sent += units.length
    }

    this.pendingWave = null
    this.isAttacking = sent > 0
  }

  private shouldLaunchOpportunisticAttack(ownCombatUnits: number): boolean {
    if (ownCombatUnits < OPPORTUNISTIC_MIN_ARMY[this.difficulty]) return false

    const enemyCombat = this.enemyMacroIntel.combatUnits
    const forceRatio = ownCombatUnits / Math.max(1, enemyCombat)
    if (this.enemyMacroIntel.lowPowerPlayers > 0 && forceRatio >= 0.9) return true
    if (forceRatio >= OPPORTUNISTIC_FORCE_RATIO) return true
    if (this.strategicDoctrine === 'economy' && this.enemyMacroIntel.refineries >= 2 && forceRatio >= 1.05) return true
    return false
  }

  private getScaledWaveSize(available: number, opportunistic = false): number {
    const cfg = ATTACK_WAVE_SIZE[this.difficulty]
    if (opportunistic) {
      const burstMin = Math.max(4, cfg.min - (this.difficulty === 'hard' ? 2 : 1))
      const burstMax = Math.max(burstMin + 1, Math.floor(cfg.max * 0.65))
      return Math.min(available, randomInt(burstMin, burstMax))
    }
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
    target: TargetChoice,
    gameState: GameState,
  ): Array<{ units: Unit[]; target: { x: number; y: number } }> {
    if (this.difficulty !== 'hard' || waveUnits.length < 10) {
      return [{ units: waveUnits, target: { x: target.x, y: target.y } }]
    }

    const frontCount = Math.max(3, Math.floor(waveUnits.length * 0.4))
    const flankCount = Math.max(2, Math.floor((waveUnits.length - frontCount) / 2))
    const secondFlankCount = Math.max(2, waveUnits.length - frontCount - flankCount)
    const front = waveUnits.slice(0, frontCount)
    const flankA = waveUnits.slice(frontCount, frontCount + flankCount)
    const flankB = waveUnits.slice(frontCount + flankCount, frontCount + flankCount + secondFlankCount)
    const flank1Target = this.computeFlankTarget(target, gameState, 7 * TILE_SIZE, -1)
    const flank2Target = this.computeFlankTarget(target, gameState, 7 * TILE_SIZE, 1)
    const groups: Array<{ units: Unit[]; target: { x: number; y: number } }> = [
      { units: front, target: { x: target.x, y: target.y } },
      { units: flankA, target: flank1Target },
      { units: flankB, target: flank2Target },
    ]

    if (waveUnits.length >= 14) {
      const feintTarget = this.findFeintTarget(gameState, target)
      if (feintTarget) {
        const feintSize = Math.max(2, Math.floor(waveUnits.length * 0.18))
        const feintUnits = groups[0].units.splice(0, Math.min(feintSize, groups[0].units.length))
        if (feintUnits.length >= 2) {
          groups.push({ units: feintUnits, target: feintTarget })
        }
      }
    }

    return groups.filter(g => g.units.length > 0)
  }

  private computeFlankTarget(
    target: { x: number; y: number },
    gameState: GameState,
    offset: number,
    signHint?: -1 | 1,
  ): { x: number; y: number } {
    const mapW = gameState.map.width * TILE_SIZE
    const mapH = gameState.map.height * TILE_SIZE
    const sign = signHint ?? (Math.random() < 0.5 ? -1 : 1)
    return {
      x: clamp(target.x + offset * sign, TILE_SIZE, Math.max(TILE_SIZE, mapW - TILE_SIZE)),
      y: clamp(target.y + offset * -sign * 0.6, TILE_SIZE, Math.max(TILE_SIZE, mapH - TILE_SIZE)),
    }
  }

  private pickWaveUnits(units: Unit[], desiredSize: number): Unit[] {
    const veterans = units.filter(u => u.veterancy >= 1)
    const reserveVeterans = veterans.length >= 3 && units.length >= desiredSize + 2
      ? Math.max(1, Math.floor(veterans.length * 0.4))
      : 0
    const veteranIdsToKeep = new Set(
      veterans
        .sort((a, b) => b.veterancy - a.veterancy || b.hp - a.hp)
        .slice(0, reserveVeterans)
        .map(u => u.id),
    )
    const candidateUnits = units.filter(u => !veteranIdsToKeep.has(u.id))

    const infantry = candidateUnits.filter(u => u.def.category === 'infantry')
    const vehicles = candidateUnits.filter(u => u.def.category === 'vehicle')
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

    const remainder = candidateUnits.filter(u => !selectedIds.has(u.id))
    addRandom(remainder, desiredSize - selected.length)

    if (selected.length < desiredSize) {
      const fallback = units.filter(u => !selectedIds.has(u.id))
      addRandom(fallback, desiredSize - selected.length)
    }

    return this.stabilizeWaveComposition(selected, units, desiredSize)
  }

  private stabilizeWaveComposition(selected: Unit[], allUnits: Unit[], desiredSize: number): Unit[] {
    const out = [...selected]
    const used = new Set(out.map(u => u.id))

    const replaceForCapability = (
      need: (u: Unit) => boolean,
      replaceable: (u: Unit) => boolean,
    ): void => {
      if (out.some(need)) return
      const candidate = allUnits.find(u => !used.has(u.id) && need(u))
      if (!candidate) return

      const replaceIdx = out.findIndex(replaceable)
      if (replaceIdx >= 0) {
        used.delete(out[replaceIdx].id)
        out[replaceIdx] = candidate
        used.add(candidate.id)
        return
      }

      if (out.length < desiredSize) {
        out.push(candidate)
        used.add(candidate.id)
      }
    }

    const hasAntiAir = (u: Unit) => !!u.def.attack?.canAttackAir
    const hasSiege = (u: Unit) => (u.def.attack?.range ?? 0) >= 8 || u.def.id === 'v3_launcher' || u.def.id === 'prism_tank'
    const isFrontline = (u: Unit) => u.def.category === 'vehicle' && (u.def.attack?.range ?? 0) <= 6
    const lightInfantry = (u: Unit) => u.def.category === 'infantry'

    if (this.enemyComposition.aircraft >= 3 || this.enemyHasAirSuperiority) {
      replaceForCapability(hasAntiAir, lightInfantry)
    }
    if (this.enemyIsTurtling || this.strategicDoctrine === 'production') {
      replaceForCapability(hasSiege, lightInfantry)
    }
    if (desiredSize >= 7) {
      replaceForCapability(isFrontline, lightInfantry)
    }

    return out.slice(0, desiredSize)
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

    let stagingX = clamp(rawX, TILE_SIZE, Math.max(TILE_SIZE, mapW - TILE_SIZE))
    let stagingY = clamp(rawY, TILE_SIZE, Math.max(TILE_SIZE, mapH - TILE_SIZE))
    if (this.getDangerScore(stagingX, stagingY) > 1.8) {
      const offsets = [4, -4, 7, -7]
      for (const o of offsets) {
        const altX = clamp(stagingX + o * TILE_SIZE, TILE_SIZE, Math.max(TILE_SIZE, mapW - TILE_SIZE))
        const altY = clamp(stagingY - o * TILE_SIZE * 0.5, TILE_SIZE, Math.max(TILE_SIZE, mapH - TILE_SIZE))
        if (this.getDangerScore(altX, altY) < 1.3) {
          stagingX = altX
          stagingY = altY
          break
        }
      }
    }

    return {
      x: stagingX,
      y: stagingY,
    }
  }

  // ── Strategic attack targeting ───────────────────────────────

  private findAttackTarget(gameState: GameState): TargetChoice | null {
    const allEnemyBuildings: Building[] = []
    const enemyHarvesters: Unit[] = []
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      allEnemyBuildings.push(
        ...this.em.getBuildingsForPlayer(p.id).filter(b => b.state !== 'dying'),
      )
      enemyHarvesters.push(
        ...this.em.getUnitsForPlayer(p.id).filter(u => u.state !== 'dying' && u.def.category === 'harvester'),
      )
    }

    // Economy doctrine: starve harvest income first, unless we're explicitly power-sniping.
    const economyPressure =
      this.strategicDoctrine === 'economy' || (this.phase === 'early' && this.difficulty !== 'easy')
    if (enemyHarvesters.length > 0 && economyPressure && this.strategicDoctrine !== 'power') {
      const sortedHarvesters = enemyHarvesters
        .slice()
        .sort((a, b) => this.getDangerScore(a.x, a.y) - this.getDangerScore(b.x, b.y))
      const h = sortedHarvesters[0]
      return { x: h.x, y: h.y, entityId: h.id }
    }

    if (allEnemyBuildings.length === 0) return null

    const ownAnchor = this.getFallbackPosition()
    let best: Building | null = null
    let bestScore = -Infinity

    for (const b of allEnemyBuildings) {
      let score = this.getBuildingStrategicValue(b)
      score += this.getDoctrineScoreBonus(b)
      if (ownAnchor) {
        const travelPenalty = dist(ownAnchor.x, ownAnchor.y, b.x, b.y) / (20 * TILE_SIZE)
        score -= travelPenalty
      }
      const zonePenalty = this.getDangerScore(b.x, b.y) * 0.8
      score -= zonePenalty
      if (this.difficulty === 'hard' && b.def.id === 'war_factory') score += 5
      if (this.difficulty === 'hard' && b.def.id === 'ore_refinery') score += 4
      if (this.difficulty === 'hard' && b.def.category === 'production') score += 2
      if (score > bestScore) {
        bestScore = score
        best = b
      }
    }

    if (!best) return null
    return { x: best.x, y: best.y, entityId: best.id }
  }

  private getDoctrineScoreBonus(b: Building): number {
    switch (this.strategicDoctrine) {
      case 'economy':
        if (b.def.id === 'ore_refinery') return 8
        if (b.def.category === 'production') return 2
        return 0
      case 'power':
        if (b.def.category === 'power') return 10
        if (b.def.category === 'production') return 2
        return 0
      case 'production':
        if (b.def.category === 'production') return 9
        if (b.def.id === 'construction_yard') return 5
        return 0
      case 'collapse':
        if (b.def.id === 'construction_yard') return 10
        if (b.def.category === 'tech') return 6
        if (b.def.category === 'production') return 4
        return 0
      default:
        return 0
    }
  }

  private getBuildingStrategicValue(b: Building): number {
    // Priority ladder: production > power > economy > defenses > walls.
    if (b.def.category === 'production') {
      if (b.def.id === 'war_factory') return 20
      if (b.def.id === 'barracks') return 14
      return 12
    }
    if (b.def.id === 'ore_refinery') return 17
    if (b.def.category === 'power') return 11
    if (b.def.category === 'tech' || b.def.id === 'construction_yard') return 10
    if (b.def.category === 'defense') return 7
    if (b.def.id.includes('wall')) return 2
    return 6
  }

  private findFeintTarget(gameState: GameState, mainTarget: TargetChoice): { x: number; y: number } | null {
    const choices: Building[] = []
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      choices.push(
        ...this.em.getBuildingsForPlayer(p.id).filter(
          b => b.state !== 'dying' && dist(b.x, b.y, mainTarget.x, mainTarget.y) >= 6 * TILE_SIZE,
        ),
      )
    }
    if (choices.length === 0) return null
    choices.sort((a, b) => this.getBuildingStrategicValue(a) - this.getBuildingStrategicValue(b))
    const pick = choices[Math.min(choices.length - 1, randomInt(0, Math.min(2, choices.length - 1)))]
    return { x: pick.x, y: pick.y }
  }

  private getDangerScore(x: number, y: number): number {
    let score = 0
    for (const zone of this.knownDangerZones) {
      const d = dist(x, y, zone.x, zone.y)
      if (d > DANGER_ZONE_RADIUS * 1.8) continue
      const weight = 1 - d / (DANGER_ZONE_RADIUS * 1.8)
      score += zone.intensity * Math.max(0, weight)
    }
    return score
  }

  private isRouteHighRisk(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const samples = 6
    let total = 0
    for (let i = 1; i <= samples; i++) {
      const t = i / (samples + 1)
      const x = from.x + (to.x - from.x) * t
      const y = from.y + (to.y - from.y) * t
      total += this.getDangerScore(x, y)
    }
    return (total / samples) >= 1.2
  }

  private applyFocusFire(): void {
    for (const group of this.activeAttackGroups) {
      const aliveUnits = group.unitIds
        .map(id => this.em.getUnit(id))
        .filter((u): u is Unit => !!u && u.state !== 'dying' && !!u.def.attack)
      if (aliveUnits.length < 2) continue

      const cx = aliveUnits.reduce((s, u) => s + u.x, 0) / aliveUnits.length
      const cy = aliveUnits.reduce((s, u) => s + u.y, 0) / aliveUnits.length
      const focus = this.findFocusFireTarget(cx, cy)
      if (!focus) continue

      for (const u of aliveUnits) {
        if (u.state === 'moving' || u.state === 'attacking' || u.state === 'idle') {
          u.giveOrder({ type: 'attack', targetEntityId: focus.id })
        }
      }
    }
  }

  private findFocusFireTarget(x: number, y: number): Unit | Building | null {
    const radius = 12 * TILE_SIZE
    let best: Unit | Building | null = null
    let bestScore = -Infinity
    for (const eu of this.em.getAllUnits()) {
      if (!this.isEnemyPlayer(eu.playerId) || eu.state === 'dying') continue
      if (dist(x, y, eu.x, eu.y) > radius) continue
      const hpFactor = 1 - eu.hp / Math.max(1, eu.def.stats.maxHp)
      let score = 8 + hpFactor * 5
      if (eu.def.category === 'aircraft') score += 2
      if (eu.def.category === 'harvester') score += 3
      if (score > bestScore) {
        bestScore = score
        best = eu
      }
    }
    for (const eb of this.em.getAllBuildings()) {
      if (!this.isEnemyPlayer(eb.playerId) || eb.state === 'dying') continue
      if (dist(x, y, eb.x, eb.y) > radius) continue
      const hpFactor = 1 - eb.hp / Math.max(1, eb.def.stats.maxHp)
      let score = this.getBuildingStrategicValue(eb) + hpFactor * 4
      if (score > bestScore) {
        bestScore = score
        best = eb
      }
    }
    return best
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
      if (this.isUnitInRetreatingGroup(u.id)) continue
      const hpPct = u.hp / Math.max(1, u.def.stats.maxHp)
      const vetThreshold = u.veterancy >= 2 ? 0.62 : u.veterancy >= 1 ? 0.5 : RETREAT_HEALTH_PCT
      const localEnemy = this.findClosestEnemyEntity(u.x, u.y, 7 * TILE_SIZE)
      const canFinish = localEnemy && (localEnemy.hp / Math.max(1, this.getEntityMaxHp(localEnemy.id)) <= 0.2)
      if ((hpPct <= vetThreshold || (u.veterancy >= 1 && this.getDangerScore(u.x, u.y) > 2.3)) && !canFinish) {
        u.giveOrder({ type: 'move', target: fallback })
      }
    }
  }

  // ── Tactical micro ───────────────────────────────────────────

  private microSpecialUnits(gameState: GameState): void {
    const fallback = this.getFallbackPosition()
    const neutralSet = new Set<string>(NEUTRAL_BUILDING_IDS)

    const engineers = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.state !== 'dying' && u.def.id === 'engineer',
    )
    const capturable = this.em.getAllBuildings().filter(
      b => b.state !== 'dying' && b.playerId !== this.playerId && (neutralSet.has(b.def.id) || this.isEnemyPlayer(b.playerId)),
    )
    for (const eng of engineers) {
      if (eng.state !== 'idle') continue
      const target = capturable
        .slice()
        .sort((a, b) => dist(eng.x, eng.y, a.x, a.y) - dist(eng.x, eng.y, b.x, b.y))[0]
      if (target) {
        eng.giveOrder({ type: 'attack', targetEntityId: target.id })
      }
    }

    const enemyAttackers = this.getEnemyCombatUnits(gameState)
    const harvesters = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.state !== 'dying' && u.def.category === 'harvester',
    )
    for (const h of harvesters) {
      const nearbyEnemy = enemyAttackers.find(e => dist(h.x, h.y, e.x, e.y) <= 5 * TILE_SIZE)
      if (nearbyEnemy && fallback) {
        h.giveOrder({ type: 'move', target: fallback })
      }
    }
  }

  private handleAntiAirResponse(gameState: GameState): void {
    const enemyAir = this.getEnemyAirUnits(gameState)
    if (enemyAir.length === 0) return

    this.antiAirEmergencyUntilMs = Math.max(this.antiAirEmergencyUntilMs, this.matchTimer + 30000)
    const aaUnits = this.getCombatUnits().filter(u => !!u.def.attack?.canAttackAir)

    if (aaUnits.length === 0) {
      const emergencyAA = this.chooseEmergencyAntiAirUnit()
      if (emergencyAA) {
        this.queueUnitIfPossible(emergencyAA, gameState)
      }
      return
    }

    const ownBase = this.getFallbackPosition()
    const intercept = enemyAir
      .slice()
      .sort((a, b) => {
        if (!ownBase) return a.hp - b.hp
        return dist(a.x, a.y, ownBase.x, ownBase.y) - dist(b.x, b.y, ownBase.x, ownBase.y)
      })[0]
    if (!intercept) return

    for (const aa of aaUnits) {
      if (!this.canUnitAttackEntity(aa, intercept)) continue
      if (dist(aa.x, aa.y, intercept.x, intercept.y) <= AA_RESPONSE_RADIUS_TILES * TILE_SIZE) {
        aa.giveOrder({ type: 'attack', targetEntityId: intercept.id })
      } else {
        aa.giveOrder({ type: 'attackMove', target: { x: intercept.x, y: intercept.y } })
      }
    }
  }

  private chooseEmergencyAntiAirUnit(): string | null {
    const candidates = this.side === 'alliance'
      ? ['ifv', 'rocketeer', getBasicInfantryDefId(this.side)]
      : ['flak_track', 'flak_trooper', getBasicInfantryDefId(this.side)]
    for (const id of candidates) {
      if (this.canProduceUnit(id)) return id
    }
    return null
  }

  private applyGroupFocusFire(group: AttackGroup, units: Unit[]): void {
    const focusTarget = this.pickFocusTargetForGroup(units, group.focusTargetId)
    if (!focusTarget) {
      group.focusTargetId = null
      return
    }
    group.focusTargetId = focusTarget.id
    for (const u of units) {
      if (this.isKiteOnCooldown(u.id)) continue
      if (!this.canUnitAttackEntity(u, focusTarget)) continue
      u.giveOrder({ type: 'attack', targetEntityId: focusTarget.id })
    }
  }

  private pickFocusTargetForGroup(units: Unit[], currentTargetId: string | null): Unit | Building | null {
    const centerX = this.avg(units.map(u => u.x))
    const centerY = this.avg(units.map(u => u.y))
    const radiusPx = 9 * TILE_SIZE
    const enemies = [
      ...this.em.getEnemyUnitsInRange(centerX, centerY, radiusPx, this.playerId),
      ...this.em.getEnemyBuildingsInRange(centerX, centerY, radiusPx, this.playerId),
    ].filter(e => e.state !== 'dying')
    if (enemies.length === 0) return null

    if (currentTargetId) {
      const current = enemies.find(e => e.id === currentTargetId)
      if (current && current.hp > 0) return current
    }

    return enemies
      .slice()
      .sort((a, b) => {
        const as = this.scoreEntityThreat(a) - (a.hp / Math.max(1, this.getEntityMaxHp(a.id)))
        const bs = this.scoreEntityThreat(b) - (b.hp / Math.max(1, this.getEntityMaxHp(b.id)))
        return bs - as
      })[0]
  }

  private scoreEntityThreat(entity: Unit | Building): number {
    const attack = entity.def.attack
    if (!attack) return 0
    const dps = attack.damage * attack.fireRate
    const antiAirBias = attack.canAttackAir ? 8 : 0
    const splashBias = attack.splash > 0 ? 6 : 0
    return dps + attack.range + antiAirBias + splashBias
  }

  private applyGroupKiting(units: Unit[]): void {
    for (const u of units) {
      if (!this.isKitingUnit(u) || this.isKiteOnCooldown(u.id)) continue
      const myAttack = u.def.attack
      if (!myAttack) continue

      const nearbyEnemies = this.em.getEnemyUnitsInRange(u.x, u.y, 8 * TILE_SIZE, this.playerId)
      if (nearbyEnemies.length === 0) continue

      const target = nearbyEnemies
        .filter(e => e.state !== 'dying' && !!e.def.attack)
        .filter(e => (e.def.attack?.range ?? 0) + 0.75 < myAttack.range)
        .sort((a, b) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, b.x, b.y))[0]
      if (!target) continue

      const d = dist(u.x, u.y, target.x, target.y)
      if (d > myAttack.range * TILE_SIZE * 0.9) continue

      const retreatPos = this.getKiteRetreatPosition(u, target)
      u.giveOrder({ type: 'move', target: retreatPos })
      u.giveOrder({ type: 'attack', targetEntityId: target.id }, true)
      this.unitKiteUntilMs.set(u.id, this.matchTimer + KITE_REISSUE_MS)
    }
  }

  private isKitingUnit(unit: Unit): boolean {
    const attack = unit.def.attack
    if (!attack) return false
    if (attack.range < 6) return false
    return unit.def.id === 'v3_launcher'
      || unit.def.id === 'sniper'
      || unit.def.id === 'rocketeer'
      || attack.range >= 8
  }

  private isKiteOnCooldown(unitId: string): boolean {
    return (this.unitKiteUntilMs.get(unitId) ?? 0) > this.matchTimer
  }

  private getKiteRetreatPosition(unit: Unit, threat: Unit): { x: number; y: number } {
    const dx = unit.x - threat.x
    const dy = unit.y - threat.y
    const l = Math.max(1, Math.sqrt(dx * dx + dy * dy))
    const fallback = this.getFallbackPosition()
    const biasX = fallback ? (fallback.x - unit.x) * 0.3 : 0
    const biasY = fallback ? (fallback.y - unit.y) * 0.3 : 0
    const raw = {
      x: unit.x + (dx / l) * TILE_SIZE * 2 + biasX,
      y: unit.y + (dy / l) * TILE_SIZE * 2 + biasY,
    }
    return this.clampToMap(raw)
  }

  private issueFormationApproach(units: Unit[], target: { x: number; y: number }): void {
    if (units.length === 0) return
    const center = { x: this.avg(units.map(u => u.x)), y: this.avg(units.map(u => u.y)) }
    const toTargetX = target.x - center.x
    const toTargetY = target.y - center.y
    const len = Math.max(1, Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY))
    const nx = toTargetX / len
    const ny = toTargetY / len
    const px = -ny
    const py = nx

    const sorted = units.slice().sort((a, b) => this.unitRoleRank(a) - this.unitRoleRank(b))
    const arc = (FORMATION_ARC_DEGREES * Math.PI) / 180
    const half = arc / 2

    for (let i = 0; i < sorted.length; i++) {
      const u = sorted[i]
      const role = this.unitRoleRank(u)
      const roleDepth = role === 0 ? 3 : role === 1 ? 5 : 7
      const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1)
      const angle = -half + arc * t
      const lateral = Math.sin(angle) * TILE_SIZE * 3
      const approach = {
        x: target.x - nx * roleDepth * TILE_SIZE + px * lateral,
        y: target.y - ny * roleDepth * TILE_SIZE + py * lateral,
      }
      u.giveOrder({ type: 'attackMove', target: this.clampToMap(approach) })
    }
  }

  private unitRoleRank(unit: Unit): number {
    const range = unit.def.attack?.range ?? 0
    if (unit.def.category === 'vehicle' && range <= 6) return 0 // frontline
    if (range >= 8 || unit.def.id === 'v3_launcher' || unit.def.id === 'sniper') return 2 // backline
    return 1 // midline
  }

  private getEnemyCombatUnits(gameState: GameState): Unit[] {
    const out: Unit[] = []
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      out.push(...this.em.getUnitsForPlayer(p.id).filter(u => u.state !== 'dying' && !!u.def.attack))
    }
    return out
  }

  private getEnemyAirUnits(gameState: GameState): Unit[] {
    const out: Unit[] = []
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      out.push(...this.em.getUnitsForPlayer(p.id).filter(u => u.state !== 'dying' && u.def.category === 'aircraft'))
    }
    return out
  }

  private getDefensePriority(building: Building): number {
    if (building.def.category === 'production') return 0
    if (building.def.id === 'construction_yard') return 1
    if (building.def.id === 'ore_refinery') return 2
    return 3
  }

  private sellExpendableBuildingForEmergency(): void {
    if (this.matchTimer - this.lastEmergencySellMs < EMERGENCY_SELL_COOLDOWN_MS) return
    const expendable = this.em.getBuildingsForPlayer(this.playerId)
      .filter(b => b.state === 'active')
      .filter(b => b.def.id !== 'construction_yard' && b.def.id !== 'ore_refinery' && b.def.category !== 'production')
      .sort((a, b) => {
        const ap = a.def.category === 'defense' ? 0 : a.def.category === 'power' ? 1 : 2
        const bp = b.def.category === 'defense' ? 0 : b.def.category === 'power' ? 1 : 2
        if (ap !== bp) return ap - bp
        return a.def.stats.cost - b.def.stats.cost
      })[0]
    if (!expendable) return
    const refund = expendable.sell()
    if (refund > 0) {
      this.economy.addCredits(this.playerId, refund)
      this.lastEmergencySellMs = this.matchTimer
    }
  }

  private queueEmergencyDefenseUnits(gameState: GameState): void {
    const first = this.matchTimer < this.antiAirEmergencyUntilMs ? this.chooseEmergencyAntiAirUnit() : null
    const fallbackChoices = [first, getMainTankDefId(this.side), getBasicInfantryDefId(this.side)].filter(
      (id): id is string => !!id,
    )
    for (const unitId of fallbackChoices) {
      if (this.queueUnitIfPossible(unitId, gameState)) return
    }
  }

  private isUnitInRetreatingGroup(unitId: string): boolean {
    return this.activeAttackGroups.some(g => g.retreating && g.unitIds.includes(unitId))
  }

  private canUnitAttackEntity(unit: Unit, entity: Unit | Building): boolean {
    const attack = unit.def.attack
    if (!attack) return false
    const isAir = entity instanceof Unit && entity.def.category === 'aircraft'
    return isAir ? attack.canAttackAir : attack.canAttackGround
  }

  private findClosestEnemyEntity(x: number, y: number, radius: number): Unit | Building | null {
    const enemies = [
      ...this.em.getEnemyUnitsInRange(x, y, radius, this.playerId),
      ...this.em.getEnemyBuildingsInRange(x, y, radius, this.playerId),
    ].filter(e => e.state !== 'dying')
    if (enemies.length === 0) return null
    return enemies
      .slice()
      .sort((a, b) => dist(x, y, a.x, a.y) - dist(x, y, b.x, b.y))[0]
  }

  private getEntityMaxHp(entityId: string): number {
    const entity = this.em.getEntity(entityId)
    return entity?.def.stats.maxHp ?? 1
  }

  private clampToMap(pos: { x: number; y: number }): { x: number; y: number } {
    const mapW = this.mapWidthTiles > 0 ? this.mapWidthTiles * TILE_SIZE : pos.x + TILE_SIZE
    const mapH = this.mapHeightTiles > 0 ? this.mapHeightTiles * TILE_SIZE : pos.y + TILE_SIZE
    return {
      x: clamp(pos.x, TILE_SIZE, Math.max(TILE_SIZE, mapW - TILE_SIZE)),
      y: clamp(pos.y, TILE_SIZE, Math.max(TILE_SIZE, mapH - TILE_SIZE)),
    }
  }

  private avg(values: number[]): number {
    if (values.length === 0) return 0
    return values.reduce((sum, n) => sum + n, 0) / values.length
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

    const targets = this.buildScoutTargets(gameState)
    if (targets.length === 0) return

    targets.sort((a, b) => this.getScoutTargetScore(b) - this.getScoutTargetScore(a))
    const topN = Math.min(3, targets.length)
    const target = targets[randomInt(0, topN - 1)]
    fastUnit.giveOrder({ type: 'move', target })
    this.scoutVisitMs.set(this.getScoutTargetKey(target), this.matchTimer)
  }

  private buildScoutTargets(gameState: GameState): Array<{ x: number; y: number }> {
    const targets: Array<{ x: number; y: number }> = []
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      const highValue = this.em.getBuildingsForPlayer(p.id).filter(
        b =>
          b.state !== 'dying' &&
          (b.def.id === 'construction_yard' || b.def.id === 'ore_refinery' || b.def.category === 'production'),
      )
      for (const b of highValue) targets.push({ x: b.x, y: b.y })
    }

    targets.push(...this.getOreFieldAnchors(gameState, 4))

    const mapW = gameState.map.width * TILE_SIZE
    const mapH = gameState.map.height * TILE_SIZE
    targets.push(
      { x: TILE_SIZE, y: TILE_SIZE },
      { x: mapW - TILE_SIZE, y: TILE_SIZE },
      { x: TILE_SIZE, y: mapH - TILE_SIZE },
      { x: mapW - TILE_SIZE, y: mapH - TILE_SIZE },
      { x: mapW * 0.5, y: mapH * 0.5 },
    )

    const deduped: Array<{ x: number; y: number }> = []
    for (const point of targets) {
      if (deduped.some(d => dist(d.x, d.y, point.x, point.y) <= 3 * TILE_SIZE)) continue
      deduped.push(point)
    }
    return deduped
  }

  private getScoutTargetKey(target: { x: number; y: number }): string {
    const tx = Math.round(target.x / TILE_SIZE)
    const ty = Math.round(target.y / TILE_SIZE)
    return `${tx}:${ty}`
  }

  private getScoutTargetScore(target: { x: number; y: number }): number {
    const key = this.getScoutTargetKey(target)
    const lastSeenMs = this.scoutVisitMs.get(key) ?? -SCOUT_REVISIT_MS
    const sinceLastScout = this.matchTimer - lastSeenMs
    let score = sinceLastScout
    if (this.isPointContested(target.x, target.y)) score += 25000
    score -= this.getDangerScore(target.x, target.y) * 12000
    return score
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

  private tryBuildBuildingAt(defId: string, col: number, row: number): boolean {
    const def = BUILDING_DEFS[defId]
    if (!def) return false
    if (!this.hasActiveBuilding('construction_yard')) return false
    if (!this.production.checkPrerequisites(this.playerId, defId)) return false
    if (this.economy.getCredits(this.playerId) < def.stats.cost) return false
    if (!this.isPlacementWithinMap(col, row, def.footprint.w, def.footprint.h)) return false
    if (!this.isTileFree(col, row, def.footprint.w, def.footprint.h)) return false
    if (!this.economy.deductCredits(this.playerId, def.stats.cost)) return false

    const building = this.em.createBuilding(this.playerId, defId, col, row)
    if (!building) {
      this.economy.addCredits(this.playerId, def.stats.cost)
      return false
    }
    building.state = 'active'
    building.setAlpha(1)
    console.log(`[AI] Player ${this.playerId} started ${defId} expansion at (${col}, ${row})`)
    return true
  }

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

  private findOreExpansionPlacement(gameState: GameState): { col: number; row: number } | null {
    const def = BUILDING_DEFS.ore_refinery
    if (!def) return null
    const fields = this.getOreFieldAnchors(gameState, 6)
    if (fields.length === 0) return null
    const ownBuildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state !== 'dying')
    if (ownBuildings.length === 0) return null
    const avoidRadius = 10 * TILE_SIZE

    for (const anchor of fields) {
      const contested = this.isPointContested(anchor.x, anchor.y)
      if (contested) continue

      const tooClose = ownBuildings.some(b => dist(b.x, b.y, anchor.x, anchor.y) < avoidRadius)
      if (tooClose) continue

      const tileCol = Math.floor(anchor.x / TILE_SIZE - def.footprint.w / 2)
      const tileRow = Math.floor(anchor.y / TILE_SIZE - def.footprint.h / 2)
      for (let r = -3; r <= 3; r++) {
        for (let c = -3; c <= 3; c++) {
          const col = tileCol + c
          const row = tileRow + r
          if (!this.isPlacementWithinMap(col, row, def.footprint.w, def.footprint.h)) continue
          if (!this.isTileFree(col, row, def.footprint.w, def.footprint.h)) continue
          if (this.getDangerScore((col + 1) * TILE_SIZE, (row + 1) * TILE_SIZE) > 1.6) continue
          return { col, row }
        }
      }
    }

    return null
  }

  private getOreFieldAnchors(gameState: GameState, limit: number): Array<{ x: number; y: number }> {
    const clusters: Array<{ x: number; y: number; ore: number }> = []
    const map = gameState.map
    const clusterRadiusTiles = 4
    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = map.tiles[row]?.[col]
        if (!tile || tile.oreAmount <= 0) continue

        let localOre = 0
        for (let rr = Math.max(0, row - clusterRadiusTiles); rr <= Math.min(map.height - 1, row + clusterRadiusTiles); rr++) {
          for (let cc = Math.max(0, col - clusterRadiusTiles); cc <= Math.min(map.width - 1, col + clusterRadiusTiles); cc++) {
            const neighbor = map.tiles[rr]?.[cc]
            if (neighbor && neighbor.oreAmount > 0) localOre += neighbor.oreAmount
          }
        }
        if (localOre < 6000) continue
        clusters.push({
          x: col * TILE_SIZE + TILE_SIZE / 2,
          y: row * TILE_SIZE + TILE_SIZE / 2,
          ore: localOre,
        })
      }
    }

    clusters.sort((a, b) => b.ore - a.ore)
    const anchors: Array<{ x: number; y: number }> = []
    for (const c of clusters) {
      if (anchors.some(a => dist(a.x, a.y, c.x, c.y) < 7 * TILE_SIZE)) continue
      anchors.push({ x: c.x, y: c.y })
      if (anchors.length >= limit) break
    }
    return anchors
  }

  private isPointContested(x: number, y: number): boolean {
    const radius = 12 * TILE_SIZE
    let ownPresence = 0
    let enemyPresence = 0
    for (const u of this.getCombatUnits()) {
      if (dist(u.x, u.y, x, y) <= radius) ownPresence++
    }
    for (const p of this.em.getAllUnits()) {
      if (p.state === 'dying' || !p.def.attack) continue
      if (!this.isEnemyPlayer(p.playerId)) continue
      if (dist(p.x, p.y, x, y) <= radius) enemyPresence++
    }
    return enemyPresence > ownPresence + 1
  }

  private findBuildingPlacement(defId: string): { col: number; row: number } | null {
    const def = BUILDING_DEFS[defId]
    if (!def) return null

    if (defId === 'ore_refinery') {
      const orePlacement = this.findRefineryPlacementNearOre(def)
      if (orePlacement) return orePlacement
    }

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

  private findRefineryPlacementNearOre(def: Building['def']): { col: number; row: number } | null {
    const anchors: Array<{ x: number; y: number }> = []
    if (this.expansionAnchor) anchors.push(this.expansionAnchor)

    const ownRefs = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'ore_refinery' && b.state !== 'dying',
    )
    for (const ref of ownRefs) {
      anchors.push({ x: ref.x, y: ref.y })
    }

    const cy = this.em.getBuildingsForPlayer(this.playerId).find(
      b => b.def.id === 'construction_yard' && b.state !== 'dying',
    )
    if (cy) anchors.push({ x: cy.x, y: cy.y })
    if (anchors.length === 0) return null

    for (const anchor of anchors) {
      const ore = this.findNearestOreFrom(anchor.x, anchor.y)
      if (!ore) continue
      const oreCol = Math.floor(ore.x / TILE_SIZE)
      const oreRow = Math.floor(ore.y / TILE_SIZE)

      for (let radius = 1; radius <= 8; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
            const col = oreCol + dc
            const row = oreRow + dr
            if (!this.isPlacementWithinMap(col, row, def.footprint.w, def.footprint.h)) continue
            if (!this.isTileFree(col, row, def.footprint.w, def.footprint.h)) continue

            const placementCenter = {
              x: (col + def.footprint.w / 2) * TILE_SIZE,
              y: (row + def.footprint.h / 2) * TILE_SIZE,
            }
            if (dist(placementCenter.x, placementCenter.y, ore.x, ore.y) > 7 * TILE_SIZE) continue
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
      if (!this.isEnemyPlayer(p.playerId) || p.state === 'dying') continue
      if (p.def.id === 'construction_yard') return { x: p.x, y: p.y }
    }
    const fallback = this.em.getAllBuildings().find(b => this.isEnemyPlayer(b.playerId) && b.state !== 'dying')
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

  private updateEconomyTelemetry(delta: number): void {
    const currentCredits = this.economy.getCredits(this.playerId)
    const diff = currentCredits - this.lastCredits
    if (diff > 0) this.incomeAccum += diff
    else if (diff < 0) this.spendingAccum += -diff
    this.lastCredits = currentCredits

    this.economySampleMs += delta
    if (this.economySampleMs >= ECONOMY_SAMPLE_WINDOW_MS) {
      const scale = 60000 / Math.max(1, this.economySampleMs)
      this.incomePerMinute = Math.round(this.incomeAccum * scale)
      this.spendingPerMinute = Math.round(this.spendingAccum * scale)
      this.economySampleMs = 0
      this.incomeAccum = 0
      this.spendingAccum = 0
    }
  }

  private trackBaseLossState(currentBuildingCount: number): void {
    if (this.lastBuildingCount > 0 && currentBuildingCount < this.lastBuildingCount) {
      this.losingBuildingsUntilMs = this.matchTimer + 30000
    }
    this.lastBuildingCount = currentBuildingCount
  }

  private shouldEmergencySpendOnArmy(gameState: GameState): boolean {
    return this.matchTimer < this.losingBuildingsUntilMs && this.isUnderAttack(gameState)
  }

  private isUnderAttack(gameState: GameState): boolean {
    const ownBuildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state !== 'dying')
    if (ownBuildings.length === 0) return false

    const radiusPx = (BASE_DEFENSE_RADIUS[this.difficulty] + 3) * TILE_SIZE
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      for (const eu of this.em.getUnitsForPlayer(p.id)) {
        if (eu.state === 'dying' || !eu.def.attack) continue
        for (const b of ownBuildings) {
          if (dist(eu.x, eu.y, b.x, b.y) <= radiusPx) return true
        }
      }
    }
    return false
  }

  private isUnderEarlyPressure(gameState: GameState): boolean {
    return this.matchTimer < 240000 && this.isUnderAttack(gameState)
  }

  private shouldExpandByTime(): boolean {
    const threshold = this.difficulty === 'hard' ? 180000 : this.difficulty === 'medium' ? 300000 : 420000
    return this.matchTimer >= threshold
  }

  private shouldPrioritizeHarvesters(): boolean {
    const refs = this.em.getBuildingsForPlayer(this.playerId).filter(
      b => b.def.id === 'ore_refinery' && b.state === 'active',
    ).length
    const harvesters = this.countUnitsByCategory('harvester')
    if (refs <= 0) return false
    const minDesired = refs * 2
    return harvesters < minDesired
  }

  private shouldAddProductionStructures(): boolean {
    if (this.difficulty !== 'hard') return false
    if (this.incomePerMinute <= 0) return false
    return this.economy.getCredits(this.playerId) > 3000 && this.incomePerMinute >= this.spendingPerMinute
  }

  private isBaseOreRunningLow(): boolean {
    const cy = this.em.getBuildingsForPlayer(this.playerId).find(
      b => b.def.id === 'construction_yard' && b.state !== 'dying',
    )
    if (!cy) return false

    const nearestOre = this.findNearestOreFrom(cy.x, cy.y)
    if (!nearestOre) return true
    return dist(cy.x, cy.y, nearestOre.x, nearestOre.y) > ORE_DEPLETION_DISTANCE_TILES * TILE_SIZE
  }

  private findExpansionOreTarget(gameState: GameState): { x: number; y: number } | null {
    const anchors: Array<{ x: number; y: number }> = []
    const ownBuildings = this.em.getBuildingsForPlayer(this.playerId).filter(b => b.state !== 'dying')
    const cy = ownBuildings.find(b => b.def.id === 'construction_yard') ?? ownBuildings[0]
    if (cy) anchors.push({ x: cy.x, y: cy.y })
    const ownRefs = ownBuildings.filter(b => b.def.id === 'ore_refinery')
    for (const ref of ownRefs) {
      anchors.push({ x: ref.x, y: ref.y })
    }

    const mapW = gameState.map.width * TILE_SIZE
    const mapH = gameState.map.height * TILE_SIZE
    anchors.push(
      { x: TILE_SIZE * 2, y: TILE_SIZE * 2 },
      { x: mapW - TILE_SIZE * 2, y: TILE_SIZE * 2 },
      { x: TILE_SIZE * 2, y: mapH - TILE_SIZE * 2 },
      { x: mapW - TILE_SIZE * 2, y: mapH - TILE_SIZE * 2 },
      { x: mapW * 0.5, y: mapH * 0.5 },
    )

    let best: { x: number; y: number; score: number } | null = null
    const home = cy ? { x: cy.x, y: cy.y } : anchors[0]

    for (const anchor of anchors) {
      const ore = this.findNearestOreFrom(anchor.x, anchor.y)
      if (!ore) continue

      const distFromHome = dist(home.x, home.y, ore.x, ore.y)
      if (distFromHome < EXPANSION_MIN_DISTANCE_TILES * TILE_SIZE) continue

      let nearExisting = false
      for (const ref of ownRefs) {
        if (dist(ref.x, ref.y, ore.x, ore.y) < ORE_NEAR_BASE_RADIUS_TILES * TILE_SIZE) {
          nearExisting = true
          break
        }
      }
      if (nearExisting) continue

      const score = distFromHome
      if (!best || score > best.score) {
        best = { x: ore.x, y: ore.y, score }
      }
    }

    return best ? { x: best.x, y: best.y } : null
  }

  private findNearestOreFrom(x: number, y: number): { x: number; y: number } | null {
    let orePos: { x: number; y: number } | null = null
    this.em.emit('find_ore_field', x, y, (pos: { x: number; y: number } | null) => {
      orePos = pos
    })
    return orePos
  }

  private findEnemyHarvesterTarget(gameState: GameState): { x: number; y: number } | null {
    let best: Unit | null = null
    let bestDist = Number.POSITIVE_INFINITY
    const ownAnchor = this.getFallbackPosition()

    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
      const enemyHarvesters = this.em.getUnitsForPlayer(p.id).filter(
        u => u.def.category === 'harvester' && u.state !== 'dying',
      )
      for (const h of enemyHarvesters) {
        const d = ownAnchor ? dist(ownAnchor.x, ownAnchor.y, h.x, h.y) : 0
        if (d < bestDist) {
          bestDist = d
          best = h
        }
      }
    }

    return best ? { x: best.x, y: best.y } : null
  }

  private protectHarvesters(gameState: GameState): void {
    const harvesters = this.em.getUnitsForPlayer(this.playerId).filter(
      u => u.def.category === 'harvester' && u.state !== 'dying',
    )
    const defenders = this.getCombatUnits().filter(u => u.state === 'idle')
    if (harvesters.length === 0 || defenders.length === 0) return

    const responseRadius = DEFENDER_RESPONSE_RADIUS[this.difficulty] * TILE_SIZE

    for (const h of harvesters) {
      const prevHp = this.harvesterHpSnapshot.get(h.id) ?? h.hp
      this.harvesterHpSnapshot.set(h.id, h.hp)
      if (h.hp >= prevHp) continue

      let dangerPos: { x: number; y: number } | null = null
      let nearest = Number.POSITIVE_INFINITY
      for (const p of gameState.players) {
        if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
        for (const enemy of this.em.getUnitsForPlayer(p.id)) {
          if (enemy.state === 'dying' || !enemy.def.attack) continue
          const d = dist(enemy.x, enemy.y, h.x, h.y)
          if (d < nearest && d <= 8 * TILE_SIZE) {
            nearest = d
            dangerPos = { x: enemy.x, y: enemy.y }
          }
        }
      }
      if (!dangerPos) {
        dangerPos = { x: h.x, y: h.y }
      }

      for (const defender of defenders) {
        if (dist(defender.x, defender.y, h.x, h.y) <= responseRadius) {
          defender.giveOrder({ type: 'attackMove', target: dangerPos })
        }
      }
    }
  }

  private nextAttackWindow(): number {
    const w = ATTACK_INTERVAL_MS[this.difficulty]
    if (this.matchTimer < this.aggressionUntilMs) {
      return randomInt(Math.floor(w.min * 0.55), Math.floor(w.max * 0.7))
    }
    if (this.difficulty === 'hard') {
      // Hard mode cadence alternates between pressure spikes and regroup lulls.
      const burstCycle = this.waveCount % 5
      if (burstCycle === 1 || burstCycle === 2) {
        return randomInt(Math.floor(w.min * 0.7), Math.floor(w.max * 0.92))
      }
      if (burstCycle === 4) {
        return randomInt(Math.floor(w.min * 1.15), Math.floor(w.max * 1.45))
      }
      const jitterMin = Math.max(12000, Math.floor(w.min * (0.78 + Math.random() * 0.3)))
      const jitterMax = Math.max(jitterMin + 5000, Math.floor(w.max * (0.9 + Math.random() * 0.35)))
      return randomInt(jitterMin, jitterMax)
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
        if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
        const enemyBuildings = this.em.getBuildingsForPlayer(p.id).filter(b => b.state !== 'dying')
        const cy = enemyBuildings.find(b => b.def.id === 'construction_yard')
        if (cy) return { x: cy.x, y: cy.y }
        if (enemyBuildings.length > 0) return { x: enemyBuildings[0].x, y: enemyBuildings[0].y }
      }
      return null
    }

    // Nuclear/Weather: target area with highest concentration of enemy entities
    for (const p of gameState.players) {
      if (p.isDefeated || !this.isEnemyPlayer(p.id)) continue
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
    const now = this.matchTimer
    this.activeAttackGroups = this.activeAttackGroups.filter(group => {
      const alive = group.unitIds
        .map(id => this.em.getUnit(id))
        .filter((u): u is Unit => !!u && u.state !== 'dying')
      if (alive.length === 0) return false

      group.unitIds = alive.map(u => u.id)

      const casualties = group.initialCount - alive.length
      const casualtyRatio = casualties / Math.max(1, group.initialCount)
      const enemyAnchor = this.findClosestEnemyEntity(
        this.avg(alive.map(u => u.x)),
        this.avg(alive.map(u => u.y)),
        9 * TILE_SIZE,
      )
      const enemyAlmostDead = enemyAnchor
        ? enemyAnchor.hp / Math.max(1, this.getEntityMaxHp(enemyAnchor.id)) <= 0.2
        : false

      if (!group.retreating && casualtyRatio >= GROUP_RETREAT_THRESHOLD && !enemyAlmostDead) {
        group.retreating = true
        if (fallback) {
          for (const u of alive) {
            u.giveOrder({ type: 'move', target: fallback })
          }
        }
        this.rebuildUntilMs = Math.max(this.rebuildUntilMs, this.matchTimer + REBUILD_RECOVERY_MS[this.difficulty])
        this.isAttacking = false
        return true
      }

      if (group.retreating) {
        const avgHpPct = this.avg(alive.map(u => u.hp / Math.max(1, u.def.stats.maxHp)))
        if (fallback) {
          for (const u of alive) {
            if (dist(u.x, u.y, fallback.x, fallback.y) > 4 * TILE_SIZE) {
              u.giveOrder({ type: 'move', target: fallback })
            }
          }
        }
        if (avgHpPct >= GROUP_REGROUP_HEALTH_PCT) {
          group.retreating = false
          group.initialCount = alive.length
          group.focusTargetId = null
        }
        return true
      }

      if (now >= group.focusRetargetMs) {
        this.applyGroupFocusFire(group, alive)
        group.focusRetargetMs = now + FOCUS_FIRE_INTERVAL_MS
      }

      this.applyGroupKiting(alive)
      return true
    })
    if (this.activeAttackGroups.length === 0) {
      this.waveInitialCounts.clear()
      this.isAttacking = false
      return
    }

    if (this.focusFireTimer >= FOCUS_FIRE_INTERVAL_MS) {
      this.focusFireTimer = 0
      this.applyFocusFire()
    }
  }

  private getFallbackPosition(): { x: number; y: number } | null {
    const cy = this.em.getBuildingsForPlayer(this.playerId)
      .find(b => b.def.id === 'construction_yard' && b.state !== 'dying')
    if (cy) return { x: cy.x, y: cy.y }
    const any = this.em.getBuildingsForPlayer(this.playerId).find(b => b.state !== 'dying')
    return any ? { x: any.x, y: any.y } : null
  }

  private isEnemyPlayer(playerId: number): boolean {
    return this.em.isEnemy(this.playerId, playerId)
  }
}
