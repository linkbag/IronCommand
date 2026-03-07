// ============================================================
// IRON COMMAND — Combat System
// Damage calculation, projectiles, splash damage, explosions
// ============================================================

import Phaser from 'phaser'
import { Unit } from '../entities/Unit'
import { Building } from '../entities/Building'
import type { EntityManager } from '../entities/EntityManager'
import type { AttackStats } from '../types'
import { DamageType } from '../types'
import { TILE_SIZE } from '../types'
import { cartToScreen } from '../engine/IsoUtils'

// Type multipliers: who's strong against what
// RA2-authentic type multipliers — balanced for realistic counter-play:
// Bullets: shred infantry, weak vs armor. Explosive: anti-structure/vehicle.
// Missile: all-rounder AA/AT. Fire: anti-infantry/structure. Electric: anti-vehicle/naval.
const TYPE_MULTIPLIERS: Record<DamageType, Record<string, number>> = {
  [DamageType.BULLET]: {
    infantry: 1.75,
    vehicle: 0.3,
    aircraft: 0.5,
    naval: 0.3,
    harvester: 0.5,
    base: 0.15,
    power: 0.15,
    production: 0.15,
    defense: 0.3,
    tech: 0.15,
    superweapon: 0.1,
  },
  [DamageType.EXPLOSIVE]: {
    infantry: 0.6,
    vehicle: 1.5,
    aircraft: 0.2,
    naval: 1.2,
    harvester: 1.2,
    base: 1.8,
    power: 1.8,
    production: 1.7,
    defense: 1.4,
    tech: 1.6,
    superweapon: 1.5,
  },
  [DamageType.MISSILE]: {
    infantry: 0.5,
    vehicle: 1.6,
    aircraft: 2.0,
    naval: 1.4,
    harvester: 1.3,
    base: 1.0,
    power: 1.0,
    production: 1.0,
    defense: 0.8,
    tech: 1.0,
    superweapon: 0.8,
  },
  [DamageType.FIRE]: {
    infantry: 2.0,
    vehicle: 0.6,
    aircraft: 0.1,
    naval: 0.4,
    harvester: 0.8,
    base: 1.5,
    power: 1.5,
    production: 1.4,
    defense: 0.7,
    tech: 1.4,
    superweapon: 1.0,
  },
  [DamageType.ELECTRIC]: {
    infantry: 1.3,
    vehicle: 1.4,
    aircraft: 0.6,
    naval: 1.8,
    harvester: 1.3,
    base: 1.0,
    power: 2.5,
    production: 1.0,
    defense: 1.3,
    tech: 1.6,
    superweapon: 1.0,
  },
}

interface Projectile {
  graphic: Phaser.GameObjects.Graphics
  fromX: number
  fromY: number
  toX: number
  toY: number
  progress: number
  speed: number   // pixels per second
  attack: AttackStats
  sourcePlayerId: number
  onHit: () => void
}

interface TimedBomb {
  target: Unit | Building
  sourceUnitId: string
  sourcePlayerId: number
  attack: AttackStats
  vetMult: number
  marker: Phaser.GameObjects.Graphics
  pulseTween: Phaser.Tweens.Tween
  fuse: Phaser.Time.TimerEvent
}

interface RadiationZone {
  x: number
  y: number
  radiusPixels: number
  sourcePlayerId: number
  expiresAt: number
  nextTickAt: number
  graphic: Phaser.GameObjects.Graphics
}

export class Combat extends Phaser.Events.EventEmitter {
  private scene: Phaser.Scene
  private em: EntityManager
  private projectiles: Projectile[]
  private timedBombs: Map<string, TimedBomb>
  private radiationZones: RadiationZone[]
  private chronoEraseProgress: Map<string, number> = new Map()

  constructor(scene: Phaser.Scene, entityManager: EntityManager) {
    super()
    this.scene = scene
    this.em = entityManager
    this.projectiles = []
    this.timedBombs = new Map()
    this.radiationZones = []

    this.wireEntityManager()
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Calculate final damage from attacker hitting target.
   * Formula: baseDamage * (1 - targetArmor) * typeMultiplier
   */
  calculateDamage(
    attack: AttackStats,
    targetCategory: string,
    targetArmor: number,
  ): number {
    const mult = TYPE_MULTIPLIERS[attack.damageType]?.[targetCategory] ?? 1
    return Math.ceil(attack.damage * (1 - targetArmor) * mult)
  }

  /**
   * Resolve an attack from attacker to target.
   * Spawns projectile if needed, otherwise applies damage directly.
   * Handles special unit types (attack dogs, engineers, etc.)
   */
  resolveAttack(attacker: Unit | Building, target: Unit | Building): void {
    if (!attacker.def.attack) return
    if (!this.canAttackTarget(attacker.def.attack, target)) return

    const attack = attacker.def.attack
    const targetCategory = this.getTargetCategory(target)
    const targetIsAir = targetCategory === 'aircraft'
    const targetIsGround = !targetIsAir
    if ((targetIsAir && !attack.canAttackAir) || (targetIsGround && !attack.canAttackGround)) {
      return
    }

    // ── Special unit handling ──
    if (attacker instanceof Unit) {
      // Attack dogs: instant-kill vs infantry, 0 damage vs everything else
      if (attacker.def.id === 'attack_dog') {
        if (target instanceof Unit && target.def.category === 'infantry') {
          target.takeDamage(target.hp + 100, attacker.playerId) // instant kill
          attacker.recordKill()
          console.log('[AttackDog] Infantry kill', { attackerId: attacker.id, targetId: target.id })
          return
        }
        return // dogs can't damage vehicles/buildings
      }

      // Engineers: capture enemy buildings instead of damaging
      if (attacker.def.id === 'engineer' && target instanceof Building && target.playerId !== attacker.playerId) {
        // Capture: switch building ownership and sacrifice engineer
        this.em.emit('engineer_capture', {
          engineerId: attacker.id,
          buildingId: target.id,
          newPlayerId: attacker.playerId,
        })
        console.log('[Engineer] Capture triggered', { engineerId: attacker.id, buildingId: target.id })
        return
      }

      // Tanya: pistols for infantry/units, C4 burst vs buildings
      if (attacker.def.id === 'tanya' && target instanceof Building) {
        const c4Damage = Math.max(400, Math.ceil(target.def.stats.maxHp * 0.6))
        target.takeDamage(c4Damage, attacker.playerId)
        if (target.hp <= 0) attacker.recordKill()
        console.log('[Tanya] C4 planted', {
          attackerId: attacker.id,
          targetId: target.id,
          damage: c4Damage,
        })
        this.createExplosion(target.x, target.y, 'large')
        return
      }

      // Chrono Legionnaire: slow, guaranteed erase if beam maintained over time
      if (attacker.def.id === 'chrono_legionnaire') {
        const prev = this.chronoEraseProgress.get(target.id) ?? 0
        const next = prev + 25
        this.chronoEraseProgress.set(target.id, next)
        console.log('[ChronoLegionnaire] Erase progress', {
          attackerId: attacker.id,
          targetId: target.id,
          progress: next,
        })
        if (next >= 100) {
          target.takeDamage(target.hp + 1, attacker.playerId)
          attacker.recordKill()
          this.chronoEraseProgress.delete(target.id)
          console.log('[ChronoLegionnaire] Target erased', { attackerId: attacker.id, targetId: target.id })
        }
        return
      }

      // Yuri: mind control — seize one enemy unit (not buildings, not dogs)
      if (attacker.def.id === 'yuri' && target instanceof Unit && target.playerId !== attacker.playerId) {
        // Attack dogs are immune to mind control
        if (target.def.id === 'attack_dog') {
          console.log('[Yuri] Cannot mind-control attack dog', { yuriId: attacker.id, targetId: target.id })
          return
        }
        // Cannot mind-control other Yuris
        if (target.def.id === 'yuri') {
          console.log('[Yuri] Cannot mind-control another Yuri', { yuriId: attacker.id, targetId: target.id })
          return
        }
        this.em.emit('yuri_mind_control', {
          yuriId: attacker.id,
          yuriPlayerId: attacker.playerId,
          targetId: target.id,
        })
        console.log('[Yuri] Mind control', { yuriId: attacker.id, targetId: target.id })
        return
      }

      // Tanya: instant-kill infantry with dual pistols
      if (attacker.def.id === 'tanya' && target instanceof Unit && target.def.category === 'infantry') {
        target.takeDamage(target.hp + 100, attacker.playerId)
        attacker.recordKill()
        console.log('[Tanya] Infantry kill', { attackerId: attacker.id, targetId: target.id })
        return
      }

      // Sniper: one-shot kills infantry, cannot attack vehicles
      if (attacker.def.id === 'sniper') {
        if (target instanceof Unit && target.def.category === 'infantry') {
          target.takeDamage(target.hp + 100, attacker.playerId)
          attacker.recordKill()
          console.log('[Sniper] Infantry kill', { attackerId: attacker.id, targetId: target.id })
          return
        }
        return // snipers can't effectively damage vehicles/buildings
      }
    }

    // RA2 Veterancy: damage multiplier for units
    const vetMult = (attacker instanceof Unit) ? attacker.getVeterancyDamageMultiplier() : 1.0

    // Crazy Ivan: plants timed explosives instead of immediate damage.
    if (attacker instanceof Unit && attacker.def.id === 'crazy_ivan') {
      this.placeTimedBomb(attacker, target, attack, vetMult)
      return
    }

    // Suicide units: range-0 attacks explode on contact, apply AoE, and die.
    if (attacker instanceof Unit && attack.range === 0) {
      const center = { x: target.x, y: target.y }
      const scaledDamage = Math.ceil(attack.damage * vetMult)
      this.dealSplashDamage(
        center,
        attack.splash * TILE_SIZE,
        scaledDamage,
        attack.damageType,
        attacker.playerId,
      )
      this.createExplosion(center.x, center.y, this.getBlastSizeFromSplash(attack.splash))
      attacker.takeDamage(attacker.hp + scaledDamage, attacker.playerId)
      return
    }

    if (attack.projectileSpeed <= 0) {
      // Hitscan — instant damage
      const baseDmg = this.calculateDamage(
        attack,
        targetCategory,
        target.def.stats.armor,
      )
      let dmg = Math.ceil(baseDmg * vetMult)
      if (attacker instanceof Unit && attacker.def.id === 'tank_destroyer') {
        if (['vehicle', 'harvester', 'naval'].includes(targetCategory)) {
          dmg = Math.ceil(dmg * 1.25)
        } else if (targetCategory === 'infantry') {
          dmg = Math.ceil(dmg * 0.7)
        }
      }
      const hpBefore = target.hp
      target.takeDamage(dmg, attacker.playerId)

      // Track kill for veterancy
      if (hpBefore > 0 && target.hp <= 0 && attacker instanceof Unit) {
        attacker.recordKill()
      }

      if (attack.splash > 0) {
        this.dealSplashDamage(
          { x: target.x, y: target.y },
          attack.splash * TILE_SIZE,
          attack.damage,
          attack.damageType,
          attacker.playerId,
          target.id,
        )
      }

      if (attacker instanceof Unit && attacker.def.id === 'desolator') {
        this.createRadiationZone(target.x, target.y, attacker.playerId)
      }
    } else {
      // Muzzle flash at attacker position
      this.createMuzzleFlash(attacker.x, attacker.y, attack.damageType)

      // Spawn projectile
      this.spawnProjectile(
        attacker.x, attacker.y,
        target.x, target.y,
        attack,
        attacker.playerId,
        () => {
          if (target.hp > 0) {
            const baseDmg = this.calculateDamage(
              attack,
              targetCategory,
              target.def.stats.armor,
            )
            let dmg = Math.ceil(baseDmg * vetMult)
            if (attacker instanceof Unit && attacker.def.id === 'tank_destroyer') {
              if (['vehicle', 'harvester', 'naval'].includes(targetCategory)) {
                dmg = Math.ceil(dmg * 1.25)
              } else if (targetCategory === 'infantry') {
                dmg = Math.ceil(dmg * 0.7)
              }
            }
            const hpBefore = target.hp
            target.takeDamage(dmg, attacker.playerId)

            // Track kill for veterancy
            if (hpBefore > 0 && target.hp <= 0 && attacker instanceof Unit) {
              attacker.recordKill()
            }

            if (attack.splash > 0) {
              this.dealSplashDamage(
                { x: target.x, y: target.y },
                attack.splash * TILE_SIZE,
                attack.damage,
                attack.damageType,
                attacker.playerId,
                target.id,
              )
            }

            if (attacker instanceof Unit && attacker.def.id === 'desolator') {
              this.createRadiationZone(target.x, target.y, attacker.playerId)
            }
          }
          this.createExplosion(target.x, target.y, this.getExplosionSize(target))
        },
      )
    }
  }

  /**
   * Apply splash damage to all entities in radius (excluding primaryId).
   */
  dealSplashDamage(
    center: { x: number; y: number },
    radiusPixels: number,
    baseDamage: number,
    damageType: DamageType,
    sourcePlayerId: number,
    excludeId?: string,
  ): void {
    const nearUnits = this.em.getUnitsInRange(center.x, center.y, radiusPixels)
    const nearBuildings = this.em.getBuildingsInRange(center.x, center.y, radiusPixels)

    const fakeAttack: AttackStats = {
      damage: baseDamage,
      range: 0,
      fireRate: 1,
      projectileSpeed: 0,
      damageType,
      canAttackAir: true,
      canAttackGround: true,
      splash: 0,
    }

    for (const u of nearUnits) {
      if (u.id === excludeId || u.state === 'dying') continue
      const dist = Phaser.Math.Distance.Between(center.x, center.y, u.x, u.y)
      const falloff = 1 - dist / radiusPixels
      const dmg = Math.ceil(this.calculateDamage(fakeAttack, u.def.category, u.def.stats.armor) * falloff)
      if (dmg > 0) u.takeDamage(dmg, sourcePlayerId)
    }

    for (const b of nearBuildings) {
      if (b.id === excludeId || b.state === 'dying') continue
      const dist = Phaser.Math.Distance.Between(center.x, center.y, b.x, b.y)
      const falloff = 1 - dist / radiusPixels
      const dmg = Math.ceil(this.calculateDamage(fakeAttack, b.def.category, b.def.stats.armor) * falloff)
      if (dmg > 0) b.takeDamage(dmg, sourcePlayerId)
    }
  }

  /**
   * Create visual explosion at position.
   * Size: 'small' = infantry, 'medium' = vehicle, 'large' = building
   */
  createExplosion(x: number, y: number, size: 'small' | 'medium' | 'large'): void {
    const radii = { small: 10, medium: 22, large: 40 }
    const radius = radii[size]
    const duration = { small: 300, medium: 500, large: 700 }[size]

    const iso = cartToScreen(x, y)

    // Fireball
    const fireball = this.scene.add.graphics()
    fireball.fillStyle(0xff6600, 1)
    fireball.fillCircle(iso.x, iso.y, radius)
    fireball.setDepth(45)

    // Inner bright core
    const core = this.scene.add.graphics()
    core.fillStyle(0xffff88, 1)
    core.fillCircle(iso.x, iso.y, radius * 0.5)
    core.setDepth(46)

    this.scene.tweens.add({
      targets: [fireball, core],
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => {
        fireball.destroy()
        core.destroy()
      },
    })

    // Smoke particles
    const smokeCount = size === 'large' ? 8 : size === 'medium' ? 4 : 2
    for (let i = 0; i < smokeCount; i++) {
      const smoke = this.scene.add.graphics()
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * radius * 0.8
      const sx = iso.x + Math.cos(angle) * dist
      const sy = iso.y + Math.sin(angle) * dist
      smoke.fillStyle(0x555555, 0.7)
      smoke.fillCircle(sx, sy, Math.random() * radius * 0.4 + 3)
      smoke.setDepth(44)
      this.scene.tweens.add({
        targets: smoke,
        alpha: 0,
        y: sy - 20 - Math.random() * 20,
        delay: Math.random() * 150,
        duration: duration * 1.5,
        onComplete: () => smoke.destroy(),
      })
    }
  }

  // ── Update loop ──────────────────────────────────────────────

  update(delta: number): void {
    const dt = delta / 1000
    const toRemove: number[] = []
    const bombIdsToRemove: string[] = []
    this.updateRadiationZones()

    for (const [targetId, bomb] of this.timedBombs.entries()) {
      if (!this.isEntityAlive(bomb.target)) {
        bombIdsToRemove.push(targetId)
        continue
      }
      const markerPos = cartToScreen(bomb.target.x, bomb.target.y)
      bomb.marker.setPosition(markerPos.x, markerPos.y)
    }

    for (const targetId of bombIdsToRemove) {
      this.removeTimedBomb(targetId, true)
    }

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i]
      const totalDist = Phaser.Math.Distance.Between(p.fromX, p.fromY, p.toX, p.toY)
      if (totalDist === 0) {
        p.onHit()
        toRemove.push(i)
        continue
      }

      p.progress += (p.speed * dt) / totalDist
      if (p.progress >= 1) {
        p.progress = 1
        p.onHit()
        p.graphic.destroy()
        toRemove.push(i)
      } else {
        const px = Phaser.Math.Linear(p.fromX, p.toX, p.progress)
        const py = Phaser.Math.Linear(p.fromY, p.toY, p.progress)
        const isoPos = cartToScreen(px, py)
        const isoFrom = cartToScreen(p.fromX, p.fromY)
        p.graphic.clear()
        p.graphic.setDepth(30 + isoPos.y * 0.01)
        this.drawProjectileGraphic(p.graphic, isoPos.x, isoPos.y, p.attack.damageType, isoFrom.x, isoFrom.y)
      }
    }

    // Remove in reverse order to preserve indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.projectiles.splice(toRemove[i], 1)
    }
  }

  // ── Private ──────────────────────────────────────────────────

  private wireEntityManager(): void {
    this.em.on('fire_at_target', (attacker: Unit | Building, target: Unit | Building) => {
      this.resolveAttack(attacker, target)
    })
  }

  private placeTimedBomb(attacker: Unit, target: Unit | Building, attack: AttackStats, vetMult: number): void {
    // Keep one active bomb per target to avoid stacking many fuses instantly.
    if (this.timedBombs.has(target.id)) return

    const marker = this.scene.add.graphics()
    marker.setDepth(47)
    marker.fillStyle(0x222222, 1)
    marker.fillCircle(0, 0, 5)
    marker.lineStyle(1.5, 0xff6600, 1)
    marker.strokeCircle(0, 0, 5)
    marker.lineBetween(0, -5, 0, -9)
    const targetPos = cartToScreen(target.x, target.y)
    marker.setPosition(targetPos.x, targetPos.y)

    const pulseTween = this.scene.tweens.add({
      targets: marker,
      alpha: 0.25,
      yoyo: true,
      repeat: -1,
      duration: 220,
    })

    const fuse = this.scene.time.delayedCall(3000, () => {
      this.detonateTimedBomb(target.id)
    })

    this.timedBombs.set(target.id, {
      target,
      sourceUnitId: attacker.id,
      sourcePlayerId: attacker.playerId,
      attack,
      vetMult,
      marker,
      pulseTween,
      fuse,
    })
  }

  private detonateTimedBomb(targetId: string): void {
    const bomb = this.timedBombs.get(targetId)
    if (!bomb) return
    this.removeTimedBomb(targetId, false)

    if (!this.isEntityAlive(bomb.target)) return

    const center = { x: bomb.target.x, y: bomb.target.y }
    const scaledDamage = Math.ceil(bomb.attack.damage * bomb.vetMult)
    const damageAttack: AttackStats = { ...bomb.attack, damage: scaledDamage }

    const hpBefore = bomb.target.hp
    const directDamage = this.calculateDamage(
      damageAttack,
      this.getTargetCategory(bomb.target),
      bomb.target.def.stats.armor,
    )
    bomb.target.takeDamage(directDamage, bomb.sourcePlayerId)

    if (hpBefore > 0 && bomb.target.hp <= 0) {
      const source = this.em.getUnit(bomb.sourceUnitId)
      if (source) source.recordKill()
    }

    if (bomb.attack.splash > 0) {
      this.dealSplashDamage(
        center,
        bomb.attack.splash * TILE_SIZE,
        scaledDamage,
        bomb.attack.damageType,
        bomb.sourcePlayerId,
        bomb.target.id,
      )
    }

    this.createExplosion(center.x, center.y, this.getBlastSizeFromSplash(bomb.attack.splash))
  }

  private removeTimedBomb(targetId: string, cancelFuse: boolean): void {
    const bomb = this.timedBombs.get(targetId)
    if (!bomb) return

    if (cancelFuse) {
      bomb.fuse.remove(false)
    }
    bomb.pulseTween.stop()
    bomb.marker.destroy()
    this.timedBombs.delete(targetId)
  }

  private isEntityAlive(entity: Unit | Building): boolean {
    return entity.hp > 0 && entity.state !== 'dying'
  }

  private createRadiationZone(x: number, y: number, sourcePlayerId: number): void {
    const radiusPixels = 2 * TILE_SIZE
    const now = this.scene.time.now
    const iso = cartToScreen(x, y)
    const graphic = this.scene.add.graphics()
    graphic.setDepth(34)
    graphic.fillStyle(0x99ff44, 0.22)
    graphic.fillCircle(iso.x, iso.y, radiusPixels)
    graphic.lineStyle(1.5, 0xccff66, 0.5)
    graphic.strokeCircle(iso.x, iso.y, radiusPixels)

    this.scene.tweens.add({
      targets: graphic,
      alpha: 0.45,
      yoyo: true,
      repeat: -1,
      duration: 350,
    })

    this.radiationZones.push({
      x,
      y,
      radiusPixels,
      sourcePlayerId,
      expiresAt: now + 5000,
      nextTickAt: now + 500,
      graphic,
    })
  }

  private updateRadiationZones(): void {
    const now = this.scene.time.now
    const survivors: RadiationZone[] = []

    for (const zone of this.radiationZones) {
      if (now >= zone.expiresAt) {
        zone.graphic.destroy()
        continue
      }

      if (now >= zone.nextTickAt) {
        zone.nextTickAt = now + 500
        const units = this.em.getUnitsInRange(zone.x, zone.y, zone.radiusPixels)
        for (const unit of units) {
          if (!this.isEntityAlive(unit)) continue
          if (unit.playerId === zone.sourcePlayerId) continue
          if (unit.def.category !== 'infantry') continue
          unit.takeDamage(12, zone.sourcePlayerId)
        }
      }

      survivors.push(zone)
    }

    this.radiationZones = survivors
  }

  private spawnProjectile(
    fromX: number, fromY: number,
    toX: number, toY: number,
    attack: AttackStats,
    sourcePlayerId: number,
    onHit: () => void,
  ): void {
    const g = this.scene.add.graphics()
    const fromIso = cartToScreen(fromX, fromY)
    g.setDepth(30 + fromIso.y * 0.01)
    this.drawProjectileGraphic(g, fromIso.x, fromIso.y, attack.damageType)

    this.projectiles.push({
      graphic: g,
      fromX, fromY, toX, toY,
      progress: 0,
      speed: attack.projectileSpeed,
      attack,
      sourcePlayerId,
      onHit,
    })
  }

  private drawProjectileGraphic(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    dmgType: DamageType,
    fromX?: number,
    fromY?: number,
  ): void {
    const colors: Record<DamageType, number> = {
      [DamageType.BULLET]: 0xffee00,
      [DamageType.EXPLOSIVE]: 0xff8800,
      [DamageType.MISSILE]: 0x88ccff,
      [DamageType.FIRE]: 0xff4400,
      [DamageType.ELECTRIC]: 0xaaddff,
    }
    const sizes: Record<DamageType, number> = {
      [DamageType.BULLET]: 2,
      [DamageType.EXPLOSIVE]: 4,
      [DamageType.MISSILE]: 4,
      [DamageType.FIRE]: 5,
      [DamageType.ELECTRIC]: 3,
    }
    const color = colors[dmgType] ?? 0xffffff
    const size = sizes[dmgType] ?? 3

    // Trail from movement direction
    if (fromX !== undefined && fromY !== undefined) {
      const dx = x - fromX
      const dy = y - fromY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 1) {
        const nx = -dx / dist
        const ny = -dy / dist
        const trailLen = Math.min(10, dist * 0.3)

        if (dmgType === DamageType.ELECTRIC) {
          // Tesla bolt — jagged line segments
          g.lineStyle(2, color, 0.8)
          const segs = 4
          let sx = x, sy = y
          for (let i = 0; i < segs; i++) {
            const t = (i + 1) / segs
            const ex = x + nx * trailLen * t + (Math.random() - 0.5) * 6
            const ey = y + ny * trailLen * t + (Math.random() - 0.5) * 6
            g.lineBetween(sx, sy, ex, ey)
            sx = ex
            sy = ey
          }
        } else {
          // Standard trail line
          g.lineStyle(size * 0.7, color, 0.4)
          g.lineBetween(x, y, x + nx * trailLen, y + ny * trailLen)
        }
      }
    }

    // Main projectile body
    if (dmgType === DamageType.FIRE) {
      // Fire: wider shape with red edges
      g.fillStyle(0xff6600, 0.7)
      g.fillCircle(x, y, size + 1)
      g.fillStyle(color, 1)
      g.fillCircle(x, y, size - 1)
    } else {
      g.fillStyle(color, 1)
      g.fillCircle(x, y, size)
      // Bright core
      g.fillStyle(0xffffff, 0.5)
      g.fillCircle(x, y, size * 0.4)
    }
  }

  private createMuzzleFlash(x: number, y: number, dmgType: DamageType): void {
    const flashColors: Record<DamageType, number> = {
      [DamageType.BULLET]: 0xffff44,
      [DamageType.EXPLOSIVE]: 0xff8844,
      [DamageType.MISSILE]: 0xff8844,
      [DamageType.FIRE]: 0xff6600,
      [DamageType.ELECTRIC]: 0x66aaff,
    }
    const iso = cartToScreen(x, y)
    const flash = this.scene.add.graphics()
    flash.fillStyle(flashColors[dmgType] ?? 0xffff44, 0.9)
    flash.fillCircle(iso.x, iso.y, 4)
    flash.setDepth(35)
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 100,
      onComplete: () => flash.destroy(),
    })
  }

  private canAttackTarget(attack: AttackStats, target: Unit | Building): boolean {
    // Buildings and non-air units are "ground" targets.
    const isAirUnit = target instanceof Unit && target.def.category === 'aircraft'
    return isAirUnit ? attack.canAttackAir : attack.canAttackGround
  }

  private applyUnitSpecialOnHit(attacker: Unit, primaryTarget: Unit | Building): void {
    if (attacker.def.id !== 'prism_tank' || !attacker.def.attack) return
    this.dealPrismChainDamage(attacker, primaryTarget, 2)
  }

  private dealPrismChainDamage(attacker: Unit, primaryTarget: Unit | Building, maxChains: number): void {
    const baseAttack = attacker.def.attack!
    const chainRadius = 2 * TILE_SIZE
    const visited = new Set<string>([primaryTarget.id])
    let anchorX = primaryTarget.x
    let anchorY = primaryTarget.y

    for (let chainIdx = 1; chainIdx <= maxChains; chainIdx++) {
      const candidates: Array<Unit | Building> = [
        ...this.em.getUnitsInRange(anchorX, anchorY, chainRadius),
        ...this.em.getBuildingsInRange(anchorX, anchorY, chainRadius),
      ]
      const nextTarget = candidates.find(e =>
        !visited.has(e.id) &&
        e.playerId !== attacker.playerId &&
        e.hp > 0 &&
        (('state' in e && e.state !== 'dying') || !('state' in e)) &&
        this.canAttackTarget(baseAttack, e)
      )
      if (!nextTarget) break

      const fakeChainAttack: AttackStats = {
        ...baseAttack,
        damage: Math.ceil(baseAttack.damage * (1 - 0.35 * chainIdx)),
        splash: 0,
      }
      if (fakeChainAttack.damage <= 0) break

      const dmg = this.calculateDamage(fakeChainAttack, this.getTargetCategory(nextTarget), nextTarget.def.stats.armor)
      nextTarget.takeDamage(dmg, attacker.playerId)
      this.createChainArc(anchorX, anchorY, nextTarget.x, nextTarget.y)

      visited.add(nextTarget.id)
      anchorX = nextTarget.x
      anchorY = nextTarget.y
    }
  }

  private createChainArc(fromX: number, fromY: number, toX: number, toY: number): void {
    const fromIso = cartToScreen(fromX, fromY)
    const toIso = cartToScreen(toX, toY)
    const g = this.scene.add.graphics()
    g.setDepth(36)
    g.lineStyle(2, 0xaaddff, 0.9)

    const segments = 6
    let px = fromIso.x
    let py = fromIso.y
    for (let i = 1; i <= segments; i++) {
      const t = i / segments
      const nx = Phaser.Math.Linear(fromIso.x, toIso.x, t) + (Math.random() - 0.5) * 8
      const ny = Phaser.Math.Linear(fromIso.y, toIso.y, t) + (Math.random() - 0.5) * 8
      g.lineBetween(px, py, nx, ny)
      px = nx
      py = ny
    }

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 90,
      onComplete: () => g.destroy(),
    })
  }

  private getTargetCategory(entity: Unit | Building): string {
    if ('def' in entity) {
      const def = entity.def
      if ('category' in def) {
        return def.category
      }
    }
    return 'vehicle'
  }

  private getExplosionSize(entity: Unit | Building): 'small' | 'medium' | 'large' {
    if ('def' in entity && 'category' in entity.def) {
      const cat = entity.def.category as string
      if (cat === 'infantry') return 'small'
      if (['base', 'production', 'power', 'tech', 'superweapon'].includes(cat)) return 'large'
    }
    return 'medium'
  }

  private getBlastSizeFromSplash(splashTiles: number): 'small' | 'medium' | 'large' {
    if (splashTiles >= 3) return 'large'
    if (splashTiles >= 1.5) return 'medium'
    return 'small'
  }
}
