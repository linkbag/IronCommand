// =================================================================
// Transport Load/Unload + Neutral Building Interaction — Unit Tests
// Tests the logic extracted from:
//   - src/entities/EntityManager.ts  (loadUnitIntoTransport, unloadTransportAt)
//   - src/combat/Combat.ts           (engineer vs neutral-building branching)
//   - src/scenes/GameScene.ts        (updateNeutralEffects)
//
// All tests use plain-object stubs; no Phaser instantiation required.
// =================================================================

import { describe, it, expect, vi } from 'vitest'
import { NEUTRAL_PLAYER_ID, TILE_SIZE } from '../src/types'

// ── Stubs ─────────────────────────────────────────────────────────────────────

type UnitStub = {
  id: string
  playerId: number
  x: number
  y: number
  hp: number
  state: string
  def: {
    id: string
    category: string
    transport?: {
      capacity: number
      allowedCategories: string[]
      loadRangeTiles?: number
      unloadRadiusTiles?: number
    }
    stats: { maxHp: number }
    attack: null | object
  }
  // Transport passenger state
  _embarkedId: string | null
  _cargo: string[]

  isEmbarked: () => boolean
  setEmbarkedTransportId: (id: string | null) => void
  canTransportUnits: () => boolean
  canCarryCategory: (cat: string) => boolean
  hasCargoSpace: () => boolean
  getTransportedUnitIds: () => string[]
  addTransportedUnit: (id: string) => boolean
  removeTransportedUnit: (id: string) => boolean
  getTransportLoadRangePixels: () => number
  getTransportUnloadRadiusTiles: () => number
  setPosition: (x: number, y: number) => void
  heal: (amount: number) => void
}

function makeUnit(overrides: Partial<Pick<UnitStub, 'id' | 'playerId' | 'x' | 'y' | 'hp' | 'state'>> & {
  category?: string
  transport?: UnitStub['def']['transport']
} = {}): UnitStub {
  const u: UnitStub = {
    id: overrides.id ?? 'u1',
    playerId: overrides.playerId ?? 0,
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    hp: overrides.hp ?? 100,
    state: overrides.state ?? 'idle',
    def: {
      id: overrides.category ?? 'rifleman',
      category: overrides.category ?? 'infantry',
      transport: overrides.transport,
      stats: { maxHp: overrides.hp ?? 100 },
      attack: null,
    },
    _embarkedId: null,
    _cargo: [],

    isEmbarked() { return this._embarkedId !== null },
    setEmbarkedTransportId(id) { this._embarkedId = id },
    canTransportUnits() { return !!this.def.transport },
    canCarryCategory(cat) {
      return (this.def.transport?.allowedCategories ?? []).includes(cat)
    },
    hasCargoSpace() {
      return this._cargo.length < (this.def.transport?.capacity ?? 0)
    },
    getTransportedUnitIds() { return [...this._cargo] },
    addTransportedUnit(id) {
      if (this._cargo.includes(id)) return false
      this._cargo.push(id)
      return true
    },
    removeTransportedUnit(id) {
      const idx = this._cargo.indexOf(id)
      if (idx === -1) return false
      this._cargo.splice(idx, 1)
      return true
    },
    getTransportLoadRangePixels() {
      return (this.def.transport?.loadRangeTiles ?? 2) * TILE_SIZE
    },
    getTransportUnloadRadiusTiles() {
      return this.def.transport?.unloadRadiusTiles ?? 2
    },
    setPosition(x, y) { this.x = x; this.y = y },
    heal(amount) { this.hp = Math.min(this.def.stats.maxHp, this.hp + amount) },
  }
  return u
}

type BuildingStub = {
  id: string
  playerId: number
  x: number
  y: number
  hp: number
  state: string
  def: { id: string; stats: { maxHp: number } }
  repair: (amount: number) => number
}

function makeBuilding(overrides: Partial<{
  id: string
  playerId: number
  x: number
  y: number
  hp: number
  maxHp: number
  state: string
  defId: string
}> = {}): BuildingStub {
  const maxHp = overrides.maxHp ?? 500
  const b: BuildingStub = {
    id: overrides.id ?? 'b1',
    playerId: overrides.playerId ?? NEUTRAL_PLAYER_ID,
    x: overrides.x ?? 200,
    y: overrides.y ?? 200,
    hp: overrides.hp ?? maxHp,
    state: overrides.state ?? 'active',
    def: { id: overrides.defId ?? 'neutral_hospital', stats: { maxHp } },
    repair(amount) {
      const prev = this.hp
      this.hp = Math.min(this.def.stats.maxHp, this.hp + amount)
      return this.hp - prev
    },
  }
  return b
}

// ── Inline re-implementation of EntityManager.loadUnitIntoTransport ──────────
// Mirrors the real logic without depending on Phaser.

function loadUnitIntoTransport(
  units: Map<string, UnitStub>,
  passengerId: string,
  transportId: string,
): boolean {
  const passenger = units.get(passengerId)
  const transport = units.get(transportId)
  if (!passenger || !transport) return false
  if (passenger.id === transport.id) return false
  if (passenger.playerId !== transport.playerId) return false
  if (passenger.state === 'dying' || transport.state === 'dying') return false
  if (passenger.isEmbarked()) return false
  if (!transport.canTransportUnits()) return false
  if (!transport.canCarryCategory(passenger.def.category)) return false
  if (!transport.hasCargoSpace()) return false

  const dist = Math.hypot(passenger.x - transport.x, passenger.y - transport.y)
  if (dist > transport.getTransportLoadRangePixels()) return false

  if (!transport.addTransportedUnit(passenger.id)) return false
  passenger.setEmbarkedTransportId(transport.id)
  passenger.setPosition(transport.x, transport.y)
  return true
}

// ── Inline re-implementation of EntityManager.unloadTransportAt ──────────────

function findNearestOpenDropTile(
  origin: { col: number; row: number },
  usedTiles: Set<string>,
  maxRadius: number,
  occupiedTiles: Set<string> = new Set(),
): { col: number; row: number } | null {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue
        const col = origin.col + dc
        const row = origin.row + dr
        const key = `${col},${row}`
        if (usedTiles.has(key)) continue
        if (occupiedTiles.has(key)) continue
        return { col, row }
      }
    }
  }
  return null
}

function unloadTransportAt(
  units: Map<string, UnitStub>,
  transportId: string,
  target: { x: number; y: number },
): number {
  const transport = units.get(transportId)
  if (!transport || !transport.canTransportUnits()) return 0
  const cargoIds = transport.getTransportedUnitIds()
  if (cargoIds.length === 0) return 0

  const maxRadius = Math.max(2, Math.round(transport.getTransportUnloadRadiusTiles()))
  const targetTile = {
    col: Math.floor(target.x / TILE_SIZE),
    row: Math.floor(target.y / TILE_SIZE),
  }
  const usedTiles = new Set<string>()
  let unloaded = 0

  for (const cargoId of cargoIds) {
    const passenger = units.get(cargoId)
    if (!passenger || passenger.state === 'dying') {
      transport.removeTransportedUnit(cargoId)
      continue
    }
    const dropTile = findNearestOpenDropTile(targetTile, usedTiles, maxRadius)
    if (!dropTile) continue
    if (!transport.removeTransportedUnit(cargoId)) continue
    passenger.setEmbarkedTransportId(null)
    passenger.setPosition(
      dropTile.col * TILE_SIZE + TILE_SIZE / 2,
      dropTile.row * TILE_SIZE + TILE_SIZE / 2,
    )
    usedTiles.add(`${dropTile.col},${dropTile.row}`)
    unloaded++
  }
  return unloaded
}

// ── Helper: engineer-attack branching (mirrors Combat.ts resolveAttack) ──────

type EngineerResult =
  | { action: 'bridge_repaired' }
  | { action: 'bridge_intact_no_action' }
  | { action: 'capture'; newPlayerId: number }
  | { action: 'no_op' }

function resolveEngineerVsBuilding(
  engineer: { id: string; playerId: number },
  target: BuildingStub,
): EngineerResult {
  if (target.playerId === engineer.playerId) return { action: 'no_op' }

  const isNeutralTarget = target.playerId === NEUTRAL_PLAYER_ID
  const isBridgeStructure = target.def.id === 'neutral_bridge'

  if (isNeutralTarget && isBridgeStructure) {
    if (target.hp < target.def.stats.maxHp) {
      target.repair(1_000_000_000)
      return { action: 'bridge_repaired' }
    }
    return { action: 'bridge_intact_no_action' }
  }

  return { action: 'capture', newPlayerId: engineer.playerId }
}

// =============================================================================
// Tests: transport load/unload
// =============================================================================

describe('Transport: loadUnitIntoTransport', () => {
  function setup() {
    const transport = makeUnit({
      id: 'transport',
      playerId: 0,
      x: 200,
      y: 200,
      category: 'naval',
      transport: {
        capacity: 8,
        allowedCategories: ['infantry', 'vehicle'],
        loadRangeTiles: 1.85,
        unloadRadiusTiles: 6,
      },
    })
    const infantry = makeUnit({ id: 'inf1', playerId: 0, x: 200, y: 210, category: 'infantry' })
    const units = new Map<string, UnitStub>([
      [transport.id, transport],
      [infantry.id, infantry],
    ])
    return { transport, infantry, units }
  }

  it('loads a friendly infantry unit successfully', () => {
    const { transport, infantry, units } = setup()
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(true)
    expect(transport._cargo).toContain(infantry.id)
    expect(infantry._embarkedId).toBe(transport.id)
    expect(infantry.x).toBe(transport.x)
    expect(infantry.y).toBe(transport.y)
  })

  it('rejects when passenger and transport are different players', () => {
    const { transport, infantry, units } = setup()
    infantry.playerId = 1
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
    expect(transport._cargo).toHaveLength(0)
  })

  it('rejects when transport is not transport-capable', () => {
    const { transport, infantry, units } = setup()
    transport.def.transport = undefined
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
  })

  it('rejects when category is not in allowedCategories', () => {
    const { transport, infantry, units } = setup()
    infantry.def.category = 'aircraft'
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
  })

  it('rejects when transport is at full capacity', () => {
    const { transport, infantry, units } = setup()
    // Fill to capacity
    for (let i = 0; i < 8; i++) transport._cargo.push(`dummy_${i}`)
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
  })

  it('rejects when passenger is already embarked', () => {
    const { transport, infantry, units } = setup()
    infantry._embarkedId = 'other_transport'
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
  })

  it('rejects when passenger is too far away', () => {
    const { transport, infantry, units } = setup()
    // 1.85 * 32 = 59.2 px load range; put infantry 100px away
    infantry.x = transport.x + 100
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
  })

  it('rejects when either unit is dying', () => {
    const { transport, infantry, units } = setup()
    transport.state = 'dying'
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)

    transport.state = 'idle'
    infantry.state = 'dying'
    expect(loadUnitIntoTransport(units, infantry.id, transport.id)).toBe(false)
  })

  it('rejects when IDs are the same (transport cannot board itself)', () => {
    const { transport, units } = setup()
    expect(loadUnitIntoTransport(units, transport.id, transport.id)).toBe(false)
  })

  it('loads up to capacity when calling multiple times', () => {
    const { transport, units } = setup()
    for (let i = 0; i < 10; i++) {
      const u = makeUnit({ id: `inf_${i}`, playerId: 0, x: 200, y: 210, category: 'infantry' })
      units.set(u.id, u)
    }
    let loadCount = 0
    for (let i = 0; i < 10; i++) {
      if (loadUnitIntoTransport(units, `inf_${i}`, transport.id)) loadCount++
    }
    // Capacity is 8; first 8 succeed, last 2 fail
    expect(loadCount).toBe(8)
    expect(transport._cargo).toHaveLength(8)
  })
})

describe('Transport: unloadTransportAt', () => {
  function setup() {
    const transport = makeUnit({
      id: 'transport',
      playerId: 0,
      x: 320,
      y: 320,
      category: 'naval',
      transport: {
        capacity: 4,
        allowedCategories: ['infantry'],
        unloadRadiusTiles: 3,
      },
    })
    const passengers: UnitStub[] = []
    for (let i = 0; i < 3; i++) {
      const p = makeUnit({ id: `inf_${i}`, playerId: 0, x: transport.x, y: transport.y, category: 'infantry' })
      p._embarkedId = transport.id
      transport._cargo.push(p.id)
      passengers.push(p)
    }
    const units = new Map<string, UnitStub>([[transport.id, transport]])
    passengers.forEach(p => units.set(p.id, p))
    return { transport, passengers, units }
  }

  it('unloads all passengers and returns count', () => {
    const { transport, passengers, units } = setup()
    const count = unloadTransportAt(units, transport.id, { x: 320, y: 320 })
    expect(count).toBe(3)
    expect(transport._cargo).toHaveLength(0)
    for (const p of passengers) {
      expect(p._embarkedId).toBeNull()
    }
  })

  it('places passengers on distinct tiles', () => {
    const { transport, passengers, units } = setup()
    unloadTransportAt(units, transport.id, { x: 320, y: 320 })
    const positions = passengers.map(p => `${p.x},${p.y}`)
    const unique = new Set(positions)
    expect(unique.size).toBe(passengers.length)
  })

  it('returns 0 when transport has no cargo', () => {
    const { transport, units } = setup()
    transport._cargo = []
    expect(unloadTransportAt(units, transport.id, { x: 320, y: 320 })).toBe(0)
  })

  it('returns 0 for non-transport unit', () => {
    const nonTransport = makeUnit({ id: 'tank', playerId: 0 })
    const units = new Map([[nonTransport.id, nonTransport]])
    expect(unloadTransportAt(units, nonTransport.id, { x: 100, y: 100 })).toBe(0)
  })

  it('skips dying passengers', () => {
    const { transport, passengers, units } = setup()
    passengers[0].state = 'dying'
    const count = unloadTransportAt(units, transport.id, { x: 320, y: 320 })
    expect(count).toBe(2)
  })
})

describe('findNearestOpenDropTile', () => {
  it('returns the origin tile when nothing is occupied', () => {
    const tile = findNearestOpenDropTile({ col: 5, row: 5 }, new Set(), 3)
    expect(tile).toEqual({ col: 5, row: 5 })
  })

  it('skips origin when it is in usedTiles and returns adjacent', () => {
    const used = new Set(['5,5'])
    const tile = findNearestOpenDropTile({ col: 5, row: 5 }, used, 3)
    expect(tile).not.toBeNull()
    expect(tile).not.toEqual({ col: 5, row: 5 })
  })

  it('returns null when all tiles within radius are occupied', () => {
    // For radius 0 there is only the origin tile — if it's occupied, return null
    const used = new Set(['5,5'])
    const tile = findNearestOpenDropTile({ col: 5, row: 5 }, used, 0)
    expect(tile).toBeNull()
  })

  it('assigns consecutive passengers to separate tiles', () => {
    const usedTiles = new Set<string>()
    const origin = { col: 10, row: 10 }
    const results: string[] = []
    for (let i = 0; i < 5; i++) {
      const t = findNearestOpenDropTile(origin, usedTiles, 4)
      expect(t).not.toBeNull()
      const key = `${t!.col},${t!.row}`
      expect(usedTiles.has(key)).toBe(false)
      usedTiles.add(key)
      results.push(key)
    }
    expect(new Set(results).size).toBe(5)
  })
})

// =============================================================================
// Tests: neutral building + engineer interaction
// =============================================================================

describe('Engineer vs neutral building (bridging logic)', () => {
  const engineer = { id: 'eng1', playerId: 0 }

  it('repairs a damaged neutral bridge (does not capture)', () => {
    const bridge = makeBuilding({ defId: 'neutral_bridge', hp: 200, maxHp: 700 })
    const result = resolveEngineerVsBuilding(engineer, bridge)
    expect(result.action).toBe('bridge_repaired')
    expect(bridge.hp).toBe(bridge.def.stats.maxHp)
  })

  it('returns no-action for an intact neutral bridge', () => {
    const bridge = makeBuilding({ defId: 'neutral_bridge', hp: 700, maxHp: 700 })
    const result = resolveEngineerVsBuilding(engineer, bridge)
    expect(result.action).toBe('bridge_intact_no_action')
  })

  it('captures a neutral hospital at full health', () => {
    const hospital = makeBuilding({ defId: 'neutral_hospital', hp: 500, maxHp: 500 })
    const result = resolveEngineerVsBuilding(engineer, hospital)
    expect(result.action).toBe('capture')
    expect((result as { action: 'capture'; newPlayerId: number }).newPlayerId).toBe(engineer.playerId)
  })

  it('captures a DAMAGED neutral hospital (does not repair it)', () => {
    // After the fix, damaged hospitals should be capturable, not repaired
    const hospital = makeBuilding({ defId: 'neutral_hospital', hp: 250, maxHp: 500 })
    const result = resolveEngineerVsBuilding(engineer, hospital)
    expect(result.action).toBe('capture')
    // HP must NOT have been changed (no repair happened)
    expect(hospital.hp).toBe(250)
  })

  it('captures a neutral repair depot', () => {
    const depot = makeBuilding({ defId: 'neutral_repair_depot', hp: 600, maxHp: 600 })
    const result = resolveEngineerVsBuilding(engineer, depot)
    expect(result.action).toBe('capture')
  })

  it('captures an enemy-owned building', () => {
    const enemyBuilding = makeBuilding({ defId: 'barracks', playerId: 1, hp: 300, maxHp: 500 })
    const result = resolveEngineerVsBuilding(engineer, enemyBuilding)
    expect(result.action).toBe('capture')
    expect((result as { action: 'capture'; newPlayerId: number }).newPlayerId).toBe(0)
  })

  it('is a no-op when targeting own building', () => {
    const ownBuilding = makeBuilding({ defId: 'barracks', playerId: 0 })
    const result = resolveEngineerVsBuilding(engineer, ownBuilding)
    expect(result.action).toBe('no_op')
  })
})

// =============================================================================
// Tests: neutral building effects (hospital / repair depot)
// =============================================================================

describe('Neutral building effects (after capture)', () => {
  // Mirrors the logic in GameScene.updateNeutralEffects
  function applyNeutralEffects(
    buildings: BuildingStub[],
    unitsList: UnitStub[],
    healRange: number,
  ): void {
    for (const b of buildings) {
      if (b.state !== 'active' || b.playerId < 0) continue

      if (b.def.id === 'neutral_hospital') {
        for (const u of unitsList) {
          if (u.playerId !== b.playerId || u.def.category !== 'infantry') continue
          if (u.hp < u.def.stats.maxHp && u.state !== 'dying') {
            const dist = Math.hypot(u.x - b.x, u.y - b.y)
            if (dist <= healRange) u.heal(5)
          }
        }
      }

      if (b.def.id === 'neutral_repair_depot') {
        for (const u of unitsList) {
          if (u.playerId !== b.playerId) continue
          if ((u.def.category === 'vehicle' || u.def.category === 'harvester') && u.state !== 'dying') {
            const dist = Math.hypot(u.x - b.x, u.y - b.y)
            if (u.hp < u.def.stats.maxHp && dist <= healRange) u.heal(10)
          }
        }
      }
    }
  }

  const HEAL_RANGE = 4 * TILE_SIZE

  it('hospital heals nearby friendly infantry after being captured', () => {
    const hospital = makeBuilding({ defId: 'neutral_hospital', playerId: 0, x: 200, y: 200 })
    const inf = makeUnit({ id: 'inf1', playerId: 0, x: 210, y: 200, hp: 80, category: 'infantry' })
    inf.def.stats = { maxHp: 100 }
    applyNeutralEffects([hospital], [inf], HEAL_RANGE)
    expect(inf.hp).toBe(85)
  })

  it('hospital does NOT heal uncaptured (neutral) buildings', () => {
    // playerId -1 → skipped by `b.playerId < 0` guard
    const hospital = makeBuilding({ defId: 'neutral_hospital', playerId: NEUTRAL_PLAYER_ID, x: 200, y: 200 })
    const inf = makeUnit({ id: 'inf1', playerId: NEUTRAL_PLAYER_ID, x: 210, y: 200, hp: 80, category: 'infantry' })
    inf.def.stats = { maxHp: 100 }
    applyNeutralEffects([hospital], [inf], HEAL_RANGE)
    expect(inf.hp).toBe(80)
  })

  it('hospital does NOT heal enemy infantry', () => {
    const hospital = makeBuilding({ defId: 'neutral_hospital', playerId: 0, x: 200, y: 200 })
    const enemyInf = makeUnit({ id: 'inf2', playerId: 1, x: 210, y: 200, hp: 50, category: 'infantry' })
    enemyInf.def.stats = { maxHp: 100 }
    applyNeutralEffects([hospital], [enemyInf], HEAL_RANGE)
    expect(enemyInf.hp).toBe(50)
  })

  it('hospital does NOT heal vehicles', () => {
    const hospital = makeBuilding({ defId: 'neutral_hospital', playerId: 0, x: 200, y: 200 })
    const vehicle = makeUnit({ id: 'tank', playerId: 0, x: 210, y: 200, hp: 200, category: 'vehicle' })
    vehicle.def.stats = { maxHp: 400 }
    applyNeutralEffects([hospital], [vehicle], HEAL_RANGE)
    expect(vehicle.hp).toBe(200)
  })

  it('hospital does NOT heal infantry that are out of range', () => {
    const hospital = makeBuilding({ defId: 'neutral_hospital', playerId: 0, x: 200, y: 200 })
    const farInf = makeUnit({ id: 'inf3', playerId: 0, x: 200 + HEAL_RANGE + 1, y: 200, hp: 80, category: 'infantry' })
    farInf.def.stats = { maxHp: 100 }
    applyNeutralEffects([hospital], [farInf], HEAL_RANGE)
    expect(farInf.hp).toBe(80)
  })

  it('repair depot heals nearby friendly vehicles after capture', () => {
    const depot = makeBuilding({ defId: 'neutral_repair_depot', playerId: 0, x: 200, y: 200 })
    const vehicle = makeUnit({ id: 'tank', playerId: 0, x: 210, y: 200, hp: 300, category: 'vehicle' })
    vehicle.def.stats = { maxHp: 600 }
    applyNeutralEffects([depot], [vehicle], HEAL_RANGE)
    expect(vehicle.hp).toBe(310)
  })

  it('repair depot does NOT heal infantry', () => {
    const depot = makeBuilding({ defId: 'neutral_repair_depot', playerId: 0, x: 200, y: 200 })
    const inf = makeUnit({ id: 'inf4', playerId: 0, x: 210, y: 200, hp: 50, category: 'infantry' })
    inf.def.stats = { maxHp: 100 }
    applyNeutralEffects([depot], [inf], HEAL_RANGE)
    expect(inf.hp).toBe(50)
  })

  it('hospital does not over-heal (caps at maxHp)', () => {
    const hospital = makeBuilding({ defId: 'neutral_hospital', playerId: 0, x: 200, y: 200 })
    const inf = makeUnit({ id: 'inf5', playerId: 0, x: 210, y: 200, hp: 98, category: 'infantry' })
    inf.def.stats = { maxHp: 100 }
    applyNeutralEffects([hospital], [inf], HEAL_RANGE)
    expect(inf.hp).toBe(100)
  })
})
