// ============================================================
// IRON COMMAND — HUD helper (standalone components)
// Resource display, power bar, build panel helpers
// Used by HUDScene internally
// ============================================================

import Phaser from 'phaser'

// ── ResourceDisplay ───────────────────────────────────────────────────

export class ResourceDisplay {
  private creditsText: Phaser.GameObjects.Text
  private powerText: Phaser.GameObjects.Text
  private powerBarBg: Phaser.GameObjects.Graphics
  private powerBar: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, x: number, y: number, width: number) {
    this.creditsText = scene.add.text(x + 4, y, '$ 0', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffdd44',
    })

    this.powerText = scene.add.text(x + width - 4, y, 'PWR: 0/0', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#88cc88',
    }).setOrigin(1, 0)

    // Power bar background
    this.powerBarBg = scene.add.graphics()
    this.powerBarBg.fillStyle(0x222233, 1)
    this.powerBarBg.fillRect(x + 4, y + 18, width - 8, 4)

    this.powerBar = scene.add.graphics()
  }

  update(credits: number, powerGenerated: number, powerConsumed: number) {
    this.creditsText.setText(`$ ${credits.toLocaleString()}`)

    const pct = powerGenerated > 0 ? powerConsumed / powerGenerated : 0
    const color = pct < 0.8 ? '#44cc44' : pct < 1 ? '#cccc44' : '#cc4444'
    this.powerText.setText(`${powerConsumed}/${powerGenerated}`).setColor(color)

    const barColor = pct < 0.8 ? 0x44cc44 : pct < 1 ? 0xcccc44 : 0xcc4444
    const x = this.creditsText.x - 4
    const w = this.powerText.x - x
    this.powerBar.clear()
    this.powerBar.fillStyle(barColor, 1)
    this.powerBar.fillRect(x + 4, this.creditsText.y + 18, Math.floor((w - 8) * Math.min(pct, 1)), 4)
  }
}

// ── EVA Alert Ticker ──────────────────────────────────────────────────

export class EvaAlert {
  private text: Phaser.GameObjects.Text
  private tween?: Phaser.Tweens.Tween
  private queue: string[] = []
  private busy = false

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.text = scene.add.text(x, y, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ffdd44',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setAlpha(0).setDepth(200)

    this.scene = scene
  }

  private scene: Phaser.Scene

  push(msg: string) {
    this.queue.push(msg)
    if (!this.busy) this.showNext()
  }

  private showNext() {
    if (this.queue.length === 0) { this.busy = false; return }
    this.busy = true
    const msg = this.queue.shift()!
    this.text.setText(msg).setAlpha(1)

    if (this.tween) this.tween.stop()
    this.tween = this.scene.tweens.add({
      targets: this.text,
      alpha: 0,
      delay: 1800,
      duration: 500,
      onComplete: () => this.showNext(),
    })
  }
}
