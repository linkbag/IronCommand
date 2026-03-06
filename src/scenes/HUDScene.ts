// ============================================================
// IRON COMMAND — HUDScene
// EVA-style sidebar HUD overlay (runs simultaneously with GameScene)
// ============================================================

import Phaser from 'phaser'
import type { Player, GameState, BuildingCategory } from '../types'
import { FACTIONS } from '../data/factions'

const SIDEBAR_W = 200
const HUD_BG    = 0x0d0d1a
const HUD_PANEL = 0x12121e
const HUD_BORDER = 0x1c2a4a
const HUD_ACCENT = 0xe94560
const HUD_TEXT  = 0xeeeeee
const HUD_DIM   = 0x667788
const POWER_GREEN  = 0x44cc44
const POWER_YELLOW = 0xcccc44
const POWER_RED    = 0xcc4444

type BuildTab = 'buildings' | 'infantry' | 'vehicles' | 'aircraft'

interface BuildableItem {
  id: string
  label: string
  abbrev: string
  cost: number
  tab: BuildTab
  buildTime: number
}

// Hardcoded buildable items (real data comes from entities/defs when merged)
const BUILD_ITEMS: BuildableItem[] = [
  // Buildings
  { id: 'power_plant',       label: 'Power Plant',       abbrev: 'PP', cost: 300,  tab: 'buildings', buildTime: 10 },
  { id: 'barracks',          label: 'Barracks',           abbrev: 'BK', cost: 500,  tab: 'buildings', buildTime: 15 },
  { id: 'war_factory',       label: 'War Factory',        abbrev: 'WF', cost: 2000, tab: 'buildings', buildTime: 30 },
  { id: 'airfield',          label: 'Airfield',           abbrev: 'AF', cost: 1500, tab: 'buildings', buildTime: 25 },
  { id: 'ore_refinery',      label: 'Ore Refinery',       abbrev: 'OR', cost: 2000, tab: 'buildings', buildTime: 20 },
  { id: 'radar_tower',       label: 'Radar Tower',        abbrev: 'RT', cost: 800,  tab: 'buildings', buildTime: 12 },
  { id: 'tech_center',       label: 'Tech Center',        abbrev: 'TC', cost: 3000, tab: 'buildings', buildTime: 40 },
  { id: 'turret',            label: 'Gun Turret',         abbrev: 'TU', cost: 600,  tab: 'buildings', buildTime: 8  },
  { id: 'aa_gun',            label: 'AA Gun',             abbrev: 'AA', cost: 600,  tab: 'buildings', buildTime: 8  },
  { id: 'wall',              label: 'Concrete Wall',      abbrev: 'WL', cost: 50,   tab: 'buildings', buildTime: 2  },
  // Infantry
  { id: 'rifle',             label: 'Rifle Infantry',     abbrev: 'RI', cost: 100,  tab: 'infantry', buildTime: 5  },
  { id: 'rocket',            label: 'Rocket Soldier',     abbrev: 'RK', cost: 200,  tab: 'infantry', buildTime: 7  },
  { id: 'engineer',          label: 'Engineer',           abbrev: 'EN', cost: 250,  tab: 'infantry', buildTime: 8  },
  { id: 'dog',               label: 'Attack Dog',         abbrev: 'DG', cost: 150,  tab: 'infantry', buildTime: 4  },
  // Vehicles
  { id: 'light_tank',        label: 'Light Tank',         abbrev: 'LT', cost: 600,  tab: 'vehicles', buildTime: 12 },
  { id: 'heavy_tank',        label: 'Heavy Tank',         abbrev: 'HT', cost: 1200, tab: 'vehicles', buildTime: 20 },
  { id: 'artillery',         label: 'Artillery',          abbrev: 'AR', cost: 1000, tab: 'vehicles', buildTime: 18 },
  { id: 'apc',               label: 'APC',                abbrev: 'AP', cost: 700,  tab: 'vehicles', buildTime: 14 },
  { id: 'harvester',         label: 'Ore Harvester',      abbrev: 'HV', cost: 1400, tab: 'vehicles', buildTime: 14 },
  // Aircraft
  { id: 'fighter',           label: 'Fighter Jet',        abbrev: 'FJ', cost: 1200, tab: 'aircraft', buildTime: 20 },
  { id: 'helicopter',        label: 'Helicopter',         abbrev: 'HC', cost: 900,  tab: 'aircraft', buildTime: 16 },
]

export class HUDScene extends Phaser.Scene {
  private gameState!: GameState
  private humanPlayer!: Player

  // UI refs
  private creditsText!: Phaser.GameObjects.Text
  private powerText!: Phaser.GameObjects.Text
  private powerBar!: Phaser.GameObjects.Graphics
  private selectedInfoText!: Phaser.GameObjects.Text
  private selectedNameText!: Phaser.GameObjects.Text
  private alertText!: Phaser.GameObjects.Text
  private alertTween?: Phaser.Tweens.Tween

  private activeTab: BuildTab = 'buildings'
  private tabButtons: Map<BuildTab, { bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text }> = new Map()
  private buildItemButtons: Phaser.GameObjects.Container[] = []

  // Build progress tracker (itemId → 0-1)
  private buildProgress: Map<string, number> = new Map()
  private buildTimers: Map<string, number> = new Map()

  // Minimap
  private minimapGraphics!: Phaser.GameObjects.Graphics
  private minimapX = 0
  private minimapY = 0
  private minimapW = 0
  private minimapH = 0

  private sidebarX = 0

  constructor() {
    super({ key: 'HUDScene' })
  }

  init(data: { gameState: GameState }) {
    this.gameState = data?.gameState
  }

  create() {
    const { width, height } = this.scale
    this.sidebarX = width - SIDEBAR_W

    this.createSidebar(width, height)
    this.createMinimap(width, height)
    this.createAlertSystem(width)
    this.setupKeyboardShortcuts()
    this.switchTab('buildings')
  }

  update(_time: number, delta: number) {
    // Sync state from registry (GameScene writes it each frame)
    const latestState = this.registry.get('gameState') as GameState | undefined
    if (latestState) {
      this.gameState = latestState
    }

    this.humanPlayer = this.gameState?.players?.find(p => !p.isAI) ?? this.humanPlayer
    if (!this.humanPlayer) return

    this.updateCredits()
    this.updatePower()
    this.updateMinimap()
    this.updateBuildProgress(delta)
    this.updateSelectedInfo()
  }

  // ── Sidebar ────────────────────────────────────────────────────────

  private createSidebar(width: number, height: number) {
    const x = this.sidebarX

    // Main panel background
    const bg = this.add.graphics()
    bg.fillStyle(HUD_BG, 0.97)
    bg.fillRect(x, 0, SIDEBAR_W, height)
    bg.lineStyle(1, HUD_BORDER, 1)
    bg.lineBetween(x, 0, x, height)

    // ─ Faction header ─
    const headerH = 64
    bg.fillStyle(HUD_PANEL, 1)
    bg.fillRect(x, 0, SIDEBAR_W, headerH)
    bg.lineStyle(1, HUD_ACCENT, 0.4)
    bg.lineBetween(x, headerH, x + SIDEBAR_W, headerH)

    // Faction flag + name
    const faction = FACTIONS[this.gameState?.players?.[0]?.faction ?? 'usa']
    this.add.text(x + 10, 10, faction.flag, { fontSize: '24px' })
    this.add.text(x + 42, 10, faction.name.toUpperCase(), {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#cccccc',
    })

    // Credits
    this.creditsText = this.add.text(x + 10, 32, '$ --', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffdd44',
      stroke: '#000',
      strokeThickness: 2,
    })

    // ─ Power bar ─
    const powerY = headerH + 4
    this.add.text(x + 10, powerY, 'PWR', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#888888',
    })
    this.powerText = this.add.text(x + SIDEBAR_W - 10, powerY, '', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#aaaaaa',
    }).setOrigin(1, 0)

    this.powerBar = this.add.graphics()
    this.drawPowerBar(0, 0)

    // ─ Build tabs ─
    const tabY = powerY + 22
    const tabs: BuildTab[] = ['buildings', 'infantry', 'vehicles', 'aircraft']
    const tabLabels = ['BLD', 'INF', 'VEH', 'AIR']
    const tabW = Math.floor(SIDEBAR_W / tabs.length)

    tabs.forEach((tab, i) => {
      const tx = x + i * tabW
      const bg2 = this.add.graphics()
      const txt = this.add.text(tx + tabW / 2, tabY + 14, tabLabels[i], {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#aaaaaa',
      }).setOrigin(0.5)

      this.tabButtons.set(tab, { bg: bg2, text: txt })

      const zone = this.add.zone(tx + tabW / 2, tabY + 14, tabW, 28).setInteractive({ cursor: 'pointer' })
      zone.on('pointerdown', () => this.switchTab(tab))
      zone.on('pointerover', () => txt.setColor('#ffffff'))
      zone.on('pointerout', () => {
        if (this.activeTab !== tab) txt.setColor('#aaaaaa')
      })
    })

    // ─ Selected unit info (bottom panel) ─
    const infoY = height - 100
    const infoG = this.add.graphics()
    infoG.fillStyle(HUD_PANEL, 1)
    infoG.fillRect(x, infoY, SIDEBAR_W, 100)
    infoG.lineStyle(1, HUD_BORDER, 1)
    infoG.lineBetween(x, infoY, x + SIDEBAR_W, infoY)

    this.selectedNameText = this.add.text(x + 10, infoY + 8, 'No Selection', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#e94560',
    })

    this.selectedInfoText = this.add.text(x + 10, infoY + 26, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#aaaaaa',
      wordWrap: { width: SIDEBAR_W - 20 },
    })
  }

  private drawPowerBar(generated: number, consumed: number) {
    const x = this.sidebarX
    const y = 78
    const w = SIDEBAR_W - 20
    const h = 6
    const g = this.powerBar
    g.clear()

    // Background
    g.fillStyle(0x222233, 1)
    g.fillRect(x + 10, y, w, h)

    if (generated <= 0) return
    const pct = Math.min(1, consumed / generated)
    const barColor = pct < 0.8 ? POWER_GREEN : pct < 1.0 ? POWER_YELLOW : POWER_RED
    g.fillStyle(barColor, 1)
    g.fillRect(x + 10, y, Math.floor(w * Math.min(pct, 1)), h)

    // Capacity marker
    g.lineStyle(1, 0x666688, 0.6)
    g.lineBetween(x + 10 + w * 0.75, y - 1, x + 10 + w * 0.75, y + h + 1)
  }

  private switchTab(tab: BuildTab) {
    this.activeTab = tab

    // Update tab visuals
    this.tabButtons.forEach(({ bg, text }, t) => {
      bg.clear()
      const isActive = t === tab
      const tabW = Math.floor(SIDEBAR_W / 4)
      const idx = ['buildings', 'infantry', 'vehicles', 'aircraft'].indexOf(t)
      const tx = this.sidebarX + idx * tabW
      const tabY = 90
      bg.fillStyle(isActive ? HUD_ACCENT : HUD_PANEL, 1)
      bg.fillRect(tx, tabY, tabW, 28)
      bg.lineStyle(1, isActive ? HUD_ACCENT : HUD_BORDER, 0.6)
      bg.strokeRect(tx, tabY, tabW, 28)
      text.setColor(isActive ? '#ffffff' : '#aaaaaa')
    })

    this.rebuildItemGrid()
  }

  private rebuildItemGrid() {
    // Destroy existing buttons
    this.buildItemButtons.forEach(c => c.destroy())
    this.buildItemButtons = []

    const items = BUILD_ITEMS.filter(it => it.tab === this.activeTab)
    const x = this.sidebarX
    const startY = 124
    const btnW = 56
    const btnH = 56
    const cols = 3
    const gap = 4
    const { height } = this.scale
    const maxRows = Math.floor((height - startY - 104) / (btnH + gap))

    items.slice(0, cols * maxRows).forEach((item, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const bx = x + gap + col * (btnW + gap)
      const by = startY + row * (btnH + gap)

      const container = this.add.container(bx + btnW / 2, by + btnH / 2)

      const bg2 = this.add.graphics()
      bg2.fillStyle(HUD_PANEL, 1)
      bg2.fillRect(-btnW / 2, -btnH / 2, btnW, btnH)
      bg2.lineStyle(1, HUD_BORDER, 1)
      bg2.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH)

      const abbrevTxt = this.add.text(0, -8, item.abbrev, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#cccccc',
      }).setOrigin(0.5)

      const costTxt = this.add.text(0, 14, `$${item.cost}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffdd44',
      }).setOrigin(0.5)

      // Build progress bar
      const progressBar = this.add.graphics()

      container.add([bg2, abbrevTxt, costTxt, progressBar])
      this.buildItemButtons.push(container)

      // Interactive
      const zone = this.add.zone(bx + btnW / 2, by + btnH / 2, btnW, btnH)
        .setInteractive({ cursor: 'pointer' })

      zone.on('pointerover', () => {
        bg2.clear()
        bg2.fillStyle(HUD_BORDER, 1)
        bg2.fillRect(-btnW / 2, -btnH / 2, btnW, btnH)
        bg2.lineStyle(1, HUD_ACCENT, 0.8)
        bg2.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH)
      })
      zone.on('pointerout', () => {
        bg2.clear()
        bg2.fillStyle(HUD_PANEL, 1)
        bg2.fillRect(-btnW / 2, -btnH / 2, btnW, btnH)
        bg2.lineStyle(1, HUD_BORDER, 1)
        bg2.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH)
        // Redraw progress if any
        const prog = this.buildProgress.get(item.id) ?? 0
        if (prog > 0) {
          progressBar.clear()
          progressBar.fillStyle(HUD_ACCENT, 0.8)
          progressBar.fillRect(-btnW / 2, btnH / 2 - 4, btnW * prog, 4)
        }
      })
      zone.on('pointerdown', () => this.startBuild(item))

      // Store ref for progress updates
      ;(container as Phaser.GameObjects.Container & { _item: BuildableItem; _progressBar: Phaser.GameObjects.Graphics })._item = item
      ;(container as Phaser.GameObjects.Container & { _item: BuildableItem; _progressBar: Phaser.GameObjects.Graphics })._progressBar = progressBar
    })
  }

  private startBuild(item: BuildableItem) {
    const player = this.humanPlayer
    if (!player) return
    if (player.credits < item.cost) {
      this.showAlert('INSUFFICIENT CREDITS')
      return
    }
    if (this.buildProgress.has(item.id)) {
      this.showAlert('ALREADY BUILDING...')
      return
    }

    // Deduct credits (local only — real deduction handled by economy module)
    player.credits -= item.cost
    this.buildProgress.set(item.id, 0)
    this.buildTimers.set(item.id, item.buildTime * 1000)

    this.showAlert(`BUILDING: ${item.label.toUpperCase()}`)
  }

  private updateBuildProgress(delta: number) {
    this.buildProgress.forEach((prog, id) => {
      const remaining = (this.buildTimers.get(id) ?? 0) - delta
      if (remaining <= 0) {
        this.buildProgress.delete(id)
        this.buildTimers.delete(id)
        const item = BUILD_ITEMS.find(i => i.id === id)
        if (item) this.showAlert(`${item.label.toUpperCase()} READY`)
      } else {
        this.buildTimers.set(id, remaining)
        const item = BUILD_ITEMS.find(i => i.id === id)
        if (item) {
          const total = item.buildTime * 1000
          this.buildProgress.set(id, 1 - remaining / total)
        }
      }
    })

    // Update progress bars on visible build buttons
    this.buildItemButtons.forEach(container => {
      const typed = container as Phaser.GameObjects.Container & { _item: BuildableItem; _progressBar: Phaser.GameObjects.Graphics }
      if (!typed._item || !typed._progressBar) return
      const prog = this.buildProgress.get(typed._item.id) ?? 0
      const bar = typed._progressBar
      bar.clear()
      if (prog > 0) {
        const btnW = 56
        const btnH = 56
        bar.fillStyle(HUD_ACCENT, 0.85)
        bar.fillRect(-btnW / 2, btnH / 2 - 5, btnW * prog, 5)
      }
    })
  }

  // ── Minimap ────────────────────────────────────────────────────────

  private createMinimap(width: number, height: number) {
    const mmSize = SIDEBAR_W - 8
    this.minimapW = mmSize
    this.minimapH = mmSize
    this.minimapX = width - SIDEBAR_W + 4
    this.minimapY = height - 104 - mmSize - 4

    // Border
    const border = this.add.graphics()
    border.lineStyle(2, HUD_ACCENT, 0.6)
    border.strokeRect(this.minimapX - 1, this.minimapY - 1, mmSize + 2, mmSize + 2)
    border.fillStyle(0x000000, 1)
    border.fillRect(this.minimapX, this.minimapY, mmSize, mmSize)

    this.minimapGraphics = this.add.graphics()
  }

  private updateMinimap() {
    const g = this.minimapGraphics
    g.clear()

    if (!this.gameState?.map) return

    const map = this.gameState.map
    const scaleX = this.minimapW / map.width
    const scaleY = this.minimapH / map.height

    // Draw entities as colored dots
    const entityMgr = this.registry.get('entityMgr') as { getAllEntities(): Array<{ id: string; playerId: number; type: string; x: number; y: number; isAlive: boolean }> } | undefined
    if (entityMgr) {
      entityMgr.getAllEntities().forEach(e => {
        if (!e.isAlive) return
        const player = this.gameState.players.find(p => p.id === e.playerId)
        const color = player?.color ?? 0xffffff
        const mx = this.minimapX + (e.x / 32) * scaleX
        const my = this.minimapY + (e.y / 32) * scaleY
        g.fillStyle(color, 1)
        g.fillRect(mx - 1, my - 1, e.type === 'building' ? 3 : 2, e.type === 'building' ? 3 : 2)
      })
    }

    // Camera viewport indicator
    const camX = this.registry.get('camX') as number | undefined ?? 0
    const camY = this.registry.get('camY') as number | undefined ?? 0
    const vw = (this.scale.width / 32) * scaleX
    const vh = (this.scale.height / 32) * scaleY
    const vx = this.minimapX + (camX / 32) * scaleX
    const vy = this.minimapY + (camY / 32) * scaleY
    g.lineStyle(1, 0xffffff, 0.5)
    g.strokeRect(vx, vy, vw, vh)
  }

  // ── Live Updates ───────────────────────────────────────────────────

  private updateCredits() {
    if (!this.humanPlayer) return
    const cr = this.humanPlayer.credits
    this.creditsText.setText(`$ ${cr.toLocaleString()}`)
  }

  private updatePower() {
    if (!this.humanPlayer) return
    const { powerGenerated, powerConsumed } = this.humanPlayer
    this.powerText.setText(`${powerConsumed}/${powerGenerated}`)

    const pct = powerGenerated > 0 ? powerConsumed / powerGenerated : 0
    const color = pct < 0.8 ? '#44cc44' : pct < 1 ? '#cccc44' : '#cc4444'
    this.powerText.setColor(color)
    this.drawPowerBar(powerGenerated, powerConsumed)
  }

  private updateSelectedInfo() {
    const selectedIds = this.registry.get('selectedIds') as string[] | undefined ?? []
    if (selectedIds.length === 0) {
      this.selectedNameText.setText('No Selection')
      this.selectedInfoText.setText('')
      return
    }
    const entityMgr = this.registry.get('entityMgr') as { getEntity(id: string): { defId: string; hp: number; maxHp: number } | undefined } | undefined
    const first = entityMgr?.getEntity(selectedIds[0])
    if (!first) return

    const pct = Math.round((first.hp / first.maxHp) * 100)
    this.selectedNameText.setText(first.defId.replace(/_/g, ' ').toUpperCase())
    this.selectedInfoText.setText(
      `HP: ${first.hp}/${first.maxHp} (${pct}%)\nSelected: ${selectedIds.length}`
    )
  }

  // ── Alert System ───────────────────────────────────────────────────

  private createAlertSystem(width: number) {
    this.alertText = this.add.text(width / 2, 16, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffdd44',
      stroke: '#000000',
      strokeThickness: 3,
      backgroundColor: '#00000080',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 0).setAlpha(0).setDepth(200)
  }

  showAlert(msg: string) {
    if (this.alertTween) {
      this.alertTween.stop()
    }
    this.alertText.setText(msg).setAlpha(1)
    this.alertTween = this.tweens.add({
      targets: this.alertText,
      alpha: 0,
      delay: 2000,
      duration: 600,
    })
  }

  // ── Keyboard Shortcuts ─────────────────────────────────────────────

  private setupKeyboardShortcuts() {
    this.input.keyboard?.on('keydown-B', () => {
      this.switchTab('buildings')
    })
    this.input.keyboard?.on('keydown-DELETE', () => {
      // Sell selected building — placeholder
      this.showAlert('SELL: NOT IMPLEMENTED')
    })
    this.input.keyboard?.on('keydown-ONE',   () => this.switchTab('buildings'))
    this.input.keyboard?.on('keydown-TWO',   () => this.switchTab('infantry'))
    this.input.keyboard?.on('keydown-THREE', () => this.switchTab('vehicles'))
    this.input.keyboard?.on('keydown-FOUR',  () => this.switchTab('aircraft'))
  }
}
