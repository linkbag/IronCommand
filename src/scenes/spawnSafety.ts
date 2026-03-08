import type { TileCoord } from '../types'

export const HOME_BASE_RADIUS_TILES = 10
export const MIN_OPPOSING_START_SEPARATION_TILES = HOME_BASE_RADIUS_TILES * 2 + 2
export const START_ZONE_SCAN_MARGIN_TILES = 6

export interface PlayerStartZone {
  playerId: number
  tile: TileCoord
  spawnIndex: number
}

export interface SpawnCandidate {
  index: number
  tile: TileCoord
}

export interface OpposingStartConflict {
  playerAId: number
  playerBId: number
  distanceTiles: number
}

export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.hypot(a.col - b.col, a.row - b.row)
}

export function isTileInHomeRadius(tile: TileCoord, homeTile: TileCoord, homeRadiusTiles = HOME_BASE_RADIUS_TILES): boolean {
  return tileDistance(tile, homeTile) <= homeRadiusTiles
}

export function isCrossTeamPlacementInEnemyHomeRadius(
  ownerPlayerId: number,
  placementTiles: TileCoord[],
  startZones: PlayerStartZone[],
  areEnemies: (playerA: number, playerB: number) => boolean,
  homeRadiusTiles = HOME_BASE_RADIUS_TILES,
): boolean {
  for (const zone of startZones) {
    if (!areEnemies(ownerPlayerId, zone.playerId)) continue
    for (const tile of placementTiles) {
      if (isTileInHomeRadius(tile, zone.tile, homeRadiusTiles)) return true
    }
  }
  return false
}

export function validateOpposingStartZoneSeparation(
  startZones: PlayerStartZone[],
  areEnemies: (playerA: number, playerB: number) => boolean,
  minSeparationTiles = MIN_OPPOSING_START_SEPARATION_TILES,
): OpposingStartConflict[] {
  const conflicts: OpposingStartConflict[] = []
  for (let i = 0; i < startZones.length; i++) {
    for (let j = i + 1; j < startZones.length; j++) {
      const a = startZones[i]
      const b = startZones[j]
      if (!areEnemies(a.playerId, b.playerId)) continue
      const distanceTiles = tileDistance(a.tile, b.tile)
      if (distanceTiles < minSeparationTiles) {
        conflicts.push({ playerAId: a.playerId, playerBId: b.playerId, distanceTiles })
      }
    }
  }
  return conflicts
}

export function pickBestSpawnCandidateIndex(
  playerId: number,
  availableCandidates: SpawnCandidate[],
  assignedZones: PlayerStartZone[],
  areEnemies: (playerA: number, playerB: number) => boolean,
  localPlayerId: number,
  minEnemySeparationTiles = MIN_OPPOSING_START_SEPARATION_TILES,
): number | null {
  let bestIndex: number | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  const localZone = assignedZones.find((z) => z.playerId === localPlayerId)

  for (const candidate of availableCandidates) {
    let nearestEnemy = Number.POSITIVE_INFINITY
    let nearestAlly = Number.POSITIVE_INFINITY
    let nearestAny = Number.POSITIVE_INFINITY
    let valid = true

    for (const zone of assignedZones) {
      const d = tileDistance(candidate.tile, zone.tile)
      nearestAny = Math.min(nearestAny, d)
      if (areEnemies(playerId, zone.playerId)) {
        nearestEnemy = Math.min(nearestEnemy, d)
        if (d < minEnemySeparationTiles) {
          valid = false
          break
        }
      } else {
        nearestAlly = Math.min(nearestAlly, d)
      }
    }

    if (!valid) continue

    const enemyScore = Number.isFinite(nearestEnemy) ? nearestEnemy * 15 : 120
    const spreadScore = Number.isFinite(nearestAny) ? nearestAny * 2 : 0
    let score = enemyScore + spreadScore

    if (localZone && playerId !== localPlayerId) {
      const localDist = tileDistance(candidate.tile, localZone.tile)
      if (areEnemies(playerId, localPlayerId)) {
        score += localDist * 4
      } else {
        score += Math.max(0, 50 - localDist * 2)
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestIndex = candidate.index
    }
  }

  return bestIndex
}
