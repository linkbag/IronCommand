import Phaser from 'phaser'
import {
  TerrainType,
  FogState,
  TILE_SIZE,
  MAP_DEFAULT_WIDTH,
  MAP_DEFAULT_HEIGHT,
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
}

const FOG_ALPHA: Record<FogState, number> = {
  [FogState.HIDDEN]:   1.0,
  [FogState.EXPLORED]: 0.5,
  [FogState.VISIBLE]:  0.0,
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
    for (let j = 0; j < clusterSize; j++) {
      const dx = Math.floor((rng() - 0.5) * 8)
      const dy = Math.floor((rng() - 0.5) * 8)
      const tx = cx + dx, ty = cy + dy
      if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
        const tile = tiles[ty][tx]
        if (tile.terrain === TerrainType.GRASS || tile.terrain === TerrainType.SAND) {
          tile.terrain = TerrainType.ORE
          tile.oreAmount = 1000 + Math.floor(rng() * 2000)
          tile.passable = false
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

  constructor(scene: Phaser.Scene, width?: number, height?: number, seed?: number) {
    this.scene = scene
    this.data = generateMapData(width, height, seed)
    this.terrainGraphics = scene.add.graphics()
    this.fogLayer = scene.add.graphics()
    this.terrainGraphics.setDepth(0)
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
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const color = this.tileColor(tile.terrain, col, row)
        g.fillStyle(color)
        g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        // Ore sparkle: tiny dot
        if (tile.terrain === TerrainType.ORE) {
          g.fillStyle(0xffffff, 0.5)
          g.fillCircle(col * TILE_SIZE + 16, row * TILE_SIZE + 16, 3)
        }
        // Forest: darker dot cluster
        if (tile.terrain === TerrainType.FOREST) {
          g.fillStyle(0x0d2b0a, 0.7)
          g.fillCircle(col * TILE_SIZE + 10, row * TILE_SIZE + 10, 5)
          g.fillCircle(col * TILE_SIZE + 22, row * TILE_SIZE + 18, 4)
        }
      }
    }
  }

  /** Render fog of war layer — call after fog state changes */
  renderFog(fullRedraw = false): void {
    if (fullRedraw) {
      this.renderFogFull()
      return
    }
    const { tiles } = this.data
    const g = this.fogLayer
    for (const idx of this.dirtyFogCells) {
      const col = idx % this.data.width
      const row = Math.floor(idx / this.data.width)
      const tile = tiles[row][col]
      const alpha = FOG_ALPHA[tile.fogState]
      g.fillStyle(0x000000, alpha)
      g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE)
    }
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

  private tileColor(terrain: TerrainType, col: number, row: number): number {
    const colors = TERRAIN_COLORS[terrain]
    return colors[(col + row) % colors.length]
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

  get worldWidth(): number { return this.data.width * TILE_SIZE }
  get worldHeight(): number { return this.data.height * TILE_SIZE }
}
