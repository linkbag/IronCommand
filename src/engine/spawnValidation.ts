// ============================================================
// IRON COMMAND — Spawn Validation
// Pure functions for home-base protection and start-zone separation.
// Used by GameScene at game start to validate/relocate initial entity
// placements and ensure no enemy units/buildings spawn inside a
// player's protected home-base zone.
// ============================================================

/** Tile radius around each player's spawn centre that is their protected home base. */
export const HOME_BASE_RADIUS_TILES = 10

/**
 * Minimum Euclidean tile distance required between two enemy players' spawn points.
 * Set to 2× the home-base radius so their protected zones never overlap.
 */
export const ENEMY_SPAWN_MIN_SEPARATION = HOME_BASE_RADIUS_TILES * 2

/** A spawn-point associated with a specific player. */
export interface SpawnInfo {
  col: number
  row: number
  playerId: number
}

/**
 * Returns true when tile (col, row) is inside the home-base protection zone
 * of the given spawn point (Chebyshev / square distance check).
 */
export function isInHomeBase(
  col: number,
  row: number,
  spawnCol: number,
  spawnRow: number,
  radius = HOME_BASE_RADIUS_TILES,
): boolean {
  return Math.abs(col - spawnCol) <= radius && Math.abs(row - spawnRow) <= radius
}

/**
 * Returns true when tile (col, row) falls inside ANY of the supplied enemy
 * spawn zones.
 */
export function isInAnyEnemyBase(
  col: number,
  row: number,
  enemySpawns: ReadonlyArray<{ col: number; row: number }>,
  radius = HOME_BASE_RADIUS_TILES,
): boolean {
  return enemySpawns.some(s => isInHomeBase(col, row, s.col, s.row, radius))
}

/**
 * If (col, row) lands inside an enemy home base, walk outward from the
 * player's OWN spawn centre to find the nearest tile that is NOT inside any
 * enemy base and is within the map bounds.
 *
 * Returns the original position unchanged when it is already valid.
 */
export function relocateTileFromEnemyBases(
  col: number,
  row: number,
  ownSpawnCol: number,
  ownSpawnRow: number,
  enemySpawns: ReadonlyArray<{ col: number; row: number }>,
  mapW: number,
  mapH: number,
  radius = HOME_BASE_RADIUS_TILES,
): { col: number; row: number } {
  if (!isInAnyEnemyBase(col, row, enemySpawns, radius)) {
    return { col, row }
  }

  // Spiral outward from own spawn until we find a safe tile
  const maxSearch = Math.max(mapW, mapH)
  for (let r = 1; r <= maxSearch; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue // border ring only
        const nc = ownSpawnCol + dc
        const nr = ownSpawnRow + dr
        if (nc < 1 || nc >= mapW - 1 || nr < 1 || nr >= mapH - 1) continue
        if (!isInAnyEnemyBase(nc, nr, enemySpawns, radius)) {
          return { col: nc, row: nr }
        }
      }
    }
  }

  return { col, row } // Couldn't relocate — return original (map too small)
}

/**
 * Checks that every enemy player pair has spawn points at least
 * `minSeparation` tiles apart (Euclidean).
 *
 * Returns an array of violation descriptors; an empty array means the
 * assignment is fully valid.
 */
export function validateSpawnSeparation(
  spawns: ReadonlyArray<SpawnInfo>,
  isEnemy: (a: number, b: number) => boolean,
  minSeparation = ENEMY_SPAWN_MIN_SEPARATION,
): Array<{ playerA: number; playerB: number; distance: number; required: number }> {
  const violations: Array<{ playerA: number; playerB: number; distance: number; required: number }> = []
  for (let i = 0; i < spawns.length; i++) {
    for (let j = i + 1; j < spawns.length; j++) {
      const a = spawns[i]
      const b = spawns[j]
      if (!isEnemy(a.playerId, b.playerId)) continue
      const dist = Math.hypot(a.col - b.col, a.row - b.row)
      if (dist < minSeparation) {
        violations.push({ playerA: a.playerId, playerB: b.playerId, distance: dist, required: minSeparation })
      }
    }
  }
  return violations
}

/**
 * Attempts to fix cross-team spawn-assignment conflicts by swapping the
 * spawn index of an enemy player with another unused (or less-contested) spawn
 * that is farther away.
 *
 * - `playerIds[i]` corresponds to `assignedIndices[i]`.
 * - `spawnPositions` is the full ordered list of map start positions (as tile coords).
 * - Returns a new index array (same length) with improved assignments.
 *
 * Player 0's assignment (index 0) is never changed; it reflects the human
 * player's chosen spawn.
 */
export function enforceEnemySpawnSeparation(
  playerIds: ReadonlyArray<number>,
  spawnPositions: ReadonlyArray<{ col: number; row: number }>,
  assignedIndices: ReadonlyArray<number>,
  isEnemy: (a: number, b: number) => boolean,
  minSeparation = ENEMY_SPAWN_MIN_SEPARATION,
): number[] {
  const result = [...assignedIndices]

  // Multiple passes in case one swap creates a new violation elsewhere
  for (let pass = 0; pass < playerIds.length; pass++) {
    let changed = false
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        if (!isEnemy(playerIds[i], playerIds[j])) continue
        const pi = spawnPositions[result[i]]
        const pj = spawnPositions[result[j]]
        if (!pi || !pj) continue
        const dist = Math.hypot(pi.col - pj.col, pi.row - pj.row)
        if (dist >= minSeparation) continue

        // Violation: try swapping j's spawn with a farther unused one.
        // Never touch i===0 (human player's preferred spawn).
        const targetIdx = i === 0 ? j : j // prefer moving the later player
        const used = new Set(result)
        for (let k = 0; k < spawnPositions.length; k++) {
          if (used.has(k) && k !== result[targetIdx]) continue
          const pk = spawnPositions[k]
          if (!pk) continue
          const newDist = Math.hypot(pi.col - pk.col, pi.row - pk.row)
          if (newDist >= minSeparation) {
            result[targetIdx] = k
            changed = true
            break
          }
        }
      }
    }
    if (!changed) break
  }

  return result
}
