import { describe, it, expect } from 'vitest'
import {
  HOME_BASE_RADIUS_TILES,
  ENEMY_SPAWN_MIN_SEPARATION,
  isInHomeBase,
  isInAnyEnemyBase,
  relocateTileFromEnemyBases,
  validateSpawnSeparation,
  enforceEnemySpawnSeparation,
  type SpawnInfo,
} from '../spawnValidation'

// ── isInHomeBase ─────────────────────────────────────────────

describe('isInHomeBase', () => {
  it('returns true for the spawn tile itself', () => {
    expect(isInHomeBase(10, 10, 10, 10)).toBe(true)
  })

  it('returns true at exactly the boundary (Chebyshev distance == radius)', () => {
    expect(isInHomeBase(10 + HOME_BASE_RADIUS_TILES, 10, 10, 10)).toBe(true)
    expect(isInHomeBase(10, 10 - HOME_BASE_RADIUS_TILES, 10, 10)).toBe(true)
    expect(isInHomeBase(
      10 + HOME_BASE_RADIUS_TILES,
      10 + HOME_BASE_RADIUS_TILES,
      10, 10,
    )).toBe(true)
  })

  it('returns false one tile outside the boundary', () => {
    expect(isInHomeBase(10 + HOME_BASE_RADIUS_TILES + 1, 10, 10, 10)).toBe(false)
    expect(isInHomeBase(10, 10 + HOME_BASE_RADIUS_TILES + 1, 10, 10)).toBe(false)
  })

  it('respects a custom radius', () => {
    expect(isInHomeBase(5, 5, 10, 10, 6)).toBe(true)  // |10-5|=5 <= 6 → inside
    expect(isInHomeBase(4, 10, 10, 10, 6)).toBe(true)  // |10-4|=6 <= 6 → on boundary
    expect(isInHomeBase(3, 10, 10, 10, 6)).toBe(false)  // |10-3|=7 > 6 → outside
  })
})

// ── isInAnyEnemyBase ─────────────────────────────────────────

describe('isInAnyEnemyBase', () => {
  const spawns = [
    { col: 5, row: 5 },
    { col: 60, row: 60 },
  ]

  it('returns false for empty enemy list', () => {
    expect(isInAnyEnemyBase(5, 5, [])).toBe(false)
  })

  it('returns true when inside first enemy base', () => {
    expect(isInAnyEnemyBase(5, 5, spawns)).toBe(true)
    expect(isInAnyEnemyBase(5 + HOME_BASE_RADIUS_TILES, 5, spawns)).toBe(true)
  })

  it('returns true when inside second enemy base', () => {
    expect(isInAnyEnemyBase(60, 60, spawns)).toBe(true)
  })

  it('returns false between bases', () => {
    expect(isInAnyEnemyBase(32, 32, spawns)).toBe(false)
  })
})

// ── relocateTileFromEnemyBases ────────────────────────────────

describe('relocateTileFromEnemyBases', () => {
  const MAP_W = 64
  const MAP_H = 64
  // Own player spawn in top-left, enemy in bottom-right
  const ownSpawn = { col: 6, row: 6 }
  const enemySpawns = [{ col: 57, row: 57 }]

  it('returns the original tile when it is already safe', () => {
    const result = relocateTileFromEnemyBases(
      10, 10, ownSpawn.col, ownSpawn.row, enemySpawns, MAP_W, MAP_H,
    )
    expect(result).toEqual({ col: 10, row: 10 })
  })

  it('relocates a tile that falls inside an enemy base', () => {
    // Tile exactly on enemy spawn — must be relocated
    const result = relocateTileFromEnemyBases(
      57, 57, ownSpawn.col, ownSpawn.row, enemySpawns, MAP_W, MAP_H,
    )
    expect(result).not.toEqual({ col: 57, row: 57 })
    // Result must not be inside enemy base
    const { col, row } = result
    expect(isInAnyEnemyBase(col, row, enemySpawns)).toBe(false)
  })

  it('relocated tile stays within map bounds', () => {
    const result = relocateTileFromEnemyBases(
      57, 57, ownSpawn.col, ownSpawn.row, enemySpawns, MAP_W, MAP_H,
    )
    expect(result.col).toBeGreaterThanOrEqual(1)
    expect(result.col).toBeLessThan(MAP_W - 1)
    expect(result.row).toBeGreaterThanOrEqual(1)
    expect(result.row).toBeLessThan(MAP_H - 1)
  })

  it('handles multiple enemy spawns', () => {
    const multiEnemy = [
      { col: 10, row: 10 },
      { col: 50, row: 10 },
    ]
    // Place own spawn at bottom-left, target tile inside first enemy base
    const result = relocateTileFromEnemyBases(
      10, 10, 10, 55, multiEnemy, MAP_W, MAP_H,
    )
    expect(isInAnyEnemyBase(result.col, result.row, multiEnemy)).toBe(false)
  })
})

// ── validateSpawnSeparation ───────────────────────────────────

describe('validateSpawnSeparation', () => {
  // Simple enemy check: player 0 vs player 1 are enemies; 0 vs 2 are allies
  const isEnemy = (a: number, b: number) => {
    if (a === b) return false
    // players 0 and 2 are allied
    if ((a === 0 && b === 2) || (a === 2 && b === 0)) return false
    return true
  }

  it('returns no violations when all enemy pairs are far apart', () => {
    const spawns: SpawnInfo[] = [
      { col: 5,  row: 5,  playerId: 0 },
      { col: 60, row: 60, playerId: 1 },
    ]
    expect(validateSpawnSeparation(spawns, isEnemy)).toHaveLength(0)
  })

  it('returns a violation when enemy players are too close', () => {
    const spawns: SpawnInfo[] = [
      { col: 5, row: 5,  playerId: 0 },
      { col: 8, row: 8,  playerId: 1 }, // within ENEMY_SPAWN_MIN_SEPARATION
    ]
    const violations = validateSpawnSeparation(spawns, isEnemy)
    expect(violations).toHaveLength(1)
    expect(violations[0].playerA).toBe(0)
    expect(violations[0].playerB).toBe(1)
    expect(violations[0].distance).toBeLessThan(ENEMY_SPAWN_MIN_SEPARATION)
  })

  it('does NOT flag allied players as violations even when close', () => {
    const spawns: SpawnInfo[] = [
      { col: 5, row: 5, playerId: 0 },
      { col: 6, row: 6, playerId: 2 }, // allied to player 0, very close
    ]
    expect(validateSpawnSeparation(spawns, isEnemy)).toHaveLength(0)
  })

  it('uses a custom minSeparation', () => {
    const spawns: SpawnInfo[] = [
      { col: 5,  row: 5,  playerId: 0 },
      { col: 15, row: 5,  playerId: 1 }, // 10 tiles apart
    ]
    // With minSeparation=5 → no violation
    expect(validateSpawnSeparation(spawns, isEnemy, 5)).toHaveLength(0)
    // With minSeparation=15 → violation
    expect(validateSpawnSeparation(spawns, isEnemy, 15)).toHaveLength(1)
  })
})

// ── enforceEnemySpawnSeparation ───────────────────────────────

describe('enforceEnemySpawnSeparation', () => {
  const isEnemy = (a: number, b: number) => a !== b

  it('leaves valid assignments unchanged', () => {
    const playerIds = [0, 1]
    const positions = [
      { col: 5,  row: 5  },
      { col: 60, row: 60 },
    ]
    const assigned = [0, 1]
    const result = enforceEnemySpawnSeparation(playerIds, positions, assigned, isEnemy)
    expect(result).toEqual([0, 1])
  })

  it('swaps a conflicting enemy spawn to a farther one', () => {
    const playerIds = [0, 1]
    // Spawn 0 and 1 are adjacent (too close); spawn 2 is far
    const positions = [
      { col: 5,  row: 5  }, // spawn 0
      { col: 7,  row: 5  }, // spawn 1 — only 2 tiles from spawn 0
      { col: 60, row: 60 }, // spawn 2 — far
    ]
    const assigned = [0, 1]
    const result = enforceEnemySpawnSeparation(playerIds, positions, assigned, isEnemy)
    // Player 0 keeps spawn 0; player 1 should be moved to spawn 2
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(2)
  })

  it('never moves player 0 (human player preferred spawn)', () => {
    const playerIds = [0, 1]
    const positions = [
      { col: 5,  row: 5  }, // spawn 0 — player 0's preferred
      { col: 7,  row: 5  }, // spawn 1 — very close to spawn 0
      { col: 60, row: 60 }, // spawn 2
    ]
    const assigned = [0, 1]
    const result = enforceEnemySpawnSeparation(playerIds, positions, assigned, isEnemy)
    expect(result[0]).toBe(0) // Player 0's spawn must not change
  })

  it('handles three players with one enemy too close (extra spawn available)', () => {
    const playerIds = [0, 1, 2]
    // 4 spawn positions available: 0 and 1 are too close; 2 and 3 are far
    const positions = [
      { col: 5,  row: 5  }, // spawn 0 — player 0
      { col: 7,  row: 5  }, // spawn 1 — player 1 (too close to spawn 0)
      { col: 60, row: 60 }, // spawn 2 — player 2
      { col: 60, row: 5  }, // spawn 3 — unused, far from spawn 0
    ]
    const assigned = [0, 1, 2]
    const result = enforceEnemySpawnSeparation(playerIds, positions, assigned, isEnemy)
    // Player 0 keeps spawn 0
    expect(result[0]).toBe(0)
    // Player 1 should be moved to a far spawn (spawn 3 is unused and far)
    const p1Spawn = positions[result[1]]
    const p0Spawn = positions[result[0]]
    const dist = Math.hypot(p1Spawn.col - p0Spawn.col, p1Spawn.row - p0Spawn.row)
    expect(dist).toBeGreaterThanOrEqual(ENEMY_SPAWN_MIN_SEPARATION)
  })

  it('returns same-length array as input', () => {
    const playerIds = [0, 1, 2, 3]
    const positions = Array.from({ length: 6 }, (_, i) => ({ col: i * 5, row: 0 }))
    const assigned = [0, 1, 2, 3]
    const result = enforceEnemySpawnSeparation(playerIds, positions, assigned, isEnemy)
    expect(result).toHaveLength(playerIds.length)
  })
})
