import Phaser from 'phaser'
import {
  TerrainType,
  FogState,
  TILE_SIZE,
  MAP_DEFAULT_WIDTH,
  MAP_DEFAULT_HEIGHT,
  ORE_TILE_MAX,
  GEMS_TILE_MAX,
  ORE_REGEN_RATE,
} from '../types'
import type { TileData, GameMap as GameMapData, Position, TileCoord } from '../types'

// ── Terrain color palette ─────────────────────────────────────

const TERRAIN_COLORS: Record<TerrainType, number[]> = {
  [TerrainType.GRASS]:  [0x4a7c3f, 0x3d6b33, 0x568a46, 0x4a7c3f],
  [TerrainType.WATER]:  [0x1a6fa8, 0x1558a0, 0x2080b8, 0x1a6fa8],
  [TerrainType.ORE]:    [0xd4a017, 0xc8960c, 0xe0b020, 0xd4a017],
  [TerrainType.ROCK]:   [0x7a7a7a, 0x686868, 0x8a8a8a, 0x7a7a7a],
  [TerrainType.SAND]:   [0xd2b48c, 0xc8a87a, 0xdcc099, 0xd2b48c],
  [TerrainType.ROAD]:   [0x555555, 0x4a4a4a, 0x606060, 0x555555],
  [TerrainType.BRIDGE]: [0x8b6914, 0x7a5c10, 0x9c7a18, 0x8b6914],
  [TerrainType.FOREST]: [0x1e4d1a, 0x183d14, 0x265a20, 0x1e4d1a],
  [TerrainType.GEMS]:   [0x2a8aff, 0x2070dd, 0x40a0ff, 0x2a8aff],
}

const FOG_ALPHA: Record<FogState, number> = {
  [FogState.HIDDEN]:   1.0,
  [FogState.EXPLORED]: 0.5,
  [FogState.VISIBLE]:  0.0,
}

const ORE_MAX_AMOUNT = ORE_TILE_MAX
const ORE_SPREAD_INTERVAL_MS = 30000
const ORE_GROWTH_INTERVAL_MS = 6000  // regenerate every 6s (50 units/tick = ~500/min)

function scaleColor(color: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)))
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)))
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)))
  return (r << 16) | (g << 8) | b
}

/** Linearly interpolate between two colors. t=0 → colorA, t=1 → colorB */
function lerpColor(colorA: number, colorB: number, t: number): number {
  const rA = (colorA >> 16) & 0xff, gA = (colorA >> 8) & 0xff, bA = colorA & 0xff
  const rB = (colorB >> 16) & 0xff, gB = (colorB >> 8) & 0xff, bB = colorB & 0xff
  const r = Math.round(rA + (rB - rA) * t)
  const g = Math.round(gA + (gB - gA) * t)
  const b = Math.round(bA + (bB - bA) * t)
  return (r << 16) | (g << 8) | b
}

// ── Map Generator ─────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Minimal seeded pseudo-random number generator (mulberry32) */
function makePRNG(seed: number) {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff
  }
}

/** Simple 2D Perlin-like noise using value noise + interpolation */
class ValueNoise {
  private table: number[]
  constructor(private seed: number, private size = 256) {
    const rng = makePRNG(seed)
    this.table = Array.from({ length: size * size }, () => rng())
  }
  sample(x: number, y: number): number {
    const ix = Math.floor(x) & (this.size - 1)
    const iy = Math.floor(y) & (this.size - 1)
    const fx = x - Math.floor(x)
    const fy = y - Math.floor(y)
    const ix1 = (ix + 1) & (this.size - 1)
    const iy1 = (iy + 1) & (this.size - 1)
    const a = this.table[iy * this.size + ix]
    const b = this.table[iy * this.size + ix1]
    const c = this.table[iy1 * this.size + ix]
    const d = this.table[iy1 * this.size + ix1]
    const sx = smoothstep(fx)
    const sy = smoothstep(fy)
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy)
  }
  /** Fractal (octave) noise */
  fractal(x: number, y: number, octaves = 4): number {
    let v = 0, amp = 0.5, freq = 1, max = 0
    for (let i = 0; i < octaves; i++) {
      v += this.sample(x * freq, y * freq) * amp
      max += amp
      amp *= 0.5
      freq *= 2
    }
    return v / max
  }
}

function generateMapData(
  width = MAP_DEFAULT_WIDTH,
  height = MAP_DEFAULT_HEIGHT,
  seed = 12345,
): GameMapData {
  const rng = makePRNG(seed)
  const noise = new ValueNoise(seed)
  const waterNoise = new ValueNoise(seed + 1)
  const forestNoise = new ValueNoise(seed + 2)

  const scale = 0.03  // controls terrain feature size

  // Build base tile grid
  const tiles: TileData[][] = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      const n = noise.fractal(col * scale, row * scale)
      const w = waterNoise.fractal(col * scale * 1.5, row * scale * 1.5)
      const f = forestNoise.fractal(col * scale * 2, row * scale * 2)

      let terrain: TerrainType
      let passable = true
      let buildable = true

      if (w > 0.72) {
        terrain = TerrainType.WATER
        passable = false
        buildable = false
      } else if (n > 0.7) {
        terrain = TerrainType.ROCK
        passable = false
        buildable = false
      } else if (n < 0.25) {
        terrain = TerrainType.SAND
      } else if (f > 0.68) {
        terrain = TerrainType.FOREST
        buildable = false
      } else {
        terrain = TerrainType.GRASS
      }

      return {
        terrain,
        passable,
        buildable,
        oreAmount: 0,
        fogState: FogState.HIDDEN,
        occupiedBy: null,
      } satisfies TileData
    })
  )

  // Place ore patches (clusters of 5-10 tiles)
  const oreCount = Math.floor(width * height * 0.0008)
  for (let i = 0; i < oreCount; i++) {
    const cx = Math.floor(rng() * (width - 20)) + 10
    const cy = Math.floor(rng() * (height - 20)) + 10
    const clusterSize = 5 + Math.floor(rng() * 6)
    // ~20% chance this cluster is gems instead of ore
    const isGems = rng() < 0.2
    for (let j = 0; j < clusterSize; j++) {
      const dx = Math.floor((rng() - 0.5) * 8)
      const dy = Math.floor((rng() - 0.5) * 8)
      const tx = cx + dx, ty = cy + dy
      if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
        const tile = tiles[ty][tx]
        if (tile.terrain === TerrainType.GRASS || tile.terrain === TerrainType.SAND) {
          tile.terrain = isGems ? TerrainType.GEMS : TerrainType.ORE
          tile.oreAmount = isGems ? GEMS_TILE_MAX : ORE_TILE_MAX
          // Ore/gem tiles stay passable so harvesters can reach them
          tile.buildable = false
        }
      }
    }
  }

  // Carve simple river (horizontal or vertical stripe with water noise)
  const riverRow = Math.floor(height * 0.3 + rng() * height * 0.4)
  const riverWave = 6
  for (let col = 0; col < width; col++) {
    const offset = Math.floor(Math.sin(col * 0.08) * riverWave)
    for (let r = riverRow + offset - 1; r <= riverRow + offset + 1; r++) {
      if (r >= 0 && r < height) {
        tiles[r][col].terrain = TerrainType.WATER
        tiles[r][col].passable = false
        tiles[r][col].buildable = false
        tiles[r][col].oreAmount = 0
      }
    }
  }

  // Place a couple of bridges across the river
  const bridgeCols = [
    Math.floor(width * 0.25),
    Math.floor(width * 0.5),
    Math.floor(width * 0.75),
  ]
  for (const bc of bridgeCols) {
    const offset = Math.floor(Math.sin(bc * 0.08) * riverWave)
    for (let r = riverRow + offset - 1; r <= riverRow + offset + 1; r++) {
      if (r >= 0 && r < height) {
        tiles[r][bc].terrain = TerrainType.BRIDGE
        tiles[r][bc].passable = true
        tiles[r][bc].buildable = false
      }
    }
  }

  // Compute start positions — spread around map edges
  const startPositions: Position[] = computeStartPositions(width, height, 8)

  // Clear terrain around start positions (make them buildable grass)
  for (const sp of startPositions) {
    const radius = 5
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = Math.floor(sp.x / TILE_SIZE) + dx
        const ty = Math.floor(sp.y / TILE_SIZE) + dy
        if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
          tiles[ty][tx].terrain = TerrainType.GRASS
          tiles[ty][tx].passable = true
          tiles[ty][tx].buildable = true
          tiles[ty][tx].oreAmount = 0
        }
      }
    }
  }

  // Guarantee a reachable ore field near each spawn so the opening harvester loop
  // is reliable regardless of random ore cluster generation.
  for (const sp of startPositions) {
    const spCol = Math.floor(sp.x / TILE_SIZE)
    const spRow = Math.floor(sp.y / TILE_SIZE)
    const centerMapCol = Math.floor(width / 2)
    const centerMapRow = Math.floor(height / 2)

    const dirCol = spCol <= centerMapCol ? 1 : -1
    const dirRow = spRow <= centerMapRow ? 1 : -1

    const oreCol = Phaser.Math.Clamp(spCol + dirCol * 12, 4, width - 5)
    const oreRow = Phaser.Math.Clamp(spRow + dirRow * 10, 4, height - 5)

    const oreRadius = 3
    for (let dr = -oreRadius; dr <= oreRadius; dr++) {
      for (let dc = -oreRadius; dc <= oreRadius; dc++) {
        if (dc * dc + dr * dr > oreRadius * oreRadius) continue
        const tc = oreCol + dc
        const tr = oreRow + dr
        if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue

        const t = tiles[tr][tc]
        t.terrain = TerrainType.ORE
        t.oreAmount = ORE_TILE_MAX
        t.passable = true
        t.buildable = false
      }
    }
  }

  return {
    name: `Procedural Map ${seed}`,
    width,
    height,
    tileSize: TILE_SIZE,
    tiles,
    startPositions,
  }
}

function computeStartPositions(w: number, h: number, count: number): Position[] {
  const positions: Position[] = []
  const margin = 6
  const candidateEdge: Position[] = []
  // Top and bottom edges
  for (let i = 0; i < count / 2; i++) {
    const col = margin + Math.floor((w - margin * 2) * i / (count / 2 - 1 || 1))
    candidateEdge.push({ x: col * TILE_SIZE, y: margin * TILE_SIZE })
    candidateEdge.push({ x: col * TILE_SIZE, y: (h - margin) * TILE_SIZE })
  }
  // Pick evenly spread
  for (let i = 0; i < Math.min(count, candidateEdge.length); i++) {
    positions.push(candidateEdge[i])
  }
  return positions.slice(0, count)
}

// ── GameMap class ─────────────────────────────────────────────

export class GameMap {
  readonly data: GameMapData
  private fogLayer: Phaser.GameObjects.Graphics
  private terrainGraphics: Phaser.GameObjects.Graphics
  private scene: Phaser.Scene
  private dirtyFogCells: Set<number> = new Set()
  private renderedTiles = false
  private animLayer: Phaser.GameObjects.Graphics
  private waterTiles: { col: number; row: number }[] = []
  private oreTiles: { col: number; row: number }[] = []
  private animFrame = 0
  private oreSpreadTimerMs = 0
  private oreGrowthTimerMs = 0
  private depletedOreTiles: Set<number> = new Set()

  constructor(scene: Phaser.Scene, width?: number, height?: number, seed?: number) {
    this.scene = scene
    this.data = generateMapData(width, height, seed)
    this.terrainGraphics = scene.add.graphics()
    this.animLayer = scene.add.graphics()
    this.fogLayer = scene.add.graphics()
    this.terrainGraphics.setDepth(0)
    this.animLayer.setDepth(1)
    this.fogLayer.setDepth(10)
  }

  // ── Rendering ────────────────────────────────────────────────

  /** Full terrain render — call once after creation */
  renderTerrain(): void {
    if (this.renderedTiles) return
    this.renderedTiles = true
    const g = this.terrainGraphics
    g.clear()
    const { tiles, width, height } = this.data
    this.waterTiles = []
    this.oreTiles = []

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const color = this.tileColor(tile, col, row)
        const px = col * TILE_SIZE
        const py = row * TILE_SIZE

        g.fillStyle(color)
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE)

        switch (tile.terrain) {
          case TerrainType.GRASS:
            this.drawGrassDetail(g, px, py, col, row)
            break
          case TerrainType.WATER:
            this.waterTiles.push({ col, row })
            this.drawWaterEdge(g, px, py, col, row)
            break
          case TerrainType.ORE:
          case TerrainType.GEMS:
            this.oreTiles.push({ col, row })
            this.drawOreDetail(g, px, py, col, row, tile.oreAmount)
            break
          case TerrainType.FOREST:
            this.drawForestDetail(g, px, py, col, row)
            break
          case TerrainType.BRIDGE:
            this.drawBridgeDetail(g, px, py)
            break
          case TerrainType.SAND:
            this.drawSandDetail(g, px, py, col, row)
            break
          case TerrainType.ROCK:
            this.drawRockDetail(g, px, py, col, row)
            break
        }
      }
    }

    this.setupAnimations()
  }

  /** Render fog of war layer — always does a full clear+redraw for correctness */
  renderFog(_fullRedraw = false): void {
    // Always full redraw — partial updates leave stale black tiles
    this.renderFogFull()
    this.dirtyFogCells.clear()
  }

  private renderFogFull(): void {
    const g = this.fogLayer
    g.clear()
    const { tiles, width, height } = this.data
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const alpha = FOG_ALPHA[tile.fogState]
        if (alpha > 0) {
          g.fillStyle(0x000000, alpha)
          g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        }
      }
    }
  }

  private tileColor(tile: TileData, col: number, row: number): number {
    const colors = TERRAIN_COLORS[tile.terrain]
    if (!colors) return 0x4a7c3f // fallback grass
    const base = colors[(col + row) % colors.length]
    if (tile.terrain !== TerrainType.ORE && tile.terrain !== TerrainType.GEMS) return base
    const maxAmt = tile.terrain === TerrainType.GEMS ? GEMS_TILE_MAX : ORE_TILE_MAX
    const ratio = Phaser.Math.Clamp(tile.oreAmount / maxAmt, 0, 1)
    // Lerp from grass green (depleted) → ore yellow (full)
    // Full ore = base ore color, depleted = grass green
    const grassColor = 0x4a7c3f
    return lerpColor(grassColor, base, ratio)
  }

  /** Deterministic hash for per-tile details */
  private tileHash(col: number, row: number, salt = 0): number {
    let h = ((col * 374761393 + row * 668265263 + salt) | 0) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 0xffffffff
  }

  private drawGrassDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    // Pebbles: 2-3 small darker spots
    const pebbleCount = 2 + Math.floor(this.tileHash(col, row, 1) * 2)
    for (let i = 0; i < pebbleCount; i++) {
      const dx = this.tileHash(col, row, 10 + i) * 26 + 3
      const dy = this.tileHash(col, row, 20 + i) * 26 + 3
      g.fillStyle(0x2d5a25, 0.5)
      g.fillRect(px + dx, py + dy, 2, 2)
    }
    // Occasional grass tuft
    if (this.tileHash(col, row, 30) > 0.5) {
      const tx = this.tileHash(col, row, 31) * 22 + 5
      const ty = this.tileHash(col, row, 32) * 18 + 10
      g.lineStyle(1, 0x2d5a25, 0.6)
      g.lineBetween(px + tx, py + ty, px + tx - 1, py + ty - 4)
      g.lineBetween(px + tx + 3, py + ty, px + tx + 4, py + ty - 3)
    }
  }

  private drawWaterEdge(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const { tiles, width, height } = this.data
    const edgeColor = 0x4499cc
    // Lighter border where water meets land
    if (row > 0 && tiles[row - 1][col].terrain !== TerrainType.WATER) {
      g.fillStyle(edgeColor, 0.45)
      g.fillRect(px, py, TILE_SIZE, 3)
    }
    if (row < height - 1 && tiles[row + 1][col].terrain !== TerrainType.WATER) {
      g.fillStyle(edgeColor, 0.45)
      g.fillRect(px, py + TILE_SIZE - 3, TILE_SIZE, 3)
    }
    if (col > 0 && tiles[row][col - 1].terrain !== TerrainType.WATER) {
      g.fillStyle(edgeColor, 0.45)
      g.fillRect(px, py, 3, TILE_SIZE)
    }
    if (col < width - 1 && tiles[row][col + 1].terrain !== TerrainType.WATER) {
      g.fillStyle(edgeColor, 0.45)
      g.fillRect(px + TILE_SIZE - 3, py, 3, TILE_SIZE)
    }
  }

  private drawOreDetail(
    g: Phaser.GameObjects.Graphics,
    px: number,
    py: number,
    col: number,
    row: number,
    oreAmount: number,
  ): void {
    const tile = this.getTile(col, row)
    const maxAmt = (tile && tile.terrain === TerrainType.GEMS) ? GEMS_TILE_MAX : ORE_TILE_MAX
    const ratio = Phaser.Math.Clamp(oreAmount / maxAmt, 0, 1)
    if (ratio < 0.05) return // Too depleted — just show grass color, no ore detail
    // Metallic veins — fade with depletion
    const veinColor = lerpColor(0x5a7a40, 0xb8860b, ratio) // green-ish → gold
    g.lineStyle(1, veinColor, 0.1 + ratio * 0.6)
    const vx = this.tileHash(col, row, 110) * 14 + 4
    const vy = this.tileHash(col, row, 111) * 14 + 4
    g.lineBetween(px + vx, py + vy, px + vx + 10, py + vy + 6)
    // Small nugget shapes — fewer and dimmer when depleted
    const nuggetColor = lerpColor(0x6a8a4a, 0xe8c020, ratio) // green-ish → gold
    g.fillStyle(nuggetColor, 0.1 + ratio * 0.7)
    const nx = this.tileHash(col, row, 112) * 22 + 5
    const ny = this.tileHash(col, row, 113) * 22 + 5
    g.fillRect(px + nx, py + ny, 3, 2)
    if (ratio > 0.3) g.fillRect(px + nx + 8, py + ny + 4, 2, 3) // Second nugget only when ore is decent
  }

  private drawForestDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const treeCount = 2 + Math.floor(this.tileHash(col, row, 40) * 2)
    for (let i = 0; i < treeCount; i++) {
      const tx = this.tileHash(col, row, 50 + i) * 18 + 7
      const ty = this.tileHash(col, row, 60 + i) * 14 + 9
      // Shadow underneath
      g.fillStyle(0x0a1a08, 0.35)
      g.fillEllipse(px + tx, py + ty + 4, 8, 4)
      // Tree canopy
      g.fillStyle(0x1a4a16, 1)
      g.fillCircle(px + tx, py + ty, 5)
      // Highlight on top-left
      g.fillStyle(0x2a6a22, 0.5)
      g.fillCircle(px + tx - 1, py + ty - 2, 2)
    }
  }

  private drawBridgeDetail(g: Phaser.GameObjects.Graphics, px: number, py: number): void {
    // Plank lines
    g.lineStyle(1, 0x5a4010, 0.5)
    for (let y = 4; y < TILE_SIZE; y += 6) {
      g.lineBetween(px + 3, py + y, px + TILE_SIZE - 3, py + y)
    }
    // Railings on sides
    g.lineStyle(2, 0x4a3010, 0.7)
    g.lineBetween(px + 1, py, px + 1, py + TILE_SIZE)
    g.lineBetween(px + TILE_SIZE - 1, py, px + TILE_SIZE - 1, py + TILE_SIZE)
  }

  private drawSandDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const dotCount = 4 + Math.floor(this.tileHash(col, row, 70) * 4)
    for (let i = 0; i < dotCount; i++) {
      const dx = this.tileHash(col, row, 80 + i) * 28 + 2
      const dy = this.tileHash(col, row, 90 + i) * 28 + 2
      g.fillStyle(0xb8986a, 0.35)
      g.fillRect(px + dx, py + dy, 1, 1)
    }
  }

  private drawRockDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    // Cracks
    g.lineStyle(1, 0x555555, 0.4)
    const cx = this.tileHash(col, row, 100) * 18 + 6
    const cy = this.tileHash(col, row, 101) * 18 + 6
    g.lineBetween(px + cx, py + cy, px + cx + 8, py + cy + 5)
    // Lighter highlight spot
    g.fillStyle(0x999999, 0.25)
    const hx = this.tileHash(col, row, 102) * 22 + 5
    const hy = this.tileHash(col, row, 103) * 22 + 5
    g.fillRect(px + hx, py + hy, 3, 3)
  }

  // ── Terrain Animation ──────────────────────────────────────────

  private setupAnimations(): void {
    this.scene.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        this.animFrame = (this.animFrame + 1) % 3
        this.renderAnimatedTiles()
      },
    })
  }

  private renderAnimatedTiles(): void {
    const g = this.animLayer
    g.clear()

    // Water shimmer
    const shimmerAlpha = [0.12, 0.0, 0.08][this.animFrame]
    for (const { col, row } of this.waterTiles) {
      const px = col * TILE_SIZE
      const py = row * TILE_SIZE
      // Shimmer overlay
      if (shimmerAlpha > 0) {
        g.fillStyle(0xffffff, shimmerAlpha)
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE)
      }
      // Sun reflection dots
      if (this.animFrame !== 1) {
        const dx = ((this.animFrame * 11 + col * 7) % 22) + 5
        const dy = ((this.animFrame * 13 + row * 5) % 22) + 5
        g.fillStyle(0xffffff, 0.3)
        g.fillRect(px + dx, py + dy, 2, 2)
      }
    }

    // Ore/gem sparkle
    for (const { col, row } of this.oreTiles) {
      const tile = this.getTile(col, row)
      if (!tile || (tile.terrain !== TerrainType.ORE && tile.terrain !== TerrainType.GEMS) || tile.oreAmount <= 0) continue
      const maxAmt = tile.terrain === TerrainType.GEMS ? GEMS_TILE_MAX : ORE_TILE_MAX
      const ratio = Phaser.Math.Clamp(tile.oreAmount / maxAmt, 0, 1)
      const px = col * TILE_SIZE
      const py = row * TILE_SIZE
      const sx = ((this.animFrame * 9 + col * 13) % 24) + 4
      const sy = ((this.animFrame * 7 + row * 11) % 24) + 4
      g.fillStyle(0xffffff, 0.2 + ratio * 0.55)
      g.fillCircle(px + sx, py + sy, 1.5)
      // Second sparkle
      const sx2 = ((this.animFrame * 17 + col * 3) % 20) + 6
      const sy2 = ((this.animFrame * 19 + row * 7) % 20) + 6
      g.fillStyle(0xffff88, 0.1 + ratio * 0.45)
      g.fillCircle(px + sx2, py + sy2, 1)
    }
  }

  // ── Fog of War ────────────────────────────────────────────────

  /**
   * Update fog based on visible positions + sight radius.
   * Mark previously-VISIBLE tiles as EXPLORED, then reveal new area.
   */
  updateFog(visibleSources: Array<{ pos: TileCoord; range: number }>): void {
    const { tiles, width, height } = this.data

    // Reset VISIBLE → EXPLORED
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (tiles[row][col].fogState === FogState.VISIBLE) {
          tiles[row][col].fogState = FogState.EXPLORED
          this.dirtyFogCells.add(row * width + col)
        }
      }
    }

    // Reveal around each source
    for (const { pos, range } of visibleSources) {
      this.revealArea(pos.col, pos.row, range)
    }

    this.renderFog()
  }

  private revealArea(cx: number, cy: number, radius: number): void {
    const { tiles, width, height } = this.data
    const r2 = radius * radius
    const minCol = Math.max(0, cx - radius)
    const maxCol = Math.min(width - 1, cx + radius)
    const minRow = Math.max(0, cy - radius)
    const maxRow = Math.min(height - 1, cy + radius)

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dc = col - cx, dr = row - cy
        if (dc * dc + dr * dr <= r2) {
          const tile = tiles[row][col]
          if (tile.fogState !== FogState.VISIBLE) {
            tile.fogState = FogState.VISIBLE
            this.dirtyFogCells.add(row * width + col)
          }
        }
      }
    }
  }

  /** Reveal entire map (cheat / debug) */
  revealAll(): void {
    const { tiles, width, height } = this.data
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        tiles[row][col].fogState = FogState.VISIBLE
      }
    }
    this.renderFogFull()
  }

  // ── Tile Queries ──────────────────────────────────────────────

  getTile(col: number, row: number): TileData | null {
    const { tiles, width, height } = this.data
    if (col < 0 || col >= width || row < 0 || row >= height) return null
    return tiles[row][col]
  }

  worldToTile(worldX: number, worldY: number): TileCoord {
    return {
      col: Math.floor(worldX / TILE_SIZE),
      row: Math.floor(worldY / TILE_SIZE),
    }
  }

  tileToWorld(col: number, row: number): Position {
    return {
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    }
  }

  isPassable(col: number, row: number, isAir = false): boolean {
    const tile = this.getTile(col, row)
    if (!tile) return false
    return isAir ? true : tile.passable
  }

  isBuildable(col: number, row: number): boolean {
    const tile = this.getTile(col, row)
    if (!tile) return false
    return tile.buildable && tile.occupiedBy === null
  }

  setOccupied(col: number, row: number, entityId: string | null): void {
    const tile = this.getTile(col, row)
    if (tile) tile.occupiedBy = entityId
  }

  update(delta: number): void {
    this.oreSpreadTimerMs += delta
    this.oreGrowthTimerMs += delta

    if (this.oreSpreadTimerMs >= ORE_SPREAD_INTERVAL_MS) {
      this.oreSpreadTimerMs -= ORE_SPREAD_INTERVAL_MS
      this.regenerateDepletedOre()
    }

    if (this.oreGrowthTimerMs >= ORE_GROWTH_INTERVAL_MS) {
      this.oreGrowthTimerMs -= ORE_GROWTH_INTERVAL_MS
      this.regenerateExistingOre()
    }
  }

  harvestOreAt(col: number, row: number, amount = 100): number {
    const tile = this.getTile(col, row)
    if (!tile || (tile.terrain !== TerrainType.ORE && tile.terrain !== TerrainType.GEMS) || tile.oreAmount <= 0) return 0

    const isGems = tile.terrain === TerrainType.GEMS
    const extracted = Math.min(tile.oreAmount, amount)
    tile.oreAmount = Math.max(0, tile.oreAmount - extracted)

    if (tile.oreAmount <= 0) {
      // Fully depleted — becomes grass, does NOT regenerate
      tile.terrain = TerrainType.GRASS
      tile.oreAmount = 0
      tile.passable = true
      tile.buildable = true
      // Don't add to depletedOreTiles — fully depleted tiles don't regen
      this.removeOreTile(col, row)
    } else {
      // Partially depleted — track for regeneration
      this.depletedOreTiles.add(this.key(col, row))
    }

    this.redrawTile(col, row)
    this.renderAnimatedTiles()
    return isGems ? extracted * 2 : extracted // gems worth 2x
  }

  getOreRichness(col: number, row: number): number {
    const tile = this.getTile(col, row)
    if (!tile || (tile.terrain !== TerrainType.ORE && tile.terrain !== TerrainType.GEMS)) return 0
    return tile.oreAmount
  }

  isGemsTile(col: number, row: number): boolean {
    const tile = this.getTile(col, row)
    return tile?.terrain === TerrainType.GEMS
  }

  get worldWidth(): number { return this.data.width * TILE_SIZE }
  get worldHeight(): number { return this.data.height * TILE_SIZE }

  private redrawTile(col: number, row: number): void {
    const tile = this.getTile(col, row)
    if (!tile) return
    const px = col * TILE_SIZE
    const py = row * TILE_SIZE
    const g = this.terrainGraphics

    g.fillStyle(this.tileColor(tile, col, row))
    g.fillRect(px, py, TILE_SIZE, TILE_SIZE)

    switch (tile.terrain) {
      case TerrainType.GRASS:
        this.drawGrassDetail(g, px, py, col, row)
        break
      case TerrainType.WATER:
        this.drawWaterEdge(g, px, py, col, row)
        break
      case TerrainType.ORE:
      case TerrainType.GEMS:
        this.drawOreDetail(g, px, py, col, row, tile.oreAmount)
        break
      case TerrainType.FOREST:
        this.drawForestDetail(g, px, py, col, row)
        break
      case TerrainType.BRIDGE:
        this.drawBridgeDetail(g, px, py)
        break
      case TerrainType.SAND:
        this.drawSandDetail(g, px, py, col, row)
        break
      case TerrainType.ROCK:
        this.drawRockDetail(g, px, py, col, row)
        break
    }
  }

  private regenerateDepletedOre(): void {
    if (this.depletedOreTiles.size === 0) return
    const changed: Array<{ col: number; row: number }> = []
    for (const key of [...this.depletedOreTiles]) {
      const col = key % this.data.width
      const row = Math.floor(key / this.data.width)
      const tile = this.getTile(col, row)

      // Partially depleted ore/gem tiles regenerate; fully depleted (grass) tiles do NOT
      if (!tile) {
        this.depletedOreTiles.delete(key)
        continue
      }
      if (tile.terrain !== TerrainType.ORE && tile.terrain !== TerrainType.GEMS) {
        this.depletedOreTiles.delete(key)
        continue
      }
      if (tile.oreAmount <= 0) {
        this.depletedOreTiles.delete(key)
        continue
      }

      // Adjacent ore speeds up regen slightly
      const adjacentBonus = this.hasAdjacentOre(col, row) ? 1.3 : 1.0
      const maxAmt = tile.terrain === TerrainType.GEMS ? GEMS_TILE_MAX : ORE_TILE_MAX
      const regenAmount = Math.floor(ORE_REGEN_RATE * adjacentBonus)
      tile.oreAmount = Math.min(maxAmt, tile.oreAmount + regenAmount)

      if (tile.oreAmount >= maxAmt) {
        this.depletedOreTiles.delete(key)
      }
      changed.push({ col, row })
    }

    if (changed.length > 0) {
      for (const c of changed) this.redrawTile(c.col, c.row)
      this.renderAnimatedTiles()
    }
  }

  private regenerateExistingOre(): void {
    if (this.oreTiles.length === 0) return
    const changed: Array<{ col: number; row: number }> = []
    for (const { col, row } of this.oreTiles) {
      const tile = this.getTile(col, row)
      if (!tile || (tile.terrain !== TerrainType.ORE && tile.terrain !== TerrainType.GEMS)) continue
      const maxAmt = tile.terrain === TerrainType.GEMS ? GEMS_TILE_MAX : ORE_TILE_MAX
      if (tile.oreAmount > 0 && tile.oreAmount < maxAmt) {
        tile.oreAmount = Math.min(maxAmt, tile.oreAmount + ORE_REGEN_RATE)
        changed.push({ col, row })
      }
    }

    if (changed.length > 0) {
      for (const c of changed) this.redrawTile(c.col, c.row)
      this.renderAnimatedTiles()
    }
  }

  private hasAdjacentOre(col: number, row: number): boolean {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const tile = this.getTile(col + dc, row + dr)
        if (tile && (tile.terrain === TerrainType.ORE || tile.terrain === TerrainType.GEMS) && tile.oreAmount > 0) {
          return true
        }
      }
    }
    return false
  }

  private key(col: number, row: number): number {
    return row * this.data.width + col
  }

  private addOreTile(col: number, row: number): void {
    if (this.oreTiles.some(t => t.col === col && t.row === row)) return
    this.oreTiles.push({ col, row })
  }

  private removeOreTile(col: number, row: number): void {
    const idx = this.oreTiles.findIndex(t => t.col === col && t.row === row)
    if (idx >= 0) this.oreTiles.splice(idx, 1)
  }
}
