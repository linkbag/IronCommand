// ============================================================
// IRON COMMAND — GameScene (Core Overhaul)
// Wires real engine + entity + economy + combat + AI modules
// ============================================================

import Phaser from 'phaser'
import { GameMap } from '../engine/GameMap'
import { Pathfinder } from '../engine/Pathfinding'
import { EntityManager } from '../entities/EntityManager'
import { Combat } from '../combat/Combat'
import { Economy } from '../economy/Economy'
import { Production } from '../economy/Production'
import { AI } from '../combat/AI'
import type { Position, TileCoord, GameState, Player, GamePhase, FactionId } from '../types'
import { TILE_SIZE, STARTING_CREDITS, TerrainType } from '../types'
import { FACTIONS } from '../data/factions'
import type { SkirmishConfig } from './SetupScene'

export class GameScene extends Phaser.Scene {
  // ── IRTSScene interface (Unit.ts calls these via scene cast) ──
  findPath: (from: TileCoord, to: TileCoord, playerId?: number) => TileCoord[] =
    () => []
  worldToTile: (x: number, y: number) => TileCoord =
    (x, y) => ({ col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) })
  tileToWorld: (col: number, row: number) => Position =
    (col, row) => ({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 })

  // ── Systems ─────────────────────────────────────────────────
  private gameMap!: GameMap
  private pathfinder!: Pathfinder
  private entityMgr!: EntityManager
  private combat!: Combat
  private economy!: Economy
  private production!: Production
  private aiCommanders: AI[] = []

  // ── Game state ──────────────────────────────────────────────
  private gameState!: GameState
  private skirmishCfg!: SkirmishConfig

  // ── Camera ──────────────────────────────────────────────────
  private camX = 0
  private camY = 0
  private camSpeed = 400  // px/s

  // ── Input ───────────────────────────────────────────────────
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasdKeys!: Record<string, Phaser.Input.Keyboard.Key>
  private isDragging = false
  private dragAnchorScreen = { x: 0, y: 0 }
  private dragAnchorWorld = { x: 0, y: 0 }

  // ── Selection ───────────────────────────────────────────────
  private selectionRect!: Phaser.GameObjects.Graphics
  private selectedIds: Set<string> = new Set()

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
    // Reset per-session state
    this.aiCommanders = []
    this.selectedIds = new Set()
    this.camX = 0
    this.camY = 0
  }

  create() {
    const cfg = this.skirmishCfg

    // ── 1. Procedural map ─────────────────────────────────────
    const mapDims: Record<string, number> = { small: 64, medium: 128, large: 256 }
    const mapSize = mapDims[cfg.mapSize] ?? 64
    const seed = Math.floor(Math.random() * 99999) + 1
    this.gameMap = new GameMap(this, mapSize, mapSize, seed)
    this.gameMap.renderTerrain()
    this.gameMap.renderFog(true)  // full black initially

    // ── 2. Pathfinder ─────────────────────────────────────────
    this.pathfinder = new Pathfinder(this.gameMap)

    // Wire IRTSScene methods (Unit calls these via scene cast)
    this.findPath  = (from, to) => this.pathfinder.findPath(from, to)
    this.worldToTile = (x, y) => this.gameMap.worldToTile(x, y)
    this.tileToWorld = (col, row) => this.gameMap.tileToWorld(col, row)

    // ── 3. Entity manager ─────────────────────────────────────
    this.entityMgr = new EntityManager(this)

    // ── 4. Combat system ──────────────────────────────────────
    this.combat = new Combat(this, this.entityMgr)

    // ── 5. Build player list ──────────────────────────────────
    const playerFaction = cfg.playerFaction
    const factionKeys = Object.keys(FACTIONS) as FactionId[]

    const humanPlayer: Player = {
      id: 0, name: 'Commander', faction: playerFaction,
      color: FACTIONS[playerFaction].color, credits: cfg.startingCredits,
      power: 0, powerGenerated: 0, powerConsumed: 0,
      isAI: false, isDefeated: false, entities: [], buildQueue: [],
    }

    const aiPlayers: Player[] = []
    for (let i = 0; i < cfg.aiCount; i++) {
      const fac = factionKeys[(factionKeys.indexOf(playerFaction) + i + 1) % factionKeys.length]
      aiPlayers.push({
        id: i + 1, name: `AI ${i + 1}`, faction: fac,
        color: FACTIONS[fac].color, credits: cfg.startingCredits,
        power: 0, powerGenerated: 0, powerConsumed: 0,
        isAI: true, isDefeated: false, entities: [], buildQueue: [],
      })
    }
    const allPlayers = [humanPlayer, ...aiPlayers]

    // ── 6. Economy ────────────────────────────────────────────
    const playerIds = allPlayers.map(p => p.id)
    this.economy = new Economy(this.entityMgr, playerIds)
    // Patch if custom starting credits differ from default
    if (cfg.startingCredits !== STARTING_CREDITS) {
      const delta = cfg.startingCredits - STARTING_CREDITS
      if (delta > 0) {
        for (const p of allPlayers) this.economy.addCredits(p.id, delta)
      }
    }

    // ── 7. Production ─────────────────────────────────────────
    this.production = new Production(this.entityMgr, this.economy)

    // ── 8. AI commanders ──────────────────────────────────────
    this.aiCommanders = aiPlayers.map(p =>
      new AI(p.id, cfg.aiDifficulty, this.entityMgr, this.economy, this.production)
    )

    // ── 9. Game state ─────────────────────────────────────────
    this.gameState = {
      phase: 'playing' as GamePhase,
      tick: 0,
      players: allPlayers,
      localPlayerId: 0,
      selectedEntityIds: [],
      map: this.gameMap.data,
    }

    // ── 10. Event wiring ──────────────────────────────────────
    this.wireEntityEvents()
    this.wireOreEvents()
    this.wireEconomyEvents()

    // ── 11. Spawn starting entities ───────────────────────────
    this.spawnStartingEntities()

    // ── 12. Input ─────────────────────────────────────────────
    this.setupInput()

    // ── 13. UI elements (fixed to screen, don't scroll) ───────
    this.selectionRect = this.add.graphics()
    this.selectionRect.setScrollFactor(0).setDepth(200)

    // ── 14. Camera at player spawn ────────────────────────────
    const startPos = this.gameMap.data.startPositions[0]
    if (startPos) {
      this.camX = startPos.x - this.scale.width / 2
      this.camY = startPos.y - this.scale.height / 2
    }
    this.cameras.main.setScroll(this.camX, this.camY)

    // ── 15. Launch HUD overlay ────────────────────────────────
    this.scene.launch('HUDScene', { gameState: this.gameState })

    // ── 16. Initial fog reveal around player base ─────────────
    this.updateFogOfWar()

    this.cameras.main.fadeIn(500)
  }

  update(_time: number, delta: number) {
    if (this.gameState.phase !== 'playing') return

    this.gameState.tick++

    // Camera scroll + clamp to map bounds
    this.handleCameraScroll(delta)
    const maxX = this.gameMap.worldWidth - this.scale.width
    const maxY = this.gameMap.worldHeight - this.scale.height
    this.camX = Phaser.Math.Clamp(this.camX, 0, Math.max(0, maxX))
    this.camY = Phaser.Math.Clamp(this.camY, 0, Math.max(0, maxY))
    this.cameras.main.setScroll(this.camX, this.camY)

    // Pathfinder cache maintenance
    this.pathfinder.tick()

    // Entity systems (movement, combat state machines, harvest loops)
    this.entityMgr.update(delta)

    // Projectile travel + explosion effects
    this.combat.update(delta)

    // Power calculation + credit conversion
    this.economy.update(delta, this.gameState)

    // Build queue progress
    this.production.update(delta, this.gameState)

    // AI decision making
    for (const ai of this.aiCommanders) {
      ai.update(delta, this.gameState)
    }

    // Fog of war (every 30 ticks ≈ 0.5s at 60fps)
    if (this.gameState.tick % 30 === 0) {
      this.updateFogOfWar()
    }

    // Win/loss check (every 120 ticks ≈ 2s)
    if (this.gameState.tick % 120 === 0) {
      this.checkWinCondition()
    }

    // Push live state to HUD via registry
    this.registry.set('gameState', this.gameState)
    this.registry.set('economy', this.economy)
    this.registry.set('production', this.production)
    this.registry.set('entityMgr', this.entityMgr)
    this.registry.set('selectedIds', Array.from(this.selectedIds))
  }

  // ── Entity event wiring ───────────────────────────────────────

  private wireEntityEvents(): void {
    // Track entity IDs per player for win condition checks
    this.entityMgr.on('unit_created', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p && !p.entities.includes(entityId)) p.entities.push(entityId)
    })

    this.entityMgr.on('building_placed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p && !p.entities.includes(entityId)) p.entities.push(entityId)
    })

    this.entityMgr.on('unit_destroyed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.entities = p.entities.filter(id => id !== entityId)
    })

    this.entityMgr.on('building_destroyed', ({ entityId, playerId }: { entityId: string; playerId: number }) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.entities = p.entities.filter(id => id !== entityId)
    })
  }

  // ── Economy event wiring ─────────────────────────────────────

  private wireEconomyEvents(): void {
    // Keep gameState.players in sync with Economy's credit/power state
    this.economy.on('credits_changed', (playerId: number, newAmount: number) => {
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) p.credits = newAmount
    })

    this.economy.on('power_state_changed', (playerId: number) => {
      const ps = this.economy.getPowerState(playerId)
      const p = this.gameState.players.find(pl => pl.id === playerId)
      if (p) {
        p.powerGenerated = ps.generated
        p.powerConsumed = ps.consumed
        p.power = ps.generated - ps.consumed
      }
    })
  }

  // ── Ore event wiring (harvester ↔ tile map) ──────────────────

  private wireOreEvents(): void {
    const { tiles, width, height } = this.gameMap.data

    // Harvester asks: "how much ore is near me?" (called every harvest tick)
    this.entityMgr.on('check_ore_at', (x: number, y: number, cb: (amount: number, pos: Position) => void) => {
      const origin = this.gameMap.worldToTile(x, y)
      const searchR = 2
      let bestOre = 0
      let bestPos: Position = { x, y }

      for (let dr = -searchR; dr <= searchR; dr++) {
        for (let dc = -searchR; dc <= searchR; dc++) {
          const tc = origin.col + dc
          const tr = origin.row + dr
          if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
          const t = tiles[tr]?.[tc]
          if (t && t.oreAmount > bestOre) {
            bestOre = t.oreAmount
            bestPos = this.gameMap.tileToWorld(tc, tr)
          }
        }
      }
      cb(bestOre, bestPos)
    })

    // Harvester depletes ore from the tile it harvested
    this.entityMgr.on('ore_harvested', (tilePos: Position, amount: number) => {
      const tc = this.gameMap.worldToTile(tilePos.x, tilePos.y)
      const tileData = this.gameMap.getTile(tc.col, tc.row)
      if (tileData && tileData.oreAmount > 0) {
        tileData.oreAmount = Math.max(0, tileData.oreAmount - amount)
      }
    })

    // Harvester asks: "where is the nearest ore field?"
    this.entityMgr.on('find_ore_field', (x: number, y: number, cb: (pos: Position | null) => void) => {
      const origin = this.gameMap.worldToTile(x, y)
      let foundPos: Position | null = null
      const maxRadius = Math.min(width, height) / 2

      for (let radius = 1; radius <= maxRadius && foundPos === null; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
            const tc = origin.col + dc
            const tr = origin.row + dr
            if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
            const t = tiles[tr]?.[tc]
            if (t && t.oreAmount > 100) {
              foundPos = this.gameMap.tileToWorld(tc, tr)
            }
          }
          if (foundPos !== null) break
        }
      }

      cb(foundPos)
    })
  }

  // ── Spawn starting entities ───────────────────────────────────

  private spawnStartingEntities(): void {
    const { startPositions } = this.gameMap.data
    const { tiles, width, height } = this.gameMap.data
    const players = this.gameState.players

    players.forEach((player, i) => {
      const spawnWorld = startPositions[i] ?? startPositions[0]
      const st = this.gameMap.worldToTile(spawnWorld.x, spawnWorld.y)

      // Construction Yard — start active
      const cy = this.entityMgr.createBuilding(player.id, 'construction_yard',
        st.col - 1, st.row - 1)
      if (cy) cy.state = 'active'

      // Power Plant — start active
      const pp = this.entityMgr.createBuilding(player.id, 'power_plant',
        st.col + 3, st.row - 1)
      if (pp) pp.state = 'active'

      // Ore Refinery — start active
      const ref = this.entityMgr.createBuilding(player.id, 'ore_refinery',
        st.col - 1, st.row + 3)
      if (ref) ref.state = 'active'

      // Harvester — find nearest ore and auto-send
      const hv = this.entityMgr.createUnit(player.id, 'harvester',
        spawnWorld.x + TILE_SIZE * 2, spawnWorld.y + TILE_SIZE * 3)
      if (hv) {
        if (ref) hv.setRefineryId(ref.id)
        // Find nearest ore tile and send harvester there immediately
        const origin = this.gameMap.worldToTile(hv.x, hv.y)
        let sent = false
        for (let radius = 1; radius <= 40 && !sent; radius++) {
          for (let dr = -radius; dr <= radius && !sent; dr++) {
            for (let dc = -radius; dc <= radius && !sent; dc++) {
              if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue
              const tc = origin.col + dc, tr = origin.row + dr
              if (tc < 0 || tc >= width || tr < 0 || tr >= height) continue
              if ((tiles[tr]?.[tc]?.oreAmount ?? 0) > 100) {
                hv.giveOrder({ type: 'harvest', target: this.gameMap.tileToWorld(tc, tr) })
                sent = true
              }
            }
          }
        }
      }

      // 2 rifle soldiers flanking the base
      for (let j = 0; j < 2; j++) {
        this.entityMgr.createUnit(player.id, 'rifle_soldier',
          spawnWorld.x - TILE_SIZE * 3 + j * TILE_SIZE * 2,
          spawnWorld.y + TILE_SIZE)
      }
    })
  }

  // ── Fog of War ────────────────────────────────────────────────

  private updateFogOfWar(): void {
    const sources: Array<{ pos: TileCoord; range: number }> = []
    const localId = this.gameState.localPlayerId

    // Scan all units + buildings belonging to human player
    for (const u of this.entityMgr.getAllUnits()) {
      if (u.playerId === localId && u.hp > 0) {
        const pos = this.gameMap.worldToTile(u.x, u.y)
        sources.push({ pos, range: u.def.stats.sightRange })
      }
    }
    for (const b of this.entityMgr.getAllBuildings()) {
      if (b.playerId === localId && b.hp > 0) {
        const pos = this.gameMap.worldToTile(b.x, b.y)
        sources.push({ pos, range: b.def.stats.sightRange })
      }
    }

    if (sources.length > 0) {
      this.gameMap.updateFog(sources)
    }
  }

  // ── Input ─────────────────────────────────────────────────────

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D,H') as Record<string, Phaser.Input.Keyboard.Key>

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
      if (this.isDragging) this.endDragSelect(ptr)
    })

    // ESC — deselect all
    this.input.keyboard!.on('keydown-ESC', () => this.deselectAll())

    // S — stop selected units
    this.input.keyboard!.on('keydown-S', () => {
      this.selectedIds.forEach(id => {
        this.entityMgr.getUnit(id)?.giveOrder({ type: 'stop' })
      })
    })

    // H — snap camera to home base
    this.input.keyboard!.on('keydown-H', () => {
      const home = this.gameMap.data.startPositions[0]
      if (home) {
        this.camX = home.x - this.scale.width / 2
        this.camY = home.y - this.scale.height / 2
      }
    })

    // A — attack-move selected units to cursor
    this.input.keyboard!.on('keydown-A', () => {
      const ptr = this.input.activePointer
      const worldX = ptr.worldX
      const worldY = ptr.worldY
      this.selectedIds.forEach(id => {
        this.entityMgr.getUnit(id)?.giveOrder({
          type: 'attackMove',
          target: { x: worldX, y: worldY },
        })
      })
    })
  }

  private handleRightClick(ptr: Phaser.Input.Pointer): void {
    if (this.selectedIds.size === 0) return

    const worldX = ptr.worldX
    const worldY = ptr.worldY
    const clickRadius = TILE_SIZE * 2

    // Check for attackable enemies near click
    const enemies = this.entityMgr.getEnemyUnitsInRange(worldX, worldY, clickRadius, 0)
    const enemyBuilds = this.entityMgr.getEnemyBuildingsInRange(worldX, worldY, clickRadius, 0)
    const attackTarget = enemies[0] ?? enemyBuilds[0]

    const clickTile = this.gameMap.worldToTile(worldX, worldY)
    const tile = this.gameMap.getTile(clickTile.col, clickTile.row)

    this.selectedIds.forEach(id => {
      const unit = this.entityMgr.getUnit(id)
      if (!unit || unit.playerId !== 0) return

      if (attackTarget) {
        unit.giveOrder({ type: 'attack', targetEntityId: attackTarget.id })
      } else if (tile?.terrain === TerrainType.ORE && unit.def.category === 'harvester') {
        unit.giveOrder({ type: 'harvest', target: { x: worldX, y: worldY } })
      } else {
        unit.giveOrder({ type: 'move', target: { x: worldX, y: worldY } })
      }
    })
  }

  private startDragSelect(ptr: Phaser.Input.Pointer): void {
    this.isDragging = true
    this.dragAnchorScreen = { x: ptr.x, y: ptr.y }
    this.dragAnchorWorld  = { x: ptr.worldX, y: ptr.worldY }
  }

  private updateDragSelect(ptr: Phaser.Input.Pointer): void {
    // Draw in screen space (scroll-factor 0)
    const sx1 = Math.min(this.dragAnchorScreen.x, ptr.x)
    const sy1 = Math.min(this.dragAnchorScreen.y, ptr.y)
    const sx2 = Math.max(this.dragAnchorScreen.x, ptr.x)
    const sy2 = Math.max(this.dragAnchorScreen.y, ptr.y)

    this.selectionRect.clear()
    this.selectionRect.fillStyle(0x00ff00, 0.1)
    this.selectionRect.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1)
    this.selectionRect.lineStyle(1, 0x00ff00, 0.8)
    this.selectionRect.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1)
  }

  private endDragSelect(ptr: Phaser.Input.Pointer): void {
    this.isDragging = false
    const w = Math.abs(ptr.worldX - this.dragAnchorWorld.x)
    const h = Math.abs(ptr.worldY - this.dragAnchorWorld.y)

    if (w > 4 && h > 4) {
      const x1 = Math.min(this.dragAnchorWorld.x, ptr.worldX)
      const y1 = Math.min(this.dragAnchorWorld.y, ptr.worldY)

      if (!(ptr.event as MouseEvent)?.shiftKey) this.deselectAll()

      // Select player 0 units within the drag rect
      const units = this.entityMgr.getUnitsForPlayer(0)
      units.forEach(u => {
        if (u.x >= x1 && u.x <= x1 + w && u.y >= y1 && u.y <= y1 + h) {
          this.selectedIds.add(u.id)
          u.setSelected(true)
        }
      })

      this.gameState.selectedEntityIds = Array.from(this.selectedIds)
      this.registry.set('selectedIds', this.gameState.selectedEntityIds)
    }

    this.selectionRect.clear()
  }

  private deselectAll(): void {
    this.selectedIds.forEach(id => this.entityMgr.getUnit(id)?.setSelected(false))
    this.selectedIds.clear()
    this.gameState.selectedEntityIds = []
    this.registry.set('selectedIds', [])
  }

  private handleCameraScroll(delta: number): void {
    const dt = delta / 1000
    const speed = this.camSpeed
    let dx = 0, dy = 0

    if (this.cursors.left.isDown  || this.wasdKeys['A']?.isDown) dx -= speed * dt
    if (this.cursors.right.isDown || this.wasdKeys['D']?.isDown) dx += speed * dt
    if (this.cursors.up.isDown    || this.wasdKeys['W']?.isDown) dy -= speed * dt
    if (this.cursors.down.isDown  || this.wasdKeys['S']?.isDown) dy += speed * dt

    // Edge scrolling (20px border)
    const ptr = this.input.activePointer
    const edgeW = 20
    const W = this.scale.width
    const H = this.scale.height
    if (ptr.x < edgeW)     dx -= speed * dt
    if (ptr.x > W - edgeW) dx += speed * dt
    if (ptr.y < edgeW)     dy -= speed * dt
    if (ptr.y > H - edgeW) dy += speed * dt

    this.camX += dx
    this.camY += dy
  }

  // ── Win / Loss ────────────────────────────────────────────────

  private checkWinCondition(): void {
    const players = this.gameState.players

    // Mark AI players as defeated if no buildings remain
    players.filter(p => p.isAI).forEach(p => {
      const aliveBuildings = this.entityMgr.getBuildingsForPlayer(p.id)
        .filter(b => b.state !== 'dying')
      if (aliveBuildings.length === 0 && p.entities.length > 0) {
        p.isDefeated = true
      }
    })

    if (players.filter(p => p.isAI).every(p => p.isDefeated)) {
      this.triggerVictory()
      return
    }

    const humanBuildings = this.entityMgr.getBuildingsForPlayer(0)
      .filter(b => b.state !== 'dying')
    const human = players.find(p => p.id === 0)!
    if (humanBuildings.length === 0 && human.entities.length > 0) {
      this.triggerDefeat()
    }
  }

  private triggerVictory(): void {
    if (this.gameState.phase !== 'playing') return
    this.gameState.phase = 'victory'
    this.showEndScreen('MISSION COMPLETE', '#44ee44')
  }

  private triggerDefeat(): void {
    if (this.gameState.phase !== 'playing') return
    this.gameState.phase = 'defeat'
    this.showEndScreen('MISSION FAILED', '#ee4444')
  }

  private showEndScreen(msg: string, color: string): void {
    const { width, height } = this.scale

    const overlay = this.add.graphics()
    overlay.setScrollFactor(0).setDepth(200)
    overlay.fillStyle(0x000000, 0.7)
    overlay.fillRect(0, 0, width, height)

    this.add.text(width / 2, height / 2 - 40, msg, {
      fontFamily: 'monospace', fontSize: '48px', color,
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0)

    this.time.delayedCall(4000, () => {
      this.scene.stop('HUDScene')
      this.scene.start('MenuScene')
    })
  }
}
