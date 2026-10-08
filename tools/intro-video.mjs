// Records the pre-game gameplay montage (public/assets/video/prady-intro.mp4) from the REAL game:
// every shot is scripted gameplay (Prady driven like a player, the camera on a path), rendered
// frame by frame on a virtual clock at 30 fps, so the result is perfectly smooth no matter how
// slowly the browser renders. The game's own sound calls are logged during capture and rebuilt
// into the soundtrack with ffmpeg, so splashes, oars and flames land on their frames.
//
//   npm run dev                      (in another terminal)
//   node tools/intro-video.mjs --preview      three stills per shot -> tools/out/intro-preview/
//   node tools/intro-video.mjs [--only s3]    full render (a few minutes)
//   node tools/intro-video.mjs --edit-only    re-edit / re-encode from the captured frames
//
// Needs Chrome and ffmpeg (brew install ffmpeg).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const { chromium } = await import('playwright-core');
const args = process.argv.slice(2);
const PREVIEW = args.includes('--preview');
const EDIT_ONLY = args.includes('--edit-only'); // re-cut from the frames already captured
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const FPS = 30;
const W = 1920;
const H = 1080;
const XFADE = 0.5;
const OUT_DIR = 'tools/out';
const WORK = path.join(OUT_DIR, 'intro-work');
const FINAL = 'public/assets/video/prady-intro.mp4';
const A = 'public/assets/audio';
const exe = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ------------------------------------------------------------------------------------------
// Shot list (durations in seconds). The scripts themselves live in the page (installShots).
const SHOTS = [
  { id: 's1', dur: 4.5, caption: null, title: true },
  { id: 's2', dur: 4.5, caption: ['A LIVING CITY', 'Pilgrims, boatmen and bathers, each with a day of their own'] },
  // cut from the montage (cut: true): the greeting reads poorly on video; kept for reference
  { id: 's3', dur: 4.2, cut: true, caption: ['GREET THE PEOPLE OF KASHI', 'They answer, with a wave or a nod'] },
  { id: 's4', dur: 4.0, caption: ['RUN THE GHATS', 'Every flight, every landing, down to the river'] },
  { id: 's5', dur: 4.5, caption: ['SWIM THE GANGA', 'Currents, depth and light'] },
  { id: 's6', dur: 4.2, caption: ['ROW AT DUSK', 'Your own boat, the whole river'] },
  { id: 's7', dur: 4.5, caption: ['REKINDLE THE FIVE FLAMES', 'The sacred fires of Kashi have gone dark'] },
  { id: 's8', dur: 4.5, caption: ['NIGHT ON THE RIVER', 'Swim among the floating diyas'] },
  { id: 's9', dur: 4.5, caption: ['THE EVENING AARTI', 'Seven priests, a thousand lamps'] },
  { id: 's10', dur: 4.8, caption: null, end: true },
];

// ------------------------------------------------------------------------------------------
// Everything below runs inside the game page.
function installShots() {
  const g = window.__game;
  const L = g.world.layout;
  const THREE = window.__THREE;
  const ghat = (id) => L.ghats.find((x) => x.id === id);
  const P = (gh, u, v) => ({ x: gh.S.x + gh.T.x * u + gh.N.x * v, z: gh.S.z + gh.T.z * u + gh.N.z * v });
  const V3 = (p, y) => new THREE.Vector3(p.x, y, p.z);
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pl = g.player;
  const LAND1 = { v0: 10.3, v1: 16.3, h: 6.3 };
  const LAND2 = { v0: 21.7, v1: 26.2, h: 2.7 };
  const PROFILE_LEN = 34.3;

  // ----- driving Prady like a player
  const drive = (dx, dz, mode = 'run') => {
    const l = Math.hypot(dx, dz) || 1;
    pl.walkMode = mode === 'walk';
    pl.readInput = function (input, cam) {
      this.camYaw = cam.yaw;
      this.camPitch = cam.pitch;
      const c = this.cmd;
      c.mag = mode === 'stop' ? 0 : 1;
      c.mv = { x: 0, y: c.mag };
      c.wish.set(dx / l, 0, dz / l);
      c.sprint = mode === 'sprint';
      c.jumpHeld = c.up = c.down = false;
    };
  };
  const stop = () => drive(0, 1, 'stop');
  const face = (dx, dz) => {
    pl.yaw = Math.atan2(dx, dz);
    pl.prevYaw = pl.yaw;
  };
  const place = (p, y) => {
    if (pl.state === 'boat') g.leaveBoat();
    pl.teleport(p.x, y, p.z);
    pl.velocity.set(0, 0, 0);
  };
  const rowing = (thrust, turn) => {
    g.boat.readInput = function () {
      this.input.thrust = thrust;
      this.input.turn = turn;
    };
  };
  // camera: either the game's own follow rig (yaw/pitch/distance) or an explicit pose
  const follow = (yaw, pitch, dist) => {
    window.__camMode = null;
    g.camRig.yaw = yaw;
    g.camRig.pitch = pitch;
    g.camRig.targetDistance = dist;
  };
  const shoot = (pos, look) => {
    window.__camMode = { pos, look };
  };
  const reset = (hours) => {
    g.sky.setHours(hours);
    g.sky.frozen = true;
    g.timeTween = null;
    stop();
    rowing(0, 0);
    window.__camMode = null;
    g.camRig.first = true;
  };
  const feetY = () => pl.position.y - 0.85;

  const D = ghat('dashashwamedh');
  const K = ghat('kedar');
  const SC = ghat('scindia');
  const AS = ghat('assi');
  const T = (gh) => Math.atan2(gh.T.x, gh.T.z);
  const N = (gh) => Math.atan2(gh.N.x, gh.N.z);

  const shots = {
    // Dawn aerial: the river at sunrise drifting in toward Dashashwamedh
    s1: {
      warm: 2,
      setup() {
        reset(6.4);
        place(P(D, 50, 24), LAND2.h + 0.1);
      },
      frame(t, k) {
        const e = ease(k);
        const a = P(D, lerp(-40, 18, e), lerp(170, 62, e));
        const b = P(D, lerp(40, 52, e), lerp(14, 8, e));
        shoot(V3(a, lerp(46, 15, e)), V3(b, lerp(14, 9, e)));
      },
    },
    // Morning: walking the first landing past the takhts and their people
    s2: {
      warm: 2.5,
      setup() {
        reset(7.5);
        place(P(D, 62, LAND1.v0 + 0.75), LAND1.h + 0.1);
        drive(-D.T.x, -D.T.z, 'walk');
        face(-D.T.x, -D.T.z);
      },
      frame(t) {
        follow(T(D) + Math.PI + 0.75 - t * 0.05, -0.04, 3.6);
      },
    },
    // Greeting a group: Prady waves, they answer
    s3: {
      warm: 2.5,
      setup() {
        reset(7.8);
        const grp = g.crowd.groups
          .map((gr) => ({ gr, d: Math.hypot(gr.cx - P(D, 30, 0).x, gr.cz - P(D, 30, 0).z) }))
          .sort((a, b) => a.d - b.d)[0].gr;
        this.grp = grp;
        const y = grp.members[0].y;
        const p = { x: grp.cx - D.T.x * 2.4 - D.N.x * 0.8, z: grp.cz - D.T.z * 2.4 - D.N.z * 0.8 };
        place(p, y + 0.1);
        face(grp.cx - p.x, grp.cz - p.z);
        stop();
        this.p = p;
        this.done = false;
      },
      frame(t) {
        const grp = this.grp;
        const yaw = Math.atan2(grp.cx - this.p.x, grp.cz - this.p.z);
        follow(yaw - 0.55 + t * 0.03, -0.06, 3.9);
        if (t > 0.4 && !this.done) {
          this.done = true;
          g.greet();
        }
      },
    },
    // Running down the red-and-white steps of Kedar Ghat
    s4: {
      warm: 0.6,
      setup() {
        reset(8.6);
        place(P(K, 30, 0.8), 10.6);
        face(K.N.x, K.N.z);
        drive(K.N.x, K.N.z, 'run');
      },
      frame() {
        const p = pl.renderPosition;
        const cam = { x: p.x + K.N.x * 4.6 + K.T.x * 1.8, z: p.z + K.N.z * 4.6 + K.T.z * 1.8 };
        shoot(new THREE.Vector3(cam.x, g.character.position.y + 0.5, cam.z), new THREE.Vector3(p.x, g.character.position.y + 1.0, p.z));
      },
    },
    // Running into the river at Scindia, the sunken temple behind
    s5: {
      warm: 0.3,
      setup() {
        reset(10.2);
        place(P(SC, 34, 27.6), 1.6);
        face(SC.N.x, SC.N.z);
        drive(SC.N.x, SC.N.z, 'run');
      },
      frame(t) {
        const p = pl.renderPosition;
        if (t > 1.6) drive(SC.N.x - SC.T.x * 0.55, SC.N.z - SC.T.z * 0.55, 'run');
        const c = g.character.position;
        // ease from a low running shot to a higher one looking down into the clear water
        const sw = Math.min(1, Math.max(0, (t - 1.2) / 1.2));
        const sm = sw * sw * (3 - 2 * sw);
        const side = { x: c.x + SC.T.x * lerp(3.4, 2.3, sm) + SC.N.x * lerp(1.4, 1.6, sm), z: c.z + SC.T.z * lerp(3.4, 2.3, sm) + SC.N.z * lerp(1.4, 1.6, sm) };
        const camY = lerp(Math.max(0.5, c.y + 0.75), 2.1, sm);
        shoot(new THREE.Vector3(side.x, camY, side.z), new THREE.Vector3(c.x - SC.T.x * lerp(1.2, 0.3, sm), lerp(Math.max(0.15, c.y + 0.45), -0.15, sm), c.z - SC.T.z * lerp(1.2, 0.3, sm)));
      },
    },
    // Rowing at golden hour along the ghats
    s6: {
      warm: 2.2,
      setup() {
        reset(17.35);
        const b = g.boat;
        const start = P(D, 30, PROFILE_LEN + 6);
        b.x = start.x;
        b.z = start.z;
        b.vx = b.vz = 0;
        b.yaw = T(D);
        b.yawRate = 0;
        if (pl.state !== 'boat') g.boardBoat();
        rowing(1, 0.04);
      },
      frame(t) {
        const b = g.boat.object.position;
        const cam = { x: b.x + D.N.x * 7.5 - D.T.x * 3 + D.T.x * t * 0.8, z: b.z + D.N.z * 7.5 - D.T.z * 3 + D.T.z * t * 0.8 };
        shoot(new THREE.Vector3(cam.x, 1.5, cam.z), new THREE.Vector3(b.x - D.N.x * 3 + D.T.x * 1.5, 2.2, b.z - D.N.z * 3 + D.T.z * 1.5));
      },
    },
    // Night at Assi: the flame pillar comes back to life
    s7: {
      warm: 2,
      setup() {
        reset(19.9);
        const f = g.quest.flames.find((x) => x.id === 'assi');
        this.f = f;
        const p = { x: f.pos.x + AS.N.x * 1.7 - AS.T.x * 0.6, z: f.pos.z + AS.N.z * 1.7 - AS.T.z * 0.6 };
        place(p, LAND1.h + 0.1);
        face(f.pos.x - p.x, f.pos.z - p.z);
        stop();
        this.lit = false;
      },
      frame(t) {
        const f = this.f;
        const cam = { x: f.pos.x + AS.N.x * 4.0 + AS.T.x * 2.2, z: f.pos.z + AS.N.z * 4.0 + AS.T.z * 2.2 };
        const k = t / 4.5;
        shoot(new THREE.Vector3(cam.x - AS.T.x * k * 1.0, f.pos.y + 0.75 + k * 0.35, cam.z - AS.T.z * k * 1.0), new THREE.Vector3(f.pos.x - AS.N.x * 0.2, f.pos.y + 2.05, f.pos.z - AS.N.z * 0.2));
        if (t > 1.0 && !this.lit) {
          this.lit = true;
          g.quest.lightFlame('assi');
        }
      },
    },
    // Night swim among the diyas off Dashashwamedh
    s8: {
      warm: 3,
      setup() {
        reset(20.6);
        g.quest.lightFlame('dashashwamedh', true);
        g.diyas.items.length = 0;
        for (let i = 0; i < 95; i++) {
          const p = P(D, 6 + Math.random() * 72, PROFILE_LEN + 1 + Math.random() * 30);
          g.diyas.launch(p.x, p.z);
          g.diyas.items[g.diyas.items.length - 1].age = 20 + Math.random() * 60;
        }
        for (let i = 0; i < 30; i++) {
          const q = P(D, 16 + Math.random() * 18, PROFILE_LEN + 4.5 + Math.random() * 6);
          g.diyas.launch(q.x, q.z);
          g.diyas.items[g.diyas.items.length - 1].age = 25;
        }
        place(P(D, 18, PROFILE_LEN + 7.2), -0.6);
        face(D.T.x, D.T.z);
        drive(D.T.x, D.T.z, 'walk');
      },
      frame() {
        const p = g.character.position;
        // silhouette against the moon's glade on the water, diyas all around
        const md = g.sky.moonDir;
        const ml = Math.hypot(md.x, md.z) || 1;
        const mx = md.x / ml;
        const mz = md.z / ml;
        const cam = { x: p.x - mx * 2.6 - D.T.x * 0.35, z: p.z - mz * 2.6 - D.T.z * 0.35 };
        shoot(new THREE.Vector3(cam.x, 1.35, cam.z), new THREE.Vector3(p.x + mx * 3.2, 0.05, p.z + mz * 3.2));
      },
    },
    // The aarti seen from the boat
    s9: {
      warm: 3,
      setup() {
        reset(19.7);
        const b = g.boat;
        const start = P(D, D.width * 0.5 - 14, PROFILE_LEN + 8);
        if (pl.state === 'boat') g.leaveBoat();
        b.x = start.x;
        b.z = start.z;
        b.vx = b.vz = 0;
        b.yaw = T(D);
        b.yawRate = 0;
        g.boardBoat();
        rowing(0.45, 0);
      },
      frame(t) {
        const b = g.boat.object.position;
        const cam = { x: b.x + D.N.x * 5.5 - D.T.x * 4.5, z: b.z + D.N.z * 5.5 - D.T.z * 4.5 };
        const look = P(D, D.width * 0.5, 23);
        shoot(new THREE.Vector3(cam.x, 2.1, cam.z), new THREE.Vector3(look.x, 3.6, look.z));
      },
    },
    // Finale: the whole river front alight
    s10: {
      warm: 3,
      setup() {
        reset(21.3);
        for (const f of g.quest.flames) g.quest.lightFlame(f.id, true);
        if (pl.state === 'boat') g.leaveBoat();
        place(P(D, 46, LAND1.v0 + 2), LAND1.h + 0.1);
        stop();
      },
      frame(t, k) {
        const e = ease(k);
        const a = P(D, lerp(48, 8, e), lerp(48, 120, e));
        const b = P(D, lerp(44, 40, e), lerp(14, 6, e));
        shoot(V3(a, lerp(5, 34, e)), V3(b, lerp(6, 9, e)));
      },
    },
  };
  window.__shots = shots;
}

// Virtual clock + frame driver (in page)
function installDriver() {
  const g = window.__game;
  // no mission givers or task markers in the film
  if (g.missions) {
    for (const actor of g.missions.givers.values()) g.crowd?.removeActor(actor);
    g.missions.givers.clear();
    g.missions.update = () => {};
    g.missions.markers.mesh.visible = false;
  }
  let vt = performance.now() + 1000;
  performance.now = () => vt;
  // every rAF user (the game loop, UI effects) gets its callback on our clock
  let queue = [];
  window.requestAnimationFrame = (f) => {
    queue.push(f);
    return queue.length;
  };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => {
    vt += ms;
    const run = queue;
    queue = [];
    for (const f of run) f(vt);
  };
  // explicit camera poses override the follow rig after it runs
  const orig = g.camRig.update.bind(g.camRig);
  g.camRig.update = (dt, input, focus, opts) => {
    orig(dt, input, focus, opts);
    const m = window.__camMode;
    if (m) {
      g.camera.position.copy(m.pos);
      g.camera.lookAt(m.look);
    }
  };
  // log the game's own sound calls (the montage soundtrack is rebuilt from them)
  window.__sfx = [];
  window.__clipT = 0;
  const play = g.audio.play.bind(g.audio);
  g.audio.play = (name, opts = {}) => {
    const at = opts.at;
    let vol = opts.volume ?? 1;
    if (at) {
      const d = g.camera.position.distanceTo(at);
      vol *= Math.min(1, (opts.ref ?? 8) / Math.max(d, 1));
    }
    window.__sfx.push({ t: window.__clipT + (opts.delay || 0), name, vol, rate: opts.rate || 1 });
    return null;
  };
  void play;
  for (const bus of ['music', 'sfx', 'voice', 'ambience']) g.audio.setVolume(bus, 0);
}

// ------------------------------------------------------------------------------------------
// a partial render (--only) keeps the other shots' logged sounds
let events = ONLY && fs.existsSync(path.join(WORK, 'events.json')) ? JSON.parse(fs.readFileSync(path.join(WORK, 'events.json'), 'utf8')) : {};
if (!EDIT_ONLY) {
const b = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
await page.evaluate(async () => {
  window.__THREE = await import('/node_modules/three/build/three.module.js');
  const g = window.__game;
  g.setSetting('quality', 'ultra');
  g.settings.adaptiveResolution = false;
  g.rs.adaptive = false;
  g.begin(null);
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = window.__game;
  g.camRig.skipCinematic();
  g.ui.setCinematic(false);
  document.getElementById('ui').style.display = 'none';
});
// people need their bodies before we roll
await page.waitForFunction(() => window.__game.crowd && [...window.__game.crowd.avatars.values()].every((a) => a.ready), null, { timeout: 180000 });
await page.waitForTimeout(500);
await page.evaluate(installDriver);
await page.waitForTimeout(300);
await page.evaluate(installShots);

// motion graphics overlay (driven per frame from the virtual clock)
await page.addStyleTag({
  content: `
  #mg { position: fixed; inset: 0; pointer-events: none; z-index: 50; font-family: 'Marcellus', serif; color: #fff3da; }
  #mg .vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(8,4,2,0.55) 100%); }
  #mg .tag { position: absolute; top: 44px; right: 56px; font: 600 13px 'Cinzel', serif; letter-spacing: 0.32em; color: rgba(255,236,200,0.78); display: flex; align-items: center; gap: 12px; }
  #mg .tag i { width: 7px; height: 7px; border-radius: 50%; background: #ff9b3d; box-shadow: 0 0 10px #ff9b3d; }
  #mg .cap { position: absolute; left: 88px; bottom: 96px; }
  #mg .cap .rule { height: 2px; background: linear-gradient(90deg, #f3b45a, rgba(243,180,90,0)); margin-bottom: 18px; }
  #mg .cap .t { font: 600 34px 'Cinzel', serif; letter-spacing: 0.26em; text-shadow: 0 2px 18px rgba(0,0,0,0.65); }
  #mg .cap .s { font-size: 21px; letter-spacing: 0.06em; margin-top: 10px; color: rgba(255,236,206,0.88); text-shadow: 0 2px 12px rgba(0,0,0,0.7); }
  #mg .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  #mg .title .deva { font: 400 30px 'Tiro Devanagari Hindi', serif; color: #f3b45a; letter-spacing: 0.12em; margin-bottom: 14px; }
  #mg .title .pre { font: 400 30px 'Cinzel', serif; letter-spacing: 0.62em; padding-left: 0.62em; margin: 0 0 16px; color: #fff3da; text-shadow: 0 2px 16px rgba(0,0,0,0.65); }
  #mg .title h1 { font: 700 124px 'Cinzel', serif; margin: 0; line-height: 1; color: #fff3da; text-shadow: 0 0 46px rgba(255,160,60,0.45), 0 4px 22px rgba(0,0,0,0.6); }
  #mg .title h2 { font: 400 24px 'Cinzel', serif; letter-spacing: 0.55em; margin: 18px 0 0; color: #f3b45a; text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
`,
});
await page.evaluate(() => {
  const mg = document.createElement('div');
  mg.id = 'mg';
  mg.innerHTML = `<div class="vig"></div>
    <div class="tag"><i></i>IN-ENGINE GAMEPLAY</div>
    <div class="cap"><div class="rule"></div><div class="t"></div><div class="s"></div></div>
    <div class="title"><div class="deva">वाराणसी</div><div class="pre">THE LEGEND OF</div><h1>VARANASI</h1><h2></h2></div>`;
  document.body.appendChild(mg);
  window.__mg = (st) => {
    const q = (s) => mg.querySelector(s);
    const cap = q('.cap');
    cap.style.opacity = st.capO;
    cap.style.transform = `translateY(${(1 - st.capO) * 14}px)`;
    q('.cap .rule').style.width = `${st.rule}px`;
    q('.cap .t').textContent = st.capT || '';
    q('.cap .s').textContent = st.capS || '';
    const ti = q('.title');
    ti.style.opacity = st.titleO;
    q('.title h1').style.letterSpacing = `${st.titleLS}em`;
    q('.title h1').style.paddingLeft = `${st.titleLS}em`; // balance the trailing letter-space
    q('.title h2').textContent = st.titleSub || '';
    q('.title h2').style.display = st.titleSub ? '' : 'none';
    q('.title .deva').style.opacity = st.titleO;
    q('.tag').style.opacity = st.tagO;
  };
});
await page.evaluate(() => document.fonts.ready);

const sstep = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
function overlay(shot, t) {
  const st = { capO: 0, rule: 0, titleO: 0, titleLS: 0.25, tagO: 0, capT: '', capS: '' };
  st.tagO = sstep(t / 0.6) * sstep((shot.dur - t) / 0.4) * 0.9;
  if (shot.caption) {
    const a = t - 0.55;
    st.capT = shot.caption[0];
    st.capS = shot.caption[1];
    st.capO = sstep(a / 0.5) * sstep((shot.dur - 0.45 - t) / 0.45);
    st.rule = 140 * sstep(a / 0.6);
  }
  if (shot.title) {
    st.titleO = sstep((t - 0.3) / 0.9) * sstep((shot.dur - 0.5 - t) / 0.7);
    st.titleLS = 0.62 - 0.36 * sstep((t - 0.2) / 3.6);
    st.tagO = 0;
  }
  if (shot.end) {
    st.titleO = sstep((t - 1.4) / 1.0);
    st.titleLS = 0.5 - 0.24 * sstep((t - 1.2) / 3.2);
    st.titleSub = 'The journey begins';
  }
  return st;
}

fs.mkdirSync(WORK, { recursive: true });
const prevDir = path.join(OUT_DIR, 'intro-preview');
if (PREVIEW) fs.mkdirSync(prevDir, { recursive: true });
const dtMs = 1000 / FPS;
for (const shot of SHOTS) {
  if (shot.cut || (ONLY && !ONLY.includes(shot.id))) continue;
  const t0 = Date.now();
  await page.evaluate((id) => window.__shots[id].setup(), shot.id);
  const warm = await page.evaluate((id) => window.__shots[id].warm || 1.5, shot.id);
  // warm-up: let the follow camera, exposure, people and particles settle
  for (let i = 0; i < Math.round(warm * FPS); i++) {
    await page.evaluate(({ id, t, k, ms }) => {
      window.__shots[id].frame(t, k);
      window.__step(ms);
    }, { id: shot.id, t: 0, k: 0, ms: dtMs });
  }
  await page.evaluate(() => (window.__sfx.length = 0));
  const frames = Math.round(shot.dur * FPS);
  const dir = path.join(WORK, shot.id);
  if (!PREVIEW) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const stills = PREVIEW ? [Math.round(frames * 0.1), Math.round(frames * 0.5), frames - 3] : null;
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    await page.evaluate(({ id, t, k, ms, st }) => {
      window.__clipT = t;
      window.__shots[id].frame(t, k);
      window.__step(ms);
      window.__mg(st);
    }, { id: shot.id, t, k: t / shot.dur, ms: dtMs, st: overlay(shot, t) });
    if (PREVIEW) {
      if (stills.includes(f)) await page.screenshot({ path: path.join(prevDir, `${shot.id}_${String(f).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 80 });
      else if (f > stills[stills.length - 1]) break;
    } else await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  events[shot.id] = await page.evaluate(() => window.__sfx.slice());
  console.log(`${shot.id}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${events[shot.id].length} sound events`);
}
await b.close();
if (PREVIEW) process.exit(0);
fs.writeFileSync(path.join(WORK, 'events.json'), JSON.stringify(events, null, 1));
} else events = JSON.parse(fs.readFileSync(path.join(WORK, 'events.json'), 'utf8'));

// ------------------------------------------------------------------------------------------
// Edit: clips -> crossfaded picture, sound rebuilt from the logged events + music + narration.
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { stdio: 'inherit' });
const hasFrames = (s) => fs.existsSync(path.join(WORK, s.id, '00000.jpg'));
// the cut: freshly captured shots, plus (with --edit-only or --only) the shots already encoded
const shots = SHOTS.filter((s) => !s.cut).filter((s) => hasFrames(s) || ((EDIT_ONLY || ONLY) && fs.existsSync(path.join(WORK, `${s.id}.mp4`))));
if (!EDIT_ONLY) for (const s of shots.filter(hasFrames)) ff('-framerate', String(FPS), '-i', path.join(WORK, s.id, '%05d.jpg'), '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', path.join(WORK, `${s.id}.mp4`));

const starts = [];
let acc = 0;
for (const s of shots) {
  starts.push(acc);
  acc += s.dur - XFADE;
}
const total = acc + XFADE;
const vIn = shots.flatMap((s) => ['-i', path.join(WORK, `${s.id}.mp4`)]);
let chain = '';
let last = '[0:v]';
for (let i = 1; i < shots.length; i++) {
  const out = i === shots.length - 1 ? '[vx]' : `[v${i}]`;
  chain += `${last}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${starts[i].toFixed(3)}${out};`;
  last = out;
}
if (shots.length === 1) chain = '[0:v]null[vx];';
chain += `[vx]fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 1.0).toFixed(2)}:d=1.0[v]`;

// sound
const SFX = {
  splash: 'person-jumps-and-splashes-into-a-river-b-cmuyh969.mp3',
  oar: 'wooden-oar-stroke-pulling-through-calm-r-cmuyhut0.mp3',
  ignite: 'oil-lamp-flame-igniting-with-a-soft-whoo-cmuyh9a4.mp3',
  bell: 'single-brass-temple-bell-strike-with-lon-cmuyh92b.mp3',
  conch: 'sacred-conch-shell-shankh-blown-one-long-cmuyh94b.mp3',
  footstep: 'single-footstep-on-a-worn-stone-step-lea-cmuyhupr.mp3',
  chime: 'magical-sacred-chime-shimmer-small-bead-cmuyh9bt.mp3',
};
const audioIn = [];
const mix = [];
const add = (file, at, vol, extra = '') => {
  const idx = shots.length + audioIn.length / 2;
  audioIn.push('-i', path.join(A, file));
  const ms = Math.max(0, Math.round(at * 1000));
  mix.push(`[${idx}:a]${extra}volume=${vol.toFixed(3)},adelay=${ms}|${ms}[a${mix.length}]`);
};
// music bed under everything, narration over the opening
// (ducked under the narration, then up)
add('seamless-meditative-loop-for-a-sacred-ri-cmuyh8w5.mp3', 0, 1, `atrim=0:${total.toFixed(2)},volume='if(lt(t,15.6),0.36,0.74)':eval=frame,afade=t=in:st=0:d=1.5,afade=t=out:st=${(total - 2.2).toFixed(2)}:d=2.2,`);
add('kashi-older-than-history-the-city-of-lig-cmuyhulu.mp3', 0.7, 1.0);
add('gentle-wide-river-water-lapping-against-cmuyh90m.mp3', 0.2, 4, 'aloop=loop=-1:size=2e9,atrim=0:9,afade=t=out:st=8:d=1,');
add(SFX.conch, 0.1, 0.32);
shots.forEach((s, i) => {
  const evs = events[s.id] || [];
  let steps = 0;
  for (const e of evs) {
    if (e.t < 0 || e.t > s.dur) continue;
    const file = SFX[e.name];
    if (!file) continue;
    if (e.name === 'footstep' && (steps++ % 2 || e.vol < 0.05)) continue;
    add(file, starts[i] + e.t, Math.min(1, e.vol) * (e.name === 'footstep' ? 0.35 : 0.8));
  }
  if (s.id === 's9') add('evening-ganga-aarti-ambience-distant-cro-cmuyh9dh.mp3', starts[i], 0.7, 'aloop=loop=-1:size=2e9,atrim=0:4.4,afade=t=in:d=0.4,afade=t=out:st=3.8:d=0.6,');
  if (s.id === 's8' || s.id === 's5') add('steady-swimming-strokes-in-calm-river-wa-cmuyh986.mp3', starts[i] + (s.id === 's5' ? 2.2 : 0.3), 1.1, 'aloop=loop=-1:size=2e9,atrim=0:3.6,afade=t=out:st=3:d=0.6,');
  if (s.id === 's3') add(SFX.chime, starts[i] + 1.3, 0.35);
  if (s.id === 's8' || s.id === 's6') add('gentle-wide-river-water-lapping-against-cmuyh90m.mp3', starts[i], 7, 'aloop=loop=-1:size=2e9,atrim=0:4.4,afade=t=in:d=0.5,afade=t=out:st=3.8:d=0.6,'); // (a very quiet recording)
  if (s.end) add(SFX.bell, starts[i] + 1.3, 0.6);
});
const amix = `${mix.join(';')};${mix.map((_, i) => `[a${i}]`).join('')}amix=inputs=${mix.length}:normalize=0,alimiter=limit=0.9,atrim=0:${total.toFixed(2)},afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[a]`;
fs.mkdirSync(path.dirname(FINAL), { recursive: true });
ff(...vIn, ...audioIn, '-filter_complex', `${chain};${amix}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-crf', '19', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), FINAL);
// poster frame for the player
ff('-ss', '1.6', '-i', FINAL, '-frames:v', '1', '-q:v', '3', FINAL.replace(/\.mp4$/, '-poster.jpg'));
console.log(`wrote ${FINAL} (${total.toFixed(1)} s, ${(fs.statSync(FINAL).size / 1e6).toFixed(1)} MB)`);
