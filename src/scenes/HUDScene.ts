// ============================================================
// IRON COMMAND — HUDScene (RA2-Style Overhaul)
// EVA sidebar: build panel, placement mode, power bar, alerts
// ============================================================

import Phaser from 'phaser'
import type { Player, GameState, FactionSide } from '../types'
import { FogState, TILE_SIZE } from '../types'
import { FACTIONS } from '../data/factions'
import { UNIT_DEFS, getAvailableUnitIds } from '../entities/UnitDefs'
import { BUILDING_DEFS, getAvailableBuildingIds, NEUTRAL_BUILDING_IDS, SUPERWEAPON_BUILDING_IDS } from '../entities/BuildingDefs'
import { cartToScreen, screenToCart, ISO_TILE_W, ISO_TILE_H, drawIsoDiamond, getIsoWorldBounds } from '../engine/IsoUtils'

// ── Layout constants ───────────────────────────────────────────────────
const SIDEBAR_W       = 220
const MINIMAP_H       = 130
const PLAYER_INFO_H   = 50
const POWER_BAR_H     = 22
const POWER_BAR_W     = 12
const TAB_H           = 28
const BTN_W           = 96
const BTN_H           = 56
const BTN_GAP         = 4
const BTN_PAD         = 6
const SELECTED_H      = 90
const ACTION_H        = 30
const MAX_ALERTS      = 3
const ALERT_SPACING   = 34

// Superweapon countdown times (ms)
const SUPERWEAPON_TIMERS: Record<string, number> = {
  nuclear_silo: 300000,    // 5 min
  weather_device: 300000,  // 5 min
  chronosphere: 180000,    // 3 min
  iron_curtain: 180000,    // 3 min
}
const SUPERWEAPON_IDS = new Set(Object.keys(SUPERWEAPON_TIMERS))
const NEUTRAL_BUILDING_ID_SET = new Set(NEUTRAL_BUILDING_IDS)

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
type BuildTab   = 'buildings' | 'defenses' | 'infantry' | 'vehicles' | 'aircraft'
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
  createdAt: number
}

// Extended container reference
interface BuildBtn extends Phaser.GameObjects.Container {
  _item: BuildableItem
  _bg: Phaser.GameObjects.Graphics
  _progressBar: Phaser.GameObjects.Graphics
  _queueTxt: Phaser.GameObjects.Text
  _readyTxt: Phaser.GameObjects.Text
  _hotkeyTxt: Phaser.GameObjects.Text
  _hotkey: string
}

// ── Dynamic build catalogue based on faction side ──────────────────────
function getBuildItems(factionId: string): BuildableItem[] {
  const items: BuildableItem[] = []

  // Buildings available to this faction
  const buildingIds = getAvailableBuildingIds(factionId)
  for (const id of buildingIds) {
    const def = BUILDING_DEFS[id]
    if (!def || id === 'construction_yard' || NEUTRAL_BUILDING_ID_SET.has(id)) continue // CY + neutrals are never built from panel
    const tab: BuildTab = (def.category === 'defense') ? 'defenses' : 'buildings'
    items.push({
      id: def.id,
      label: def.name,
      abbrev: def.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      cost: def.stats.cost,
      tab,
      buildTime: def.stats.buildTime,
    })
  }

  // Units available to this faction
  const unitIds = getAvailableUnitIds(factionId)
  for (const id of unitIds) {
    const def = UNIT_DEFS[id]
    if (!def) continue
    const tab: BuildTab =
      def.category === 'infantry' ? 'infantry' :
      def.category === 'aircraft' ? 'aircraft' :
      'vehicles' // vehicle, harvester, naval all go under vehicles tab
    items.push({
      id: def.id,
      label: def.name,
      abbrev: def.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      cost: def.stats.cost,
      tab,
      buildTime: def.stats.buildTime,
    })
  }

  return items
}

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
  private powerBarFrame!:   Phaser.GameObjects.Graphics
  private selectedNameTxt!: Phaser.GameObjects.Text
  private selectedInfoTxt!: Phaser.GameObjects.Text
  private selectedHPFill!:  Phaser.GameObjects.Graphics
  private selectedIcon!:    Phaser.GameObjects.Graphics

  // ── Build panel ───────────────────────────────────────────────────
  private activeTab: BuildTab = 'buildings'
  private tabBgs:   Map<BuildTab, Phaser.GameObjects.Graphics> = new Map()
  private tabHighlight?: Phaser.GameObjects.Graphics
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
  private alertCooldownUntil: Map<string, number> = new Map()

  // ── Minimap ───────────────────────────────────────────────────────
  private mmGfx!: Phaser.GameObjects.Graphics
  private mmTerrainGfx!: Phaser.GameObjects.Graphics
  private mmW = SIDEBAR_W - 8
  private mmH = MINIMAP_H

  // ── Dynamic build catalogue ──────────────────────────────────────
  private buildItems: BuildableItem[] = []

  // ── Superweapon tracking ─────────────────────────────────────────
  private superweaponTimers: Map<string, number> = new Map()  // defId → ms remaining
  private superweaponReady: Set<string> = new Set()
  private superweaponTargetMode = false
  private superweaponActiveId: string | null = null
  private swCountdownTexts: Map<string, Phaser.GameObjects.Text> = new Map()

  // ── Selection groups ──────────────────────────────────────────────
  private selGroups: Map<number, string[]> = new Map()
  private tabHotkeys: string[] = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O']

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
    this.input.mouse?.disableContextMenu()

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

    // Populate dynamic build items based on human player's faction
    const factionId = this.gameState?.players?.find(p => !p.isAI)?.faction ?? 'usa'
    this.buildItems = getBuildItems(factionId)

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
    this.tickSuperweapons(delta)
    this.tickSelectedInfo()
    this.tickGhost()
  }

  // ════════════════════════════════════════════════════════════════════
  // CREATE helpers
  // ════════════════════════════════════════════════════════════════════

  private buildSidebarBg(width: number, height: number) {
    const x = this.sidebarX
    const g = this.add.graphics()
    // Darker, more military sidebar background
    g.fillStyle(0x0c0c18, 0.97)
    g.fillRect(x, 0, SIDEBAR_W, height)
    // Left border (2px bevel effect)
    g.lineStyle(2, HUD_BORDER, 1)
    g.lineBetween(x, 0, x, height)
    g.lineStyle(1, 0x3a5a8e, 0.25)
    g.lineBetween(x + 2, 0, x + 2, height)
    // Red accent line on left edge
    g.lineStyle(1, HUD_ACCENT, 0.3)
    g.lineBetween(x + 1, 0, x + 1, height)
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

    this.mmTerrainGfx = this.add.graphics().setDepth(49)
    this.mmGfx = this.add.graphics().setDepth(50)

    // Click-to-scroll zone
    const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive()
    zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (!this.gameState?.map) return
      const rx = ptr.x - x
      const ry = ptr.y - y
      const map = this.gameState.map
      const bounds = getIsoWorldBounds(map.width, map.height)
      const cart = screenToCart(
        Phaser.Math.Clamp((rx / w) * bounds.width, 0, bounds.width),
        Phaser.Math.Clamp((ry / h) * bounds.height, 0, bounds.height),
      )
      const wx = Phaser.Math.Clamp(cart.x, 0, map.width * TILE_SIZE - 1)
      const wy = Phaser.Math.Clamp(cart.y, 0, map.height * TILE_SIZE - 1)

      if ((ptr.button ?? 0) === 2 || ptr.rightButtonDown()) {
        const selectedIds = (this.registry.get('selectedIds') as string[]) ?? []
        if (selectedIds.length > 0) {
          const gs = this.scene.get('GameScene')
          if (gs) {
            gs.events.emit('issueOrder', {
              ids: selectedIds,
              type: 'move',
              target: { x: wx, y: wy },
            })
          }
        }
        return
      }

      const screenCenter = cartToScreen(wx, wy)
      const viewportW = this.scale.width - SIDEBAR_W
      this.registry.set('camTargetX', screenCenter.x - viewportW / 2)
      this.registry.set('camTargetY', screenCenter.y - this.scale.height / 2)
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
    const x = 8
    const y = this.powerBarY
    const h = Math.max(40, this.selectedY - y - 8)

    this.powerBarFrame = this.add.graphics().setDepth(120)
    this.powerBarFrame.fillStyle(0x0b111d, 0.95)
    this.powerBarFrame.fillRect(x - 4, y - 2, POWER_BAR_W + 8, h + 4)
    this.powerBarFrame.lineStyle(1, HUD_BORDER, 0.8)
    this.powerBarFrame.strokeRect(x - 4, y - 2, POWER_BAR_W + 8, h + 4)

    this.add.text(x + POWER_BAR_W / 2, y - 10, 'PWR', {
      fontFamily: 'monospace', fontSize: '8px', color: '#667c99',
    }).setOrigin(0.5, 0).setDepth(121)

    this.powerText = this.add.text(x + POWER_BAR_W + 10, y + h + 6, '0/0', {
      fontFamily: 'monospace', fontSize: '8px', color: '#44cc44',
    }).setOrigin(0, 0).setDepth(121)

    this.powerBarFill = this.add.graphics().setDepth(121)
  }

  private drawPowerFill(gen: number, con: number) {
    const x  = 8
    const y  = this.powerBarY
    const h  = Math.max(40, this.selectedY - y - 8)
    const g  = this.powerBarFill
    g.clear()
    const pct = gen > 0 ? Math.min(1, con / gen) : 1
    const col = pct < 0.8 ? POWER_GREEN : pct < 1.0 ? POWER_YELLOW : POWER_RED
    const fillH = Math.max(2, Math.floor(h * pct))
    g.fillStyle(0x081018, 1)
    g.fillRect(x, y, POWER_BAR_W, h)
    g.fillStyle(col, 0.9)
    g.fillRect(x, y + h - fillH, POWER_BAR_W, fillH)
    g.fillStyle(0xffffff, 0.2)
    g.fillRect(x, y + h - fillH, POWER_BAR_W, 2)
  }

  // ── Build tabs ───────────────────────────────────────────────────────
  private buildTabs() {
    const x    = this.sidebarX
    const y    = this.tabY
    const tabs: BuildTab[]  = ['buildings', 'defenses', 'infantry', 'vehicles', 'aircraft']
    const icons             = ['🏗', '🛡', '🚶', '🚗', '✈']
    const tabW = Math.floor(SIDEBAR_W / tabs.length)

    // Tab separator line above
    const line = this.add.graphics()
    line.lineStyle(1, HUD_ACCENT, 0.25)
    line.lineBetween(x, y, x + SIDEBAR_W, y)

    this.tabHighlight = this.add.graphics().setDepth(20)

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
    const tabs: BuildTab[] = ['buildings', 'defenses', 'infantry', 'vehicles', 'aircraft']
    const tabW = Math.floor(SIDEBAR_W / tabs.length)
    const y    = this.tabY

    this.tabBgs.forEach((bg, t) => {
      bg.clear()
      const i      = tabs.indexOf(t)
      const tx     = this.sidebarX + i * tabW
      const active = t === tab
      bg.fillStyle(active ? 0x2a1320 : HUD_PANEL, 1)
      bg.fillRect(tx, y, tabW, TAB_H)
      bg.lineStyle(1, active ? HUD_ACCENT : HUD_BORDER, 0.5)
      bg.strokeRect(tx, y, tabW, TAB_H)
    })
    const tabIdx = tabs.indexOf(tab)
    if (this.tabHighlight && tabIdx >= 0) {
      const targetX = this.sidebarX + tabIdx * tabW
      this.tweens.killTweensOf(this.tabHighlight)
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 140,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0
          this.tabHighlight!.clear()
          this.tabHighlight!.fillStyle(HUD_ACCENT, 0.18 + 0.14 * t)
          this.tabHighlight!.fillRect(targetX + 1, y + TAB_H - 4, tabW - 2, 3)
        },
      })
    }

    this.rebuildGrid()
  }

  // ── Build item grid ──────────────────────────────────────────────────
  private rebuildGrid() {
    this.buildBtns.forEach(b => b.destroy())
    this.buildZones.forEach(z => z.destroy())
    this.buildBtns  = []
    this.buildZones = []

    const items    = this.buildItems.filter(i => i.tab === this.activeTab)
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

      // Draw iconic symbol for this item
      const iconGfx = this.add.graphics()
      this.drawBuildIcon(iconGfx, item.id, item.tab)

      // Short readable name (truncated to fit)
      const shortName = this.getShortName(item.id)
      const abbTxt = this.add.text(0, -18, shortName, {
        fontFamily: 'monospace', fontSize: '7px', color: '#aabbcc',
        stroke: '#000', strokeThickness: 1,
      }).setOrigin(0.5)

      const costTxt = this.add.text(0, 18, `$${item.cost}`, {
        fontFamily: 'monospace', fontSize: '7px', color: '#ffd700',
      }).setOrigin(0.5)

      const queueTxt = this.add.text(BTN_W / 2 - 2, -BTN_H / 2 + 2, '', {
        fontFamily: 'monospace', fontSize: '8px', color: '#ffffff',
        backgroundColor: '#e94560', padding: { x: 2, y: 1 },
      }).setOrigin(1, 0)
      const hotkey = this.tabHotkeys[idx] ?? ''
      const hotkeyTxt = this.add.text(-BTN_W / 2 + 4, -BTN_H / 2 + 2, hotkey, {
        fontFamily: 'monospace', fontSize: '8px', color: '#ccd8ff',
        backgroundColor: '#1a2848', padding: { x: 2, y: 1 },
      }).setOrigin(0, 0)

      const readyTxt = this.add.text(0, 20, '', {
        fontFamily: 'monospace', fontSize: '8px', color: '#4ade80',
      }).setOrigin(0.5)

      ctr.add([bg, progressBar, iconGfx, abbTxt, costTxt, queueTxt, hotkeyTxt, readyTxt])
      ctr._item        = item
      ctr._bg          = bg
      ctr._progressBar = progressBar
      ctr._queueTxt    = queueTxt
      ctr._readyTxt    = readyTxt
      ctr._hotkeyTxt   = hotkeyTxt
      ctr._hotkey      = hotkey

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
      zone.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
        const button = ptr.button ?? 0
        if (button === 2) {
          this.onBuildRightClick(item)
          return
        }
        if (button !== 0) return
        this.onBuildClick(item)
      })
    })
  }

  /** Right-click on build button: cancel production or remove from queue */
  private onBuildRightClick(item: BuildableItem) {
    // Cancel active build
    if (this.buildProgress.has(item.id)) {
      const paid = this.creditsPaid.get(item.id) ?? 0
      if (this.humanPlayer && paid > 0) this.humanPlayer.credits += paid
      this.buildProgress.delete(item.id)
      this.buildTimers.delete(item.id)
      this.creditsPaid.delete(item.id)
      const gs = this.scene.get('GameScene')
      if (gs) gs.events.emit('cancelProduction', { defId: item.id, type: (item.tab === 'buildings' || item.tab === 'defenses') ? 'building' : 'unit', refund: paid })
      this.showAlert(`${item.label} cancelled ($${Math.floor(paid)} refunded)`, 'warning')
      return
    }
    // Cancel from queue
    const q = this.buildQueueCnt.get(item.id) ?? 0
    if (q > 0) {
      if (this.humanPlayer) this.humanPlayer.credits += item.cost
      this.buildQueueCnt.set(item.id, q - 1)
      if (q - 1 === 0) this.buildQueueCnt.delete(item.id)
      this.showAlert(`${item.label} removed from queue ($${item.cost} refunded)`, 'warning')
      return
    }
    // Cancel pending placement
    if (this.pendingPlace.has(item.id)) {
      this.exitPlacement(true)
    }
  }

  private drawItemBg(btn: BuildBtn) {
    const g    = btn._bg
    const item = btn._item
    g.clear()

    const isPending    = this.pendingPlace.has(item.id)
    const isBuilding   = this.buildProgress.has(item.id)
    const hasCredits   = !this.humanPlayer || this.humanPlayer.credits >= item.cost
    const hasPrereqs   = this.checkPrerequisites(item.id)

    // Check if superweapon already owned (max 1 each)
    let swAlreadyOwned = false
    if (SUPERWEAPON_BUILDING_IDS.includes(item.id)) {
      type E = { getBuildingsForPlayer(playerId: number): Array<{ def: { id: string }; state: string }> }
      const em = this.registry.get('entityMgr') as E | undefined
      if (em) {
        swAlreadyOwned = em.getBuildingsForPlayer(0).some(
          b => b.def.id === item.id && b.state !== 'dying'
        )
      }
    }

    let fill   = HUD_PANEL
    let border = HUD_BORDER
    let alpha  = 1.0

    if (!hasPrereqs || swAlreadyOwned) {
      // Locked — grey out completely
      fill = 0x0a0a0a; border = 0x222222; alpha = 0.4
    } else if (isPending)   { fill = 0x0a2a0a; border = HUD_GREEN }
    else if (isBuilding)    { fill = 0x1a2a1a; border = 0x4ade80  }
    else if (!hasCredits)   { fill = 0x1a0a0a; border = 0x553333  }

    g.fillStyle(fill, alpha)
    g.fillRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H)

    if (!hasPrereqs || swAlreadyOwned) {
      // Draw lock icon (small padlock shape)
      g.fillStyle(0x555555, 0.8)
      g.fillRect(-4, -6, 8, 8)           // lock body
      g.lineStyle(2, 0x555555, 0.8)
      g.strokeRect(-3, -12, 6, 6)        // lock shackle
    }

    // Bevel top-left
    g.lineStyle(1, 0x3a4a7e, hasPrereqs ? 0.4 : 0.1)
    g.beginPath()
    g.moveTo(-BTN_W / 2 + 1, BTN_H / 2 - 1)
    g.lineTo(-BTN_W / 2 + 1, -BTN_H / 2 + 1)
    g.lineTo(BTN_W / 2 - 1,  -BTN_H / 2 + 1)
    g.strokePath()
    g.lineStyle(1, border, hasPrereqs ? 0.8 : 0.3)
    g.strokeRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H)

    // Set container alpha for all children (text, etc.)
    btn.setAlpha((hasPrereqs && !swAlreadyOwned) ? 1.0 : 0.35)
  }

  /** Get a short readable name for build buttons */
  private getShortName(defId: string): string {
    const names: Record<string, string> = {
      // Buildings
      construction_yard: 'CON YARD', power_plant: 'POWER', tesla_reactor: 'TESLA PWR',
      barracks: 'BARRACKS', war_factory: 'WAR FACT', ore_refinery: 'REFINERY',
      airfield: 'AIRFIELD', air_force_hq: 'AIR HQ', naval_shipyard: 'SHIPYARD',
      radar_tower: 'RADAR', service_depot: 'DEPOT', battle_lab: 'BATTLE LAB',
      tech_center: 'TECH LAB', ore_purifier: 'PURIFIER', nuclear_reactor: 'NUKE PWR',
      cloning_vats: 'CLONING', spy_satellite: 'SPY SAT',
      // Defenses
      fortress_wall: 'WALL', wall: 'WALL', pillbox: 'PILLBOX', sentry_gun: 'SENTRY',
      prism_tower: 'PRISM', tesla_coil: 'TESLA', patriot_missile: 'PATRIOT',
      flak_cannon: 'FLAK', aa_gun: 'AA GUN', turret: 'TURRET',
      gap_generator: 'GAP GEN', psychic_sensor: 'PSYCHIC',
      // Superweapons
      weather_device: 'WEATHER', chronosphere: 'CHRONO', superweapon: 'S.WEAPON',
      iron_curtain: 'CURTAIN', nuclear_silo: 'NUKE SILO',
      advanced_power: 'ADV PWR',
      // Infantry
      gi: 'GI', conscript: 'CONSCRIPT', rifle_soldier: 'RIFLE',
      rocket_soldier: 'ROCKET', flak_trooper: 'FLAK INF',
      engineer: 'ENGINEER', attack_dog: 'DOG', spy: 'SPY',
      rocketeer: 'ROCKETEER', tesla_trooper: 'TESLA INF',
      crazy_ivan: 'C. IVAN', sniper: 'SNIPER', tanya: 'TANYA',
      // Vehicles
      grizzly_tank: 'GRIZZLY', rhino_tank: 'RHINO', light_tank: 'LT TANK',
      heavy_tank: 'HV TANK', ifv: 'IFV', flak_track: 'FLAK TRK',
      v3_launcher: 'V3', artillery: 'ARTLLRY', apc: 'APC',
      prism_tank: 'PRISM TK', mirage_tank: 'MIRAGE',
      apocalypse_tank: 'APOC', chrono_miner: 'MINER', war_miner: 'WAR MINE',
      harvester: 'HARVEST', mcv: 'MCV',
      tank_destroyer: 'TK DESTR', tesla_tank: 'TESLA TK',
      demolition_truck: 'DEMO TRK',
      // Aircraft
      harrier: 'HARRIER', fighter_jet: 'FIGHTER', bomber: 'BOMBER',
      kirov: 'KIROV', black_eagle: 'BLK EAGLE',
      nighthawk: 'NIGHTHWK',
      // Naval
      destroyer: 'DESTROYR', aegis: 'AEGIS', carrier: 'CARRIER',
      typhoon_sub: 'TYPHOON', dreadnought: 'DREADNOT', gunboat: 'GUNBOAT',
      giant_squid: 'SQUID', dolphin: 'DOLPHIN',
    }
    return names[defId] ?? defId.replace(/_/g, ' ').slice(0, 8).toUpperCase()
  }

  /** Draw a recognizable icon for each build item */
  private drawBuildIcon(g: Phaser.GameObjects.Graphics, defId: string, tab: string): void {
    const s = 10 // icon half-size
    const isBuildingIcon = tab === 'buildings' || tab === 'defenses'

    if (isBuildingIcon) {
      const roof = 0x8ea0b8
      const left = 0x617289
      const right = 0x435367
      g.fillStyle(roof, 1)
      g.beginPath()
      g.moveTo(0, -8)
      g.lineTo(8, -4)
      g.lineTo(0, 0)
      g.lineTo(-8, -4)
      g.closePath()
      g.fillPath()
      g.fillStyle(left, 1)
      g.beginPath()
      g.moveTo(-8, -4)
      g.lineTo(0, 0)
      g.lineTo(0, 6)
      g.lineTo(-8, 2)
      g.closePath()
      g.fillPath()
      g.fillStyle(right, 1)
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(8, -4)
      g.lineTo(8, 2)
      g.lineTo(0, 6)
      g.closePath()
      g.fillPath()

      switch (defId) {
        case 'construction_yard':
          g.lineStyle(2, 0xffcc66, 1)
          g.lineBetween(4, -10, 8, -14)
          g.lineBetween(8, -14, 8, -6)
          break
        case 'power_plant':
        case 'tesla_reactor':
          g.fillStyle(0xadb8c5, 1)
          g.fillEllipse(-4, -7, 6, 4)
          g.fillEllipse(4, -8, 7, 5)
          if (defId === 'tesla_reactor') {
            g.lineStyle(2, 0x66d8ff, 1)
            g.lineBetween(4, -10, 8, -13)
          }
          break
        case 'barracks':
          g.fillStyle(0xd64b4b, 1)
          g.fillTriangle(3, -10, 8, -8, 3, -6)
          break
        case 'war_factory':
          g.fillStyle(0x1f2731, 1)
          g.fillRect(-5, 2, 10, 3)
          break
        case 'ore_refinery':
          g.fillStyle(0xd7b24f, 1)
          g.fillCircle(5, -6, 2)
          break
        case 'radar_tower':
          g.lineStyle(2, 0x92deff, 1)
          g.lineBetween(5, -2, 5, -9)
          g.strokeEllipse(5, -9, 7, 3)
          break
        case 'air_force_command':
        case 'airfield':
          g.lineStyle(1, 0xe0e6ee, 1)
          g.lineBetween(-7, 5, 7, 5)
          break
        case 'battle_lab':
        case 'tech_center':
          g.lineStyle(1.5, 0x8ad9ff, 1)
          g.strokeCircle(0, -4, 3)
          break
        case 'naval_shipyard':
          g.fillStyle(0x2c6a8a, 0.8)
          g.fillRect(-9, 4, 18, 3)
          break
        case 'fortress_wall':
        case 'wall':
          g.fillStyle(0x797979, 1)
          g.fillRect(-8, 1, 16, 4)
          break
        case 'prism_tower':
          g.fillStyle(0xa4f6ff, 1)
          g.fillTriangle(0, -12, -3, -8, 3, -8)
          break
        case 'tesla_coil':
          g.lineStyle(2, 0x66d8ff, 1)
          g.lineBetween(0, -11, 0, -7)
          break
        case 'patriot_missile':
        case 'flak_cannon':
        case 'aa_gun':
          g.lineStyle(2, 0xc8d2da, 1)
          g.lineBetween(-2, -3, -4, -9)
          g.lineBetween(2, -3, 4, -9)
          break
        case 'grand_cannon':
          g.lineStyle(2, 0xe0e0e0, 1)
          g.lineBetween(1, -2, 8, -8)
          break
        case 'nuclear_silo':
        case 'superweapon':
          g.fillStyle(0xff6666, 1)
          g.fillTriangle(0, -12, -2, -8, 2, -8)
          break
        case 'weather_device':
          g.lineStyle(2, 0x6fcfff, 1)
          g.strokeCircle(0, -6, 4)
          break
        case 'chronosphere':
          g.lineStyle(2, 0x6fe9ff, 1)
          g.strokeCircle(0, -6, 4)
          g.strokeCircle(0, -6, 2)
          break
        case 'iron_curtain':
          g.lineStyle(2, 0xff7d7d, 1)
          g.strokeCircle(0, -6, 4)
          break
      }
      return
    }

    switch (defId) {
      // ── Buildings ──
      case 'construction_yard':
        g.fillStyle(0x88aacc, 1); g.fillRect(-s, -s+2, s*2, s*2-4)  // base
        g.lineStyle(2, 0xffcc00, 1); g.lineBetween(-4, -s+2, 4, -s-4) // crane arm
        g.lineBetween(4, -s-4, 4, -s+2)
        break
      case 'power_plant': case 'tesla_reactor': case 'advanced_power': case 'nuclear_reactor':
        g.fillStyle(0x446688, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        g.lineStyle(3, 0xffff00, 1) // lightning bolt
        g.lineBetween(2, -s+2, -3, 0); g.lineBetween(-3, 0, 3, 0); g.lineBetween(3, 0, -2, s-2)
        break
      case 'barracks':
        g.fillStyle(0x556644, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        // person silhouette
        g.fillStyle(0xcccccc, 1); g.fillCircle(0, -4, 3) // head
        g.fillRect(-3, -1, 6, 8) // body
        break
      case 'war_factory':
        g.fillStyle(0x555566, 1); g.fillRect(-s, -s+4, s*2, s*2-6)
        // gear/cog
        g.lineStyle(2, 0xddaa44, 1); g.strokeCircle(0, 0, 5)
        g.fillStyle(0xddaa44, 1); g.fillRect(-1, -7, 2, 4); g.fillRect(-1, 3, 2, 4)
        g.fillRect(-7, -1, 4, 2); g.fillRect(3, -1, 4, 2)
        break
      case 'ore_refinery':
        g.fillStyle(0x556655, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        // ore/dollar
        g.fillStyle(0xffdd00, 1); g.fillTriangle(-5, 4, 0, -4, 5, 4) // ore pile
        break
      case 'airfield': case 'air_force_hq': case 'air_force_command':
        g.fillStyle(0x445566, 1); g.fillRect(-s, -s+4, s*2, s*2-6)
        // runway + plane
        g.lineStyle(1, 0xcccccc, 0.8); g.lineBetween(-8, 0, 8, 0)
        g.fillStyle(0xcccccc, 1); g.fillTriangle(-4, -2, 6, 0, -4, 2) // plane
        break
      case 'radar_tower':
        g.fillStyle(0x445566, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        // dish
        g.lineStyle(2, 0x88ccff, 1); g.lineBetween(0, 4, 0, -4)
        g.beginPath(); g.arc(0, -4, 6, -2.2, -0.9); g.strokePath()
        break
      case 'battle_lab': case 'tech_center':
        g.fillStyle(0x334466, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        // atom/science
        g.lineStyle(1, 0x88ddff, 1); g.strokeCircle(0, 0, 6)
        g.fillStyle(0xff4444, 1); g.fillCircle(0, 0, 2)
        break
      case 'naval_shipyard':
        g.fillStyle(0x2f5f7a, 1); g.fillRect(-s, -s+4, s*2, s*2-6)
        g.fillStyle(0x1d4460, 1); g.fillRect(-s, 3, s*2, 5)
        g.fillStyle(0xdde9f7, 1); g.fillTriangle(-6, 2, 5, 2, 8, -1)
        break
      case 'service_depot':
        g.fillStyle(0x6d654f, 1); g.fillRect(-s+1, -s+4, s*2-2, s*2-6)
        g.fillStyle(0x1f242c, 1); g.fillRect(-6, 0, 12, 5)
        g.lineStyle(2, 0xd0d5db, 1); g.lineBetween(0, -7, 0, -3); g.lineBetween(-3, -5, 3, -5)
        break
      case 'ore_purifier':
        g.fillStyle(0x5f7047, 1); g.fillRect(-s+1, -s+4, s*2-2, s*2-6)
        g.fillStyle(0xffdd00, 1); g.fillTriangle(-6, 4, 0, -3, 6, 4)
        g.fillStyle(0x9ad76f, 1); g.fillRect(3, -7, 4, 3)
        break
      case 'spy_satellite':
        g.fillStyle(0x39516a, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        g.lineStyle(2, 0x9be0ff, 1); g.lineBetween(0, 3, 0, -3); g.strokeCircle(0, -4, 5)
        break
      case 'gap_generator':
        g.fillStyle(0x4a5a63, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        g.lineStyle(2, 0x9fe4ff, 1); g.strokeCircle(0, 0, 6); g.strokeCircle(0, 0, 3)
        break
      case 'psychic_sensor':
        g.fillStyle(0x5f466f, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
        g.lineStyle(2, 0xe483ff, 1); g.strokeCircle(0, 0, 6); g.strokeCircle(0, 0, 3)
        break
      case 'grand_cannon':
        g.fillStyle(0x606060, 1); g.fillCircle(0, 2, 7)
        g.lineStyle(3, 0xdddddd, 1); g.lineBetween(0, 0, 8, -8)
        break
      case 'cloning_vats':
        g.fillStyle(0x5d4c61, 1); g.fillRect(-s+1, -s+4, s*2-2, s*2-6)
        g.fillStyle(0x82e0cf, 0.9); g.fillRect(-6, -2, 3, 7); g.fillRect(-1, -2, 3, 7); g.fillRect(4, -2, 3, 7)
        break
      // ── Defenses ──
      case 'fortress_wall': case 'wall':
        g.fillStyle(0x888888, 1); g.fillRect(-s, -3, s*2, 6)
        g.fillRect(-s, -6, 4, 3); g.fillRect(s-4, -6, 4, 3) // battlements
        break
      case 'pillbox': case 'sentry_gun':
        g.fillStyle(0x667766, 1); g.fillCircle(0, 2, 7)
        g.lineStyle(2, 0xcccccc, 1); g.lineBetween(0, 2, 0, -8) // gun barrel
        break
      case 'turret': case 'prism_tower': case 'tesla_coil':
        g.fillStyle(0x556666, 1); g.fillCircle(0, 2, 6)
        g.lineStyle(2, defId === 'tesla_coil' ? 0x4488ff : 0xff6644, 1)
        g.lineBetween(0, 0, 0, -10) // barrel/coil
        g.lineBetween(-3, -8, 3, -8) // cross
        break
      case 'patriot_missile': case 'flak_cannon': case 'aa_gun':
        g.fillStyle(0x556655, 1); g.fillRect(-6, 0, 12, 6)
        g.lineStyle(2, 0xcc4444, 1)
        g.lineBetween(-4, 0, -2, -8); g.lineBetween(4, 0, 2, -8) // AA tubes
        break
      // ── Superweapons ──
      case 'weather_device':
        g.lineStyle(2, 0x4488ff, 1)
        g.strokeCircle(0, -2, 8); g.lineBetween(0, -10, 0, 6)
        g.lineStyle(1, 0xffff44, 1); g.lineBetween(-3, 2, 0, 8); g.lineBetween(3, 2, 0, 8)
        break
      case 'nuclear_silo': case 'superweapon':
        g.fillStyle(0x884400, 1); g.fillRect(-4, -s, 8, s*2)
        g.fillStyle(0xff4400, 1); g.fillTriangle(-4, -s, 0, -s-6, 4, -s) // warhead
        break
      case 'chronosphere': case 'iron_curtain':
        g.lineStyle(2, defId === 'chronosphere' ? 0x44ddff : 0xff4444, 1)
        g.strokeCircle(0, 0, 8); g.strokeCircle(0, 0, 4)
        g.fillStyle(defId === 'chronosphere' ? 0x44ddff : 0xff4444, 0.4)
        g.fillCircle(0, 0, 4)
        break
      // ── Infantry ──
      case 'gi': case 'conscript':
        g.fillStyle(defId === 'gi' ? 0x9ec0e4 : 0xc78b74, 1); g.fillCircle(-1, -5, 2)
        g.fillStyle(defId === 'gi' ? 0x5a80b0 : 0x8a3b30, 1); g.fillRect(-3, -2, 5, 8)
        g.fillStyle(0x222222, 1); g.fillRect(2, -1, 5, 1)
        break
      case 'engineer':
        g.fillStyle(0xffd34d, 1); g.fillRect(-3, -8, 6, 3)
        g.fillStyle(0x5d7488, 1); g.fillRect(-3, -2, 6, 8)
        g.fillStyle(0xb0b7bf, 1); g.fillCircle(5, 0, 2)
        break
      case 'rocketeer':
        g.fillStyle(0x5f87b3, 1); g.fillRect(-2, -2, 4, 7)
        g.fillStyle(0x3d5f84, 1); g.fillRect(-6, -1, 3, 5); g.fillRect(3, -1, 3, 5)
        g.fillStyle(0xffaa44, 1); g.fillTriangle(-5, 5, -3, 9, -1, 5); g.fillTriangle(1, 5, 3, 9, 5, 5)
        break
      case 'spy':
        g.fillStyle(0x1d1d1d, 1); g.fillRect(-4, -9, 8, 2); g.fillRect(-2, -10, 4, 1)
        g.fillStyle(0x2f3644, 1); g.fillRect(-3, -3, 6, 9)
        break
      case 'attack_dog':
        g.fillStyle(0x654938, 1); g.fillRect(-6, -1, 9, 4); g.fillTriangle(3, -1, 8, 1, 3, 3)
        g.fillStyle(0x3a2b1f, 1); g.fillRect(-5, 3, 1, 4); g.fillRect(-2, 3, 1, 4); g.fillRect(1, 3, 1, 4)
        break
      case 'tanya':
        g.fillStyle(0xddd0c6, 1); g.fillCircle(0, -5, 2)
        g.fillStyle(0x3a638f, 1); g.fillRect(-3, -2, 6, 8)
        g.fillStyle(0x333333, 1); g.fillRect(-6, 0, 2, 1); g.fillRect(4, 0, 2, 1)
        break
      case 'chrono_legionnaire':
        g.lineStyle(1, 0xeffaff, 1); g.strokeCircle(0, 0, 8)
        g.fillStyle(0x78d7ff, 1); g.fillRect(-3, -2, 6, 8)
        g.fillStyle(0xeffaff, 1); g.fillCircle(0, -5, 2)
        break
      case 'sniper':
        g.fillStyle(0x4d5e4d, 1); g.fillRect(-7, 1, 12, 3)
        g.fillStyle(0xb8c2a4, 1); g.fillCircle(-7, 0, 1)
        g.fillStyle(0x222222, 1); g.fillRect(4, 0, 6, 1)
        break
      case 'flak_trooper':
        g.fillStyle(0x7c5142, 1); g.fillRect(-4, -3, 7, 10)
        g.fillStyle(0x9f9f9f, 1); g.fillRect(3, -1, 5, 3)
        break
      case 'tesla_trooper':
        g.fillStyle(0x67e2ff, 0.35); g.fillCircle(0, 0, 9)
        g.fillStyle(0x6b2f8a, 1); g.fillRect(-4, -3, 8, 10)
        g.lineStyle(2, 0x67e2ff, 1); g.lineBetween(4, -1, 8, -5)
        break
      case 'crazy_ivan':
        g.fillStyle(0x8b5a3c, 1); g.fillRect(-3, -2, 6, 8)
        g.fillStyle(0x222222, 1); g.fillCircle(6, 0, 2); g.fillRect(5, -2, 2, 2)
        break
      case 'yuri':
        g.lineStyle(1, 0xe483ff, 1); g.strokeEllipse(0, -5, 10, 4); g.strokeEllipse(0, -5, 14, 6)
        g.fillStyle(0x5e3d8c, 1); g.fillRect(-3, -2, 6, 8)
        break
      case 'desolator':
        g.fillStyle(0x5a7540, 1); g.fillRect(-4, -3, 8, 10)
        g.fillStyle(0x95ff55, 1); g.fillRect(4, -1, 5, 1)
        break
      case 'terrorist':
        g.fillStyle(0x6f3a32, 1); g.fillRect(-3, -2, 6, 8)
        g.fillStyle(0x222222, 1); g.fillCircle(6, 0, 2)
        g.fillStyle(0xff4422, 1); g.fillRect(5, -3, 2, 1)
        break
      // ── Vehicles / Aircraft / Naval ──
      case 'grizzly_tank': case 'rhino_tank': case 'mirage_tank': case 'prism_tank':
      case 'tesla_tank': case 'dragon_tank':
        g.fillStyle(defId === 'rhino_tank' ? 0x7a3f34 : 0x4f708d, 1)
        if (defId === 'mirage_tank') g.fillStyle(0x6a8b5d, 1)
        if (defId === 'prism_tank') g.fillStyle(0x5e82b8, 1)
        if (defId === 'tesla_tank') g.fillStyle(0x6b3546, 1)
        if (defId === 'dragon_tank') g.fillStyle(0x7a4230, 1)
        g.fillRect(-8, -2, 16, 8)
        g.fillRect(-2, -4, 7, 4)
        g.lineStyle(2, defId === 'tesla_tank' ? 0x67e2ff : 0xdddddd, 1); g.lineBetween(1, -2, 10, -2)
        if (defId === 'prism_tank') g.fillStyle(0x9fffff, 1), g.fillTriangle(2, -4, 6, -2, 1, -1)
        if (defId === 'dragon_tank') g.fillStyle(0xff8f42, 1), g.fillTriangle(10, -2, 7, -4, 7, 0)
        break
      case 'apocalypse_tank':
        g.fillStyle(0x5a2f2f, 1); g.fillRect(-9, -2, 18, 8); g.fillRect(-3, -4, 8, 4)
        g.lineStyle(2, 0xd39d4c, 1); g.lineBetween(2, -3, 10, -4); g.lineBetween(2, -1, 10, -2)
        break
      case 'ifv': case 'flak_track':
        g.fillStyle(defId === 'ifv' ? 0x3c6f88 : 0x6b4334, 1); g.fillRect(-8, -2, 14, 8); g.fillRect(6, -1, 3, 6)
        if (defId === 'ifv') g.fillStyle(0xc8d9e8, 1), g.fillRect(-2, -5, 6, 2)
        if (defId === 'flak_track') g.lineStyle(2, 0xb0b0b0, 1), g.lineBetween(-1, -2, 1, -7), g.lineBetween(3, -2, 5, -7)
        break
      case 'v3_launcher':
        g.fillStyle(0x6f4742, 1); g.fillRect(-8, 0, 13, 6); g.fillRect(5, 1, 4, 5)
        g.fillStyle(0xe0a83f, 1); g.fillRect(-1, -8, 3, 8); g.fillTriangle(-1, -8, 2, -8, 0, -10)
        break
      case 'chrono_miner': case 'war_miner':
        g.fillStyle(defId === 'chrono_miner' ? 0x4f7ca6 : 0x875733, 1); g.fillRect(-8, -2, 14, 8); g.fillRect(6, -1, 3, 6)
        g.fillStyle(defId === 'chrono_miner' ? 0x81ecff : 0xd8b368, 1); g.fillRect(-2, 0, 3, 3)
        break
      case 'mcv':
        g.fillStyle(0x55616e, 1); g.fillRect(-9, -2, 18, 8); g.fillRect(-3, -4, 8, 3)
        break
      case 'terror_drone':
        g.fillStyle(0x552f2f, 1); g.fillCircle(0, 0, 5); g.fillStyle(0xff5f5f, 1); g.fillCircle(0, 0, 2)
        g.lineStyle(2, 0x2b1a1a, 1); g.lineBetween(-6, -5, -3, -2); g.lineBetween(6, -5, 3, -2); g.lineBetween(-6, 5, -3, 2); g.lineBetween(6, 5, 3, 2)
        break
      case 'tank_destroyer':
        g.fillStyle(0x4d6068, 1); g.fillRect(-8, -2, 14, 8); g.fillRect(-2, -4, 6, 4)
        g.lineStyle(3, 0xd9e6ea, 1); g.lineBetween(1, -2, 10, -2)
        break
      case 'mecha_walker': case 'conquistador_mech':
        g.fillStyle(defId === 'mecha_walker' ? 0x4f697f : 0x6a5a4a, 1)
        g.fillRect(-3, -4, 6, 9); g.fillRect(-6, -1, 12, 5); g.fillRect(-5, 5, 2, 4); g.fillRect(3, 5, 2, 4)
        g.lineStyle(2, defId === 'mecha_walker' ? 0x9be0ff : 0xbfd6e0, 1); g.lineBetween(6, -1, 10, -3)
        break
      case 'demo_truck':
        g.fillStyle(0x7f4b3f, 1); g.fillRect(-8, -2, 14, 8); g.fillRect(6, -1, 3, 6)
        g.fillStyle(0xff4422, 1); g.fillRect(-2, 0, 6, 3)
        break
      case 'brahmos_battery':
        g.fillStyle(0x5b4652, 1); g.fillRect(-9, -1, 14, 7); g.fillRect(5, 0, 4, 6)
        g.fillStyle(0xffcc88, 1); g.fillRect(-3, -7, 3, 7); g.fillRect(1, -6, 3, 6)
        break
      case 'harrier': case 'black_eagle':
        g.fillStyle(defId === 'black_eagle' ? 0x2f4f7c : 0x406fa4, 1)
        g.fillTriangle(-8, 2, 8, 2, -1, -5); g.fillTriangle(-8, 2, 8, 2, -1, 9)
        g.fillStyle(0xd9e7f5, 1); g.fillRect(-1, 0, 8, 2)
        break
      case 'nighthawk':
        g.fillStyle(0x4f5d6b, 1); g.fillRect(-6, -2, 12, 7); g.fillRect(-9, 0, 18, 3)
        g.lineStyle(2, 0xc7d5de, 1); g.lineBetween(-10, -3, 10, -3)
        break
      case 'recon_drone':
        g.fillStyle(0x789090, 1); g.fillRect(-3, -1, 6, 3); g.fillRect(-8, 0, 4, 1); g.fillRect(4, 0, 4, 1)
        g.fillStyle(0x8cffef, 1); g.fillCircle(0, 1, 1)
        break
      case 'kirov':
        g.fillStyle(0x7a3f3a, 1); g.fillEllipse(0, 0, 18, 10)
        g.fillStyle(0x5b2f2a, 1); g.fillRect(-3, 3, 6, 3)
        g.fillStyle(0xd1a288, 1); g.fillRect(8, -1, 2, 2)
        break
      case 'destroyer': case 'aegis_cruiser': case 'aircraft_carrier': case 'dreadnought':
        g.fillStyle(defId === 'dreadnought' ? 0x6d3f3b : 0x486f94, 1)
        if (defId === 'aegis_cruiser') g.fillStyle(0x3f6287, 1)
        if (defId === 'aircraft_carrier') g.fillStyle(0x4a5d71, 1)
        g.fillTriangle(-8, 4, 7, 4, 10, 1); g.fillRect(-8, -2, 11, 6)
        if (defId === 'aegis_cruiser') g.fillStyle(0x8ce2ff, 1), g.fillRect(-1, -5, 2, 3), g.fillRect(3, -5, 2, 3)
        if (defId === 'aircraft_carrier') g.fillStyle(0xf3f6fa, 1), g.fillRect(-4, 1, 8, 1)
        if (defId === 'dreadnought') g.lineStyle(2, 0xffb184, 1), g.lineBetween(1, -2, 10, -4), g.lineBetween(0, 0, 10, -1)
        break
      case 'typhoon_sub':
        g.fillStyle(0x3b4149, 1); g.fillEllipse(-1, 2, 16, 7); g.fillRect(-3, -4, 5, 3)
        g.fillStyle(0x8fa0b2, 1); g.fillRect(2, -4, 2, 2)
        break
      case 'giant_squid':
        g.fillStyle(0x5e2f64, 1); g.fillEllipse(0, -1, 10, 8)
        g.lineStyle(2, 0xc88cff, 1); g.lineBetween(-2, 3, -4, 8); g.lineBetween(0, 3, 0, 9); g.lineBetween(2, 3, 4, 8)
        break
      default:
        // Fallback by tab
        if (tab === 'infantry') {
          // Person silhouette
          g.fillStyle(0xcccccc, 1); g.fillCircle(0, -5, 3)
          g.fillRect(-3, -2, 6, 8); g.fillRect(-5, 0, 3, 2); g.fillRect(2, 0, 3, 2)
        } else if (tab === 'vehicles') {
          // Tank shape
          g.fillStyle(0x778877, 1); g.fillRect(-8, -2, 16, 8) // body
          g.fillRect(-6, -4, 4, 3) // turret
          g.lineStyle(2, 0xaaaaaa, 1); g.lineBetween(-4, -3, 8, -3) // barrel
          g.fillStyle(0x333333, 1); g.fillRect(-8, 6, 16, 2) // tracks
        } else if (tab === 'aircraft') {
          // Plane
          g.fillStyle(0x8899aa, 1)
          g.fillTriangle(-8, 4, 0, -8, 8, 4) // fuselage
          g.fillRect(-12, -1, 24, 3) // wings
        } else {
          // Generic building
          g.fillStyle(0x667788, 1); g.fillRect(-s+2, -s+4, s*2-4, s*2-6)
          g.lineStyle(1, 0xaaaaaa, 0.5); g.strokeRect(-s+2, -s+4, s*2-4, s*2-6)
        }
        break
    }
  }

  private onBuildClick(item: BuildableItem) {
    const player = this.humanPlayer
    if (!player) return

    const isBuildingTab = item.tab === 'buildings' || item.tab === 'defenses'

    // Superweapon activation: if ready, enter target selection mode
    if (SUPERWEAPON_IDS.has(item.id) && this.superweaponReady.has(item.id)) {
      this.superweaponTargetMode = true
      this.superweaponActiveId = item.id
      this.ghost.setVisible(true)
      this.ghostLabel.setVisible(true)
      this.ghostLabel.setText(`[${item.label}] Click target location`)
      this.input.on('pointerdown', this.onSuperweaponPointer, this)
      this.showAlert(`Select target for ${item.label}`, 'warning')
      return
    }

    // If building is ready to place, enter placement mode
    if (this.pendingPlace.has(item.id) && isBuildingTab) {
      this.enterPlacement(item.id)
      return
    }

    // Separate build queues: buildings, defenses, and units can build in parallel
    // But within each category, only one at a time
    if (isBuildingTab) {
      const sameCategory = this.buildItems.some(
        bi => bi.tab === item.tab && bi.id !== item.id && this.buildProgress.has(bi.id)
      )
      if (sameCategory) {
        this.showAlert(`Already constructing a ${item.tab === 'defenses' ? 'defense' : 'building'}`, 'danger')
        return
      }
    }

    // Queue if already building this item
    if (this.buildProgress.has(item.id)) {
      if (isBuildingTab) {
        this.showAlert('Already constructing this building', 'danger')
        return
      }
      const q = (this.buildQueueCnt.get(item.id) ?? 0) + 1
      this.buildQueueCnt.set(item.id, q)
      this.showAlert(`${item.label} queued (+${q})`, 'info')
      return
    }

    // Superweapon limit: max 1 of each type
    if (SUPERWEAPON_BUILDING_IDS.includes(item.id)) {
      type E = { getBuildingsForPlayer(playerId: number): Array<{ def: { id: string }; state: string }> }
      const em = this.registry.get('entityMgr') as E | undefined
      if (em) {
        const alreadyOwned = em.getBuildingsForPlayer(0).some(
          b => b.def.id === item.id && b.state !== 'dying'
        )
        if (alreadyOwned) {
          this.showAlert('Already have this superweapon', 'danger')
          return
        }
      }
    }

    // RA2: Check tech prerequisites
    if (!this.checkPrerequisites(item.id)) {
      this.showAlert('Prerequisites not met', 'danger')
      return
    }

    // RA2: Credits deducted gradually — just need enough to start (any credits > 0)
    if (player.credits <= 0) {
      this.showAlert('Insufficient funds', 'danger')
      // Flash credits red
      this.creditsText.setColor('#ff4444')
      this.time.delayedCall(400, () => this.creditsText.setColor('#ffd700'))
      return
    }

    this.buildProgress.set(item.id, 0)
    // 1.5x faster than default build times
    this.buildTimers.set(item.id, item.buildTime * 1000 / 1.5)
    this.creditsPaid.set(item.id, 0)

    const gs = this.scene.get('GameScene')
    if (gs) gs.events.emit('startProduction', { defId: item.id, type: (item.tab === 'buildings' || item.tab === 'defenses') ? 'building' : 'unit' })

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
    const now = this.time.now
    const dedupeKey = `${type}:${msg.toLowerCase()}`
    const until = this.alertCooldownUntil.get(dedupeKey) ?? 0
    if (now < until) return
    this.alertCooldownUntil.set(dedupeKey, now + 2500)

    const cornerX = 16
    const palette: Record<AlertType, { bg: number; text: string; border: number }> = {
      success: { bg: 0x0a1a0a, text: '#4ade80', border: 0x4ade80 },
      warning: { bg: 0x1a1800, text: '#ffdd44', border: 0xddbb00 },
      danger:  { bg: 0x1a0808, text: '#e94560', border: 0xe94560 },
      info:    { bg: 0x0a0e1a, text: '#88aacc', border: 0x4466aa },
    }
    const iconByType: Record<AlertType, string> = {
      success: 'OK',
      warning: '!',
      danger: 'X',
      info: 'i',
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
    const ctr    = this.add.container(cornerX, alertY)
    ctr.setDepth(200)

    const iconTxt = this.add.text(0, 0, iconByType[type], {
      fontFamily: 'monospace', fontSize: '10px', color: pal.text,
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5)

    const txt = this.add.text(18, 0, msg.toUpperCase(), {
      fontFamily: 'monospace', fontSize: '11px', color: pal.text,
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5)

    const pw = txt.width  + 28
    const ph = txt.height + 8
    const bgGfx = this.add.graphics()
    bgGfx.fillStyle(pal.bg, 0.93)
    bgGfx.fillRect(0, -ph / 2, pw, ph)
    bgGfx.lineStyle(1, pal.border, 0.8)
    bgGfx.strokeRect(0, -ph / 2, pw, ph)

    ctr.add([bgGfx, iconTxt, txt])
    ctr.setAlpha(0).setScale(0.85)

    const entry: AlertEntry = { container: ctr, createdAt: now }
    this.alertEntries.push(entry)

    this.tweens.add({ targets: ctr, alpha: 1, scale: 1, duration: 180, ease: 'Back.Out' })

    entry.tween = this.tweens.add({
      targets: ctr,
      alpha: 0,
      delay: 3500,
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
    const item = this.buildItems.find(i => i.id === defId)
    if (item) this.ghostLabel.setText(`[${item.label}] LMB=place  RMB=cancel`)
    this.input.on('pointerdown', this.onPlacementPointer, this)
  }

  private exitPlacement(refund: boolean) {
    if (!this.placementMode) return
    if (refund && this.placementDefId) {
      const item = this.buildItems.find(i => i.id === this.placementDefId)
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

    const world = this.pointerScreenToCart(ptr.x, ptr.y)
    const tileCol = Math.floor(world.x / TILE_SIZE)
    const tileRow = Math.floor(world.y / TILE_SIZE)

    // Pre-check validity — don't exit placement if invalid
    const canPlace = this.registry.get('canPlaceBuilding') as
      ((defId: string, col: number, row: number) => boolean) | undefined
    if (canPlace && !canPlace(this.placementDefId!, tileCol, tileRow)) {
      this.showAlert('Cannot build here — too far from base', 'danger')
      return  // Stay in placement mode — let player try another spot
    }

    const gs = this.scene.get('GameScene')
    if (gs) gs.events.emit('placeBuilding', { defId: this.placementDefId, tileCol, tileRow })

    const item = this.buildItems.find(i => i.id === this.placementDefId)
    this.pendingPlace.delete(this.placementDefId!)
    this.showAlert(`${item?.label ?? 'Building'} placed!`, 'success')
    this.exitPlacement(false)
  }

  private onSuperweaponPointer = (ptr: Phaser.Input.Pointer) => {
    if (!this.superweaponTargetMode) return
    if (ptr.rightButtonDown()) {
      this.exitSuperweaponTarget()
      return
    }
    if (!ptr.leftButtonDown()) return
    if (ptr.x >= this.sidebarX) return

    const world = this.pointerScreenToCart(ptr.x, ptr.y)
    const worldX = world.x
    const worldY = world.y

    const gs = this.scene.get('GameScene')
    if (gs) {
      gs.events.emit('fireSuperweapon', {
        defId: this.superweaponActiveId,
        targetX: worldX,
        targetY: worldY,
      })
    }

    this.showAlert(`${(this.superweaponActiveId ?? '').replace(/_/g, ' ').toUpperCase()} LAUNCHED!`, 'danger')
    this.superweaponReady.delete(this.superweaponActiveId!)
    // Restart countdown
    if (this.superweaponActiveId && SUPERWEAPON_TIMERS[this.superweaponActiveId]) {
      this.superweaponTimers.set(this.superweaponActiveId, SUPERWEAPON_TIMERS[this.superweaponActiveId])
    }
    this.exitSuperweaponTarget()
  }

  private exitSuperweaponTarget() {
    this.superweaponTargetMode = false
    this.superweaponActiveId = null
    this.ghost.setVisible(false)
    this.ghostLabel.setVisible(false)
    this.input.off('pointerdown', this.onSuperweaponPointer, this)
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
      const item = this.buildItems.find(i => i.id === d.defId)
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

    // Tab cycling (Tab key only — number keys are for selection groups)
    kb.on('keydown-TAB', (ev: KeyboardEvent) => {
      ev.preventDefault()
      const list: BuildTab[] = ['buildings', 'defenses', 'infantry', 'vehicles', 'aircraft']
      this.switchTab(list[(list.indexOf(this.activeTab) + 1) % list.length])
    })

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
        const cyIso = cartToScreen(cy.x, cy.y)
        this.registry.set('camTargetX', cyIso.x - this.sidebarX / 2)
        this.registry.set('camTargetY', cyIso.y - this.scale.height / 2)
      }
    })

    // Space → jump to last alert location
    kb.on('keydown-SPACE', () => {
      const pos = this.registry.get('lastAlertPos') as { x: number; y: number } | undefined
      if (pos) {
        const alertIso = cartToScreen(pos.x, pos.y)
        this.registry.set('camTargetX', alertIso.x - this.sidebarX / 2)
        this.registry.set('camTargetY', alertIso.y - this.scale.height / 2)
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

    // Ctrl+1-9 save / 1-9 recall selection groups / double-tap to center camera
    const keyNames = ['ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE']
    const lastGroupTap: Map<number, number> = new Map()
    keyNames.forEach((kn, i) => {
      kb.on(`keydown-${kn}`, (ev: KeyboardEvent) => {
        const n = i + 1
        if (ev.ctrlKey) {
          const ids = (this.registry.get('selectedIds') as string[]) ?? []
          this.selGroups.set(n, [...ids])
          this.showAlert(`Group ${n} saved`, 'info')
        } else {
          const group = this.selGroups.get(n)
          if (group && group.length > 0) {
            const now = Date.now()
            const lastTap = lastGroupTap.get(n) ?? 0

            this.registry.set('selectedIds', [...group])

            // Double-tap: center camera on group
            if (now - lastTap < 400) {
              type E = { x: number; y: number }
              const em = this.registry.get('entityMgr') as { getUnit(id: string): E | undefined } | undefined
              if (em) {
                const first = em.getUnit(group[0])
                if (first) {
                  const groupIso = cartToScreen(first.x, first.y)
                  this.registry.set('camTargetX', groupIso.x - this.sidebarX / 2)
                  this.registry.set('camTargetY', groupIso.y - this.scale.height / 2)
                }
              }
            }
            lastGroupTap.set(n, now)
          }
        }
      })
    })

    // Build hotkeys per active tab slot (Q,W,E,R,T,Y,U,I,O,P)
    this.tabHotkeys.forEach((letter) => {
      kb.on(`keydown-${letter}`, () => {
        const btn = this.buildBtns.find(b => b._hotkey === letter)
        if (btn) this.onBuildClick(btn._item)
      })
    })
  }

  // ════════════════════════════════════════════════════════════════════
  // UPDATE helpers (called every frame)
  // ════════════════════════════════════════════════════════════════════

  private tickCredits(delta: number) {
    const prevDisplayed = this.displayedCredits
    const diff = this.targetCredits - this.displayedCredits
    if (Math.abs(diff) < 0.5) {
      this.displayedCredits = this.targetCredits
    } else {
      this.displayedCredits += diff * Math.min(1, delta / 150)
    }
    this.creditsText.setText(`$ ${Math.max(0, Math.floor(this.displayedCredits)).toLocaleString()}`)

    // Flash green when credits increase significantly
    if (this.displayedCredits - prevDisplayed > 5) {
      this.creditsText.setColor('#44ff66')
      this.time.delayedCall(200, () => this.creditsText.setColor('#ffd700'))
    }
  }

  private tickPower() {
    const { powerGenerated: gen, powerConsumed: con } = this.humanPlayer
    const pct   = gen > 0 ? con / gen : 0
    const color = pct < 0.8 ? '#44cc44' : pct < 1 ? '#cccc44' : '#cc4444'
    this.powerText.setText(`${con}/${gen}`).setColor(color)
    this.drawPowerFill(gen, con)

    if (this.powerBarFrame) {
      const low = pct >= 1
      const flashOn = Math.floor(this.time.now / 220) % 2 === 0
      this.powerBarFrame.clear()
      this.powerBarFrame.fillStyle(low && flashOn ? 0x3a1111 : 0x0b111d, 0.95)
      const x = 8
      const y = this.powerBarY
      const h = Math.max(40, this.selectedY - y - 8)
      this.powerBarFrame.fillRect(x - 4, y - 2, POWER_BAR_W + 8, h + 4)
      this.powerBarFrame.lineStyle(1, low ? 0xcc4444 : HUD_BORDER, 0.85)
      this.powerBarFrame.strokeRect(x - 4, y - 2, POWER_BAR_W + 8, h + 4)
    }

    // Low power warning every ~10 s
    if (pct >= 1 && this.gameState.tick % 600 === 0) {
      this.showAlert('Low power', 'warning')
    }
  }

  private tickMinimap() {
    const g = this.mmGfx
    g.clear()
    if (!this.gameState?.map) return

    const map    = this.gameState.map
    const bounds = getIsoWorldBounds(map.width, map.height)
    const scaleX = this.mmW / bounds.width
    const scaleY = this.mmH / bounds.height
    const ox     = this.sidebarX + 4
    const oy     = this.minimapY

    const tg = this.mmTerrainGfx
    tg.clear()
    if (map.tiles) {
      const terrainColors: Record<number, number> = {
        0: 0x3a6a30, // grass
        1: 0x1a5a90, // water
        2: 0xc49010, // ore
        3: 0x666666, // rock
        4: 0xb09868, // sand
        5: 0x4a4a4a, // road
        6: 0x7a5510, // bridge
        7: 0x1a4a18, // forest
      }
      const dimColor = (color: number): number => {
        const r = (color >> 16) & 0xff
        const gc = (color >> 8) & 0xff
        const b = color & 0xff
        return ((r >> 1) << 16) | ((gc >> 1) << 8) | (b >> 1)
      }
      // Sample every Nth tile for performance
      const step = Math.max(1, Math.floor(1 / Math.max(scaleX, scaleY)))
      const miniTileW = Math.max(1, ISO_TILE_W * scaleX)
      const miniTileH = Math.max(1, ISO_TILE_H * scaleY)
      for (let row = 0; row < map.height; row += step) {
        for (let col = 0; col < map.width; col += step) {
          const tile = map.tiles[row]?.[col]
          if (!tile) continue
          const terrainColor = terrainColors[tile.terrain] ?? 0x333333
          const color =
            tile.fogState === FogState.HIDDEN ? 0x000000
            : tile.fogState === FogState.EXPLORED ? dimColor(terrainColor)
            : terrainColor
          const screen = cartToScreen(col * TILE_SIZE, row * TILE_SIZE)
          const mx = ox + screen.x * scaleX
          const my = oy + screen.y * scaleY
          tg.fillStyle(color, 1)
          drawIsoDiamond(tg, mx - miniTileW / 2, my, miniTileW * step, miniTileH * step)
          tg.fillPath()
        }
      }
    }

    type E = { id: string; playerId: number; type: string; x: number; y: number; isAlive: boolean; def?: { footprint?: { w: number; h: number } } }
    const em = this.registry.get('entityMgr') as {
      getAllEntities(): E[]
      getAllBuildings(): E[]
    } | undefined
    if (em) {
      const localId = this.gameState?.localPlayerId ?? 0
      em.getAllEntities().forEach(e => {
        if (!e.isAlive) return

        // Only show enemy entities if tile is VISIBLE in fog
        const isOwn = e.playerId === localId
        if (!isOwn && map.tiles) {
          const tc = Math.floor(e.x / TILE_SIZE)
          const tr = Math.floor(e.y / TILE_SIZE)
          const fog = map.tiles[tr]?.[tc]?.fogState ?? FogState.HIDDEN
          if (fog !== FogState.VISIBLE) return
        }

        // RA2 minimap colors: own blue, enemy red.
        const color = isOwn ? 0x4488ff : 0xe94560
        const screen = cartToScreen(e.x, e.y)
        const mx = ox + screen.x * scaleX
        const my = oy + screen.y * scaleY
        const sz = e.type === 'building' ? 2.8 : 2
        g.fillStyle(color, 1)
        if (e.type === 'building') {
          const fw = (e.def?.footprint?.w ?? 2) * ISO_TILE_W * scaleX
          const fh = (e.def?.footprint?.h ?? 2) * ISO_TILE_H * scaleY
          g.fillRect(mx - fw / 2, my - fh * 0.2, Math.max(2, fw), Math.max(2, fh))
        } else {
          g.fillRect(mx - sz / 2, my - sz / 2, sz, sz)
        }
      })

      // Explicitly render building footprints as tinted rectangles for readability.
      for (const b of em.getAllBuildings()) {
        if (!b.isAlive) continue
        const isOwn = b.playerId === localId
        if (!isOwn && map.tiles) {
          const tc = Math.floor(b.x / TILE_SIZE)
          const tr = Math.floor(b.y / TILE_SIZE)
          const fog = map.tiles[tr]?.[tc]?.fogState ?? FogState.HIDDEN
          if (fog !== FogState.VISIBLE) continue
        }
        const screen = cartToScreen(b.x, b.y)
        const mx = ox + screen.x * scaleX
        const my = oy + screen.y * scaleY
        const fw = Math.max(2, (b.def?.footprint?.w ?? 2) * ISO_TILE_W * scaleX)
        const fh = Math.max(2, (b.def?.footprint?.h ?? 2) * ISO_TILE_H * scaleY)
        g.lineStyle(1, isOwn ? 0x77aaff : 0xff8899, 0.9)
        g.strokeRect(mx - fw / 2, my - fh * 0.2, fw, fh)
      }
    }

    // Camera viewport rectangle (white)
    const camX = (this.registry.get('camX') as number) ?? 0
    const camY = (this.registry.get('camY') as number) ?? 0
    const viewportW = this.scale.width - SIDEBAR_W
    const vw   = viewportW * scaleX
    const vh   = this.scale.height * scaleY
    const vx   = ox + camX * scaleX
    const vy   = oy + camY * scaleY
    g.lineStyle(1, 0xffffff, 0.6)
    g.strokeRect(vx, vy, vw, vh)
  }

  private tickBuildProgress(delta: number) {
    const done: string[] = []

    this.buildProgress.forEach((_, id) => {
      const item = this.buildItems.find(i => i.id === id)!
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
      const item = this.buildItems.find(i => i.id === id)!

      // Process queue
      const q = this.buildQueueCnt.get(id) ?? 0
      if (q > 0) {
        this.buildQueueCnt.set(id, q - 1)
        if (q - 1 === 0) this.buildQueueCnt.delete(id)
        this.buildProgress.set(id, 0)
        this.buildTimers.set(id, item.buildTime * 1000)
      }

      if (item.tab === 'buildings' || item.tab === 'defenses') {
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
        // Clock-style radial progress around icon center.
        const radius = 14
        const start = -Math.PI / 2
        const end = start + Math.PI * 2 * prog
        bar.fillStyle(0x4ade80, 0.2)
        bar.slice(0, 0, radius, start, end, false)
        bar.lineTo(0, 0)
        bar.closePath()
        bar.fillPath()
        bar.lineStyle(2, 0x4ade80, 0.95)
        bar.beginPath()
        bar.arc(0, 0, radius, start, end, false)
        bar.strokePath()
      }

      btn._readyTxt?.setText(pending ? 'PLACE' : '')

      const q = this.buildQueueCnt.get(item.id) ?? 0
      btn._queueTxt?.setText(q > 0 ? `+${q}` : '')
      btn._hotkeyTxt?.setAlpha(this.checkPrerequisites(item.id) ? 1 : 0.35)

      this.drawItemBg(btn)
    })
  }

  private tickSuperweapons(delta: number) {
    // Check for newly placed superweapon buildings and start timers
    type E = { defId: string; playerId: number; isAlive: boolean }
    const em = this.registry.get('entityMgr') as { getAllEntities(): E[] } | undefined
    if (em) {
      for (const defId of SUPERWEAPON_IDS) {
        const hasBuilding = em.getAllEntities().some(
          e => e.defId === defId && e.playerId === 0 && e.isAlive,
        )
        if (hasBuilding && !this.superweaponTimers.has(defId) && !this.superweaponReady.has(defId)) {
          this.superweaponTimers.set(defId, SUPERWEAPON_TIMERS[defId])
          this.showAlert(`${defId.replace(/_/g, ' ').toUpperCase()} charging...`, 'warning')
        }
        if (!hasBuilding) {
          this.superweaponTimers.delete(defId)
          this.superweaponReady.delete(defId)
        }
      }
    }

    // Tick down active timers
    for (const [defId, remaining] of this.superweaponTimers) {
      const newRemaining = remaining - delta
      if (newRemaining <= 0) {
        this.superweaponTimers.delete(defId)
        this.superweaponReady.add(defId)
        this.showAlert(`${defId.replace(/_/g, ' ').toUpperCase()} READY!`, 'success')
      } else {
        this.superweaponTimers.set(defId, newRemaining)
      }
    }

    // Update superweapon build button visuals
    for (const btn of this.buildBtns) {
      const id = btn._item.id
      if (!SUPERWEAPON_IDS.has(id)) continue

      const remaining = this.superweaponTimers.get(id)
      const ready = this.superweaponReady.has(id)

      if (remaining !== undefined) {
        const secs = Math.ceil(remaining / 1000)
        const min = Math.floor(secs / 60)
        const sec = secs % 60
        btn._readyTxt?.setText(`${min}:${sec.toString().padStart(2, '0')}`)
        btn._readyTxt?.setColor('#ffdd44')
      } else if (ready) {
        // Pulse effect
        const pulse = 0.7 + Math.sin(Date.now() / 200) * 0.3
        btn._readyTxt?.setText('FIRE!')
        btn._readyTxt?.setColor('#4ade80')
        btn.setAlpha(pulse)
      }
    }

    // ── Superweapon countdown overlay (top-left of screen) ──
    const SW_LABELS: Record<string, string> = {
      nuclear_silo: 'NUKE', weather_device: 'WEATHER',
      iron_curtain: 'CURTAIN', chronosphere: 'CHRONO',
    }
    // Collect active superweapons (charging + ready)
    const activeIds = [...this.superweaponTimers.keys(), ...this.superweaponReady]
    let idx = 0
    for (const defId of SUPERWEAPON_IDS) {
      const remaining = this.superweaponTimers.get(defId)
      const ready = this.superweaponReady.has(defId)
      if (remaining === undefined && !ready) {
        // Hide if no longer active
        const txt = this.swCountdownTexts.get(defId)
        if (txt) txt.setVisible(false)
        continue
      }
      let txt = this.swCountdownTexts.get(defId)
      if (!txt) {
        txt = this.add.text(6, 6, '', {
          fontFamily: 'monospace', fontSize: '11px',
          color: '#ffffff', stroke: '#000000', strokeThickness: 3,
        }).setDepth(100)
        this.swCountdownTexts.set(defId, txt)
      }
      txt.setVisible(true)
      txt.setY(6 + idx * 18)
      const label = SW_LABELS[defId] ?? defId.toUpperCase()
      if (ready) {
        const pulse = Math.sin(Date.now() / 200) > 0
        txt.setText(`${label}: READY!`)
        txt.setColor(pulse ? '#4ade80' : '#ffffff')
      } else if (remaining !== undefined) {
        const secs = Math.ceil(remaining / 1000)
        const min = Math.floor(secs / 60)
        const sec = secs % 60
        txt.setText(`${label}: ${min}:${sec.toString().padStart(2, '0')}`)
        txt.setColor('#ffdd44')
      }
      idx++
    }
    void activeIds // suppress unused
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
    // Check if this is a production building — show primary status
    const producerTypes = ['barracks', 'war_factory', 'air_force_command', 'naval_shipyard', 'ore_refinery']
    const isProducer = ids.length === 1 && producerTypes.includes(first.defId)
    const prod = this.registry.get('production') as { isPrimaryProducer(pid: number, bid: string): boolean; getSpeedBonus(pid: number, defId: string): number } | undefined
    const isPrimary = isProducer && prod?.isPrimaryProducer(0, first.id)
    const speedBonus = isProducer && prod ? prod.getSpeedBonus(0, first.defId) : 1

    let infoText = ids.length === 1
      ? `HP: ${first.hp}/${first.maxHp}  (${hpPc}%)`
      : `${first.defId.replace(/_/g, ' ').toUpperCase()} + ${ids.length - 1} more`

    if (isProducer && ids.length === 1) {
      infoText += `\n${isPrimary ? '★ PRIMARY' : 'Click to set primary'}`
      if (speedBonus > 1) infoText += ` | +${Math.round((speedBonus - 1) * 100)}% speed`
    }

    this.selectedInfoTxt.setText(infoText)

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
    // Superweapon target mode ghost
    if (this.superweaponTargetMode) {
      const ptr = this.input.activePointer
      if (!ptr || ptr.x >= this.sidebarX) {
        this.ghost.setVisible(false); this.ghostLabel.setVisible(false); return
      }
      this.ghost.setVisible(true); this.ghostLabel.setVisible(true)
      const g = this.ghost
      g.clear()
      // Draw blast radius circle (6 tiles = 192px)
      const radius = this.superweaponActiveId === 'chronosphere' || this.superweaponActiveId === 'iron_curtain' ? 96 : 192
      const color = this.superweaponActiveId === 'iron_curtain' ? 0xff4444
        : this.superweaponActiveId === 'chronosphere' ? 0x44ddff
        : this.superweaponActiveId === 'weather_device' ? 0x4488ff : 0xff8800
      g.lineStyle(2, color, 0.8)
      g.strokeCircle(ptr.x, ptr.y, radius / 3) // visual at screen scale
      g.fillStyle(color, 0.15)
      g.fillCircle(ptr.x, ptr.y, radius / 3)
      this.ghostLabel.setPosition(ptr.x + 14, ptr.y - 22)
      this.ghostLabel.setText('Click to fire')
      this.ghostLabel.setColor(color === 0xff8800 ? '#ff8800' : color === 0xff4444 ? '#ff4444' : '#44ddff')
      return
    }

    if (!this.placementMode) return
    const ptr = this.input.activePointer
    if (!ptr || ptr.x >= this.sidebarX) {
      this.ghost.setVisible(false)
      this.ghostLabel.setVisible(false)
      return
    }
    this.ghost.setVisible(true)
    this.ghostLabel.setVisible(true)

    const camX = (this.registry.get('camX') as number) ?? 0
    const camY = (this.registry.get('camY') as number) ?? 0
    const world = this.pointerScreenToCart(ptr.x, ptr.y)
    const tileCol = Math.floor(world.x / TILE_SIZE)
    const tileRow = Math.floor(world.y / TILE_SIZE)
    const tileToScreen = (col: number, row: number) => {
      const iso = cartToScreen(col * TILE_SIZE, row * TILE_SIZE)
      return { x: iso.x - camX, y: iso.y - camY }
    }

    // Check actual validity via GameScene
    const canPlace = this.registry.get('canPlaceBuilding') as
      ((defId: string, col: number, row: number) => boolean) | undefined
    const valid = canPlace ? canPlace(this.placementDefId!, tileCol, tileRow) : true

    const g = this.ghost
    g.clear()

    // Show buildable range overlay (green tint around existing buildings)
    const em = this.registry.get('entityMgr') as
      { getBuildingsForPlayer(id: number): { occupiedTiles: { col: number; row: number }[]; state: string }[] } | undefined
    if (em) {
      const buildings = em.getBuildingsForPlayer(0)
      const rangeTiles = new Set<string>()
      for (const b of buildings) {
        if (b.state === 'dying') continue
        for (const tile of b.occupiedTiles) {
          for (let dr = -3; dr <= 3; dr++) {
            for (let dc = -3; dc <= 3; dc++) {
              rangeTiles.add(`${tile.col + dc},${tile.row + dr}`)
            }
          }
        }
      }
      // Draw range overlay
      g.fillStyle(0x44ff44, 0.06)
      for (const key of rangeTiles) {
        const [tc, tr] = key.split(',').map(Number)
        const p = tileToScreen(tc, tr)
        // Only draw tiles visible on screen
        if (p.x > -ISO_TILE_W && p.x < this.sidebarX + ISO_TILE_W && p.y > -ISO_TILE_H && p.y < this.scale.height + ISO_TILE_H) {
          drawIsoDiamond(g, p.x - ISO_TILE_W / 2, p.y, ISO_TILE_W, ISO_TILE_H)
          g.fillPath()
        }
      }
      // Draw range border
      g.lineStyle(1, 0x44ff44, 0.15)
      for (const key of rangeTiles) {
        const [tc, tr] = key.split(',').map(Number)
        // Check if edge tile (at least one neighbor not in range)
        const isEdge = !rangeTiles.has(`${tc-1},${tr}`) || !rangeTiles.has(`${tc+1},${tr}`) ||
                       !rangeTiles.has(`${tc},${tr-1}`) || !rangeTiles.has(`${tc},${tr+1}`)
        if (isEdge) {
          const p = tileToScreen(tc, tr)
          if (p.x > -ISO_TILE_W && p.x < this.sidebarX + ISO_TILE_W && p.y > -ISO_TILE_H && p.y < this.scale.height + ISO_TILE_H) {
            drawIsoDiamond(g, p.x - ISO_TILE_W / 2, p.y, ISO_TILE_W, ISO_TILE_H)
            g.strokePath()
          }
        }
      }
    }

    // Building footprint ghost — green if valid, red if invalid
    const col = valid ? 0x44ff44 : 0xff4444
    const def = this.placementDefId ? BUILDING_DEFS[this.placementDefId] : undefined
    const fpW = def?.footprint.w ?? 2
    const fpH = def?.footprint.h ?? 2
    g.fillStyle(col, 0.35)
    g.lineStyle(2, col, 0.85)
    for (let r = 0; r < fpH; r++) {
      for (let c = 0; c < fpW; c++) {
        const p = tileToScreen(tileCol + c, tileRow + r)
        drawIsoDiamond(g, p.x - ISO_TILE_W / 2, p.y, ISO_TILE_W, ISO_TILE_H)
        g.fillPath()
        drawIsoDiamond(g, p.x - ISO_TILE_W / 2, p.y, ISO_TILE_W, ISO_TILE_H)
        g.strokePath()
      }
    }
    // Add a simple raised prism silhouette so this reads as a building, not just tiles.
    const c0 = tileToScreen(tileCol, tileRow)
    const c1 = tileToScreen(tileCol + fpW, tileRow)
    const c2 = tileToScreen(tileCol + fpW, tileRow + fpH)
    const c3 = tileToScreen(tileCol, tileRow + fpH)
    const roofLift = Math.max(12, (fpW + fpH) * 2)
    g.fillStyle(col, 0.18)
    g.beginPath()
    g.moveTo(c0.x, c0.y - roofLift)
    g.lineTo(c1.x, c1.y - roofLift)
    g.lineTo(c2.x, c2.y - roofLift)
    g.lineTo(c3.x, c3.y - roofLift)
    g.closePath()
    g.fillPath()
    g.lineStyle(1, col, 0.5)
    g.lineBetween(c0.x, c0.y - roofLift, c0.x, c0.y)
    g.lineBetween(c1.x, c1.y - roofLift, c1.x, c1.y)
    g.lineBetween(c2.x, c2.y - roofLift, c2.x, c2.y)
    g.lineBetween(c3.x, c3.y - roofLift, c3.x, c3.y)

    this.ghostLabel.setPosition(ptr.x + 14, ptr.y - 22)
    this.ghostLabel.setText(valid ? 'Click to place' : '✗ Out of range')
    this.ghostLabel.setColor(valid ? '#44ff44' : '#ff4444')
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

  private pointerScreenToCart(screenX: number, screenY: number): { x: number; y: number } {
    const camX = (this.registry.get('camX') as number) ?? 0
    const camY = (this.registry.get('camY') as number) ?? 0
    return screenToCart(screenX + camX, screenY + camY)
  }
}
