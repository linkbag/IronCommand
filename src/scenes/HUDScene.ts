// ============================================================
// IRON COMMAND — HUDScene (RA2-Style Overhaul)
// EVA sidebar: build panel, placement mode, power bar, alerts
// ============================================================

import Phaser from 'phaser'
import type { Player, GameState } from '../types'
import { FACTIONS } from '../data/factions'

// ── Layout constants ───────────────────────────────────────────────────
const SIDEBAR_W       = 220
const MINIMAP_H       = 130
const PLAYER_INFO_H   = 50
const POWER_BAR_H     = 22
const TAB_H           = 28
const BTN_W           = 96
const BTN_H           = 56
const BTN_GAP         = 4
const BTN_PAD         = 6
const SELECTED_H      = 90
const ACTION_H        = 30
const MAX_ALERTS      = 3
const ALERT_SPACING   = 34

// ── Colours ────────────────────────────────────────────────────────────
const HUD_BG      = 0x0a0a1a
const HUD_PANEL   = 0x1a1a2e
const HUD_BORDER  = 0x2a3a5e
const HUD_ACCENT  = 0xe94560
const HUD_GREEN   = 0x4ade80
const HUD_GOLD    = 0xffd700
const POWER_GREEN  = 0x44cc44
const POWER_YELLOW = 0xcccc44
const POWER_RED    = 0xcc4444

// ── Types ──────────────────────────────────────────────────────────────
type BuildTab   = 'buildings' | 'infantry' | 'vehicles' | 'aircraft'
type AlertType  = 'success' | 'warning' | 'danger' | 'info'
type CursorMode = 'normal' | 'sell' | 'repair' | 'attackMove' | 'placement'

interface BuildableItem {
  id: string
  label: string
  abbrev: string
  cost: number
  tab: BuildTab
  buildTime: number
}

interface AlertEntry {
  container: Phaser.GameObjects.Container
  tween?: Phaser.Tweens.Tween
}

// Extended container reference
interface BuildBtn extends Phaser.GameObjects.Container {
  _item: BuildableItem
  _bg: Phaser.GameObjects.Graphics
  _progressBar: Phaser.GameObjects.Graphics
  _queueTxt: Phaser.GameObjects.Text
  _readyTxt: Phaser.GameObjects.Text
}

// ── Build catalogue ────────────────────────────────────────────────────
const BUILD_ITEMS: BuildableItem[] = [
  // Buildings (matching BuildingDefs.ts costs/times)
  { id: 'power_plant',    label: 'Power Plant',    abbrev: 'PP', cost: 500,  tab: 'buildings', buildTime: 15 },
  { id: 'barracks',       label: 'Barracks',       abbrev: 'BK', cost: 500,  tab: 'buildings', buildTime: 20 },
  { id: 'war_factory',    label: 'War Factory',    abbrev: 'WF', cost: 2000, tab: 'buildings', buildTime: 40 },
  { id: 'ore_refinery',   label: 'Ore Refinery',   abbrev: 'OR', cost: 2000, tab: 'buildings', buildTime: 30 },
  { id: 'airfield',       label: 'Airfield',       abbrev: 'AF', cost: 2000, tab: 'buildings', buildTime: 35 },
  { id: 'radar_tower',    label: 'Radar Tower',    abbrev: 'RT', cost: 1000, tab: 'buildings', buildTime: 25 },
  { id: 'tech_center',    label: 'Tech Center',    abbrev: 'TC', cost: 2500, tab: 'buildings', buildTime: 50 },
  { id: 'turret',         label: 'Gun Turret',     abbrev: 'TU', cost: 600,  tab: 'buildings', buildTime: 15 },
  { id: 'aa_gun',         label: 'AA Gun',         abbrev: 'AA', cost: 700,  tab: 'buildings', buildTime: 15 },
  { id: 'wall',           label: 'Wall',           abbrev: 'WL', cost: 100,  tab: 'buildings', buildTime: 5  },
  { id: 'advanced_power', label: 'Adv. Power',     abbrev: 'AP', cost: 1500, tab: 'buildings', buildTime: 30 },
  { id: 'superweapon',    label: 'Superweapon',    abbrev: 'SW', cost: 5000, tab: 'buildings', buildTime: 120 },
  // Infantry
  { id: 'rifle_soldier',  label: 'Rifle Soldier',  abbrev: 'RI', cost: 200,  tab: 'infantry',  buildTime: 5  },
  { id: 'rocket_soldier', label: 'Rocket Soldier', abbrev: 'RK', cost: 400,  tab: 'infantry',  buildTime: 10 },
  { id: 'engineer',       label: 'Engineer',       abbrev: 'EN', cost: 600,  tab: 'infantry',  buildTime: 15 },
  { id: 'attack_dog',     label: 'Attack Dog',     abbrev: 'DG', cost: 200,  tab: 'infantry',  buildTime: 5  },
  // Vehicles
  { id: 'light_tank',     label: 'Light Tank',     abbrev: 'LT', cost: 800,  tab: 'vehicles',  buildTime: 15 },
  { id: 'heavy_tank',     label: 'Heavy Tank',     abbrev: 'HT', cost: 1500, tab: 'vehicles',  buildTime: 25 },
  { id: 'artillery',      label: 'Artillery',      abbrev: 'AR', cost: 1200, tab: 'vehicles',  buildTime: 22 },
  { id: 'apc',            label: 'APC',            abbrev: 'AP', cost: 800,  tab: 'vehicles',  buildTime: 15 },
  { id: 'harvester',      label: 'Harvester',      abbrev: 'HV', cost: 1400, tab: 'vehicles',  buildTime: 20 },
  // Aircraft
  { id: 'fighter_jet',    label: 'Fighter Jet',    abbrev: 'FJ', cost: 1200, tab: 'aircraft',  buildTime: 20 },
  { id: 'bomber',         label: 'Bomber',         abbrev: 'BM', cost: 1800, tab: 'aircraft',  buildTime: 30 },
]

// ── HUDScene ───────────────────────────────────────────────────────────
export class HUDScene extends Phaser.Scene {
  private gameState!: GameState
  private humanPlayer!: Player
  private sidebarX = 0

  // ── Layout Y anchors (set in create) ──────────────────────────────
  private minimapY    = 4
  private playerInfoY = 0
  private powerBarY   = 0
  private tabY        = 0
  private buildGridY  = 0
  private selectedY   = 0
  private actionY     = 0

  // ── Credits animation ─────────────────────────────────────────────
  private displayedCredits = 0
  private targetCredits    = 0

  // ── UI elements ───────────────────────────────────────────────────
  private creditsText!:     Phaser.GameObjects.Text
  private powerText!:       Phaser.GameObjects.Text
  private powerBarFill!:    Phaser.GameObjects.Graphics
  private selectedNameTxt!: Phaser.GameObjects.Text
  private selectedInfoTxt!: Phaser.GameObjects.Text
  private selectedHPFill!:  Phaser.GameObjects.Graphics
  private selectedIcon!:    Phaser.GameObjects.Graphics

  // ── Build panel ───────────────────────────────────────────────────
  private activeTab: BuildTab = 'buildings'
  private tabBgs:   Map<BuildTab, Phaser.GameObjects.Graphics> = new Map()
  private buildBtns: BuildBtn[] = []
  private buildZones: Phaser.GameObjects.Zone[] = []

  private buildProgress:  Map<string, number> = new Map()  // 0-1
  private buildTimers:    Map<string, number> = new Map()  // ms remaining
  private buildQueueCnt:  Map<string, number> = new Map()
  private pendingPlace:   Set<string>         = new Set()  // ready to place
  private creditsPaid:    Map<string, number> = new Map()  // credits already deducted for item

  // ── Placement ghost ───────────────────────────────────────────────
  private placementMode  = false
  private placementDefId: string | null = null
  private ghost!:         Phaser.GameObjects.Graphics
  private ghostLabel!:    Phaser.GameObjects.Text

  // ── Cursor mode ───────────────────────────────────────────────────
  private cursorMode: CursorMode = 'normal'

  // ── EVA alerts ────────────────────────────────────────────────────
  private alertEntries: AlertEntry[] = []

  // ── Minimap ───────────────────────────────────────────────────────
  private mmGfx!: Phaser.GameObjects.Graphics
  private mmW = SIDEBAR_W - 8
  private mmH = MINIMAP_H

  // ── Selection groups ──────────────────────────────────────────────
  private selGroups: Map<number, string[]> = new Map()

  constructor() {
    super({ key: 'HUDScene' })
  }

  init(data: { gameState: GameState }) {
    this.gameState = data?.gameState
    const human = this.gameState?.players?.find(p => !p.isAI)
    if (human) {
      this.displayedCredits = human.credits
      this.targetCredits    = human.credits
    }
  }

  create() {
    const { width, height } = this.scale
    this.sidebarX = width - SIDEBAR_W

    // Compute layout Y anchors
    this.minimapY    = 4
    this.playerInfoY = this.minimapY + MINIMAP_H + 4
    this.powerBarY   = this.playerInfoY + PLAYER_INFO_H
    this.tabY        = this.powerBarY  + POWER_BAR_H
    this.buildGridY  = this.tabY       + TAB_H + 4
    this.selectedY   = height - SELECTED_H - ACTION_H
    this.actionY     = height - ACTION_H

    this.buildSidebarBg(width, height)
    this.buildMinimap()
    this.buildPlayerInfo()
    this.buildPowerBar()
    this.buildTabs()
    this.buildSelectedPanel()
    this.buildActionButtons()
    this.buildAlertSystem()
    this.buildGhost()
    this.setupKeys()
    this.setupEvents()
    this.switchTab('buildings')
  }

  update(_time: number, delta: number) {
    const latest = this.registry.get('gameState') as GameState | undefined
    if (latest) this.gameState = latest

    this.humanPlayer = this.gameState?.players?.find(p => !p.isAI) ?? this.humanPlayer
    if (!this.humanPlayer) return

    this.targetCredits = this.humanPlayer.credits
    this.tickCredits(delta)
    this.tickPower()
    this.tickMinimap()
    this.tickBuildProgress(delta)
    this.tickSelectedInfo()
    this.tickGhost()
  }

  // ════════════════════════════════════════════════════════════════════
  // CREATE helpers
  // ════════════════════════════════════════════════════════════════════

  private buildSidebarBg(width: number, height: number) {
    const x = this.sidebarX
    const g = this.add.graphics()
    g.fillStyle(HUD_BG, 0.97)
    g.fillRect(x, 0, SIDEBAR_W, height)
    // Left border (2px bevel effect)
    g.lineStyle(2, HUD_BORDER, 1)
    g.lineBetween(x, 0, x, height)
    g.lineStyle(1, 0x3a5a8e, 0.25)
    g.lineBetween(x + 2, 0, x + 2, height)
    void width
  }

  // ── Minimap ─────────────────────────────────────────────────────────
  private buildMinimap() {
    const x = this.sidebarX + 4
    const y = this.minimapY
    const w = this.mmW
    const h = this.mmH

    // Background
    const bg = this.add.graphics()
    bg.fillStyle(0x030308, 1)
    bg.fillRect(x, y, w, h)
    // Accent border
    bg.lineStyle(2, HUD_ACCENT, 0.6)
    bg.strokeRect(x - 1, y - 1, w + 2, h + 2)
    // Bevel highlights
    bg.lineStyle(1, 0x4a6a9e, 0.4)
    bg.lineBetween(x, y, x + w, y)
    bg.lineBetween(x, y, x, y + h)

    this.add.text(x + 4, y + 2, 'RADAR', {
      fontFamily: 'monospace', fontSize: '8px', color: '#2a4a6a',
    }).setDepth(51)

    this.mmGfx = this.add.graphics().setDepth(50)

    // Click-to-scroll zone
    const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive()
    zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (!this.gameState?.map) return
      const rx = ptr.x - x
      const ry = ptr.y - y
      const map = this.gameState.map
      const wx = (rx / w) * map.width * 32
      const wy = (ry / h) * map.height * 32
      this.registry.set('camTargetX', wx - this.sidebarX / 2)
      this.registry.set('camTargetY', wy - this.scale.height / 2)
    })
  }

  // ── Player info bar ─────────────────────────────────────────────────
  private buildPlayerInfo() {
    const x = this.sidebarX
    const y = this.playerInfoY
    const h = PLAYER_INFO_H

    const bg = this.add.graphics()
    bg.fillStyle(HUD_PANEL, 1)
    bg.fillRect(x, y, SIDEBAR_W, h)
    bg.lineStyle(1, HUD_BORDER, 0.5)
    bg.lineBetween(x, y + h, x + SIDEBAR_W, y + h)

    const faction = FACTIONS[this.gameState?.players?.[0]?.faction ?? 'usa']

    // Flag emoji
    this.add.text(x + 6, y + 5, faction.flag, { fontSize: '18px' })

    // Faction name
    this.add.text(x + 34, y + 7, faction.name.toUpperCase(), {
      fontFamily: 'monospace', fontSize: '9px', color: '#8899aa',
    })

    // Gold credit icon
    const icon = this.add.graphics()
    icon.fillStyle(HUD_GOLD, 1)
    icon.fillRect(x + 6, y + 28, 10, 10)
    icon.lineStyle(1, 0xaa9900, 1)
    icon.strokeRect(x + 6, y + 28, 10, 10)
    icon.fillStyle(0xffaa00, 1)
    icon.fillRect(x + 8, y + 30, 6, 6)

    // Credits text (animated)
    this.creditsText = this.add.text(x + 22, y + 28, '$ 0', {
      fontFamily: 'monospace', fontSize: '13px',
      color: '#ffd700', stroke: '#000', strokeThickness: 2,
    })
  }

  // ── Power bar ────────────────────────────────────────────────────────
  private buildPowerBar() {
    const x = this.sidebarX
    const y = this.powerBarY
    const h = POWER_BAR_H

    const bg = this.add.graphics()
    bg.fillStyle(0x0e0e1c, 1)
    bg.fillRect(x, y, SIDEBAR_W, h)
    bg.lineStyle(1, HUD_BORDER, 0.4)
    bg.lineBetween(x, y + h, x + SIDEBAR_W, y + h)

    // "PWR" label
    this.add.text(x + 6, y + 4, 'PWR', {
      fontFamily: 'monospace', fontSize: '8px', color: '#445566',
    })

    // Power number (right-aligned)
    this.powerText = this.add.text(x + SIDEBAR_W - 6, y + 4, '0/0', {
      fontFamily: 'monospace', fontSize: '8px', color: '#44cc44',
    }).setOrigin(1, 0)

    // Bar track
    const track = this.add.graphics()
    track.fillStyle(0x111828, 1)
    track.fillRect(x + 26, y + 4, SIDEBAR_W - 82, h - 8)

    this.powerBarFill = this.add.graphics()
  }

  private drawPowerFill(gen: number, con: number) {
    const x  = this.sidebarX + 26
    const y  = this.powerBarY + 4
    const w  = SIDEBAR_W - 82
    const h  = POWER_BAR_H - 8
    const g  = this.powerBarFill
    g.clear()
    if (gen <= 0) return
    const pct = Math.min(1, con / gen)
    const col = pct < 0.8 ? POWER_GREEN : pct < 1.0 ? POWER_YELLOW : POWER_RED
    g.fillStyle(col, 0.9)
    g.fillRect(x, y, Math.max(2, Math.floor(w * pct)), h)
    // Shimmer
    g.fillStyle(0xffffff, 0.15)
    g.fillRect(x, y, Math.max(2, Math.floor(w * pct)), 2)
  }

  // ── Build tabs ───────────────────────────────────────────────────────
  private buildTabs() {
    const x    = this.sidebarX
    const y    = this.tabY
    const tabs: BuildTab[]  = ['buildings', 'infantry', 'vehicles', 'aircraft']
    const icons             = ['🏗', '🚶', '🚗', '✈']
    const tabW = Math.floor(SIDEBAR_W / tabs.length)

    // Tab separator line above
    const line = this.add.graphics()
    line.lineStyle(1, HUD_ACCENT, 0.25)
    line.lineBetween(x, y, x + SIDEBAR_W, y)

    tabs.forEach((tab, i) => {
      const tx  = x + i * tabW
      const bg  = this.add.graphics()
      this.tabBgs.set(tab, bg)

      this.add.text(tx + tabW / 2, y + TAB_H / 2, icons[i], {
        fontSize: '14px',
      }).setOrigin(0.5)

      const zone = this.add.zone(tx + tabW / 2, y + TAB_H / 2, tabW, TAB_H)
        .setInteractive({ cursor: 'pointer' })

      zone.on('pointerdown', () => this.switchTab(tab))
      zone.on('pointerover', () => {
        if (this.activeTab !== tab) {
          bg.clear(); bg.fillStyle(HUD_BORDER, 1); bg.fillRect(tx, y, tabW, TAB_H)
        }
      })
      zone.on('pointerout', () => {
        if (this.activeTab !== tab) {
          bg.clear(); bg.fillStyle(HUD_PANEL, 1); bg.fillRect(tx, y, tabW, TAB_H)
        }
      })
    })
  }

  private switchTab(tab: BuildTab) {
    this.activeTab = tab
    const tabs: BuildTab[] = ['buildings', 'infantry', 'vehicles', 'aircraft']
    const tabW = Math.floor(SIDEBAR_W / tabs.length)
    const y    = this.tabY

    this.tabBgs.forEach((bg, t) => {
      bg.clear()
      const i      = tabs.indexOf(t)
      const tx     = this.sidebarX + i * tabW
      const active = t === tab
      bg.fillStyle(active ? HUD_ACCENT : HUD_PANEL, 1)
      bg.fillRect(tx, y, tabW, TAB_H)
      bg.lineStyle(1, active ? HUD_ACCENT : HUD_BORDER, 0.5)
      bg.strokeRect(tx, y, tabW, TAB_H)
    })

    this.rebuildGrid()
  }

  // ── Build item grid ──────────────────────────────────────────────────
  private rebuildGrid() {
    this.buildBtns.forEach(b => b.destroy())
    this.buildZones.forEach(z => z.destroy())
    this.buildBtns  = []
    this.buildZones = []

    const items    = BUILD_ITEMS.filter(i => i.tab === this.activeTab)
    const x        = this.sidebarX
    const startY   = this.buildGridY
    const maxH     = this.selectedY - startY - 4
    const maxRows  = Math.max(1, Math.floor(maxH / (BTN_H + BTN_GAP)))

    items.slice(0, maxRows * 2).forEach((item, idx) => {
      const col = idx % 2
      const row = Math.floor(idx / 2)
      const bx  = x + BTN_PAD + col * (BTN_W + BTN_GAP)
      const by  = startY + BTN_GAP + row * (BTN_H + BTN_GAP)
      const cx  = bx + BTN_W / 2
      const cy  = by + BTN_H / 2

      const ctr = this.add.container(cx, cy) as BuildBtn

      const bg          = this.add.graphics()
      const progressBar = this.add.graphics()

      const abbTxt = this.add.text(0, -10, item.abbrev, {
        fontFamily: 'monospace', fontSize: '15px', color: '#cccccc',
        stroke: '#000', strokeThickness: 1,
      }).setOrigin(0.5)

      const costTxt = this.add.text(0, 9, `$${item.cost}`, {
        fontFamily: 'monospace', fontSize: '8px', color: '#ffd700',
      }).setOrigin(0.5)

      const queueTxt = this.add.text(BTN_W / 2 - 2, -BTN_H / 2 + 2, '', {
        fontFamily: 'monospace', fontSize: '8px', color: '#ffffff',
        backgroundColor: '#e94560', padding: { x: 2, y: 1 },
      }).setOrigin(1, 0)

      const readyTxt = this.add.text(0, 20, '', {
        fontFamily: 'monospace', fontSize: '8px', color: '#4ade80',
      }).setOrigin(0.5)

      ctr.add([bg, progressBar, abbTxt, costTxt, queueTxt, readyTxt])
      ctr._item        = item
      ctr._bg          = bg
      ctr._progressBar = progressBar
      ctr._queueTxt    = queueTxt
      ctr._readyTxt    = readyTxt

      this.drawItemBg(ctr)
      this.buildBtns.push(ctr)

      // Interactive zone
      const zone = this.add.zone(cx, cy, BTN_W, BTN_H).setInteractive({ cursor: 'pointer' })
      this.buildZones.push(zone)

      zone.on('pointerover', () => {
        const g = ctr._bg; g.clear()
        g.fillStyle(0x2a3a6e, 1)
        g.fillRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H)
        g.lineStyle(2, HUD_ACCENT, 1)
        g.strokeRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H)
      })
      zone.on('pointerout',  () => this.drawItemBg(ctr))
      zone.on('pointerdown', () => this.onBuildClick(item))
    })
  }

  private drawItemBg(btn: BuildBtn) {
    const g    = btn._bg
    const item = btn._item
    g.clear()

    const isPending    = this.pendingPlace.has(item.id)
    const isBuilding   = this.buildProgress.has(item.id)
    const hasCredits   = !this.humanPlayer || this.humanPlayer.credits >= item.cost

    let fill   = HUD_PANEL
    let border = HUD_BORDER

    if (isPending)        { fill = 0x0a2a0a; border = HUD_GREEN }
    else if (isBuilding)  { fill = 0x1a2a1a; border = 0x4ade80  }
    else if (!hasCredits) { fill = 0x1a0a0a; border = 0x553333  }

    g.fillStyle(fill, 1)
    g.fillRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H)
    // Bevel top-left
    g.lineStyle(1, 0x3a4a7e, 0.4)
    g.beginPath()
    g.moveTo(-BTN_W / 2 + 1, BTN_H / 2 - 1)
    g.lineTo(-BTN_W / 2 + 1, -BTN_H / 2 + 1)
    g.lineTo(BTN_W / 2 - 1,  -BTN_H / 2 + 1)
    g.strokePath()
    g.lineStyle(1, border, 0.8)
    g.strokeRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H)
  }

  private onBuildClick(item: BuildableItem) {
    const player = this.humanPlayer
    if (!player) return

    // If building is ready to place, enter placement mode
    if (this.pendingPlace.has(item.id) && item.tab === 'buildings') {
      this.enterPlacement(item.id)
      return
    }

    // RA2: One building at a time per Construction Yard
    if (item.tab === 'buildings') {
      const alreadyBuilding = BUILD_ITEMS.some(
        bi => bi.tab === 'buildings' && bi.id !== item.id && this.buildProgress.has(bi.id)
      )
      if (alreadyBuilding) {
        this.showAlert('Already constructing a building', 'danger')
        return
      }
    }

    // Queue if already building this item
    if (this.buildProgress.has(item.id)) {
      if (item.tab === 'buildings') {
        this.showAlert('Already constructing this building', 'danger')
        return
      }
      const q = (this.buildQueueCnt.get(item.id) ?? 0) + 1
      this.buildQueueCnt.set(item.id, q)
      this.showAlert(`${item.label} queued (+${q})`, 'info')
      return
    }

    // RA2: Check tech prerequisites
    if (!this.checkPrerequisites(item.id)) {
      this.showAlert('Prerequisites not met', 'danger')
      return
    }

    // RA2: Credits deducted gradually — just need enough to start (any credits > 0)
    if (player.credits <= 0) {
      this.showAlert('Insufficient credits', 'danger')
      return
    }

    this.buildProgress.set(item.id, 0)
    this.buildTimers.set(item.id, item.buildTime * 1000)
    this.creditsPaid.set(item.id, 0)

    const gs = this.scene.get('GameScene')
    if (gs) gs.events.emit('startProduction', { defId: item.id, type: item.tab === 'buildings' ? 'building' : 'unit' })

    this.showAlert(`Building: ${item.label}`, 'info')
  }

  /** Check tech prerequisites for an item against player's active buildings */
  private checkPrerequisites(defId: string): boolean {
    type E = { getPlayerActiveBuildingIds(playerId: number): string[] }
    const em = this.registry.get('entityMgr') as E | undefined
    if (!em) return true  // No entity manager yet = allow
    const activeIds = em.getPlayerActiveBuildingIds(0)
    // Look up from BuildingDefs or UnitDefs via Production system
    const prod = this.registry.get('production') as { checkPrerequisites(playerId: number, defId: string): boolean } | undefined
    if (prod) return prod.checkPrerequisites(0, defId)
    // Fallback: just check if construction_yard exists
    return activeIds.includes('construction_yard')
  }

  // ── Selected entity panel ────────────────────────────────────────────
  private buildSelectedPanel() {
    const x = this.sidebarX
    const y = this.selectedY
    const h = SELECTED_H

    const bg = this.add.graphics()
    bg.fillStyle(HUD_PANEL, 1)
    bg.fillRect(x, y, SIDEBAR_W, h)
    bg.lineStyle(2, HUD_ACCENT, 0.35)
    bg.lineBetween(x, y, x + SIDEBAR_W, y)
    bg.lineStyle(1, HUD_BORDER, 0.6)
    bg.lineBetween(x, y + h, x + SIDEBAR_W, y + h)

    // Entity icon box
    this.selectedIcon = this.add.graphics()
    this.selectedIcon.fillStyle(HUD_BORDER, 1)
    this.selectedIcon.fillRect(x + 5, y + 5, 34, 34)
    this.selectedIcon.lineStyle(1, HUD_ACCENT, 0.4)
    this.selectedIcon.strokeRect(x + 5, y + 5, 34, 34)

    this.selectedNameTxt = this.add.text(x + 46, y + 6, 'No Selection', {
      fontFamily: 'monospace', fontSize: '10px', color: '#e94560',
    })

    this.selectedInfoTxt = this.add.text(x + 46, y + 21, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#888888',
      wordWrap: { width: SIDEBAR_W - 54 },
    })

    // HP bar track
    const hpTrack = this.add.graphics()
    hpTrack.fillStyle(0x0e0e1e, 1)
    hpTrack.fillRect(x + 5, y + 46, SIDEBAR_W - 10, 8)
    hpTrack.lineStyle(1, HUD_BORDER, 0.6)
    hpTrack.strokeRect(x + 5, y + 46, SIDEBAR_W - 10, 8)

    this.selectedHPFill = this.add.graphics()
  }

  // ── Action buttons ───────────────────────────────────────────────────
  private buildActionButtons() {
    const x    = this.sidebarX
    const y    = this.actionY
    const btnW = Math.floor(SIDEBAR_W / 3)

    const bg = this.add.graphics()
    bg.fillStyle(0x090912, 1)
    bg.fillRect(x, y, SIDEBAR_W, ACTION_H)
    bg.lineStyle(1, HUD_BORDER, 0.5)
    bg.lineBetween(x, y, x + SIDEBAR_W, y)

    const defs: Array<{ label: string; mode: CursorMode; accent: number }> = [
      { label: '$ SELL', mode: 'sell',   accent: HUD_GOLD   },
      { label: '# FIX',  mode: 'repair', accent: 0x4488ff   },
      { label: '* DIP',  mode: 'normal', accent: HUD_BORDER },
    ]

    defs.forEach((def, i) => {
      const bx  = x + i * btnW
      const btnBg = this.add.graphics()
      btnBg.fillStyle(HUD_PANEL, 1)
      btnBg.fillRect(bx + 1, y + 1, btnW - 2, ACTION_H - 2)
      btnBg.lineStyle(1, HUD_BORDER, 0.5)
      btnBg.strokeRect(bx + 1, y + 1, btnW - 2, ACTION_H - 2)

      this.add.text(bx + btnW / 2, y + ACTION_H / 2, def.label, {
        fontFamily: 'monospace', fontSize: '8px', color: '#888888',
      }).setOrigin(0.5)

      const zone = this.add.zone(bx + btnW / 2, y + ACTION_H / 2, btnW - 2, ACTION_H - 2)
        .setInteractive({ cursor: 'pointer' })

      zone.on('pointerdown', () => {
        if (def.mode === 'normal') return
        this.setCursorMode(this.cursorMode === def.mode ? 'normal' : def.mode)
      })

      zone.on('pointerover', () => {
        btnBg.clear()
        btnBg.fillStyle(0x1e2e4e, 1)
        btnBg.fillRect(bx + 1, y + 1, btnW - 2, ACTION_H - 2)
        btnBg.lineStyle(1, def.accent, 0.8)
        btnBg.strokeRect(bx + 1, y + 1, btnW - 2, ACTION_H - 2)
      })

      zone.on('pointerout', () => {
        const active = this.cursorMode === def.mode
        btnBg.clear()
        btnBg.fillStyle(active ? 0x1a1a08 : HUD_PANEL, 1)
        btnBg.fillRect(bx + 1, y + 1, btnW - 2, ACTION_H - 2)
        btnBg.lineStyle(1, active ? def.accent : HUD_BORDER, active ? 0.8 : 0.5)
        btnBg.strokeRect(bx + 1, y + 1, btnW - 2, ACTION_H - 2)
      })
    })
  }

  // ── EVA alerts ───────────────────────────────────────────────────────
  private buildAlertSystem() {
    // Alerts created dynamically in showAlert()
  }

  showAlert(msg: string, type: AlertType = 'info') {
    const centerX = this.sidebarX / 2
    const palette: Record<AlertType, { bg: number; text: string; border: number }> = {
      success: { bg: 0x0a1a0a, text: '#4ade80', border: 0x4ade80 },
      warning: { bg: 0x1a1800, text: '#ffdd44', border: 0xddbb00 },
      danger:  { bg: 0x1a0808, text: '#e94560', border: 0xe94560 },
      info:    { bg: 0x0a0e1a, text: '#88aacc', border: 0x4466aa },
    }
    const pal = palette[type]

    // Evict oldest if full
    if (this.alertEntries.length >= MAX_ALERTS) {
      const oldest = this.alertEntries.shift()!
      oldest.tween?.stop()
      oldest.container.destroy()
    }

    // Shift existing alerts up
    this.alertEntries.forEach(e => {
      this.tweens.add({
        targets: e.container,
        y: e.container.y - ALERT_SPACING,
        duration: 140,
        ease: 'Power2',
      })
    })

    const alertY = 12 + this.alertEntries.length * ALERT_SPACING
    const ctr    = this.add.container(centerX, alertY)
    ctr.setDepth(200)

    const txt = this.add.text(0, 0, msg.toUpperCase(), {
      fontFamily: 'monospace', fontSize: '11px', color: pal.text,
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5)

    const pw = txt.width  + 14
    const ph = txt.height + 8
    const bgGfx = this.add.graphics()
    bgGfx.fillStyle(pal.bg, 0.93)
    bgGfx.fillRect(-pw / 2, -ph / 2, pw, ph)
    bgGfx.lineStyle(1, pal.border, 0.8)
    bgGfx.strokeRect(-pw / 2, -ph / 2, pw, ph)

    ctr.add([bgGfx, txt])
    ctr.setAlpha(0).setScale(0.85)

    const entry: AlertEntry = { container: ctr }
    this.alertEntries.push(entry)

    this.tweens.add({ targets: ctr, alpha: 1, scale: 1, duration: 180, ease: 'Back.Out' })

    entry.tween = this.tweens.add({
      targets: ctr,
      alpha: 0,
      delay: 3000,
      duration: 500,
      onComplete: () => {
        ctr.destroy()
        this.alertEntries = this.alertEntries.filter(e => e.container !== ctr)
        this.alertEntries.forEach((e, idx) => {
          this.tweens.add({ targets: e.container, y: 12 + idx * ALERT_SPACING, duration: 200 })
        })
      },
    })
  }

  // ── Placement ghost ──────────────────────────────────────────────────
  private buildGhost() {
    this.ghost      = this.add.graphics().setDepth(150).setVisible(false)
    this.ghostLabel = this.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '9px', color: '#ffffff',
      stroke: '#000', strokeThickness: 2,
      backgroundColor: '#00000088', padding: { x: 4, y: 2 },
    }).setDepth(151).setVisible(false)
  }

  private enterPlacement(defId: string) {
    this.placementMode  = true
    this.placementDefId = defId
    this.ghost.setVisible(true)
    this.ghostLabel.setVisible(true)
    const item = BUILD_ITEMS.find(i => i.id === defId)
    if (item) this.ghostLabel.setText(`[${item.label}] LMB=place  RMB=cancel`)
    this.input.on('pointerdown', this.onPlacementPointer, this)
  }

  private exitPlacement(refund: boolean) {
    if (!this.placementMode) return
    if (refund && this.placementDefId) {
      const item = BUILD_ITEMS.find(i => i.id === this.placementDefId)
      if (item && this.humanPlayer) {
        this.humanPlayer.credits += item.cost
        this.showAlert(`${item.label} placement cancelled`, 'warning')
      }
      this.pendingPlace.delete(this.placementDefId)
    }
    this.placementMode  = false
    this.placementDefId = null
    this.ghost.setVisible(false)
    this.ghostLabel.setVisible(false)
    this.input.off('pointerdown', this.onPlacementPointer, this)
  }

  private onPlacementPointer = (ptr: Phaser.Input.Pointer) => {
    if (!this.placementMode) return
    if (ptr.rightButtonDown()) { this.exitPlacement(true); return }
    if (!ptr.leftButtonDown()) return
    if (ptr.x >= this.sidebarX) return           // clicked sidebar

    const camX   = (this.registry.get('camX') as number) ?? 0
    const camY   = (this.registry.get('camY') as number) ?? 0
    const tileCol = Math.floor((ptr.x + camX) / 32)
    const tileRow = Math.floor((ptr.y + camY) / 32)

    const gs = this.scene.get('GameScene')
    if (gs) gs.events.emit('placeBuilding', { defId: this.placementDefId, tileCol, tileRow })

    const item = BUILD_ITEMS.find(i => i.id === this.placementDefId)
    this.pendingPlace.delete(this.placementDefId!)
    this.showAlert(`${item?.label ?? 'Building'} placed!`, 'success')
    this.exitPlacement(false)
  }

  // ── Setup keys & events ──────────────────────────────────────────────
  private setupEvents() {
    this.events.on('evaAlert', (d: { message: string; type?: string }) => {
      this.showAlert(d.message, (d.type as AlertType) ?? 'info')
    })
    this.events.on('creditsChanged', (d: { credits: number }) => {
      this.targetCredits = d.credits
    })
    this.events.on('productionComplete', (d: { defId: string }) => {
      const item = BUILD_ITEMS.find(i => i.id === d.defId)
      if (item) this.showAlert(`${item.label} complete!`, 'success')
    })
    this.events.on('buildingLost', (d: { defId: string }) => {
      this.showAlert(`Building lost: ${d.defId.replace(/_/g, ' ')}`, 'danger')
    })
    this.events.on('underAttack', () => {
      this.showAlert('Our base is under attack!', 'danger')
    })
  }

  private setupKeys() {
    const kb = this.input.keyboard!

    // Tab cycling
    kb.on('keydown-TAB', () => {
      const list: BuildTab[] = ['buildings', 'infantry', 'vehicles', 'aircraft']
      this.switchTab(list[(list.indexOf(this.activeTab) + 1) % list.length])
    })
    kb.on('keydown-ONE',   () => this.switchTab('buildings'))
    kb.on('keydown-TWO',   () => this.switchTab('infantry'))
    kb.on('keydown-THREE', () => this.switchTab('vehicles'))
    kb.on('keydown-FOUR',  () => this.switchTab('aircraft'))

    // Escape
    kb.on('keydown-ESC', () => {
      if (this.placementMode) { this.exitPlacement(true); return }
      if (this.cursorMode !== 'normal') { this.setCursorMode('normal'); return }
      this.registry.set('selectedIds', [])
    })

    // Delete → sell
    kb.on('keydown-DELETE', () => {
      const ids = (this.registry.get('selectedIds') as string[]) ?? []
      if (ids.length > 0) {
        const gs = this.scene.get('GameScene')
        if (gs) gs.events.emit('sellBuilding', { entityId: ids[0] })
        this.showAlert('Building sold (50% refund)', 'warning')
      }
    })

    // H → jump to Construction Yard
    kb.on('keydown-H', () => {
      type E = { defId: string; playerId: number; x: number; y: number; isAlive: boolean }
      const em = this.registry.get('entityMgr') as { getAllEntities(): E[] } | undefined
      if (!em) return
      const cy = em.getAllEntities().find(e => e.defId === 'construction_yard' && e.playerId === 0 && e.isAlive)
      if (cy) {
        this.registry.set('camTargetX', cy.x - this.sidebarX / 2)
        this.registry.set('camTargetY', cy.y - this.scale.height / 2)
      }
    })

    // Space → jump to last alert location
    kb.on('keydown-SPACE', () => {
      const pos = this.registry.get('lastAlertPos') as { x: number; y: number } | undefined
      if (pos) {
        this.registry.set('camTargetX', pos.x - this.sidebarX / 2)
        this.registry.set('camTargetY', pos.y - this.scale.height / 2)
      }
    })

    // A → attack-move
    kb.on('keydown-A', () => {
      const ids = (this.registry.get('selectedIds') as string[]) ?? []
      if (ids.length > 0) { this.setCursorMode('attackMove'); this.showAlert('Attack-move mode', 'info') }
    })

    // S → stop
    kb.on('keydown-S', () => {
      const ids = (this.registry.get('selectedIds') as string[]) ?? []
      if (ids.length > 0) {
        const gs = this.scene.get('GameScene')
        if (gs) gs.events.emit('issueOrder', { ids, type: 'stop' })
      }
    })

    // G → guard
    kb.on('keydown-G', () => {
      const ids = (this.registry.get('selectedIds') as string[]) ?? []
      if (ids.length > 0) {
        const gs = this.scene.get('GameScene')
        if (gs) gs.events.emit('issueOrder', { ids, type: 'guard' })
        this.showAlert('Guard mode', 'info')
      }
    })

    // Ctrl+1-9 save / 1-9 recall selection groups
    const keyNames = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE']
    keyNames.forEach((kn, i) => {
      kb.on(`keydown-${kn}`, (ev: KeyboardEvent) => {
        const n = i + 1
        if (ev.ctrlKey) {
          const ids = (this.registry.get('selectedIds') as string[]) ?? []
          this.selGroups.set(n, [...ids])
          this.showAlert(`Group ${n} saved`, 'info')
        } else {
          const group = this.selGroups.get(n)
          if (group) {
            this.registry.set('selectedIds', group)
            this.showAlert(`Group ${n} recalled`, 'info')
          }
        }
      })
    })
  }

  // ════════════════════════════════════════════════════════════════════
  // UPDATE helpers (called every frame)
  // ════════════════════════════════════════════════════════════════════

  private tickCredits(delta: number) {
    const diff = this.targetCredits - this.displayedCredits
    if (Math.abs(diff) < 0.5) {
      this.displayedCredits = this.targetCredits
    } else {
      this.displayedCredits += diff * Math.min(1, delta / 150)
    }
    this.creditsText.setText(`$ ${Math.max(0, Math.floor(this.displayedCredits)).toLocaleString()}`)
  }

  private tickPower() {
    const { powerGenerated: gen, powerConsumed: con } = this.humanPlayer
    const pct   = gen > 0 ? con / gen : 0
    const color = pct < 0.8 ? '#44cc44' : pct < 1 ? '#cccc44' : '#cc4444'
    this.powerText.setText(`${con}/${gen}`).setColor(color)
    this.drawPowerFill(gen, con)

    // Low power warning every ~10 s
    if (pct >= 1 && this.gameState.tick % 600 === 0) {
      this.showAlert('Warning: Low power!', 'warning')
    }
  }

  private tickMinimap() {
    const g = this.mmGfx
    g.clear()
    if (!this.gameState?.map) return

    const map    = this.gameState.map
    const scaleX = this.mmW / map.width
    const scaleY = this.mmH / map.height
    const ox     = this.sidebarX + 4
    const oy     = this.minimapY

    type E = { id: string; playerId: number; type: string; x: number; y: number; isAlive: boolean }
    const em = this.registry.get('entityMgr') as { getAllEntities(): E[] } | undefined
    if (em) {
      em.getAllEntities().forEach(e => {
        if (!e.isAlive) return
        const player = this.gameState.players.find(p => p.id === e.playerId)
        const isHuman = !player?.isAI
        const color   = isHuman ? 0x4ade80 : (e.playerId > 0 ? 0xe94560 : 0x888888)
        const mx = ox + (e.x / 32) * scaleX
        const my = oy + (e.y / 32) * scaleY
        const sz = e.type === 'building' ? 3 : 2
        g.fillStyle(color, 1)
        g.fillRect(mx - sz / 2, my - sz / 2, sz, sz)
      })
    }

    // Camera viewport rectangle
    const camX = (this.registry.get('camX') as number) ?? 0
    const camY = (this.registry.get('camY') as number) ?? 0
    const vw   = (this.sidebarX / 32) * scaleX
    const vh   = (this.scale.height / 32) * scaleY
    const vx   = ox + (camX / 32) * scaleX
    const vy   = oy + (camY / 32) * scaleY
    g.lineStyle(1, 0xffffff, 0.55)
    g.strokeRect(vx, vy, vw, vh)
  }

  private tickBuildProgress(delta: number) {
    const done: string[] = []

    this.buildProgress.forEach((_, id) => {
      const item = BUILD_ITEMS.find(i => i.id === id)!
      const totalTime = item.buildTime * 1000
      const paid = this.creditsPaid.get(id) ?? 0
      const remaining = item.cost - paid

      // RA2: Gradual credit deduction — pause if broke
      if (remaining > 0) {
        const creditRate = item.cost / (item.buildTime) // credits per second
        const creditChunk = creditRate * (delta / 1000)
        const toPay = Math.min(remaining, creditChunk)

        if (this.humanPlayer && this.humanPlayer.credits < toPay) {
          // Paused — no credits
          return
        }

        // Deduct credits
        if (this.humanPlayer) this.humanPlayer.credits -= toPay
        this.creditsPaid.set(id, paid + toPay)
      }

      // Apply power speed modifier
      const powerMult = this.getPowerSpeedMultiplier()
      const rem = (this.buildTimers.get(id) ?? 0) - delta * powerMult
      if (rem <= 0) {
        done.push(id)
      } else {
        this.buildTimers.set(id, rem)
        this.buildProgress.set(id, 1 - rem / totalTime)
      }
    })

    done.forEach(id => {
      this.buildProgress.delete(id)
      this.buildTimers.delete(id)
      this.creditsPaid.delete(id)
      const item = BUILD_ITEMS.find(i => i.id === id)!

      // Process queue
      const q = this.buildQueueCnt.get(id) ?? 0
      if (q > 0) {
        this.buildQueueCnt.set(id, q - 1)
        if (q - 1 === 0) this.buildQueueCnt.delete(id)
        this.buildProgress.set(id, 0)
        this.buildTimers.set(id, item.buildTime * 1000)
      }

      if (item.tab === 'buildings') {
        this.pendingPlace.add(id)
        this.showAlert(`${item.label} ready — place it!`, 'success')
        this.enterPlacement(id)
      } else {
        this.showAlert(`${item.label} ready`, 'success')
        const gs = this.scene.get('GameScene')
        if (gs) gs.events.emit('unitProduced', { defId: id })
      }
    })

    // Update button visuals
    this.buildBtns.forEach(btn => {
      const item    = btn._item
      const prog    = this.buildProgress.get(item.id) ?? 0
      const pending = this.pendingPlace.has(item.id)
      const bar     = btn._progressBar
      bar.clear()

      if (prog > 0) {
        const fillW = Math.max(2, (BTN_W - 2) * prog)
        bar.fillStyle(0x4ade80, 0.9)
        bar.fillRect(-BTN_W / 2 + 1, BTN_H / 2 - 7, fillW, 6)
        bar.fillStyle(0xffffff, 0.25)
        bar.fillRect(-BTN_W / 2 + 1, BTN_H / 2 - 7, fillW, 2)
      }

      btn._readyTxt?.setText(pending ? 'PLACE' : '')

      const q = this.buildQueueCnt.get(item.id) ?? 0
      btn._queueTxt?.setText(q > 0 ? `+${q}` : '')

      this.drawItemBg(btn)
    })
  }

  private tickSelectedInfo() {
    const ids = (this.registry.get('selectedIds') as string[]) ?? []
    const x   = this.sidebarX
    const y   = this.selectedY

    if (ids.length === 0) {
      this.selectedNameTxt.setText('No Selection')
      this.selectedInfoTxt.setText('')
      this.selectedHPFill.clear()
      this.selectedIcon.clear()
      this.selectedIcon.fillStyle(HUD_BORDER, 1)
      this.selectedIcon.fillRect(x + 5, y + 5, 34, 34)
      this.selectedIcon.lineStyle(1, HUD_ACCENT, 0.3)
      this.selectedIcon.strokeRect(x + 5, y + 5, 34, 34)
      return
    }

    type E = { id: string; defId: string; hp: number; maxHp: number; type?: string; playerId?: number }
    const em    = this.registry.get('entityMgr') as { getEntity(id: string): E | undefined } | undefined
    const first = em?.getEntity(ids[0])
    if (!first) return

    const pct  = first.hp / first.maxHp
    const hpPc = Math.round(pct * 100)

    this.selectedNameTxt.setText(
      ids.length === 1
        ? first.defId.replace(/_/g, ' ').toUpperCase()
        : `${ids.length} UNITS`
    )
    this.selectedInfoTxt.setText(
      ids.length === 1
        ? `HP: ${first.hp}/${first.maxHp}  (${hpPc}%)`
        : `${first.defId.replace(/_/g, ' ').toUpperCase()} + ${ids.length - 1} more`
    )

    // HP bar fill
    const col   = pct > 0.5 ? 0x4ade80 : pct > 0.25 ? 0xffdd44 : 0xe94560
    const barW  = SIDEBAR_W - 10
    const fillW = Math.max(2, Math.floor(barW * pct))
    this.selectedHPFill.clear()
    this.selectedHPFill.fillStyle(col, 1)
    this.selectedHPFill.fillRect(x + 5, y + 46, fillW, 8)
    this.selectedHPFill.fillStyle(0xffffff, 0.2)
    this.selectedHPFill.fillRect(x + 5, y + 46, fillW, 2)

    // Icon
    const player     = this.gameState?.players?.find(p => p.id === first.playerId)
    const iconColor  = player?.color ?? 0x445566
    this.selectedIcon.clear()
    this.selectedIcon.fillStyle(iconColor, 0.9)
    this.selectedIcon.fillRect(x + 5, y + 5, 34, 34)
    this.selectedIcon.lineStyle(2, 0x4ade80, 0.75)
    this.selectedIcon.strokeRect(x + 5, y + 5, 34, 34)
  }

  private tickGhost() {
    if (!this.placementMode) return
    const ptr = this.input.activePointer
    if (!ptr || ptr.x >= this.sidebarX) {
      this.ghost.setVisible(false)
      this.ghostLabel.setVisible(false)
      return
    }
    this.ghost.setVisible(true)
    this.ghostLabel.setVisible(true)

    const camX    = (this.registry.get('camX') as number) ?? 0
    const camY    = (this.registry.get('camY') as number) ?? 0
    const tileCol = Math.floor((ptr.x + camX) / 32)
    const tileRow = Math.floor((ptr.y + camY) / 32)
    const snapX   = tileCol * 32 - camX
    const snapY   = tileRow * 32 - camY
    const valid   = ptr.x < this.sidebarX - 16

    const g = this.ghost
    g.clear()
    // 2×2 tile footprint ghost
    const col = valid ? HUD_GREEN : HUD_ACCENT
    g.fillStyle(col, 0.35)
    g.fillRect(snapX, snapY, 64, 64)
    g.lineStyle(2, col, 0.85)
    g.strokeRect(snapX, snapY, 64, 64)
    // inner grid
    g.lineStyle(1, col, 0.25)
    g.lineBetween(snapX + 32, snapY, snapX + 32, snapY + 64)
    g.lineBetween(snapX, snapY + 32, snapX + 64, snapY + 32)

    this.ghostLabel.setPosition(ptr.x + 14, ptr.y - 22)
  }

  // ── Cursor mode ────────────────────────────────────────────────────
  private setCursorMode(mode: CursorMode) {
    this.cursorMode = mode
    if (mode === 'sell')        this.showAlert('Sell mode: click a building to sell (50%)', 'warning')
    else if (mode === 'repair') this.showAlert('Repair mode: click building to repair',    'info')
    else if (mode === 'attackMove') { /* alert sent by caller */ }
    // Emit to game scene so it can change cursor behavior
    const gs = this.scene.get('GameScene')
    if (gs) gs.events.emit('cursorModeChanged', { mode })
  }

  /** RA2: Production slows to 50% when power is low */
  private getPowerSpeedMultiplier(): number {
    if (!this.humanPlayer) return 1
    const { powerGenerated, powerConsumed } = this.humanPlayer
    if (powerGenerated <= 0) return 0.5
    return powerConsumed > powerGenerated ? 0.5 : 1.0
  }
}
