// ============================================================
// IRON COMMAND — GameScene
// Main gameplay scene — integrates engine + entities + economy
// ============================================================
// NOTE: Engine and entity modules are built by Agents 1 & 2.
// This file uses conditional imports with stubs so it compiles
// standalone. The integration reviewer will swap stubs for real
// modules once they're merged.
// ============================================================

import Phaser from 'phaser'
import type { Position, TileCoord, GameMap, Player, GameState, GamePhase, Order, FactionId, TerrainType, FogState } from '../types'
import { TILE_SIZE, STARTING_CREDITS } from '../types'
import { FACTIONS } from '../data/factions'
import type { SkirmishConfig } from './SetupScene'

// ── Stub interfaces (replace with real imports when Agent 1/2 merge) ──

interface IGameMap {
  width: number
  height: number
  tileSize: number
  getTile(col: number, row: number): { terrain: TerrainType; passable: boolean; buildable: boolean; fogState: FogState; occupiedBy: string | null; oreAmount: number }
  setFogVisible(col: number, row: number, visible: boolean): void
  worldToTile(x: number, y: number): TileCoord
  tileToWorld(col: number, row: number): Position
}

interface ICamera {
  update(delta: number): void
  screenToWorld(screenX: number, screenY: number): Position
  worldToScreen(worldX: number, worldY: number): Position
}

interface IPathfinding {
  findPath(from: TileCoord, to: TileCoord): TileCoord[]
}

interface IEntityManager {
  createUnit(defId: string, playerId: number, tile: TileCoord): string
  createBuilding(defId: string, playerId: number, tile: TileCoord): string
  getEntity(id: string): IEntity | undefined
  getAllEntities(): IEntity[]
  update(delta: number): void
  getEntitiesInRect(x: number, y: number, w: number, h: number): IEntity[]
  issueOrder(entityId: string, order: Order): void
}

interface IEntity {
  id: string
  defId: string
  playerId: number
  type: 'unit' | 'building'
  x: number   // world px
  y: number
  hp: number
  maxHp: number
  isAlive: boolean
  sightRange: number // tiles
}

interface IMinimapSystem {
  update(): void
  draw(): void
}

// ── Stub implementations ───────────────────────────────────────────────

function createStubMap(cfg: SkirmishConfig): IGameMap {
  const dims = { small: 64, medium: 128, large: 256 }
  const size = dims[cfg.mapSize]

  const tiles: Array<Array<{ terrain: TerrainType; passable: boolean; buildable: boolean; fogState: FogState; occupiedBy: string | null; oreAmount: number }>> = []
  for (let row = 0; row < size; row++) {
    tiles[row] = []
    for (let col = 0; col < size; col++) {
      // Simple terrain: water edges, ore patches, rest grass
      const isEdge = row < 2 || row >= size - 2 || col < 2 || col >= size - 2
      const isOre = (Math.abs(col - size / 3) < 4 && Math.abs(row - size / 3) < 4) ||
                    (Math.abs(col - size * 2 / 3) < 4 && Math.abs(row - size * 2 / 3) < 4)
      tiles[row][col] = {
        terrain: isEdge ? 1 : isOre ? 2 : 0, // water / ore / grass
        passable: !isEdge,
        buildable: !isEdge && !isOre,
        fogState: 0, // HIDDEN
        occupiedBy: null,
        oreAmount: isOre ? 10000 : 0,
      }
    }
  }

  return {
    width: size,
    height: size,
    tileSize: TILE_SIZE,
    getTile: (col, row) => tiles[row]?.[col] ?? tiles[0][0],
    setFogVisible: (col, row, _visible) => {
      if (tiles[row]?.[col]) tiles[row][col].fogState = _visible ? 2 : 1
    },
    worldToTile: (x, y) => ({ col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) }),
    tileToWorld: (col, row) => ({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 }),
  }
}

class StubEntityManager implements IEntityManager {
  private entities: Map<string, IEntity> = new Map()
  private nextId = 1

  createUnit(defId: string, playerId: number, tile: TileCoord): string {
    const id = `u${this.nextId++}`
    this.entities.set(id, {
      id, defId, playerId, type: 'unit',
      x: tile.col * TILE_SIZE + TILE_SIZE / 2,
      y: tile.row * TILE_SIZE + TILE_SIZE / 2,
      hp: 100, maxHp: 100, isAlive: true, sightRange: 5,
    })
    return id
  }

  createBuilding(defId: string, playerId: number, tile: TileCoord): string {
    const id = `b${this.nextId++}`
    this.entities.set(id, {
      id, defId, playerId, type: 'building',
      x: tile.col * TILE_SIZE + TILE_SIZE / 2,
      y: tile.row * TILE_SIZE + TILE_SIZE / 2,
      hp: 500, maxHp: 500, isAlive: true, sightRange: 4,
    })
    return id
  }

  getEntity(id: string) { return this.entities.get(id) }

  getAllEntities(): IEntity[] { return Array.from(this.entities.values()) }

  update(_delta: number): void {
    // Stub: no movement/combat
  }

  getEntitiesInRect(x: number, y: number, w: number, h: number): IEntity[] {
    return this.getAllEntities().filter(e =>
      e.x >= x && e.x <= x + w && e.y >= y && e.y <= y + h
    )
  }

  issueOrder(_entityId: string, _order: Order): void {
    // Stub: orders queued but not processed
  }
}

// ── GameScene ──────────────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
  private gameMap!: IGameMap
  private entityMgr!: IEntityManager
  private gameState!: GameState
  private skirmishCfg!: SkirmishConfig

  // Camera state
  private camX = 0
  private camY = 0
  private camSpeed = 400 // px/s
  private mapContainer!: Phaser.GameObjects.Container

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>
  private isDragging = false
  private dragStartWorld = { x: 0, y: 0 }
  private selectionRect!: Phaser.GameObjects.Graphics

  // Entity visuals
  private entitySprites: Map<string, Phaser.GameObjects.Container> = new Map()
  private healthBarGraphics!: Phaser.GameObjects.Graphics

  // Selected entities
  private selectedIds: Set<string> = new Set()

  // Layer graphics
  private terrainGraphics!: Phaser.GameObjects.Graphics
  private fogGraphics!: Phaser.GameObjects.Graphics

  constructor() {
    super({ key: 'GameScene' })
  }

  init(data: { config: SkirmishConfig }) {
    this.skirmishCfg = data?.config ?? {
      playerFaction: 'usa',
      mapSize: 'small',
      aiCount: 1,
      aiDifficulty: 'medium',
      startingCredits: STARTING_CREDITS,
    }
  }

  create() {
    // 1. Build stub game map
    this.gameMap = createStubMap(this.skirmishCfg)

    // 2. Entity manager
    this.entityMgr = new StubEntityManager()

    // 3. Build initial game state
    const playerFaction = this.skirmishCfg.playerFaction
    const humanPlayer: Player = {
      id: 0,
      name: 'Commander',
      faction: playerFaction,
      color: FACTIONS[playerFaction].color,
      credits: this.skirmishCfg.startingCredits,
      power: 0,
      powerGenerated: 0,
      powerConsumed: 0,
      isAI: false,
      isDefeated: false,
      entities: [],
      buildQueue: [],
    }

    const aiPlayers: Player[] = []
    const factionKeys = Object.keys(FACTIONS) as FactionId[]
    for (let i = 0; i < this.skirmishCfg.aiCount; i++) {
      const fac = factionKeys[(factionKeys.indexOf(playerFaction) + i + 1) % factionKeys.length]
      aiPlayers.push({
        id: i + 1,
        name: `AI ${i + 1}`,
        faction: fac,
        color: FACTIONS[fac].color,
        credits: this.skirmishCfg.startingCredits,
        power: 0,
        powerGenerated: 0,
        powerConsumed: 0,
        isAI: true,
        isDefeated: false,
        entities: [],
        buildQueue: [],
      })
    }

    const mapData: GameMap = {
      name: 'Skirmish Map',
      width: this.gameMap.width,
      height: this.gameMap.height,
      tileSize: TILE_SIZE,
      tiles: [],
      startPositions: [
        { x: 8, y: 8 },
        { x: this.gameMap.width - 10, y: this.gameMap.height - 10 },
        { x: this.gameMap.width - 10, y: 8 },
        { x: 8, y: this.gameMap.height - 10 },
      ],
    }

    this.gameState = {
      phase: 'playing' as GamePhase,
      tick: 0,
      players: [humanPlayer, ...aiPlayers],
      localPlayerId: 0,
      selectedEntityIds: [],
      map: mapData,
    }

    // 4. Spawn starting entities
    this.spawnStartingEntities()

    // 5. Build terrain visuals
    this.createMapContainer()
    this.renderTerrain()

    // 6. Fog
    this.fogGraphics = this.add.graphics()
    this.fogGraphics.setDepth(50)

    // 7. Entity sprite layer + health bars
    this.healthBarGraphics = this.add.graphics()
    this.healthBarGraphics.setDepth(80)

    // 8. Selection rect
    this.selectionRect = this.add.graphics()
    this.selectionRect.setDepth(100)

    // 9. Input
    this.setupInput()

    // 10. Camera start
    const spawn = mapData.startPositions[0]
    this.camX = spawn.x * TILE_SIZE - this.scale.width / 2
    this.camY = spawn.y * TILE_SIZE - this.scale.height / 2

    // 11. Launch HUD overlay
    this.scene.launch('HUDScene', { gameState: this.gameState })

    // 12. Initial fog reveal
    this.updateFogOfWar()
    this.renderFog()

    // 13. Draw initial entity sprites
    this.syncEntitySprites()

    // Fade in
    this.cameras.main.fadeIn(500)
  }

  update(_time: number, delta: number) {
    if (this.gameState.phase !== 'playing') return

    this.gameState.tick++

    // Camera scroll
    this.handleCameraScroll(delta)

    // Apply camera offset to map container
    this.mapContainer.setPosition(-this.camX, -this.camY)
    if (this.terrainGraphics) {
      this.terrainGraphics.setPosition(-this.camX, -this.camY)
    }
    this.fogGraphics.setPosition(-this.camX, -this.camY)
    this.healthBarGraphics.setPosition(-this.camX, -this.camY)
    this.selectionRect.setPosition(-this.camX, -this.camY)

    // Move entity sprites
    this.entitySprites.forEach((container, id) => {
      const e = this.entityMgr.getEntity(id)
      if (!e || !e.isAlive) { container.setVisible(false); return }
      container.setPosition(-this.camX + e.x, -this.camY + e.y)
    })

    // Update entities
    this.entityMgr.update(delta)

    // Fog of war
    if (this.gameState.tick % 30 === 0) {
      this.updateFogOfWar()
      this.renderFog()
    }

    // Health bars
    this.drawHealthBars()

    // Win/loss check
    if (this.gameState.tick % 120 === 0) {
      this.checkWinCondition()
    }

    // Update HUD (pass current state)
    this.registry.set('gameState', this.gameState)
    this.registry.set('entityMgr', this.entityMgr)
  }

  // ── Spawning ───────────────────────────────────────────────────────

  private spawnStartingEntities() {
    const { startPositions } = this.gameState.map
    const players = this.gameState.players

    players.forEach((player, i) => {
      const spawn = startPositions[i] ?? startPositions[0]
      const spawnTile: TileCoord = { col: Math.floor(spawn.x), row: Math.floor(spawn.y) }

      // Construction yard
      const cyId = this.entityMgr.createBuilding('construction_yard', player.id, spawnTile)
      player.entities.push(cyId)

      // Power plant
      const ppId = this.entityMgr.createBuilding('power_plant', player.id,
        { col: spawnTile.col + 3, row: spawnTile.row })
      player.entities.push(ppId)

      // Harvester
      const hvId = this.entityMgr.createUnit('harvester', player.id,
        { col: spawnTile.col + 1, row: spawnTile.row + 2 })
      player.entities.push(hvId)

      // 2 rifle infantry
      for (let j = 0; j < 2; j++) {
        const uid = this.entityMgr.createUnit('rifle', player.id,
          { col: spawnTile.col - 2 + j, row: spawnTile.row + 1 })
        player.entities.push(uid)
      }
    })
  }

  // ── Terrain Rendering ──────────────────────────────────────────────

  private createMapContainer() {
    this.mapContainer = this.add.container(0, 0)
    this.mapContainer.setDepth(0)
    this.terrainGraphics = this.add.graphics()
    this.terrainGraphics.setDepth(1)
  }

  private renderTerrain() {
    const g = this.terrainGraphics
    g.clear()

    const map = this.gameMap
    const TERRAIN_COLORS: Record<number, number> = {
      0: 0x4a7c3f, // GRASS
      1: 0x1e6fa8, // WATER
      2: 0xd4a017, // ORE
      3: 0x777777, // ROCK
      4: 0xc2a96e, // SAND
      5: 0x555555, // ROAD
      6: 0x4466aa, // BRIDGE
      7: 0x1e5c1e, // FOREST
    }

    // Only render visible portion (viewport culling)
    const viewCols = Math.ceil(this.scale.width / TILE_SIZE) + 2
    const viewRows = Math.ceil(this.scale.height / TILE_SIZE) + 2
    const startCol = Math.max(0, Math.floor(this.camX / TILE_SIZE) - 1)
    const startRow = Math.max(0, Math.floor(this.camY / TILE_SIZE) - 1)
    const endCol = Math.min(map.width - 1, startCol + viewCols)
    const endRow = Math.min(map.height - 1, startRow + viewRows)

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const tile = map.getTile(col, row)
        const color = TERRAIN_COLORS[tile.terrain] ?? 0x4a7c3f
        const wx = col * TILE_SIZE
        const wy = row * TILE_SIZE
        g.fillStyle(color, 1)
        g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE)
        // Ore sparkle
        if (tile.terrain === 2) {
          g.fillStyle(0xffdd44, 0.4)
          g.fillRect(wx + 4, wy + 4, TILE_SIZE - 8, TILE_SIZE - 8)
        }
      }
    }

    // Grid lines (only at high zoom — always show for now)
    g.lineStyle(1, 0x000000, 0.08)
    for (let row = startRow; row <= endRow + 1; row++) {
      g.lineBetween(startCol * TILE_SIZE, row * TILE_SIZE, endCol * TILE_SIZE, row * TILE_SIZE)
    }
    for (let col = startCol; col <= endCol + 1; col++) {
      g.lineBetween(col * TILE_SIZE, startRow * TILE_SIZE, col * TILE_SIZE, endRow * TILE_SIZE)
    }
  }

  // ── Fog of War ─────────────────────────────────────────────────────

  private updateFogOfWar() {
    const humanPlayer = this.gameState.players[0]
    humanPlayer.entities.forEach(eid => {
      const e = this.entityMgr.getEntity(eid)
      if (!e || !e.isAlive) return
      const tile = this.gameMap.worldToTile(e.x, e.y)
      const range = e.sightRange
      for (let dr = -range; dr <= range; dr++) {
        for (let dc = -range; dc <= range; dc++) {
          if (dc * dc + dr * dr <= range * range) {
            this.gameMap.setFogVisible(tile.col + dc, tile.row + dr, true)
          }
        }
      }
    })
  }

  private renderFog() {
    const g = this.fogGraphics
    g.clear()

    const map = this.gameMap
    const viewCols = Math.ceil(this.scale.width / TILE_SIZE) + 2
    const viewRows = Math.ceil(this.scale.height / TILE_SIZE) + 2
    const startCol = Math.max(0, Math.floor(this.camX / TILE_SIZE) - 1)
    const startRow = Math.max(0, Math.floor(this.camY / TILE_SIZE) - 1)
    const endCol = Math.min(map.width - 1, startCol + viewCols)
    const endRow = Math.min(map.height - 1, startRow + viewRows)

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const tile = map.getTile(col, row)
        const wx = col * TILE_SIZE
        const wy = row * TILE_SIZE
        if (tile.fogState === 0) {  // HIDDEN
          g.fillStyle(0x000000, 1)
          g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE)
        } else if (tile.fogState === 1) {  // EXPLORED
          g.fillStyle(0x000000, 0.5)
          g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE)
        }
        // VISIBLE = no overlay
      }
    }
  }

  // ── Entity Sprites ─────────────────────────────────────────────────

  private syncEntitySprites() {
    const entities = this.entityMgr.getAllEntities()
    const seen = new Set<string>()

    entities.forEach(e => {
      seen.add(e.id)
      if (!this.entitySprites.has(e.id)) {
        this.createEntitySprite(e)
      }
    })

    // Remove dead
    this.entitySprites.forEach((container, id) => {
      if (!seen.has(id)) {
        container.destroy()
        this.entitySprites.delete(id)
      }
    })
  }

  private createEntitySprite(e: IEntity) {
    const container = this.add.container(e.x, e.y)
    container.setDepth(30 + (e.type === 'unit' ? 1 : 0))

    const player = this.gameState.players.find(p => p.id === e.playerId)
    const color = player?.color ?? 0xffffff

    const g = this.add.graphics()

    if (e.type === 'unit') {
      g.fillStyle(color, 1)
      g.fillCircle(0, 0, 7)
      g.lineStyle(1, 0x000000, 0.5)
      g.strokeCircle(0, 0, 7)
    } else {
      // Building footprint rough guess
      const size = e.defId === 'construction_yard' ? 28 : 18
      g.fillStyle(color, 0.85)
      g.fillRect(-size / 2, -size / 2, size, size)
      g.lineStyle(2, 0x000000, 0.7)
      g.strokeRect(-size / 2, -size / 2, size, size)
    }

    // Label
    const label = e.defId.slice(0, 2).toUpperCase()
    const txt = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: '7px',
      color: '#ffffff',
    }).setOrigin(0.5)

    container.add([g, txt])
    this.entitySprites.set(e.id, container)

    // Make units interactive
    if (e.type === 'unit') {
      container.setSize(16, 16)
      container.setInteractive()
      container.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
        if (!ptr.leftButtonDown()) return
        if (!ptr.event.shiftKey) this.selectedIds.clear()
        this.selectedIds.add(e.id)
        this.gameState.selectedEntityIds = Array.from(this.selectedIds)
        this.registry.set('selectedIds', this.gameState.selectedEntityIds)
      })
    }
  }

  // ── Health Bars ────────────────────────────────────────────────────

  private drawHealthBars() {
    const g = this.healthBarGraphics
    g.clear()

    this.entityMgr.getAllEntities().forEach(e => {
      if (!e.isAlive) return
      const pct = e.hp / e.maxHp
      // Only show if damaged or selected
      if (pct >= 1 && !this.selectedIds.has(e.id)) return

      const sx = e.x
      const sy = e.y - 12
      const barW = 20
      const barH = 3

      g.fillStyle(0x222222, 0.8)
      g.fillRect(sx - barW / 2, sy, barW, barH)

      const barColor = pct > 0.5 ? 0x44ee44 : pct > 0.25 ? 0xeeee44 : 0xee4444
      g.fillStyle(barColor, 1)
      g.fillRect(sx - barW / 2, sy, Math.floor(barW * pct), barH)
    })
  }

  // ── Input ──────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D,ESC') as Record<string, Phaser.Input.Keyboard.Key>

    // Right-click to move selected units
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown()) {
        this.handleRightClick(ptr)
      } else if (ptr.leftButtonDown()) {
        this.startDragSelect(ptr)
      }
    })

    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (this.isDragging && ptr.leftButtonDown()) {
        this.updateDragSelect(ptr)
      }
    })

    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        this.endDragSelect(ptr)
      }
    })

    // Edge of screen camera scroll handled in update()

    // Keyboard shortcuts
    this.input.keyboard!.on('keydown-ESC', () => {
      this.selectedIds.clear()
      this.gameState.selectedEntityIds = []
      this.registry.set('selectedIds', [])
    })

    this.input.keyboard!.on('keydown-DELETE', () => {
      // Sell selected building (placeholder)
    })
  }

  private handleRightClick(ptr: Phaser.Input.Pointer) {
    if (this.selectedIds.size === 0) return
    const worldX = ptr.x + this.camX
    const worldY = ptr.y + this.camY
    const tile = this.gameMap.worldToTile(worldX, worldY)

    this.selectedIds.forEach(id => {
      this.entityMgr.issueOrder(id, {
        type: 'move',
        target: { x: tile.col, y: tile.row },
      })
    })
  }

  private dragAnchor = { x: 0, y: 0 }

  private startDragSelect(ptr: Phaser.Input.Pointer) {
    this.isDragging = true
    this.dragAnchor = { x: ptr.x + this.camX, y: ptr.y + this.camY }
    this.dragStartWorld = { ...this.dragAnchor }
  }

  private updateDragSelect(ptr: Phaser.Input.Pointer) {
    const wx = ptr.x + this.camX
    const wy = ptr.y + this.camY
    const x1 = Math.min(this.dragAnchor.x, wx)
    const y1 = Math.min(this.dragAnchor.y, wy)
    const x2 = Math.max(this.dragAnchor.x, wx)
    const y2 = Math.max(this.dragAnchor.y, wy)

    this.selectionRect.clear()
    this.selectionRect.fillStyle(0x00ff00, 0.1)
    this.selectionRect.fillRect(x1, y1, x2 - x1, y2 - y1)
    this.selectionRect.lineStyle(1, 0x00ff00, 0.8)
    this.selectionRect.strokeRect(x1, y1, x2 - x1, y2 - y1)
  }

  private endDragSelect(ptr: Phaser.Input.Pointer) {
    this.isDragging = false
    const wx = ptr.x + this.camX
    const wy = ptr.y + this.camY
    const x1 = Math.min(this.dragAnchor.x, wx)
    const y1 = Math.min(this.dragAnchor.y, wy)
    const w = Math.abs(wx - this.dragAnchor.x)
    const h = Math.abs(wy - this.dragAnchor.y)

    if (w > 4 && h > 4) {
      const found = this.entityMgr.getEntitiesInRect(x1, y1, w, h)
        .filter(e => e.playerId === 0 && e.type === 'unit')

      if (!this.input.keyboard?.checkDown(this.wasdKeys['ESC'])) {
        this.selectedIds.clear()
      }
      found.forEach(e => this.selectedIds.add(e.id))
      this.gameState.selectedEntityIds = Array.from(this.selectedIds)
      this.registry.set('selectedIds', this.gameState.selectedEntityIds)
    }

    this.selectionRect.clear()
  }

  private handleCameraScroll(delta: number) {
    const dt = delta / 1000
    const speed = this.camSpeed
    const map = this.gameMap
    const maxX = map.width * TILE_SIZE - this.scale.width
    const maxY = map.height * TILE_SIZE - this.scale.height

    let dx = 0
    let dy = 0

    if (this.cursors.left.isDown  || this.wasdKeys['A']?.isDown) dx -= speed * dt
    if (this.cursors.right.isDown || this.wasdKeys['D']?.isDown) dx += speed * dt
    if (this.cursors.up.isDown    || this.wasdKeys['W']?.isDown) dy -= speed * dt
    if (this.cursors.down.isDown  || this.wasdKeys['S']?.isDown) dy += speed * dt

    // Edge scrolling (20px zone)
    const ptr = this.input.activePointer
    const edgeW = 20
    const W = this.scale.width
    const H = this.scale.height
    if (ptr.x < edgeW) dx -= speed * dt
    if (ptr.x > W - edgeW) dx += speed * dt
    if (ptr.y < edgeW) dy -= speed * dt
    if (ptr.y > H - edgeW) dy += speed * dt

    this.camX = Phaser.Math.Clamp(this.camX + dx, 0, Math.max(0, maxX))
    this.camY = Phaser.Math.Clamp(this.camY + dy, 0, Math.max(0, maxY))

    // Re-render terrain when camera moves
    if (dx !== 0 || dy !== 0) {
      this.renderTerrain()
    }
  }

  // ── Win/Loss ───────────────────────────────────────────────────────

  private checkWinCondition() {
    const players = this.gameState.players
    const localId = this.gameState.localPlayerId

    players.forEach(p => {
      if (p.isAI) {
        const aliveBuildings = p.entities.filter(eid => {
          const e = this.entityMgr.getEntity(eid)
          return e?.type === 'building' && e.isAlive
        })
        if (aliveBuildings.length === 0 && p.entities.length > 0) {
          p.isDefeated = true
        }
      }
    })

    const aiPlayers = players.filter(p => p.isAI)
    if (aiPlayers.every(p => p.isDefeated)) {
      this.triggerVictory()
    }

    const human = players.find(p => p.id === localId)!
    const humanBuildings = human.entities.filter(eid => {
      const e = this.entityMgr.getEntity(eid)
      return e?.type === 'building' && e.isAlive
    })
    if (humanBuildings.length === 0 && human.entities.length > 0) {
      this.triggerDefeat()
    }
  }

  private triggerVictory() {
    if (this.gameState.phase !== 'playing') return
    this.gameState.phase = 'victory'
    this.showEndScreen('MISSION COMPLETE', '#44ee44')
  }

  private triggerDefeat() {
    if (this.gameState.phase !== 'playing') return
    this.gameState.phase = 'defeat'
    this.showEndScreen('MISSION FAILED', '#ee4444')
  }

  private showEndScreen(msg: string, color: string) {
    const { width, height } = this.scale
    const overlay = this.add.graphics()
    overlay.fillStyle(0x000000, 0.7)
    overlay.fillRect(0, 0, width, height)
    overlay.setDepth(200)

    this.add.text(width / 2, height / 2 - 40, msg, {
      fontFamily: 'monospace',
      fontSize: '48px',
      color,
      stroke: '#000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(201)

    // Return to menu after 4s
    this.time.delayedCall(4000, () => {
      this.scene.stop('HUDScene')
      this.scene.start('MenuScene')
    })
  }
}
