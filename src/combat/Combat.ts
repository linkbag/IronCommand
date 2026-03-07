// =====================================================  }

  private createMuzzleFlash(x: number, y: number, dmgType: DamageType): void {
    const flashColors: Record<DamageType, number> = {
      [DamageType.BULLET]: 0xffff44,
      [DamageType.EXPLOSIVE]: 0xff8844,
      [DamageType.HE]: 0xff6622,
      [DamageType.AP]: 0xffcc77,
      [DamageType.MISSILE]: 0xff8844,
      [DamageType.FIRE]: 0xff6600,
      [DamageType.ELECTRIC]: 0x66aaff,
      [DamageType.RADIATION]: 0x99ff55,
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

  private createTeslaArc(fromX: number, fromY: number, toX: number, toY: number): void {
    const fromIso = cartToScreen(fromX, fromY)
    const toIso = cartToScreen(toX, toY)
    const g = this.scene.add.graphics().setDepth(36)
    g.lineStyle(2, 0x88d8ff, 0.95)
    const segs = 7
    let px = fromIso.x
    let py = fromIso.y
    for (let i = 1; i <= segs; i++) {
      const t = i / segs
      const nx = Phaser.Math.Linear(fromIso.x, toIso.x, t) + Phaser.Math.Between(-5, 5)
      const ny = Phaser.Math.Linear(fromIso.y, toIso.y, t) + Phaser.Math.Between(-5, 5)
      g.lineBetween(px, py, nx, ny)
      px = nx
      py = ny
    }
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 110,
      onComplete: () => g.destroy(),
    })
  }

  private createPrismBeam(fromX: number, fromY: number, toX: number, toY: number): void {
    const fromIso = cartToScreen(fromX, fromY)
    const toIso = cartToScreen(toX, toY)
    const core = this.scene.add.graphics().setDepth(37)
    core.lineStyle(2, 0xc6f8ff, 0.95)
    core.lineBetween(fromIso.x, fromIso.y, toIso.x, toIso.y)
    const glow = this.scene.add.graphics().setDepth(36)
    glow.lineStyle(5, 0x66d6ff, 0.35)
    glow.lineBetween(fromIso.x, fromIso.y, toIso.x, toIso.y)
    this.scene.tweens.add({
      targets: [core, glow],
      alpha: 0,
      duration: 90,
      onComplete: () => {
        core.destroy()
        glow.destroy()
      },
    })
  }

  private createChronoShimmer(x: number, y: number): void {
    const iso = cartToScreen(x, y)
    const shimmer = this.scene.add.graphics().setDepth(41)
    shimmer.lineStyle(2, 0x78d7ff, 0.8)
    shimmer.strokeEllipse(iso.x, iso.y, 26, 16)
    shimmer.strokeEllipse(iso.x, iso.y, 34, 22)
    this.scene.tweens.add({
      targets: shimmer,
      alpha: 0,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 200,
      onComplete: () => shimmer.destroy(),
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

      const dmg = this.calculateDamage(
        fakeChainAttack,
        this.getTargetCategory(nextTarget),
        this.getEffectiveArmor(nextTarget),
        this.getArmorType(nextTarget),
      )
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
