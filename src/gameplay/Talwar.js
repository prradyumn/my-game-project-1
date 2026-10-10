import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shiny } from '../world/materials.js';

// Prady's talwar: a curved Indian sabre with the disc pommel and the short langets of the
// classic hilt, in a red velvet scabbard at his left hip. Built in code (a few hundred
// triangles). Plus the blade's light trail during a cut.
//
// Sword space: the grip runs along +Y from the guard (y = 0); the blade rises from the guard,
// curving back toward -Z (the spine side), edge facing +Z.

const BLADE = 0.82;

function bladeGeometry() {
  // a curved strip with a slight swelling near the tip (the talwar's yelman), thick at the spine
  const n = 18;
  const pos = [];
  const idx = [];
  const at = (k) => {
    const t = k / n;
    const y = 0.02 + t * BLADE;
    const curve = -0.11 * t * t; // sweeps back toward the spine side
    let w = 0.041 - 0.009 * t + (t > 0.72 ? 0.009 * Math.sin(((t - 0.72) / 0.28) * Math.PI) : 0);
    if (t > 0.93) w *= 1 - (t - 0.93) / 0.07; // the point
    return { y, z: curve, w: Math.max(0.0015, w), th: 0.0045 * (1 - t * 0.6) };
  };
  for (let k = 0; k <= n; k++) {
    const s = at(k);
    // spine (back, thick) and edge (front, thin): a lens cross-section with 4 verts
    pos.push(0, s.y, s.z - s.w * 0.15); // spine centre
    pos.push(s.th, s.y, s.z + s.w * 0.35); // flat, right
    pos.push(0, s.y, s.z + s.w); // edge
    pos.push(-s.th, s.y, s.z + s.w * 0.35); // flat, left
  }
  for (let k = 0; k < n; k++) {
    const a = k * 4;
    const b = a + 4;
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) % 4;
      idx.push(a + j, b + j, a + j2, a + j2, b + j, b + j2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function colored(g, c) {
  const n = g.toNonIndexed();
  n.deleteAttribute('uv');
  const col = new Float32Array(n.attributes.position.count * 3);
  const lin = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  for (let i = 0; i < col.length; i += 3) col.set([lin.r, lin.g, lin.b], i);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

export function makeTalwar() {
  const steel = colored(bladeGeometry(), [0.86, 0.87, 0.9]);
  const iron = [0.18, 0.16, 0.14];
  const gold = [0.85, 0.66, 0.3];
  const hilt = [
    colored(new THREE.CylinderGeometry(0.016, 0.018, 0.1, 10).translate(0, -0.055, 0), iron), // grip
    colored(new THREE.SphereGeometry(0.022, 10, 6).scale(1, 0.7, 1).translate(0, -0.11, 0), gold), // grip swell
    colored(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 18).translate(0, -0.125, 0), gold), // disc pommel
    colored(new THREE.ConeGeometry(0.012, 0.03, 8).translate(0, -0.142, 0), gold), // pommel finial
    colored(new THREE.BoxGeometry(0.15, 0.016, 0.022).translate(0, 0.005, 0), gold), // cross-guard
    colored(new THREE.SphereGeometry(0.013, 8, 6).translate(0.078, 0.005, 0), gold), // quillon ends
    colored(new THREE.SphereGeometry(0.013, 8, 6).translate(-0.078, 0.005, 0), gold),
    colored(new THREE.BoxGeometry(0.012, 0.05, 0.03).translate(0, 0.035, 0.004), gold), // langets on the blade
  ];
  const sword = new THREE.Mesh(mergeGeometries([steel, ...hilt]), shiny(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.95, roughness: 0.22 })));
  sword.castShadow = true;
  sword.name = 'talwar';

  // the scabbard: red velvet with a brass chape at the tip
  const sc = [];
  const n = 10;
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const y0 = 0.02 + t0 * BLADE;
    const y1 = 0.02 + t1 * BLADE;
    const z0 = -0.11 * t0 * t0;
    const z1 = -0.11 * t1 * t1;
    const seg = new THREE.CylinderGeometry(0.024, 0.026, y1 - y0, 8, 1, true).scale(0.55, 1, 1.35).translate(0, (y0 + y1) / 2, (z0 + z1) / 2 + 0.012);
    sc.push(colored(seg, k === n - 1 ? gold : [0.42, 0.04, 0.06]));
  }
  sc.push(colored(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8).scale(0.6, 1, 1.4).translate(0, 0.03, 0.012), gold)); // locket
  const scabbard = new THREE.Mesh(mergeGeometries(sc), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 }));
  scabbard.castShadow = true;
  scabbard.name = 'scabbard';
  return { sword, scabbard, length: BLADE };
}

// A ribbon of light behind the blade during a cut: the last few base/tip positions, fading out.
export class BladeTrail {
  constructor(n = 16) {
    this.n = n;
    this.base = [];
    this.tip = [];
    const pos = new Float32Array(n * 2 * 3);
    const alpha = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uOn; varying float vA; void main(){ float a = vA * uOn; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.6, 1.4, 1.1) * a, a); }`,
        uniforms: { uOn: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.on = 0;
  }

  /** Each frame: the blade's base and tip (world), and whether a cut is live. */
  update(dt, base, tip, live) {
    this.on = live ? Math.min(1, this.on + dt * 12) : Math.max(0, this.on - dt * 6);
    this.mesh.visible = this.on > 0.01;
    if (!this.mesh.visible) {
      this.base.length = this.tip.length = 0;
      return;
    }
    this.base.unshift(base.clone());
    this.tip.unshift(tip.clone());
    if (this.base.length > this.n) {
      this.base.pop();
      this.tip.pop();
    }
    const pos = this.geo.attributes.position.array;
    const al = this.geo.attributes.aAlpha.array;
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(i, this.base.length - 1);
      const b = this.base[k];
      const t = this.tip[k];
      // the inner edge sits part way up the blade: a crescent, not a fan
      pos.set([b.x + (t.x - b.x) * 0.45, b.y + (t.y - b.y) * 0.45, b.z + (t.z - b.z) * 0.45, t.x, t.y, t.z], i * 6);
      const f = i < this.base.length ? Math.pow(1 - i / this.n, 1.6) : 0;
      al[i * 2] = 0;
      al[i * 2 + 1] = f * 0.55;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.mesh.material.uniforms.uOn.value = this.on;
  }
}
