// ============================================================
// IRON COMMAND — Project Rhizome
// Smart Hard AI substrate: metabolic base management, cellular
// unit density logic, potential-field navigation, overdrive mode.
//
// Designed as a self-contained subsystem that the AI class
// delegates to when difficulty === 'smart_hard'.
// ============================================================

import type { EntityManager } from '../entities/EntityManager'
import type { Economy } from '../economy/Economy'
import type { GameState } from '../types'
import { TILE_SIZE } from '../types'

// ── Tuning constants (exported so tests and docs can reference them) ────────

export const RHIZOME_PARAMS = {

  // ── Metabolic Loop ─────────────────────────────────────────────────────────

  /** Ordered build priority: power → refinery → production → expansion */
  ORGAN_PRIORITY: ['power', 'refinery', 'production', 'expansion'] as const,

  /**
   * Rule-of-3: minimum tile distance between buildings of the same def.
   * Keeps the base spread out so a single bombardment can't hit multiple
   * buildings of the same type.
   */
  RULE_OF_3_TILES: 3,

  /**
   * Power priority threshold.
   * If net power generation / consumption ratio drops below this value,
   * building a power plant is the top priority.
   */
  POWER_RATIO_THRESHOLD: 0.15,

  /** Target count of ore refineries before switching to production priority. */
  REFINERY_COUNT_TARGET: 2,

  /** Target count of production buildings before switching to expansion. */
  PRODUCTION_COUNT_TARGET: 2,

  // ── Cellular Unit Logic (NC Density) ───────────────────────────────────────

  /** How often (ms) to re-evaluate NC density states for all units. */
  NC_DENSITY_INTERVAL_MS: 2000,

  /**
   * An isolated unit has fewer than this many friendly units within
   * NC_DENSITY_RADIUS. Isolated units should retreat.
   */
  ISOLATED_ALLY_THRESHOLD: 2,

  /**
   * Pressure state: enemy count > ally count × this ratio within radius.
   * Units in pressure state should overspill (aggressive push).
   */
  PRESSURE_ENEMY_RATIO: 1.5,

  /** World-space pixel radius used for NC density evaluation (~8 tiles). */
  NC_DENSITY_RADIUS: 8 * TILE_SIZE,

  // ── Potential-Field Navigation ─────────────────────────────────────────────

  /** Attraction weight for friendly harvesters/miners. */
  FIELD_MINER_WEIGHT: 50,

  /** Attraction weight for friendly power-producing buildings. */
  FIELD_POWER_WEIGHT: 30,

  /** Attraction weight for friendly medic/support infantry (no attack). */
  FIELD_MEDIC_WEIGHT: 20,

  /** Repulsion weight for enemy defensive turrets (negative = push away). */
  FIELD_TURRET_WEIGHT: -80,

  /** Attraction weight toward unexplored (fog-of-war hidden) tiles. */
  FIELD_FOG_WEIGHT: 5,

  /** Pixel radius within which field sources influence a unit's bias vector. */
  FIELD_INFLUENCE_RADIUS: 10 * TILE_SIZE,

  /** Tile step used when sampling fog attraction (larger = coarser but faster). */
  FOG_SAMPLE_STEP: 2,

  /** Half-radius in tiles for fog sampling grid. */
  FOG_SAMPLE_RADIUS: 6,

  // ── Overdrive Mode ─────────────────────────────────────────────────────────

  /**
   * Trigger overdrive when the nearest enemy superweapon has fewer than
   * this many ms left on its cooldown.
   */
  OVERDRIVE_SW_COOLDOWN_THRESHOLD_MS: 60_000,

  /**
   * Trigger overdrive when friendly buildings collectively lose more than
   * this fraction of total base max-HP within OVERDRIVE_DAMAGE_WINDOW_MS.
   */
  OVERDRIVE_BASE_DAMAGE_THRESHOLD: 0.30,

  /** Rolling window (ms) over which base damage is summed. */
  OVERDRIVE_DAMAGE_WINDOW_MS: 60_000,

  /**
   * After trigger conditions clear, overdrive remains active for this long.
   * Prevents rapid toggling.
   */
  OVERDRIVE_SUSTAIN_MS: 30_000,

} as const

// ── Public types ─────────────────────────────────────────────────────────────

export type OrganPriority = typeof RHIZOME_PARAMS.ORGAN_PRIORITY[number]
export type NCDensityState = 'isolated' | 'stable' | 'pressure'

// ── Internal types ───────────────────────────────────────────────────────────

interface DamageEntry {
  timeMs: number
  amount: number
}

// ══════════════════════════════════════════════════════════════════════════════

/**
 * Rhizome — Smart Hard AI substrate.
 *
 * Instantiated by the AI class when difficulty === 'smart_hard'. Provides:
 *   1. Metabolic loop   — organ-health build priorities + Rule-of-3 spacing
 *   2. Cellular logic   — per-unit NC density states (isolated/stable/pressure)
 *   3. Potential fields — weighted attraction/repulsion navigation bias
 *   4. Overdrive mode   — flood behaviour when under severe threat
 */
export class Rhizome {
  private readonly playerId: number
  private readonly em: EntityManager
  private readonly economy: Economy

  // NC density
  private ncTimer: number
  private readonly densityCache: Map<string, NCDensityState>

  // Overdrive
  private overdriveActive: boolean
  private overdriveSustainUntilMs: number
  private readonly buildingDamageLog: DamageEntry[]
  private readonly buildingHpSnapshot: Map<string, number>

  // Enemy superweapon cooldown (supplied externally by AI)
  private enemySwCooldownMs: number

  // Match timer (tracks elapsed game time for overdrive window)
  private matchTimeMs: number

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(
    playerId: number,
    entityManager: EntityManager,
    economy: Economy,
  ) {
    this.playerId = playerId
    this.em = entityManager
    this.economy = economy

    this.ncTimer = 0
    this.densityCache = new Map()

    this.overdriveActive = false
    this.overdriveSustainUntilMs = 0
    this.buildingDamageLog = []
    this.buildingHpSnapshot = new Map()

    this.enemySwCooldownMs = Infinity
    this.matchTimeMs = 0
  }

  // ── Main update ───────────────────────────────────────────────────────────

  /**
   * Must be called every game frame (from AI.update).
   * Drives NC density re-evaluation, damage tracking, and overdrive state.
   */
  update(delta: number, gameState: GameState): void {
    this.matchTimeMs += delta

    // NC density re-evaluation on interval
    this.ncTimer += delta
    if (this.ncTimer >= RHIZOME_PARAMS.NC_DENSITY_INTERVAL_MS) {
      this.ncTimer = 0
      this.refreshDensityStates(gameState)
    }

    // Building damage tracking (passive, every frame)
    this.trackBuildingDamage()

    // Overdrive state machine
    this.updateOverdrive()
  }

  // ── Metabolic Loop — Build Priority ──────────────────────────────────────

  /**
   * Returns the current organ-priority for the AI's build order.
   *
   * Priority cascade: power → refinery → production → expansion
   *
   * The AI should consult this before queueing any construction to ensure
   * critical infrastructure is always built first.
   */
  getOrganPriority(_gameState: GameState): OrganPriority {
    const active = this.em
      .getBuildingsForPlayer(this.playerId)
      .filter(b => b.state === 'active' || b.state === 'low_power')

    // 1. Power: rebuild if no power generators exist or generation/consumption
    //    ratio falls below threshold
    const powerGenerators = active.filter(b => b.def.providespower > 0)
    const totalGen = powerGenerators.reduce((s, b) => s + b.def.providespower, 0)
    const totalCons = active
      .filter(b => b.def.providespower < 0)
      .reduce((s, b) => s + Math.abs(b.def.providespower), 0)
    const powerRatio = (totalGen + totalCons) === 0 ? 1 : totalGen / (totalGen + totalCons)
    if (powerGenerators.length === 0 || powerRatio < RHIZOME_PARAMS.POWER_RATIO_THRESHOLD) {
      return 'power'
    }

    // 2. Refinery: need enough income to fund the war effort
    const refineries = active.filter(
      b => b.def.id === 'ore_refinery' || b.def.id === 'smelter',
    ).length
    if (refineries < RHIZOME_PARAMS.REFINERY_COUNT_TARGET) {
      return 'refinery'
    }

    // 3. Production: need barracks / war factories for army (not refineries)
    const prodBuildings = active.filter(
      b =>
        b.def.category === 'production' &&
        b.def.id !== 'ore_refinery' &&
        b.def.id !== 'smelter',
    ).length
    if (prodBuildings < RHIZOME_PARAMS.PRODUCTION_COUNT_TARGET) {
      return 'production'
    }

    // 4. Expand tech/economy/territory
    return 'expansion'
  }

  // ── Rule-of-3 Spacing ────────────────────────────────────────────────────

  /**
   * Returns true when placing defId at (worldX, worldY) is at least
   * RULE_OF_3_TILES away from every existing building of the same type.
   *
   * The AI should call this before committing a build placement.
   */
  meetsSpacingRule(defId: string, worldX: number, worldY: number): boolean {
    const minDist = RHIZOME_PARAMS.RULE_OF_3_TILES * TILE_SIZE
    const minDist2 = minDist * minDist

    for (const b of this.em.getBuildingsForPlayer(this.playerId)) {
      if (b.def.id !== defId || b.state === 'dying') continue
      const dx = b.x - worldX
      const dy = b.y - worldY
      if (dx * dx + dy * dy < minDist2) return false
    }
    return true
  }

  // ── NC Density States ─────────────────────────────────────────────────────

  /**
   * Returns the cached NC density state for a unit.
   *
   * States:
   *   'isolated' — fewer than ISOLATED_ALLY_THRESHOLD allies nearby → retreat
   *   'stable'   — normal combat posture
   *   'pressure' — enemy ratio exceeds PRESSURE_ENEMY_RATIO → overspill/flood
   *
   * Cache refreshes every NC_DENSITY_INTERVAL_MS (~2s).
   */
  getDensityState(unitId: string): NCDensityState {
    return this.densityCache.get(unitId) ?? 'stable'
  }

  private refreshDensityStates(gameState: GameState): void {
    const myUnits = this.em.getUnitsForPlayer(this.playerId)
    const R = RHIZOME_PARAMS.NC_DENSITY_RADIUS
    const R2 = R * R

    // Flatten all enemy unit positions for fast lookup
    const enemyPositions: Array<{ x: number; y: number }> = []
    for (const p of gameState.players) {
      if (p.isDefeated || p.id === this.playerId) continue
      for (const eu of this.em.getUnitsForPlayer(p.id)) {
        if (eu.state !== 'dying') enemyPositions.push({ x: eu.x, y: eu.y })
      }
    }

    for (const unit of myUnits) {
      if (unit.state === 'dying') {
        this.densityCache.delete(unit.id)
        continue
      }

      let allies = 0
      let enemies = 0

      for (const other of myUnits) {
        if (other.id === unit.id || other.state === 'dying') continue
        const dx = other.x - unit.x
        const dy = other.y - unit.y
        if (dx * dx + dy * dy <= R2) allies++
      }

      for (const ep of enemyPositions) {
        const dx = ep.x - unit.x
        const dy = ep.y - unit.y
        if (dx * dx + dy * dy <= R2) enemies++
      }

      let state: NCDensityState
      if (this.overdriveActive) {
        // In overdrive: never retreat, treat pressure as stable aggression
        state = enemies > allies * RHIZOME_PARAMS.PRESSURE_ENEMY_RATIO ? 'pressure' : 'stable'
      } else if (allies < RHIZOME_PARAMS.ISOLATED_ALLY_THRESHOLD) {
        state = 'isolated'
      } else if (enemies > allies * RHIZOME_PARAMS.PRESSURE_ENEMY_RATIO) {
        state = 'pressure'
      } else {
        state = 'stable'
      }

      this.densityCache.set(unit.id, state)
    }
  }

  // ── Potential-Field Navigation ────────────────────────────────────────────

  /**
   * Computes a normalized (dx, dy) navigation bias vector for a unit at
   * (ux, uy) based on weighted attraction/repulsion sources.
   *
   * Weights:
   *   Harvesters    +50  (protect income)
   *   Power plants  +30  (stay near infrastructure)
   *   Medic units   +20  (cohesion with support)
   *   Enemy turrets -80  (avoid fixed defenses)
   *   Fog tiles      +5  (opportunistic scouting)
   *
   * In overdrive mode all repulsion forces are zeroed so units flood forward.
   *
   * Returns { dx: 0, dy: 0 } when no significant field is present.
   */
  getPotentialFieldBias(
    ux: number,
    uy: number,
    gameState: GameState,
  ): { dx: number; dy: number } {
    const R = RHIZOME_PARAMS.FIELD_INFLUENCE_RADIUS
    const R2 = R * R
    let fx = 0
    let fy = 0

    const addForce = (srcX: number, srcY: number, weight: number) => {
      const dx = srcX - ux
      const dy = srcY - uy
      const d2 = dx * dx + dy * dy
      if (d2 < 1 || d2 > R2) return
      const d = Math.sqrt(d2)
      // Linear falloff: full weight at source, zero at influence radius edge
      const strength = weight * (1 - d / R)
      fx += (dx / d) * strength
      fy += (dy / d) * strength
    }

    const myUnits = this.em.getUnitsForPlayer(this.playerId)
    const myBuildings = this.em.getBuildingsForPlayer(this.playerId)

    // Harvester/miner attraction — escort income units
    for (const u of myUnits) {
      if (u.state === 'dying') continue
      if (u.def.category === 'harvester') {
        addForce(u.x, u.y, RHIZOME_PARAMS.FIELD_MINER_WEIGHT)
      }
      // Infantry without an attack profile → medic/support proxy
      if (u.def.category === 'infantry' && !u.def.attack) {
        addForce(u.x, u.y, RHIZOME_PARAMS.FIELD_MEDIC_WEIGHT)
      }
    }

    // Power-plant attraction — anchor army near base infrastructure
    for (const b of myBuildings) {
      if (b.state === 'dying') continue
      if (b.def.providespower > 0) {
        addForce(b.x, b.y, RHIZOME_PARAMS.FIELD_POWER_WEIGHT)
      }
    }

    // Enemy turret repulsion — suppressed during overdrive
    if (!this.overdriveActive) {
      for (const p of gameState.players) {
        if (p.isDefeated || p.id === this.playerId) continue
        for (const eb of this.em.getBuildingsForPlayer(p.id)) {
          if (eb.state === 'dying') continue
          if (eb.def.category === 'defense' && eb.def.attack) {
            addForce(eb.x, eb.y, RHIZOME_PARAMS.FIELD_TURRET_WEIGHT)
          }
        }
      }
    }

    // Fog attraction — light pull toward unexplored territory
    const fogBias = this.sampleFogAttraction(ux, uy, gameState)
    fx += fogBias.dx * RHIZOME_PARAMS.FIELD_FOG_WEIGHT
    fy += fogBias.dy * RHIZOME_PARAMS.FIELD_FOG_WEIGHT

    // Normalize to unit vector
    const len = Math.sqrt(fx * fx + fy * fy)
    if (len < 0.001) return { dx: 0, dy: 0 }
    return { dx: fx / len, dy: fy / len }
  }

  private sampleFogAttraction(
    ux: number,
    uy: number,
    gameState: GameState,
  ): { dx: number; dy: number } {
    const map = gameState.map
    const centerCol = Math.floor(ux / TILE_SIZE)
    const centerRow = Math.floor(uy / TILE_SIZE)
    let fx = 0
    let fy = 0
    const step = RHIZOME_PARAMS.FOG_SAMPLE_STEP
    const radius = RHIZOME_PARAMS.FOG_SAMPLE_RADIUS

    for (let dr = -radius; dr <= radius; dr += step) {
      for (let dc = -radius; dc <= radius; dc += step) {
        const col = centerCol + dc
        const row = centerRow + dr
        if (col < 0 || row < 0 || col >= map.width || row >= map.height) continue
        const tile = map.tiles[row]?.[col]
        if (!tile) continue
        // FogState.HIDDEN === 0 — pull toward undiscovered tiles
        if (tile.fogState === 0) {
          fx += dc
          fy += dr
        }
      }
    }

    const len = Math.sqrt(fx * fx + fy * fy)
    if (len < 0.001) return { dx: 0, dy: 0 }
    return { dx: fx / len, dy: fy / len }
  }

  // ── Overdrive Mode ────────────────────────────────────────────────────────

  /**
   * Inject the AI's nearest enemy superweapon cooldown so Rhizome can
   * evaluate the SW trigger condition. Call this whenever AI ticks
   * its superweapon tracking logic.
   *
   * @param remainingMs  ms until the nearest enemy SW is ready (Infinity if none)
   */
  notifyEnemySwCooldown(remainingMs: number): void {
    this.enemySwCooldownMs = remainingMs
  }

  /** True when overdrive is active — repulsion and retreat are suppressed. */
  isOverdriveActive(): boolean {
    return this.overdriveActive
  }

  private trackBuildingDamage(): void {
    for (const b of this.em.getBuildingsForPlayer(this.playerId)) {
      if (b.state === 'dying') continue
      const prev = this.buildingHpSnapshot.get(b.id)
      const curr = b.hp
      if (prev !== undefined && curr < prev) {
        this.buildingDamageLog.push({
          timeMs: this.matchTimeMs,
          amount: prev - curr,
        })
      }
      this.buildingHpSnapshot.set(b.id, curr)
    }
  }

  private updateOverdrive(): void {
    const wasActive = this.overdriveActive

    // Trigger 1: Enemy superweapon nearly ready
    const swTrigger =
      this.enemySwCooldownMs <
      RHIZOME_PARAMS.OVERDRIVE_SW_COOLDOWN_THRESHOLD_MS

    // Trigger 2: High base damage over rolling window
    const windowStart = this.matchTimeMs - RHIZOME_PARAMS.OVERDRIVE_DAMAGE_WINDOW_MS
    const recentDamage = this.buildingDamageLog
      .filter(e => e.timeMs >= windowStart)
      .reduce((sum, e) => sum + e.amount, 0)

    // Prune old entries
    while (
      this.buildingDamageLog.length > 0 &&
      this.buildingDamageLog[0].timeMs < windowStart - 1000
    ) {
      this.buildingDamageLog.shift()
    }

    const totalBaseMaxHp = this.em
      .getBuildingsForPlayer(this.playerId)
      .reduce((s, b) => s + b.def.stats.maxHp, 0)

    const dmgTrigger =
      totalBaseMaxHp > 0 &&
      recentDamage / totalBaseMaxHp > RHIZOME_PARAMS.OVERDRIVE_BASE_DAMAGE_THRESHOLD

    if (swTrigger || dmgTrigger) {
      this.overdriveSustainUntilMs =
        this.matchTimeMs + RHIZOME_PARAMS.OVERDRIVE_SUSTAIN_MS
    }

    this.overdriveActive = this.matchTimeMs < this.overdriveSustainUntilMs

    if (this.overdriveActive !== wasActive) {
      console.log(
        `[Rhizome P${this.playerId}] Overdrive ${this.overdriveActive ? 'ACTIVATED' : 'DEACTIVATED'}` +
          ` | swTrigger=${swTrigger}` +
          ` | dmgTrigger=${dmgTrigger}` +
          ` | recentDmg=${Math.round(recentDamage)}` +
          ` | baseMaxHp=${totalBaseMaxHp}`,
      )
    }
  }
}
