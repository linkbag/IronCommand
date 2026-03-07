// ============================================================
// IRON COMMAND — BootScene
// Procedurally generates all textures used by units/buildings/UI
// ============================================================

import Phaser from 'phaser'

type InfantryKind =
  | 'gi' | 'conscript' | 'engineer' | 'spy' | 'attack_dog' | 'tanya'
  | 'chrono_legionnaire' | 'sniper' | 'flak_trooper' | 'tesla_trooper'
  | 'crazy_ivan' | 'yuri' | 'desolator' | 'terrorist'

type VehicleKind =
  | 'grizzly_tank' | 'rhino_tank' | 'apocalypse_tank' | 'ifv' | 'flak_track'
  | 'mirage_tank' | 'prism_tank' | 'tank_destroyer' | 'v3_launcher'
  | 'tesla_tank' | 'dragon_tank' | 'chrono_miner' | 'war_miner' | 'mcv'
  | 'terror_drone' | 'demo_truck' | 'brahmos_battery' | 'conquistador_mech'
  | 'mecha_walker'

type AircraftKind =
  | 'harrier' | 'black_eagle' | 'nighthawk' | 'rocketeer' | 'recon_drone' | 'kirov'

type NavalKind =
  | 'destroyer' | 'aegis_cruiser' | 'aircraft_carrier' | 'typhoon_sub' | 'dreadnought' | 'giant_squid'

type BuildingKind =
  | 'construction_yard' | 'power_plant' | 'tesla_reactor' | 'nuclear_reactor'
  | 'barracks' | 'war_factory' | 'airfield' | 'naval_yard' | 'ore_refinery'
  | 'service_depot' | 'tech_center' | 'ore_purifier' | 'spy_satellite'
  | 'radar_tower' | 'wall' | 'turret' | 'aa_gun' | 'prism_tower'
  | 'tesla_coil' | 'gap_generator' | 'psychic_sensor' | 'superweapon'
  | 'chronosphere' | 'iron_curtain' | 'grand_cannon' | 'cloning_vats'

export class BootScene extends Phaser.Scene {
  private progressBar!: Phaser.GameObjects.Graphics
  private progressBox!: Phaser.GameObjects.Graphics
  private loadingText!: Phaser.GameObjects.Text
  private tasks: Array<() => void> = []
  private taskIndex = 0

  constructor() {
    super({ key: 'BootScene' })
  }

  preload() {
    this.createLoadingUI()
  }

  create() {
    this.buildTaskList()
    this.runNextTask()
  }

  private createLoadingUI() {
    const { width, height } = this.scale

    const bg = this.add.graphics()
    bg.fillStyle(0x0a0a0f, 1)
    bg.fillRect(0, 0, width, height)

    this.add.text(width / 2, height / 2 - 80, 'IRON COMMAND', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#e94560',
      stroke: '#000',
      strokeThickness: 4,
    }).setOrigin(0.5)

    this.loadingText = this.add.text(width / 2, height / 2 - 20, 'Initializing systems...', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5)

    this.progressBox = this.add.graphics()
    this.progressBox.fillStyle(0x1a1a2e, 1)
    this.progressBox.fillRect(width / 2 - 200, height / 2 + 10, 400, 24)

    this.progressBar = this.add.graphics()
  }

  private buildTaskList() {
    const tasks: Array<() => void> = []

    const terrainDefs: Array<{ key: string; color: number }> = [
      { key: 'terrain_grass', color: 0x4a7c3f },
      { key: 'terrain_water', color: 0x1e6fa8 },
      { key: 'terrain_ore', color: 0xd4a017 },
      { key: 'terrain_rock', color: 0x777777 },
      { key: 'terrain_sand', color: 0xc2a96e },
      { key: 'terrain_forest', color: 0x1e5c1e },
      { key: 'terrain_road', color: 0x555555 },
    ]
    for (const t of terrainDefs) tasks.push(() => this.genTile(t.key, t.color))

    const infantryDefs: Array<{ key: string; color: number; accent: number; kind: InfantryKind }> = [
      { key: 'unit_gi', color: 0x5a80b0, accent: 0xcfd9e8, kind: 'gi' },
      { key: 'unit_conscript', color: 0x8a3b30, accent: 0xe0b6a6, kind: 'conscript' },
      { key: 'unit_engineer', color: 0x5d7488, accent: 0xffd34d, kind: 'engineer' },
      { key: 'unit_spy', color: 0x2f3644, accent: 0x9ca7b9, kind: 'spy' },
      { key: 'unit_attack_dog', color: 0x654938, accent: 0x31231a, kind: 'attack_dog' },
      { key: 'unit_tanya', color: 0x3a638f, accent: 0xddd0c6, kind: 'tanya' },
      { key: 'unit_chrono_legionnaire', color: 0x78d7ff, accent: 0xeffaff, kind: 'chrono_legionnaire' },
      { key: 'unit_sniper', color: 0x4d5e4d, accent: 0xb8c2a4, kind: 'sniper' },
      { key: 'unit_flak_trooper', color: 0x7c5142, accent: 0xb0b0b0, kind: 'flak_trooper' },
      { key: 'unit_tesla_trooper', color: 0x6b2f8a, accent: 0x67e2ff, kind: 'tesla_trooper' },
      { key: 'unit_crazy_ivan', color: 0x8b5a3c, accent: 0x222222, kind: 'crazy_ivan' },
      { key: 'unit_yuri', color: 0x5e3d8c, accent: 0xe483ff, kind: 'yuri' },
      { key: 'unit_desolator', color: 0x5a7540, accent: 0x9df06d, kind: 'desolator' },
      { key: 'unit_terrorist', color: 0x6f3a32, accent: 0xff5f3a, kind: 'terrorist' },
      // Legacy keys kept for compatibility
      { key: 'unit_rifle', color: 0x4f7ea7, accent: 0xcfd9e8, kind: 'gi' },
      { key: 'unit_rocket', color: 0x7c5142, accent: 0xb0b0b0, kind: 'flak_trooper' },
      { key: 'unit_dog', color: 0x654938, accent: 0x31231a, kind: 'attack_dog' },
    ]
    for (const u of infantryDefs) tasks.push(() => this.genInfantry(u.key, u.color, u.accent, u.kind))

    const vehicleDefs: Array<{ key: string; color: number; accent: number; kind: VehicleKind; w?: number; h?: number }> = [
      { key: 'unit_grizzly_tank', color: 0x4f708d, accent: 0x9bbad1, kind: 'grizzly_tank' },
      { key: 'unit_rhino_tank', color: 0x7a3f34, accent: 0xc77e68, kind: 'rhino_tank' },
      { key: 'unit_apocalypse_tank', color: 0x5a2f2f, accent: 0xd39d4c, kind: 'apocalypse_tank', w: 32, h: 22 },
      { key: 'unit_ifv', color: 0x3c6f88, accent: 0xc8d9e8, kind: 'ifv' },
      { key: 'unit_flak_track', color: 0x6b4334, accent: 0xb0b0b0, kind: 'flak_track' },
      { key: 'unit_mirage_tank', color: 0x6a8b5d, accent: 0xb7d9a6, kind: 'mirage_tank' },
      { key: 'unit_prism_tank', color: 0x5e82b8, accent: 0x9fffff, kind: 'prism_tank' },
      { key: 'unit_tank_destroyer', color: 0x4d6068, accent: 0xd9e6ea, kind: 'tank_destroyer' },
      { key: 'unit_v3_launcher', color: 0x6f4742, accent: 0xe0a83f, kind: 'v3_launcher', w: 30, h: 20 },
      { key: 'unit_tesla_tank', color: 0x6b3546, accent: 0x67e2ff, kind: 'tesla_tank' },
      { key: 'unit_dragon_tank', color: 0x7a4230, accent: 0xff8f42, kind: 'dragon_tank' },
      { key: 'unit_chrono_miner', color: 0x4f7ca6, accent: 0x81ecff, kind: 'chrono_miner', w: 30, h: 20 },
      { key: 'unit_war_miner', color: 0x875733, accent: 0xd8b368, kind: 'war_miner', w: 30, h: 20 },
      { key: 'unit_mcv', color: 0x55616e, accent: 0x8fd5ff, kind: 'mcv', w: 32, h: 22 },
      { key: 'unit_terror_drone', color: 0x552f2f, accent: 0xff5f5f, kind: 'terror_drone', w: 24, h: 18 },
      { key: 'unit_demo_truck', color: 0x7f4b3f, accent: 0xff4422, kind: 'demo_truck' },
      { key: 'unit_brahmos_battery', color: 0x5b4652, accent: 0xffcc88, kind: 'brahmos_battery', w: 32, h: 22 },
      { key: 'unit_conquistador_mech', color: 0x6a5a4a, accent: 0xbfd6e0, kind: 'conquistador_mech', w: 30, h: 22 },
      { key: 'unit_mecha_walker', color: 0x4f697f, accent: 0x9be0ff, kind: 'mecha_walker', w: 30, h: 22 },
      // Legacy keys kept for compatibility
      { key: 'unit_light_tank', color: 0x4f708d, accent: 0x9bbad1, kind: 'grizzly_tank' },
      { key: 'unit_heavy_tank', color: 0x5a2f2f, accent: 0xd39d4c, kind: 'apocalypse_tank', w: 32, h: 22 },
      { key: 'unit_artillery', color: 0x6f4742, accent: 0xe0a83f, kind: 'v3_launcher', w: 30, h: 20 },
      { key: 'unit_apc', color: 0x3c6f88, accent: 0xc8d9e8, kind: 'ifv' },
      { key: 'unit_harvester', color: 0x875733, accent: 0xd8b368, kind: 'war_miner', w: 30, h: 20 },
    ]
    for (const v of vehicleDefs) {
      tasks.push(() => this.genVehicle(v.key, v.color, v.accent, v.kind, v.w ?? 28, v.h ?? 20))
    }

    const aircraftDefs: Array<{ key: string; color: number; accent: number; kind: AircraftKind }> = [
      { key: 'unit_harrier', color: 0x406fa4, accent: 0xd9e7f5, kind: 'harrier' },
      { key: 'unit_black_eagle', color: 0x2f4f7c, accent: 0xeff3ff, kind: 'black_eagle' },
      { key: 'unit_nighthawk', color: 0x4f5d6b, accent: 0xc7d5de, kind: 'nighthawk' },
      { key: 'unit_rocketeer', color: 0x5f87b3, accent: 0xffda63, kind: 'rocketeer' },
      { key: 'unit_recon_drone', color: 0x789090, accent: 0x8cffef, kind: 'recon_drone' },
      { key: 'unit_kirov', color: 0x7a3f3a, accent: 0xd1a288, kind: 'kirov' },
      // Legacy keys kept for compatibility
      { key: 'unit_fighter', color: 0x406fa4, accent: 0xd9e7f5, kind: 'harrier' },
      { key: 'unit_helicopter', color: 0x4f5d6b, accent: 0xc7d5de, kind: 'nighthawk' },
    ]
    for (const a of aircraftDefs) tasks.push(() => this.genAircraft(a.key, a.color, a.accent, a.kind))

    const navalDefs: Array<{ key: string; color: number; accent: number; kind: NavalKind }> = [
      { key: 'unit_destroyer', color: 0x486f94, accent: 0xdde9f7, kind: 'destroyer' },
      { key: 'unit_aegis_cruiser', color: 0x3f6287, accent: 0x8ce2ff, kind: 'aegis_cruiser' },
      { key: 'unit_aircraft_carrier', color: 0x4a5d71, accent: 0xf3f6fa, kind: 'aircraft_carrier' },
      { key: 'unit_typhoon_sub', color: 0x3b4149, accent: 0x8fa0b2, kind: 'typhoon_sub' },
      { key: 'unit_dreadnought', color: 0x6d3f3b, accent: 0xffb184, kind: 'dreadnought' },
      { key: 'unit_giant_squid', color: 0x5e2f64, accent: 0xc88cff, kind: 'giant_squid' },
    ]
    for (const n of navalDefs) tasks.push(() => this.genNaval(n.key, n.color, n.accent, n.kind))

    const buildingDefs: Array<{ key: string; color: number; kind: BuildingKind; w: number; h: number }> = [
      { key: 'bld_construction_yard', color: 0x6b6e74, kind: 'construction_yard', w: 96, h: 96 },
      { key: 'bld_power_plant', color: 0x4e6f85, kind: 'power_plant', w: 64, h: 64 },
      { key: 'bld_tesla_reactor', color: 0x6b3b47, kind: 'tesla_reactor', w: 64, h: 64 },
      { key: 'bld_nuclear_reactor', color: 0x4d5a6d, kind: 'nuclear_reactor', w: 96, h: 96 },
      { key: 'bld_barracks', color: 0x4f6a54, kind: 'barracks', w: 96, h: 64 },
      { key: 'bld_war_factory', color: 0x5f6268, kind: 'war_factory', w: 128, h: 96 },
      { key: 'bld_airfield', color: 0x3f566c, kind: 'airfield', w: 128, h: 64 },
      { key: 'bld_naval_yard', color: 0x305f78, kind: 'naval_yard', w: 128, h: 96 },
      { key: 'bld_ore_refinery', color: 0x6c5d3f, kind: 'ore_refinery', w: 96, h: 64 },
      { key: 'bld_service_depot', color: 0x6d654f, kind: 'service_depot', w: 96, h: 96 },
      { key: 'bld_tech_center', color: 0x526487, kind: 'tech_center', w: 96, h: 96 },
      { key: 'bld_ore_purifier', color: 0x66724a, kind: 'ore_purifier', w: 96, h: 64 },
      { key: 'bld_spy_satellite', color: 0x39516a, kind: 'spy_satellite', w: 64, h: 64 },
      { key: 'bld_radar_tower', color: 0x446472, kind: 'radar_tower', w: 64, h: 64 },
      { key: 'bld_wall', color: 0x7e7e7e, kind: 'wall', w: 32, h: 32 },
      { key: 'bld_turret', color: 0x70675a, kind: 'turret', w: 32, h: 32 },
      { key: 'bld_aa_gun', color: 0x596263, kind: 'aa_gun', w: 32, h: 32 },
      { key: 'bld_prism_tower', color: 0x4b6ca0, kind: 'prism_tower', w: 32, h: 32 },
      { key: 'bld_tesla_coil', color: 0x65394f, kind: 'tesla_coil', w: 32, h: 32 },
      { key: 'bld_gap_generator', color: 0x4a5a63, kind: 'gap_generator', w: 64, h: 64 },
      { key: 'bld_psychic_sensor', color: 0x5f466f, kind: 'psychic_sensor', w: 64, h: 64 },
      { key: 'bld_superweapon', color: 0x70433f, kind: 'superweapon', w: 96, h: 96 },
      { key: 'bld_chronosphere', color: 0x3f6d8e, kind: 'chronosphere', w: 96, h: 96 },
      { key: 'bld_iron_curtain', color: 0x6b3f48, kind: 'iron_curtain', w: 96, h: 96 },
      { key: 'bld_grand_cannon', color: 0x606060, kind: 'grand_cannon', w: 64, h: 64 },
      { key: 'bld_cloning_vats', color: 0x5d4c61, kind: 'cloning_vats', w: 128, h: 96 },
    ]
    for (const b of buildingDefs) {
      tasks.push(() => this.genBuilding(b.key, b.color, b.kind, b.w, b.h))
    }

    tasks.push(() => this.genProjectile('proj_bullet', 0xffff88, 4, 4))
    tasks.push(() => this.genProjectile('proj_missile', 0xff8844, 6, 3))
    tasks.push(() => this.genProjectile('proj_shell', 0xff4444, 5, 5))

    tasks.push(() => this.genExplosion())
    tasks.push(() => this.genTile('pixel_white', 0xffffff, 1, 1))
    tasks.push(() => this.genSelectionCircle())

    tasks.push(() => this.genGhostTile('ghost_valid', 0x4ade80, 0.35))
    tasks.push(() => this.genGhostTile('ghost_invalid', 0xe94560, 0.35))
    tasks.push(() => this.genCursorIcon('cursor_sell', 0xffd700))
    tasks.push(() => this.genCursorIcon('cursor_repair', 0x4488ff))
    tasks.push(() => this.genAttackMoveCursor())
    tasks.push(() => this.genAlertPanel())
    tasks.push(() => this.genVetChevron('vet_rank1', 1))
    tasks.push(() => this.genVetChevron('vet_rank2', 2))

    this.tasks = tasks
  }

  private runNextTask() {
    if (this.taskIndex >= this.tasks.length) {
      this.updateProgress(1)
      this.time.delayedCall(300, () => {
        this.scene.start('MenuScene')
      })
      return
    }

    const progress = this.taskIndex / this.tasks.length
    this.updateProgress(progress)
    this.loadingText.setText(`Loading assets... ${Math.round(progress * 100)}%`)

    this.tasks[this.taskIndex]()
    this.taskIndex++

    this.time.delayedCall(1, () => this.runNextTask())
  }

  private updateProgress(t: number) {
    const { width, height } = this.scale
    this.progressBar.clear()
    this.progressBar.fillStyle(0xe94560, 1)
    this.progressBar.fillRect(width / 2 - 198, height / 2 + 12, 396 * t, 20)
  }

  private lighten(color: number, amount: number): number {
    return Phaser.Display.Color.IntegerToColor(color).lighten(amount).color
  }

  private darken(color: number, amount: number): number {
    return Phaser.Display.Color.IntegerToColor(color).darken(amount).color
  }

  // ── Sprite Generators ──────────────────────────────────────────────

  private genTile(key: string, color: number, w = 32, h = 32) {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillRect(0, 0, w, h)
    g.lineStyle(1, 0x000000, 0.2)
    g.strokeRect(0, 0, w, h)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private genInfantry(key: string, color: number, accent: number, kind: InfantryKind) {
    const w = 20
    const h = 24
    const dirs = ['ne', 'se', 'sw', 'nw'] as const
    const dirOffset: Record<(typeof dirs)[number], { x: number; y: number }> = {
      ne: { x: 2, y: -1 },
      se: { x: 2, y: 1 },
      sw: { x: -2, y: 1 },
      nw: { x: -2, y: -1 },
    }

    for (const dir of dirs) {
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      const body = this.darken(color, 8)
      const headX = 10 + dirOffset[dir].x
      const headY = 6 + dirOffset[dir].y
      const torsoX = 6 + dirOffset[dir].x
      const torsoY = 9 + dirOffset[dir].y
      const weaponX = headX + dirOffset[dir].x * 2
      const weaponY = headY + 3

      if (kind === 'attack_dog') {
        g.fillStyle(body, 0.3)
        g.fillEllipse(10, 18, 14, 5)
        g.fillStyle(color, 1)
        g.fillEllipse(10 + dirOffset[dir].x, 13 + dirOffset[dir].y, 12, 7)
        g.fillEllipse(14 + dirOffset[dir].x, 12 + dirOffset[dir].y, 6, 5)
        g.fillStyle(body, 1)
        g.fillRect(6, 15, 2, 5)
        g.fillRect(9, 16, 2, 4)
        g.fillRect(12, 16, 2, 4)
        g.fillRect(14, 15, 2, 5)
      } else {
        g.fillStyle(this.darken(color, 20), 0.3)
        g.fillEllipse(10, 20, 12, 5)
        g.fillStyle(accent, 1)
        g.fillEllipse(headX, headY, 7, 6)
        g.fillStyle(color, 1)
        g.fillTriangle(torsoX + 4, torsoY, torsoX + 8, torsoY + 8, torsoX, torsoY + 8)
        g.fillStyle(body, 1)
        g.fillRect(torsoX + 2, torsoY + 8, 2, 5)
        g.fillRect(torsoX + 6, torsoY + 8, 2, 5)
      }

      switch (kind) {
        case 'gi':
        case 'conscript':
        case 'flak_trooper':
          g.lineStyle(2, 0x2b2b2b, 1)
          g.lineBetween(weaponX, weaponY, weaponX + dirOffset[dir].x * 2, weaponY - 2)
          break
        case 'engineer':
          g.fillStyle(0xffd34d, 1)
          g.fillEllipse(headX, headY - 1, 8, 4)
          g.lineStyle(2, 0xb9c1c8, 1)
          g.lineBetween(weaponX, weaponY, weaponX + 2, weaponY + 3)
          break
        case 'rocketeer':
          g.fillStyle(0x5f6470, 1)
          g.fillRect(torsoX - 2, torsoY + 1, 4, 7)
          g.fillRect(torsoX + 8, torsoY + 1, 4, 7)
          g.fillStyle(0xff9b3b, 1)
          g.fillTriangle(torsoX - 1, torsoY + 8, torsoX + 1, torsoY + 12, torsoX + 3, torsoY + 8)
          g.fillTriangle(torsoX + 9, torsoY + 8, torsoX + 11, torsoY + 12, torsoX + 13, torsoY + 8)
          break
        case 'tesla_trooper':
          g.fillStyle(this.lighten(color, 6), 1)
          g.fillEllipse(torsoX + 4, torsoY + 4, 12, 10)
          g.lineStyle(1, 0x67e2ff, 0.9)
          g.lineBetween(weaponX, weaponY, weaponX + 4, weaponY - 3)
          g.lineBetween(weaponX + 4, weaponY - 3, weaponX + 2, weaponY - 5)
          break
        case 'sniper':
          g.fillStyle(color, 1)
          g.fillEllipse(10 + dirOffset[dir].x, 14 + dirOffset[dir].y, 14, 5)
          g.lineStyle(2, 0x2f2f2f, 1)
          g.lineBetween(weaponX, weaponY + 3, weaponX + dirOffset[dir].x * 3, weaponY + 1)
          break
        case 'tanya':
          g.lineStyle(2, 0x2f2f2f, 1)
          g.lineBetween(weaponX - 3, weaponY + 2, weaponX - 1, weaponY + 1)
          g.lineBetween(weaponX + 1, weaponY + 2, weaponX + 3, weaponY + 1)
          break
        case 'spy':
          g.fillStyle(0x202020, 1)
          g.fillEllipse(headX, headY - 2, 10, 3)
          g.fillRect(headX - 3, headY - 5, 6, 3)
          break
        case 'crazy_ivan':
          g.fillStyle(0x2a2a2a, 1)
          g.fillCircle(weaponX + 2, weaponY + 2, 2)
          g.lineStyle(1, 0xff9a55, 1)
          g.lineBetween(weaponX + 2, weaponY - 1, weaponX + 2, weaponY + 1)
          break
        case 'yuri':
          g.lineStyle(1, accent, 0.7)
          g.strokeEllipse(headX, headY - 1, 12, 6)
          g.strokeEllipse(headX, headY - 1, 16, 8)
          break
        case 'chrono_legionnaire':
          g.lineStyle(1, accent, 0.8)
          g.strokeEllipse(headX, headY + 3, 14, 12)
          break
        case 'desolator':
          g.fillStyle(0x9dff6f, 0.5)
          g.fillEllipse(weaponX + 1, weaponY + 3, 4, 2)
          break
        case 'terrorist':
          g.fillStyle(0x202020, 1)
          g.fillCircle(weaponX + 1, weaponY + 2, 2)
          g.fillStyle(0xff5533, 1)
          g.fillRect(weaponX + 1, weaponY - 1, 1, 2)
          break
      }

      g.lineStyle(1, 0x000000, 0.35)
      g.strokeRect(0, 0, w, h)
      g.generateTexture(`${key}_iso_${dir}`, w, h)
      if (dir === 'se') {
        g.generateTexture(key, w, h)
      }
      g.destroy()
    }
  }

  private genVehicle(key: string, color: number, accent: number, kind: VehicleKind, w: number, h: number) {
    const dirs = ['ne', 'se', 'sw', 'nw'] as const
    const barrelDir: Record<(typeof dirs)[number], { x: number; y: number }> = {
      ne: { x: 11, y: -5 },
      se: { x: 9, y: 2 },
      sw: { x: -9, y: 2 },
      nw: { x: -11, y: -5 },
    }

    for (const dir of dirs) {
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      const dark = this.darken(color, 18)
      const top = this.lighten(color, 8)
      const cx = Math.floor(w / 2)
      const cy = Math.floor(h / 2)

      if (kind === 'terror_drone') {
        g.fillStyle(0x000000, 0.25)
        g.fillEllipse(cx, cy + 6, 14, 5)
        g.fillStyle(color, 1)
        g.fillEllipse(cx, cy, 10, 8)
        g.fillStyle(accent, 1)
        g.fillCircle(cx, cy, 2)
        g.lineStyle(2, dark, 1)
        g.lineBetween(cx - 4, cy + 1, cx - 9, cy + 6)
        g.lineBetween(cx + 4, cy + 1, cx + 9, cy + 6)
        g.lineBetween(cx - 4, cy - 1, cx - 9, cy - 6)
        g.lineBetween(cx + 4, cy - 1, cx + 9, cy - 6)
      } else if (kind === 'conquistador_mech' || kind === 'mecha_walker') {
        g.fillStyle(0x000000, 0.25)
        g.fillEllipse(cx, cy + 7, 18, 6)
        g.fillStyle(color, 1)
        g.fillEllipse(cx, cy - 1, 12, 9)
        g.fillStyle(dark, 1)
        g.fillRect(cx - 6, cy + 2, 4, 7)
        g.fillRect(cx + 2, cy + 2, 4, 7)
        g.lineStyle(2, accent, 1)
        g.lineBetween(cx + 3, cy, cx + 10, cy - 3)
      } else {
        g.fillStyle(0x2b2b2b, 0.9)
        g.fillRect(2, h - 5, w - 4, 3)
        g.fillRect(2, 2, w - 4, 3)
        g.fillStyle(top, 1)
        g.beginPath()
        g.moveTo(cx, 4)
        g.lineTo(w - 4, cy - 1)
        g.lineTo(cx, h - 7)
        g.lineTo(4, cy - 1)
        g.closePath()
        g.fillPath()
        g.fillStyle(color, 1)
        g.fillRect(4, cy - 1, cx - 4, h - cy - 6)
        g.fillStyle(dark, 1)
        g.fillRect(cx, cy - 1, cx - 4, h - cy - 6)

        if (kind === 'war_miner' || kind === 'chrono_miner') {
          g.fillStyle(accent, 1)
          g.fillRect(w - 9, cy + 1, 6, 5)
          g.lineStyle(2, this.darken(accent, 20), 1)
          g.lineBetween(w - 9, cy + 6, w - 2, cy + 9)
          if (kind === 'chrono_miner') {
            g.lineStyle(1, 0x81ecff, 1)
            g.strokeEllipse(cx - 5, cy + 1, 9, 6)
          }
        } else if (kind === 'v3_launcher' || kind === 'brahmos_battery') {
          g.fillStyle(accent, 1)
          g.fillRect(cx - 5, 3, 3, 9)
          g.fillTriangle(cx - 5, 3, cx - 2, 3, cx - 4, 1)
          if (kind === 'brahmos_battery') {
            g.fillRect(cx, 4, 3, 8)
            g.fillTriangle(cx, 4, cx + 3, 4, cx + 1, 2)
          }
        } else if (kind === 'ifv') {
          g.fillStyle(accent, 1)
          g.fillRect(cx - 5, 3, 10, 3)
        } else if (kind === 'flak_track') {
          g.lineStyle(2, 0xb0b0b0, 1)
          g.lineBetween(cx - 4, 6, cx - 2, 2)
          g.lineBetween(cx + 2, 6, cx + 4, 2)
        } else if (kind === 'mcv') {
          g.fillStyle(this.lighten(color, 14), 1)
          g.fillRect(cx - 10, 6, 6, 5)
          g.fillRect(cx + 4, 6, 6, 5)
        } else if (kind === 'demo_truck') {
          g.fillStyle(0xff4422, 1)
          g.fillRect(cx - 6, cy - 1, 10, 4)
        } else {
          g.fillStyle(this.lighten(color, 12), 1)
          g.fillCircle(cx, cy - 1, kind === 'apocalypse_tank' ? 5 : 4)
          g.lineStyle(2, kind === 'tesla_tank' ? 0x67e2ff : 0xcfd4d8, 1)
          g.lineBetween(cx, cy - 1, cx + barrelDir[dir].x, cy + barrelDir[dir].y)
          if (kind === 'apocalypse_tank') {
            g.lineBetween(cx - 2, cy, cx - 2 + barrelDir[dir].x, cy + barrelDir[dir].y + 2)
          }
          if (kind === 'prism_tank') {
            g.fillStyle(accent, 1)
            g.fillTriangle(cx, cy - 8, cx - 3, cy - 2, cx + 3, cy - 2)
          }
          if (kind === 'dragon_tank') {
            g.fillStyle(0xff8f42, 0.8)
            g.fillTriangle(cx + barrelDir[dir].x, cy + barrelDir[dir].y, cx + barrelDir[dir].x + 4, cy + barrelDir[dir].y - 1, cx + barrelDir[dir].x + 1, cy + barrelDir[dir].y + 3)
          }
          if (kind === 'mirage_tank') {
            g.fillStyle(accent, 0.35)
            g.fillEllipse(cx, cy - 2, 14, 8)
          }
        }
      }

      g.lineStyle(1, 0x000000, 0.4)
      g.strokeRect(0, 0, w, h)
      g.generateTexture(`${key}_iso_${dir}`, w, h)
      if (dir === 'se') {
        g.generateTexture(key, w, h)
      }
      g.destroy()
    }
  }

  private genAircraft(key: string, color: number, accent: number, kind: AircraftKind) {
    const w = 28
    const h = 20
    const dirs = ['ne', 'se', 'sw', 'nw'] as const
    const noseDir: Record<(typeof dirs)[number], { x: number; y: number }> = {
      ne: { x: 7, y: -4 },
      se: { x: 7, y: 3 },
      sw: { x: -7, y: 3 },
      nw: { x: -7, y: -4 },
    }

    for (const dir of dirs) {
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      const cx = Math.floor(w / 2)
      const cy = Math.floor(h / 2)

      g.fillStyle(0x000000, 0.2)
      g.fillEllipse(cx, cy + 6, 14, 4)

      switch (kind) {
        case 'harrier':
        case 'black_eagle':
          g.fillStyle(color, 1)
          g.fillTriangle(cx, cy - 5, cx - 10, cy + 4, cx + 10, cy + 4)
          g.fillRect(cx - 2, cy - 3, 4, 8)
          g.fillStyle(accent, 1)
          g.fillTriangle(cx + noseDir[dir].x, cy + noseDir[dir].y, cx + noseDir[dir].x - 2, cy + noseDir[dir].y + 2, cx + noseDir[dir].x + 2, cy + noseDir[dir].y + 2)
          if (kind === 'black_eagle') {
            g.fillStyle(0x1f1f1f, 1)
            g.fillRect(cx - 7, cy + 2, 4, 2)
          }
          break
        case 'nighthawk':
          g.fillStyle(color, 1)
          g.fillEllipse(cx, cy + 1, 16, 9)
          g.fillRect(cx - 6, cy - 1, 12, 4)
          g.lineStyle(2, accent, 1)
          g.lineBetween(cx - 12, cy - 3, cx + 12, cy - 3)
          g.lineBetween(cx, cy - 2, cx, cy - 8)
          break
        case 'rocketeer':
          g.fillStyle(accent, 1)
          g.fillCircle(cx, cy - 4, 2)
          g.fillStyle(color, 1)
          g.fillRect(cx - 2, cy - 2, 4, 8)
          g.fillStyle(this.darken(color, 20), 1)
          g.fillRect(cx - 5, cy - 1, 2, 6)
          g.fillRect(cx + 3, cy - 1, 2, 6)
          g.fillStyle(0xffaa44, 1)
          g.fillTriangle(cx - 5, cy + 5, cx - 3, cy + 9, cx - 1, cy + 5)
          g.fillTriangle(cx + 1, cy + 5, cx + 3, cy + 9, cx + 5, cy + 5)
          break
        case 'recon_drone':
          g.fillStyle(color, 1)
          g.fillRect(cx - 4, cy - 1, 8, 4)
          g.lineStyle(1.5, this.darken(color, 20), 1)
          g.lineBetween(cx - 9, cy + 1, cx - 4, cy + 1)
          g.lineBetween(cx + 4, cy + 1, cx + 9, cy + 1)
          g.fillStyle(accent, 1)
          g.fillCircle(cx, cy + 1, 1)
          break
        case 'kirov':
          g.fillStyle(color, 1)
          g.fillEllipse(cx, cy, 22, 12)
          g.fillStyle(this.lighten(color, 8), 1)
          g.fillEllipse(cx - 1, cy - 1, 15, 8)
          g.fillStyle(this.darken(color, 20), 1)
          g.fillRect(cx - 4, cy + 4, 8, 4)
          g.fillStyle(accent, 1)
          g.fillRect(cx + 7, cy - 1, 4, 2)
          break
      }

      g.lineStyle(1, 0x000000, 0.35)
      g.strokeRect(0, 0, w, h)
      g.generateTexture(`${key}_iso_${dir}`, w, h)
      if (dir === 'se') {
        g.generateTexture(key, w, h)
      }
      g.destroy()
    }
  }

  private genNaval(key: string, color: number, accent: number, kind: NavalKind) {
    const w = 28
    const h = 18
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    if (kind !== 'giant_squid') {
      g.fillStyle(0x1d3852, 0.9)
      g.fillRect(0, h - 3, w, 3)
    }

    switch (kind) {
      case 'destroyer':
      case 'aegis_cruiser':
      case 'aircraft_carrier':
      case 'dreadnought':
        g.fillStyle(color, 1)
        g.fillTriangle(2, h - 4, w - 3, h - 4, w - 1, h - 8)
        g.fillRect(2, h - 10, w - 8, 6)
        g.fillStyle(this.lighten(color, 8), 1)
        g.fillRect(8, h - 12, 8, 4)
        if (kind === 'aegis_cruiser') {
          g.fillStyle(accent, 1)
          g.fillRect(6, h - 13, 2, 3)
          g.fillRect(18, h - 13, 2, 3)
        }
        if (kind === 'aircraft_carrier') {
          g.fillStyle(0xf1f1f1, 1)
          g.fillRect(6, h - 8, 14, 1)
        }
        if (kind === 'dreadnought') {
          g.lineStyle(2, accent, 1)
          g.lineBetween(14, h - 10, w - 1, h - 12)
          g.lineBetween(12, h - 8, w - 1, h - 9)
        }
        break
      case 'typhoon_sub':
        g.fillStyle(color, 1)
        g.fillEllipse(13, h - 8, 20, 8)
        g.fillRect(10, h - 13, 6, 3)
        g.fillStyle(accent, 1)
        g.fillRect(16, h - 13, 2, 2)
        break
      case 'giant_squid':
        g.fillStyle(color, 1)
        g.fillEllipse(12, 8, 12, 10)
        g.lineStyle(2, accent, 1)
        g.lineBetween(7, 12, 4, 17)
        g.lineBetween(10, 13, 9, 17)
        g.lineBetween(13, 13, 14, 17)
        g.lineBetween(16, 12, 19, 17)
        break
    }

    g.lineStyle(1, 0x000000, 0.45)
    g.strokeRect(0, 0, w, h)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private genBuilding(key: string, color: number, kind: BuildingKind, w: number, h: number) {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const roof = this.lighten(color, 8)
    const shadow = this.darken(color, 18)

    g.fillStyle(0x000000, 0.25)
    g.fillRect(2, h - 6, w - 2, 6)
    g.fillStyle(color, 1)
    g.fillRect(0, 2, w, h - 6)
    g.fillStyle(roof, 1)
    g.fillRect(2, 4, w - 4, Math.max(8, Math.floor(h * 0.22)))

    switch (kind) {
      case 'construction_yard':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.45), w - 16, Math.floor(h * 0.35))
        g.fillRect(Math.floor(w * 0.58), 10, 6, Math.floor(h * 0.55))
        g.lineStyle(3, 0xffc94d, 1)
        g.lineBetween(Math.floor(w * 0.58), 14, Math.floor(w * 0.86), 14)
        g.lineBetween(Math.floor(w * 0.86), 14, Math.floor(w * 0.86), Math.floor(h * 0.42))
        break
      case 'power_plant':
      case 'tesla_reactor':
      case 'nuclear_reactor':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.42), Math.floor(w * 0.35), Math.floor(h * 0.4))
        g.fillRect(Math.floor(w * 0.52), Math.floor(h * 0.32), Math.floor(w * 0.32), Math.floor(h * 0.5))
        if (kind === 'tesla_reactor') {
          g.lineStyle(2, 0x67e2ff, 1)
          g.lineBetween(Math.floor(w * 0.68), Math.floor(h * 0.18), Math.floor(w * 0.68), Math.floor(h * 0.34))
          g.lineBetween(Math.floor(w * 0.63), Math.floor(h * 0.2), Math.floor(w * 0.73), Math.floor(h * 0.2))
        }
        if (kind === 'nuclear_reactor') {
          g.fillStyle(this.lighten(color, 18), 1)
          g.fillEllipse(Math.floor(w * 0.32), Math.floor(h * 0.3), Math.floor(w * 0.22), Math.floor(h * 0.2))
          g.fillEllipse(Math.floor(w * 0.65), Math.floor(h * 0.24), Math.floor(w * 0.26), Math.floor(h * 0.24))
        }
        break
      case 'barracks':
        g.fillStyle(shadow, 1)
        g.fillRect(6, Math.floor(h * 0.45), w - 12, Math.floor(h * 0.34))
        g.lineStyle(2, 0xc94242, 1)
        g.lineBetween(Math.floor(w * 0.2), 10, Math.floor(w * 0.2), Math.floor(h * 0.42))
        g.fillStyle(0xc94242, 1)
        g.fillTriangle(Math.floor(w * 0.2), 10, Math.floor(w * 0.32), 14, Math.floor(w * 0.2), 18)
        break
      case 'war_factory':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.3), w - 16, Math.floor(h * 0.52))
        g.fillStyle(0x252a32, 1)
        g.fillRect(Math.floor(w * 0.2), Math.floor(h * 0.56), Math.floor(w * 0.45), Math.floor(h * 0.18))
        g.fillStyle(this.lighten(color, 16), 1)
        g.fillRect(Math.floor(w * 0.68), Math.floor(h * 0.24), Math.floor(w * 0.16), Math.floor(h * 0.22))
        break
      case 'airfield':
        g.fillStyle(shadow, 1)
        g.fillRect(4, Math.floor(h * 0.52), w - 8, Math.floor(h * 0.2))
        g.lineStyle(1, 0xe2e2e2, 1)
        g.lineBetween(8, Math.floor(h * 0.62), w - 8, Math.floor(h * 0.62))
        g.lineBetween(8, Math.floor(h * 0.58), 14, Math.floor(h * 0.58))
        g.fillStyle(this.lighten(color, 16), 1)
        g.fillRect(Math.floor(w * 0.72), Math.floor(h * 0.28), Math.floor(w * 0.2), Math.floor(h * 0.2))
        break
      case 'naval_yard':
        g.fillStyle(0x234864, 1)
        g.fillRect(0, Math.floor(h * 0.62), w, Math.floor(h * 0.3))
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.34), Math.floor(w * 0.55), Math.floor(h * 0.24))
        g.lineStyle(2, 0xffcc66, 1)
        g.lineBetween(Math.floor(w * 0.7), 10, Math.floor(w * 0.9), 10)
        g.lineBetween(Math.floor(w * 0.9), 10, Math.floor(w * 0.9), Math.floor(h * 0.45))
        break
      case 'ore_refinery':
      case 'ore_purifier':
        g.fillStyle(shadow, 1)
        g.fillRect(6, Math.floor(h * 0.4), Math.floor(w * 0.58), Math.floor(h * 0.38))
        g.fillStyle(0xd8ad2f, 1)
        g.fillTriangle(Math.floor(w * 0.7), Math.floor(h * 0.74), Math.floor(w * 0.84), Math.floor(h * 0.45), Math.floor(w * 0.95), Math.floor(h * 0.74))
        if (kind === 'ore_purifier') {
          g.fillStyle(0x92ca62, 1)
          g.fillRect(Math.floor(w * 0.72), Math.floor(h * 0.26), Math.floor(w * 0.16), Math.floor(h * 0.1))
        }
        break
      case 'service_depot':
        g.fillStyle(shadow, 1)
        g.fillRect(6, Math.floor(h * 0.35), w - 12, Math.floor(h * 0.44))
        g.fillStyle(0x202831, 1)
        g.fillRect(Math.floor(w * 0.2), Math.floor(h * 0.57), Math.floor(w * 0.6), Math.floor(h * 0.18))
        g.lineStyle(2, 0xd2d8df, 1)
        g.lineBetween(Math.floor(w * 0.45), Math.floor(h * 0.33), Math.floor(w * 0.55), Math.floor(h * 0.33))
        g.lineBetween(Math.floor(w * 0.5), Math.floor(h * 0.28), Math.floor(w * 0.5), Math.floor(h * 0.38))
        break
      case 'tech_center':
      case 'spy_satellite':
      case 'radar_tower':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.42), w - 16, Math.floor(h * 0.36))
        g.lineStyle(2, 0x9be0ff, 1)
        g.lineBetween(Math.floor(w * 0.64), Math.floor(h * 0.2), Math.floor(w * 0.64), Math.floor(h * 0.45))
        g.strokeEllipse(Math.floor(w * 0.64), Math.floor(h * 0.2), Math.floor(w * 0.22), Math.floor(h * 0.1))
        if (kind === 'spy_satellite') {
          g.lineStyle(1, 0x9be0ff, 0.85)
          g.strokeEllipse(Math.floor(w * 0.64), Math.floor(h * 0.2), Math.floor(w * 0.36), Math.floor(h * 0.2))
        }
        break
      case 'wall':
        g.fillStyle(shadow, 1)
        g.fillRect(2, 14, w - 4, 10)
        g.fillStyle(this.lighten(color, 12), 1)
        g.fillRect(4, 12, 6, 4)
        g.fillRect(13, 12, 6, 4)
        g.fillRect(22, 12, 6, 4)
        break
      case 'turret':
      case 'aa_gun':
      case 'prism_tower':
      case 'tesla_coil':
      case 'grand_cannon':
        g.fillStyle(shadow, 1)
        g.fillRect(4, 16, w - 8, 10)
        g.fillStyle(this.lighten(color, 10), 1)
        g.fillCircle(Math.floor(w * 0.5), 14, kind === 'grand_cannon' ? 7 : 6)
        if (kind === 'aa_gun') {
          g.lineStyle(2, 0xb0b0b0, 1)
          g.lineBetween(Math.floor(w * 0.5) - 2, 12, Math.floor(w * 0.5) - 5, 4)
          g.lineBetween(Math.floor(w * 0.5) + 2, 12, Math.floor(w * 0.5) + 5, 4)
        } else if (kind === 'tesla_coil') {
          g.lineStyle(2, 0x67e2ff, 1)
          g.lineBetween(Math.floor(w * 0.5), 11, Math.floor(w * 0.5), 3)
          g.lineBetween(Math.floor(w * 0.5) - 4, 5, Math.floor(w * 0.5) + 4, 5)
        } else if (kind === 'prism_tower') {
          g.fillStyle(0x9fffff, 1)
          g.fillTriangle(Math.floor(w * 0.5), 2, Math.floor(w * 0.5) - 4, 8, Math.floor(w * 0.5) + 4, 8)
        } else {
          g.lineStyle(2, 0xdddddd, 1)
          g.lineBetween(Math.floor(w * 0.5), 13, Math.floor(w * 0.5), 4)
        }
        break
      case 'gap_generator':
      case 'psychic_sensor':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.44), w - 16, Math.floor(h * 0.3))
        g.lineStyle(2, kind === 'psychic_sensor' ? 0xe483ff : 0x9fe4ff, 1)
        g.strokeCircle(Math.floor(w * 0.52), Math.floor(h * 0.36), Math.floor(w * 0.15))
        g.strokeCircle(Math.floor(w * 0.52), Math.floor(h * 0.36), Math.floor(w * 0.24))
        break
      case 'superweapon':
      case 'chronosphere':
      case 'iron_curtain':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.4), w - 16, Math.floor(h * 0.42))
        g.lineStyle(2, kind === 'chronosphere' ? 0x81ecff : kind === 'iron_curtain' ? 0xff6a6a : 0xffcc66, 1)
        g.strokeCircle(Math.floor(w * 0.5), Math.floor(h * 0.35), Math.floor(w * 0.18))
        g.strokeCircle(Math.floor(w * 0.5), Math.floor(h * 0.35), Math.floor(w * 0.1))
        if (kind === 'superweapon') {
          g.lineBetween(Math.floor(w * 0.5), Math.floor(h * 0.17), Math.floor(w * 0.62), Math.floor(h * 0.05))
        }
        break
      case 'cloning_vats':
        g.fillStyle(shadow, 1)
        g.fillRect(8, Math.floor(h * 0.36), w - 16, Math.floor(h * 0.42))
        g.fillStyle(0x82e0cf, 0.6)
        g.fillRect(Math.floor(w * 0.18), Math.floor(h * 0.42), Math.floor(w * 0.18), Math.floor(h * 0.24))
        g.fillRect(Math.floor(w * 0.42), Math.floor(h * 0.42), Math.floor(w * 0.18), Math.floor(h * 0.24))
        g.fillRect(Math.floor(w * 0.66), Math.floor(h * 0.42), Math.floor(w * 0.16), Math.floor(h * 0.24))
        break
    }

    const rowY = Math.floor(h * 0.52)
    const gap = 8
    g.fillStyle(0xd6dfef, 0.5)
    for (let x = 10; x < w - 10; x += gap) {
      g.fillRect(x, rowY, 2, 2)
      if (h > 48) g.fillRect(x + 1, rowY + 8, 2, 2)
    }

    g.lineStyle(2, 0x000000, 0.7)
    g.strokeRect(1, 1, w - 2, h - 2)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private genProjectile(key: string, color: number, w: number, h: number) {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillRect(0, 0, w, h)
    g.generateTexture(key, w, h)
    g.destroy()
  }

  private genExplosion() {
    const frames = [
      { key: 'explosion_0', r: 8, color: 0xff8800 },
      { key: 'explosion_1', r: 16, color: 0xff4400 },
      { key: 'explosion_2', r: 12, color: 0xff2200 },
    ]
    for (const f of frames) {
      const size = f.r * 2 + 2
      const g = this.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(f.color, 1)
      g.fillCircle(f.r + 1, f.r + 1, f.r)
      g.fillStyle(0xffff88, 0.6)
      g.fillCircle(f.r + 1, f.r + 1, Math.floor(f.r * 0.5))
      g.generateTexture(f.key, size, size)
      g.destroy()
    }
  }

  private genSelectionCircle() {
    const size = 32
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.lineStyle(2, 0x00ff00, 0.9)
    g.strokeEllipse(size / 2, size / 2, size - 4, (size - 4) * 0.4)
    g.generateTexture('selection_circle', size, size)
    g.destroy()
  }

  private genGhostTile(key: string, color: number, alpha: number) {
    const size = 64
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, alpha)
    g.fillRect(0, 0, size, size)
    g.lineStyle(2, color, 0.85)
    g.strokeRect(0, 0, size, size)
    g.lineStyle(1, color, 0.25)
    g.lineBetween(32, 0, 32, 64)
    g.lineBetween(0, 32, 64, 32)
    g.generateTexture(key, size, size)
    g.destroy()
  }

  private genCursorIcon(key: string, color: number) {
    const size = 16
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(color, 1)
    g.fillCircle(size / 2, size / 2, size / 2 - 1)
    g.fillStyle(0x000000, 0.5)
    g.fillRect(size / 2 - 2, 2, 4, size - 4)
    g.generateTexture(key, size, size)
    g.destroy()
  }

  private genAttackMoveCursor() {
    const size = 24
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const cx = size / 2
    const cy = size / 2
    const r = size / 2 - 2
    g.lineStyle(2, 0xff4444, 1)
    g.strokeCircle(cx, cy, r)
    g.lineBetween(cx - r - 2, cy, cx + r + 2, cy)
    g.lineBetween(cx, cy - r - 2, cx, cy + r + 2)
    g.fillStyle(0xff4444, 1)
    g.fillCircle(cx, cy, 2)
    g.generateTexture('cursor_attack_move', size, size)
    g.destroy()
  }

  private genAlertPanel() {
    const w = 240
    const h = 28
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    g.fillStyle(0x0a0a1a, 0.92)
    g.fillRect(0, 0, w, h)
    g.lineStyle(1, 0x4466aa, 0.7)
    g.strokeRect(0, 0, w, h)
    g.generateTexture('eva_alert_panel', w, h)
    g.destroy()
  }

  private genVetChevron(key: string, rank: number) {
    const w = 12 * rank + 2
    const h = 8
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    const col = rank === 2 ? 0xffdd44 : 0x88bbff
    g.lineStyle(2, col, 1)
    for (let r = 0; r < rank; r++) {
      const ox = r * 12 + 1
      g.beginPath()
      g.moveTo(ox, h - 1)
      g.lineTo(ox + 5, 1)
      g.lineTo(ox + 10, h - 1)
      g.strokePath()
    }
    g.generateTexture(key, Math.max(1, w), Math.max(1, h))
    g.destroy()
  }
}
