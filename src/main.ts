// ============================================================
// IRON COMMAND — Main Entry Point
// ============================================================
// This file bootstraps the Phaser game instance.
// Scene implementations are in src/scenes/

import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { SetupScene } from './scenes/SetupScene'
import { GameScene } from './scenes/GameScene'
import { HUDScene } from './scenes/HUDScene'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, SetupScene, GameScene, HUDScene],
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  render: {
    pixelArt: true,
    antialias: false,
  },
}

const game = new Phaser.Game(config)

// Handle window resize
window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight)
})

export default game
