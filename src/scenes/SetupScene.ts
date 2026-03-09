// ============================================================
// IRON COMMAND — SetupScene
// Skirmish setup: faction picker + game settings
// ============================================================

import Phaser from 'phaser'
import type { FactionId, StartDistanceMode, TeamId } from '../types'
import { TILE_SIZE } from '../types'
import { FACTIONS, FACTION_IDS } from '../data/factions'
import { MAX_AI_PLAYERS, getPlayerSlotColor, playerColorToCss } from '../data/playerSlots'
import { generatePreviewData, PREVIEW_COLORS } from '../engine/GameMap'
import { MAP_VISIBILITY_OPTIONS, createDefaultSkirmishConfig, DEFAULT_SLOT_TEAMS } from './skirmishConfig'
import type { SkirmishConfig, MapVisibility } from './skirmishConfig'

import type { MapTemplate } from '../types'
export type { MapTemplate }
export type { SkirmishConfig } from './skirmishConfig'

const STYLE = {
  bg: 0x08080f,
  panel: 0x10101c,
  panelBorder: 0x1c2a4a,
  accent: 0xe94560,
  accentDim: 0x5a1a28,
  text: 0xeeeeee,
  textDim: 0x778899,
  selected: 0xe94560,
  selectedBg: 0x2a0a14,
  btnNormal: 0x14141e,
  btnHover: 0x1e2a4a,
  launch: 0xaa2200,
  launchHover: 0xee4400,
}

const TEAM_IDS: TeamId[] = ['A', 'B', 'C', 'D']
const TEAM_COLORS: Record<TeamId, number> = {
  A: 0x4466ee,
  B: 0xe94560,
  C: 0x44cc44,
  D: 0xddbb00,
}

const MAP_SIZES: Array<{ label: string; value: SkirmishConfig['mapSize']; tiles: string }> = [
  { label: 'SMALL',  value: 'small',  tiles: '64×64' },
  { label: 'MEDIUM', value: 'medium', tiles: '128×128' },
  { label: 'LARGE',  value: 'large',  tiles: '256×256' },
]

const DIFFICULTIES: Array<{ label: string; value: SkirmishConfig['aiDifficulty'] }> = [
  { label: 'EASY',       value: 'easy' },
  { label: 'MEDIUM',     value: 'medium' },
  { label: 'HARD',       value: 'hard' },
  { label: 'SMART HARD', value: 'smart_hard' },
]

const CREDIT_OPTIONS = [5000, 10000, 20000]

const START_DISTANCE_OPTIONS: Array<{ label: string; value: StartDistanceMode }> = [
  { label: 'CLOSE', value: 'close_battle' },
  { label: 'FAR',   value: 'long_range' },
]

export class SetupScene extends Phaser.Scene {
  private config: SkirmishConfig = createDefaultSkirmishConfig()

  // Graphic refs for redraws
  private factionButtons: Map<FactionId, { bg: Phaser.GameObjects.Graphics; border: Phaser.GameObjects.Graphics }> = new Map()
  private factionInfoText!: Phaser.GameObjects.Text
  private factionUnitText!: Phaser.GameObjects.Text
  private factionSWText!: Phaser.GameObjects.Text

  private mapSizeBtns: Map<string, Phaser.GameObjects.Graphics> = new Map()
  private mapVisibilityBtns: Map<MapVisibility, Phaser.GameObjects.Graphics> = new Map()
  private startDistanceBtns: Map<StartDistanceMode, Phaser.GameObjects.Graphics> = new Map()
  private templateBtns: Map<string, Phaser.GameObjects.Graphics> = new Map()
  private diffBtns: Map<string, Phaser.GameObjects.Graphics> = new Map()
  private creditBtns: Map<number, Phaser.GameObjects.Graphics> = new Map()
  private aiCountText!: Phaser.GameObjects.Text
  private mapPreview!: Phaser.GameObjects.Graphics
  private spawnMarkers: Phaser.GameObjects.Text[] = []
  private spawnZones: Phaser.GameObjects.Zone[] = []
  private spawnLegend?: Phaser.GameObjects.Text
  private previewSize = 150
  private previewX = 0
  private previewY = 0
  private allianceRows: Map<number, {
    rowBg: Phaser.GameObjects.Graphics
    label: Phaser.GameObjects.Text
    toggleBg: Phaser.GameObjects.Graphics
    toggleText: Phaser.GameObjects.Text
    zone: Phaser.GameObjects.Zone
    rowX: number
    rowY: number
    rowW: number
    rowH: number
    toggleX: number
    toggleW: number
  }> = new Map()

  private teamSelectorRows: Map<number, {
    rowBg: Phaser.GameObjects.Graphics
    label: Phaser.GameObjects.Text
    teamBtns: Map<TeamId, { bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone }>
    rowX: number
    rowY: number
    rowW: number
    rowH: number
  }> = new Map()

  constructor() {
    super({ key: 'SetupScene' })
  }

  // Called by Phaser before create() on every start/restart.  Clearing Maps here
  // prevents stale destroyed-object references from lingering if create() is ever
  // reached with an unexpected execution order.
  init() {
    this.factionButtons.clear()
    this.mapSizeBtns.clear()
    this.mapVisibilityBtns.clear()
    this.startDistanceBtns.clear()
    this.templateBtns.clear()
    this.diffBtns.clear()
    this.creditBtns.clear()
    this.allianceRows.clear()
    this.teamSelectorRows.clear()
    this.spawnMarkers = []
    this.spawnZones = []
    this.spawnLegend = undefined
  }

  create() {
    this.config.aiCount = Phaser.Math.Clamp(Math.floor(this.config.aiCount || 1), 1, MAX_AI_PLAYERS)
    this.sanitizeAllyPlayerIds()
    if (!this.config.playerTeams || this.config.playerTeams.length === 0) {
      this.config.playerTeams = [...DEFAULT_SLOT_TEAMS]
    }
    const { width, height } = this.scale

    this.createBackground(width, height)
    this.createHeader(width)
    this.createFactionPanel(width, height)
    this.createSettingsPanel(width, height)
    this.createMapPreview()
    this.createBottomBar(width, height)
    this.updateFactionInfo()
    this.regeneratePreview()
  }

  private createBackground(width: number, height: number) {
    const g = this.add.graphics()
    g.fillStyle(STYLE.bg, 1)
    g.fillRect(0, 0, width, height)
    // Scanlines
    g.fillStyle(0x000000, 0.03)
    for (let y = 0; y < height; y += 4) {
      g.fillRect(0, y, width, 2)
    }
  }

  private createHeader(width: number) {
    // Top bar
    const g = this.add.graphics()
    g.fillStyle(STYLE.panel, 1)
    g.fillRect(0, 0, width, 50)
    g.lineStyle(1, STYLE.accent, 0.5)
    g.lineBetween(0, 50, width, 50)

    this.add.text(width / 2, 25, 'SKIRMISH SETUP', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#e94560',
      stroke: '#000',
      strokeThickness: 3,
    }).setOrigin(0.5)

    // Back button
    const backZone = this.add.zone(60, 25, 100, 40).setInteractive({ cursor: 'pointer' })
    const backText = this.add.text(60, 25, '◀ BACK', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5)
    backZone.on('pointerdown', () => this.scene.start('MenuScene'))
    backZone.on('pointerover', () => backText.setColor('#ffffff'))
    backZone.on('pointerout',  () => backText.setColor('#aaaaaa'))
  }

  private createFactionPanel(width: number, height: number) {
    const panelX = 12
    const panelY = 60
    const panelW = Math.floor(width * 0.58)
    const panelH = height - 120

    // Panel background
    const g = this.add.graphics()
    g.fillStyle(STYLE.panel, 1)
    g.fillRect(panelX, panelY, panelW, panelH)
    g.lineStyle(1, STYLE.panelBorder, 1)
    g.strokeRect(panelX, panelY, panelW, panelH)

    // Section title
    this.add.text(panelX + 12, panelY + 10, 'SELECT FACTION', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#e94560',
    })

    // Faction grid — 5 columns × 3 rows
    const cols = 5
    const btnW = Math.floor((panelW - 24) / cols) - 4
    const btnH = 52
    const gridStartX = panelX + 12
    const gridStartY = panelY + 36

    FACTION_IDS.forEach((id, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const bx = gridStartX + col * (btnW + 4)
      const by = gridStartY + row * (btnH + 4)
      this.createFactionBtn(id, bx, by, btnW, btnH)
    })

    // Info panel below grid
    const infoY = gridStartY + 3 * (btnH + 4) + 10
    const infoH = panelH - (infoY - panelY) - 10

    const ig = this.add.graphics()
    ig.fillStyle(0x0a0a14, 1)
    ig.fillRect(panelX + 8, infoY, panelW - 16, infoH)
    ig.lineStyle(1, STYLE.accentDim, 0.8)
    ig.strokeRect(panelX + 8, infoY, panelW - 16, infoH)

    this.factionInfoText = this.add.text(panelX + 16, infoY + 10, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#cccccc',
      wordWrap: { width: panelW - 40 },
    })

    this.factionUnitText = this.add.text(panelX + 16, infoY + 40, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#88aacc',
      wordWrap: { width: panelW - 40 },
    })

    this.factionSWText = this.add.text(panelX + 16, infoY + 70, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#cc4466',
    })
  }

  private createFactionBtn(id: FactionId, x: number, y: number, w: number, h: number) {
    const faction = FACTIONS[id]

    const bg = this.add.graphics()
    const border = this.add.graphics()

    const drawNormal = () => {
      bg.clear()
      bg.fillStyle(STYLE.btnNormal, 1)
      bg.fillRect(x, y, w, h)

      border.clear()
      border.lineStyle(1, 0x222244, 1)
      border.strokeRect(x, y, w, h)
    }

    const drawSelected = () => {
      bg.clear()
      bg.fillStyle(STYLE.selectedBg, 1)
      bg.fillRect(x, y, w, h)

      border.clear()
      border.lineStyle(2, faction.color, 1)
      border.strokeRect(x, y, w, h)
    }

    const drawHover = () => {
      bg.clear()
      bg.fillStyle(STYLE.btnHover, 1)
      bg.fillRect(x, y, w, h)

      border.clear()
      border.lineStyle(1, faction.color, 0.6)
      border.strokeRect(x, y, w, h)
    }

    drawNormal()

    this.add.text(x + w / 2, y + 8, faction.flag, {
      fontSize: '18px',
    }).setOrigin(0.5, 0)

    this.add.text(x + w / 2, y + h - 12, faction.name.split(' ')[0].toUpperCase(), {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#cccccc',
    }).setOrigin(0.5, 1)

    const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ cursor: 'pointer' })

    zone.on('pointerover', () => {
      if (this.config.playerFaction !== id) drawHover()
    })
    zone.on('pointerout', () => {
      if (this.config.playerFaction !== id) drawNormal()
      else drawSelected()
    })
    zone.on('pointerdown', () => {
      const prev = this.config.playerFaction
      this.config.playerFaction = id

      // Reset previous
      const prevBtns = this.factionButtons.get(prev)
      if (prevBtns) {
        prevBtns.bg.clear()
        prevBtns.bg.fillStyle(STYLE.btnNormal, 1)
        prevBtns.bg.fillRect(0, 0, 0, 0) // clears all
        // redraw normal
      }
      // Use stored refs
      const cur = this.factionButtons.get(id)
      if (cur) {
        drawSelected()
      } else {
        drawSelected()
      }

      // Reset all others
      this.factionButtons.forEach((_, fid) => {
        if (fid !== id) {
          // They'll redraw on next over/out; force normal
        }
      })

      this.updateFactionInfo()
    })

    this.factionButtons.set(id, { bg, border })

    if (id === this.config.playerFaction) drawSelected()
  }

  private createSettingsPanel(width: number, height: number) {
    const panelX = Math.floor(width * 0.58) + 24
    const panelY = 60
    const panelW = width - panelX - 12
    const panelH = height - 120
    const contentPadding = 10
    const contentGap = 10
    const minContentW = 248
    const availableW = panelW - contentPadding * 2
    let previewDockW = Math.max(0, Math.min(190, Math.floor(panelW * 0.34)))
    if (availableW - previewDockW - contentGap < minContentW) {
      previewDockW = Math.max(0, availableW - minContentW - contentGap)
    }
    const hasPreviewDock = previewDockW >= 120
    const settingsW = hasPreviewDock ? (availableW - previewDockW - contentGap) : availableW
    const settingsX = panelX + contentPadding
    const previewDockX = settingsX + settingsW + contentGap
    if (hasPreviewDock) {
      this.previewSize = Math.max(110, Math.min(166, previewDockW - 18))
      this.previewX = previewDockX + Math.floor((previewDockW - this.previewSize) / 2)
      this.previewY = panelY + 44
    } else {
      this.previewSize = Math.max(100, Math.min(150, panelW - 22))
      this.previewX = panelX + Math.floor((panelW - this.previewSize) / 2)
      this.previewY = panelY + panelH - this.previewSize - 70
    }

    const g = this.add.graphics()
    g.fillStyle(STYLE.panel, 1)
    g.fillRect(panelX, panelY, panelW, panelH)
    g.lineStyle(1, STYLE.panelBorder, 1)
    g.strokeRect(panelX, panelY, panelW, panelH)
    if (hasPreviewDock) {
      g.lineStyle(1, STYLE.panelBorder, 0.6)
      g.lineBetween(previewDockX - 5, panelY + 8, previewDockX - 5, panelY + panelH - 8)
    }

    this.add.text(panelX + 12, panelY + 10, 'GAME SETTINGS', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#e94560',
    })

    let cy = panelY + 44

    // Map Size
    cy = this.createRadioGroup(
      settingsX, cy, settingsW,
      'MAP SIZE',
      MAP_SIZES.map(m => ({ label: `${m.label}\n${m.tiles}`, value: m.value })),
      this.config.mapSize,
      (v) => { this.config.mapSize = v as SkirmishConfig['mapSize']; this.regeneratePreview() },
      this.mapSizeBtns,
    )

    cy += 16

    // Map Template
    const TEMPLATES: Array<{ label: string; value: MapTemplate }> = [
      { label: '🌍 CONTINENTAL', value: 'continental' },
      { label: '🏝️ ISLANDS', value: 'islands' },
      { label: '🏜️ DESERT', value: 'desert' },
      { label: '❄️ ARCTIC', value: 'arctic' },
      { label: '🏙️ URBAN', value: 'urban' },
      { label: '🎲 RANDOM', value: 'random' },
    ]
    cy = this.createRadioGroup(
      settingsX, cy, settingsW,
      'MAP TEMPLATE',
      TEMPLATES.map(t => ({ label: t.label, value: t.value })),
      this.config.mapTemplate,
      (v) => {
        this.config.mapTemplate = v as MapTemplate
        this.regeneratePreview()
      },
      this.templateBtns,
    )

    cy += 16

    // Map Visibility
    cy = this.createRadioGroup(
      settingsX, cy, settingsW,
      'MAP VISIBILITY',
      MAP_VISIBILITY_OPTIONS.map(m => ({ label: m.label, value: m.value })),
      this.config.mapVisibility,
      (v) => { this.config.mapVisibility = v as MapVisibility },
      this.mapVisibilityBtns as unknown as Map<string | number | boolean, Phaser.GameObjects.Graphics>,
    )

    cy += 16

    // Start Distance Mode
    cy = this.createRadioGroup(
      settingsX, cy, settingsW,
      'START DISTANCE',
      START_DISTANCE_OPTIONS.map(m => ({ label: m.label, value: m.value })),
      this.config.startDistanceMode ?? 'long_range',
      (v) => {
        this.config.startDistanceMode = v as StartDistanceMode
        this.regeneratePreview()
      },
      this.startDistanceBtns as unknown as Map<string | number | boolean, Phaser.GameObjects.Graphics>,
    )

    cy += 16

    // AI Difficulty
    cy = this.createRadioGroup(
      settingsX, cy, settingsW,
      'AI DIFFICULTY',
      DIFFICULTIES.map(d => ({ label: d.label, value: d.value })),
      this.config.aiDifficulty,
      (v) => { this.config.aiDifficulty = v as SkirmishConfig['aiDifficulty'] },
      this.diffBtns,
    )

    cy += 16

    // Starting Credits
    cy = this.createRadioGroup(
      settingsX, cy, settingsW,
      'STARTING CREDITS',
      CREDIT_OPTIONS.map(c => ({ label: c.toLocaleString(), value: c })),
      this.config.startingCredits,
      (v) => { this.config.startingCredits = Number(v) },
      this.creditBtns as unknown as Map<string, Phaser.GameObjects.Graphics>,
    )

    cy += 16

    // AI Opponents (stepper)
    this.add.text(settingsX, cy, 'AI OPPONENTS', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aaaaaa',
    })
    cy += 20

    const stepperW = settingsW
    const sg = this.add.graphics()
    sg.fillStyle(STYLE.btnNormal, 1)
    sg.fillRect(settingsX, cy, stepperW, 36)
    sg.lineStyle(1, STYLE.panelBorder, 1)
    sg.strokeRect(settingsX, cy, stepperW, 36)

    // Minus button
    const minusZone = this.add.zone(settingsX + 18, cy + 18, 32, 32).setInteractive({ cursor: 'pointer' })
    const minusText = this.add.text(settingsX + 18, cy + 18, '−', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#e94560',
    }).setOrigin(0.5)

    this.aiCountText = this.add.text(settingsX + stepperW / 2, cy + 18,
      `${this.config.aiCount}`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5)

    // Plus button
    const plusZone = this.add.zone(settingsX + stepperW - 18, cy + 18, 32, 32).setInteractive({ cursor: 'pointer' })
    const plusText = this.add.text(settingsX + stepperW - 18, cy + 18, '+', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#e94560',
    }).setOrigin(0.5)

    minusZone.on('pointerdown', () => {
      this.config.aiCount = Math.max(1, this.config.aiCount - 1)
      this.aiCountText.setText(`${this.config.aiCount}`)
      this.sanitizeAllyPlayerIds()
      this.refreshAllianceRows()
      this.refreshTeamRows()
      this.regeneratePreview()
    })
    plusZone.on('pointerdown', () => {
      this.config.aiCount = Math.min(MAX_AI_PLAYERS, this.config.aiCount + 1)
      this.aiCountText.setText(`${this.config.aiCount}`)
      this.sanitizeAllyPlayerIds()
      this.refreshAllianceRows()
      this.refreshTeamRows()
      this.regeneratePreview()
    })
    minusZone.on('pointerover', () => minusText.setColor('#ffffff'))
    minusZone.on('pointerout',  () => minusText.setColor('#e94560'))
    plusZone.on('pointerover', () => plusText.setColor('#ffffff'))
    plusZone.on('pointerout',  () => plusText.setColor('#e94560'))

    cy += 44

    // ── Team Assignment ───────────────────────────────────────
    this.add.text(settingsX, cy, 'TEAM ASSIGNMENT', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aaaaaa',
    })
    cy += 20

    const taRowH = 24
    const taRowGap = 3
    const taCols = 2
    const taColGap = 8
    const taColW = Math.floor((settingsW - taColGap) / taCols)
    const taBtnW = 15
    const taBtnH = 18
    const taBtnGap = 2
    const taLabelW = 38

    for (let slot = 0; slot <= MAX_AI_PLAYERS; slot++) {
      const col = slot % taCols
      const row = Math.floor(slot / taCols)
      const rowX = settingsX + col * (taColW + taColGap)
      const rowY = cy + row * (taRowH + taRowGap)

      const rowBg = this.add.graphics()
      const slotColor = getPlayerSlotColor(slot)
      const slotLabel = slot === 0 ? 'YOU' : `AI ${slot}`
      const label = this.add.text(rowX + 4, rowY + taRowH / 2, slotLabel, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: playerColorToCss(slotColor),
      }).setOrigin(0, 0.5)

      const teamBtns: Map<TeamId, { bg: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone }> = new Map()
      const btnsStartX = rowX + 4 + taLabelW + 4

      TEAM_IDS.forEach((tid, tidx) => {
        const bx = btnsStartX + tidx * (taBtnW + taBtnGap)
        const by = rowY + (taRowH - taBtnH) / 2

        const bg = this.add.graphics()
        const text = this.add.text(bx + taBtnW / 2, by + taBtnH / 2, tid, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ffffff',
        }).setOrigin(0.5)

        const zone = this.add.zone(bx + taBtnW / 2, by + taBtnH / 2, taBtnW, taBtnH)
          .setInteractive({ cursor: 'pointer' })

        zone.on('pointerdown', () => {
          if (slot > 0 && slot > this.config.aiCount) return
          if (!this.config.playerTeams) this.config.playerTeams = [...DEFAULT_SLOT_TEAMS]
          this.config.playerTeams[slot] = tid
          this.refreshTeamRows()
        })

        teamBtns.set(tid, { bg, text, zone })
      })

      this.teamSelectorRows.set(slot, { rowBg, label, teamBtns, rowX, rowY, rowW: taColW, rowH: taRowH })
    }
    this.refreshTeamRows()
  }

  private sanitizeAllyPlayerIds() {
    this.config.aiCount = Phaser.Math.Clamp(Math.floor(this.config.aiCount || 1), 1, MAX_AI_PLAYERS)
    const maxAllies = Math.max(0, this.config.aiCount - 1)
    this.config.allyPlayerIds = this.config.allyPlayerIds
      .filter(id => Number.isInteger(id) && id >= 1 && id <= this.config.aiCount)
      .sort((a, b) => a - b)
      .slice(0, maxAllies)
  }

  private refreshAllianceRows() {
    this.sanitizeAllyPlayerIds()
    for (let aiId = 1; aiId <= MAX_AI_PLAYERS; aiId++) {
      const row = this.allianceRows.get(aiId)
      if (!row) continue

      const visible = aiId <= this.config.aiCount
      const isAlly = this.config.allyPlayerIds.includes(aiId)
      const slotColor = getPlayerSlotColor(aiId)
      row.rowBg.clear()
      row.toggleBg.clear()

      if (visible) {
        row.rowBg.fillStyle(STYLE.btnNormal, 1)
        row.rowBg.fillRect(row.rowX, row.rowY, row.rowW, row.rowH)
        row.rowBg.lineStyle(1, slotColor, 0.5)
        row.rowBg.strokeRect(row.rowX, row.rowY, row.rowW, row.rowH)

        row.toggleBg.fillStyle(isAlly ? STYLE.selectedBg : STYLE.btnNormal, 1)
        row.toggleBg.fillRect(row.toggleX, row.rowY, row.toggleW, row.rowH)
        row.toggleBg.lineStyle(1, isAlly ? STYLE.selected : slotColor, isAlly ? 1 : 0.7)
        row.toggleBg.strokeRect(row.toggleX, row.rowY, row.toggleW, row.rowH)
      }

      row.toggleText.setText(isAlly ? 'ALLY' : 'ENEMY')
      row.label.setColor(playerColorToCss(slotColor))
      row.toggleText.setColor(isAlly ? '#e94560' : playerColorToCss(slotColor))

      row.rowBg.setVisible(visible)
      row.label.setVisible(visible)
      row.toggleBg.setVisible(visible)
      row.toggleText.setVisible(visible)
      row.zone.setVisible(visible)
      row.zone.setPosition(row.toggleX + row.toggleW / 2, row.rowY + row.rowH / 2)
      row.toggleText.setPosition(row.toggleX + row.toggleW / 2, row.rowY + row.rowH / 2)
      row.zone.input!.enabled = visible
    }
  }

  private refreshTeamRows() {
    if (!this.config.playerTeams) {
      this.config.playerTeams = [...DEFAULT_SLOT_TEAMS]
    }
    const taBtnW = 15
    const taBtnH = 18
    const taBtnGap = 2
    const taLabelW = 38

    for (let slot = 0; slot <= MAX_AI_PLAYERS; slot++) {
      const row = this.teamSelectorRows.get(slot)
      if (!row) continue

      const visible = slot === 0 || slot <= this.config.aiCount
      const currentTeam = (this.config.playerTeams[slot] ?? DEFAULT_SLOT_TEAMS[slot]) as TeamId
      const slotColor = getPlayerSlotColor(slot)

      row.rowBg.clear()
      if (visible) {
        row.rowBg.fillStyle(STYLE.btnNormal, 1)
        row.rowBg.fillRect(row.rowX, row.rowY, row.rowW, row.rowH)
        row.rowBg.lineStyle(1, slotColor, 0.4)
        row.rowBg.strokeRect(row.rowX, row.rowY, row.rowW, row.rowH)
      }

      const btnsStartX = row.rowX + 4 + taLabelW + 4

      TEAM_IDS.forEach((tid, tidx) => {
        const btnEntry = row.teamBtns.get(tid)
        if (!btnEntry) return

        const bx = btnsStartX + tidx * (taBtnW + taBtnGap)
        const by = row.rowY + (row.rowH - taBtnH) / 2
        const isSelected = currentTeam === tid
        const teamColor = TEAM_COLORS[tid]

        btnEntry.bg.clear()
        if (visible) {
          if (isSelected) {
            btnEntry.bg.fillStyle(teamColor, 0.9)
            btnEntry.bg.fillRect(bx, by, taBtnW, taBtnH)
            btnEntry.bg.lineStyle(1, teamColor, 1)
            btnEntry.bg.strokeRect(bx, by, taBtnW, taBtnH)
            btnEntry.text.setColor('#ffffff')
          } else {
            btnEntry.bg.fillStyle(STYLE.btnNormal, 1)
            btnEntry.bg.fillRect(bx, by, taBtnW, taBtnH)
            btnEntry.bg.lineStyle(1, teamColor, 0.35)
            btnEntry.bg.strokeRect(bx, by, taBtnW, taBtnH)
            btnEntry.text.setColor('#555566')
          }
        }

        btnEntry.bg.setVisible(visible)
        btnEntry.text.setVisible(visible)
        btnEntry.zone.setVisible(visible)
        if (btnEntry.zone.input) btnEntry.zone.input.enabled = visible
      })

      row.rowBg.setVisible(visible)
      row.label.setVisible(visible)
      row.label.setColor(playerColorToCss(slotColor))
    }
  }

  private createRadioGroup(
    x: number, y: number, w: number,
    title: string,
    options: Array<{ label: string; value: string | number | boolean }>,
    current: string | number | boolean,
    onChange: (v: string | number | boolean) => void,
    store: Map<string | number | boolean, Phaser.GameObjects.Graphics>,
  ): number {
    this.add.text(x, y, title, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aaaaaa',
    })
    y += 20

    const btnGap = 4
    const btnW = Math.max(28, Math.floor((w - btnGap * (options.length - 1)) / options.length))
    const btnH = 36

    // Mutable selected value so hover/out handlers always reflect the live selection
    let selected = current

    options.forEach((opt, i) => {
      const bx = x + i * (btnW + btnGap)
      const bg = this.add.graphics()

      const drawState = (isSelected: boolean, hovered = false) => {
        bg.clear()
        if (isSelected) {
          bg.fillStyle(STYLE.accentDim, 1)
          bg.fillRect(bx, y, btnW, btnH)
          bg.lineStyle(2, STYLE.accent, 1)
          bg.strokeRect(bx, y, btnW, btnH)
        } else if (hovered) {
          bg.fillStyle(STYLE.btnHover, 1)
          bg.fillRect(bx, y, btnW, btnH)
          bg.lineStyle(1, STYLE.accent, 0.4)
          bg.strokeRect(bx, y, btnW, btnH)
        } else {
          bg.fillStyle(STYLE.btnNormal, 1)
          bg.fillRect(bx, y, btnW, btnH)
          bg.lineStyle(1, STYLE.panelBorder, 1)
          bg.strokeRect(bx, y, btnW, btnH)
        }
      }

      drawState(opt.value === selected)
      store.set(opt.value, bg)

      const lines = opt.label.split('\n')
      if (lines.length === 2) {
        this.add.text(bx + btnW / 2, y + 10, lines[0], {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#eeeeee',
        }).setOrigin(0.5, 0)
        this.add.text(bx + btnW / 2, y + 22, lines[1], {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#888888',
        }).setOrigin(0.5, 0)
      } else {
        this.add.text(bx + btnW / 2, y + btnH / 2, opt.label, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#eeeeee',
        }).setOrigin(0.5)
      }

      const zone = this.add.zone(bx + btnW / 2, y + btnH / 2, btnW, btnH)
        .setInteractive({ cursor: 'pointer' })

      zone.on('pointerover', () => {
        if (opt.value !== selected) drawState(false, true)
      })
      zone.on('pointerout', () => {
        drawState(opt.value === selected)
      })
      zone.on('pointerdown', () => {
        selected = opt.value
        store.forEach((g, key) => {
          const idx2 = options.findIndex(o => o.value === key)
          const bx2 = x + idx2 * (btnW + btnGap)
          g.clear()
          if (key === selected) {
            g.fillStyle(STYLE.accentDim, 1)
            g.fillRect(bx2, y, btnW, btnH)
            g.lineStyle(2, STYLE.accent, 1)
            g.strokeRect(bx2, y, btnW, btnH)
          } else {
            g.fillStyle(STYLE.btnNormal, 1)
            g.fillRect(bx2, y, btnW, btnH)
            g.lineStyle(1, STYLE.panelBorder, 1)
            g.strokeRect(bx2, y, btnW, btnH)
          }
        })
        onChange(opt.value)
      })
    })

    return y + btnH + 4
  }

  private createBottomBar(width: number, height: number) {
    const barH = 52
    const barY = height - barH

    const g = this.add.graphics()
    g.fillStyle(STYLE.panel, 1)
    g.fillRect(0, barY, width, barH)
    g.lineStyle(1, STYLE.accent, 0.4)
    g.lineBetween(0, barY, width, barY)

    // Launch button
    const btnW = 280
    const btnH = 38
    const bx = width / 2
    const by = barY + barH / 2

    const btnBg = this.add.graphics()
    const drawLaunch = (hover: boolean) => {
      btnBg.clear()
      btnBg.fillStyle(hover ? STYLE.launchHover : STYLE.launch, 1)
      btnBg.fillRect(bx - btnW / 2, by - btnH / 2, btnW, btnH)
      btnBg.lineStyle(2, hover ? 0xff6644 : 0xcc4400, 1)
      btnBg.strokeRect(bx - btnW / 2, by - btnH / 2, btnW, btnH)
    }
    drawLaunch(false)

    this.add.text(bx, by, '▶  LAUNCH MISSION', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5)

    const zone = this.add.zone(bx, by, btnW, btnH).setInteractive({ cursor: 'pointer' })
    zone.on('pointerover', () => drawLaunch(true))
    zone.on('pointerout',  () => drawLaunch(false))
    zone.on('pointerdown', () => this.launchMission())
  }

  private updateFactionInfo() {
    const faction = FACTIONS[this.config.playerFaction]
    const sideLabel = faction.side === 'alliance' ? 'IRON ALLIANCE' : 'RED COLLECTIVE'
    this.factionInfoText.setText(`${faction.flag}  ${faction.name.toUpperCase()}  [${sideLabel}]\n${faction.bonus}`)
    this.factionUnitText.setText(`Unique: ${faction.uniqueUnits.join(', ')}`)
    this.factionSWText.setText(`Superweapon: ${faction.superweapon}`)

    // Update faction button visuals
    this.factionButtons.forEach((refs, id) => {
      const isSelected = id === this.config.playerFaction
      const f = FACTIONS[id]
      refs.bg.clear()
      refs.bg.fillStyle(isSelected ? STYLE.selectedBg : STYLE.btnNormal, 1)
      // Note: graphics positions are absolute, stored per-draw
      refs.border.clear()
      if (isSelected) {
        refs.border.lineStyle(2, f.color, 1)
      }
      // Can't easily redraw without stored x/y; the zone hover handlers handle it
    })
  }

  private createMapPreview() {
    const previewSize = this.previewSize
    const px = this.previewX
    const py = this.previewY

    // Panel background
    const bg = this.add.graphics()
    bg.fillStyle(0x0a0a14, 1)
    bg.fillRect(px - 10, py - 30, previewSize + 20, previewSize + 80)
    bg.lineStyle(1, STYLE.panelBorder, 1)
    bg.strokeRect(px - 10, py - 30, previewSize + 20, previewSize + 80)

    this.add.text(px + previewSize / 2, py - 20, 'MAP PREVIEW', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aaaaaa',
    }).setOrigin(0.5)

    // Map preview canvas
    this.mapPreview = this.add.graphics()
    this.mapPreview.setPosition(px, py)

    // New Map button
    const btnW = 100, btnH = 24
    const btnX = px + previewSize / 2
    const btnY = py + previewSize + 16
    const btnBg = this.add.graphics()
    btnBg.fillStyle(STYLE.btnNormal, 1)
    btnBg.fillRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH)
    btnBg.lineStyle(1, STYLE.panelBorder, 1)
    btnBg.strokeRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH)

    this.add.text(btnX, btnY, '🔄 NEW MAP', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#e94560',
    }).setOrigin(0.5)

    const zone = this.add.zone(btnX, btnY, btnW, btnH).setInteractive({ cursor: 'pointer' })
    zone.on('pointerdown', () => {
      this.config.mapSeed = Math.floor(Math.random() * 99999) + 1
      this.regeneratePreview()
    })
  }

  private regeneratePreview() {
    if (!this.mapPreview) return
    const g = this.mapPreview
    g.clear()

    const mapDims: Record<string, number> = { small: 64, medium: 128, large: 256 }
    const mapSize = mapDims[this.config.mapSize] ?? 64
    const data = generatePreviewData(mapSize, mapSize, this.config.mapSeed, this.config.mapTemplate)

    const previewSize = this.previewSize
    const scale = previewSize / mapSize

    // Draw terrain
    for (let row = 0; row < mapSize; row++) {
      for (let col = 0; col < mapSize; col++) {
        const tile = data.tiles[row][col]
        const color = PREVIEW_COLORS[tile.terrain] ?? 0x4a7c3f
        g.fillStyle(color, 1)
        g.fillRect(col * scale, row * scale, Math.ceil(scale), Math.ceil(scale))
      }
    }

    // Clean up old spawn markers
    for (const m of this.spawnMarkers) m.destroy()
    for (const z of this.spawnZones) z.destroy()
    this.spawnMarkers = []
    this.spawnZones = []

    // Draw spawn points
    const pw = this.mapPreview.x
    const ph = this.mapPreview.y
    const positions = data.startPositions
    const maxSpawns = Math.min(positions.length, this.config.aiCount + 1) // player + AI count

    for (let i = 0; i < maxSpawns; i++) {
      const sp = positions[i]
      const sx = pw + (sp.x / (mapSize * TILE_SIZE)) * previewSize
      const sy = ph + (sp.y / (mapSize * TILE_SIZE)) * previewSize
      const isSelected = this.config.playerSpawn === i
      const slotColor = playerColorToCss(getPlayerSlotColor(i))

      const marker = this.add.text(sx, sy, `${i + 1}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: slotColor,
        stroke: isSelected ? '#ffffff' : '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5)

      const clickZone = this.add.zone(sx, sy, 20, 20).setInteractive({ cursor: 'pointer' })
      clickZone.on('pointerdown', () => {
        // Toggle: click same number again = random
        if (this.config.playerSpawn === i) {
          this.config.playerSpawn = -1
        } else {
          this.config.playerSpawn = i
        }
        this.regeneratePreview()
      })

      this.spawnMarkers.push(marker)
      this.spawnZones.push(clickZone)
    }

    // Spawn legend
    const legendY = ph + previewSize + 38
    this.spawnLegend?.destroy()
    const legendText = this.config.playerSpawn === -1
      ? 'Spawn: RANDOM (click # to pick)'
      : `Spawn: Position ${this.config.playerSpawn + 1} (click to change)`
    this.spawnLegend = this.add.text(pw + previewSize / 2, legendY, legendText, {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#778899',
    }).setOrigin(0.5)
  }

  private launchMission() {
    this.sanitizeAllyPlayerIds()
    const config: SkirmishConfig = {
      ...this.config,
      revealMap: this.config.mapVisibility === 'allVisible',
      allyPlayerIds: [...this.config.allyPlayerIds],
    }
    this.cameras.main.fadeOut(400, 0, 0, 0)
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('GameScene', { config })
    })
  }
}
