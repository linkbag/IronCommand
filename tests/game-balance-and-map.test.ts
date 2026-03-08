import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ORE_HARVEST_RATE, ORE_REGEN_RATE, TerrainType } from '../src/types'
import { isMapRevealEnabled } from '../src/scenes/skirmishConfig'

vi.mock('phaser', () => ({
  default: {
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    },
  },
}))

let generatePreviewData: typeof import('../src/engine/GameMap').generatePreviewData

beforeAll(async () => {
  ({ generatePreviewData } = await import('../src/engine/GameMap'))
})

function analyzeContinentalMap(seed: number): {
  waterRatio: number
  largestLandRatio: number
  inlandWaterRatio: number
} {
  const mapSize = 128
  const data = generatePreviewData(mapSize, mapSize, seed, 'continental')
  const { tiles } = data
  const width = mapSize
  const height = mapSize

  let waterTiles = 0
  let landTiles = 0
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (tiles[row][col].terrain === TerrainType.WATER) waterTiles++
      else landTiles++
    }
  }

  const visitedLand = new Uint8Array(width * height)
  let largestLand = 0
  const landQueue: Array<{ col: number; row: number }> = []
  const n4: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (tiles[row][col].terrain === TerrainType.WATER) continue
      const idx = row * width + col
      if (visitedLand[idx]) continue

      visitedLand[idx] = 1
      landQueue.push({ col, row })
      let componentSize = 0

      while (landQueue.length > 0) {
        const cur = landQueue.pop()!
        componentSize++
        for (const [dc, dr] of n4) {
          const nc = cur.col + dc
          const nr = cur.row + dr
          if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue
          if (tiles[nr][nc].terrain === TerrainType.WATER) continue
          const nIdx = nr * width + nc
          if (visitedLand[nIdx]) continue
          visitedLand[nIdx] = 1
          landQueue.push({ col: nc, row: nr })
        }
      }

      largestLand = Math.max(largestLand, componentSize)
    }
  }

  const visitedWater = new Uint8Array(width * height)
  const waterQueue: Array<{ col: number; row: number }> = []
  let inlandWaterTiles = 0

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (tiles[row][col].terrain !== TerrainType.WATER) continue
      const idx = row * width + col
      if (visitedWater[idx]) continue

      visitedWater[idx] = 1
      waterQueue.push({ col, row })
      const component: Array<{ col: number; row: number }> = []
      let touchesEdge = false

      while (waterQueue.length > 0) {
        const cur = waterQueue.pop()!
        component.push(cur)
        if (cur.col === 0 || cur.row === 0 || cur.col === width - 1 || cur.row === height - 1) {
          touchesEdge = true
        }
        for (const [dc, dr] of n4) {
          const nc = cur.col + dc
          const nr = cur.row + dr
          if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue
          if (tiles[nr][nc].terrain !== TerrainType.WATER) continue
          const nIdx = nr * width + nc
          if (visitedWater[nIdx]) continue
          visitedWater[nIdx] = 1
          waterQueue.push({ col: nc, row: nr })
        }
      }

      if (!touchesEdge) inlandWaterTiles += component.length
    }
  }

  return {
    waterRatio: waterTiles / (width * height),
    largestLandRatio: largestLand / Math.max(1, landTiles),
    inlandWaterRatio: inlandWaterTiles / (width * height),
  }
}

describe('continental map generation balance', () => {
  it('keeps water share moderate and land largely connected across fixed seeds', () => {
    const seeds = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1111, 2222, 3333]
    for (const seed of seeds) {
      const metrics = analyzeContinentalMap(seed)
      expect(metrics.waterRatio).toBeLessThan(0.42)
      expect(metrics.largestLandRatio).toBeGreaterThan(0.93)
      expect(metrics.inlandWaterRatio).toBeLessThan(0.025)
    }
  })
})

describe('pre-game map visibility config', () => {
  it('enables full reveal only for all-visible mode (or legacy revealMap)', () => {
    expect(isMapRevealEnabled({ mapVisibility: 'fog' })).toBe(false)
    expect(isMapRevealEnabled({ mapVisibility: 'allVisible' })).toBe(true)
    expect(isMapRevealEnabled({ mapVisibility: 'fog', revealMap: true })).toBe(true)
  })
})

describe('ore recovery tuning', () => {
  it('sets ore recovery to 2% of ore miner extraction per tick', () => {
    expect(ORE_REGEN_RATE).toBe(2)
    expect(ORE_REGEN_RATE).toBe(ORE_HARVEST_RATE * 0.02)
  })
})
