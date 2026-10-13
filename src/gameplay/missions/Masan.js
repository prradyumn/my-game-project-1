import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { damp } from '../../utils/math.js';
import { ghatById, ghatHeight, ghatToWorld, LANDING_1, LANDING_2 } from '../../world/WorldLayout.js';

// Masan: Manikarnika after midnight. The burning ghat never sleeps, but past midnight the fires
// are down to embers, the mist comes up off the river and lies on the steps, and the ash falls
// like snow. An Aghori sitting by his dhuni asks Prady to light the pyres of three of the
// unclaimed dead (lawaris: nobody came for them), so that they can go.
//
// Down on the lower landing, in the mist, the pret are waiting: the hungry dead. They move only
// while he isn't looking at them (Asuras: `unseen`; Game.inView): in his sight they are stone,
// frozen mid-stride; turn your back and they come on fast. Each pyre he lights sets one of them
// free; when the last is burning they all go, and the mist thins.

const LANDING_V = (LANDING_2.v0 + LANDING_2.v1) / 2;
const PYRE_U = [0.16, 0.5, 0.88];
const WHISPERS = ['whisper-jala-do', 'whisper-koi-nahi', 'whisper-moksha', 'whisper-prady'];

// ---------------------------------------------------------------- the pyres (one draw call)
function pyreGeometry(at, yaw) {
  const parts = [];
  const col = (g, c) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.toNonIndexed();
  };
  const wood = [new THREE.Color(0.24, 0.15, 0.09), new THREE.Color(0.31, 0.2, 0.12), new THREE.Color(0.19, 0.12, 0.07)];
  // logs crosswise in layers, a bier of wood about 0.9 m high
  for (let layer = 0; layer < 5; layer++) {
    const along = layer % 2 === 0;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.CylinderGeometry(0.075, 0.08, along ? 1.95 : 0.95, 7);
      g.rotateZ(Math.PI / 2);
      if (!along) g.rotateY(Math.PI / 2);
      const off = (i - 1.5) * (along ? 0.24 : 0.5);
      g.translate(along ? 0 : off, 0.08 + layer * 0.15, along ? off * 0.95 : 0);
      parts.push(col(g, wood[(i + layer) % 3]));
    }
  }
  // the body, shrouded in white cloth, a marigold garland across it
  const body = new THREE.CapsuleGeometry(0.21, 1.3, 4, 10);
  body.rotateZ(Math.PI / 2);
  body.scale(1, 0.75, 1);
  body.translate(0, 0.98, 0);
  parts.push(col(body, new THREE.Color(0.86, 0.83, 0.76)));
  const garland = new THREE.TorusGeometry(0.2, 0.035, 5, 14);
  garland.rotateY(Math.PI / 2);
  garland.scale(1, 0.85, 1.25);
  garland.translate(0.25, 0.98, 0);
  parts.push(col(garland, new THREE.Color(0.95, 0.45, 0.06)));
  const g = mergeGeometries(parts);
  g.rotateY(yaw);
  g.translate(at.x, at.y, at.z);
  return g;
}

// ---------------------------------------------------------------- ash falling (one draw call)
class Ash {
  constructor(n = 900) {
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([Math.random() * 32 - 16, Math.random() * 16, Math.random() * 32 - 16], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uOn: { value: 0 }, uPx: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform float uOn; uniform float uPx;
        varying float vA; varying float vEmber;
        void main() {
          // each flake falls slowly, sways, and wraps round a box that rides with the camera
          vec3 p = position;
          p.y -= uTime * (0.25 + aSeed * 0.35);
          p.x += sin(uTime * (0.4 + aSeed) + aSeed * 30.0) * 0.6 + uTime * 0.15;
          p.z += cos(uTime * (0.3 + aSeed * 0.7) + aSeed * 17.0) * 0.5;
          vec3 box = vec3(32.0, 16.0, 32.0);
          vec3 o = uCam - box * vec3(0.5, 0.35, 0.5);
          p = o + mod(p - o, box);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vEmber = step(0.93, aSeed);
          float d = -mv.z;
          gl_PointSize = clamp((vEmber > 0.5 ? 0.035 : 0.045) * 700.0 * uPx / max(d, 0.5), 1.0, 6.0 * uPx);
          vA = uOn * smoothstep(26.0, 5.0, d) * smoothstep(0.4, 1.8, d);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vEmber;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.4, 1.0, r)) * vA;
          if (a < 0.01) discard;
          vec3 c = vEmber > 0.5 ? vec3(2.4, 0.7, 0.2) : vec3(0.15, 0.145, 0.14);
          gl_FragColor = vec4(c * a, a * (vEmber > 0.5 ? 0.0 : 0.55));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  update(dt, camera, on, pr) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uOn.value = damp(u.uOn.value, on ? 1 : 0, 1.2, dt);
    u.uPx.value = pr;
    this.points.visible = u.uOn.value > 0.01;
  }
}

// ---------------------------------------------------------------- the mission
export default function masan(game) {
  const mani = ghatById('manikarnika');
  const terrace = (u) => {
    const p = ghatToWorld(mani, u, 2.4);
    return { x: p.x, y: ghatHeight(2.4), z: p.z, yaw: Math.atan2(mani.N.x, mani.N.z) };
  };
  const pyreAt = (i) => {
    const p = ghatToWorld(mani, mani.width * PYRE_U[i], LANDING_V);
    return { x: p.x, y: LANDING_2.h0, z: p.z };
  };
  const centre = () => ghatToWorld(mani, mani.width / 2, 14);
  game.audio.synth('pret-sting', synthSting);
  let ash = null;

  return {
    id: 'masan',
    title: 'Masan',
    giver: { name: 'the Aghori', avatarId: 'Male_Adult_01', clip: 'floorSit', hours: [23, 4], at: () => terrace(mani.width * 0.56) },
    // (the test menu's horror jump: fire already taken from the dhuni, on the steps above the pret)
    scare: {
      label: 'Masan · the burning ghat after midnight',
      sub: 'Mist and falling ash; the pret move only while you are not looking',
      hours: 0.5,
      at: () => {
        const p = ghatToWorld(mani, mani.width / 2, (LANDING_1.v0 + LANDING_1.v1) / 2);
        return { x: p.x, y: LANDING_1.h0, z: p.z, yaw: Math.atan2(mani.N.x, mani.N.z) };
      },
    },
    offer: [
      ['the Aghori', 'You walk on the burning ghat at this hour? Good. The dead are not the ones to fear here. The living are.'],
      ['the Aghori', 'Three lie down on the lower steps whom nobody came for. No son to light them. No name. They cannot go.'],
      ['the Aghori', 'Take fire from my dhuni and light them. And the pret down there in the mist… do not take your eyes off them.'],
      ['the Aghori', 'They move only when you are not looking.'],
    ],
    start(m) {
      game.asuras.load();
      const pyres = PYRE_U.map((_, i) => ({ at: pyreAt(i), lit: false, fire: -1 }));
      const geo = mergeGeometries(pyres.map((p, i) => pyreGeometry(p.at, mani.yaw + (i - 1) * 0.12)));
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      game.scene.add(mesh);
      if (!ash) {
        ash = new Ash(game.rs.qualityName === 'low' ? 450 : 900);
        game.scene.add(ash.points);
      }
      // the Aghori's dhuni beside him: the diya is lit from it
      const g = terrace(mani.width * 0.56);
      const dhuni = new THREE.Vector3(g.x + mani.T.x * 1.1, g.y + 0.15, g.z + mani.T.z * 1.1);
      const dhuniFire = game.fire.add(dhuni, 0.9, true, 'flame');
      game.handDiya.extraSources = [dhuni];
      game.handDiya.carry(true);
      game.handDiya.windK = 0.8;
      m.state = { pyres, mesh, dhuniFire, dhuni, pret: [], spawned: false, whisperT: 5, stingT: 0, lit: 0, howlT: 8 };
      game.onPretSeen = (a, dist) => {
        const S = m.state;
        if (dist > 10 || game.health.time - S.stingT < 3.5) return;
        S.stingT = game.health.time;
        game.audio.play('pret-sting', { volume: Math.min(0.9, 0.35 + (10 - dist) * 0.07), rate: 0.95 + Math.random() * 0.1 });
        game.camRig.shake(0.08);
        game.dread.threat(1);
      };
    },
    update(m, dt) {
      const S = m.state;
      const p = game.player.position;
      const c = centre();
      const near = Math.hypot(p.x - c.x, p.z - c.z) < 75;
      const done = S.lit >= 3;
      // ---- the night of the burning ghat: mist on the steps, ash in the air, the moon dimmed
      game.sky.mist = damp(game.sky.mist || 0, near ? (done ? 0.35 : 1) : 0, 0.6, dt);
      game.sky.gloom = damp(game.sky.gloom || 0, near && !done ? 0.55 : 0, 0.6, dt);
      ash?.update(dt, game.camera, near, game.rs.pixelRatio);
      game.dread.want('masan', near && !done ? 0.5 + 0.1 * S.lit : 0);
      // ---- the pret come up out of the mist once he is on the steps
      if (!S.spawned && S.lit < 3 && game.asuras.ready && near && p.y < 8) {
        S.spawned = true;
        for (let i = 0; i < 4; i++) {
          const q = ghatToWorld(mani, mani.width * (0.12 + i * 0.25), LANDING_V + (i % 2 ? -1.4 : 1.3));
          const a = game.asuras.spawn('shade', { x: q.x, y: LANDING_2.h0, z: q.z, yaw: mani.yaw }, { name: 'Pret', rise: false, hpMul: 2.5 });
          a.unseen = true;
          S.pret.push(a);
        }
        game.audio.play('whisper-koi-nahi', { volume: 0.8, at: { x: c.x, y: LANDING_2.h0 + 1.5, z: c.z } });
      }
      // something coming for him, unseen: the closest pret out of his sight
      let hunt = 0;
      for (const a of S.pret) if (a.alive && !a.statue) hunt = Math.max(hunt, 1 - Math.hypot(a.pos.x - p.x, a.pos.z - p.z) / 14);
      game.dread.threat(hunt);
      // ---- the voices of the unburned, and Bhairav's dogs
      if (near && !done) {
        S.whisperT -= dt;
        if (S.whisperT <= 0) {
          S.whisperT = 8 + Math.random() * 8;
          const a = Math.random() * Math.PI * 2;
          const pool = WHISPERS.filter((w) => w !== S.lastWhisper);
          S.lastWhisper = pool[Math.floor(Math.random() * pool.length)];
          game.audio.play(S.lastWhisper, { volume: 0.7, at: { x: p.x + Math.sin(a) * 7, y: p.y + 1.2, z: p.z + Math.cos(a) * 7 }, ref: 4 });
        }
        S.howlT -= dt;
        if (S.howlT <= 0) {
          S.howlT = 18 + Math.random() * 20;
          game.audio.play('howl', { volume: 0.4, rate: 0.9 + Math.random() * 0.15, at: { x: c.x + mani.T.x * 60, y: 14, z: c.z + mani.T.z * 60 }, ref: 30 });
        }
      }
      // ---- the objectives
      if (!done) {
        const next = S.pyres.filter((q) => !q.lit);
        m.objective(game.handDiya.lit ? `Light the pyres of the unclaimed dead (${S.lit} of 3). Keep the pret in your sight.` : 'The flame is out. Relight it at the Aghori’s dhuni, or at a burning pyre.', null);
        // (a glint over each, not the tall beam: nothing breaks the night)
        for (const q of next) m.mark('item', { x: q.at.x, y: q.at.y + 1.4, z: q.at.z }, true);
      } else {
        m.objective('Go back up to the Aghori.');
        if (m.giver) m.mark('objective', m.giver);
      }
    },
    interact(m) {
      const S = m.state;
      if (!game.handDiya.lit) return null;
      for (const q of S.pyres) {
        if (q.lit || !m.near(q.at, 2.4)) continue;
        return {
          prompt: 'Light the pyre',
          action: () => {
            q.lit = true;
            S.lit++;
            q.fire = game.fire.add(new THREE.Vector3(q.at.x, q.at.y + 1.15, q.at.z), 1, true, 'pyre');
            game.handDiya.extraSources = [S.dhuni, ...S.pyres.filter((x) => x.lit).map((x) => new THREE.Vector3(x.at.x, x.at.y + 1, x.at.z))];
            game.audio.play('ignite', { volume: 0.9, at: q.at });
            game.audio.play('whisper-moksha', { volume: 0.8, delay: 1.2, at: { x: q.at.x, y: q.at.y + 2.5, z: q.at.z } });
            game.audio.play('chime', { volume: 0.5, delay: 1.8 });
            // the one set free rises in a column of sparks; a pret goes with it
            for (let k = 0; k < 6; k++) game.after(k * 0.25, () => game.asuras.particles.emitEmbers(q.at.x, q.at.y + 1.6 + k * 0.6, q.at.z, 18, { x: 0, z: 0 }, 1.2));
            const free = S.pret.filter((a) => a.alive).sort((a, b) => a.pos.distanceTo(q.at) - b.pos.distanceTo(q.at))[0];
            free?.banish();
            if (S.lit >= 3) {
              for (const a of S.pret) a.banish();
              game.audio.play('conch', { volume: 0.6, delay: 2.5 });
              game.ui.toast('Moksha', 'Three who had nobody have gone on. The mist lifts off the steps.', 5);
            }
          },
        };
      }
      if (S.lit >= 3 && m.giver && m.near(m.giver, 2.8)) return { prompt: 'Sit with the Aghori', action: () => m.done() };
      return null;
    },
    on(m, ev) {
      if (ev === 'combat:death') m.fail('The pret had him in the mist.');
    },
    stop(m) {
      const S = m.state;
      S.mesh?.removeFromParent();
      S.mesh?.geometry.dispose();
      game.fire.setLit(S.dhuniFire, 0);
      // (the pyres burn down to embers by morning)
      for (const q of S.pyres) if (q.fire >= 0) game.fire.setLit(q.fire, 0);
      for (const a of S.pret) a.banish();
      game.handDiya.carry(false);
      game.handDiya.extraSources = null;
      game.onPretSeen = null;
      game.dread.want('masan', 0);
      game.sky.mist = 0;
      game.sky.gloom = 0;
      if (ash) ash.uniforms.uOn.value = 0;
      if (ash) ash.points.visible = false;
    },
    outro: [
      ['the Aghori', 'Hear that? Nothing. That is the sound of the dead who have stopped waiting.'],
      ['the Aghori', 'Shiva sits on this ghat with the ash on him, they say, and whispers the word that frees them. Tonight you lent him your hands.'],
    ],
    reward: { punya: 45, note: 'Three of the unclaimed dead have gone on' },
  };
}

// ---------------------------------------------------------------- sounds (made in code)

/** The pret sting: a shrill, scraping chord of detuned strings, struck and gone. */
export function synthSting(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 1.6);
  const b = ctx.createBuffer(2, n, sr);
  const fs = [1244, 1318, 1864, 2489, 622];
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const ph = fs.map(() => Math.random() * 6.28);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t * 60) * Math.exp(-t * 2.6);
      let s = 0;
      fs.forEach((f, k) => {
        // a bowed edge: a saw-like tone with a fast vibrato that widens as it fades
        const fv = f * (1 + 0.012 * Math.sin(t * (28 + k * 3)) * (0.4 + t));
        const x = (fv * t + ph[k] / 6.28 + ch * 0.13) % 1;
        s += (x * 2 - 1) / (k + 2);
      });
      d[i] = s * env * 0.32 + (Math.random() * 2 - 1) * env * Math.exp(-t * 9) * 0.08;
    }
  }
  return b;
}
