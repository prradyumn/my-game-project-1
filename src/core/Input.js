// Keyboard + mouse (pointer lock) + gamepad, normalised into one small state object.
//
// Rebinding: the game asks for keys by their default codes ('KeyE' is always "interact"). A key
// the player rebinds is translated on the way in: their key arrives as the action's default code,
// and the default key itself goes quiet (or does whatever action took it over in a swap).

/** The rebindable actions (keyboard). id, label, default code. */
export const ACTIONS = [
  { id: 'forward', label: 'Move forward', key: 'KeyW' },
  { id: 'back', label: 'Move back', key: 'KeyS' },
  { id: 'left', label: 'Move left', key: 'KeyA' },
  { id: 'right', label: 'Move right', key: 'KeyD' },
  { id: 'jump', label: 'Jump · swim up', key: 'Space' },
  { id: 'sprint', label: 'Sprint', key: 'ShiftLeft' },
  { id: 'dodge', label: 'Dodge roll · dive', key: 'KeyC' },
  { id: 'interact', label: 'Interact · finisher', key: 'KeyE' },
  { id: 'guard', label: 'Guard · parry', key: 'KeyQ' },
  { id: 'sword', label: 'Draw / sheathe talwar', key: 'KeyR' },
  { id: 'lock', label: 'Lock on', key: 'Tab' },
  { id: 'damaru', label: 'Power: Shiva’s Damaru', key: 'Digit1' },
  { id: 'trishul', label: 'Power: Trishul', key: 'Digit2' },
  { id: 'thirdEye', label: 'Power: Third Eye', key: 'Digit3' },
  { id: 'journal', label: 'Journal · map · siddhis', key: 'KeyJ' },
  { id: 'diya', label: 'Float a diya', key: 'KeyF' },
  { id: 'greet', label: 'Pranam (greet)', key: 'KeyG' },
  { id: 'meditate', label: 'Meditate', key: 'KeyM' },
  { id: 'walk', label: 'Toggle walk', key: 'KeyX' },
  { id: 'night', label: 'Night / dawn', key: 'KeyN' },
  { id: 'photo', label: 'Photo mode', key: 'KeyP' },
];

/** A readable name for a key code ('KeyE' -> 'E'). */
export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;
    this.usingPad = false; // the last thing touched was a gamepad (prompts show its buttons)
    this.remap = new Map(); // physical code -> the default code of the action bound to it
    this.listen = null; // (code) => void: the next key press goes here (the controls screen)

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.listen) {
        e.preventDefault();
        const f = this.listen;
        this.listen = null;
        f(e.code);
        return;
      }
      // Cmd or Option frees the mouse without pausing (the system screenshot tools, another
      // window); a click on the game takes it back. (Keys held with Cmd may never send a keyup
      // on macOS: forget them so nothing sticks down.)
      if (/^(Meta|Alt)(Left|Right)$/.test(e.code)) {
        this.keys.clear();
        if (this.locked) {
          this.freed = true;
          document.exitPointerLock();
        }
        return;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F9'].includes(e.code)) e.preventDefault();
      const code = this.translate(e.code);
      this.usingPad = false;
      if (!code) return;
      if (code === 'Tab' || code === 'Space') e.preventDefault();
      this.keys.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('keyup', (e) => {
      const code = this.translate(e.code);
      if (code) this.keys.delete(code);
    });
    // mouse buttons as keys (Mouse0 left, Mouse2 right) while the pointer is locked: the click
    // that locks it never counts as an attack
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.keys.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
  }

  /**
   * Apply the player's bindings ({ action id: code }). Every action's key arrives as its default
   * code; a default key that now belongs to no action is ignored.
   */
  setBindings(bindings = {}) {
    this.remap.clear();
    this.keys.clear();
    const owned = new Set();
    for (const a of ACTIONS) {
      const phys = bindings[a.id] || a.key;
      this.remap.set(phys, a.key);
      owned.add(phys);
    }
    this.quiet = new Set(ACTIONS.map((a) => a.key).filter((k) => !owned.has(k)));
  }

  translate(code) {
    const m = this.remap.get(code);
    if (m) return m;
    return this.quiet?.has(code) ? null : code;
  }

  /** The key the player presses for an action (by its default code), for prompts. */
  keyFor(defaultCode) {
    for (const [phys, logical] of this.remap) if (logical === defaultCode) return phys;
    return defaultCode;
  }

  requestLock() {
    if (this.locked) return;
    try {
      this.canvas.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      /* not allowed without a user gesture; the next click will lock */
    }
  }

  exitLock() {
    if (this.locked) document.exitPointerLock();
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  // Movement axes in [-1, 1]: x = strafe (right +), y = forward (+)
  move() {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const gp = this.gamepad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      x += dz(gp.axes[0]);
      y -= dz(gp.axes[1]);
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  look() {
    let dx = this.mouseDX;
    let dy = this.mouseDY;
    const gp = this.gamepad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      dx += dz(gp.axes[2]) * 14;
      dy += dz(gp.axes[3]) * 10;
    }
    return { dx, dy };
  }

  gamepad() {
    const pads = navigator.getGamepads?.();
    if (!pads) return null;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  gpButton(i) {
    const gp = this.gamepad();
    return !!gp && !!gp.buttons[i]?.pressed;
  }

  // Call at the end of every frame.
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    const gp = this.gamepad();
    const prev = this._gpPrev || [];
    if (gp) {
      gp.buttons.forEach((b, i) => {
        if (b.pressed && !prev[i]) {
          this.pressed.add(`Pad${i}`);
          this.usingPad = true;
        }
      });
      this._gpPrev = gp.buttons.map((b) => b.pressed);
      // the left stick as a d-pad for menus (edge-triggered, with a held repeat)
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const dir = Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6 ? (Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up') : null;
      if (dir) this.usingPad = true;
      this._stickT = dir && dir === this._stickDir ? this._stickT - 1 : 0;
      if (dir && (dir !== this._stickDir || this._stickT <= -18)) {
        this.pressed.add(`Stick${dir}`);
        if (this._stickT <= -18) this._stickT = -12;
      }
      this._stickDir = dir;
    }
  }
}
