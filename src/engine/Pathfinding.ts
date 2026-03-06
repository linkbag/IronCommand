import type { TileCoord } from '../types'
import type { GameMap } from './GameMap'

// ── A* Pathfinding ────────────────────────────────────────────

interface AStarNode {
  col: number
  row: number
  g: number   // cost from start
  h: number   // heuristic to goal
  f: number   // g + h
  parent: AStarNode | null
}

const MAX_SEARCH_DEPTH = 2048  // tile nodes examined before giving up

function heuristic(a: TileCoord, b: TileCoord): number {
  // Octile distance (allows diagonal movement)
  const dx = Math.abs(a.col - b.col)
  const dy = Math.abs(a.row - b.row)
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)
}

/** Binary min-heap for efficient open list */
class MinHeap {
  private data: AStarNode[] = []

  push(node: AStarNode): void {
    this.data.push(node)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): AStarNode | undefined {
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.siftDown(0)
    }
    return top
  }

  get size(): number { return this.data.length }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.data[parent].f <= this.data[i].f) break
      ;[this.data[parent], this.data[i]] = [this.data[i], this.data[parent]]
      i = parent
    }
  }

  private siftDown(i: number): void {
    const n = this.data.length
    while (true) {
      let smallest = i
      const l = 2 * i + 1, r = 2 * i + 2
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r
      if (smallest === i) break
      ;[this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]]
      i = smallest
    }
  }
}

// 8-directional movement costs
const DIRS: Array<{ dc: number; dr: number; cost: number }> = [
  { dc:  0, dr: -1, cost: 1 },
  { dc:  0, dr:  1, cost: 1 },
  { dc: -1, dr:  0, cost: 1 },
  { dc:  1, dr:  0, cost: 1 },
  { dc: -1, dr: -1, cost: Math.SQRT2 },
  { dc:  1, dr: -1, cost: Math.SQRT2 },
  { dc: -1, dr:  1, cost: Math.SQRT2 },
  { dc:  1, dr:  1, cost: Math.SQRT2 },
]

function encodeCoord(col: number, row: number, width: number): number {
  return row * width + col
}

function reconstructPath(node: AStarNode): TileCoord[] {
  const path: TileCoord[] = []
  let cur: AStarNode | null = node
  while (cur) {
    path.unshift({ col: cur.col, row: cur.row })
    cur = cur.parent
  }
  return path
}

// ── Path cache ────────────────────────────────────────────────

interface CacheEntry {
  path: TileCoord[]
  tick: number  // game tick when cached
}

export class Pathfinder {
  private mapRef: GameMap
  private cache: Map<string, CacheEntry> = new Map()
  private cacheTTL = 300  // ticks before cache entry expires
  private currentTick = 0

  constructor(map: GameMap) {
    this.mapRef = map
  }

  tick(): void {
    this.currentTick++
    // Prune stale entries every 60 ticks
    if (this.currentTick % 60 === 0) {
      for (const [key, entry] of this.cache) {
        if (this.currentTick - entry.tick > this.cacheTTL) {
          this.cache.delete(key)
        }
      }
    }
  }

  /** Invalidate cached paths that pass through a given tile (e.g. building placed) */
  invalidateTile(col: number, row: number): void {
    for (const [key, entry] of this.cache) {
      if (entry.path.some(p => p.col === col && p.row === row)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Find path from start to goal.
   * @param isAir  true = ignore terrain passability (flying units)
   * @returns array of TileCoords, empty if no path found
   */
  findPath(start: TileCoord, goal: TileCoord, isAir = false): TileCoord[] {
    const { width, height } = this.mapRef.data
    // Bounds check
    if (
      start.col < 0 || start.col >= width || start.row < 0 || start.row >= height ||
      goal.col  < 0 || goal.col  >= width || goal.row  < 0 || goal.row  >= height
    ) return []

    // Same tile
    if (start.col === goal.col && start.row === goal.row) return [start]

    // Cache lookup
    const cacheKey = `${start.col},${start.row}>${goal.col},${goal.row}:${isAir ? 1 : 0}`
    const cached = this.cache.get(cacheKey)
    if (cached && this.currentTick - cached.tick <= this.cacheTTL) {
      return cached.path
    }

    // Goal must be reachable
    if (!isAir && !this.mapRef.isPassable(goal.col, goal.row)) {
      // Try to find nearest passable tile to goal
      const fallback = this.nearestPassable(goal, 3)
      if (!fallback) return []
      return this.findPath(start, fallback, isAir)
    }

    const openList = new MinHeap()
    const closedSet = new Set<number>()
    const nodeMap = new Map<number, AStarNode>()

    const startNode: AStarNode = {
      col: start.col,
      row: start.row,
      g: 0,
      h: heuristic(start, goal),
      f: heuristic(start, goal),
      parent: null,
    }
    openList.push(startNode)
    nodeMap.set(encodeCoord(start.col, start.row, width), startNode)

    let examined = 0

    while (openList.size > 0 && examined < MAX_SEARCH_DEPTH) {
      const current = openList.pop()!
      examined++

      if (current.col === goal.col && current.row === goal.row) {
        const path = reconstructPath(current)
        this.cache.set(cacheKey, { path, tick: this.currentTick })
        return path
      }

      const currentKey = encodeCoord(current.col, current.row, width)
      if (closedSet.has(currentKey)) continue
      closedSet.add(currentKey)

      for (const dir of DIRS) {
        const nc = current.col + dir.dc
        const nr = current.row + dir.dr
        if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue
        if (!isAir && !this.mapRef.isPassable(nc, nr)) continue

        const nKey = encodeCoord(nc, nr, width)
        if (closedSet.has(nKey)) continue

        // Diagonal: only if both cardinal neighbors are passable
        if (dir.cost > 1 && !isAir) {
          if (!this.mapRef.isPassable(current.col, nr) || !this.mapRef.isPassable(nc, current.row)) continue
        }

        const g = current.g + dir.cost
        const existing = nodeMap.get(nKey)
        if (existing && existing.g <= g) continue

        const h = heuristic({ col: nc, row: nr }, goal)
        const neighbor: AStarNode = { col: nc, row: nr, g, h, f: g + h, parent: current }
        nodeMap.set(nKey, neighbor)
        openList.push(neighbor)
      }
    }

    return []  // No path found
  }

  private nearestPassable(origin: TileCoord, radius: number): TileCoord | null {
    const { width, height } = this.mapRef.data
    for (let r = 1; r <= radius; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue
          const c = origin.col + dc, row = origin.row + dr
          if (c >= 0 && c < width && row >= 0 && row < height && this.mapRef.isPassable(c, row)) {
            return { col: c, row }
          }
        }
      }
    }
    return null
  }
}
