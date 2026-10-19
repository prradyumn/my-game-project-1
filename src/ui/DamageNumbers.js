import * as THREE from 'three';

// The damage a blow does, shown where it landed: a small numeral that pops (overshoot), drifts
// up and to the side, and fades in under a second. A light cut is a small saffron figure, a heavy
// blow, a kick or a charged one a larger gold one, a killing blow larger still. Pooled DOM
// elements over the canvas, placed from the world point each frame. Settings: Damage numbers.

const POOL = 24;
const _p = new THREE.Vector3();

export class DamageNumbers {
  constructor(root) {
    this.root = document.createElement('div');
    this.root.className = 'dmg-layer';
    const st = document.createElement('style');
    st.textContent = `
.dmg-layer{position:fixed;inset:0;pointer-events:none;z-index:15;overflow:hidden}
.dmg{position:absolute;left:0;top:0;font:700 20px/1 'Cinzel','Georgia',serif;color:#ffbe55;letter-spacing:.02em;
 text-shadow:0 0 6px rgba(120,40,0,.85),0 2px 0 #4a1a00,0 0 1px #000;will-change:transform,opacity;white-space:nowrap}
.dmg.big{font-size:30px;color:#ffd77a;text-shadow:0 0 10px rgba(255,120,20,.9),0 2px 0 #5a2200,0 0 1px #000}
.dmg.kill{font-size:38px;color:#fff1c2;text-shadow:0 0 14px rgba(255,90,20,1),0 3px 0 #5a1a00}
.dmg.crit{color:#fff4dc}
.dmg i{display:block;font-style:normal;font-size:12px;letter-spacing:.32em;margin:0 0 3px .32em;color:#ff5a2a;text-shadow:0 0 8px rgba(255,60,10,.95),0 1px 0 #3a0a00}`;
    document.head.appendChild(st);
    (root || document.body).appendChild(this.root);
    this.items = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.opacity = '0';
      this.root.appendChild(el);
      this.items.push({ el, t: 1, life: 0.8, at: new THREE.Vector3(), dx: 0, s: 1 });
    }
    this.i = 0;
    this.enabled = true;
  }

  /** at: world point; n: the damage; kind: 'light' | 'big' | 'kill'; crit: CRITICAL over it. */
  show(at, n, kind = 'light', crit = false) {
    if (!this.enabled || !(n > 0.5)) return;
    const it = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    it.at.set(at.x, at.y, at.z);
    it.t = 0;
    it.life = kind === 'kill' ? 1.1 : kind === 'big' ? 0.95 : 0.75;
    it.dx = (Math.random() - 0.5) * 40;
    it.s = kind === 'kill' ? 1.25 : kind === 'big' ? 1.1 : 1;
    it.el.className = `dmg${kind === 'light' ? '' : ` ${kind}`}${crit ? ' crit' : ''}`;
    if (crit) {
      it.s *= 1.15;
      it.life += 0.2;
      it.el.innerHTML = `<i>CRITICAL</i>${Math.round(n)}`;
    } else it.el.textContent = String(Math.round(n));
  }

  update(dt, camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const it of this.items) {
      if (it.t >= it.life) continue;
      it.t += dt;
      const k = Math.min(1, it.t / it.life);
      _p.copy(it.at).project(camera);
      if (_p.z > 1 || k >= 1) {
        it.el.style.opacity = '0';
        continue;
      }
      const x = (_p.x * 0.5 + 0.5) * w + it.dx * k;
      const y = (-_p.y * 0.5 + 0.5) * h - 70 * (1 - (1 - k) * (1 - k));
      // pop: overshoot in the first tenth, settle, shrink a little as it goes
      const pop = k < 0.1 ? 0.4 + (k / 0.1) * 0.9 : k < 0.2 ? 1.3 - ((k - 0.1) / 0.1) * 0.3 : 1 - (k - 0.2) * 0.15;
      it.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${(pop * it.s).toFixed(3)})`;
      it.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }
}
