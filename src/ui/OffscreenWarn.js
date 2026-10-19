import * as THREE from 'three';

// A blow coming from where Prady can't see it (as Ghost of Tsushima and the Arkham games warn of
// one): an Asura behind or beside the frame winding up shows a pulsing mark at the screen's edge,
// pointing at it, red for a blow that can't be guarded; a quiet cue sounds once as it starts.
// Pooled DOM marks over the canvas.

const MAX = 4;
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

export class OffscreenWarn {
  constructor(audio) {
    this.audio = audio;
    this.root = document.createElement('div');
    this.root.className = 'offwarn';
    this.root.innerHTML = `<style>
.offwarn{position:fixed;inset:0;pointer-events:none;z-index:16}
.offwarn i{position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0;
 background:radial-gradient(circle at 50% 50%,rgba(255,190,90,.95) 0 22%,rgba(255,120,30,.55) 23% 45%,transparent 47%);
 clip-path:polygon(50% 0,100% 100%,50% 78%,0 100%);filter:drop-shadow(0 0 6px rgba(255,120,30,.9))}
.offwarn i.red{background:radial-gradient(circle at 50% 50%,rgba(255,90,90,1) 0 24%,rgba(220,20,30,.6) 25% 46%,transparent 48%);filter:drop-shadow(0 0 8px rgba(255,30,30,1))}
</style>`;
    this.marks = [];
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('i');
      this.root.appendChild(el);
      this.marks.push(el);
    }
    document.body.appendChild(this.root);
    this.warned = new WeakMap();
    this.t = 0;
  }

  update(dt, camera, list, player) {
    this.t += dt;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let n = 0;
    for (const a of list || []) {
      if (n >= MAX) break;
      if (!a.alive || a.state !== 'attack' || a.struck) continue;
      if (Math.hypot(a.pos.x - player.position.x, a.pos.z - player.position.z) > 9) continue;
      _p.set(a.pos.x, a.pos.y + (a.height || 1.8) * 0.6, a.pos.z);
      _c.copy(_p).project(camera);
      const behind = _c.z > 1;
      const onScreen = !behind && Math.abs(_c.x) < 0.92 && Math.abs(_c.y) < 0.9;
      if (onScreen) continue;
      // the cue, once per wind-up
      if (this.warned.get(a) !== a.attack) {
        this.warned.set(a, a.attack);
        this.audio?.play('glint', { volume: 0.35, rate: 0.75 });
      }
      // the edge of the screen in its direction (behind the lens, the projection flips)
      let x = behind ? -_c.x : _c.x;
      let y = behind ? -_c.y : _c.y;
      if (behind && Math.abs(x) < 0.05 && Math.abs(y) < 0.05) y = -1;
      const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      x *= k;
      y *= k;
      const sx = (x * 0.5 + 0.5) * w;
      const sy = (-y * 0.5 + 0.5) * h;
      const ang = Math.atan2(x, y);
      const el = this.marks[n++];
      el.className = a.attack?.unblockable ? 'red' : '';
      el.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px) rotate(${ang.toFixed(3)}rad) scale(${(1 + 0.18 * Math.sin(this.t * 18)).toFixed(3)})`;
      el.style.opacity = '1';
    }
    for (let i = n; i < MAX; i++) this.marks[i].style.opacity = '0';
  }
}
