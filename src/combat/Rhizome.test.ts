// ============================================================
// Project Rhizome — Unit Tests
// Tests for the Smart Hard AI substrate:
//   - RHIZOME_PARAMS constant values
//   - Metabolic loop (organ priority, Rule-of-3 spacing)
//   - NC density states
//   - Potential-field navigation bias
//   - Overdrive mode triggers
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Rhizome, RHIZOME_PARAMS } from './Rhizome'
import type { GameState } from '../types'
import { TILE_SIZE } from '../types'

// ── Minimal mocks ────────────────────────────────────────────────────────────

/** Creates a minimal mock building */
function mockBuilding(overrides: Partial<{
  id: string
  playerId: number
  x: number
  y: number
  hp: number
  state: string
  defId: string
  category: string
  providespower: number
  maxHp: number
  hasAttack: boolean
}> = {}) {
  const opts = {
    id: 'b1',
    playerId: 1,
    x: 100,
    y: 100,
    hp: 500,
    state: 'active',
    defId: 'barracks',
    category: 'production',
    providespower: 0,
    maxHp: 500,
    hasAttack: false,
    ...overrides,
  }
  return {
    id: opts.id,
    playerId: opts.playerId,
    x: opts.x,
    y: opts.y,
    hp: opts.hp,
    state: opts.state,
    def: {
      id: opts.defId,
      category: opts.category,
      providespower: opts.providespower,
      stats: { maxHp: opts.maxHp },
      attack: opts.hasAttack ? { damage: 20, range: 6 } : null,
    },
  }
}

/** Creates a minimal mock unit */
function mockUnit(overrides: Partial<{
  id: string
  playerId: number
  x: number
  y: number
  hp: number
  state: string
  category: string
  hasAttack: boolean
}> = {}) {
  const opts = {
    id: 'u1',
    playerId: 1,
    x: 200,
    y: 200,
    hp: 100,
    state: 'idle',
    category: 'vehicle',
    hasAttack: true,
    ...overrides,
  }
  return {
    id: opts.id,
    playerId: opts.playerId,
    x: opts.x,
    y: opts.y,
    hp: opts.hp,
    state: opts.state,
    def: {
      id: opts.category,
      category: opts.category,
      attack: opts.hasAttack ? { damage: 15 } : null,
    },
  }
}

/** Creates a minimal mock EntityManager */
function mockEntityManager(
  buildings: ReturnType<typeof mockBuilding>[] = [],
  units: ReturnType<typeof mockUnit>[] = [],
) {
  return {
    getBuildingsForPlayer: vi.fn((playerId: number) =>
      buildings.filter(b => b.playerId === playerId),
    ),
    getUnitsForPlayer: vi.fn((playerId: number) =>
      units.filter(u => u.playerId === playerId),
    ),
    getBuilding: vi.fn((id: string) => buildings.find(b => b.id === id)),
  } as unknown as import('../entities/EntityManager').EntityManager
}

/** Creates a minimal mock Economy */
function mockEconomy(credits = 0) {
  return { getCredits: () => credits } as unknown as import('../economy/Economy').Economy
}

/** Creates a minimal GameState with a fog-of-war map */
function mockGameState(
  players: Array<{ id: number; isDefeated: boolean }> = [{ id: 1, isDefeated: false }],
  mapWidth = 32,
  mapHeight = 32,
): GameState {
  const tiles = Array.from({ length: mapHeight }, () =>
    Array.from({ length: mapWidth }, () => ({
      terrain: 0,
      height: 0,
      passable: true,
      buildable: true,
      oreAmount: 0,
      fogState: 0,   // FogState.HIDDEN
      occupiedBy: null,
    })),
  )

  return {
    phase: 'playing',
    tick: 0,
    localPlayerId: 0,
    selectedEntityIds: [],
    players: players.map(p => ({
      id: p.id,
      name: `Player ${p.id}`,
      faction: 'usa' as const,
      color: 0xffffff,
      credits: 10000,
      power: 100,
      powerGenerated: 100,
      powerConsumed: 0,
      isAI: true,
      isDefeated: p.isDefeated,
      entities: [],
      buildQueue: [],
    })),
    map: {
      name: 'test',
      width: mapWidth,
      height: mapHeight,
      tileSize: TILE_SIZE,
      tiles,
      startPositions: [],
    },
  } as unknown as GameState
}

// ══════════════════════════════════════════════════════════════════════════════
// Test suites
// ══════════════════════════════════════════════════════════════════════════════

describe('RHIZOME_PARAMS', () => {
  it('has correct potential-field weights', () => {
    expect(RHIZOME_PARAMS.FIELD_MINER_WEIGHT).toBe(50)
    expect(RHIZOME_PARAMS.FIELD_POWER_WEIGHT).toBe(30)
    expect(RHIZOME_PARAMS.FIELD_MEDIC_WEIGHT).toBe(20)
    expect(RHIZOME_PARAMS.FIELD_TURRET_WEIGHT).toBe(-80)
    expect(RHIZOME_PARAMS.FIELD_FOG_WEIGHT).toBe(5)
  })

  it('has overdrive thresholds', () => {
    expect(RHIZOME_PARAMS.OVERDRIVE_SW_COOLDOWN_THRESHOLD_MS).toBe(60_000)
    expect(RHIZOME_PARAMS.OVERDRIVE_BASE_DAMAGE_THRESHOLD).toBe(0.30)
    expect(RHIZOME_PARAMS.OVERDRIVE_DAMAGE_WINDOW_MS).toBe(60_000)
  })

  it('has Rule-of-3 spacing', () => {
    expect(RHIZOME_PARAMS.RULE_OF_3_TILES).toBe(3)
  })

  it('has NC density thresholds', () => {
    expect(RHIZOME_PARAMS.NC_DENSITY_INTERVAL_MS).toBe(2000)
    expect(RHIZOME_PARAMS.ISOLATED_ALLY_THRESHOLD).toBe(2)
    expect(RHIZOME_PARAMS.PRESSURE_ENEMY_RATIO).toBe(1.5)
  })

  it('organ priority order is power→refinery→production→tech→expansion', () => {
    expect(RHIZOME_PARAMS.ORGAN_PRIORITY[0]).toBe('power')
    expect(RHIZOME_PARAMS.ORGAN_PRIORITY[1]).toBe('refinery')
    expect(RHIZOME_PARAMS.ORGAN_PRIORITY[2]).toBe('production')
    expect(RHIZOME_PARAMS.ORGAN_PRIORITY[3]).toBe('tech')
    expect(RHIZOME_PARAMS.ORGAN_PRIORITY[4]).toBe('expansion')
  })
})

// ── Metabolic Loop ────────────────────────────────────────────────────────────

describe('Rhizome.getOrganPriority', () => {
  it('returns "power" when no power buildings exist', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    const priority = r.getOrganPriority(mockGameState())
    expect(priority).toBe('power')
  })

  it('returns "power" when generation is below ratio threshold', () => {
    const buildings = [
      mockBuilding({ defId: 'power_plant', category: 'power', providespower: 10, state: 'active' }),
      mockBuilding({ id: 'b2', defId: 'barracks', providespower: -100, state: 'active' }),
    ]
    const em = mockEntityManager(buildings, [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.getOrganPriority(mockGameState())).toBe('power')
  })

  it('returns "refinery" when power is sufficient but refineries < target', () => {
    const buildings = [
      mockBuilding({ defId: 'power_plant', category: 'power', providespower: 200, state: 'active' }),
    ]
    const em = mockEntityManager(buildings, [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.getOrganPriority(mockGameState())).toBe('refinery')
  })

  it('returns "production" when power+refinery ok but unit-production buildings < target', () => {
    // 2 refineries satisfy the refinery priority threshold.
    // No barracks/war_factory → non-refinery production count = 0 < PRODUCTION_COUNT_TARGET (2)
    const buildings = [
      mockBuilding({ defId: 'power_plant', category: 'power', providespower: 200, state: 'active' }),
      mockBuilding({ id: 'b2', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b3', defId: 'ore_refinery', category: 'production', state: 'active' }),
    ]
    const em = mockEntityManager(buildings, [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.getOrganPriority(mockGameState())).toBe('production')
  })

  it('returns "tech" when production targets are met, no tech buildings, and credits allow', () => {
    const buildings = [
      mockBuilding({ defId: 'power_plant', category: 'power', providespower: 200, state: 'active' }),
      mockBuilding({ id: 'b2', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b3', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b4', defId: 'barracks', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b5', defId: 'war_factory', category: 'production', state: 'active' }),
    ]
    const em = mockEntityManager(buildings, [])
    const r = new Rhizome(1, em, mockEconomy(RHIZOME_PARAMS.TECH_CREDIT_MIN))
    expect(r.getOrganPriority(mockGameState())).toBe('tech')
  })

  it('returns "expansion" when all organ targets are met and tech building exists', () => {
    const buildings = [
      mockBuilding({ defId: 'power_plant', category: 'power', providespower: 200, state: 'active' }),
      mockBuilding({ id: 'b2', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b3', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b4', defId: 'barracks', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b5', defId: 'war_factory', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b6', defId: 'air_force_command', category: 'tech', state: 'active' }),
    ]
    const em = mockEntityManager(buildings, [])
    const r = new Rhizome(1, em, mockEconomy(5000))
    expect(r.getOrganPriority(mockGameState())).toBe('expansion')
  })

  it('returns "expansion" when all organ targets are met and credits below tech threshold', () => {
    const buildings = [
      mockBuilding({ defId: 'power_plant', category: 'power', providespower: 200, state: 'active' }),
      mockBuilding({ id: 'b2', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b3', defId: 'ore_refinery', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b4', defId: 'barracks', category: 'production', state: 'active' }),
      mockBuilding({ id: 'b5', defId: 'war_factory', category: 'production', state: 'active' }),
    ]
    const em = mockEntityManager(buildings, [])
    // 0 credits — below TECH_CREDIT_MIN — so tech is not triggered
    const r = new Rhizome(1, em, mockEconomy(0))
    expect(r.getOrganPriority(mockGameState())).toBe('expansion')
  })
})

// ── Rule-of-3 Spacing ─────────────────────────────────────────────────────────

describe('Rhizome.meetsSpacingRule', () => {
  const minDist = RHIZOME_PARAMS.RULE_OF_3_TILES * TILE_SIZE

  it('returns true when no buildings of same type exist', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.meetsSpacingRule('barracks', 500, 500)).toBe(true)
  })

  it('returns false when proposed position is too close to same-type building', () => {
    const existing = mockBuilding({ defId: 'barracks', x: 500, y: 500 })
    const em = mockEntityManager([existing], [])
    const r = new Rhizome(1, em, mockEconomy())
    // Position just inside minimum distance
    expect(r.meetsSpacingRule('barracks', 500 + minDist - 1, 500)).toBe(false)
  })

  it('returns true when proposed position is at or beyond minimum distance', () => {
    const existing = mockBuilding({ defId: 'barracks', x: 500, y: 500 })
    const em = mockEntityManager([existing], [])
    const r = new Rhizome(1, em, mockEconomy())
    // Position at or beyond minimum distance (diagonal to clear)
    expect(r.meetsSpacingRule('barracks', 500 + minDist + 1, 500)).toBe(true)
  })

  it('ignores dying buildings when checking spacing', () => {
    const dying = mockBuilding({ defId: 'barracks', x: 500, y: 500, state: 'dying' })
    const em = mockEntityManager([dying], [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.meetsSpacingRule('barracks', 510, 510)).toBe(true)
  })

  it('ignores buildings of a different type', () => {
    const other = mockBuilding({ defId: 'war_factory', x: 500, y: 500 })
    const em = mockEntityManager([other], [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.meetsSpacingRule('barracks', 510, 510)).toBe(true)
  })
})

// ── NC Density States ──────────────────────────────────────────────────────────

describe('Rhizome NC density states', () => {
  it('returns "stable" by default before first update', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.getDensityState('u_unknown')).toBe('stable')
  })

  it('returns "isolated" when unit has fewer allies than threshold', () => {
    // Single unit, alone in the world
    const units = [
      mockUnit({ id: 'u1', playerId: 1, x: 100, y: 100 }),
    ]
    const em = mockEntityManager([], units)
    const r = new Rhizome(1, em, mockEconomy())
    // Advance past NC interval to trigger re-evaluation
    r.update(RHIZOME_PARAMS.NC_DENSITY_INTERVAL_MS + 1, mockGameState([{ id: 1, isDefeated: false }]))
    expect(r.getDensityState('u1')).toBe('isolated')
  })

  it('returns "stable" when unit has enough allies and no overwhelming enemies', () => {
    const units = [
      mockUnit({ id: 'u1', playerId: 1, x: 100, y: 100 }),
      mockUnit({ id: 'u2', playerId: 1, x: 110, y: 100 }),
      mockUnit({ id: 'u3', playerId: 1, x: 120, y: 100 }),
    ]
    const em = mockEntityManager([], units)
    const r = new Rhizome(1, em, mockEconomy())
    r.update(RHIZOME_PARAMS.NC_DENSITY_INTERVAL_MS + 1, mockGameState([{ id: 1, isDefeated: false }]))
    expect(r.getDensityState('u1')).toBe('stable')
  })

  it('returns "pressure" when enemy count exceeds ally count × ratio', () => {
    // 2 allies (meets threshold), but 10 enemies
    const allyUnits = [
      mockUnit({ id: 'u1', playerId: 1, x: 100, y: 100 }),
      mockUnit({ id: 'u2', playerId: 1, x: 110, y: 100 }),
      mockUnit({ id: 'u3', playerId: 1, x: 120, y: 100 }),
    ]
    const enemyUnits = Array.from({ length: 10 }, (_, i) =>
      mockUnit({ id: `e${i}`, playerId: 2, x: 100 + i * 5, y: 110 }),
    )
    const allUnits = [...allyUnits, ...enemyUnits]
    const em = mockEntityManager([], allUnits)
    const r = new Rhizome(1, em, mockEconomy())
    const gs = mockGameState([
      { id: 1, isDefeated: false },
      { id: 2, isDefeated: false },
    ])
    r.update(RHIZOME_PARAMS.NC_DENSITY_INTERVAL_MS + 1, gs)
    expect(r.getDensityState('u1')).toBe('pressure')
  })
})

// ── Potential-Field Navigation ────────────────────────────────────────────────

describe('Rhizome.getPotentialFieldBias', () => {
  it('returns zero bias when no field sources exist', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    const bias = r.getPotentialFieldBias(500, 500, mockGameState())
    expect(bias.dx).toBe(0)
    expect(bias.dy).toBe(0)
  })

  it('produces attraction toward harvester units', () => {
    const harvester = mockUnit({
      id: 'h1',
      playerId: 1,
      category: 'harvester',
      x: 500 + RHIZOME_PARAMS.FIELD_INFLUENCE_RADIUS * 0.5,
      y: 500,
    })
    const em = mockEntityManager([], [harvester])
    const r = new Rhizome(1, em, mockEconomy())
    const bias = r.getPotentialFieldBias(500, 500, mockGameState())
    // Should pull in positive-x direction toward harvester
    expect(bias.dx).toBeGreaterThan(0)
  })

  it('produces repulsion from enemy defense turrets (when not in overdrive)', () => {
    const turret = mockBuilding({
      id: 'turret1',
      playerId: 2,
      category: 'defense',
      hasAttack: true,
      x: 500 + RHIZOME_PARAMS.FIELD_INFLUENCE_RADIUS * 0.5,
      y: 500,
    })
    const em = mockEntityManager([turret], [])
    const r = new Rhizome(1, em, mockEconomy())
    const gs = mockGameState([
      { id: 1, isDefeated: false },
      { id: 2, isDefeated: false },
    ])
    const bias = r.getPotentialFieldBias(500, 500, gs)
    // Should push in negative-x direction away from turret
    expect(bias.dx).toBeLessThan(0)
  })

  it('suppresses turret repulsion during overdrive', () => {
    const turret = mockBuilding({
      id: 'turret1',
      playerId: 2,
      category: 'defense',
      hasAttack: true,
      x: 500 + RHIZOME_PARAMS.FIELD_INFLUENCE_RADIUS * 0.5,
      y: 500,
    })
    // Player's own power plant to give some non-zero attraction in the same direction
    const powerPlant = mockBuilding({
      id: 'pp1',
      playerId: 1,
      category: 'power',
      providespower: 100,
      x: 500 + RHIZOME_PARAMS.FIELD_INFLUENCE_RADIUS * 0.4,
      y: 500,
    })
    const em = mockEntityManager([turret, powerPlant], [])
    const r = new Rhizome(1, em, mockEconomy())

    // Trigger overdrive via SW cooldown
    r.notifyEnemySwCooldown(0)  // 0 ms remaining = definitely triggers
    r.update(1, mockGameState([{ id: 1, isDefeated: false }, { id: 2, isDefeated: false }]))

    expect(r.isOverdriveActive()).toBe(true)

    const gs = mockGameState([
      { id: 1, isDefeated: false },
      { id: 2, isDefeated: false },
    ])
    const bias = r.getPotentialFieldBias(500, 500, gs)
    // With turret repulsion suppressed and power plant attracting, dx should be >= 0
    expect(bias.dx).toBeGreaterThanOrEqual(0)
  })

  it('returns normalized vector (length ≤ 1)', () => {
    const harvester = mockUnit({
      id: 'h1', playerId: 1, category: 'harvester',
      x: 600, y: 600,
    })
    const em = mockEntityManager([], [harvester])
    const r = new Rhizome(1, em, mockEconomy())
    const bias = r.getPotentialFieldBias(500, 500, mockGameState())
    const len = Math.sqrt(bias.dx ** 2 + bias.dy ** 2)
    expect(len).toBeLessThanOrEqual(1.001)
  })
})

// ── Overdrive Mode ────────────────────────────────────────────────────────────

describe('Rhizome overdrive mode', () => {
  it('starts inactive', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    expect(r.isOverdriveActive()).toBe(false)
  })

  it('activates when enemy SW cooldown is below threshold', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    r.notifyEnemySwCooldown(RHIZOME_PARAMS.OVERDRIVE_SW_COOLDOWN_THRESHOLD_MS - 1)
    r.update(1, mockGameState())
    expect(r.isOverdriveActive()).toBe(true)
  })

  it('stays inactive when enemy SW cooldown is above threshold', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())
    r.notifyEnemySwCooldown(RHIZOME_PARAMS.OVERDRIVE_SW_COOLDOWN_THRESHOLD_MS + 1)
    r.update(1, mockGameState())
    expect(r.isOverdriveActive()).toBe(false)
  })

  it('activates when base damage exceeds threshold fraction in window', () => {
    const maxHp = 1000
    // Start with a full-health building, then drop its HP
    const building = mockBuilding({ id: 'b1', playerId: 1, hp: maxHp, maxHp, state: 'active' })
    const em = mockEntityManager([building], [])
    const r = new Rhizome(1, em, mockEconomy())

    // First update: snapshot HP at maxHp
    r.update(1, mockGameState())
    expect(r.isOverdriveActive()).toBe(false)

    // Simulate 35% damage (above 30% threshold)
    building.hp = Math.floor(maxHp * 0.65)

    // Second update: detect damage, trigger overdrive
    r.update(1, mockGameState())
    expect(r.isOverdriveActive()).toBe(true)
  })

  it('sustains overdrive for OVERDRIVE_SUSTAIN_MS after trigger clears', () => {
    const em = mockEntityManager([], [])
    const r = new Rhizome(1, em, mockEconomy())

    // Trigger via SW
    r.notifyEnemySwCooldown(0)
    r.update(1, mockGameState())
    expect(r.isOverdriveActive()).toBe(true)

    // Clear trigger
    r.notifyEnemySwCooldown(Infinity)

    // Still active inside sustain window
    r.update(RHIZOME_PARAMS.OVERDRIVE_SUSTAIN_MS - 100, mockGameState())
    expect(r.isOverdriveActive()).toBe(true)

    // Deactivates after sustain window
    r.update(200, mockGameState())
    expect(r.isOverdriveActive()).toBe(false)
  })
})
