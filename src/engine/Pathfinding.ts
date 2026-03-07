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

interface UnitTileOccupant {
  id: string
  col: number
  row: number
  state?: string
}

export class Pathfinder {
  private mapRef: GameMap
  private cache: Map<string, CacheEntry> = new Map()
  private cacheTTL = 300  // ticks before cache entry expires
  private currentTick = 0
  private unitTileProvider: (() => UnitTileOccupant[]) | null = null
  private idleUnitNudgeHandler: ((tile: TileCoord, excludeUnitId?: string) => boolean) | null = null

  constructor(map: GameMap) {
    this.mapRef = map
  }

  setUnitTileProvider(provider: () => UnitTileOccupant[]): void {
    this.unitTileProvider = provider
  }

  setIdleUnitNudgeHandler(handler: (tile: TileCoord, excludeUnitId?: string) => boolean): void {
    this.idleUnitNudgeHandler = handler
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
  findPath(start: TileCoord, goal: TileCoord, isAir = false, movingUnitId?: string, _movingPlayerId?: number, isNaval = false): TileCoord[] {
    const { width, height } = this.mapRef.data
    // Bounds check
    if (
      start.col < 0 || start.col >= width || start.row < 0 || start.row >= height ||
      goal.col  < 0 || goal.col  >= width || goal.row  < 0 || goal.row  >= height
    ) return []

    // Same tile
    if (start.col === goal.col && start.row === goal.row) return [start]

    // Cache lookup
    const dynamicBucket = this.unitTileProvider ? Math.floor(this.currentTick / 20) : 0
    const cacheKey = `${start.col},${start.row}>${goal.col},${goal.row}:${isAir ? 1 : 0}:${movingUnitId ?? '-'}:${dynamicBucket}`
    const cached = this.cache.get(cacheKey)
    if (cached && this.currentTick - cached.tick <= this.cacheTTL) {
      return cached.path
    }

    // Goal tile itself must be passable; expand search up to 20 tiles
    if (!this.isWalkable(goal.col, goal.row, isAir, isNaval)) {
      const fallback = this.nearestPassable(goal, 20, isNaval)
      if (!fallback) return []
      return this.findPath(start, fallback, isAir, movingUnitId, _movingPlayerId, isNaval)
    }

    const occupancy = this.buildOccupancyCostMap(movingUnitId)
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
    // Track the closest reachable node to the goal (for fallback)
    let closestNode: AStarNode = startNode
    let closestH = startNode.h

    while (openList.size > 0 && examined < MAX_SEARCH_DEPTH) {
      const current = openList.pop()!
      examined++

      if (current.col === goal.col && current.row === goal.row) {
        const path = this.smoothCorners(reconstructPath(current), isAir)
        this.nudgeBlockingIdleUnits(path, movingUnitId)
        this.cache.set(cacheKey, { path, tick: this.currentTick })
        return path
      }

      // Track node closest to goal for fallback routing
      if (current.h < closestH) {
        closestH = current.h
        closestNode = current
      }

      const currentKey = encodeCoord(current.col, current.row, width)
      if (closedSet.has(currentKey)) continue
      closedSet.add(currentKey)

      for (const dir of DIRS) {
        const nc = current.col + dir.dc
        const nr = current.row + dir.dr
        if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue
        if (!this.isWalkable(nc, nr, isAir, isNaval)) continue

        const nKey = encodeCoord(nc, nr, width)
        if (closedSet.has(nKey)) continue

        // Diagonal: only if both cardinal neighbors are passable
        if (dir.cost > 1 && !isAir) {
          if (!this.isWalkable(current.col, nr, false, isNaval) || !this.isWalkable(nc, current.row, false, isNaval)) continue
        }

        const g = current.g + dir.cost + this.getOccupancyPenalty(nc, nr, occupancy)
        const existing = nodeMap.get(nKey)
        if (existing && existing.g <= g) continue

        const h = heuristic({ col: nc, row: nr }, goal)
        const neighbor: AStarNode = { col: nc, row: nr, g, h, f: g + h, parent: current }
        nodeMap.set(nKey, neighbor)
        openList.push(neighbor)
      }
    }

    // No full path found — route to the closest reachable point to the goal
    if (closestNode !== startNode && closestH < startNode.h) {
      const fallbackPath = this.smoothCorners(reconstructPath(closestNode), isAir)
      this.nudgeBlockingIdleUnits(fallbackPath, movingUnitId)
      this.cache.set(cacheKey, { path: fallbackPath, tick: this.currentTick })
      return fallbackPath
    }

    return []  // Completely unreachable (e.g., start itself is isolated)
  }

  private nearestPassable(origin: TileCoord, radius: number, isNaval = false): TileCoord | null {
    const { width, height } = this.mapRef.data
    let bestDist = Infinity
    let best: TileCoord | null = null
    for (let r = 1; r <= radius; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue
          const c = origin.col + dc, row = origin.row + dr
          if (c >= 0 && c < width && row >= 0 && row < height && this.isWalkable(c, row, false, isNaval)) {
            const dist = Math.abs(dc) + Math.abs(dr)
            if (dist < bestDist) {
              bestDist = dist
              best = { col: c, row }
            }
          }
        }
      }
      // If we found any passable tile in this ring, it's the closest
      if (best) return best
    }
    return null
  }

  private buildOccupancyCostMap(movingUnitId?: string): Map<number, number> {
    const map = new Map<number, number>()
    if (!this.unitTileProvider) return map
    const { width, height } = this.mapRef.data
    for (const unit of this.unitTileProvider()) {
      if (unit.id === movingUnitId) continue
      if (unit.col < 0 || unit.col >= width || unit.row < 0 || unit.row >= height) continue
      const key = encodeCoord(unit.col, unit.row, width)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }

  private getOccupancyPenalty(col: number, row: number, occupancy: Map<number, number>): number {
    if (occupancy.size === 0) return 0
    const { width } = this.mapRef.data
    const direct = occupancy.get(encodeCoord(col, row, width)) ?? 0
    let nearby = 0
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue
        nearby += occupancy.get(encodeCoord(col + dc, row + dr, width)) ?? 0
      }
    }
    return direct * 2.5 + nearby * 0.35
  }

  private nudgeBlockingIdleUnits(path: TileCoord[], movingUnitId?: string): void {
    if (!this.idleUnitNudgeHandler || path.length < 2) return
    const lookahead = Math.min(path.length - 1, 6)
    for (let i = 1; i <= lookahead; i++) {
      if (this.isLikelyChokepoint(path[i])) {
        this.idleUnitNudgeHandler(path[i], movingUnitId)
      }
    }
  }

  private isLikelyChokepoint(tile: TileCoord): boolean {
    const cardinal = [
      { col: tile.col, row: tile.row - 1 },
      { col: tile.col, row: tile.row + 1 },
      { col: tile.col - 1, row: tile.row },
      { col: tile.col + 1, row: tile.row },
    ]
    let passableCount = 0
    for (const c of cardinal) {
      if (this.isWalkable(c.col, c.row, false)) passableCount++
    }
    return passableCount <= 2
  }

  private smoothCorners(path: TileCoord[], isAir: boolean): TileCoord[] {
    if (path.length < 3 || isAir) return path
    const smoothed: TileCoord[] = [path[0]]

    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1]
      const cur = path[i]
      const next = path[i + 1]

      const d1c = cur.col - prev.col
      const d1r = cur.row - prev.row
      const d2c = next.col - cur.col
      const d2r = next.row - cur.row
      const firstCardinal = Math.abs(d1c) + Math.abs(d1r) === 1
      const secondCardinal = Math.abs(d2c) + Math.abs(d2r) === 1
      const isNinetyTurn = firstCardinal && secondCardinal && (d1c !== d2c || d1r !== d2r)

      if (isNinetyTurn) {
        const diag = { col: prev.col + d2c, row: prev.row + d2r }
        if (this.isWalkable(diag.col, diag.row, false)) {
          smoothed.push(diag)
          continue
        }
      }

      smoothed.push(cur)
    }

    smoothed.push(path[path.length - 1])
    return smoothed
  }

  // Pathing intentionally ignores fog of war; only terrain walkability blocks movement.
  private isWalkable(col: number, row: number, isAir: boolean, isNaval = false): boolean {
    if (isAir) return true
    const tile = this.mapRef.getTile(col, row)
    if (!tile) return false
    if (isNaval) {
      // Naval units can only move on water (and bridges)
      return tile.terrain === 1 || tile.terrain === 6  // WATER=1, BRIDGE=6
    }
    return tile.passable
  }
}
