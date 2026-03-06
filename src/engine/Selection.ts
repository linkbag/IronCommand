import Phaser from 'phaser'

// ── Selection System ──────────────────────────────────────────
// Handles: click select, box select, shift+click, Ctrl+1-9 groups,
//          double-click to select all of same type on screen.

export interface SelectableEntity {
  id: string
  type: string          // unit type name for double-click grouping
  x: number            // world position
  y: number
  width: number        // entity screen footprint for hit testing
  height: number
}

export type SelectionChangedCallback = (selectedIds: string[]) => void

export class SelectionManager {
  private scene: Phaser.Scene
  private selected: Set<string> = new Set()
  private groups: Map<number, string[]> = new Map()  // Ctrl+1-9
  private boxGraphics: Phaser.GameObjects.Graphics

  private isDragging = false
  private dragStart = { x: 0, y: 0 }
  private dragEnd   = { x: 0, y: 0 }

  private lastClickTime = 0
  private lastClickEntityType = ''
  private DOUBLE_CLICK_MS = 300

  private onChanged: SelectionChangedCallback | null = null

  // Registry of all known selectable entities (updated each frame by game)
  private entities: SelectableEntity[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.boxGraphics = scene.add.graphics()
    this.boxGraphics.setDepth(100)

    this.setupInputListeners()
  }

  setEntities(entities: SelectableEntity[]): void {
    this.entities = entities
  }

  onSelectionChanged(cb: SelectionChangedCallback): void {
    this.onChanged = cb
  }

  getSelected(): string[] {
    return Array.from(this.selected)
  }

  // ── Input Setup ───────────────────────────────────────────────

  private setupInputListeners(): void {
    const { input } = this.scene

    // Pointer down: start box drag
    input.on(Phaser.Input.Events.POINTER_DOWN, (ptr: Phaser.Input.Pointer) => {
      if (ptr.rightButtonDown()) return
      this.isDragging = true
      const wp = this.pointerToWorld(ptr)
      this.dragStart = { x: wp.x, y: wp.y }
      this.dragEnd   = { x: wp.x, y: wp.y }
    })

    // Pointer move: update drag box
    input.on(Phaser.Input.Events.POINTER_MOVE, (ptr: Phaser.Input.Pointer) => {
      if (!this.isDragging) return
      const wp = this.pointerToWorld(ptr)
      this.dragEnd = { x: wp.x, y: wp.y }
      this.drawSelectionBox()
    })

    // Pointer up: finalize selection
    input.on(Phaser.Input.Events.POINTER_UP, (ptr: Phaser.Input.Pointer) => {
      if (!this.isDragging) return
      this.isDragging = false
      this.boxGraphics.clear()

      const wp = this.pointerToWorld(ptr)
      const dx = Math.abs(wp.x - this.dragStart.x)
      const dy = Math.abs(wp.y - this.dragStart.y)

      if (dx < 5 && dy < 5) {
        // Single click
        this.handleClick(wp.x, wp.y, ptr.event.shiftKey)
      } else {
        // Box select
        this.handleBoxSelect(ptr.event.shiftKey)
      }
    })

    // Keyboard: Ctrl+1-9 save/recall groups, number recall
    const kb = input.keyboard
    if (kb) {
      // Ctrl+1-9 to save group
      for (let i = 1; i <= 9; i++) {
        const key = kb.addKey(Phaser.Input.Keyboard.KeyCodes[`NUMPAD_${i}` as keyof typeof Phaser.Input.Keyboard.KeyCodes] ?? 48 + i)
        key.on('down', (evt: KeyboardEvent) => {
          if (evt.ctrlKey) {
            this.saveGroup(i)
          } else {
            this.recallGroup(i)
          }
        })
      }

      // Number row 1-9 to recall groups
      const numKeys = [
        Phaser.Input.Keyboard.KeyCodes.ONE,
        Phaser.Input.Keyboard.KeyCodes.TWO,
        Phaser.Input.Keyboard.KeyCodes.THREE,
        Phaser.Input.Keyboard.KeyCodes.FOUR,
        Phaser.Input.Keyboard.KeyCodes.FIVE,
        Phaser.Input.Keyboard.KeyCodes.SIX,
        Phaser.Input.Keyboard.KeyCodes.SEVEN,
        Phaser.Input.Keyboard.KeyCodes.EIGHT,
        Phaser.Input.Keyboard.KeyCodes.NINE,
      ]
      numKeys.forEach((code, idx) => {
        const key = kb.addKey(code)
        key.on('down', (evt: KeyboardEvent) => {
          if (evt.ctrlKey) {
            this.saveGroup(idx + 1)
          } else {
            this.recallGroup(idx + 1)
          }
        })
      })
    }
  }

  // ── Click Handling ────────────────────────────────────────────

  private handleClick(worldX: number, worldY: number, shift: boolean): void {
    const hit = this.entityAt(worldX, worldY)
    const now = Date.now()

    if (hit) {
      // Double-click: select all of same type on screen
      if (
        now - this.lastClickTime < this.DOUBLE_CLICK_MS &&
        hit.type === this.lastClickEntityType
      ) {
        this.selectAllOfTypeOnScreen(hit.type, shift)
        this.lastClickTime = 0
        return
      }
      this.lastClickTime = now
      this.lastClickEntityType = hit.type

      if (shift) {
        // Shift+click: toggle in/out of selection
        if (this.selected.has(hit.id)) {
          this.selected.delete(hit.id)
        } else {
          this.selected.add(hit.id)
        }
      } else {
        this.selected.clear()
        this.selected.add(hit.id)
      }
    } else {
      // Click empty space: deselect (unless shift)
      if (!shift) {
        this.selected.clear()
        this.lastClickTime = 0
      }
    }

    this.emit()
  }

  private handleBoxSelect(shift: boolean): void {
    const minX = Math.min(this.dragStart.x, this.dragEnd.x)
    const maxX = Math.max(this.dragStart.x, this.dragEnd.x)
    const minY = Math.min(this.dragStart.y, this.dragEnd.y)
    const maxY = Math.max(this.dragStart.y, this.dragEnd.y)

    if (!shift) this.selected.clear()

    for (const ent of this.entities) {
      const ex = ent.x, ey = ent.y
      const hw = ent.width / 2, hh = ent.height / 2
      if (ex + hw >= minX && ex - hw <= maxX && ey + hh >= minY && ey - hh <= maxY) {
        this.selected.add(ent.id)
      }
    }

    this.emit()
  }

  private selectAllOfTypeOnScreen(type: string, shift: boolean): void {
    const cam = this.scene.cameras.main
    const bounds = cam.worldView

    if (!shift) this.selected.clear()

    for (const ent of this.entities) {
      if (ent.type === type && bounds.contains(ent.x, ent.y)) {
        this.selected.add(ent.id)
      }
    }

    this.emit()
  }

  private entityAt(worldX: number, worldY: number): SelectableEntity | null {
    // Iterate in reverse so top-drawn entities (higher index) take priority
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const ent = this.entities[i]
      const hw = ent.width / 2, hh = ent.height / 2
      if (
        worldX >= ent.x - hw && worldX <= ent.x + hw &&
        worldY >= ent.y - hh && worldY <= ent.y + hh
      ) {
        return ent
      }
    }
    return null
  }

  // ── Control Groups ────────────────────────────────────────────

  saveGroup(n: number): void {
    this.groups.set(n, Array.from(this.selected))
  }

  recallGroup(n: number): void {
    const group = this.groups.get(n)
    if (!group || group.length === 0) return
    this.selected.clear()
    for (const id of group) this.selected.add(id)
    this.emit()
  }

  // ── Visual Feedback ───────────────────────────────────────────

  private drawSelectionBox(): void {
    if (!this.isDragging) return
    const g = this.boxGraphics
    g.clear()

    const x = Math.min(this.dragStart.x, this.dragEnd.x)
    const y = Math.min(this.dragStart.y, this.dragEnd.y)
    const w = Math.abs(this.dragEnd.x - this.dragStart.x)
    const h = Math.abs(this.dragEnd.y - this.dragStart.y)

    g.lineStyle(1, 0x00ff44, 1)
    g.fillStyle(0x00ff44, 0.08)
    g.fillRect(x, y, w, h)
    g.strokeRect(x, y, w, h)
  }

  // ── Utilities ─────────────────────────────────────────────────

  private pointerToWorld(ptr: Phaser.Input.Pointer): { x: number; y: number } {
    const cam = this.scene.cameras.main
    return cam.getWorldPoint(ptr.x, ptr.y)
  }

  private emit(): void {
    this.onChanged?.(Array.from(this.selected))
  }

  /** Force-set selected IDs (for external use e.g. game state restore) */
  setSelected(ids: string[]): void {
    this.selected.clear()
    for (const id of ids) this.selected.add(id)
    this.emit()
  }

  clearSelection(): void {
    this.selected.clear()
    this.emit()
  }
}
