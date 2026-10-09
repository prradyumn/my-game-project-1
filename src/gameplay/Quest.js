import * as THREE from 'three';
import { RUDRAKSHA_COUNT, SACRED_FLAMES } from '../config.js';
import { damp } from '../utils/math.js';
import { softDotTexture } from '../utils/textures.js';

// The main quest — "The Five Flames of Kashi":
//   * Light the five sacred flames. Each raises Mother Ganga's purity by 20%.
//   * Collect the 108 rudraksha beads hidden on the ghats, in the lanes, under the river.
//   * All five flames -> the Maha Aarti: every lamp on the ghats ignites, a pillar of light
//     rises from Dashashwamedh and Prady receives Ganga's Blessing (run on water, long breath).

export class Quest {
  constructor({ scene, layout, props, fire, smoke, water, audio, ui, sky }) {
    this.scene = scene;
    this.water = water;
    this.audio = audio;
    this.ui = ui;
    this.sky = sky;
    this.fire = fire;
    this.smoke = smoke;
    this.complete = false;
    this.onComplete = null;
    this.purityTarget = 0;
    this.purityBonus = 0; // the river cleaned by hand (Clean Mother Ganga)

    this.flames = SACRED_FLAMES.map((def) => {
      const site = props.flameSites[def.id];
      const big = def.id === 'panchganga' ? 0.7 : 2.6; // bowl fires (with embers) / pillar lamps
      return {
        ...def,
        pos: site.pos.clone(),
        lamps: site.lamps,
        lit: false,
        emitters: site.lamps.map((p) => fire.add(p, big, false)),
        radius: def.id === 'ratneshwar' ? 4.2 : 3.4,
      };
    });
    this.aartiEmitters = props.aartiLamps.map((p) => fire.add(p, 1.0, false));
    this.lampPostEmitters = props.lampPosts.map((p) => fire.add(p, 1.3, false, 'glow'));
    this.smokeIds = props.smokeSites.map((s) => ({ ...s, id: smoke.add(s.pos, s.kind === 'pyre' ? 0.55 : 0) }));
    this.aartiLit = false;

    // Rudraksha beads
    this.beads = layout.rudraksha.slice(0, RUDRAKSHA_COUNT).map((b) => ({ ...b, taken: false, phase: Math.random() * 6 }));
    const beadGeo = rudrakshaGeometry();
    const beadMat = new THREE.MeshStandardMaterial({ color: 0x7a3418, roughness: 0.55, metalness: 0.1, emissive: 0x3a1200, emissiveIntensity: 0.6 });
    this.beadMesh = new THREE.InstancedMesh(beadGeo, beadMat, this.beads.length);
    this.beadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beadMesh.frustumCulled = false;
    scene.add(this.beadMesh);
    const gp = new Float32Array(this.beads.length * 3);
    this.beadAlpha = new Float32Array(this.beads.length).fill(1);
    this.beads.forEach((b, i) => gp.set([b.x, b.y, b.z], i * 3));
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    gg.setAttribute('aAlpha', new THREE.BufferAttribute(this.beadAlpha, 1));
    this.glow = new THREE.Points(
      gg,
      new THREE.ShaderMaterial({
        // uReveal: the Third Eye (Powers.js) lets Prady see them from far off, through the haze
        uniforms: { uMap: { value: softDotTexture() }, uTime: { value: 0 }, uPixelRatio: { value: 1 }, uReveal: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aAlpha; uniform float uTime; uniform float uPixelRatio; uniform float uReveal; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            float pulse = 0.75 + 0.25 * sin(uTime * (3.0 + uReveal * 3.0) + position.x);
            vA = aAlpha * pulse * clamp(1.0 - (-mv.z - 60.0 - uReveal * 140.0) / 80.0, 0.0, 1.0) * (1.0 + uReveal * 1.5);
            gl_PointSize = clamp(0.65 * 600.0 * uPixelRatio * (1.0 + uReveal * 2.5) / max(-mv.z, 0.5), 3.0 + uReveal * 5.0, 48.0 * uPixelRatio) * pulse; }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; varying float vA;
          void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 4.0) * (1.0 - d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.58, 0.22) * 2.0 * a, a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.glow.frustumCulled = false;
    scene.add(this.glow);
    this.collected = 0;

    // Pillar of light for the finale
    this.pillar = makeLightPillar();
    const dash = this.flames.find((f) => f.id === 'dashashwamedh');
    this.pillar.position.copy(dash.pos);
    this.pillar.visible = false;
    scene.add(this.pillar);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this.t = 0;
  }

  get litCount() {
    return this.flames.filter((f) => f.lit).length;
  }

  // The interaction Prady could do right now (or null).
  interactionAt(pos) {
    let best = null;
    for (const f of this.flames) {
      if (f.lit) continue;
      const d = Math.hypot(pos.x - f.pos.x, pos.z - f.pos.z);
      const dy = Math.abs(pos.y - f.pos.y);
      if (d < f.radius && dy < 4.5 && (!best || d < best.d)) best = { d, flame: f };
    }
    if (!best) return null;
    return { prompt: `Light the ${best.flame.name}`, flameId: best.flame.id, action: () => this.lightFlame(best.flame.id) };
  }

  lightFlame(id, silent = false) {
    const f = this.flames.find((x) => x.id === id);
    if (!f || f.lit) return;
    f.lit = true;
    for (const e of f.emitters) this.fire.setLit(e, 1);
    this.purityTarget = this.litCount / this.flames.length;
    if (!silent) {
      this.audio.play('ignite', { at: f.pos });
      this.audio.play('bell', { at: f.pos, delay: 0.4 });
      this.ui.toast(`${f.name} burns again`, f.lore, 7);
      this.ui.flash();
    }
    this.onLit?.(id, silent);
    if (id === 'dashashwamedh') this.smokeIds.filter((s) => s.aarti).forEach((s) => this.smoke.setStrength(s.id, 0.14));
    if (this.litCount === this.flames.length && !this.complete) this.finish(silent);
  }

  finish(silent) {
    this.complete = true;
    this.pillar.visible = true;
    for (const e of this.aartiEmitters) this.fire.setLit(e, 1);
    this.aartiLit = true;
    if (!silent) {
      this.audio.play('conch');
      this.audio.play('bell', { delay: 1.2 });
      this.audio.play('narrationEnd', { delay: 2.0, channel: 'voice' });
      this.ui.toast('The Maha Aarti of Kashi', "Mother Ganga shines again. Ganga's Blessing is yours: hold SHIFT on the river to run across the water, and breathe long beneath it.", 12);
    }
    this.onComplete?.();
  }

  collectAt(pos) {
    for (let i = 0; i < this.beads.length; i++) {
      const b = this.beads[i];
      if (b.taken) continue;
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      if (dx * dx + dz * dz > 1.7 || Math.abs(pos.y - b.y) > 1.5) continue;
      this.take(i);
    }
  }

  take(i, silent = false) {
    const b = this.beads[i];
    if (b.taken) return;
    b.taken = true;
    this.collected++;
    this.beadAlpha[i] = 0;
    this.glow.geometry.attributes.aAlpha.needsUpdate = true;
    if (silent) return;
    this.audio.play('chime', { at: new THREE.Vector3(b.x, b.y, b.z) });
    this.onBead?.(this.collected);
    if ([27, 54, 81, 108].includes(this.collected)) {
      const msg = {
        27: 'A quarter of the mala. The beads hum with Shiva’s tears.',
        54: 'Half of the sacred mala. Kashi remembers you.',
        81: 'Three quarters — the river whispers your name.',
        108: 'All 108 rudraksha! The mala of Kashi is complete.',
      }[this.collected];
      this.ui.toast(`Rudraksha ${this.collected} / 108`, msg, 6);
    }
  }

  // Night-time lamps and the evening aarti
  update(dt, pixelRatio, night, playerPos) {
    this.t += dt;
    this.water.purity = damp(this.water.purity, Math.min(1, this.purityTarget + this.purityBonus), 0.6, dt);
    const nightOn = night > 0.45 ? 1 : 0;
    if (nightOn !== this._lampState) {
      this._lampState = nightOn;
      for (const e of this.lampPostEmitters) this.fire.setLit(e, nightOn);
    }
    const dashLit = this.flames.find((f) => f.id === 'dashashwamedh').lit;
    const evening = this.sky.hours > 18.3 && this.sky.hours < 22.5;
    // (forceAarti: Chapter III holds an aarti before its flame is lit)
    const aarti = this.complete || ((dashLit || this.forceAarti) && evening);
    if (aarti !== this.aartiLit) {
      this.aartiLit = aarti;
      for (const e of this.aartiEmitters) this.fire.setLit(e, aarti ? 1 : 0);
    }
    this.eveningAarti = (dashLit || this.forceAarti) && evening;

    // Beads spin and bob
    const m = this._m;
    this.beads.forEach((b, i) => {
      const s = b.taken ? 0 : 1;
      this._q.setFromEuler(new THREE.Euler(0.3, this.t * 1.5 + b.phase, 0));
      m.compose(new THREE.Vector3(b.x, b.y + Math.sin(this.t * 2 + b.phase) * 0.08, b.z), this._q, this._s.setScalar(s));
      this.beadMesh.setMatrixAt(i, m);
    });
    this.beadMesh.instanceMatrix.needsUpdate = true;
    this.glow.material.uniforms.uTime.value = this.t;
    this.glow.material.uniforms.uPixelRatio.value = pixelRatio;
    if (playerPos) this.collectAt(playerPos);

    if (this.pillar.visible) {
      this.pillar.material.uniforms.uTime.value = this.t;
      this.pillar.material.uniforms.uNight.value = night;
    }
  }

  serialize() {
    return { flames: this.flames.filter((f) => f.lit).map((f) => f.id), beads: this.beads.map((b, i) => (b.taken ? i : -1)).filter((i) => i >= 0) };
  }

  restore(data) {
    if (!data) return;
    for (const i of data.beads || []) this.take(i, true);
    for (const id of data.flames || []) this.lightFlame(id, true);
    this.water.purity = Math.min(1, this.purityTarget + this.purityBonus);
  }

  // Nearest unlit flame (for the compass)
  objectives() {
    return this.flames.map((f) => ({ id: f.id, name: f.name, pos: f.pos, lit: f.lit }));
  }
}

function rudrakshaGeometry() {
  const g = new THREE.IcosahedronGeometry(0.17, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const th = Math.atan2(v.z, v.x);
    const groove = Math.pow(Math.abs(Math.cos(th * 2.5)), 6) * 0.1;
    const bump = Math.sin(v.x * 90) * Math.sin(v.y * 85) * Math.sin(v.z * 95) * 0.03;
    v.multiplyScalar(1 - groove + bump);
    p.setXYZ(i, v.x, v.y * 0.92, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function makeLightPillar() {
  const geo = new THREE.CylinderGeometry(0.9, 1.6, 400, 32, 1, true).translate(0, 200, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uNight; varying vec2 vUv;
      void main(){
        float fade = pow(1.0 - vUv.y, 2.2) * smoothstep(0.0, 0.012, vUv.y);
        float bands = 0.7 + 0.3 * sin(vUv.y * 90.0 - uTime * 4.0);
        float edge = pow(abs(sin(vUv.x * 3.14159 * 5.0 + uTime * 0.6)), 2.0) * 0.6 + 0.4;
        float a = fade * bands * edge * mix(0.05, 0.16, uNight);
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.35) * 3.0 * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}
