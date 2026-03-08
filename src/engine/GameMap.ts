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
import type { TileData, GameMap as GameMapData, Position, TileCoord, StartDistanceMode } from '../types'
import type { MapTemplate } from '../types'
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
  [FogState.EXPLORED]: 0.55,
  [FogState.VISIBLE]:  0.0,
}

const ORE_MAX_AMOUNT = ORE_TILE_MAX
const ORE_SPREAD_INTERVAL_MS = 30000
const ORE_GROWTH_INTERVAL_MS = 6000  // regenerate every 6s (10 ore/min from baseline growth)

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
  startDistanceMode: StartDistanceMode = 'long_range',
): { tiles: TileData[][]; startPositions: Position[] } {
  const data = generateMapData(width, height, seed, template, startDistanceMode)
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
  startDistanceMode: StartDistanceMode = 'long_range',
): GameMapData {
  const rng = makePRNG(seed)
  const resolved = resolveTemplate(template, rng)
  const noise = new ValueNoise(seed)
  const waterNoise = new ValueNoise(seed + 1)
  const forestNoise = new ValueNoise(seed + 2)
  const cfg = {
    waterThreshold: 0.67,
    sandThreshold: 0.24,
    forestThreshold: 0.72,
    rockThreshold: 0.78,
    scale: 0.028,
    oreMultiplier: 1.0,
    maxRockRatio: 0.12,
    tinyWaterSize: 7,
    mountainSpine: false,
  }

  switch (resolved) {
    case 'continental':
      cfg.waterThreshold = 0.73
      cfg.mountainSpine = true
      cfg.tinyWaterSize = 20
      break
    case 'islands':
      cfg.waterThreshold = 0.60
      cfg.sandThreshold = 0.30
      cfg.forestThreshold = 0.76
      cfg.rockThreshold = 0.84
      cfg.scale = 0.024
      cfg.oreMultiplier = 0.85
      cfg.maxRockRatio = 0.10
      cfg.tinyWaterSize = 14
      break
    case 'desert':
      cfg.waterThreshold = 0.82
      cfg.sandThreshold = 0.44
      cfg.forestThreshold = 0.96
      cfg.rockThreshold = 0.86
      cfg.oreMultiplier = 0.75
      cfg.maxRockRatio = 0.08
      cfg.tinyWaterSize = 5
      break
    case 'arctic':
      cfg.waterThreshold = 0.64
      cfg.sandThreshold = 0.28
      cfg.forestThreshold = 0.92
      cfg.rockThreshold = 0.82
      cfg.oreMultiplier = 0.9
      cfg.maxRockRatio = 0.10
      cfg.tinyWaterSize = 12
      break
    case 'urban':
      cfg.waterThreshold = 0.80
      cfg.sandThreshold = 0.18
      cfg.forestThreshold = 0.92
      cfg.rockThreshold = 0.83
      cfg.oreMultiplier = 1.2
      cfg.maxRockRatio = 0.11
      cfg.tinyWaterSize = 6
      break
  }

  const setTerrain = (tile: TileData, terrain: TerrainType): void => {
    tile.terrain = terrain
    tile.oreAmount = 0
    if (terrain === TerrainType.WATER) {
      tile.passable = false
      tile.buildable = false
      tile.height = 0
      return
    }
    if (terrain === TerrainType.ROCK) {
      tile.passable = false
      tile.buildable = false
      tile.height = 2
      return
    }
    tile.passable = true
    tile.buildable = terrain !== TerrainType.FOREST && terrain !== TerrainType.ROAD && terrain !== TerrainType.BRIDGE
    if (terrain === TerrainType.BRIDGE || terrain === TerrainType.ROAD) tile.buildable = false
  }

  const tiles: TileData[][] = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) => {
      const n = noise.fractal(col * cfg.scale, row * cfg.scale, 4)
      const w = waterNoise.fractal(col * cfg.scale * 1.35, row * cfg.scale * 1.35, 4)
      const f = forestNoise.fractal(col * cfg.scale * 2.15, row * cfg.scale * 2.15, 3)
      const edgeDist = Math.min(col, row, width - 1 - col, height - 1 - row)
      const edgeRatio = Phaser.Math.Clamp(edgeDist / Math.max(1, Math.min(width, height) * 0.46), 0, 1)

      let waterScore = w
      if (resolved === 'continental') {
        const nx = (col / Math.max(1, width - 1)) * 2 - 1
        const ny = (row / Math.max(1, height - 1)) * 2 - 1
        const radial = Phaser.Math.Clamp(Math.hypot(nx, ny) / 1.4142, 0, 1)
        const coastBand = Phaser.Math.Clamp((radial - 0.58) / 0.42, 0, 1)
        const coastNoise = noise.fractal(col * cfg.scale * 0.42 + 700, row * cfg.scale * 0.42 + 700, 3)
        waterScore += coastBand * 0.48 + (1 - edgeRatio) * 0.12
        waterScore += coastNoise * 0.12
        waterScore -= (1 - coastBand) * 0.22
      }
      if (resolved === 'desert') waterScore += 0.15
      if (resolved === 'urban') waterScore += 0.09
      if (resolved === 'islands') {
        const nx = (col / width - 0.5) * 2
        const ny = (row / height - 0.5) * 2
        const dist = Math.hypot(nx, ny)
        waterScore += dist * 0.24 - noise.fractal(col * 0.05, row * 0.05, 3) * 0.27
      }

      const tile: TileData = {
        terrain: TerrainType.GRASS,
        height: 1,
        passable: true,
        buildable: true,
        oreAmount: 0,
        fogState: FogState.HIDDEN,
        occupiedBy: null,
      }

      if (waterScore > cfg.waterThreshold) {
        setTerrain(tile, TerrainType.WATER)
        return tile
      }

      if (resolved === 'desert' || n < cfg.sandThreshold) setTerrain(tile, TerrainType.SAND)
      if (f > cfg.forestThreshold && resolved !== 'desert' && resolved !== 'urban') setTerrain(tile, TerrainType.FOREST)

      const ridge = Math.abs(noise.fractal(col * cfg.scale * 0.75 + 100, row * cfg.scale * 0.75 + 100, 3) - 0.5) * 2
      let mountainScore = ridge * 0.6 + noise.fractal(col * cfg.scale * 0.66 + 300, row * cfg.scale * 0.66 + 300, 3) * 0.4
      if (cfg.mountainSpine) {
        const center = Math.abs(col / width - 0.5) * 2
        mountainScore += Phaser.Math.Clamp(1 - center * 1.55, 0, 1) * 0.45
      }
      if (mountainScore > cfg.rockThreshold && waterScore < cfg.waterThreshold - 0.03) {
        setTerrain(tile, TerrainType.ROCK)
      }
      return tile
    })
  )

  const inBounds = (c: number, r: number) => c >= 0 && c < width && r >= 0 && r < height
  const n8: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  const n4: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

  const countNeighbors = (col: number, row: number, predicate: (t: TileData) => boolean, diag = true): number => {
    const dirs = diag ? n8 : n4
    let c = 0
    for (const [dc, dr] of dirs) {
      const nc = col + dc, nr = row + dr
      if (!inBounds(nc, nr)) continue
      if (predicate(tiles[nr][nc])) c++
    }
    return c
  }

  const carveLake = (cx: number, cy: number, radius: number): void => {
    for (let row = cy - radius - 1; row <= cy + radius + 1; row++) {
      for (let col = cx - radius - 1; col <= cx + radius + 1; col++) {
        if (!inBounds(col, row)) continue
        const dx = col - cx
        const dy = row - cy
        const d = Math.sqrt(dx * dx + dy * dy)
        const wobble = noise.fractal(col * 0.18 + 90, row * 0.18 + 45, 2) * 1.2
        if (d <= radius - 0.35 + wobble) setTerrain(tiles[row][col], TerrainType.WATER)
      }
    }
  }

  const carveMeanderingRiver = (mostlyHorizontal = true, halfWidth = 1): void => {
    if (mostlyHorizontal) {
      let y = Math.floor(height * (0.28 + rng() * 0.44))
      const centerByCol = new Int16Array(width)
      for (let col = 0; col < width; col++) {
        y += Math.floor((rng() - 0.5) * 3)
        y = Phaser.Math.Clamp(y, 3 + halfWidth, height - 4 - halfWidth)
        centerByCol[col] = y
        for (let r = y - halfWidth; r <= y + halfWidth; r++) setTerrain(tiles[r][col], TerrainType.WATER)
      }
      for (const bridgeCol of [Math.floor(width * 0.22), Math.floor(width * 0.5), Math.floor(width * 0.78)]) {
        const cy = centerByCol[bridgeCol]
        for (let r = cy - (halfWidth + 1); r <= cy + (halfWidth + 1); r++) {
          if (!inBounds(bridgeCol, r)) continue
          setTerrain(tiles[r][bridgeCol], TerrainType.BRIDGE)
          tiles[r][bridgeCol].height = 1
        }
      }
      return
    }
    let x = Math.floor(width * (0.28 + rng() * 0.44))
    for (let row = 0; row < height; row++) {
      x += Math.floor((rng() - 0.5) * 3)
      x = Phaser.Math.Clamp(x, 3 + halfWidth, width - 4 - halfWidth)
      for (let c = x - halfWidth; c <= x + halfWidth; c++) setTerrain(tiles[row][c], TerrainType.WATER)
    }
  }

  const connectIslandStraits = (count: number): void => {
    for (let i = 0; i < count; i++) {
      const horizontal = rng() > 0.5
      if (horizontal) {
        const row = 4 + Math.floor(rng() * (height - 8))
        for (let col = 2; col < width - 2; col++) {
          if (tiles[row][col].terrain !== TerrainType.WATER) continue
          let left = col - 1
          while (left > 0 && tiles[row][left].terrain === TerrainType.WATER) left--
          let right = col + 1
          while (right < width - 1 && tiles[row][right].terrain === TerrainType.WATER) right++
          const gap = right - left - 1
          if (gap < 2 || gap > 5) continue
          for (let c = left + 1; c < right; c++) {
            if ((c - (left + 1)) % 2 === 0) setTerrain(tiles[row][c], TerrainType.BRIDGE)
            else setTerrain(tiles[row][c], TerrainType.SAND)
            tiles[row][c].height = 1
          }
          break
        }
      } else {
        const col = 4 + Math.floor(rng() * (width - 8))
        for (let row = 2; row < height - 2; row++) {
          if (tiles[row][col].terrain !== TerrainType.WATER) continue
          let top = row - 1
          while (top > 0 && tiles[top][col].terrain === TerrainType.WATER) top--
          let bottom = row + 1
          while (bottom < height - 1 && tiles[bottom][col].terrain === TerrainType.WATER) bottom++
          const gap = bottom - top - 1
          if (gap < 2 || gap > 5) continue
          for (let r = top + 1; r < bottom; r++) {
            if ((r - (top + 1)) % 2 === 0) setTerrain(tiles[r][col], TerrainType.BRIDGE)
            else setTerrain(tiles[r][col], TerrainType.SAND)
            tiles[r][col].height = 1
          }
          break
        }
      }
    }
  }

  const addUrbanRoadGrid = (): void => {
    const spacing = 9 + Math.floor(rng() * 3)
    const rowStart = 3 + Math.floor(rng() * 3)
    const colStart = 3 + Math.floor(rng() * 3)
    for (let row = rowStart; row < height; row += spacing) {
      for (let col = 0; col < width; col++) {
        if (tiles[row][col].terrain === TerrainType.WATER) setTerrain(tiles[row][col], TerrainType.BRIDGE)
        else if (tiles[row][col].terrain !== TerrainType.ROCK) setTerrain(tiles[row][col], TerrainType.ROAD)
        tiles[row][col].height = 1
      }
    }
    for (let col = colStart; col < width; col += spacing) {
      for (let row = 0; row < height; row++) {
        if (tiles[row][col].terrain === TerrainType.WATER) setTerrain(tiles[row][col], TerrainType.BRIDGE)
        else if (tiles[row][col].terrain !== TerrainType.ROCK) setTerrain(tiles[row][col], TerrainType.ROAD)
        tiles[row][col].height = 1
      }
    }

    const blockCount = Math.floor((width * height) * 0.0012)
    for (let i = 0; i < blockCount; i++) {
      const bw = 2 + Math.floor(rng() * 3)
      const bh = 2 + Math.floor(rng() * 3)
      const cx = 6 + Math.floor(rng() * (width - 12))
      const cy = 6 + Math.floor(rng() * (height - 12))
      for (let r = cy; r < cy + bh; r++) {
        for (let c = cx; c < cx + bw; c++) {
          if (!inBounds(c, r)) continue
          if (tiles[r][c].terrain === TerrainType.WATER) continue
          setTerrain(tiles[r][c], TerrainType.ROCK)
        }
      }
    }
  }

  if (resolved === 'continental') {
    // Keep continent maps mostly connected: avoid guaranteed rivers/lakes that fragment land.
    if (rng() > 0.9) {
      carveMeanderingRiver(rng() > 0.5, 1)
    }
  } else if (resolved === 'islands') {
    connectIslandStraits(4 + Math.floor(rng() * 3))
  } else if (resolved === 'desert') {
    const oasisCount = 3 + Math.floor(rng() * 3)
    for (let i = 0; i < oasisCount; i++) {
      const ox = 8 + Math.floor(rng() * (width - 16))
      const oy = 8 + Math.floor(rng() * (height - 16))
      const oasisR = 2 + Math.floor(rng() * 2)
      carveLake(ox, oy, oasisR)
      for (let r = oy - (oasisR + 2); r <= oy + oasisR + 2; r++) {
        for (let c = ox - (oasisR + 2); c <= ox + oasisR + 2; c++) {
          if (!inBounds(c, r)) continue
          if (tiles[r][c].terrain === TerrainType.WATER) continue
          if (Math.hypot(c - ox, r - oy) <= oasisR + 1.7) setTerrain(tiles[r][c], TerrainType.GRASS)
        }
      }
    }
  } else if (resolved === 'arctic') {
    carveMeanderingRiver(rng() > 0.4, 1)
    for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
      carveLake(
        8 + Math.floor(rng() * (width - 16)),
        8 + Math.floor(rng() * (height - 16)),
        2 + Math.floor(rng() * 4),
      )
    }
  } else if (resolved === 'urban') {
    addUrbanRoadGrid()
    if (rng() > 0.4) carveMeanderingRiver(rng() > 0.5, 1)
  }

  // Smooth/cohere water bodies: remove tiny puddles and connect near-water voids.
  for (let pass = 0; pass < 2; pass++) {
    const edits: Array<{ col: number; row: number; terrain: TerrainType }> = []
    for (let row = 1; row < height - 1; row++) {
      for (let col = 1; col < width - 1; col++) {
        const tile = tiles[row][col]
        const waterNeighbors = countNeighbors(col, row, t => t.terrain === TerrainType.WATER)
        if (tile.terrain !== TerrainType.WATER && waterNeighbors >= 6) {
          if (resolved !== 'continental' || countNeighbors(col, row, t => t.terrain === TerrainType.WATER, false) >= 3) {
            edits.push({ col, row, terrain: TerrainType.WATER })
          }
        }
        if (tile.terrain === TerrainType.WATER && waterNeighbors <= 1) edits.push({ col, row, terrain: TerrainType.SAND })
      }
    }
    for (const e of edits) setTerrain(tiles[e.row][e.col], e.terrain)
  }

  const visitedWater = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (tiles[row][col].terrain !== TerrainType.WATER) continue
      const idx = row * width + col
      if (visitedWater[idx]) continue
      const queue: TileCoord[] = [{ col, row }]
      const comp: TileCoord[] = []
      visitedWater[idx] = 1
      let touchesEdge = false
      while (queue.length > 0) {
        const cur = queue.pop()!
        comp.push(cur)
        if (cur.col === 0 || cur.row === 0 || cur.col === width - 1 || cur.row === height - 1) touchesEdge = true
        for (const [dc, dr] of n4) {
          const nc = cur.col + dc, nr = cur.row + dr
          if (!inBounds(nc, nr) || tiles[nr][nc].terrain !== TerrainType.WATER) continue
          const nIdx = nr * width + nc
          if (visitedWater[nIdx]) continue
          visitedWater[nIdx] = 1
          queue.push({ col: nc, row: nr })
        }
      }
      if (comp.length < cfg.tinyWaterSize && !touchesEdge) {
        for (const p of comp) setTerrain(tiles[p.row][p.col], TerrainType.SAND)
      }
    }
  }

  if (resolved === 'continental') {
    // Keep one edge-connected ocean component and fill disconnected/inland water to preserve land continuity.
    const visited = new Uint8Array(width * height)
    const components: Array<{ cells: TileCoord[]; touchesEdge: boolean }> = []
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (tiles[row][col].terrain !== TerrainType.WATER) continue
        const idx = row * width + col
        if (visited[idx]) continue
        const queue: TileCoord[] = [{ col, row }]
        const cells: TileCoord[] = []
        let touchesEdge = false
        visited[idx] = 1
        while (queue.length > 0) {
          const cur = queue.pop()!
          cells.push(cur)
          if (cur.col === 0 || cur.row === 0 || cur.col === width - 1 || cur.row === height - 1) touchesEdge = true
          for (const [dc, dr] of n4) {
            const nc = cur.col + dc
            const nr = cur.row + dr
            if (!inBounds(nc, nr) || tiles[nr][nc].terrain !== TerrainType.WATER) continue
            const nIdx = nr * width + nc
            if (visited[nIdx]) continue
            visited[nIdx] = 1
            queue.push({ col: nc, row: nr })
          }
        }
        components.push({ cells, touchesEdge })
      }
    }

    let primaryOcean: TileCoord[] = []
    for (const comp of components) {
      if (!comp.touchesEdge) continue
      if (comp.cells.length > primaryOcean.length) primaryOcean = comp.cells
    }

    const keepWater = new Uint8Array(width * height)
    for (const p of primaryOcean) keepWater[p.row * width + p.col] = 1
    for (const comp of components) {
      for (const p of comp.cells) {
        if (keepWater[p.row * width + p.col]) continue
        setTerrain(tiles[p.row][p.col], TerrainType.SAND)
      }
    }

    // Trim narrow inland channels/fjords so land stays predominantly continuous.
    for (let pass = 0; pass < 2; pass++) {
      const fillCuts: TileCoord[] = []
      for (let row = 1; row < height - 1; row++) {
        for (let col = 1; col < width - 1; col++) {
          if (tiles[row][col].terrain !== TerrainType.WATER) continue
          const landSides = countNeighbors(col, row, t => t.terrain !== TerrainType.WATER, false)
          if (landSides >= 3) fillCuts.push({ col, row })
        }
      }
      for (const p of fillCuts) setTerrain(tiles[p.row][p.col], TerrainType.SAND)
    }
  }

  // Add shore/beach transition and smooth grass/sand boundaries.
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const tile = tiles[row][col]
      if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.BRIDGE) continue
      const nearWater = countNeighbors(col, row, t => t.terrain === TerrainType.WATER, false) > 0
      if (nearWater && (tile.terrain === TerrainType.GRASS || tile.terrain === TerrainType.FOREST)) {
        setTerrain(tile, TerrainType.SAND)
      }
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const updates: Array<{ col: number; row: number; terrain: TerrainType }> = []
    for (let row = 1; row < height - 1; row++) {
      for (let col = 1; col < width - 1; col++) {
        const tile = tiles[row][col]
        if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.BRIDGE || tile.terrain === TerrainType.ROAD) continue
        const sandNeighbors = countNeighbors(col, row, t => t.terrain === TerrainType.SAND)
        if (tile.terrain === TerrainType.GRASS && sandNeighbors >= 5) updates.push({ col, row, terrain: TerrainType.SAND })
        if (tile.terrain === TerrainType.SAND && sandNeighbors <= 1 && countNeighbors(col, row, t => t.terrain === TerrainType.WATER) === 0) {
          updates.push({ col, row, terrain: TerrainType.GRASS })
        }
      }
    }
    for (const u of updates) setTerrain(tiles[u.row][u.col], u.terrain)
  }

  // Reduce cluttered rock into passable rough ground and enforce max 10-12% rocks.
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const tile = tiles[row][col]
      if (tile.terrain !== TerrainType.ROCK) continue
      const rockNeighbors = countNeighbors(col, row, t => t.terrain === TerrainType.ROCK)
      if (rockNeighbors <= 2) setTerrain(tile, TerrainType.SAND)
    }
  }

  const rockCells: Array<{ col: number; row: number; keepScore: number }> = []
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (tiles[row][col].terrain !== TerrainType.ROCK) continue
      const clusterScore = countNeighbors(col, row, t => t.terrain === TerrainType.ROCK)
      const chokeScore = countNeighbors(col, row, t => t.terrain !== TerrainType.WATER && t.terrain !== TerrainType.ROCK, false)
      rockCells.push({ col, row, keepScore: clusterScore * 2 + chokeScore + rng() * 0.01 })
    }
  }
  const rockCap = Math.floor(width * height * cfg.maxRockRatio)
  if (rockCells.length > rockCap) {
    rockCells.sort((a, b) => a.keepScore - b.keepScore)
    for (let i = 0; i < rockCells.length - rockCap; i++) {
      const t = rockCells[i]
      setTerrain(tiles[t.row][t.col], TerrainType.SAND)
    }
  }

  // Flat terrain — all tiles at uniform height.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      tiles[row][col].height = 1
    }
  }

  // Place ore/gems in coherent land patches.
  const oreCount = Math.floor(width * height * 0.0008 * cfg.oreMultiplier)
  for (let i = 0; i < oreCount; i++) {
    const cx = Math.floor(rng() * (width - 20)) + 10
    const cy = Math.floor(rng() * (height - 20)) + 10
    const clusterSize = 5 + Math.floor(rng() * 7)
    const isGems = rng() < 0.18
    for (let j = 0; j < clusterSize; j++) {
      const dx = Math.floor((rng() - 0.5) * 8)
      const dy = Math.floor((rng() - 0.5) * 8)
      const tx = cx + dx, ty = cy + dy
      if (!inBounds(tx, ty)) continue
      const tile = tiles[ty][tx]
      if (tile.terrain !== TerrainType.GRASS && tile.terrain !== TerrainType.SAND) continue
      tile.terrain = isGems ? TerrainType.GEMS : TerrainType.ORE
      tile.oreAmount = isGems ? GEMS_TILE_MAX : ORE_TILE_MAX
      tile.passable = true
      tile.buildable = false
    }
  }

  // Compute deterministic template-aware start positions.
  const startPositions: Position[] = computeStartPositions(tiles, width, height, seed, resolved, startDistanceMode)

  // Clear terrain around start positions (make them buildable grass)
  for (const sp of startPositions) {
    const radius = 5
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = Math.floor(sp.x / TILE_SIZE) + dx
        const ty = Math.floor(sp.y / TILE_SIZE) + dy
        if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
          tiles[ty][tx].terrain = TerrainType.GRASS
          tiles[ty][tx].height = 1
          tiles[ty][tx].passable = true
          tiles[ty][tx].buildable = true
          tiles[ty][tx].oreAmount = 0
        }
      }
    }
  }

  // Guarantee reachable ore near each spawn so the opening harvester loop
  // is reliable regardless of random ore cluster generation.
  const spawnOreRng = makePRNG((seed ^ 0x51f15e33 ^ (width << 8) ^ height) >>> 0)
  for (const sp of startPositions) {
    const spCol = Math.floor(sp.x / TILE_SIZE)
    const spRow = Math.floor(sp.y / TILE_SIZE)
    ensureOreFieldNearSpawn(tiles, width, height, spCol, spRow, spawnOreRng)
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

const SPAWN_EDGE_MARGIN = 6
const SPAWN_MIN_DISTANCE_RATIO = 0.25
const SPAWN_ORE_RADIUS_TILES = 15
const SPAWN_ORE_CLUSTER_RADIUS = 3

type ResolvedMapTemplate = Exclude<MapTemplate, 'random'>

interface SpawnCandidate {
  col: number
  row: number
  centerDist: number
  edgeDist: number
}

function computeSpawnCountForSize(w: number, h: number): number {
  const maxDim = Math.max(w, h)
  if (maxDim <= 64) return 4
  if (maxDim <= 128) return 6
  return 8
}

function spawnTemplateOffset(template: ResolvedMapTemplate): number {
  switch (template) {
    case 'continental': return 0x11f00d1
    case 'islands': return 0x22f00d2
    case 'desert': return 0x33f00d3
    case 'arctic': return 0x44f00d4
    case 'urban': return 0x55f00d5
  }
}

function spawnDistanceOffset(mode: StartDistanceMode): number {
  return mode === 'close_battle' ? 0x66a12f3 : 0x9bb31d7
}

function isSpawnableTile(tile: TileData): boolean {
  if (!tile.passable || !tile.buildable) return false
  return tile.terrain !== TerrainType.WATER && tile.terrain !== TerrainType.ROCK
}

function inSpawnBounds(col: number, row: number, w: number, h: number, margin = SPAWN_EDGE_MARGIN): boolean {
  return col >= margin && col < w - margin && row >= margin && row < h - margin
}

function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.hypot(a.col - b.col, a.row - b.row)
}

function hasTerrainWithinRadius(
  tiles: TileData[][],
  col: number,
  row: number,
  radius: number,
  terrain: TerrainType,
): boolean {
  const h = tiles.length
  const w = tiles[0]?.length ?? 0
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = col + dx
      const ty = row + dy
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue
      if (tiles[ty][tx].terrain === terrain) return true
    }
  }
  return false
}

function hasOreWithinRadius(
  tiles: TileData[][],
  col: number,
  row: number,
  radius = SPAWN_ORE_RADIUS_TILES,
): boolean {
  const h = tiles.length
  const w = tiles[0]?.length ?? 0
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const tx = col + dx
      const ty = row + dy
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue
      const t = tiles[ty][tx]
      if ((t.terrain === TerrainType.ORE || t.terrain === TerrainType.GEMS) && t.oreAmount > 0) return true
    }
  }
  return false
}

function collectSpawnCandidates(
  tiles: TileData[][],
  w: number,
  h: number,
  template: ResolvedMapTemplate,
): SpawnCandidate[] {
  const centerCol = (w - 1) * 0.5
  const centerRow = (h - 1) * 0.5
  const edgeBand = Math.max(8, Math.floor(Math.min(w, h) * 0.18))
  const all: SpawnCandidate[] = []
  const preferred: SpawnCandidate[] = []

  for (let row = SPAWN_EDGE_MARGIN; row < h - SPAWN_EDGE_MARGIN; row++) {
    for (let col = SPAWN_EDGE_MARGIN; col < w - SPAWN_EDGE_MARGIN; col++) {
      const tile = tiles[row][col]
      if (!isSpawnableTile(tile)) continue
      const edgeDist = Math.min(col, row, w - 1 - col, h - 1 - row)
      const centerDist = Math.hypot(col - centerCol, row - centerRow)
      const candidate: SpawnCandidate = { col, row, centerDist, edgeDist }
      all.push(candidate)

      if (template === 'continental' && edgeDist <= edgeBand) preferred.push(candidate)
      if (template === 'desert' && hasTerrainWithinRadius(tiles, col, row, 5, TerrainType.WATER)) preferred.push(candidate)
      if (template === 'arctic' && tile.terrain === TerrainType.GRASS) preferred.push(candidate)
    }
  }

  if (template === 'urban' || template === 'islands') return all
  return preferred.length > 0 ? preferred : all
}

function pickDistributedSpawns(
  candidates: SpawnCandidate[],
  count: number,
  w: number,
  h: number,
  minDistance: number,
  rng: () => number,
): TileCoord[] {
  if (count <= 0 || candidates.length === 0) return []
  const selected: TileCoord[] = []
  const used = new Set<number>()
  const centerCol = (w - 1) * 0.5
  const centerRow = (h - 1) * 0.5
  const targetRadius = Math.min(w, h) * 0.34
  const baseAngle = rng() * Math.PI * 2

  while (selected.length < count) {
    let bestIdx = -1
    let bestScore = Number.NEGATIVE_INFINITY

    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue
      const c = candidates[i]

      let nearest = Number.POSITIVE_INFINITY
      for (const s of selected) {
        nearest = Math.min(nearest, tileDistance(c, s))
      }
      if (selected.length > 0 && nearest < minDistance) continue

      const angle = Math.atan2(c.row - centerRow, c.col - centerCol)
      const expectedAngle = baseAngle + (selected.length / count) * Math.PI * 2
      let angleDiff = Math.abs(angle - expectedAngle)
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff
      const centerPenalty = Math.abs(c.centerDist - targetRadius)
      const spacingScore = selected.length === 0 ? c.centerDist : nearest
      const score = spacingScore * 1.25 - centerPenalty * 0.9 - angleDiff * 5 + rng() * 0.001
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx)
      selected.push({ col: candidates[bestIdx].col, row: candidates[bestIdx].row })
      continue
    }
    break
  }

  return selected
}

function collectSpawnableComponents(tiles: TileData[][], w: number, h: number): TileCoord[][] {
  const visited = new Uint8Array(w * h)
  const components: TileCoord[][] = []
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

  for (let row = SPAWN_EDGE_MARGIN; row < h - SPAWN_EDGE_MARGIN; row++) {
    for (let col = SPAWN_EDGE_MARGIN; col < w - SPAWN_EDGE_MARGIN; col++) {
      const idx = row * w + col
      if (visited[idx]) continue
      if (!isSpawnableTile(tiles[row][col])) continue

      const queue: TileCoord[] = [{ col, row }]
      visited[idx] = 1
      const comp: TileCoord[] = []

      while (queue.length > 0) {
        const cur = queue.pop()!
        comp.push(cur)
        for (const [dx, dy] of dirs) {
          const nx = cur.col + dx
          const ny = cur.row + dy
          if (!inSpawnBounds(nx, ny, w, h)) continue
          const nIdx = ny * w + nx
          if (visited[nIdx]) continue
          visited[nIdx] = 1
          if (!isSpawnableTile(tiles[ny][nx])) continue
          queue.push({ col: nx, row: ny })
        }
      }

      if (comp.length > 0) components.push(comp)
    }
  }

  components.sort((a, b) => b.length - a.length)
  return components
}

function pickIslandSpawns(
  tiles: TileData[][],
  w: number,
  h: number,
  count: number,
  minDistance: number,
  rng: () => number,
): TileCoord[] {
  const centerCol = (w - 1) * 0.5
  const centerRow = (h - 1) * 0.5
  const selected: TileCoord[] = []
  const components = collectSpawnableComponents(tiles, w, h)
  for (const comp of components) {
    if (selected.length >= count) break
    if (comp.length < 24) continue
    let best: TileCoord | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (const cell of comp) {
      let nearest = Number.POSITIVE_INFINITY
      for (const s of selected) nearest = Math.min(nearest, tileDistance(cell, s))
      if (selected.length > 0 && nearest < minDistance) continue
      const centerDist = Math.hypot(cell.col - centerCol, cell.row - centerRow)
      const edgeDist = Math.min(cell.col, cell.row, w - 1 - cell.col, h - 1 - cell.row)
      const score = centerDist * 0.8 + edgeDist * 0.2 + rng() * 0.001
      if (score > bestScore) {
        best = cell
        bestScore = score
      }
    }
    if (best) selected.push(best)
  }
  return selected
}

function pickUrbanQuadrantSpawns(
  candidates: SpawnCandidate[],
  w: number,
  h: number,
  minDistance: number,
): TileCoord[] {
  const cx = (w - 1) * 0.5
  const cy = (h - 1) * 0.5
  const quadrantCenters: TileCoord[] = [
    { col: Math.floor(w * 0.25), row: Math.floor(h * 0.25) },
    { col: Math.floor(w * 0.75), row: Math.floor(h * 0.25) },
    { col: Math.floor(w * 0.75), row: Math.floor(h * 0.75) },
    { col: Math.floor(w * 0.25), row: Math.floor(h * 0.75) },
  ]

  const byQuadrant: SpawnCandidate[][] = [[], [], [], []]
  for (const c of candidates) {
    const q = (c.col < cx ? 0 : 1) + (c.row < cy ? 0 : 2)
    byQuadrant[q].push(c)
  }

  const selected: TileCoord[] = []
  for (let i = 0; i < 4; i++) {
    const pool = byQuadrant[i]
    if (pool.length === 0) continue
    pool.sort((a, b) => tileDistance(a, quadrantCenters[i]) - tileDistance(b, quadrantCenters[i]))
    for (const cand of pool) {
      const valid = selected.every((s) => tileDistance(s, cand) >= minDistance)
      if (!valid) continue
      selected.push({ col: cand.col, row: cand.row })
      break
    }
  }
  return selected
}

function nudgeSpawnToValid(
  desired: TileCoord,
  tiles: TileData[][],
  w: number,
  h: number,
  rng: () => number,
): TileCoord | null {
  if (inSpawnBounds(desired.col, desired.row, w, h) && isSpawnableTile(tiles[desired.row][desired.col])) {
    return desired
  }
  const offset = Math.floor(rng() * 4)
  const maxRadius = 14
  for (let r = 1; r <= maxRadius; r++) {
    for (let step = 0; step < 4; step++) {
      const side = (step + offset) % 4
      for (let i = -r; i <= r; i++) {
        const col = side === 0 ? desired.col - r : side === 1 ? desired.col + i : side === 2 ? desired.col + r : desired.col + i
        const row = side === 0 ? desired.row + i : side === 1 ? desired.row - r : side === 2 ? desired.row + i : desired.row + r
        if (!inSpawnBounds(col, row, w, h)) continue
        if (isSpawnableTile(tiles[row][col])) return { col, row }
      }
    }
  }
  return null
}

function computeStartPositions(
  tiles: TileData[][],
  w: number,
  h: number,
  seed: number,
  template: ResolvedMapTemplate,
  startDistanceMode: StartDistanceMode = 'long_range',
): Position[] {
  const count = computeSpawnCountForSize(w, h)
  const rng = makePRNG((seed ^ spawnTemplateOffset(template) ^ spawnDistanceOffset(startDistanceMode) ^ (w << 16) ^ h) >>> 0)
  // close_battle: spawns can be ~40% closer; long_range: standard 25% map-diagonal minimum
  const minDistRatio = startDistanceMode === 'close_battle'
    ? SPAWN_MIN_DISTANCE_RATIO * 0.6
    : SPAWN_MIN_DISTANCE_RATIO
  const minDistance = Math.hypot(w, h) * minDistRatio
  const candidates = collectSpawnCandidates(tiles, w, h, template)

  const selectedTiles: TileCoord[] = []
  if (template === 'islands') {
    selectedTiles.push(...pickIslandSpawns(tiles, w, h, count, minDistance, rng))
  } else if (template === 'urban') {
    selectedTiles.push(...pickUrbanQuadrantSpawns(candidates, w, h, minDistance))
  }

  if (selectedTiles.length < count) {
    const remaining = count - selectedTiles.length
    const selectedKey = new Set(selectedTiles.map((s) => s.row * w + s.col))
    const pool = candidates.filter((c) => !selectedKey.has(c.row * w + c.col))
    const extra = pickDistributedSpawns(pool, remaining, w, h, minDistance, rng)
    selectedTiles.push(...extra)
  }

  if (selectedTiles.length < count) {
    const cx = w * 0.5
    const cy = h * 0.5
    const rx = cx - SPAWN_EDGE_MARGIN - 1
    const ry = cy - SPAWN_EDGE_MARGIN - 1
    for (let i = 0; i < count * 2 && selectedTiles.length < count; i++) {
      const angle = rng() * Math.PI * 2 + (i / count) * Math.PI * 2
      const desired = {
        col: Math.round(cx + Math.cos(angle) * rx),
        row: Math.round(cy + Math.sin(angle) * ry),
      }
      const nudged = nudgeSpawnToValid(desired, tiles, w, h, rng)
      if (!nudged) continue
      const farEnough = selectedTiles.every((s) => tileDistance(s, nudged) >= minDistance)
      if (!farEnough) continue
      if (selectedTiles.some((s) => s.col === nudged.col && s.row === nudged.row)) continue
      selectedTiles.push(nudged)
    }
  }

  if (selectedTiles.length < count) {
    for (const cand of candidates) {
      if (selectedTiles.length >= count) break
      const alreadyUsed = selectedTiles.some((s) => s.col === cand.col && s.row === cand.row)
      if (alreadyUsed) continue
      const farEnough = selectedTiles.every((s) => tileDistance(s, cand) >= minDistance)
      if (!farEnough) continue
      selectedTiles.push({ col: cand.col, row: cand.row })
    }
  }

  const finalTiles: TileCoord[] = []
  for (const tile of selectedTiles) {
    if (finalTiles.length >= count) break
    const nudged = nudgeSpawnToValid(tile, tiles, w, h, rng) ?? tile
    const farEnough = finalTiles.every((s) => tileDistance(s, nudged) >= minDistance)
    if (!farEnough) continue
    finalTiles.push(nudged)
  }

  if (finalTiles.length < count) {
    for (const cand of candidates) {
      if (finalTiles.length >= count) break
      const nudged = nudgeSpawnToValid(cand, tiles, w, h, rng) ?? { col: cand.col, row: cand.row }
      const duplicate = finalTiles.some((s) => s.col === nudged.col && s.row === nudged.row)
      if (duplicate) continue
      const farEnough = finalTiles.every((s) => tileDistance(s, nudged) >= minDistance)
      if (!farEnough) continue
      finalTiles.push(nudged)
    }
  }

  return finalTiles.map((tile) => ({ x: tile.col * TILE_SIZE, y: tile.row * TILE_SIZE }))
}

function ensureOreFieldNearSpawn(
  tiles: TileData[][],
  w: number,
  h: number,
  spawnCol: number,
  spawnRow: number,
  rng: () => number,
): void {
  if (hasOreWithinRadius(tiles, spawnCol, spawnRow, SPAWN_ORE_RADIUS_TILES)) return

  let chosen: TileCoord | null = null
  const centerCol = Math.floor(w / 2)
  const centerRow = Math.floor(h / 2)
  const dirCol = spawnCol <= centerCol ? 1 : -1
  const dirRow = spawnRow <= centerRow ? 1 : -1
  const baseCol = spawnCol + dirCol * 8
  const baseRow = spawnRow + dirRow * 8

  for (let radius = 0; radius <= 6 && !chosen; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const col = baseCol + dx
        const row = baseRow + dy
        if (!inSpawnBounds(col, row, w, h, 4)) continue
        const spawnDist = Math.hypot(col - spawnCol, row - spawnRow)
        if (spawnDist > SPAWN_ORE_RADIUS_TILES || spawnDist < 7) continue
        const tile = tiles[row][col]
        if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.ROCK) continue
        chosen = { col, row }
        break
      }
      if (chosen) break
    }
  }

  if (!chosen) {
    for (let tries = 0; tries < 40 && !chosen; tries++) {
      const angle = rng() * Math.PI * 2
      const dist = 7 + Math.floor(rng() * (SPAWN_ORE_RADIUS_TILES - 7))
      const col = Math.round(spawnCol + Math.cos(angle) * dist)
      const row = Math.round(spawnRow + Math.sin(angle) * dist)
      if (!inSpawnBounds(col, row, w, h, 4)) continue
      const tile = tiles[row][col]
      if (tile.terrain === TerrainType.WATER || tile.terrain === TerrainType.ROCK) continue
      chosen = { col, row }
    }
  }

  if (!chosen) return

  for (let dy = -SPAWN_ORE_CLUSTER_RADIUS; dy <= SPAWN_ORE_CLUSTER_RADIUS; dy++) {
    for (let dx = -SPAWN_ORE_CLUSTER_RADIUS; dx <= SPAWN_ORE_CLUSTER_RADIUS; dx++) {
      if (dx * dx + dy * dy > SPAWN_ORE_CLUSTER_RADIUS * SPAWN_ORE_CLUSTER_RADIUS) continue
      const col = chosen.col + dx
      const row = chosen.row + dy
      if (!inSpawnBounds(col, row, w, h, 2)) continue
      const t = tiles[row][col]
      if (t.terrain === TerrainType.WATER || t.terrain === TerrainType.ROCK) continue
      t.terrain = TerrainType.ORE
      t.oreAmount = ORE_TILE_MAX
      t.height = 1
      t.passable = true
      t.buildable = false
    }
  }
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
  private damagedBridgeTiles: Set<number> = new Set()
  private debugGridEnabled = false

  constructor(scene: Phaser.Scene, width?: number, height?: number, seed?: number, template?: MapTemplate, startDistanceMode?: StartDistanceMode) {
    this.scene = scene
    this.data = generateMapData(width, height, seed, template, startDistanceMode)
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
    this.damagedBridgeTiles.clear()

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

    // Positional shade variation so grass doesn't look flat/repetitive.
    if (tile.terrain === TerrainType.GRASS) {
      const v = this.tileHash(col, row, 901)
      const grassFactor = v < 0.33 ? 0.94 : v < 0.66 ? 1.0 : 1.07
      base = scaleColor(base, grassFactor)
    }

    // Shore tint where land meets water.
    if (tile.terrain === TerrainType.GRASS || tile.terrain === TerrainType.FOREST || tile.terrain === TerrainType.SAND) {
      const nearWater =
        this.getTile(col, row - 1)?.terrain === TerrainType.WATER
        || this.getTile(col - 1, row)?.terrain === TerrainType.WATER
        || this.getTile(col + 1, row)?.terrain === TerrainType.WATER
        || this.getTile(col, row + 1)?.terrain === TerrainType.WATER
      if (nearWater && tile.terrain !== TerrainType.SAND) {
        base = lerpColor(base, 0xd8c596, 0.24)
      }
    }

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
    const treeCount = 2 + Math.floor(this.tileHash(col, row, 40) * 3)
    for (let i = 0; i < treeCount; i++) {
      const tx = this.tileHash(col, row, 50 + i) * 24 + 18
      const ty = this.tileHash(col, row, 60 + i) * 8 + 10
      g.fillStyle(0x0a1a08, 0.25)
      g.fillEllipse(px + tx, py + ty + 7, 9, 4)
      g.fillStyle(0x2a6a22, 0.95)
      g.fillTriangle(
        px + tx, py + ty - 6,
        px + tx - 5, py + ty + 4,
        px + tx + 5, py + ty + 4,
      )
      g.fillStyle(0x1f5a1b, 1)
      g.fillCircle(px + tx, py + ty - 1, 3)
    }
  }

  private isRoadLikeTerrain(terrain: TerrainType): boolean {
    return terrain === TerrainType.ROAD || terrain === TerrainType.BRIDGE
  }

  private drawRoadDetail(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number): void {
    const top = this.getTile(col, row - 1)
    const bottom = this.getTile(col, row + 1)
    const left = this.getTile(col - 1, row)
    const right = this.getTile(col + 1, row)
    const cx = px + ISO_TILE_W / 2
    const cy = py + ISO_TILE_H / 2

    const segments: Array<[number, number]> = []
    if (top && this.isRoadLikeTerrain(top.terrain)) segments.push([px + ISO_TILE_W / 2, py + 2])
    if (bottom && this.isRoadLikeTerrain(bottom.terrain)) segments.push([px + ISO_TILE_W / 2, py + ISO_TILE_H - 2])
    if (left && this.isRoadLikeTerrain(left.terrain)) segments.push([px + 2, py + ISO_TILE_H / 2])
    if (right && this.isRoadLikeTerrain(right.terrain)) segments.push([px + ISO_TILE_W - 2, py + ISO_TILE_H / 2])

    g.lineStyle(4, 0x3f3f3f, 0.8)
    for (const [ex, ey] of segments) g.lineBetween(cx, cy, ex, ey)
    g.lineStyle(2, 0x7b7b7b, 0.45)
    for (const [ex, ey] of segments) g.lineBetween(cx, cy, (cx + ex) * 0.5, (cy + ey) * 0.5)
    if (segments.length === 0) {
      g.fillStyle(0x4a4a4a, 0.5)
      g.fillCircle(cx, cy, 3)
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
    const isLand = tile.terrain !== TerrainType.WATER && tile.terrain !== TerrainType.BRIDGE
    if (isLand) {
      g.lineStyle(2, 0xd8c596, 0.36)
      if (above?.terrain === TerrainType.WATER) g.lineBetween(px + ISO_TILE_W / 2, py + 1, px + 2, py + ISO_TILE_H / 2)
      if (left?.terrain === TerrainType.WATER) g.lineBetween(px + ISO_TILE_W / 2, py + 1, px + ISO_TILE_W - 2, py + ISO_TILE_H / 2)
      if (right?.terrain === TerrainType.WATER) g.lineBetween(px + ISO_TILE_W - 1, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H - 1)
      if (below?.terrain === TerrainType.WATER) g.lineBetween(px + 1, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H - 1)
    }

    const sandBlend = (other?: TileData | null) => !!other && ((tile.terrain === TerrainType.GRASS && other.terrain === TerrainType.SAND) || (tile.terrain === TerrainType.SAND && other.terrain === TerrainType.GRASS))
    g.lineStyle(1, 0xcdb47f, 0.28)
    if (sandBlend(above)) g.lineBetween(px + ISO_TILE_W / 2, py + 3, px + 3, py + ISO_TILE_H / 2)
    if (sandBlend(left)) g.lineBetween(px + ISO_TILE_W / 2, py + 3, px + ISO_TILE_W - 3, py + ISO_TILE_H / 2)
    if (sandBlend(right)) g.lineBetween(px + ISO_TILE_W - 3, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H - 3)
    if (sandBlend(below)) g.lineBetween(px + 3, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H - 3)
  }

  private drawCliffEdges(g: Phaser.GameObjects.Graphics, px: number, py: number, col: number, row: number, tile: TileData): void {
    const n = this.getTile(col, row - 1)
    const w = this.getTile(col - 1, row)
    const s = this.getTile(col, row + 1)
    const e = this.getTile(col + 1, row)
    const nHigher = !!n && n.height > tile.height
    const wHigher = !!w && w.height > tile.height
    const sHigher = !!s && s.height > tile.height
    const eHigher = !!e && e.height > tile.height

    if (nHigher || wHigher) {
      const depth = 0.12 + Math.max((n?.height ?? tile.height) - tile.height, (w?.height ?? tile.height) - tile.height) * 0.08
      g.fillStyle(0x1a1a1a, depth)
      g.fillTriangle(
        px + ISO_TILE_W / 2, py + 1,
        px + 2, py + ISO_TILE_H / 2,
        px + ISO_TILE_W - 2, py + ISO_TILE_H / 2,
      )
    }
    if (sHigher) {
      g.lineStyle(3, 0x1a1a1a, 0.28 + (s.height - tile.height) * 0.13)
      g.lineBetween(px + 2, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H - 1)
    }
    if (eHigher) {
      g.lineStyle(3, 0x1a1a1a, 0.28 + (e.height - tile.height) * 0.13)
      g.lineBetween(px + ISO_TILE_W - 2, py + ISO_TILE_H / 2, px + ISO_TILE_W / 2, py + ISO_TILE_H - 1)
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
      const tile = this.getTile(col, row)
      if (!tile) continue
      const screen = tileToScreen(col, row)
      const px = screen.x + offsetX
      const py = screen.y - (tile.height - 1) * 4
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
      const py = screen.y - (tile.height - 1) * 4
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

  isDamagedBridge(col: number, row: number): boolean {
    return this.damagedBridgeTiles.has(this.key(col, row))
  }

  /** Destroy a bridge tile into impassable water. */
  damageBridgeAt(col: number, row: number): boolean {
    const tile = this.getTile(col, row)
    if (!tile || tile.terrain !== TerrainType.BRIDGE) return false

    tile.terrain = TerrainType.WATER
    tile.height = 0
    tile.passable = false
    tile.buildable = false
    tile.oreAmount = 0
    this.damagedBridgeTiles.add(this.key(col, row))
    if (!this.waterTiles.some(t => t.col === col && t.row === row)) {
      this.waterTiles.push({ col, row })
    }
    this.redrawTile(col, row)
    this.renderAnimatedTiles()
    return true
  }

  /** Restore a previously damaged bridge tile. */
  repairBridgeAt(col: number, row: number): boolean {
    const key = this.key(col, row)
    if (!this.damagedBridgeTiles.has(key)) return false
    const tile = this.getTile(col, row)
    if (!tile) {
      this.damagedBridgeTiles.delete(key)
      return false
    }

    tile.terrain = TerrainType.BRIDGE
    tile.height = 1
    tile.passable = true
    tile.buildable = false
    tile.oreAmount = 0
    this.damagedBridgeTiles.delete(key)
    this.waterTiles = this.waterTiles.filter(t => !(t.col === col && t.row === row))
    this.redrawTile(col, row)
    this.renderAnimatedTiles()
    return true
  }

  /** Find nearest damaged bridge center near a world-space point. */
  findDamagedBridgeNear(worldX: number, worldY: number, radiusTiles = 2): Position | null {
    const origin = this.worldToTile(worldX, worldY)
    let best: TileCoord | null = null
    let bestDist = Infinity
    for (let dr = -radiusTiles; dr <= radiusTiles; dr++) {
      for (let dc = -radiusTiles; dc <= radiusTiles; dc++) {
        const tc = origin.col + dc
        const tr = origin.row + dr
        if (!this.isDamagedBridge(tc, tr)) continue
        const d = Math.hypot(dc, dr)
        if (d < bestDist) {
          bestDist = d
          best = { col: tc, row: tr }
        }
      }
    }
    return best ? this.tileToWorld(best.col, best.row) : null
  }

  /** Repair nearest damaged bridge near world-space point and return repaired tile center. */
  repairDamagedBridgeNear(worldX: number, worldY: number, radiusTiles = 2): Position | null {
    const origin = this.worldToTile(worldX, worldY)
    let best: TileCoord | null = null
    let bestDist = Infinity
    for (let dr = -radiusTiles; dr <= radiusTiles; dr++) {
      for (let dc = -radiusTiles; dc <= radiusTiles; dc++) {
        const tc = origin.col + dc
        const tr = origin.row + dr
        if (!this.isDamagedBridge(tc, tr)) continue
        const d = Math.hypot(dc, dr)
        if (d < bestDist) {
          bestDist = d
          best = { col: tc, row: tr }
        }
      }
    }
    if (!best) return null
    if (!this.repairBridgeAt(best.col, best.row)) return null
    return this.tileToWorld(best.col, best.row)
  }

  /** Damage all bridge tiles in circular area; returns number damaged. */
  damageBridgesInRadius(worldX: number, worldY: number, radiusPx: number): number {
    const origin = this.worldToTile(worldX, worldY)
    const rTiles = Math.ceil(radiusPx / TILE_SIZE) + 1
    let damaged = 0
    for (let dr = -rTiles; dr <= rTiles; dr++) {
      for (let dc = -rTiles; dc <= rTiles; dc++) {
        const tc = origin.col + dc
        const tr = origin.row + dr
        const center = this.tileToWorld(tc, tr)
        const dist = Phaser.Math.Distance.Between(worldX, worldY, center.x, center.y)
        if (dist > radiusPx) continue
        if (this.damageBridgeAt(tc, tr)) damaged++
      }
    }
    return damaged
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
      tile.height = 1
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

      const maxAmt = ORE_TILE_MAX
      tile.oreAmount = Math.min(maxAmt, tile.oreAmount + ORE_REGEN_RATE)

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
        const py = screen.y - (tile.height - 1) * 4
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
          case TerrainType.ROAD:
            this.drawRoadDetail(g, px, py, col, row)
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
