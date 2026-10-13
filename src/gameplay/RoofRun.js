import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { GROUPS } from '../core/Physics.js';
import { groundHeight } from '../world/WorldLayout.js';
import { smoothstep } from '../utils/math.js';

// Chhat Daud: the rooftop run. From the ghat below the haveli at the downstream end of the
// waterfront row, up its front chhajja by chhajja, then over five roofs (a ladder up, a plank,
// the balance beam, a drop, a plank) to the saffron flag on the last. Against the clock, and
// against his own chhaya: the shadow of his best run, played back beside him.
//
// The chhaya is a recording: every 1/20 s of a run, his place, his facing and the turn of each
// body bone (the fingers aside). The best run's recording is kept on this machine (localStorage,
// quantised: ~150 KB a minute) and drawn as a pale, glowing copy of Prady (one draw call).
// R restarts a run; a fall to the street or into the river sends him back to the start.

const COURSE = [351, 372, 394, 416, 437, 451]; // the roofs in order (bank x of each house)
const HZ = 20;
const KEY = 'prady-chhatdaud-ghost-v1';
const FINGERS = /Thumb|Index|Middle|Ring|Pinky/;
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function local(b, lx, lz) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}
/** Over building b's roof (its footprint, less a margin)? */
function over(b, x, z, pad = -0.3) {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad;
}
const top = (b) => b.baseY + b.h;

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

// ---------------------------------------------------------------- the flags
function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** A bamboo pole at (x, y, z) with a saffron pennant, marigolds round its foot. */
function flagGeometry(x, y, z, yaw, tall, big = false) {
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.045, 0.06, tall, 6);
  pole.translate(x, y + tall / 2, z);
  parts.push(colored(pole, 0xb99a62));
  for (let k = 1; k < 4; k++) {
    const ring = new THREE.CylinderGeometry(0.065, 0.065, 0.04, 6);
    ring.translate(x, y + (tall * k) / 4, z);
    parts.push(colored(ring, 0x8a6f3e));
  }
  // the pennant, two-tone like the ghats' dhwaja: saffron, its tail deeper
  const L = big ? 1.9 : 1.15;
  const H = big ? 1.0 : 0.62;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tri = (pts, color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(([u, v]) => [x + u * c, y + tall - 0.05 - v, z - u * s]), 3));
    geo.computeVertexNormals();
    parts.push(colored(geo, color));
  };
  tri([[0, 0], [0, H], [L * 0.62, H * 0.5]], 0xff8a1e);
  tri([[L * 0.62, H * 0.5], [0, H * 0.18], [L, H * 0.5]], 0xd8560c);
  tri([[L * 0.62, H * 0.5], [L, H * 0.5], [0, H * 0.82]], 0xd8560c);
  const garland = new THREE.TorusGeometry(big ? 0.34 : 0.24, 0.07, 5, 12);
  garland.rotateX(Math.PI / 2);
  garland.translate(x, y + 0.08, z);
  parts.push(colored(garland, 0xffa51f));
  return parts;
}

// ---------------------------------------------------------------- the chhaya
function ghostMaterial() {
  const fade = { value: 1 };
  // (normal blending, not additive: a shade of light must still show against a sunlit wall)
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc070, roughness: 1, transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = fade;
    sh.fragmentShader = `uniform float uFade;\n${sh.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      // a shadow edged with light: a smoky dusk-blue body (it shows against sunlit plaster and
      // sky) and a gold rim (it shows at night)
      float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(normal))), 1.8);
      vec3 col = mix(vec3(0.05, 0.045, 0.11), emissive * 2.4, smoothstep(0.15, 0.85, rim));
      gl_FragColor = vec4(col, (0.46 + 0.5 * rim) * uFade);`,
    );
  };
  m.userData.fade = fade;
  return m;
}

export class RoofRun {
  constructor(game) {
    this.g = game;
    this.phase = 'idle';
    this.marks = [];
    this.music = 0;
    this.best = null; // { time, splits }
    this.ghost = null; // the best run's recording, decoded
    this.ghostLoaded = false;
    const row = game.world.layout.buildings.filter((b) => b.row === 0);
    this.roofs = COURSE.map((x) => row.reduce((m, b) => (Math.abs(b.x - x) < Math.abs((m?.x ?? 1e9) - x) ? b : m), null));
    this.ok = this.roofs.every((b, i) => b && Math.abs(b.x - COURSE[i]) < 6);
    if (!this.ok) return;
    const b0 = this.roofs[0];
    // the start: on the ghat before the first haveli's front, facing it, below a line of
    // chhajjas with no wooden balcony across the way up (nearest the roof's far end)
    const lx = this.clearColumn(b0);
    const st = local(b0, lx, b0.d / 2 + 1.4);
    this.start = { x: st.x, y: groundHeight(st.x, st.z), z: st.z, yaw: Math.atan2(-Math.sin(b0.yaw), -Math.cos(b0.yaw)) };
    // (well to one side: the camera rises up the face behind him)
    const post = local(b0, lx + (lx > 0 ? -4.6 : 4.6), b0.d / 2 + 2.6);
    this.post = { x: post.x, y: groundHeight(post.x, post.z), z: post.z };
    // a flag on every roof of the course, the big one on the last
    const parts = flagGeometry(this.post.x, this.post.y, this.post.z, b0.yaw, 5.2, true);
    this.cps = this.roofs.map((b, i) => {
      const last = i === this.roofs.length - 1;
      const p = local(b, 0, last ? b.d / 2 - 1.6 : 0);
      if (i > 0) parts.push(...flagGeometry(p.x, top(b), p.z, b.yaw, last ? 4.6 : 3.1, last));
      return { b, x: p.x, y: top(b), z: p.z };
    });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
  }

  /** Along b's front (local x), the column the body can climb with nothing in its way. */
  clearColumn(b) {
    const P = this.g.physics;
    let best = 0;
    for (let lx = b.w / 2 - 2.2; lx > -b.w / 2 + 2.2; lx -= 0.4) {
      const o = local(b, lx, b.d / 2 + 0.55);
      const hit = P.sphereCastOnly({ x: o.x, y: b.baseY + 1.2, z: o.z }, { x: 0, y: 1, z: 0 }, 0.5, b.h, GROUPS.decor);
      if (hit === null) return lx;
      best = lx;
    }
    return best;
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** Feet held for the count. */
  get holdInput() {
    return this.phase === 'count';
  }

  // ---------------------------------------------------------------- starting
  interaction() {
    const g = this.g;
    if (!this.ok || this.active || g.player.state !== 'ground' || g.encounters.active || g.story?.cut || g.missions?.active) return null;
    if (Math.hypot(g.player.position.x - this.post.x, g.player.position.z - this.post.z) > 4) return null;
    const best = this.best ? ` · best ${fmt(this.best.time)}` : '';
    return { prompt: `Chhat Daud: race over the rooftops${best}`, action: () => this.begin() };
  }

  /** Fade, back to the start, count down. */
  begin() {
    const g = this.g;
    if (!this.ok || this.phase === 'count') return;
    this.loadGhost();
    g.ui.fadeBlack(true);
    this.phase = 'count';
    this.t = -10;
    g.after(0.6, () => {
      this.setup();
      g.ui.fadeBlack(false);
    });
  }

  setup() {
    const g = this.g;
    const S = this.start;
    g.traversal?.reset();
    g.player.teleport(S.x, S.y + 0.05, S.z);
    g.player.yaw = g.player.prevYaw = S.yaw;
    g.camRig.yaw = S.yaw;
    g.camRig.first = true;
    this.phase = 'count';
    this.t = 0;
    this.counted = -1;
    this.time = 0;
    this.next = 0;
    this.splits = [];
    this.rec = { pos: [], quat: [], t: 0 };
    this.result = null;
    if (this.ghostRoot) this.ghostRoot.visible = !!this.ghost;
    this.hud();
    if (!this.toldOnce) {
      this.toldOnce = true;
      g.ui.toast('Chhat Daud', 'Up the haveli, then over every roof to the saffron flag · R to restart', 4.5);
    }
  }

  /** Back to the start at once (R, or after a fall). */
  restart() {
    if (this.phase === 'idle') return;
    this.begin();
  }

  stop(note) {
    if (!this.active) return;
    const g = this.g;
    if (note) g.ui.toast('Chhat Daud abandoned', note, 3);
    this.phase = 'idle';
    this.marks = [];
    if (this.ghostRoot) this.ghostRoot.visible = false;
    g.ui.setRace(null);
    g.ui.countdown('');
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.g;
    this.music += ((this.phase === 'run' ? 1 : 0) - this.music) * Math.min(1, dt * (this.phase === 'run' ? 1.2 : 0.3));
    if (this.phase === 'idle') return;
    this.t += dt;
    if (this.t < 0) return; // (the fade)
    const p = g.player;
    if (this.phase === 'count') {
      const n = Math.floor(this.t - 0.6);
      if (n > this.counted && n >= 0) {
        this.counted = n;
        if (n < 3) {
          g.ui.countdown(String(3 - n));
          g.audio.play('thump', { volume: 0.9, rate: 0.55 });
        } else {
          g.ui.countdown('Chalo!');
          g.audio.play('conch', { volume: 0.7 });
          this.phase = 'run';
          this.time = 0;
        }
      }
    } else if (this.phase === 'run') {
      this.time += dt;
      // off the course: the street, the river, a boat, the dark
      const P = p.position;
      const lo = this.next > 0 ? top(this.roofs[this.next - 1]) - 6 : -Infinity;
      if (g.asuras?.active) return this.stop('Not while the dark is near.');
      if (p.state === 'boat') return this.stop();
      if (p.feetY < lo || p.state === 'swim' || p.state === 'dive') return this.fell();
      if (this.next === 0 && Math.hypot(P.x - this.start.x, P.z - this.start.z) > 30) return this.stop('You left the course.');
      const C = this.cps[this.next];
      if (over(C.b, P.x, P.z) && p.feetY > top(C.b) - 0.4 && p.state !== 'climb') this.reached();
    } else if (this.phase === 'fallen') {
      if (this.t > 1.3) this.begin();
    } else if (this.phase === 'done') {
      if (this.t > 6 || Math.hypot(p.position.x - this.cps.at(-1).x, p.position.z - this.cps.at(-1).z) > 40) this.stop();
    }
    const C = this.cps[Math.min(this.next, this.cps.length - 1)];
    this.marks = this.phase === 'run' || this.phase === 'count' ? [{ kind: 'objective', pos: { x: C.x, y: C.y + 1.8, z: C.z }, compass: true }] : [];
    if (this.phase !== 'fallen') this.hud();
  }

  reached() {
    const g = this.g;
    this.splits.push(this.time);
    const k = this.next;
    this.next++;
    const prev = this.best?.splits?.[k];
    const delta = prev !== undefined ? this.time - prev : null;
    const vs = delta === null ? '' : ` · ${Math.abs(delta).toFixed(1)} s ${delta <= 0 ? 'ahead of' : 'behind'} your chhaya`;
    if (this.next >= this.cps.length) return this.finish();
    g.audio.play('bell', { volume: 0.32, rate: 1.6 });
    if (k > 0 || delta !== null) g.ui.toast('', `Roof ${k + 1} · ${fmt(this.time)}${vs}`, 1.8);
  }

  finish() {
    const g = this.g;
    const t = this.time;
    const first = !this.best;
    const best = first || t < this.best.time;
    const was = this.best?.time;
    this.phase = 'done';
    this.t = 0;
    this.marks = [];
    g.audio.play('conch', { volume: 0.8 });
    g.ui.countdown(best ? 'Shabash!' : fmt(t));
    const punya = first ? 5 : best ? 2 : 0;
    if (punya && g.missions) {
      g.missions.punya += punya;
      g.ui.setPunya(g.missions.punya);
    }
    const head = first ? 'Over the rooftops of Kashi' : best ? 'A new best' : 'Your chhaya was faster';
    const body = `${fmt(t)}${was !== undefined ? (best ? ` · ${(was - t).toFixed(1)} s better than your chhaya` : ` · best ${fmt(was)}`) : ''}${punya ? ` · +${punya} punya` : ''}`;
    g.ui.toast(head, body, 6);
    if (best) {
      this.best = { time: t, splits: [...this.splits] };
      this.saveGhost(t);
    }
    g.save?.();
  }

  fell() {
    const g = this.g;
    this.phase = 'fallen';
    this.t = 0;
    this.marks = [];
    g.ui.toast('Gir gaye!', 'Back to the ghat to run it again', 1.6);
  }

  hud() {
    const g = this.g;
    if (!this.cps || this.next === undefined) return;
    const n = this.cps.length;
    const gate = this.phase === 'done' ? 'Finished' : this.next === 0 ? 'Up the haveli' : this.next === n - 1 ? 'To the saffron flag' : `Roof ${this.next + 1} of ${n}`;
    const time = fmt(this.phase === 'done' ? this.splits.at(-1) : this.time);
    if (!this.ghost) return g.ui.setRace({ title: 'Chhat Daud', pos: null, time, gate, board: [] });
    // ahead or behind the chhaya: roofs reached, then the distance to the next one
    const P = g.player.position;
    const G = this.ghostRoot.position;
    const gNext = this.ghost.splits.filter((s) => s <= this.time).length;
    const prog = (k, x, z) => (k >= n ? 1e6 : k * 1000 - Math.hypot(x - this.cps[k].x, z - this.cps[k].z));
    const me = this.phase === 'done' ? 1e6 + 1 : prog(this.next, P.x, P.z);
    const sh = gNext >= n ? 1e6 + (this.phase === 'done' && this.splits.at(-1) < this.ghost.time ? 0 : 2) : prog(gNext, G.x, G.z);
    const ahead = me >= sh;
    const board = [
      { name: 'Prady', you: true, done: this.phase === 'done' },
      { name: `Chhaya · ${fmt(this.ghost.time)}`, you: false, done: gNext >= n },
    ];
    g.ui.setRace({ title: 'Chhat Daud', pos: ahead ? 1 : 2, of: 2, time, gate, board: ahead ? board : board.reverse() });
  }

  // ---------------------------------------------------------------- the recording, the chhaya
  /** Prady's body bones (the same order in him and in his chhaya). */
  bodyBones(root) {
    const out = [];
    root.traverse((o) => o.isBone && !FINGERS.test(o.name) && out.push(o));
    return out;
  }

  /** After every pose and IK of the frame: sample him, and pose the chhaya. */
  late() {
    if (this.phase === 'idle' || this.t < 0) return;
    const g = this.g;
    const W = g.character;
    if (this.phase === 'run' && this.rec) {
      this.myBones ||= this.bodyBones(W);
      const R = this.rec;
      while (R.t <= this.time && R.pos.length < 6 * HZ * 600) {
        const hips = this.myBones[0];
        R.pos.push(W.position.x, W.position.y, W.position.z, hips.position.x, hips.position.y, hips.position.z);
        R.quat.push(W.quaternion.x, W.quaternion.y, W.quaternion.z, W.quaternion.w);
        for (const b of this.myBones) R.quat.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        R.t += 1 / HZ;
      }
    }
    const G = this.ghost;
    if (!G || !this.ghostRoot) return;
    const t = this.phase === 'count' ? 0 : this.phase === 'done' ? this.splits.at(-1) + this.t : this.time;
    const f = Math.min(t * HZ, G.n - 1);
    const i = Math.floor(f);
    const j = Math.min(i + 1, G.n - 1);
    const a = f - i;
    const lp = (k) => G.pos[i * 6 + k] + (G.pos[j * 6 + k] - G.pos[i * 6 + k]) * a;
    const root = this.ghostRoot;
    root.position.set(lp(0), lp(1), lp(2));
    const stride = (G.nb + 1) * 4;
    const q = [0, 0, 0, 0];
    THREE.Quaternion.slerpFlat(q, 0, G.quat, i * stride, G.quat, j * stride, a);
    root.quaternion.fromArray(q);
    this.ghostBones.forEach((b, k) => {
      if (!b) return;
      THREE.Quaternion.slerpFlat(q, 0, G.quat, i * stride + (k + 1) * 4, G.quat, j * stride + (k + 1) * 4, a);
      b.quaternion.fromArray(q);
    });
    this.ghostBones[0]?.position.set(lp(3), lp(4), lp(5));
    root.updateMatrixWorld(true);
    // fainter over him, gone once its run is over
    const d = root.position.distanceTo(W.position);
    const end = smoothstep(G.n / HZ + 1.2, G.n / HZ, t);
    this.ghostMat.userData.fade.value = (0.2 + 0.8 * smoothstep(0.5, 2.2, d)) * end;
    root.visible = end > 0.01;
  }

  /** The chhaya's body: a copy of Prady's skinned mesh in a glowing shade material. */
  makeGhostBody() {
    if (this.ghostRoot) return;
    const g = this.g;
    const src = g.character.children[0];
    if (!src) return;
    const body = cloneSkinned(src);
    const drop = [];
    this.ghostMat = ghostMaterial();
    body.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = this.ghostMat;
        o.castShadow = o.receiveShadow = false;
        o.frustumCulled = false;
      } else if (o.isMesh || o.isPoints || o.isLine || o.isSprite || o.isLight) drop.push(o);
    });
    for (const o of drop) o.parent?.remove(o);
    this.ghostRoot = new THREE.Group();
    this.ghostRoot.name = 'chhaya';
    body.traverse((o) => o.isSkinnedMesh && (o.renderOrder = 5));
    this.ghostRoot.add(body);
    this.ghostRoot.visible = false;
    g.scene.add(this.ghostRoot);
    this.ghostBody = body;
  }

  /** Map a recording's bones (by name) onto the chhaya's. */
  bindGhost() {
    const byName = new Map(this.bodyBones(this.ghostBody).map((b) => [b.name, b]));
    this.ghostBones = this.ghost.names.map((n) => byName.get(n) || null);
  }

  loadGhost() {
    if (this.ghostLoaded) return;
    this.ghostLoaded = true;
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      d = null;
    }
    if (!d?.pos || !d?.quat || !d?.names || !this.best) return;
    // (a recording of another best than the save's: a different save on this machine)
    if (Math.abs((d.time ?? -1) - this.best.time) > 0.05) return;
    try {
      const pos = new Float32Array(unb64(d.pos).buffer);
      const qi = new Int16Array(unb64(d.quat).buffer);
      const quat = new Float32Array(qi.length);
      for (let k = 0; k < qi.length; k++) quat[k] = qi[k] / 32767;
      this.ghost = { n: pos.length / 6, nb: d.names.length, names: d.names, pos, quat, time: d.time, splits: d.splits || this.best.splits };
      this.makeGhostBody();
      this.bindGhost();
    } catch {
      this.ghost = null;
    }
  }

  saveGhost(time) {
    const R = this.rec;
    if (!R || R.pos.length < 12) return;
    this.myBones ||= this.bodyBones(this.g.character);
    const names = this.myBones.map((b) => b.name);
    const pos = new Float32Array(R.pos);
    const quat = new Float32Array(R.quat);
    const qi = new Int16Array(quat.length);
    for (let k = 0; k < quat.length; k++) qi[k] = Math.round(Math.max(-1, Math.min(1, quat[k])) * 32767);
    // this run is the chhaya now (from the quantised numbers, as it will load next time)
    const deq = new Float32Array(qi.length);
    for (let k = 0; k < qi.length; k++) deq[k] = qi[k] / 32767;
    this.ghost = { n: pos.length / 6, nb: names.length, names, pos, quat: deq, time, splits: [...this.splits] };
    this.makeGhostBody();
    this.bindGhost();
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, hz: HZ, time, splits: this.splits, names, pos: b64(new Uint8Array(pos.buffer)), quat: b64(new Uint8Array(qi.buffer)) }));
    } catch {
      // (no room, or no storage: the chhaya lasts this session)
    }
  }

  serialize() {
    return this.best;
  }

  restore(d) {
    this.best = d && typeof d.time === 'number' ? { time: d.time, splits: Array.isArray(d.splits) ? d.splits : [] } : null;
    this.ghost = null;
    this.ghostLoaded = false;
    if (this.ghostRoot) this.ghostRoot.visible = false;
  }
}
