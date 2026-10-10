// Trailer capture rig: the game at Ultra, frame-exact (manual clock), a cinematic camera on
// spline keys, scripted Prady, weather and hour control.
//   import { open } from './rig.mjs'; const s = await open(); await s.jump('Asuras rise'); ...
//   await s.rec('shot-name', seconds)   -> $TRAILER_WORK/frames/shot-name/00000.jpg ... (30 fps, 2 sub-ticks)
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORK = process.env.TRAILER_WORK || path.join(os.tmpdir(), 'varanasi-trailer');
const OUT = path.join(WORK, 'frames');

const INIT = () => {
  const q = [];
  const realRAF = window.requestAnimationFrame.bind(window);
  const pnow = performance.now.bind(performance);
  window.__manual = false;
  window.__t = 0;
  window.requestAnimationFrame = (cb) => (window.__manual ? (q.push(cb), q.length) : realRAF(cb));
  performance.now = () => (window.__manual ? window.__t : pnow());
  window.__startManual = () => { window.__t = pnow(); window.__manual = true; };
  window.__tick = (n = 1, ms = 1000 / 60) => { for (let i = 0; i < n; i++) { window.__t += ms; const cbs = q.splice(0); for (const cb of cbs) cb(window.__t); } };
  // Ultra, no adaptive resolution, clear weather unless a shot asks for rain
  localStorage.setItem('prady-settings-v1', JSON.stringify({ quality: 'ultra', adaptiveResolution: false, weather: 'clear', shake: 1, reduceFlashes: false, musicVolume: 0, sfxVolume: 0, ambienceVolume: 0 }));
};

// helpers installed in the page (window.T)
const HELPERS = () => {
  const g = window.__game;
  const THREE_V = (x, y, z) => g.camera.position.clone().set(x, y, z);
  const T = (window.T = { g });
  const pl = g.player;
  T.hideUI = () => { document.getElementById('ui').style.visibility = 'hidden'; };
  T.hours = (h, freeze = true) => { g.sky.setHours(h); g.sky.frozen = freeze; };
  T.weather = (mode, wet) => {
    const w = g.weather;
    w.setMode(mode);
    if (mode === 'clear') { w.overcast = 0; w.rain = 0; w.wet = wet ?? 0; }
    else { w.overcast = 1; w.rain = mode === 'storm' ? 1 : 0.75; w.wet = wet ?? 1; }
  };
  T.bolt = () => { g.weather.boltTimer = 0; };
  // the boat race's start and finish banners stand in the river all the time: out of the trailer
  T.noRace = () => { for (const m of [g.race?.lineMesh, g.race?.bannerMesh, g.race?.gateMesh]) if (m) m.visible = false; };
  // stars: their HDR glow blooms into big dots at 1080p; a trailer exposure keeps them as stars
  T.stars = (k = 0.3) => { if (!g.sky.__upd) { const u = g.sky.update.bind(g.sky); g.sky.__upd = u; g.sky.update = (...a) => { const r = u(...a); g.sky.starMat.uniforms.uOpacity.value *= T.starK; return r; }; } T.starK = k; };
  T.starK = 1;
  T.jump = async (label) => { const e = g.testMenu.entries.find((q) => q.label.startsWith(label)); if (!e) throw new Error('no entry ' + label); await g.testMenu.jump(e); T.hideUI(); g.ui.closeMenu(); };
  T.inv = () => { g.health.invincible = true; };
  // drive Prady: a world direction and a gait ('walk' | 'run' | 'sprint' | 'stop')
  T.drive = (dx, dz, mode = 'run', extra = {}) => {
    const l = Math.hypot(dx, dz) || 1;
    pl.walkMode = mode === 'walk';
    pl.readInput = function (input, cam) {
      this.camYaw = cam.yaw; this.camPitch = cam.pitch;
      const c = this.cmd; c.mag = mode === 'stop' ? 0 : 1; c.mv = { x: 0, y: c.mag }; c.wish.set(dx / l, 0, dz / l);
      c.sprint = mode === 'sprint'; c.jumpHeld = !!extra.jump; c.up = !!extra.up; c.down = !!extra.down;
    };
  };
  T.stop = () => T.drive(0, 1, 'stop');
  T.free = () => { delete pl.readInput; };
  T.tp = (x, y, z, yaw) => { pl.teleport(x, y, z); pl.velocity.set(0, 0, 0); if (yaw !== undefined) { pl.yaw = yaw; g.character.rotation.y = yaw; } };
  T.ghat = (id) => g.world.layout.ghats.find((x) => x.id === id);
  T.gp = (id, u, v) => { const gh = T.ghat(id); return { x: gh.S.x + gh.T.x * u + gh.N.x * v, z: gh.S.z + gh.T.z * u + gh.N.z * v }; };
  T.P = () => { const p = g.character.position; return [p.x, p.y, p.z]; };
  import('/src/world/WorldLayout.js').then((m) => (T.ground = m.groundHeight));

  // ---- the camera: keys { t, pos:[x,y,z], look:[x,y,z], fov } (world), or a function of time.
  // Catmull-Rom through the keys (eased overall), real time (slow motion doesn't slow the lens).
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const sample = (keys, prop, t) => {
    if (t <= keys[0].t) return keys[0][prop];
    const n = keys.length;
    if (t >= keys[n - 1].t) return keys[n - 1][prop];
    let i = 0;
    while (i < n - 2 && t > keys[i + 1].t) i++;
    const k1 = keys[i], k2 = keys[i + 1];
    const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(n - 1, i + 2)];
    const u = (t - k1.t) / (k2.t - k1.t);
    const a = k1[prop], b = k2[prop];
    if (typeof a === 'number') return cr(k0[prop], a, b, k3[prop], u);
    return a.map((_, j) => cr(k0[prop][j], a[j], b[j], k3[prop][j], u));
  };
  // ---- per frame (game time, after Game.update): the shot clock, its beats, its tick(t, dt)
  T.camT = 0;
  T.beats = [];
  if (!g.__tw) {
    g.__tw = true;
    const u = g.update.bind(g);
    g.update = (dt, w) => {
      // taps queued since the last frame: pressed (and held) for exactly this one
      const I = g.input; const taps = T.taps.splice(0);
      for (const c of taps) { I.pressed.add(c); I.keys.add(c); }
      const held = new Set(I.keys);
      const r = u(dt, w);
      for (const c of taps) if (!T.holding.has(c)) I.keys.delete(c);
      void held;
      if (!w && T.camSpec) {
        T.camT += dt;
        for (const b of T.beats) if (!b.done && T.camT >= b.t) { b.done = true; try { b.fn(g); } catch (e) { console.error('beat', e.message); } }
        try { T.camSpec.tick?.(T.camT, dt, g); } catch (e) { console.error('tick', e.message); }
        // a finisher or a kill cam took the lens and gave it back: ours again
        if (T.camSpec.restore && !g.camRig.override && !g.finishers?.active && !g.cinematics?.shot) g.camRig.override = T.ovr;
      }
      return r;
    };
    // the game's lens breathing (sprint wide, slow motion in) stays off our shots
    const cu = g.cinematics.update.bind(g.cinematics);
    g.cinematics.update = (dt) => { cu(dt); if (T.camSpec && g.camRig.override === T.ovr && T.fovNow) { g.camera.fov = T.fovNow; g.cinematics.fov = T.fovNow; g.camera.updateProjectionMatrix(); } };
  }
  T.cam = (spec) => {
    T.camT = 0;
    T.camSpec = spec;
    const ease = spec.ease ?? true;
    T.beats = (spec.beats || []).map(([t, fn]) => ({ t, fn }));
    T.ovr = (dt, cam) => {
      const S = T.camSpec;
      let pos, look, fov;
      if (typeof S.fn === 'function') ({ pos, look, fov } = S.fn(T.camT, g, dt));
      else {
        const end = S.keys[S.keys.length - 1].t;
        let t = Math.min(T.camT, end);
        if (ease) { const k = t / end; t = end * (k * k * (3 - 2 * k) * 0.35 + k * 0.65); }
        pos = sample(S.keys, 'pos', t);
        look = sample(S.keys, 'look', t);
        fov = S.keys[0].fov !== undefined ? sample(S.keys, 'fov', t) : S.fov;
      }
      if (S.rel) { const p = g.character.position; pos = [pos[0] + p.x, pos[1] + p.y, pos[2] + p.z]; look = [look[0] + p.x, look[1] + p.y, look[2] + p.z]; }
      cam.position.set(pos[0], pos[1], pos[2]);
      if (S.roll) cam.up.set(Math.sin(S.roll), Math.cos(S.roll), 0); else cam.up.set(0, 1, 0);
      cam.lookAt(look[0], look[1], look[2]);
      if (fov) { T.fovNow = fov; if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); } }
      if (S.focus) { const f = typeof S.focus === 'function' ? S.focus(T.camT, g) : S.focus; g.rs.setDof(1, THREE_V(f[0], f[1], f[2]), S.dof || { range: 30, bokeh: 1.4 }); }
      else g.rs.setDof(0, g.rs.dofTarget);
    };
    g.camRig.override = spec.game ? null : T.ovr;
  };
  // in-page keys (Input: held set + pressed-this-frame set)
  T.taps = T.taps || [];
  T.holding = T.holding || new Set();
  T.key = (code, down = true) => { const I = g.input; if (down) { I.keys.add(code); T.holding.add(code); T.taps.push(code); } else { I.keys.delete(code); T.holding.delete(code); } };
  T.tap = (code) => { T.taps.push(code); };
  T.camOff = () => { T.camSpec = null; g.camRig.override = null; g.rs.setDof(0, g.rs.dofTarget); };
  // keep the game's own lens breathing from fighting ours
  T.lockFov = (on = true) => { g.cinematics.baseFov = on ? g.camera.fov : g.cinematics.baseFov; };
};

export async function open({ w = 1920, h = 1080, scale = 1, url = 'http://localhost:5173/?debug' } = {}) {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(INIT);
  await p.goto(url, { timeout: 180000 });
  await p.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
  const s = {
    p, b, errs,
    /** a test-menu jump (label prefix), then the helpers, UI hidden */
    async jump(label) {
      await p.evaluate(async (label) => { const g = window.__game; const e = g.testMenu.entries.find((q) => q.label.startsWith(label)); if (!e) throw new Error('no entry ' + label); await g.testMenu.jump(e, 'title'); }, label);
      await p.evaluate(HELPERS);
      await p.evaluate(() => { T.hideUI(); T.noRace(); T.stars(0.3); });
    },
    async begin() {
      await p.evaluate(async () => { await window.__game.begin(null, { skipIntro: true }); });
      await p.evaluate(HELPERS);
      await p.evaluate(() => { const g = window.__game; g.camRig.skipCinematic(); g.ui.setCinematic(false); T.hideUI(); T.noRace(); T.stars(0.3); });
    },
    async js(fn, arg) { return p.evaluate(fn, arg); },
    /** load shots.js (fresh each time: edits apply without a restart) */
    async lib() { await p.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots.js'), 'utf8') }); await p.waitForFunction(() => window.T && T.ground); },
    /** set up shot `name`, settle, start its camera at t = 0 */
    async shot(name, preOverride) {
      const pre = await p.evaluate(async (n) => { const sh = SHOTS[n]; if (!sh) throw new Error('no shot ' + n); window.RESET?.(); window.__game.stopActivities?.(); await sh.setup?.(window.__game); T.cam({ ...sh.cam(window.__game), beats: [], tick: null }); return sh.pre ?? 2; }, name);
      await this.settle(preOverride ?? pre);
      await p.evaluate(async (n) => { const sh = SHOTS[n]; await sh.go?.(window.__game); T.cam({ beats: sh.beats, tick: sh.tick, restore: sh.restore, game: sh.game, ...sh.cam(window.__game) }); }, name);
      return p.evaluate((n) => SHOTS[n].dur, name);
    },
    /** stills at fractions of the shot (scouting) */
    async scout(name, dir, at = [0, 0.5, 1]) {
      const dur = await this.shot(name);
      const files = [];
      let t = 0;
      for (const k of at) { const n = Math.round((k * dur - t) * 60); if (n > 0) await this.tick(n); t = k * dur; const f = path.join(dir, `${name}-${Math.round(k * 100)}.jpg`); await p.screenshot({ path: f, type: 'jpeg', quality: 85 }); files.push(f); }
      return files;
    },
    async manual() { await p.evaluate(() => window.__startManual()); await p.evaluate(() => window.__tick(2)); },
    async tick(n = 1) { await p.evaluate((n) => window.__tick(n), n); },
    /** let the world settle (real time is not running: n ticks at 60 Hz) */
    async settle(secs = 2) { const n = Math.round(secs * 60); for (let i = 0; i < n; i += 30) await p.evaluate((k) => window.__tick(k), Math.min(30, n - i)); },
    /**
     * Record `secs` at 30 fps: 2 ticks (60 Hz) per frame; `blur` saves both sub-frames (blended
     * later into a 180° shutter). `each(i)` runs in node before frame i (script beats).
     */
    async rec(name, secs, { fps = 30, blur = false, each = null, q = 92 } = {}) {
      const dir = path.join(OUT, name);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
      const n = Math.round(secs * fps);
      const sub = Math.round(60 / fps);
      let k = 0;
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        if (each) await each(i, i / fps);
        if (blur) {
          for (let j = 0; j < sub; j++) {
            await p.evaluate(() => window.__tick(1));
            await p.screenshot({ path: path.join(dir, `${String(k++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: q });
          }
        } else {
          await p.evaluate((m) => window.__tick(m), sub);
          await p.screenshot({ path: path.join(dir, `${String(k++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: q });
        }
      }
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ blur, fps, frames: n }));
      const el = (Date.now() - t0) / 1000;
      console.log(`[rec] ${name}: ${n} frames in ${el.toFixed(0)} s (${((el / k) * 1000).toFixed(0)} ms/shot)`);
      return dir;
    },
    async still(file) { await p.screenshot({ path: file, type: 'jpeg', quality: 90 }); },
    async close() { await b.close(); },
  };
  return s;
}
