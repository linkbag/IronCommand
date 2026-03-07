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
import type { MapTemplate } from '../scenes/SetupScene'
import { tileToScreen, screenToTile, getIsoWorldBounds, setMapOffset, ISO_TILE_W, ISO_TILE_H, drawIsoDiamond } from './IsoUtils'

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

/** Generate map data without creating a full GameMap (for preview rendering) */
export function generatePreviewData(
  width: number,
  height: number,
  seed: number,
  template: MapTemplate = 'continental',
): { tiles: TileData[][]; startPositions: Position[] } {
  const data = generateMapData(width, height, seed, template)
  return { tiles: data.tiles, startPositions: data.startPositions }
}

/** Preview terrain colors (simplified) */
export const PREVIEW_COLORS: Record<TerrainType, number> = {
  [TerrainType.GRASS]:  0x4a7c3f,
  [TerrainType.WATER]:  0x1a6fa8,
  [TerrainType.ORE]:    0xd4a017,
  [TerrainType.ROCK]:   0x7a7a7a,
  [TerrainType.SAND]:   0xd2b48c,
  [TerrainType.ROAD]:   0x555555,
  [TerrainType.BRIDGE]: 0x8b6914,
  [TerrainType.FOREST]: 0x1e4d1a,
  [TerrainType.GEMS]:   0x2a8aff,
}

/** Resolve 'random' to a concrete template using the seed */
function resolveTemplate(template: MapTemplate, rng: () => number): Exclude<MapTemplate, 'random'> {
  if (template !== 'random') return template
  const opts: Exclude<MapTemplate, 'random'>[] = ['continental', 'islands', 'desert', 'arctic', 'urban']
  return opts[Math.floor(rng() * opts.length)]
}

function generateMapData(
  width = MAP_DEFAULT_WIDTH,
  height = MAP_DEFAULT_HEIGHT,
  seed = 12345,
  template: MapTemplate = 'continental',
): GameMapData {
  const rng = makePRNG(seed)
  const resolved = resolveTemplate(template, rng)
  const noise = new ValueNoise(seed)
  const waterNoise = new ValueNoise(seed + 1)
  const forestNoise = new ValueNoise(seed + 2)

  // Template-specific thresholds
  const cfg = {
    waterThreshold: 0.72,
    rockThreshold: 0.7,
    sandThreshold: 0.25,
    forestThreshold: 0.68,
    scale: 0.03,
    oreMultiplier: 1.0,
    riverEnabled: true,
    edgeWater: false,  // Continental: water border around edges
  }

  switch (resolved) {
    case 'continental':
      cfg.edgeWater = true
      break
    case 'islands':
      cfg.waterThreshold = 0.55  // Much more water
      cfg.forestThreshold = 0.72
      cfg.scale = 0.025
      cfg.oreMultiplier = 0.8
      cfg.riverEnabled = false
      break
    case 'desert':
      cfg.waterThreshold = 0.88  // Very little water
      cfg.rockThreshold = 0.6    // More rock clusters
      cfg.sandThreshold = 0.55   // Much more sand
      cfg.forestThreshold = 0.92 // Almost no forest
      cfg.oreMultiplier = 0.7
      cfg.riverEnabled = false
      break
    case 'arctic':
      cfg.waterThreshold = 0.68
      cfg.forestThreshold = 0.75
      cfg.sandThreshold = 0.20   // Less sand (snow-covered)
      cfg.oreMultiplier = 0.9
      break
    case 'urban':
      cfg.waterThreshold = 0.82  // Less water
      cfg.rockThreshold = 0.55   // More rock clusters (ruins)
      cfg.forestThreshold = 0.85 // Much less forest
      cfg.oreMultiplier = 1.2
      cfg.riverEnabled = false
      break
  }

  // Build base tile grid
  const tiles: TileData[][] = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      const n = noise.fractal(col * cfg.scale, row * cfg.scale)
      const w = waterNoise.fractal(col * cfg.scale * 1.5, row * cfg.scale * 1.5)
      const f = forestNoise.fractal(col * cfg.scale * 2, row * cfg.scale * 2)

      let terrain: TerrainType
      let passable = true
      let buildable = true

      // Continental: force water at map edges
      if (cfg.edgeWater) {
        const edgeDist = Math.min(col, row, width - 1 - col, height - 1 - row)
        const edgeFade = 5
        if (edgeDist < edgeFade) {
          const edgeFactor = 1.0 - edgeDist / edgeFade
          if (edgeFactor > 0.5 || w > cfg.waterThreshold - edgeFactor * 0.3) {
            if (edgeDist <= 1) {
              return { terrain: TerrainType.WATER, passable: false, buildable: false, oreAmount: 0, fogState: FogState.HIDDEN, occupiedBy: null }
            }
          }
        }
      }

      // Islands: use distance-from-center modulation for island shapes
      if (resolved === 'islands') {
        const ncx = (col / width - 0.5) * 2
        const ncy = (row / height - 0.5) * 2
        const distCenter = Math.sqrt(ncx * ncx + ncy * ncy)
        // Create island clusters: use noise to break up the landmass
        const islandNoise = noise.fractal(col * 0.04, row * 0.04, 3)
        const waterChance = w + distCenter * 0.2 - islandNoise * 0.25
        if (waterChance > cfg.waterThreshold) {
          return { terrain: TerrainType.WATER, passable: false, buildable: false, oreAmount: 0, fogState: FogState.HIDDEN, occupiedBy: null }
        }
      }

      if (w > cfg.waterThreshold) {
        terrain = TerrainType.WATER
        passable = false
        buildable = false
      } else if (n > cfg.rockThreshold) {
        terrain = TerrainType.ROCK
        passable = false
        buildable = false
      } else if (n < cfg.sandThreshold) {
        terrain = TerrainType.SAND
      } else if (f > cfg.forestThreshold) {
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

  // Desert: convert grass to sand for thematic consistency
  if (resolved === 'desert') {
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (tiles[row][col].terrain === TerrainType.GRASS) {
          tiles[row][col].terrain = TerrainType.SAND
        }
      }
    }
  }

  // Place ore patches (clusters of 5-10 tiles)
  const oreCount = Math.floor(width * height * 0.0008 * cfg.oreMultiplier)
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

  // Carve river (template-dependent)
  if (cfg.riverEnabled) {
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

    // Place bridges across the river
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
  }

  // Islands: add bridges between nearby landmasses at strategic points
  if (resolved === 'islands') {
    const bridgeCount = 3 + Math.floor(rng() * 3)
    for (let b = 0; b < bridgeCount; b++) {
      const bCol = Math.floor(rng() * (width - 20)) + 10
      const bRow = Math.floor(rng() * (height - 20)) + 10
      // Try to build a short bridge across water
      if (tiles[bRow]?.[bCol]?.terrain === TerrainType.WATER) {
        for (let d = -2; d <= 2; d++) {
          const r = bRow + d, c = bCol
          if (r >= 0 && r < height && tiles[r][c].terrain === TerrainType.WATER) {
            tiles[r][c].terrain = TerrainType.BRIDGE
            tiles[r][c].passable = true
            tiles[r][c].buildable = false
          }
        }
      }
    }
  }

  // Desert: add oasis water pools
  if (resolved === 'desert') {
    const oasisCount = 2 + Math.floor(rng() * 3)
    for (let i = 0; i < oasisCount; i++) {
      const ox = Math.floor(rng() * (width - 20)) + 10
      const oy = Math.floor(rng() * (height - 20)) + 10
      const oasisR = 2 + Math.floor(rng() * 2)
      for (let dr = -oasisR; dr <= oasisR; dr++) {
        for (let dc = -oasisR; dc <= oasisR; dc++) {
          if (dc * dc + dr * dr > oasisR * oasisR) continue
          const tx = ox + dc, ty = oy + dr
          if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
            tiles[ty][tx].terrain = TerrainType.WATER
            tiles[ty][tx].passable = false
            tiles[ty][tx].buildable = false
            tiles[ty][tx].oreAmount = 0
          }
        }
      }
      // Ring of grass around oasis
      for (let dr = -(oasisR + 1); dr <= oasisR + 1; dr++) {
        for (let dc = -(oasisR + 1); dc <= oasisR + 1; dc++) {
          const dist2 = dc * dc + dr * dr
          if (dist2 > oasisR * oasisR && dist2 <= (oasisR + 1) * (oasisR + 1)) {
            const tx = ox + dc, ty = oy + dr
            if (tx >= 0 && tx < width && ty >= 0 && ty < height && tiles[ty][tx].terrain === TerrainType.SAND) {
              tiles[ty][tx].terrain = TerrainType.GRASS
            }
          }
        }
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

/**
 * RA2-style spawn distribution:
 * 2 players → opposite corners
 * 3 players → triangle
 * 4 players → four corners
 * 5-8 players → evenly spaced around perimeter (clock positions)
 */
function computeStartPositions(w: number, h: number, count: number): Position[] {
  const margin = 8
  const cx = w / 2
  const cy = h / 2
  const rx = cx - margin  // radius along x
  const ry = cy - margin  // radius along y

  // For 4 or fewer, use corners/specific positions for more natural feel
  if (count <= 4) {
    const corners: Position[] = [
      { x: margin * TILE_SIZE, y: margin * TILE_SIZE },                       // top-left
      { x: (w - margin) * TILE_SIZE, y: (h - margin) * TILE_SIZE },          // bottom-right
      { x: (w - margin) * TILE_SIZE, y: margin * TILE_SIZE },                // top-right
      { x: margin * TILE_SIZE, y: (h - margin) * TILE_SIZE },                // bottom-left
    ]
    if (count === 2) return [corners[0], corners[1]]
    if (count === 3) return [corners[0], corners[1], corners[2]]
    return corners.slice(0, count)
  }

  // 5-8: evenly around perimeter using angular distribution
  const positions: Position[] = []
  // Start at top-left corner (angle ~225° or -3π/4) and go clockwise
  const startAngle = -Math.PI * 3 / 4
  for (let i = 0; i < count; i++) {
    const angle = startAngle + (i / count) * Math.PI * 2
    const col = Math.round(cx + Math.cos(angle) * rx)
    const row = Math.round(cy + Math.sin(angle) * ry)
    const clampedCol = Phaser.Math.Clamp(col, margin, w - margin)
    const clampedRow = Phaser.Math.Clamp(row, margin, h - margin)
    positions.push({ x: clampedCol * TILE_SIZE, y: clampedRow * TILE_SIZE })
  }
  return positions
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
  private debugGridEnabled = false

  constructor(scene: Phaser.Scene, width?: number, height?: number, seed?: number, template?: MapTemplate) {
    this.scene = scene
    this.data = generateMapData(width, height, seed, template)
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
    const { tiles, width, height } = this.data
    this.waterTiles = []
    this.oreTiles = []

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        if (tile.terrain === TerrainType.WATER) this.waterTiles.push({ col, row })
        if (tile.terrain === TerrainType.ORE || tile.terrain === TerrainType.GEMS) {
          this.oreTiles.push({ col, row })
        }
      }
    }

    if (!this.renderedTiles) {
      this.renderedTiles = true
      this.setupAnimations()
    }
    setMapOffset(this.isoOffsetX)
    this.renderTerrainVisible()
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
    const offsetX = this.isoOffsetX
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const alpha = FOG_ALPHA[tile.fogState]
        if (alpha > 0) {
          const screen = tileToScreen(col, row)
          g.fillStyle(0x000000, alpha)
          drawIsoDiamond(g, screen.x + offsetX, screen.y, ISO_TILE_W, ISO_TILE_H)
          g.fillPath()
        }
      }
    }
  }

  private tileColor(tile: TileData, col: number, row: number): number {
    const colors = TERRAIN_COLORS[tile.terrain]
    if (!colors) return 0x4a7c3f // fallback grass
    let base = colors[(col + row) % colors.length]
    // Sun from top-left: subtly brighten NW tiles, darken SE tiles.
    const sun = Phaser.Math.Clamp(((col - row) * -0.02), -0.12, 0.12)
    base = scaleColor(base, 1 + sun)
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
    // Broad tonal patch to break up flat grass.
    const patchA = this.tileHash(col, row, 1)
    const patchX = this.tileHash(col, row, 2) * 18 + 18
    const patchY = this.tileHash(col, row, 3) * 6 + 11
    const patchW = 10 + Math.floor(this.tileHash(col, row, 4) * 8)
    const patchH = 4 + Math.floor(this.tileHash(col, row, 5) * 4)
    g.fillStyle(patchA > 0.5 ? 0x5e914f : 0x315f29, 0.18)
    g.fillEllipse(px + patchX, py + patchY, patchW, patchH)

    // Tufts + pebbles.
    const detailCount = 2 + Math.floor(this.tileHash(col, row, 6) * 3)
    for (let i = 0; i < detailCount; i++) {
      const dx = this.tileHash(col, row, 10 + i) * 40 + 12
      const dy = this.tileHash(col, row, 20 + i) * 14 + 9
      g.fillStyle(0x2d5a25, 0.38)
      g.fillRect(px + dx, py + dy, 2, 2)
      if (this.tileHash(col, row, 30 + i) > 0.45) {
        g.lineStyle(1, 0x2a5822, 0.55)
        g.lineBetween(px + dx + 1, py + dy, px + dx, py + dy - 4)
        g.lineBetween(px + dx + 3, py + dy + 1, px + dx + 4, py + dy - 2)
      }
    }
  }

  private drawWaterEdge(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const { tiles, width, height } = this.data
    const edgeLight = 0x6dc2e8
    const edgeDark = 0x114b77
    // Lighter top-side edges where water meets land
    if (row > 0 && tiles[row - 1][col].terrain !== TerrainType.WATER) {
      g.lineStyle(1, edgeLight, 0.45)
      g.lineBetween(px + ISO_TILE_W / 2, py, px, py + ISO_TILE_H / 2)
    }
    if (col > 0 && tiles[row][col - 1].terrain !== TerrainType.WATER) {
      g.lineStyle(1, edgeLight, 0.45)
      g.lineBetween(px + ISO_TILE_W / 2, py, px + ISO_TILE_W, py + ISO_TILE_H / 2)
    }
    if (row < height - 1 && tiles[row + 1][col].terrain !== TerrainType.WATER) {
      g.lineStyle(1, edgeDark, 0.35)
      g.lineBetween(px, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H)
    }
    if (col < width - 1 && tiles[row][col + 1].terrain !== TerrainType.WATER) {
      g.lineStyle(1, edgeDark, 0.35)
      g.lineBetween(px + ISO_TILE_W, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H)
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
    const vx = this.tileHash(col, row, 110) * 24 + 14
    const vy = this.tileHash(col, row, 111) * 8 + 10
    g.lineBetween(px + vx, py + vy, px + vx + 12, py + vy + 5)
    // Small nugget shapes — fewer and dimmer when depleted
    const nuggetColor = lerpColor(0x6a8a4a, 0xe8c020, ratio) // green-ish → gold
    g.fillStyle(nuggetColor, 0.1 + ratio * 0.7)
    const nx = this.tileHash(col, row, 112) * 26 + 14
    const ny = this.tileHash(col, row, 113) * 8 + 12
    g.fillRect(px + nx, py + ny, 3, 2)
    if (ratio > 0.3) g.fillRect(px + nx + 8, py + ny + 3, 2, 3) // Second nugget only when ore is decent
  }

  private drawForestDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const treeCount = 2 + Math.floor(this.tileHash(col, row, 40) * 2)
    for (let i = 0; i < treeCount; i++) {
      const tx = this.tileHash(col, row, 50 + i) * 24 + 18
      const ty = this.tileHash(col, row, 60 + i) * 8 + 10
      // Shadow underneath
      g.fillStyle(0x0a1a08, 0.35)
      g.fillEllipse(px + tx, py + ty + 5, 8, 4)
      // Canopy shadow spill to ground
      g.fillStyle(0x0a1a08, 0.22)
      g.fillEllipse(px + tx + 3, py + ty + 8, 13, 6)
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
    for (let y = 7; y < ISO_TILE_H; y += 5) {
      g.lineBetween(px + 14, py + y, px + ISO_TILE_W - 14, py + y)
    }
    // Railings on slopes
    g.lineStyle(2, 0x4a3010, 0.7)
    g.lineBetween(px + 20, py + 7, px + 8, py + 18)
    g.lineBetween(px + 44, py + 7, px + 56, py + 18)
  }

  private drawSandDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const rippleCount = 2 + Math.floor(this.tileHash(col, row, 70) * 2)
    for (let i = 0; i < rippleCount; i++) {
      const rx = this.tileHash(col, row, 80 + i) * 24 + 18
      const ry = this.tileHash(col, row, 90 + i) * 8 + 10
      g.lineStyle(1, 0xb99762, 0.35)
      g.lineBetween(px + rx - 7, py + ry, px + rx + 7, py + ry + 2)
    }
    const dotCount = 2 + Math.floor(this.tileHash(col, row, 96) * 3)
    for (let i = 0; i < dotCount; i++) {
      const dx = this.tileHash(col, row, 100 + i) * 38 + 13
      const dy = this.tileHash(col, row, 110 + i) * 11 + 8
      g.fillStyle(0xb8986a, 0.3)
      g.fillRect(px + dx, py + dy, 1, 1)
    }
  }

  private drawRockDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    // Cracks
    g.lineStyle(1, 0x555555, 0.4)
    const cx = this.tileHash(col, row, 100) * 28 + 12
    const cy = this.tileHash(col, row, 101) * 10 + 9
    g.lineBetween(px + cx, py + cy, px + cx + 10, py + cy + 4)
    // Lighter highlight spot
    g.fillStyle(0x999999, 0.25)
    const hx = this.tileHash(col, row, 102) * 30 + 12
    const hy = this.tileHash(col, row, 103) * 10 + 10
    g.fillRect(px + hx, py + hy, 3, 3)
    // Layered cliff bands (gives rock tiles more vertical weight).
    g.lineStyle(1, 0x5a5a5a, 0.4)
    g.lineBetween(px + 14, py + 20, px + ISO_TILE_W - 14, py + 23)
    g.lineStyle(1, 0x3a3a3a, 0.35)
    g.lineBetween(px + 16, py + 24, px + ISO_TILE_W - 16, py + 27)
  }

  private drawTerrainTransition(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number, tile: TileData): void {
    const above = this.getTile(col, row - 1)
    const left = this.getTile(col - 1, row)
    const below = this.getTile(col, row + 1)
    const right = this.getTile(col + 1, row)
    const blendToWater = tile.terrain === TerrainType.GRASS || tile.terrain === TerrainType.SAND
    if (blendToWater) {
      if (above?.terrain === TerrainType.WATER) {
        g.lineStyle(2, 0x63bfe8, 0.23)
        g.lineBetween(px + ISO_TILE_W / 2, py + 2, px + 3, py + ISO_TILE_H / 2)
      }
      if (left?.terrain === TerrainType.WATER) {
        g.lineStyle(2, 0x63bfe8, 0.23)
        g.lineBetween(px + ISO_TILE_W / 2, py + 2, px + ISO_TILE_W - 3, py + ISO_TILE_H / 2)
      }
    }
    if (tile.terrain === TerrainType.GRASS) {
      const sandEdge = above?.terrain === TerrainType.SAND || left?.terrain === TerrainType.SAND || below?.terrain === TerrainType.SAND || right?.terrain === TerrainType.SAND
      if (sandEdge) {
        g.lineStyle(1, 0xd1bb8f, 0.22)
        g.lineBetween(px + 10, py + 15, px + ISO_TILE_W - 10, py + 18)
      }
    }
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
    const offsetX = this.isoOffsetX

    // Water shimmer
    const shimmerAlpha = [0.12, 0.0, 0.08][this.animFrame]
    for (const { col, row } of this.waterTiles) {
      const screen = tileToScreen(col, row)
      const px = screen.x + offsetX
      const py = screen.y
      if (!this.isOnScreen(px, py)) continue
      // Shimmer overlay
      if (shimmerAlpha > 0) {
        g.fillStyle(0xffffff, shimmerAlpha)
        drawIsoDiamond(g, px, py, ISO_TILE_W, ISO_TILE_H)
        g.fillPath()
      }
      // Sun reflection dots
      if (this.animFrame !== 1) {
        const dx = ((this.animFrame * 11 + col * 7) % 32) + 16
        const dy = ((this.animFrame * 13 + row * 5) % 10) + 8
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
      const screen = tileToScreen(col, row)
      const px = screen.x + offsetX
      const py = screen.y
      if (!this.isOnScreen(px, py)) continue
      const sx = ((this.animFrame * 9 + col * 13) % 28) + 16
      const sy = ((this.animFrame * 7 + row * 11) % 10) + 8
      g.fillStyle(0xffffff, 0.2 + ratio * 0.55)
      g.fillCircle(px + sx, py + sy, 1.5)
      // Second sparkle
      const sx2 = ((this.animFrame * 17 + col * 3) % 26) + 18
      const sy2 = ((this.animFrame * 19 + row * 7) % 12) + 10
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

  /** Convert isometric screen position to tile coordinates */
  isoToTile(isoX: number, isoY: number): TileCoord {
    const { col, row } = screenToTile(isoX, isoY)
    return { col: Math.floor(col), row: Math.floor(row) }
  }

  /** Convert tile coordinates to isometric screen position (tile center) */
  tileToIso(col: number, row: number): Position {
    const pos = tileToScreen(col, row)
    // Offset to tile center
    return { x: pos.x + 32, y: pos.y + 16 }
  }

  /** Isometric world width in pixels */
  get isoWorldWidth(): number {
    return getIsoWorldBounds(this.data.width, this.data.height).width
  }

  /** Isometric world height in pixels */
  get isoWorldHeight(): number {
    return getIsoWorldBounds(this.data.width, this.data.height).height
  }

  /** X offset for isometric rendering (row 0 starts offset to the right) */
  get isoOffsetX(): number {
    return getIsoWorldBounds(this.data.width, this.data.height).offsetX
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
    this.renderTerrainVisible()
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
    if (!this.getTile(col, row)) return
    this.renderTerrainVisible()
  }

  private regenerateDepletedOre(): void {
    if (this.depletedOreTiles.size === 0) return
    const changed: Array<{ col: number; row: number }> = []
    for (const key of [...this.depletedOreTiles]) {
      const col = key % this.data.width
      const row = Math.floor(key / this.data.width)
      const tile = this.getTile(col, row)

      // Only ore regenerates. Gems are finite like RA2.
      if (!tile) {
        this.depletedOreTiles.delete(key)
        continue
      }
      if (tile.terrain !== TerrainType.ORE) {
        this.depletedOreTiles.delete(key)
        continue
      }
      if (tile.oreAmount <= 0) {
        this.depletedOreTiles.delete(key)
        continue
      }

      // Adjacent ore speeds up regen slightly
      const adjacentBonus = this.hasAdjacentOre(col, row) ? 1.3 : 1.0
      const maxAmt = ORE_TILE_MAX
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
      if (!tile || tile.terrain !== TerrainType.ORE) continue
      const maxAmt = ORE_TILE_MAX
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

  setDebugGrid(enabled: boolean): void {
    this.debugGridEnabled = enabled
    this.renderTerrainVisible()
  }

  private renderTerrainVisible(): void {
    if (!this.renderedTiles) return
    const g = this.terrainGraphics
    const cam = this.scene.cameras.main
    const { tiles, width, height } = this.data
    const cameraX = cam.scrollX
    const cameraY = cam.scrollY
    const viewWidth = cam.width
    const viewHeight = cam.height
    const offsetX = this.isoOffsetX

    g.clear()
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tile = tiles[row][col]
        const screen = tileToScreen(col, row)
        const px = screen.x + offsetX
        const py = screen.y
        const sx = px - cameraX
        const sy = py - cameraY

        if (
          sx <= -ISO_TILE_W || sx >= viewWidth + ISO_TILE_W
          || sy <= -ISO_TILE_H || sy >= viewHeight + ISO_TILE_H
        ) {
          continue
        }

        this.drawTerrainDiamond(g, px, py, this.tileColor(tile, col, row))
        this.drawTerrainTransition(g, px, py, col, row, tile)

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

        if (this.debugGridEnabled) {
          g.lineStyle(1, 0x111111, 0.25)
          drawIsoDiamond(g, px, py, ISO_TILE_W, ISO_TILE_H)
          g.strokePath()
        }
      }
    }
  }

  private drawTerrainDiamond(g: Phaser.GameObjects.Graphics, px: number, py: number, baseColor: number): void {
    g.fillStyle(baseColor, 1)
    drawIsoDiamond(g, px, py, ISO_TILE_W, ISO_TILE_H)
    g.fillPath()

    const lighter = scaleColor(baseColor, 1.1)
    const darker = scaleColor(baseColor, 0.82)
    g.lineStyle(1, lighter, 0.4)
    g.lineBetween(px + ISO_TILE_W / 2, py, px, py + ISO_TILE_H / 2)
    g.lineBetween(px + ISO_TILE_W / 2, py, px + ISO_TILE_W, py + ISO_TILE_H / 2)
    g.lineStyle(1, darker, 0.35)
    g.lineBetween(px + ISO_TILE_W, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H)
    g.lineBetween(px, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H)
  }

  private isOnScreen(px: number, py: number): boolean {
    const cam = this.scene.cameras.main
    const sx = px - cam.scrollX
    const sy = py - cam.scrollY
    return sx > -ISO_TILE_W && sx < cam.width + ISO_TILE_W && sy > -ISO_TILE_H && sy < cam.height + ISO_TILE_H
  }
}
