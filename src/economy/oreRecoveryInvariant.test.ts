// ============================================================
// Ore Recovery Invariant Tests
// Verifies the hard-lock: ore recovery = 0.5% of mining speed
// Run with: npm test  (vitest)
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORE_HARVEST_RATE, ORE_RECOVERY_RATIO, ORE_REGEN_RATE } from '../types'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('ore recovery invariant', () => {
  it('ORE_RECOVERY_RATIO is hard-locked to 0.5%', () => {
    expect(ORE_RECOVERY_RATIO).toBe(0.005)
  })

  it('ORE_REGEN_RATE is derived from ORE_HARVEST_RATE * ORE_RECOVERY_RATIO', () => {
    expect(ORE_REGEN_RATE).toBe(ORE_HARVEST_RATE * ORE_RECOVERY_RATIO)
  })

  it('ORE_REGEN_RATE is exactly 0.5% of ORE_HARVEST_RATE', () => {
    expect(ORE_REGEN_RATE / ORE_HARVEST_RATE).toBe(0.005)
  })

  it('GameMap ore recovery has no local override paths (no adjacentBonus)', () => {
    const gameMapSource = readFileSync(resolve(__dirname, '../engine/GameMap.ts'), 'utf8')

    // adjacentBonus regen override must NOT be present (would conflict with 0.5% spec)
    expect(gameMapSource).not.toContain('adjacentBonus')
    expect(gameMapSource).not.toContain('Math.floor(ORE_REGEN_RATE')
  })
})
