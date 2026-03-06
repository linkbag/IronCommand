// ============================================================
// IRON COMMAND — SetupScene
// Skirmish setup: faction picker + game settings
// ============================================================

import Phaser from 'phaser'
import type { FactionId } from '../types'
import { FACTIONS, FACTION_IDS } from '../data/factions'

export interface SkirmishConfig {
  playerFaction: FactionId
  mapSize: 'small' | 'medium' | 'large'
  aiCount: number
  aiDifficulty: 'easy' | 'medium' | 'hard'
  startingCredits: number
}

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

const MAP_SIZES: Array<{ label: string; value: SkirmishConfig['mapSize']; tiles: string }> = [
  { label: 'SMALL',  value: 'small',  tiles: '64×64' },
  { label: 'MEDIUM', value: 'medium', tiles: '128×128' },
  { label: 'LARGE',  value: 'large',  tiles: '256×256' },
]

const DIFFICULTIES: Array<{ label: string; value: SkirmishConfig['aiDifficulty'] }> = [
  { label: 'EASY',   value: 'easy' },
  { label: 'MEDIUM', value: 'medium' },
  { label: 'HARD',   value: 'hard' },
]

const CREDIT_OPTIONS = [5000, 10000, 20000]

export class SetupScene extends Phaser.Scene {
  private config: SkirmishConfig = {
    playerFaction: 'usa',
    mapSize: 'medium',
    aiCount: 1,
    aiDifficulty: 'medium',
    startingCredits: 10000,
  }

  // Graphic refs for redraws
  private factionButtons: Map<FactionId, { bg: Phaser.GameObjects.Graphics; border: Phaser.GameObjects.Graphics }> = new Map()
  private factionInfoText!: Phaser.GameObjects.Text
  private factionUnitText!: Phaser.GameObjects.Text
  private factionSWText!: Phaser.GameObjects.Text

  private mapSizeBtns: Map<string, Phaser.GameObjects.Graphics> = new Map()
  private diffBtns: Map<string, Phaser.GameObjects.Graphics> = new Map()
  private creditBtns: Map<number, Phaser.GameObjects.Graphics> = new Map()
  private aiCountText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'SetupScene' })
  }

  create() {
    const { width, height } = this.scale

    this.createBackground(width, height)
    this.createHeader(width)
    this.createFactionPanel(width, height)
    this.createSettingsPanel(width, height)
    this.createBottomBar(width, height)
    this.updateFactionInfo()
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
    this.add.text(60, 25, '◀ BACK', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5)
    backZone.on('pointerdown', () => this.scene.start('MenuScene'))
    backZone.on('pointerover', () => backText.setColor('#ffffff'))
    backZone.on('pointerout',  () => backText.setColor('#aaaaaa'))
    const backText = this.children.getByName('backText') as Phaser.GameObjects.Text
    void backText
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

    const g = this.add.graphics()
    g.fillStyle(STYLE.panel, 1)
    g.fillRect(panelX, panelY, panelW, panelH)
    g.lineStyle(1, STYLE.panelBorder, 1)
    g.strokeRect(panelX, panelY, panelW, panelH)

    this.add.text(panelX + 12, panelY + 10, 'GAME SETTINGS', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#e94560',
    })

    let cy = panelY + 44

    // Map Size
    cy = this.createRadioGroup(
      panelX + 10, cy, panelW - 20,
      'MAP SIZE',
      MAP_SIZES.map(m => ({ label: `${m.label}\n${m.tiles}`, value: m.value })),
      this.config.mapSize,
      (v) => { this.config.mapSize = v as SkirmishConfig['mapSize'] },
      this.mapSizeBtns,
    )

    cy += 16

    // AI Difficulty
    cy = this.createRadioGroup(
      panelX + 10, cy, panelW - 20,
      'AI DIFFICULTY',
      DIFFICULTIES.map(d => ({ label: d.label, value: d.value })),
      this.config.aiDifficulty,
      (v) => { this.config.aiDifficulty = v as SkirmishConfig['aiDifficulty'] },
      this.diffBtns,
    )

    cy += 16

    // Starting Credits
    cy = this.createRadioGroup(
      panelX + 10, cy, panelW - 20,
      'STARTING CREDITS',
      CREDIT_OPTIONS.map(c => ({ label: c.toLocaleString(), value: c })),
      this.config.startingCredits,
      (v) => { this.config.startingCredits = Number(v) },
      this.creditBtns as unknown as Map<string, Phaser.GameObjects.Graphics>,
    )

    cy += 16

    // AI Opponents (stepper)
    this.add.text(panelX + 10, cy, 'AI OPPONENTS', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aaaaaa',
    })
    cy += 20

    const stepperW = panelW - 20
    const sg = this.add.graphics()
    sg.fillStyle(STYLE.btnNormal, 1)
    sg.fillRect(panelX + 10, cy, stepperW, 36)
    sg.lineStyle(1, STYLE.panelBorder, 1)
    sg.strokeRect(panelX + 10, cy, stepperW, 36)

    // Minus button
    const minusZone = this.add.zone(panelX + 28, cy + 18, 32, 32).setInteractive({ cursor: 'pointer' })
    const minusText = this.add.text(panelX + 28, cy + 18, '−', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#e94560',
    }).setOrigin(0.5)

    this.aiCountText = this.add.text(panelX + 10 + stepperW / 2, cy + 18,
      `${this.config.aiCount}`, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5)

    // Plus button
    const plusZone = this.add.zone(panelX + 10 + stepperW - 18, cy + 18, 32, 32).setInteractive({ cursor: 'pointer' })
    const plusText = this.add.text(panelX + 10 + stepperW - 18, cy + 18, '+', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#e94560',
    }).setOrigin(0.5)

    minusZone.on('pointerdown', () => {
      this.config.aiCount = Math.max(1, this.config.aiCount - 1)
      this.aiCountText.setText(`${this.config.aiCount}`)
    })
    plusZone.on('pointerdown', () => {
      this.config.aiCount = Math.min(7, this.config.aiCount + 1)
      this.aiCountText.setText(`${this.config.aiCount}`)
    })
    minusZone.on('pointerover', () => minusText.setColor('#ffffff'))
    minusZone.on('pointerout',  () => minusText.setColor('#e94560'))
    plusZone.on('pointerover', () => plusText.setColor('#ffffff'))
    plusZone.on('pointerout',  () => plusText.setColor('#e94560'))
  }

  private createRadioGroup(
    x: number, y: number, w: number,
    title: string,
    options: Array<{ label: string; value: string | number }>,
    current: string | number,
    onChange: (v: string | number) => void,
    store: Map<string | number, Phaser.GameObjects.Graphics>,
  ): number {
    this.add.text(x, y, title, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aaaaaa',
    })
    y += 20

    const btnW = Math.floor(w / options.length) - 4
    const btnH = 36

    options.forEach((opt, i) => {
      const bx = x + i * (btnW + 4)
      const bg = this.add.graphics()

      const drawState = (selected: boolean, hovered = false) => {
        bg.clear()
        if (selected) {
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

      drawState(opt.value === current)
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
        if (opt.value !== current) drawState(false, true)
      })
      zone.on('pointerout', () => {
        drawState(opt.value === current)
      })
      zone.on('pointerdown', () => {
        // Deselect all
        store.forEach((g, key) => {
          const isNowSelected = key === opt.value
          g.clear()
          if (isNowSelected) {
            g.fillStyle(STYLE.accentDim, 1)
            g.fillRect(bx - (options.indexOf(options.find(o => o.value === key)!) * (btnW + 4)), y, btnW, btnH)
          }
        })
        // Simpler: just mark the right one
        store.forEach((g, key) => {
          const idx2 = options.findIndex(o => o.value === key)
          const bx2 = x + idx2 * (btnW + 4)
          g.clear()
          if (key === opt.value) {
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

  private launchMission() {
    this.cameras.main.fadeOut(400, 0, 0, 0)
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('GameScene', { config: this.config })
    })
  }
}
