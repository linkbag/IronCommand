import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORE_HARVEST_RATE, ORE_RECOVERY_RATIO, ORE_REGEN_RATE } from '../types'

test('ore recovery is hard-locked to 1% of ore miner mining speed', () => {
  assert.equal(ORE_RECOVERY_RATIO, 0.01)
  assert.equal(ORE_REGEN_RATE, ORE_HARVEST_RATE * ORE_RECOVERY_RATIO)
  assert.equal(ORE_REGEN_RATE / ORE_HARVEST_RATE, 0.01)
})

test('GameMap ore recovery has no local override paths', () => {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const gameMapSource = readFileSync(resolve(thisDir, '../engine/GameMap.ts'), 'utf8')

  const regenApplications =
    gameMapSource.match(/tile\.oreAmount = Math\.min\(maxAmt, tile\.oreAmount \+ ORE_REGEN_RATE\)/g)?.length ?? 0

  assert.equal(regenApplications, 1)
  assert.equal(gameMapSource.includes('adjacentBonus'), false)
  assert.equal(gameMapSource.includes('Math.floor(ORE_REGEN_RATE'), false)
  assert.equal(gameMapSource.includes('regenerateDepletedOre'), false)
})
