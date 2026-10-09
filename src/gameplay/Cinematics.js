import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp } from '../utils/math.js';

// The film around the game: what a camera operator, an editor and a sound mixer would add.
//
//   impact    a blow lands: the colour splits and the frame streaks toward it for an instant
//             (the renderer's ImpactEffect); slow motion holds a little of both
//   hush      slow motion muffles the world (the master low-pass), the way a film drops the mix
//   lens      the field of view breathes: wider at a sprint, pushed in during slow motion
//   intro     a fight begins: a low shot over his shoulder at the dark rising from the river,
//             bars top and bottom, the risers in focus (any action key cuts back to him)
//   kill cam  the last of them falls: slow motion, the camera swings round him once, bars,
//             then eases back into the follow view
//   flare     the low sun in the lens: ghosts along the line through the frame, unless a wall
//             or a roof stands between
//   motes     dust hanging in the air around the camera, catching the light when he looks
//             toward the sun
//
// All of it respects the settings (Reduce flashes softens the impact and the flare).

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Vector3();

const MOTES = 320;
const moteVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uSun;
  uniform float uPx;
  varying float vA;
  void main() {
    // the motes live in a box that travels with the camera (each wraps round to the far side)
    vec3 drift = vec3(sin(uTime * 0.07 + aSeed * 20.0), sin(uTime * 0.05 + aSeed * 7.0) * 0.6 + 0.15, cos(uTime * 0.06 + aSeed * 13.0)) * 0.35;
    vec3 p = mod(position + drift * uTime - uCam + 7.0, 14.0) - 7.0 + uCam;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    gl_PointSize = clamp(2.2 * uPx * 6.0 / max(d, 0.6), 1.0, 5.0 * uPx);
    // forward scattering: bright against the sun, near-invisible with it behind
    vec3 view = normalize(p - uCam);
    float glint = pow(max(dot(view, uSun), 0.0), 6.0);
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 40.0);
    vA = (0.06 + glint * 0.9) * twinkle * smoothstep(0.5, 1.5, d) * (1.0 - smoothstep(9.0, 12.0, d));
  }
`;
const moteFrag = /* glsl */ `
  uniform float uDay;
  varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - r) * (1.0 - r) * vA * uDay;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * 1.6, a);
  }
`;

export class Cinematics {
  constructor(game) {
    this.g = game;
    this.chroma = 0;
    this.blur = 0;
    this.center = new THREE.Vector2(0.5, 0.5);
    this.fov = game.camera.fov;
    this.baseFov = game.camera.fov;
    this.shot = null;
    this.lastKill = null;
    this.flareVis = 0;
    this.makeMotes();
    this.makeFlare();
  }

  // ------------------------------------------------------------------ impact
  /** A blow lands (k ~0.3 a heavy hit .. 1 a finisher's last cut), at a world point if given. */
  impact(k, at = null) {
    this.chroma = Math.max(this.chroma, 0.011 * k);
    this.blur = Math.max(this.blur, 0.1 * k);
    if (at) {
      _v.set(at.x, at.y ?? this.g.player.position.y + 0.4, at.z).project(this.g.camera);
      if (_v.z < 1) this.center.set(clamp(_v.x * 0.5 + 0.5, 0.15, 0.85), clamp(_v.y * 0.5 + 0.5, 0.15, 0.85));
    } else this.center.set(0.5, 0.5);
  }

  // ------------------------------------------------------------------ shots
  free() {
    const g = this.g;
    return !this.shot && !g.camRig.override && !g.finishers?.active && !g.photo && g.state === 'play' && !g.story?.cut;
  }

  /** A fight begins: the dark rising at `at` (world), seen low over his shoulder. */
  intro(at) {
    const g = this.g;
    if (!this.free() || g.missions?.dialogue) return;
    const P = g.character.position;
    const dx = at.x - P.x;
    const dz = at.z - P.z;
    const l = Math.hypot(dx, dz) || 1;
    this.begin({ kind: 'intro', t: 0, dur: 2.8, P: P.clone(), to: new THREE.Vector3(at.x, (at.y ?? P.y) + 1.0, at.z), fx: dx / l, fz: dz / l, fov: this.baseFov - 6, focus: new THREE.Vector3() });
    // a rack focus: on him first, then out to the river as they rise
    g.rs.setDof(1, this.shot.focus.copy(P).setY(P.y + 1.4));
  }

  /** The last of them falls at `at`: once round him in slow motion. */
  killCam(at) {
    const g = this.g;
    if (!this.free() || (g.finishers?.endedAt !== undefined && g.health.time - g.finishers.endedAt < 0.8)) return;
    const P = g.character.position;
    // round him: the orbit's centre is his chest (it follows him if a blow carries him on)
    const mid = new THREE.Vector3(P.x, P.y + 1.05, P.z);
    const c = g.camera.position;
    const ang0 = Math.atan2(c.x - mid.x, c.z - mid.z);
    const dist = clamp(Math.hypot(c.x - mid.x, c.z - mid.z), 3.2, 4.4);
    // the way round with room for the lens (a woodpile, a wall, an umbrella close by would pull
    // it into his arm); boxed in both ways, it cranes up and looks down on him instead
    const room = (turn, lift) => {
      let worst = Infinity;
      for (const f of [0.35, 0.7, 1]) {
        const a = ang0 + turn * f;
        _v.set(Math.sin(a), 0.35 + lift, Math.cos(a)).normalize();
        const len = Math.hypot(dist, (0.35 + lift) * dist);
        const hit = g.physics.sphereCast(mid, _v, 0.22, len, g.player.collider, GROUPS.ignorePeople);
        worst = Math.min(worst, hit ?? len);
      }
      return worst;
    };
    const turn = room(0.95, 0) >= room(-0.95, 0) ? 0.95 : -0.95;
    const lift = Math.max(room(0.95, 0), room(-0.95, 0)) > dist * 0.8 ? 0 : 0.9;
    this.begin({ kind: 'kill', t: 0, dur: 1.7, mid, ang0, turn: lift ? turn * 0.5 : turn, lift, dist, fov: this.baseFov - 4 });
    g.rs.setDof(1, _w.copy(P).setY(P.y + 1.3).clone());
    g.slowMo(0.25, 1.1);
  }

  begin(shot) {
    const g = this.g;
    this.shot = shot;
    shot.from = g.camera.position.clone();
    g.ui.setLetterbox(true);
    g.camRig.override = (dt, cam) => this.shotCam(dt, cam);
  }

  shotCam(dt, cam) {
    const S = this.shot;
    const g = this.g;
    if (!S) return;
    S.t += dt;
    const k = Math.min(1, S.t / S.dur);
    const e = k * k * (3 - 2 * k);
    let look;
    if (S.kind === 'intro') {
      // low and behind his right shoulder, drifting in toward the river as they rise
      const rx = S.fz;
      const rz = -S.fx;
      const back = 3.4 - e * 0.8;
      _v.set(S.P.x - S.fx * back + rx * 1.0, S.P.y + 1.55 + e * 0.15, S.P.z - S.fz * back + rz * 1.0);
      // looking past him (his shoulder in the left of the frame) to the water they rise from
      look = _w.copy(S.to).lerp(S.P, 0.25);
      look.y = S.P.y + 1.1;
      _m.set(S.P.x + rx * 0.4, S.P.y + 1.4, S.P.z + rz * 0.4);
      // the focus racks from him to the river between 0.6 and 1.6 s
      const r = Math.min(1, Math.max(0, (S.t - 0.6) / 1.0));
      S.focus.set(S.P.x, S.P.y + 1.4, S.P.z).lerp(S.to, r * r * (3 - 2 * r));
    } else {
      // once round him
      const P = g.character.position;
      S.mid.set(P.x, P.y + 1.05, P.z);
      const a = S.ang0 + S.turn * e;
      _v.set(S.mid.x + Math.sin(a) * S.dist, S.mid.y + 0.35 - e * 0.25 + S.lift * S.dist * 0.6, S.mid.z + Math.cos(a) * S.dist);
      look = _w.copy(S.mid);
      _m.copy(S.mid);
    }
    // never through a wall (the bodies don't count)
    const dir = _v.clone().sub(_m);
    const len = dir.length();
    dir.normalize();
    const hit = g.physics.sphereCast(_m, dir, 0.2, len, g.player.collider, GROUPS.ignorePeople);
    if (hit !== null) _v.copy(_m).addScaledVector(dir, Math.max(1.6, hit - 0.1));
    // eased in from wherever the follow camera was
    const blend = Math.min(1, S.t / 0.35);
    cam.position.copy(S.from).lerp(_v, blend * blend * (3 - 2 * blend));
    cam.lookAt(look);
    if (k >= 1) this.end();
  }

  end() {
    const g = this.g;
    const S = this.shot;
    if (!S) return;
    this.shot = null;
    g.camRig.override = null;
    const P = g.player.position;
    const c = g.camera.position;
    g.camRig.yaw = Math.atan2(P.x - c.x, P.z - c.z);
    g.camRig.first = true;
    g.camRig.blendFrom(0.6);
    g.ui.setLetterbox(false);
    g.rs.setDof(g.photo ? g.rs.dofLevel : 0, g.rs.dofTarget);
  }

  // ------------------------------------------------------------------ per frame (real time)
  update(dt) {
    const g = this.g;
    if (!g.rs) return;
    const quiet = g.settings.reduceFlashes;
    // an action key cuts the fight's intro short (the kill cam always plays out: it's slow)
    if (this.shot?.kind === 'intro' && this.shot.t > 0.5) {
      const I = g.input;
      if (['Mouse0', 'Mouse2', 'Space', 'KeyQ', 'KeyE', 'Tab'].some((k) => I.hit(k)) || (g.player.cmd?.mag ?? 0) > 0.3) this.end();
    }
    // the jolt fades fast; slow motion keeps a little of it, and hushes the world
    this.chroma = Math.max(0, this.chroma - dt * 0.05);
    this.blur = Math.max(0, this.blur - dt * 0.45);
    const slow = clamp(1 - g.timeScale, 0, 1);
    const ch = (this.chroma + slow * 0.0035) * (quiet ? 0.35 : 1);
    const bl = (this.blur + slow * 0.02) * (quiet ? 0.5 : 1);
    g.rs.setImpact(ch, bl, this.center.x, this.center.y);
    g.audio.setMuffle(clamp(slow * 1.15, 0, 0.85));
    // the lens: a sprint widens it, slow motion and a shot push in
    const sprinting = g.player.cmd?.sprint && g.player.speed > 4 && g.player.state === 'ground';
    const want = this.shot ? this.shot.fov : this.baseFov + (sprinting ? 5 : 0) - slow * 5;
    const f = damp(this.fov, want, this.shot ? 3 : 4, dt);
    if (Math.abs(f - this.fov) > 0.005) {
      this.fov = f;
      g.camera.fov = f;
      g.camera.updateProjectionMatrix();
    }
    this.updateMotes(dt);
    this.updateFlare(dt);
  }

  // ------------------------------------------------------------------ motes
  makeMotes() {
    const pos = new Float32Array(MOTES * 3);
    const seed = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      pos.set([Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uPx: { value: 1 }, uDay: { value: 0 } },
      vertexShader: moteVert,
      fragmentShader: moteFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 7;
    this.g.scene.add(this.motes);
  }

  updateMotes(dt) {
    const g = this.g;
    const U = this.moteMat.uniforms;
    U.uTime.value += dt;
    U.uCam.value.copy(g.camera.position);
    U.uSun.value.copy(g.sky.sunDir);
    U.uPx.value = g.rs.renderer.getPixelRatio();
    // by day, in the air (not under the water)
    const day = clamp((g.sky.sunDir.y + 0.02) * 6, 0, 1) * (1 - (g.weather?.rain ?? 0));
    U.uDay.value = g.camera.position.y < (g.water?.heightAt?.(g.camera.position.x, g.camera.position.z) ?? 0) ? 0 : day;
    this.motes.visible = U.uDay.value > 0.01;
  }

  // ------------------------------------------------------------------ flare
  makeFlare() {
    const el = document.createElement('div');
    el.id = 'flare';
    // ghosts along the line from the sun through the middle of the frame (t: how far along it)
    this.ghosts = [
      [0, 190, '', 'radial-gradient(circle, rgba(255,240,205,0.6) 0%, rgba(255,200,120,0.16) 22%, rgba(255,180,90,0) 60%)'],
      [0.32, 46, '', 'radial-gradient(circle, rgba(255,210,140,0.32) 0%, rgba(255,190,110,0.12) 55%, rgba(0,0,0,0) 72%)'],
      [0.62, 22, '', 'radial-gradient(circle, rgba(180,220,255,0.35) 0%, rgba(120,170,255,0) 70%)'],
      [1.05, 90, '', 'radial-gradient(circle, rgba(0,0,0,0) 52%, rgba(255,170,90,0.16) 62%, rgba(140,200,255,0.12) 70%, rgba(0,0,0,0) 76%)'],
      [1.35, 34, '', 'radial-gradient(circle, rgba(255,160,90,0.3) 0%, rgba(255,120,60,0) 70%)'],
      [1.75, 64, '', 'radial-gradient(circle, rgba(170,255,210,0.14) 0%, rgba(120,200,255,0.08) 50%, rgba(0,0,0,0) 72%)'],
    ].map(([t, size, , bg]) => {
      const d = document.createElement('i');
      d.style.cssText = `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;background:${bg}`;
      el.appendChild(d);
      return { t, d };
    });
    this.g.ui.root.appendChild(el);
    this.flareEl = el;
  }

  updateFlare(dt) {
    const g = this.g;
    const sun = g.sky.sunDir;
    const cam = g.camera;
    let want = 0;
    let sx = 0;
    let sy = 0;
    // a low sun in the frame (and the day not too grey), not underwater, not in the menus
    if (sun.y > -0.01 && sun.y < 0.45 && g.state === 'play' && !g.photo) {
      _v.copy(cam.position).addScaledVector(sun, 1000).project(cam);
      if (_v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05) {
        sx = _v.x;
        sy = _v.y;
        want = (1 - (g.weather?.rain ?? 0)) * (1 - clamp((sun.y - 0.25) / 0.2, 0, 1));
        // a wall, a roof, a fort between the lens and the sun: no flare (checked a few times a second)
        this.occT = (this.occT || 0) - dt;
        if (this.occT <= 0) {
          this.occT = 0.15;
          this.occluded = g.physics.castRay({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: sun.x, y: sun.y, z: sun.z }, 400, g.player.collider, GROUPS.ignorePeople) !== null;
        }
        if (this.occluded) want = 0;
      }
    }
    if (g.settings.reduceFlashes) want *= 0.45;
    this.flareVis = damp(this.flareVis, want, want > this.flareVis ? 5 : 8, dt);
    const el = this.flareEl;
    if (this.flareVis < 0.01) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.opacity = this.flareVis.toFixed(3);
    const W = innerWidth;
    const H = innerHeight;
    const px = (sx * 0.5 + 0.5) * W;
    const py = (-sy * 0.5 + 0.5) * H;
    for (const { t, d } of this.ghosts) d.style.transform = `translate(${(px + (W / 2 - px) * t).toFixed(1)}px, ${(py + (H / 2 - py) * t).toFixed(1)}px)`;
  }
}
