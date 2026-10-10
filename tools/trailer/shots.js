// The trailer's shots (runs in the page, after rig.mjs HELPERS). SHOTS[name] = {
//   dur      seconds of the shot
//   pre      seconds to settle first (streaming, shadows, the crowd finding their places)
//   setup()  hours, weather, the world, Prady (may be async; before the settle)
//   go()     right before the shot starts (after the settle)
//   cam()    the camera spec for T.cam (keys from t = 0, or fn(t, g, dt) -> { pos, look, fov })
//   beats    [[t, fn]]: things that happen on cue;  tick(t, dt): every frame
//   restore  take the lens back after a finisher / kill cam;  game: the game's own camera
// }
(() => {
  const g = window.__game;
  const S = (window.SHOTS = {});
  const W = (id, u, v, dy = 0) => { const p = T.gp(id, u, v); return [p.x, T.ground(p.x, p.z) + dy, p.z]; };
  const Wy = (id, u, v, y) => { const p = T.gp(id, u, v); return [p.x, y, p.z]; };
  window.W = W;
  window.Wy = Wy;
  const D = 'dashashwamedh';
  const M = 'manikarnika';
  let GROUPS = null;
  import('/src/core/Physics.js').then((m) => (GROUPS = m.GROUPS));
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---- helpers for shots around Prady
  const P = () => g.character.position;
  const fwd = () => { const y = g.player.yaw; return [Math.sin(y), Math.cos(y)]; };
  // a smoothed point (the lens shouldn't carry every bob of his walk)
  const sm = { p: null };
  const smooth = (x, y, z, dt, k = 5) => {
    if (!sm.p || dt === 0 || dt > 0.5) sm.p = [x, y, z];
    const a = 1 - Math.exp(-k * dt);
    sm.p = [lerp(sm.p[0], x, a), lerp(sm.p[1], y, a), lerp(sm.p[2], z, a)];
    return sm.p;
  };
  // keep the lens out of walls (people don't count)
  const clear = (from, to) => {
    if (!GROUPS) return to;
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(...d) || 1;
    const dir = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
    const hit = g.physics.sphereCast({ x: from[0], y: from[1], z: from[2] }, dir, 0.25, len, g.player.collider, GROUPS.ignorePeople);
    if (hit === null) return to;
    const k = Math.max(1.2, hit - 0.15);
    return [from[0] + dir.x * k, from[1] + dir.y * k, from[2] + dir.z * k];
  };
  // a slow orbit round Prady (or round the fight): radius r, height h, angular speed w (rad/s)
  const orbit = ({ r = 3.6, h = 0.7, w = 0.14, a0 = 0, lookH = 1.15, fov = 40, mid = 0.3 }) => (t, g, dt) => {
    const c = P();
    // the middle of the fight: him and the nearest of them
    let tx = c.x, tz = c.z;
    const a = nearest();
    if (a && mid > 0) { tx = lerp(c.x, a.pos.x, mid); tz = lerp(c.z, a.pos.z, mid); }
    const [cx, cy, cz] = smooth(tx, c.y, tz, dt, 3);
    const ang = a0 + w * t;
    const want = [cx + Math.sin(ang) * r, cy + h, cz + Math.cos(ang) * r];
    const pos = clear([cx, cy + 1.1, cz], want);
    pos[1] = Math.max(pos[1], g.water.heightAt(pos[0], pos[2]) + 0.6, T.ground(pos[0], pos[2]) + 0.35);
    return { pos, look: [cx, Math.max(cy + lookH, 0.8), cz], fov };
  };
  // side-on to the fight (the line from him to the nearest of them), from the river or the city
  const profile = ({ r = 4.4, h = 0.85, lookH = 1.15, fov = 40, side = 1, mix = 0.5, k = 2.2 }) => {
    let pd = null, cp = null;
    return (t, g, dt) => {
      const c = P(); const a = nearest();
      const ax = a ? a.pos.x : c.x + fwd()[0] * 3, az = a ? a.pos.z : c.z + fwd()[1] * 3;
      let dx = ax - c.x, dz = az - c.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      let px = -dz, pz = dx;
      if (pz * side < 0) { px = -px; pz = -pz; }
      const kk = 1 - Math.exp(-k * Math.min(dt, 0.1));
      pd = pd ? [lerp(pd[0], px, kk), lerp(pd[1], pz, kk)] : [px, pz];
      const pl = Math.hypot(...pd) || 1;
      const mx = lerp(c.x, ax, mix), mz = lerp(c.z, az, mix);
      const R = Math.max(r, Math.min(l, 8) * 0.8 + 2.4);
      const want = [mx + (pd[0] / pl) * R, c.y + h, mz + (pd[1] / pl) * R];
      cp = cp ? [lerp(cp[0], want[0], kk * 1.5), lerp(cp[1], want[1], kk * 1.5), lerp(cp[2], want[2], kk * 1.5)] : want;
      const look = smooth(mx, c.y + lookH, mz, dt, 3);
      const pos = clear([mx, c.y + 1.1, mz], cp);
      pos[1] = Math.max(pos[1], g.water.heightAt(pos[0], pos[2]) + 0.9, T.ground(pos[0], pos[2]) + 0.5);
      look[1] = Math.max(look[1], 1.0);
      return { pos, look, fov };
    };
  };
  window.profile = profile;
  const nearest = () => {
    const c = P();
    let best = null, bd = Infinity;
    for (const a of g.asuras.list) { if (!a.alive) continue; const d = Math.hypot(a.pos.x - c.x, a.pos.z - c.z); if (d < bd) { bd = d; best = a; } }
    return best;
  };
  window.nearest = nearest;

  // ---- the fight bot (bot.js, driven by the frame clock): lock on, close in, cut, guard or roll
  const bot = { acc: 0, guard: 0, on: false, heavyEvery: 0.15, finish: false, powers: [] };
  window.BOT = bot;
  const botStep = (dt) => {
    if (!bot.on) return;
    bot.acc += dt;
    if (bot.acc < 0.1) return;
    bot.acc = 0;
    const p = g.player.position;
    if (bot.finish && g.finishers.target && !g.finishers.active) { g.finishers.start(g.finishers.target); return; }
    if (g.finishers.active) return;
    const live = g.asuras.list.filter((a) => a.alive && a.uniforms.uDissolve.value < 0.3 && g.water.heightAt(a.pos.x, a.pos.z) - a.pos.y < 0.4);
    if (!live.length) { T.stop(); T.key('KeyQ', false); return; }
    live.sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z));
    const t = live[0];
    if (!g.lockOn.active) g.lockOn.toggle();
    const dx = t.pos.x - p.x, dz = t.pos.z - p.z, d = Math.hypot(dx, dz);
    const threat = live.find((a) => a.state === 'attack' && (a.glare || 0) > 0.25 && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 3.4 * Math.sqrt(a.scale));
    if (threat) {
      if (Math.random() < 0.5) { const sx = -(threat.pos.z - p.z), sz = threat.pos.x - p.x; g.combat.dodge({ x: sx, z: sz }); T.key('KeyQ', false); }
      else { T.key('KeyQ', true); bot.guard = 6; }
      T.stop();
      return;
    }
    if (bot.guard-- <= 0) T.key('KeyQ', false);
    // a power now and then, when they're close
    if (bot.powers.length && d < 5 && Math.random() < 0.08) { const k = bot.powers.shift(); g.powers.press(k); return; }
    const wet = g.water.heightAt(p.x + dx * 0.15, p.z + dz * 0.15) - g.player.feetY;
    if (d > 2.3 + t.radius && wet < 0.3) T.drive(dx, dz, d > 6 ? 'sprint' : 'run');
    else if (d > 2.3 + t.radius) T.stop();
    else { T.stop(); g.combat.attack(); if (Math.random() < bot.heavyEvery) g.combat.heavy(); }
  };
  window.botStep = botStep;
  const arm = () => { g.combat.setHasSword(true); g.combat.armed = true; g.combat.stance(4); };
  const night = (h = 20.8, mode = 'rain') => { T.hours(h); T.weather(mode, 1); g.weather.boltTimer = 99; g.quest.forceAarti = true; };
  const fight = async (id, u, waves, which = 2, vOff = 0) => {
    g.testMenu.placeOnGhat(id, u, which, vOff);
    T.inv();
    arm();
    await g.encounters.start({ ghat: id, u, waves, onWin: () => {} });
  };

  // ------------------------------------------------------------- act one: the city of light
  // sunrise over the river from low on the steps: a moored boat, a bather, the sun on the water
  S.sunrise = {
    dur: 6, pre: 3,
    setup() { T.hours(6.12); T.weather('clear'); },
    cam: () => ({ keys: [
      { t: 0, pos: W(D, 30, 27.2, 0.55), look: Wy(D, 40, 140, 7), fov: 38 },
      { t: 6, pos: W(D, 33, 27.2, 0.6), look: Wy(D, 42, 140, 7.3), fov: 38 },
    ], focus: Wy(D, 36, 40, 0.6), dof: { range: 60, bokeh: 0.8 } }),
  };
  S.sunriseB = {
    dur: 6, pre: 3,
    setup() { T.hours(6.12); T.weather('clear'); },
    cam: () => ({ keys: [
      { t: 0, pos: Wy(D, 4, 33, 0.8), look: Wy(D, 95, 72, 4.5), fov: 40 },
      { t: 6, pos: Wy(D, 9, 34, 0.95), look: Wy(D, 100, 72, 4.7), fov: 40 },
    ], focus: Wy(D, 40, 40, 1), dof: { range: 80, bokeh: 0.8 } }),
  };
  // the ghats glowing in the first sun: off the water, craning up the steps to the temple
  S.ghatglow = {
    dur: 5, pre: 3,
    setup() { T.hours(6.45); T.weather('clear'); },
    cam: () => ({ keys: [
      { t: 0, pos: Wy(D, 28, 66, 0.8), look: W(D, 38, 16, 1.5), fov: 36 },
      { t: 5, pos: Wy(D, 35, 55, 6.0), look: W(D, 42, -2, 7), fov: 36 },
    ], focus: W(D, 42, 18, 1), dof: { range: 60, bokeh: 1.0 } }),
  };
  // the evening aarti: from over the water's edge, past the great lamps to the priests
  S.aarti = {
    dur: 4, pre: 4,
    setup() { T.hours(19.0); T.weather('clear'); g.quest.forceAarti = true; },
    cam: () => ({ keys: [
      { t: 0, pos: Wy(D, 33, 31.5, 3.6), look: W(D, 40, 24, 1.9), fov: 32 },
      { t: 4, pos: Wy(D, 37, 31.5, 3.8), look: W(D, 43, 24, 2.0), fov: 32 },
    ], focus: W(D, 41, 24.5, 1.8), dof: { range: 22, bokeh: 1.2 } }),
  };
  // lamps on the dark water, the ghat's fire out of focus beyond
  S.diyas = {
    dur: 4, pre: 3,
    setup() {
      T.hours(19.4); T.weather('clear'); g.quest.forceAarti = true;
      for (let i = 0; i < 46; i++) { const p = T.gp(D, 20 + Math.random() * 44, 33 + Math.random() * 16); g.diyas?.launch(p.x, p.z); }
    },
    cam: () => ({ keys: [
      { t: 0, pos: Wy(D, 38, 46, 0.45), look: W(D, 44, 22, 3), fov: 38 },
      { t: 4, pos: Wy(D, 41, 45, 0.5), look: W(D, 46, 22, 3), fov: 38 },
    ], focus: Wy(D, 40, 41, 0.1), dof: { range: 8, bokeh: 2.0 } }),
  };
  // Prady rowing at dusk, the aarti lit on the ghat behind him
  S.boat = {
    dur: 5, pre: 3, restore: true,
    async setup() {
      await T.jump('Aarti from the water');
      T.hours(18.75); T.weather('clear'); g.quest.forceAarti = true;
      if (!g.input.__mv) { g.input.__mv = g.input.move.bind(g.input); g.input.move = () => (T.row ? { x: 0, y: 0.8 } : g.input.__mv()); }
      T.row = false;
      const b = g.boat; b.yaw = b.prev.yaw = b.yaw + Math.PI;
    },
    go() { T.row = true; },
    cam: () => ({ fn: (t, g, dt) => {
      const b = g.boat; const f = b.forward; const r = { x: f.z, z: -f.x };
      const c = smooth(b.x, 0, b.z, dt, 3);
      return { pos: [c[0] + f.x * 6.5 + r.x * 1.6, 1.05, c[2] + f.z * 6.5 + r.z * 1.6], look: [c[0] - f.x * 0.6, 1.25, c[2] - f.z * 0.6], fov: 38 };
    } }),
  };

  // ------------------------------------------------------------- act two: the dark
  S.pyres = {
    dur: 4.5, pre: 3,
    setup() { T.hours(22.2); T.weather('clear'); },
    cam: () => {
      const Pp = [218, 2.7, 5];
      return { keys: [
        { t: 0, pos: [Pp[0] - 4.2, 3.2, Pp[2] + 4.4], look: [Pp[0], 4.6, Pp[2]], fov: 34 },
        { t: 4.5, pos: [Pp[0] - 3.4, 3.15, Pp[2] + 3.6], look: [Pp[0], 4.8, Pp[2]], fov: 34 },
      ], focus: [Pp[0], 4, Pp[2]], dof: { range: 10, bokeh: 1.6 } };
    },
  };
  S.darkriver = {
    dur: 4, pre: 3,
    setup() { T.hours(21.6); T.weather('clear'); },
    cam: () => ({ keys: [
      { t: 0, pos: Wy(M, 30, 70, 0.55), look: W(M, 45, 20, 3), fov: 40 },
      { t: 4, pos: Wy(M, 33, 58, 0.5), look: W(M, 46, 18, 3), fov: 40 },
    ] }),
  };
  S.storm = {
    dur: 3.5, pre: 4,
    setup() { T.hours(21.2); T.weather('storm', 1); g.weather.boltTimer = 99; g.quest.forceAarti = true; },
    beats: [[0.5, () => T.bolt()]],
    cam: () => ({ keys: [
      { t: 0, pos: Wy(D, 12, 78, 3), look: W(D, 50, 8, 5), fov: 46 },
      { t: 3.5, pos: Wy(D, 15, 76, 3.4), look: W(D, 52, 8, 5.4), fov: 46 },
    ] }),
  };
  // the dark rising out of the river, from low on the water at their backs... then turning to him
  S.rise = {
    dur: 6, pre: 2.5,
    async setup() {
      night(21, 'rain');
      g.testMenu.placeOnGhat(D, 39.2, 1, 0);
      T.inv(); arm(); T.stop();
      await g.asuras.load();
    },
    async go() { const at = T.gp(D, 39.2, 29.8); g.asuras.riseFromRiver({ x: at.x, z: at.z, n: 3, kind: 'shade', spread: 3.5, goal: { x: P().x, z: P().z } }); },
    cam: () => ({ keys: [
      { t: 0, pos: Wy(D, 37.6, 33.2, 0.32), look: W(D, 39.2, 27, 1.0), fov: 32 },
      { t: 6, pos: Wy(D, 38.4, 32.4, 0.42), look: W(D, 39.2, 25.5, 1.5), fov: 32 },
    ], focus: (t) => W(D, 39.2, 29.5, 1), dof: { range: 7, bokeh: 1.5 } }),
  };

  // Prady draws the talwar in the rain, the aarti fires behind him
  S.talwar = {
    dur: 3.6, pre: 3,
    setup() { night(20.9, 'rain'); const p = T.gp(D, 33.6, 27.4); const gh = T.ghat(D); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, Math.atan2(gh.N.x, gh.N.z)); T.inv(); g.combat.setHasSword(true); g.combat.armed = false; T.stop(); },
    beats: [[0.7, () => g.combat.toggleSword()]],
    cam: () => ({ fn: (t, g, dt) => {
      const c = P(); const [fx, fz] = fwd(); const rx = -fz, rz = fx;
      const k = Math.min(1, t / 3.6);
      const d = 2.5 - k * 0.5;
      return { pos: [c.x + fx * d + rx * 0.8, c.y + 0.75 + k * 0.1, c.z + fz * d + rz * 0.8], look: [c.x + rx * 0.1, c.y + 1.35, c.z + rz * 0.1], fov: 36 };
    }, focus: () => { const c = P(); return [c.x, c.y + 1.4, c.z]; }, dof: { range: 6, bokeh: 1.6 } }),
  };
  // down the wet steps at a sprint, toward the lens
  S.charge = {
    dur: 3.2, pre: 2.5,
    setup() { night(21, 'rain'); const p = T.gp(D, 39.2, 12); const gh = T.ghat(D); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, Math.atan2(gh.N.x, gh.N.z)); T.inv(); arm(); T.stop(); },
    go() { const gh = T.ghat(D); T.drive(gh.N.x, gh.N.z, 'sprint'); },
    cam: () => ({ fn: (t, g, dt) => {
      const c = P(); const gh = T.ghat(D); const L = smooth(c.x, c.y, c.z, dt, 6);
      const px = L[0] + gh.T.x * 3.0 + gh.N.x * 0.9, pz = L[2] + gh.T.z * 3.0 + gh.N.z * 0.9;
      return { pos: [px, Math.max(L[1] + 1.0, T.ground(px, pz) + 0.6), pz], look: [L[0] + gh.N.x * 0.6, L[1] + 1.05, L[2] + gh.N.z * 0.6], fov: 38 };
    }, focus: () => { const c = P(); return [c.x, c.y + 1.2, c.z]; }, dof: { range: 9, bokeh: 1.2 } }),
  };
  // the climb: up a haveli front, chhajja by chhajja, at golden hour
  S.climb = {
    dur: 12, pre: 2,
    setup() {
      T.hours(7.1); T.weather('clear');
      T.inv();
      const P0 = T.gp(D, 49, 14.5);
      const hs = g.world.layout.buildings.filter((b) => b.row === 0 && b.kind === 'haveli' && b.floors >= 3).sort((a, b) => Math.hypot(a.x - P0.x, a.z - P0.z) - Math.hypot(b.x - P0.x, b.z - P0.z));
      const b = hs[T.pick ?? 0];
      const n = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
      const fx = b.x + n.x * (b.d / 2), fz = b.z + n.z * (b.d / 2);
      const sx = fx + n.x * 4.5, sz = fz + n.z * 4.5;
      const top = g.physics.castRay({ x: sx, y: b.baseY + 8, z: sz }, { x: 0, y: -1, z: 0 }, 30);
      g.testMenu.place(sx, b.baseY + 8 - top, sz, Math.atan2(-n.x, -n.z));
      T.face = { x: fx, z: fz, n, b };
      T.stop();
    },
    go() { T.free(); T.key('ShiftLeft'); T.key('KeyW'); T.climbI = 0; },
    tick(t) {
      const pl = g.player; const F = T.face;
      T.climbI++;
      if (t > 0.7) T.key('ShiftLeft', false);
      const d = (pl.position.x - F.x) * F.n.x + (pl.position.z - F.z) * F.n.z;
      if (!g.traversal.act && pl.state === 'ground' && d < (t < 1 ? 1.3 : 0.9) && T.climbI % 6 === 0) T.tap('Space');
    },
    cam: () => ({ fn: (t, g, dt) => {
      const F = T.face; const c = P(); const s = { x: -F.n.z, z: F.n.x };
      const y = smooth(0, c.y, 0, dt, 1.6)[1];
      return { pos: [F.x + F.n.x * 7.5 + s.x * 4.0, Math.max(11.4, y - 0.6), F.z + F.n.z * 7.5 + s.z * 4.0], look: [c.x, y + 1.3, c.z], fov: 36 };
    } }),
  };
  // the stand-off in slow motion: a shade lunges, the rain hangs in the air
  S.slowmo = {
    dur: 4, pre: 2,
    async setup() {
      night(21.2, 'storm');
      const p = T.gp(D, 39.2, 26.5); const gh = T.ghat(D); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, Math.atan2(gh.N.x, gh.N.z)); T.inv(); arm(); T.stop();
      await g.asuras.load();
      const q = T.gp(D, 39.2, 29.3);
      const a = g.asuras.spawn('shade', { x: q.x, y: T.ground(q.x, q.z), z: q.z });
      T.foe = a;
    },
    go() { g.slowMo(0.12, 99); g.combat.attack(); },
    beats: [[1.2, () => T.bolt()]],
    cam: () => ({ fn: (t, g, dt) => {
      const c = P(); const a = T.foe; const mx = (c.x + a.pos.x) / 2, mz = (c.z + a.pos.z) / 2;
      const gh = T.ghat(D); const base = Math.atan2(gh.N.x, gh.N.z) + 0.9; const ang = base + 0.12 * t;
      const want = [mx + Math.sin(ang) * 3.6, c.y + 0.75, mz + Math.cos(ang) * 3.6];
      return { pos: clear([mx, c.y + 1.1, mz], want), look: [mx, c.y + 1.2, mz], fov: 38 };
    }, focus: () => { const c = P(); return [c.x, c.y + 1.3, c.z]; }, dof: { range: 6, bokeh: 1.3 } }),
  };

  // ------------------------------------------------------------- act three: the fight
  const fightShot = (opts) => ({
    dur: opts.dur ?? 16, pre: opts.pre ?? 2.5, restore: true,
    async setup() {
      night(opts.hours ?? 20.9, opts.weather ?? 'rain');
      if (opts.weather === 'clear') g.weather.wet = 0;
      if (opts.siddhis) { g.siddhis.grantAll(); g.powers.shakti = 999; }
      await fight(opts.ghat ?? D, opts.u ?? 39.2, opts.waves, opts.which ?? 2, opts.vOff ?? 0);
      if (opts.hp) for (const a of g.asuras.list) a.hp = Math.min(a.hp, a.maxHp * opts.hp);
      bot.on = false; bot.finish = !!opts.finish; bot.powers = [...(opts.powers || [])]; bot.heavyEvery = opts.heavy ?? 0.15;
      T.stop();
    },
    go() { bot.on = true; },
    tick(t, dt) { botStep(dt); if (opts.slowEvery && t % opts.slowEvery < dt && t > 1) g.slowMo(0.3, 0.6); },
    cam: () => (opts.gameCam ? { fn: null, game: true } : { fn: opts.profile ? profile(opts.profile) : orbit(opts.orbit || {}) }),
    game: !!opts.gameCam,
  });
  S.fight1 = fightShot({ waves: [{ n: 3, kind: 'shade' }], profile: { r: 4.6, h: 0.8, side: 1 } });
  S.fight2 = fightShot({ waves: [{ n: 2, kind: 'shade' }, { n: 1, kind: 'brute' }], orbit: { r: 3.4, h: 0.45, w: 0.13, a0: 2.2, lookH: 1.1, fov: 40 }, heavy: 0.3 });
  S.powers = fightShot({ waves: [{ n: 5, kind: 'shade' }], siddhis: true, powers: ['damaru', 'thirdEye', 'trishul', 'damaru'], orbit: { r: 6, h: 2.0, w: 0.08, a0: 1.2, lookH: 0.9, fov: 46, mid: 0.2 } });
  S.finisher = fightShot({ waves: [{ n: 2, kind: 'shade' }], finish: true, heavy: 0.6, profile: { r: 4, h: 0.9, side: 1 } });
  S.killcam = fightShot({ waves: [{ n: 1, kind: 'shade' }], heavy: 0.4, hp: 0.35, gameCam: true, dur: 9 });
  S.vetala = fightShot({ ghat: 'manmandir', u: 20, which: 0, waves: [{ n: 2, kind: 'vetala' }], orbit: { r: 7, h: 1.6, w: 0.07, a0: 0.4, lookH: 1.6, fov: 48, mid: 0.4 } });
  S.boss = fightShot({ ghat: 'panchganga', u: 62, hours: 22.6, weather: 'storm', waves: [{ kind: 'boss', name: 'Andhaka', title: 'the Blind Darkness' }], dur: 18, profile: { r: 12, h: 1.4, lookH: 3.4, fov: 44, side: 1, mix: 0.55, k: 1.2 } });
  S.boss.beats = [[2.5, () => T.bolt()], [7.5, () => T.bolt()], [13, () => T.bolt()]];
  // the hero: Prady in the rain, the talwar drawn, lightning over the river
  S.hero = {
    dur: 6, pre: 3,
    setup() { night(21.3, 'storm'); const p = T.gp(D, 39.2, 27); const gh = T.ghat(D); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, Math.atan2(gh.N.x, gh.N.z)); T.inv(); g.combat.setHasSword(true); g.combat.armed = true; T.stop(); },
    beats: [[1.4, () => T.bolt()], [4.2, () => T.bolt()]],
    cam: () => ({ fn: (t, g, dt) => {
      const c = P(); const [fx, fz] = fwd(); const rx = -fz, rz = fx;
      const k = t / 6; const d = 3.6 - k * 1.2;
      return { pos: [c.x + fx * d - rx * 0.6, c.y + 0.35 + k * 0.15, c.z + fz * d - rz * 0.6], look: [c.x, c.y + 1.45, c.z], fov: 34 };
    }, focus: () => { const c = P(); return [c.x, c.y + 1.5, c.z]; }, dof: { range: 8, bokeh: 1.4 } }),
  };
  // the kill in slow motion: a heavy cut, the shade breaking into light, the lens going round in real time
  S.slowkill = {
    dur: 4.6, pre: 2,
    async setup() {
      night(21.2, 'storm');
      const p = T.gp(D, 39.2, 26.4); const gh = T.ghat(D); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, Math.atan2(gh.N.x, gh.N.z)); T.inv(); arm(); T.stop();
      await g.asuras.load();
      const q = T.gp(D, 39.4, 28.6);
      T.foe = g.asuras.spawn('shade', { x: q.x, y: T.ground(q.x, q.z), z: q.z });
    },
    go() { g.combat.heavy(); },
    beats: [[0.32, () => g.slowMo(0.16, 3.2)], [0.62, () => { const a = T.foe; if (a?.alive) a.hit({ k: 1, dir: { x: a.pos.x - P().x, z: a.pos.z - P().z }, at: a.pos.clone(), sword: true, power: true, dmgOverride: 999 }); }], [1.1, () => T.bolt()]],
    cam: () => ({ fn: (t, g, dt) => {
      const c = P(); const a = T.foe; const mx = (c.x + a.pos.x) / 2, mz = (c.z + a.pos.z) / 2;
      const gh = T.ghat(D); const ang = Math.atan2(gh.T.x, gh.T.z) - 0.35 + 0.22 * t;
      const want = [mx + Math.sin(ang) * 3.0, c.y + 0.55 + t * 0.05, mz + Math.cos(ang) * 3.0];
      return { pos: clear([mx, c.y + 1.1, mz], want), look: [mx, c.y + 1.15, mz], fov: 36 };
    }, focus: () => { const c = P(); return [c.x, c.y + 1.2, c.z]; }, dof: { range: 6, bokeh: 1.4 } }),
  };
  // the fight from the steps, the river glittering behind them
  S.fight3 = fightShot({ waves: [{ n: 3, kind: 'shade' }], heavy: 0.35, profile: { r: 3.8, h: 1.1, lookH: 1.0, side: -1, fov: 40 } });
  // Andhaka rising out of the river, over Prady's shoulder, lightning behind him
  S.bossrise = {
    dur: 7.5, pre: 2.5,
    async setup() {
      night(22.6, 'storm');
      const PG = 'panchganga';
      g.testMenu.placeOnGhat(PG, 62, 2, 0.6); T.inv(); arm(); T.stop();
      await g.asuras.load();
      T.riseAt = T.gp(PG, 62, 27.5);
    },
    async go() { const r = T.riseAt; g.asuras.riseFromRiver({ x: r.x, z: r.z, n: 1, kind: 'boss', goal: { x: P().x, z: P().z }, opts: { name: 'Andhaka', scale: 1 } }).then(([b]) => { T.boss = b; b.hold?.(true); }); },
    beats: [[1.6, () => T.bolt()], [4.6, () => T.bolt()], [6.4, () => T.bolt()]],
    cam: () => {
      let look = null;
      return { fn: (t, g, dt) => {
        const c = P(); const gh = T.ghat('panchganga');
        const b = T.boss?.alive ? T.boss.pos : { x: T.riseAt.x, y: 0, z: T.riseAt.z };
        const tgt = [b.x, Math.max(1.2, (b.y ?? 0) + 2.6), b.z];
        const k = 1 - Math.exp(-2.5 * Math.min(dt, 0.1));
        look = look ? look.map((v, i) => v + (tgt[i] - v) * k) : tgt;
        const back = 2.4 - Math.min(1, t / 7) * 0.5;
        return { pos: [c.x - gh.N.x * back + gh.T.x * 0.85, c.y + 1.45, c.z - gh.N.z * back + gh.T.z * 0.85], look, fov: 42 };
      }, focus: () => { const b = T.boss?.pos; return b ? [b.x, (b.y ?? 0) + 2.5, b.z] : [T.riseAt.x, 2, T.riseAt.z]; }, dof: { range: 14, bokeh: 1.2 } };
    },
  };
  // the fight with Andhaka from the steps: the two of them against the sky over the river
  S.bossfight = fightShot({ ghat: 'panchganga', u: 62, hours: 22.6, weather: 'storm', waves: [{ kind: 'boss', name: 'Andhaka', title: 'the Blind Darkness' }], dur: 16, heavy: 0.3, profile: { r: 8.5, h: 1.6, lookH: 2.6, fov: 42, side: -1, mix: 0.5, k: 1.2 } });
  S.bossfight.beats = [[3, () => T.bolt()], [8, () => T.bolt()], [12.5, () => T.bolt()]];
  // the Damaru: four shades close in, three beats of the drum, the shockwave throws them back (slow motion)
  S.damaru = {
    dur: 4.2, pre: 2,
    async setup() {
      night(21.2, 'rain');
      const p = T.gp(D, 39.2, 26.6); const gh = T.ghat(D); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, Math.atan2(gh.N.x, gh.N.z)); T.inv(); arm(); T.stop();
      g.siddhis.grantAll(); g.powers.shakti = 999;
      await g.asuras.load();
      T.ring = [];
      for (const [du, dv] of [[2.4, 1.2], [-2.4, 1.0], [1.2, 2.6], [-1.0, -2.2]]) { const q = T.gp(D, 39.2 + du, 26.6 + dv); T.ring.push(g.asuras.spawn('shade', { x: q.x, y: T.ground(q.x, q.z), z: q.z })); }
    },
    go() { g.powers.shakti = 999; },
    beats: [[0.35, () => g.powers.press('damaru')], [0.9, () => g.slowMo(0.22, 1.6)], [2.6, () => { g.powers.shakti = 999; g.powers.press('damaru'); }]],
    cam: () => ({ fn: (t, g, dt) => {
      const c = P(); const gh = T.ghat(D); const ang = Math.atan2(-gh.N.x, -gh.N.z) + 0.5 + 0.1 * t;
      const want = [c.x + Math.sin(ang) * 5.2, c.y + 1.3, c.z + Math.cos(ang) * 5.2];
      return { pos: clear([c.x, c.y + 1.1, c.z], want), look: [c.x, c.y + 0.9, c.z], fov: 44 };
    } }),
  };
  // ===================================================================== gameplay (the game as it plays)
  // a chase camera behind him, as a player's follow camera would hold it (a little tighter): it trails
  // his movement, eases round when he turns, keeps out of walls and above the water
  const angD = (a, b, k, dt) => { let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * (1 - Math.exp(-k * dt)); };
  const chase = ({ dist = 3.7, h = 1.75, lookH = 1.2, ahead = 1.6, fov = 50, k = 2.6, side = 0.35, of = null } = {}) => {
    let cy = null, cp = null, lk = null;
    return (t, g, dt) => {
      const o = of ? of(g) : null;
      const c = o ? o.pos : P();
      const v = o ? o.vel : g.player.velocity;
      const sp = Math.hypot(v.x, v.z);
      const yaw = o ? o.yaw : sp > 0.8 ? Math.atan2(v.x, v.z) : g.player.yaw;
      cy = cy === null ? yaw : angD(cy, yaw, k, Math.min(dt, 0.1));
      const fx = Math.sin(cy), fz = Math.cos(cy), rx = -fz, rz = fx;
      const want = [c.x - fx * dist + rx * side, c.y + h, c.z - fz * dist + rz * side];
      const a = 1 - Math.exp(-k * 2.2 * Math.min(dt, 0.1));
      cp = cp ? cp.map((x, i) => x + (want[i] - x) * a) : want;
      const lw = [c.x + fx * ahead, c.y + lookH, c.z + fz * ahead];
      lk = lk ? lk.map((x, i) => x + (lw[i] - x) * Math.min(1, a * 1.6)) : lw;
      const pos = clear([c.x, c.y + 1.2, c.z], cp.slice());
      pos[1] = Math.max(pos[1], g.water.heightAt(pos[0], pos[2]) + 0.45);
      return { pos, look: lk, fov };
    };
  };
  window.chase = chase;
  // run a route along the navmesh (from where he stands to `to`, through the lanes, round things)
  T.route = (to, gait = 'run') => {
    const c = P();
    const r = g.nav?.path?.({ x: c.x, y: c.y, z: c.z }, to);
    T.way = (r?.path || [to]).map((q) => ({ x: q.x, z: q.z }));
    T.wayGait = gait;
  };
  const routeStep = () => {
    if (!T.way?.length) return;
    const c = P();
    while (T.way.length && Math.hypot(T.way[0].x - c.x, T.way[0].z - c.z) < 0.9) T.way.shift();
    if (!T.way.length) return T.stop();
    T.drive(T.way[0].x - c.x, T.way[0].z - c.z, T.wayGait);
  };
  const N = () => T.ghat(D).N;
  const TT = () => T.ghat(D).T;
  const placeAt = (id, u, v, yaw) => { const p = T.gp(id, u, v); g.testMenu.place(p.x, T.ground(p.x, p.z), p.z, yaw); };

  // dawn: a sprint along the top of Dashashwamedh, the pilgrims and the river below
  S.g_dawnrun = {
    dur: 6, pre: 2, restore: true,
    setup() { T.hours(6.75); T.weather('clear'); placeAt(D, 4, 1.4, Math.atan2(TT().x, TT().z)); g.combat.setHasSword(true); g.combat.armed = false; T.stop(); },
    go() { T.drive(TT().x, TT().z, 'sprint'); },
    cam: () => ({ fn: chase({ dist: 4.1, h: 2.25, lookH: 1.1, side: 0.6, fov: 52 }) }),
  };
  // down the steps at a run and off the last one into the Ganga, then under
  S.g_dive = {
    dur: 8, pre: 2, restore: true,
    setup() { T.hours(8.1); T.weather('clear'); placeAt(D, 44.8, 12.5, Math.atan2(N().x, N().z)); g.combat.setHasSword(true); g.combat.armed = false; T.stop(); T.dove = false; },
    go() { T.drive(N().x, N().z, 'sprint'); },
    tick(t) {
      const pl = g.player;
      if (!T.dove && pl.state === 'ground' && pl.feetY < 1.4) { if (g.actions.tryDive()) T.dove = true; }
      if (T.dove && (pl.state === 'swim' || pl.state === 'dive')) T.drive(N().x * 0.6 + TT().x * 0.8, N().z * 0.6 + TT().z * 0.8, 'run', { down: t > 5.2 && t < 7.0 });
    },
    cam: () => ({ fn: chase({ dist: 3.6, h: 1.55, side: 0.5, fov: 52, k: 2.2 }) }),
  };
  // golden hour: front crawl along the ghats, the lens low beside him
  S.g_swim = {
    dur: 6, pre: 2, restore: true,
    setup() { T.hours(17.5); T.weather('clear'); const p = T.gp(D, 20, 37); g.testMenu.place(p.x, 0.2, p.z, Math.atan2(TT().x, TT().z)); g.combat.setHasSword(false); T.stop(); },
    go() { T.drive(TT().x, TT().z, 'run'); },
    cam: () => ({ fn: (t, g, dt) => { const c = P(); const L = smooth(c.x, 0, c.z, dt, 3); const nx = N().x, nz = N().z, tx = TT().x, tz = TT().z;
      return { pos: [L[0] + nx * 2.3 - tx * 1.2, 0.55, L[2] + nz * 2.3 - tz * 1.2], look: [L[0] + tx * 0.8, 0.25, L[2] + tz * 0.8], fov: 44 }; } }),
  };
  // the river's blessing: running on the water at dusk
  S.g_waterrun = {
    dur: 6, pre: 2, restore: true,
    setup() { T.hours(18.35); T.weather('clear'); placeAt(D, 30, 28.6, Math.atan2(N().x, N().z)); g.player.blessing = true; g.combat.setHasSword(false); T.stop(); },
    go() { T.drive(N().x * 0.5 + TT().x * 0.85, N().z * 0.5 + TT().z * 0.85, 'sprint'); },
    cam: () => ({ fn: chase({ dist: 4.2, h: 1.25, lookH: 0.9, side: 1.0, fov: 50, k: 2.4 }) }),
  };
  // rowing at dusk: the oars, the wake, the lit ghat alongside
  S.g_row = {
    dur: 6, pre: 2.5, restore: true,
    async setup() {
      await T.jump('Aarti from the water');
      T.hours(18.2); T.weather('clear'); g.quest.forceAarti = true;
      if (!g.input.__mv) { g.input.__mv = g.input.move.bind(g.input); g.input.move = () => (T.row ? { x: T.rowTurn || 0, y: 0.9 } : g.input.__mv()); }
      T.row = false; T.rowTurn = 0;
      const b = g.boat; b.yaw = b.prev.yaw = Math.atan2(TT().x, TT().z) + 0.15;
    },
    go() { T.row = true; },
    cam: () => ({ fn: chase({ dist: 6.5, h: 2.2, lookH: 0.9, side: -1.2, fov: 50, k: 2.0, of: (g) => { const b = g.boat; return { pos: { x: b.x, y: 0, z: b.z }, vel: { x: b.vx || 0, z: b.vz || 0 }, yaw: b.yaw }; } }) }),
  };
  // Nauka Daud: the boat race, the rivals alongside
  S.g_race = {
    dur: 7, pre: 5.5, restore: true,
    async setup() {
      T.hours(9.2); T.weather('clear');
      for (const m of [g.race?.lineMesh, g.race?.bannerMesh, g.race?.gateMesh]) if (m) m.visible = true;
      g.race.begin();
      if (!g.input.__mv) { g.input.__mv = g.input.move.bind(g.input); g.input.move = () => (T.row ? { x: T.rowTurn || 0, y: 0.9 } : g.input.__mv()); }
      T.row = false;
    },
    go() { T.row = true; },
    tick() { const b = g.boat; const gate = (g.race?.gates || []).filter((q) => q.x > b.x + 4).sort((a, c) => a.x - c.x)[0]; if (gate) { const want = Math.atan2(gate.x - b.x, gate.z - b.z); let d = ((want - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI; T.rowTurn = Math.max(-1, Math.min(1, -d * 2)); } },
    cam: () => ({ fn: chase({ dist: 7, h: 2.6, lookH: 0.8, side: 1.4, fov: 52, k: 2.0, of: (g) => { const b = g.boat; return { pos: { x: b.x, y: 0, z: b.z }, vel: { x: b.vx || 0, z: b.vz || 0 }, yaw: b.yaw }; } }) }),
  };
  // the rain: a run along the wet landing at dusk, the lamps in the puddles, his prints behind him
  S.g_rainrun = {
    dur: 6, pre: 3, restore: true,
    setup() { night(21.2, 'rain'); placeAt(D, 12, 13, Math.atan2(TT().x, TT().z)); g.combat.setHasSword(true); g.combat.armed = false; T.stop(); },
    go() { T.drive(TT().x, TT().z, 'sprint'); },
    cam: () => ({ fn: chase({ dist: 3.8, h: 1.3, lookH: 1.0, side: 0.7, fov: 50 }) }),
  };
  // the lanes: through the galis behind the ghats (the navmesh finds the way), cows, dogs, stalls
  S.g_lanes = {
    dur: 7, pre: 2.5, restore: true,
    setup() { T.hours(10.5); T.weather('clear'); g.testMenu.place(42, 10.6, -62, 0); g.combat.setHasSword(true); g.combat.armed = false; T.stop(); },
    go() { T.route({ x: 10, y: 10.6, z: -66 }, 'run'); },
    tick() { routeStep(); },
    cam: () => ({ fn: chase({ dist: 3.4, h: 1.7, side: 0.4, fov: 54, k: 3.0 }) }),
  };
  // fights as they play, from just behind him (the game's lock-on view, brought in closer)
  const fightChase = (o) => ({ ...fightShot(o), cam: () => ({ fn: chase({ dist: 4.4, h: 2.1, lookH: 1.0, ahead: 2.0, side: 0.8, fov: 54, k: 2.4, ...(o.chase || {}), of: (g) => { const c = P(); const a = nearest(); const yaw = a ? Math.atan2(a.pos.x - c.x, a.pos.z - c.z) : g.player.yaw; return { pos: c, vel: { x: 0, z: 0 }, yaw }; } }) }) });
  S.g_fightday = fightChase({ hours: 16.8, weather: 'clear', waves: [{ n: 3, kind: 'shade' }], heavy: 0.3 });
  S.g_fightrain = fightChase({ waves: [{ n: 2, kind: 'shade' }, { n: 1, kind: 'brute' }], heavy: 0.3 });
  S.g_fightpowers = fightChase({ waves: [{ n: 5, kind: 'shade' }], siddhis: true, powers: ['damaru', 'trishul', 'thirdEye'], heavy: 0.25, chase: { dist: 5.2, h: 2.6 } });
})();
// between shots: nothing of the last one carries over
window.RESET = () => {
  const g = window.__game;
  T.row = false;
  if (window.BOT) BOT.on = false;
  for (const k of ['KeyW', 'KeyQ', 'ShiftLeft', 'Space']) T.key(k, false);
  g.timeScale = 1; g.slowT = 0;
  T.free(); T.camOff();
  g.asuras.clear?.();
  g.health.invincible = true;
};
