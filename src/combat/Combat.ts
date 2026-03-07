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

// Type multipliers: who's strong against what
const TYPE_MULTIPLIERS: Record<DamageType, Record<string, number>> = {
  [DamageType.BULLET]: {
    infantry: 1.6,
    vehicle: 0.4,
    aircraft: 0.6,
    naval: 0.4,
    harvester: 0.7,
    base: 0.25,
    power: 0.25,
    production: 0.25,
    defense: 0.4,
    tech: 0.25,
    superweapon: 0.2,
  },
  [DamageType.EXPLOSIVE]: {
    infantry: 0.7,
    vehicle: 1.4,
    aircraft: 0.3,
    naval: 1.0,
    harvester: 1.0,
    base: 1.6,
    power: 1.6,
    production: 1.6,
    defense: 1.3,
    tech: 1.5,
    superweapon: 1.4,
  },
  [DamageType.MISSILE]: {
    infantry: 0.6,
    vehicle: 1.5,
    aircraft: 1.5,
    naval: 1.3,
    harvester: 1.2,
    base: 1.2,
    power: 1.2,
    production: 1.2,
    defense: 1.0,
    tech: 1.2,
    superweapon: 1.0,
  },
  [DamageType.FIRE]: {
    infantry: 1.8,
    vehicle: 0.8,
    aircraft: 0.2,
    naval: 0.5,
    harvester: 1.0,
    base: 1.3,
    power: 1.3,
    production: 1.3,
    defense: 0.8,
    tech: 1.3,
    superweapon: 1.0,
  },
  [DamageType.ELECTRIC]: {
    infantry: 1.2,
    vehicle: 1.3,
    aircraft: 0.8,
    naval: 1.5,
    harvester: 1.2,
    base: 1.0,
    power: 2.0,
    production: 1.0,
    defense: 1.2,
    tech: 1.5,
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

export class Combat extends Phaser.Events.EventEmitter {
  private scene: Phaser.Scene
  private em: EntityManager
  private projectiles: Projectile[]
  private chronoEraseProgress: Map<string, number>

  constructor(scene: Phaser.Scene, entityManager: EntityManager) {
    super()
    this.scene = scene
    this.em = entityManager
    this.projectiles = []
    this.chronoEraseProgress = new Map()

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
    }
    // RA2 Veterancy: damage multiplier for units
    const vetMult = (attacker instanceof Unit) ? attacker.getVeterancyDamageMultiplier() : 1.0

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

    // Fireball
    const fireball = this.scene.add.graphics()
    fireball.fillStyle(0xff6600, 1)
    fireball.fillCircle(x, y, radius)
    fireball.setDepth(45)

    // Inner bright core
    const core = this.scene.add.graphics()
    core.fillStyle(0xffff88, 1)
    core.fillCircle(x, y, radius * 0.5)
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
      const sx = x + Math.cos(angle) * dist
      const sy = y + Math.sin(angle) * dist
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
        p.graphic.clear()
        this.drawProjectileGraphic(p.graphic, px, py, p.attack.damageType, p.fromX, p.fromY)
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

  private spawnProjectile(
    fromX: number, fromY: number,
    toX: number, toY: number,
    attack: AttackStats,
    sourcePlayerId: number,
    onHit: () => void,
  ): void {
    const g = this.scene.add.graphics()
    g.setDepth(30)
    this.drawProjectileGraphic(g, fromX, fromY, attack.damageType)

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
    const flash = this.scene.add.graphics()
    flash.fillStyle(flashColors[dmgType] ?? 0xffff44, 0.9)
    flash.fillCircle(x, y, 4)
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
}
