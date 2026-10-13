import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp } from '../../utils/math.js';
import { makeWaterAware } from '../../world/materials.js';
import { groundHeight } from '../../world/WorldLayout.js';
import { ghatById, waterEdge } from './places.js';

// The Drowned Sanctum. Ratneshwar leans; its first sanctum, they say, didn't lean: it sank, out
// past the temple, onto the bed of the Ganga, and no lamp has burned for its Mahadev since.
// Kallu the boatman gives Prady an akhand jyoti sealed in glass by the pandas (it burns under
// water: HandDiya, sealed) and asks him to take it down.
//
// Out in the dark water: the ruin on the riverbed, its doorway black. Inside, silt, broken gods,
// the lingam in the middle, and the Naga that guards it — a serpent as long as a boat that glides
// past in the dark, brushing him (it takes his breath). Bubbles rise from cracks in the bed:
// breathe from them. Set the lamp before the lingam and the sanctum lights gold, the bells of the
// drowned temple ring under the water, and the Naga coils round the lingam and lowers its head.

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- the ruin (one draw call)
function ruinGeometry() {
  const parts = [];
  const C = (r, g, b) => new THREE.Color(r, g, b);
  const box = (w, h, d, x, y, z, c, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateX(rx);
    g.rotateZ(rz);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      const k = 0.85 + Math.random() * 0.3;
      a.set([c.r * k, c.g * k, c.b * k], i * 3);
      // the stone at its real size (~2 m a tile), whichever way the face looks
      const ax = Math.abs(N.getX(i));
      const ay = Math.abs(N.getY(i));
      if (ax > 0.6) uv.setXY(i, P.getZ(i) * 0.5, P.getY(i) * 0.5);
      else if (ay > 0.6) uv.setXY(i, P.getX(i) * 0.5, P.getZ(i) * 0.5);
      else uv.setXY(i, P.getX(i) * 0.5, P.getY(i) * 0.5);
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    parts.push(g.toNonIndexed());
  };
  const stone = C(0.36, 0.34, 0.27);
  const moss = C(0.2, 0.27, 0.16);
  // floor, walls (a doorway on the shore side, +z), the roof broken open on one side
  box(7.4, 0.4, 7.4, 0, 0.2, 0, moss);
  box(7.4, 3.4, 0.5, 0, 1.9, -3.45, stone);
  box(0.5, 3.4, 7.4, -3.45, 1.9, 0, stone);
  box(0.5, 3.4, 7.4, 3.45, 1.9, 0, stone);
  box(2.8, 3.4, 0.5, -2.3, 1.9, 3.45, stone);
  box(2.8, 3.4, 0.5, 2.3, 1.9, 3.45, stone);
  box(1.6, 1.2, 0.5, 0, 3.0, 3.45, stone); // over the door
  box(7.6, 0.45, 4.2, 0, 3.8, -1.7, stone, 0.06); // what is left of the roof
  box(3.2, 0.4, 2.6, 2.0, 1.0, 1.6, stone, 0.5, -0.9); // a slab fallen in
  // four pillars, one broken
  for (const [x, z, h] of [[-1.9, -1.9, 3.2], [1.9, -1.9, 3.2], [-1.9, 1.9, 3.2], [1.9, 1.9, 1.3]]) box(0.42, h, 0.42, x, 0.4 + h / 2, z, stone);
  // the yoni and the lingam in the middle
  const yoni = new THREE.CylinderGeometry(0.62, 0.7, 0.32, 18).translate(0, 0.56, 0);
  const spout = new THREE.BoxGeometry(0.34, 0.12, 0.6).translate(0, 0.66, 0.78);
  const ling = new THREE.CapsuleGeometry(0.22, 0.42, 4, 14).translate(0, 1.05, 0);
  for (const [g, c] of [[yoni, C(0.12, 0.12, 0.12)], [spout, C(0.12, 0.12, 0.12)], [ling, C(0.07, 0.07, 0.08)]]) {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    parts.push(g.toNonIndexed());
  }
  // broken gods against the walls
  box(0.5, 1.1, 0.4, -2.8, 0.95, -2.9, C(0.3, 0.27, 0.22), 0, 0.3);
  box(0.45, 0.7, 0.45, 2.7, 0.75, -2.7, C(0.3, 0.27, 0.22), 0.2, 1.3);
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------- the Naga (rebuilt each frame)
class Naga {
  constructor(scene) {
    this.N = 26; // rings along the body
    this.R = 8; // around it
    this.len = 8.5;
    this.trail = [];
    const g = new THREE.BufferGeometry();
    const n = this.N * this.R;
    this.pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < this.N; i++) for (let j = 0; j < this.R; j++) uv.set([i / (this.N - 1), j / this.R], (i * this.R + j) * 2);
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) {
      for (let j = 0; j < this.R; j++) {
        const a = i * this.R + j;
        const b = i * this.R + ((j + 1) % this.R);
        const c = (i + 1) * this.R + j;
        const d = (i + 1) * this.R + ((j + 1) % this.R);
        idx.push(a, c, b, b, c, d);
      }
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo = g;
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ color: 0x1b241c, roughness: 0.45, metalness: 0.1, emissive: 0x0a1810, emissiveIntensity: 0.4 }), { wetness: false, puddles: false });
    // scales: a diamond pattern darkening the back
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 sc = vec2(vUv.x * 160.0, vUv.y * 8.0);
        float dia = abs(fract(sc.x + sc.y) - 0.5) + abs(fract(sc.x - sc.y) - 0.5);
        diffuseColor.rgb *= 0.65 + 0.35 * smoothstep(0.35, 0.6, dia);
        diffuseColor.rgb *= mix(0.55, 1.15, abs(vUv.y - 0.5) * 2.0);`
      );
    };
    mat.defines = { USE_UV: '' };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 0.5) });
    this.eyes = [new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat), new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat)];
    for (const e of this.eyes) scene.add(e);
    this.head = new THREE.Vector3();
    this.heading = 0;
    this.t = 0;
  }

  /** Move the head (a point and a heading); the body follows the path the head has taken. */
  update(dt, head, calm) {
    this.t += dt;
    this.head.copy(head);
    const last = this.trail[0];
    if (!last || last.distanceTo(head) > this.len / (this.N - 1) / 2) {
      this.trail.unshift(head.clone());
      if (this.trail.length > this.N * 2) this.trail.pop();
    }
    while (this.trail.length < this.N * 2) this.trail.push((this.trail[this.trail.length - 1] || head).clone());
    const step = Math.max(1, Math.floor(this.trail.length / this.N));
    for (let i = 0; i < this.N; i++) {
      const c = this.trail[Math.min(this.trail.length - 1, i * step)];
      const nxt = this.trail[Math.min(this.trail.length - 1, i * step + step)];
      _n.subVectors(c, nxt);
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
      _n.normalize();
      _b.crossVectors(_n, UP);
      if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
      _b.normalize();
      const up = _v.crossVectors(_b, _n).normalize();
      const k = i / (this.N - 1);
      // a head, a thick body, a tail to a point; a ripple along it as it swims
      const r = 0.24 * (k < 0.06 ? 0.75 + k * 4 : 1 - Math.pow(Math.max(0, k - 0.45) / 0.55, 1.4) * 0.95) * (calm ? 1 : 1);
      const wob = Math.sin(this.t * 3 - k * 9) * 0.05;
      for (let j = 0; j < this.R; j++) {
        const a = (j / this.R) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.8;
        const o = ((i * this.R + j) * 3);
        this.pos[o] = c.x + _b.x * (x + wob) + up.x * y;
        this.pos[o + 1] = c.y + _b.y * (x + wob) + up.y * y;
        this.pos[o + 2] = c.z + _b.z * (x + wob) + up.z * y;
      }
      if (i === 0) {
        for (const [e, s] of [[this.eyes[0], 1], [this.eyes[1], -1]]) e.position.set(c.x + _b.x * 0.13 * s + up.x * 0.09 + _n.x * 0.12, c.y + _b.y * 0.13 * s + up.y * 0.09 + _n.y * 0.12, c.z + _b.z * 0.13 * s + up.z * 0.09 + _n.z * 0.12);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    for (const e of this.eyes) e.material.color.setRGB(calm ? 0.5 : 1.6, calm ? 0.45 : 1.4, calm ? 0.2 : 0.5);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    for (const e of this.eyes) e.removeFromParent();
  }
}

// ---------------------------------------------------------------- bubbles from the bed
class Vents {
  constructor(scene, spots) {
    this.spots = spots;
    const n = spots.length * 60;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    spots.forEach((s, k) => {
      for (let i = 0; i < 60; i++) {
        pos.set([s.x, s.y, s.z], (k * 60 + i) * 3);
        seed[k * 60 + i] = Math.random();
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uTime: { value: 0 }, uPx: { value: 1 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA;
        void main() {
          float t = fract(uTime * (0.18 + aSeed * 0.12) + aSeed);
          vec3 p = position + vec3(sin(t * 12.0 + aSeed * 40.0) * 0.12, t * 6.5, cos(t * 9.0 + aSeed * 23.0) * 0.12);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.03 + aSeed * 0.05) * 700.0 * uPx / max(-mv.z, 0.5), 1.0, 14.0 * uPx);
          vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.85, 1.0, t)) * step(p.y, -0.05);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
          float ring = smoothstep(0.6, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r)) + (1.0 - smoothstep(0.0, 0.35, length(c - vec2(-0.15, -0.15)) * 2.0)) * 0.6;
          float a = ring * vA * 0.7; if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, pr) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uPx.value = pr;
  }

  /** In a column of bubbles? (breathe) */
  near(p) {
    return this.spots.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < 1.1 && p.y > s.y - 0.5);
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
  }
}

// ---------------------------------------------------------------- the mission
export default function drownedSanctum(game) {
  const scindia = ghatById('scindia');
  const temple = () => game.quest.flames.find((f) => f.id === 'ratneshwar')?.pos;
  // the ruin: out past the leaning temple, where the bed is deep enough to cover its roof
  const site = () => {
    const t = temple() || new THREE.Vector3(scindia.S.x, 0, scindia.S.z);
    let x = t.x + scindia.N.x * 18 - scindia.T.x * 5;
    let z = t.z + scindia.N.z * 18 - scindia.T.z * 5;
    for (let k = 0; k < 12 && groundHeight(x, z) > -5.4; k++) {
      x += scindia.N.x * 2.5;
      z += scindia.N.z * 2.5;
    }
    return { x, y: groundHeight(x, z), z, yaw: Math.atan2(-scindia.N.x, -scindia.N.z) };
  };
  game.audio.synth('naga-hiss', synthHiss);
  return {
    id: 'sanctum',
    title: 'The Drowned Sanctum',
    // (the test menu's horror jump: treading water a few metres short of the ruin; dive)
    scare: {
      label: 'The Drowned Sanctum · the dive',
      sub: 'Dive (C) to the sunken temple in the dark water; the Naga keeps it',
      hours: 20.5,
      at: () => {
        const s = site();
        const N = scindia.N;
        return { x: s.x - N.x * 6, y: -0.7, z: s.z - N.z * 6, yaw: Math.atan2(N.x, N.z) };
      },
    },
    giver: {
      name: 'Kallu the boatman',
      avatarId: 'Male_Adult_14',
      clip: 'wait',
      hours: [15.5, 21],
      at: () => {
        const t = temple();
        const u = t ? (t.x - scindia.S.x) * scindia.T.x + (t.z - scindia.S.z) * scindia.T.z : scindia.width * 0.5;
        return waterEdge(scindia, Math.max(4, Math.min(scindia.width - 4, u + 8)));
      },
    },
    offer: [
      ['Kallu the boatman', 'Ratneshwar leans, everyone knows. What they don’t know: its first sanctum didn’t lean. It sank. Out there, on the bed of Ganga Maiya.'],
      ['Kallu the boatman', 'No lamp has burned for that Mahadev in a hundred years. The pandas sealed this akhand jyoti in glass: it burns under water.'],
      ['Kallu the boatman', 'Take it down to him. And bhaiya… my net came back from there shredded. Something keeps that place. Breathe where the bubbles rise.'],
    ],
    start(m) {
      const s = site();
      const geo = ruinGeometry();
      geo.rotateY(s.yaw);
      geo.translate(s.x, s.y - 0.15, s.z);
      const T = game.textures?.stone;
      const mat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, map: T?.map || null, normalMap: T?.normalMap || null }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      game.scene.add(mesh);
      // its walls stop him (the doorway open), the floor holds the silt
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const W = (lx, lz) => ({ x: s.x + lx * c + lz * sn, z: s.z - lx * sn + lz * c });
      const cols = [];
      for (const [w, h, d, lx, ly, lz] of [[7.4, 3.4, 0.5, 0, 1.9, -3.45], [0.5, 3.4, 7.4, -3.45, 1.9, 0], [0.5, 3.4, 7.4, 3.45, 1.9, 0], [2.8, 3.4, 0.5, -2.3, 1.9, 3.45], [2.8, 3.4, 0.5, 2.3, 1.9, 3.45], [1.6, 1.2, 0.5, 0, 3.0, 3.45], [7.6, 0.45, 4.2, 0, 3.8, -1.7], [1.3, 0.7, 1.3, 0, 0.55, 0]]) {
        const p = W(lx, lz);
        cols.push(game.physics.addBox(p.x, s.y + ly, p.z, w, h, d, s.yaw));
      }
      const lingam = { x: s.x, y: s.y + 1.05, z: s.z };
      const front = W(0, 1.1);
      const vents = new Vents(game.scene, [
        { ...W(0, 7.5), y: groundHeight(W(0, 7.5).x, W(0, 7.5).z) + 0.1 },
        { ...W(2.4, -2.2), y: s.y + 0.4 },
      ]);
      const naga = new Naga(game.scene);
      game.handDiya.carry(true);
      game.handDiya.sealed = true;
      m.state = { phase: 'dive', s, mesh, cols, lingam, front, vents, naga, ang: 0, touchT: 0, glow: -1, whispered: false, light: null };
    },
    update(m, dt) {
      const S = m.state;
      const p = game.player;
      const P = p.position;
      const inside = Math.hypot(P.x - S.s.x, P.z - S.s.z) < 3.6 && P.y < S.s.y + 4;
      const near = Math.hypot(P.x - S.s.x, P.z - S.s.z) < 22;
      game.dread.want('sanctum', S.phase === 'dive' && near && p.headUnderwater ? (inside ? 0.7 : 0.45) : 0);
      S.vents.update(dt, game.rs.pixelRatio);
      if (p.headUnderwater && S.vents.near(P)) p.breath = Math.min(p.breathMax, p.breath + dt * 14);
      if (!S.whispered && near && p.headUnderwater) {
        S.whispered = true;
        game.audio.play('whisper-gehre', { volume: 0.8, at: { x: S.s.x, y: S.s.y + 2, z: S.s.z } });
      }
      // ---- the Naga: circles the lingam; with him inside it comes for him, and brushes past
      const calm = S.phase !== 'dive';
      const ring = calm ? 0.75 : inside ? 1.6 + Math.sin(S.ang * 0.7) * 0.9 : 2.4;
      S.ang += dt * (calm ? 0.25 : inside ? 0.85 : 0.5);
      const head = _v.set(S.s.x + Math.sin(S.ang) * ring, S.s.y + (calm ? 1.35 + Math.sin(S.ang * 3) * 0.1 : 1.1 + Math.sin(S.ang * 1.7) * 0.6), S.s.z + Math.cos(S.ang) * ring);
      if (!calm && inside) {
        // it bends toward him as it passes
        const pull = clamp(1 - Math.hypot(P.x - head.x, P.z - head.z) / 3, 0, 1) * 0.7;
        head.lerp(_b.set(P.x, P.y, P.z), pull * 0.4);
      }
      S.naga.update(dt, head, calm);
      const d = head.distanceTo(_b.set(P.x, P.y + 0.6, P.z));
      game.dread.threat(calm ? 0 : clamp(1 - d / 6, 0, 1));
      S.touchT -= dt;
      if (!calm && d < 0.9 && S.touchT <= 0) {
        S.touchT = 3;
        p.breath = Math.max(0, p.breath - 8);
        game.camRig.shake(0.3);
        game.audio.play('naga-hiss', { volume: 0.8, at: head });
        game.ui.subtitle('The Naga’s coils slide over him in the dark. The air goes out of his chest.', 3);
      }
      // ---- the sanctum, lit: a warm glow from the lamp before the lingam
      if (S.glow >= 0 && !S.light) {
        // (a real light in the sanctum: one of the pooled ones, when it is among the nearest)
        S.light = { p: new THREE.Vector3(S.lingam.x, S.lingam.y - 0.2, S.lingam.z), k: 0.45, fire: true };
        (game.extraLights ||= []).push(S.light);
      }
      if (S.phase === 'dive') {
        m.objective(inside ? 'Set the lamp before the lingam (E).' : 'Dive (C) to the drowned sanctum beyond the leaning temple. Breathe where the bubbles rise.');
        if (!inside) m.mark('item', { x: S.s.x, y: S.s.y + 4.4, z: S.s.z }, true);
      } else if (S.phase === 'back') {
        m.objective('Surface, and tell Kallu.');
        if (m.giver) m.mark('objective', m.giver);
      }
    },
    interact(m) {
      const S = m.state;
      const P = game.player.position;
      if (S.phase === 'dive' && Math.hypot(P.x - S.front.x, P.z - S.front.z) < 2.2 && P.y < S.s.y + 3.5) {
        return {
          prompt: 'Set the lamp before Mahadev',
          action: () => {
            S.phase = 'back';
            game.handDiya.carry(false);
            S.glow = game.fire.add(new THREE.Vector3(S.front.x, S.s.y + 0.78, S.front.z), 0.55, true);
            game.audio.play('ignite', { volume: 0.5 });
            for (let i = 0; i < 5; i++) game.audio.play('bell', { volume: 0.35, rate: 0.55 + i * 0.03, delay: 1 + i * 1.3 });
            game.audio.play('chime', { volume: 0.5, delay: 2 });
            game.ui.toast('The Drowned Sanctum', 'A lamp burns for the drowned Mahadev for the first time in a hundred years. The Naga lowers its head.', 5);
          },
        };
      }
      if (S.phase === 'back' && m.giver && m.near(m.giver, 2.8) && game.player.state === 'ground') return { prompt: 'Tell Kallu', action: () => m.done() };
      return null;
    },
    on(m, ev) {
      if (ev === 'combat:death') m.fail('The river kept him.');
    },
    stop(m) {
      const S = m.state;
      S.mesh?.removeFromParent();
      S.mesh?.geometry.dispose();
      for (const c of S.cols || []) game.physics.world.removeCollider(c, false);
      S.vents?.dispose();
      S.naga?.dispose();
      if (S.glow >= 0) game.fire.setLit(S.glow, 0);
      if (S.light) game.extraLights = (game.extraLights || []).filter((l) => l !== S.light);
      game.handDiya.carry(false);
      game.handDiya.sealed = false;
      game.dread.want('sanctum', 0);
    },
    outro: [
      ['Kallu the boatman', 'You saw it? The Naga? …And it let you go. Then He accepted the lamp.'],
      ['Kallu the boatman', 'My grandfather would have wept. Come out on my boat any night, bhaiya. No fare, ever.'],
    ],
    reward: { punya: 45, note: 'A lamp burns in the drowned sanctum' },
  };
}

/** The Naga's hiss, under water: a low rasp with a bubbling edge. */
export function synthHiss(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 1.4);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * 0.08;
    const env = Math.min(1, t * 10) * Math.exp(-t * 2.2);
    const bub = Math.sin(2 * Math.PI * (90 + 40 * Math.sin(t * 23)) * t) * 0.3;
    d[i] = (lp * 1.8 + bub * Math.max(0, Math.sin(t * 31))) * env;
  }
  return b;
}
