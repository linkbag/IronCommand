// ============================================================
// IRON COMMAND — MenuScene
// Main menu with Red Alert 2 military aesthetic
// ============================================================

import Phaser from 'phaser'
import { FACTIONS, FACTION_IDS } from '../data/factions'

const STYLE = {
  bg: 0x0a0a12,
  panel: 0x12121e,
  border: 0x16213e,
  accent: 0xe94560,
  accentDim: 0x8a1a30,
  text: 0xeeeeee,
  textDim: 0x888888,
  btnHover: 0x1e2a4a,
}

export class MenuScene extends Phaser.Scene {
  private flagTicker!: Phaser.GameObjects.Container
  private flagItems: Phaser.GameObjects.Text[] = []

  constructor() {
    super({ key: 'MenuScene' })
  }

  create() {
    const { width, height } = this.scale

    this.flagItems = []

    this.createBackground(width, height)
    this.createTitle(width, height)
    this.createButtons(width, height)
    this.createFlagScroller(width, height)
    this.createScanlines(width, height)
  }

  private createBackground(width: number, height: number) {
    const g = this.add.graphics()

    // Deep dark background
    g.fillStyle(STYLE.bg, 1)
    g.fillRect(0, 0, width, height)

    // Angular corner accents (top-left)
    g.lineStyle(2, STYLE.accent, 0.6)
    g.beginPath()
    g.moveTo(0, 60)
    g.lineTo(60, 0)
    g.moveTo(0, 100)
    g.lineTo(100, 0)
    g.strokePath()

    // Bottom-right
    g.beginPath()
    g.moveTo(width, height - 60)
    g.lineTo(width - 60, height)
    g.moveTo(width, height - 100)
    g.lineTo(width - 100, height)
    g.strokePath()

    // Horizontal rule lines
    g.lineStyle(1, STYLE.accent, 0.2)
    g.beginPath()
    g.moveTo(0, height * 0.25)
    g.lineTo(width, height * 0.25)
    g.moveTo(0, height * 0.75)
    g.lineTo(width, height * 0.75)
    g.strokePath()

    // Red vertical bars (left edge)
    g.fillStyle(STYLE.accent, 0.15)
    g.fillRect(0, 0, 4, height)
    g.fillRect(8, 0, 2, height)

    // Right edge
    g.fillStyle(STYLE.accent, 0.15)
    g.fillRect(width - 4, 0, 4, height)
    g.fillRect(width - 10, 0, 2, height)
  }

  private createTitle(width: number, height: number) {
    // Main title
    const title = this.add.text(width / 2, height * 0.28, 'IRON COMMAND', {
      fontFamily: 'monospace',
      fontSize: `${Math.min(72, width / 12)}px`,
      color: '#e94560',
      stroke: '#000000',
      strokeThickness: 6,
      shadow: { offsetX: 3, offsetY: 3, color: '#8a1a30', blur: 8, fill: true },
    }).setOrigin(0.5)

    // Subtitle
    this.add.text(width / 2, height * 0.28 + title.height + 10,
      'Choose Your Faction. Build Your Army. Conquer.', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#aaaaaa',
      letterSpacing: 2,
    }).setOrigin(0.5)

    // Version tag
    this.add.text(width - 12, height - 12, 'v0.1.0 ALPHA', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#444466',
    }).setOrigin(1, 1)
  }

  private createButtons(width: number, height: number) {
    const centerX = width / 2
    const startY = height * 0.48
    const spacing = 70
    const btnW = 280
    const btnH = 52

    const buttons = [
      { label: 'SKIRMISH',  action: () => this.startSkirmish() },
      { label: 'OPTIONS',   action: () => this.showOptions() },
      { label: 'QUIT',      action: () => this.quitGame() },
    ]

    buttons.forEach((btn, i) => {
      const y = startY + i * spacing
      this.createButton(centerX, y, btnW, btnH, btn.label, btn.action)
    })
  }

  private createButton(
    x: number, y: number, w: number, h: number,
    label: string, action: () => void,
  ) {
    const container = this.add.container(x, y)

    // Background
    const bg = this.add.graphics()
    bg.fillStyle(STYLE.panel, 0.95)
    bg.fillRect(-w / 2, -h / 2, w, h)
    // Left accent bar
    bg.fillStyle(STYLE.accent, 1)
    bg.fillRect(-w / 2, -h / 2, 4, h)
    // Border
    bg.lineStyle(1, STYLE.border, 1)
    bg.strokeRect(-w / 2, -h / 2, w, h)

    const text = this.add.text(8, 0, label, {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#eeeeee',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0, 0.5)

    // Arrow indicator
    const arrow = this.add.text(w / 2 - 24, 0, '▶', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#e94560',
    }).setOrigin(0.5).setAlpha(0)

    container.add([bg, text, arrow])

    // Hitbox
    const zone = this.add.zone(x, y, w, h).setInteractive({ cursor: 'pointer' })

    zone.on('pointerover', () => {
      bg.clear()
      bg.fillStyle(STYLE.btnHover, 1)
      bg.fillRect(-w / 2, -h / 2, w, h)
      bg.fillStyle(STYLE.accent, 1)
      bg.fillRect(-w / 2, -h / 2, 4, h)
      bg.lineStyle(1, STYLE.accent, 0.8)
      bg.strokeRect(-w / 2, -h / 2, w, h)
      text.setColor('#ffffff')
      arrow.setAlpha(1)
    })

    zone.on('pointerout', () => {
      bg.clear()
      bg.fillStyle(STYLE.panel, 0.95)
      bg.fillRect(-w / 2, -h / 2, w, h)
      bg.fillStyle(STYLE.accent, 1)
      bg.fillRect(-w / 2, -h / 2, 4, h)
      bg.lineStyle(1, STYLE.border, 1)
      bg.strokeRect(-w / 2, -h / 2, w, h)
      text.setColor('#eeeeee')
      arrow.setAlpha(0)
    })

    zone.on('pointerdown', () => {
      this.cameras.main.flash(80, 233, 69, 96)
      this.time.delayedCall(120, action)
    })
  }

  private createFlagScroller(width: number, height: number) {
    const y = height - 44
    const factionList = FACTION_IDS.map(id => FACTIONS[id])

    // Background bar
    const bar = this.add.graphics()
    bar.fillStyle(0x0d0d1a, 0.9)
    bar.fillRect(0, y - 16, width, 32)
    bar.lineStyle(1, STYLE.border, 1)
    bar.lineBetween(0, y - 16, width, y - 16)

    this.flagTicker = this.add.container(0, y)
    const items: Phaser.GameObjects.Text[] = []
    let totalWidth = 0

    // Duplicate list for seamless looping
    const doubled = [...factionList, ...factionList]
    doubled.forEach((faction, i) => {
      const txt = this.add.text(totalWidth, 0,
        `${faction.flag}  ${faction.name.toUpperCase()}  `, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: `#${faction.color.toString(16).padStart(6, '0')}`,
      }).setOrigin(0, 0.5)
      items.push(txt)
      this.flagTicker.add(txt)
      totalWidth += txt.width
    })

    this.flagItems = items

    // Scroll animation
    const halfWidth = totalWidth / 2
    this.tweens.add({
      targets: this.flagTicker,
      x: { from: 0, to: -halfWidth },
      duration: 30000,
      repeat: -1,
      ease: 'Linear',
    })
  }

  private createScanlines(width: number, height: number) {
    const g = this.add.graphics()
    g.fillStyle(0x000000, 0.04)
    for (let row = 0; row < height; row += 4) {
      g.fillRect(0, row, width, 2)
    }
    g.setAlpha(0.5)
  }

  private startSkirmish() {
    this.scene.start('SetupScene')
  }

  private showOptions() {
    // Placeholder — flash text
    const { width, height } = this.scale
    const msg = this.add.text(width / 2, height / 2, 'OPTIONS — COMING SOON', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#e94560',
      stroke: '#000',
      strokeThickness: 3,
    }).setOrigin(0.5)

    this.tweens.add({
      targets: msg,
      alpha: 0,
      duration: 1500,
      onComplete: () => msg.destroy(),
    })
  }

  private quitGame() {
    // In browser context, just show a farewell message
    const { width, height } = this.scale
    this.add.text(width / 2, height / 2, 'DISMISSED, COMMANDER.', {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#e94560',
    }).setOrigin(0.5)
    this.cameras.main.fadeOut(2000, 0, 0, 0)
  }
}
