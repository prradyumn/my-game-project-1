// Keyboard + mouse (pointer lock) + gamepad, normalised into one small state object.

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

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
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
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
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
