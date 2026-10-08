import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../utils/math.js';
import { ghatById, ghatToWorld, PROFILE_LEN } from './WorldLayout.js';
import { WORLD_UNIFORMS } from './materials.js';

// Ambient life: flocks of pigeons and kites over the ghats, and floating diyas on the river.

export class Birds {
  constructor(count = 160) {
    const geo = new THREE.BufferGeometry();
    // body + two wings; aWing = 0 body, +-1 wing tips
    const p = [
      0, 0, 0.18, -0.03, 0, -0.16, 0.03, 0, -0.16, // body
      0, 0, 0.06, 0, 0, -0.08, -0.32, 0, -0.02, // left wing
      0, 0, 0.06, 0.32, 0, -0.02, 0, 0, -0.08, // right wing
    ];
    const w = [0, 0, 0, 0, 0, 1, 0, 1, 0];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aWing;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 1.7;
          transformed.y += aWing * sin(uTime * 13.0 + ph) * 0.22;`
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const rng = new RNG(9);
    this.flocks = [
      { cx: 40, cz: -10, r: 34, y: 26, speed: 0.22, n: 70, scale: 1 }, // pigeons over Dashashwamedh
      { cx: -230, cz: -5, r: 50, y: 34, speed: 0.15, n: 40, scale: 1 },
      { cx: 250, cz: 30, r: 90, y: 60, speed: 0.07, n: 12, scale: 3.2 }, // kites riding thermals
      { cx: -60, cz: 120, r: 120, y: 45, speed: 0.05, n: 8, scale: 2.8 },
    ];
    this.birds = [];
    for (const f of this.flocks) {
      for (let i = 0; i < f.n && this.birds.length < count; i++) {
        this.birds.push({ f, a: rng.range(0, Math.PI * 2), rOff: rng.range(-0.35, 0.35), yOff: rng.range(-5, 5), sp: rng.range(0.85, 1.2), ph: rng.range(0, 10) });
      }
    }
    this.mesh.count = this.birds.length;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    this.birds.forEach((b, i) => {
      const f = b.f;
      b.a += dt * f.speed * b.sp;
      const r = f.r * (1 + b.rOff + 0.15 * Math.sin(this.t * 0.3 + b.ph));
      const x = f.cx + Math.cos(b.a) * r;
      const z = f.cz + Math.sin(b.a) * r * 0.7;
      const y = f.y + b.yOff + Math.sin(this.t * 0.8 + b.ph) * 2;
      const yaw = -b.a; // tangent direction
      this._q.setFromEuler(this._e.set(0, yaw, 0.35));
      this._m.compose(this._p.set(x, y, z), this._q, this._s.setScalar(f.scale));
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Clay diyas on leaf boats, floating downstream after the evening aarti (and offered by Prady).
export class FloatingDiyas {
  constructor(water, fire, max = 140) {
    this.water = water;
    this.fire = fire;
    this.max = max;
    const g = new THREE.CylinderGeometry(0.11, 0.07, 0.06, 10);
    const leaf = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 8).scale(1, 1, 0.75);
    g.translate(0, 0.04, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.8 });
    this.cups = new THREE.InstancedMesh(g, mat, max);
    this.leaves = new THREE.InstancedMesh(leaf, leafMat, max);
    for (const m of [this.cups, this.leaves]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    this.group = new THREE.Group();
    this.group.add(this.cups, this.leaves);
    this.items = [];
    this.flameIds = [];
    for (let i = 0; i < max; i++) this.flameIds.push(fire.add(new THREE.Vector3(0, -50, 0), 0.45, false));
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    const dash = ghatById('dashashwamedh');
    this.spawnLine = { g: dash };
    this.spawnTimer = 0;
  }

  launch(x, z) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x, z, vx: (Math.random() - 0.3) * 0.1, vz: 0.08 + Math.random() * 0.12, rot: Math.random() * 6, age: 0 });
  }

  update(dt, evening, ripples) {
    // Evening: diyas float out from the Dashashwamedh steps.
    if (evening) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0.7 + Math.random() * 1.2;
        const g = this.spawnLine.g;
        const p = ghatToWorld(g, g.width * (0.2 + Math.random() * 0.6), PROFILE_LEN - 3 + Math.random() * 2);
        this.launch(p.x, p.z);
      }
    }
    let n = 0;
    const cur = this._cur || (this._cur = { x: 0, z: 0 });
    for (const d of this.items) {
      d.age += dt;
      const out = Math.min(1, d.age / 20);
      this.water.currentAt(d.x, d.z, cur);
      d.x += (cur.x + d.vx) * dt;
      d.z += (cur.z + d.vz * (1 - out * 0.7)) * dt;
      d.rot += dt * 0.2;
      const y = this.water.heightAt(d.x, d.z);
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d.rot);
      this._m.compose(this._p.set(d.x, y, d.z), this._q, this._s);
      this.cups.setMatrixAt(n, this._m);
      this.leaves.setMatrixAt(n, this._m);
      const fid = this.flameIds[n];
      this.fire.setPosition(fid, d.x, y + 0.07, d.z);
      this.fire.setLit(fid, d.age < 240 ? 1 : 0);
      if (Math.random() < dt * 0.15) ripples?.spawn(d.x, y, d.z, 0.8, 1.4);
      n++;
    }
    for (let i = n; i < this.max; i++) this.fire.setLit(this.flameIds[i], 0);
    this.items = this.items.filter((d) => d.age < 260);
    this.cups.count = this.leaves.count = n;
    this.cups.visible = this.leaves.visible = n > 0;
    this.cups.instanceMatrix.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;
  }
}

// Pigeons on the ground: pecking and hopping where people feed them; they burst into the air
// when Prady comes close (or runs at them), circle, and settle again.
export class GroundPigeons {
  constructor(spots, { audio } = {}) {
    this.spots = spots;
    this.audio = audio;
    const total = spots.reduce((a, s) => a + s.n, 0);
    // a small pigeon: body, head, tail, two wings (aWing marks the wing tips for the flap)
    const parts = [];
    const color = (geo, c) => {
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set(c, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(n), 1));
      return geo;
    };
    const grey = [0.42, 0.44, 0.5];
    parts.push(color(new THREE.SphereGeometry(0.075, 8, 6).scale(0.85, 0.8, 1.35).translate(0, 0.1, 0), grey));
    parts.push(color(new THREE.SphereGeometry(0.045, 8, 6).translate(0, 0.17, 0.09), [0.36, 0.4, 0.45]));
    parts.push(color(new THREE.ConeGeometry(0.012, 0.03, 5).rotateX(Math.PI / 2).translate(0, 0.165, 0.14), [0.55, 0.4, 0.35]));
    parts.push(color(new THREE.BoxGeometry(0.07, 0.012, 0.09).translate(0, 0.1, -0.13), [0.3, 0.32, 0.36]));
    for (const s of [-1, 1]) {
      const w = color(new THREE.BoxGeometry(0.16, 0.008, 0.08).translate(s * 0.09, 0.12, -0.01), [0.46, 0.48, 0.54]);
      const pos = w.attributes.position;
      const aw = w.attributes.aWing;
      for (let i = 0; i < pos.count; i++) aw.setX(i, Math.abs(pos.getX(i)) > 0.1 ? 1 : 0.4);
      parts.push(w);
    }
    for (const s of [-1, 1]) parts.push(color(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 4).translate(s * 0.025, 0.03, 0), [0.75, 0.35, 0.35]));
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const flap = new THREE.InstancedBufferAttribute(new Float32Array(total), 1);
    flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', flap);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aWing;\nattribute float aFlap;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = float(gl_InstanceID) * 2.1;
          // folded on the ground, beating when flying
          transformed.y += aWing * aFlap * sin(uTime * 26.0 + ph) * 0.09;`
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.flap = flap;
    this.birds = [];
    const rng = new RNG(77);
    for (const s of spots) {
      for (let i = 0; i < s.n; i++) {
        const b = { spot: s, x: 0, y: s.y, z: 0, yaw: rng.range(0, 6.28), state: 'ground', t: rng.range(0, 3), vx: 0, vy: 0, vz: 0, peck: rng.range(0, 6), hop: rng.range(1, 4) };
        this.place(b, rng);
        this.birds.push(b);
      }
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.rng = rng;
    this.lastCoo = 0;
  }

  place(b, rng = this.rng) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 2.2;
    b.x = b.spot.x + Math.cos(a) * r;
    b.z = b.spot.z + Math.sin(a) * r;
    b.y = b.spot.y;
  }

  update(dt, { camera, player, playerSpeed = 0, time = 0 }) {
    const cam = camera.position;
    let n = 0;
    for (const b of this.birds) {
      const s = b.spot;
      const near = Math.abs(s.x - cam.x) < 90 && Math.abs(s.z - cam.z) < 90;
      if (near && dt > 0) {
        b.t += dt;
        const dx = b.x - (player?.x ?? 1e9);
        const dz = b.z - (player?.z ?? 1e9);
        const d = Math.hypot(dx, dz);
        if (b.state === 'ground') {
          b.peck += dt * (2 + (n % 3));
          b.hop -= dt;
          if (b.hop < 0) {
            b.hop = this.rng.range(1.2, 4);
            b.yaw += this.rng.range(-1.2, 1.2);
            b.x += Math.sin(b.yaw) * 0.12;
            b.z += Math.cos(b.yaw) * 0.12;
          }
          const scared = d < 2.0 || (d < 5.5 && playerSpeed > 2.8);
          if (scared && Math.abs((player?.y ?? 0) - b.y) < 2.5) {
            // everyone at this spot goes up together, away from Prady
            for (const o of this.birds) {
              if (o.spot !== s || o.state !== 'ground') continue;
              const ox = o.x - player.x;
              const oz = o.z - player.z;
              const ol = Math.hypot(ox, oz) || 1;
              o.state = 'fly';
              o.t = 0;
              o.vx = (ox / ol) * this.rng.range(3, 5) + this.rng.range(-1, 1);
              o.vz = (oz / ol) * this.rng.range(3, 5) + this.rng.range(-1, 1);
              o.vy = this.rng.range(3.5, 5.5);
              o.yaw = Math.atan2(o.vx, o.vz);
            }
            if (time - this.lastCoo > 4) {
              this.lastCoo = time;
              this.audio?.play('pigeons', { at: new THREE.Vector3(s.x, s.y + 1, s.z), volume: 0.9, ref: 14 });
            }
          }
        } else {
          // fly out, swing round, come back down near the spot
          const back = b.t > 2.2;
          if (back) {
            const tx = s.x - b.x;
            const tz = s.z - b.z;
            const tl = Math.hypot(tx, tz) || 1;
            b.vx += ((tx / tl) * 4 - b.vx) * dt * 1.2;
            b.vz += ((tz / tl) * 4 - b.vz) * dt * 1.2;
            b.vy += ((s.y + 1.2 - b.y) * 0.8 - b.vy) * dt * 1.5;
            if (b.t > 4.5 && tl < 2.5 && (!player || Math.hypot(s.x - player.x, s.z - player.z) > 5)) {
              b.state = 'ground';
              this.place(b);
              b.t = 0;
            }
          } else b.vy -= 2.5 * dt;
          b.x += b.vx * dt;
          b.y = Math.max(s.y, b.y + b.vy * dt);
          b.z += b.vz * dt;
          b.yaw = Math.atan2(b.vx, b.vz);
        }
      }
      const flying = b.state === 'fly';
      const pitch = flying ? -0.25 : Math.max(0, Math.sin(b.peck * 3)) * 0.55;
      this._e.set(pitch, b.yaw, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(b.x, b.y, b.z), this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.flap.setX(n, flying ? 1 : 0);
      n++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
  }
}
