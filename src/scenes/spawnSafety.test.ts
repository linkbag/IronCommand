import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HOME_BASE_RADIUS_TILES,
  MIN_OPPOSING_START_SEPARATION_TILES,
  isCrossTeamPlacementInEnemyHomeRadius,
  pickBestSpawnCandidateIndex,
  validateOpposingStartZoneSeparation,
} from './spawnSafety.ts'
import type { PlayerStartZone, SpawnCandidate } from './spawnSafety.ts'

function makeEnemyResolver(alliedPairs: Array<[number, number]>) {
  const keys = new Set(alliedPairs.map(([a, b]) => `${Math.min(a, b)}|${Math.max(a, b)}`))
  return (playerA: number, playerB: number): boolean => {
    if (playerA === playerB) return false
    const key = `${Math.min(playerA, playerB)}|${Math.max(playerA, playerB)}`
    return !keys.has(key)
  }
}

test('validateOpposingStartZoneSeparation only flags enemy conflicts', () => {
  const zones: PlayerStartZone[] = [
    { playerId: 0, tile: { col: 10, row: 10 }, spawnIndex: 0 },
    { playerId: 1, tile: { col: 20, row: 10 }, spawnIndex: 1 },
    { playerId: 2, tile: { col: 24, row: 10 }, spawnIndex: 2 },
  ]
  const isEnemy = makeEnemyResolver([[0, 1]])

  const conflicts = validateOpposingStartZoneSeparation(
    zones,
    isEnemy,
    MIN_OPPOSING_START_SEPARATION_TILES,
  )

  assert.equal(conflicts.length, 2)
  const pairKeys = new Set(conflicts.map((c) => `${Math.min(c.playerAId, c.playerBId)}-${Math.max(c.playerAId, c.playerBId)}`))
  assert.equal(pairKeys.has('0-2'), true)
  assert.equal(pairKeys.has('1-2'), true)
})

test('isCrossTeamPlacementInEnemyHomeRadius blocks enemy placement but allows ally placement', () => {
  const zones: PlayerStartZone[] = [
    { playerId: 0, tile: { col: 16, row: 16 }, spawnIndex: 0 },
    { playerId: 1, tile: { col: 40, row: 40 }, spawnIndex: 1 },
  ]
  const allyResolver = makeEnemyResolver([[0, 1]])
  const enemyResolver = makeEnemyResolver([])

  const targetTiles = [{ col: 17, row: 16 }]

  assert.equal(
    isCrossTeamPlacementInEnemyHomeRadius(1, targetTiles, zones, enemyResolver, HOME_BASE_RADIUS_TILES),
    true,
  )
  assert.equal(
    isCrossTeamPlacementInEnemyHomeRadius(1, targetTiles, zones, allyResolver, HOME_BASE_RADIUS_TILES),
    false,
  )
})

test('pickBestSpawnCandidateIndex enforces min enemy separation and keeps ally near local zone', () => {
  const assignedZones: PlayerStartZone[] = [
    { playerId: 0, tile: { col: 10, row: 10 }, spawnIndex: 0 },
    { playerId: 2, tile: { col: 40, row: 10 }, spawnIndex: 1 },
  ]
  const candidates: SpawnCandidate[] = [
    { index: 10, tile: { col: 14, row: 10 } },
    { index: 11, tile: { col: 34, row: 10 } },
    { index: 12, tile: { col: 25, row: 25 } },
  ]
  const isEnemy = makeEnemyResolver([[0, 1]])

  const chosen = pickBestSpawnCandidateIndex(
    1,
    candidates,
    assignedZones,
    isEnemy,
    0,
    MIN_OPPOSING_START_SEPARATION_TILES,
  )

  assert.equal(chosen, 10)
})
