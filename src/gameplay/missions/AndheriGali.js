import * as THREE from 'three';
import { damp } from '../../utils/math.js';
import { frameAtX, frameToWorld, groundHeight, LANES_V } from '../../world/WorldLayout.js';

// Andheri Gali, the dark lane. At night Ramesh the halwai's boy Chotu went down the lane to the
// Sankata Devi shrine with a lamp for his grandmother, and hasn't come back; behind him the lamps
// of the gali went out one by one, and the dark that is left isn't the ordinary kind.
//
// Ramesh gives Prady a diya (HandDiya): its light is all he has. The lane's lamps die as he
// passes them, footsteps answer his a beat late, voices whisper his name, and the shades come up
// out of the dark to pace him at the edge of the flame; a Vetala goes along the rooftops above.
// The wind gutters the diya (walk, don't run); relight it at the wall shrines. Find Chotu, bring
// him back inside the light, and the lamps come back on behind the two of you.

const LANE = LANES_V[1];
const X0 = -138; // the halwai's shop
const X1 = -226; // the shrine, about where (the nearest real one in the lane is used)
const TRAIL_STEP = 0.35;
const WHISPERS = ['whisper-prady', 'whisper-laut-ja', 'whisper-diya-bujhega', 'whisper-hum-yahin'];

export default function andheriGali(game) {
  const laneAt = (x, side = 0) => {
    const f = frameAtX(x);
    const p = frameToWorld(f, 0, LANE + side);
    return { x: p.x, y: groundHeight(p.x, p.z), z: p.z, yaw: Math.atan2(f.T.x, f.T.z) };
  };
  // the destination: the hidden shrine nearest X1 in this lane
  const shrine = () => {
    const list = game.world.galis?.shrines ?? [];
    let best = null;
    let bd = Infinity;
    for (const s of list) {
      const f = frameAtX(s.x);
      const v = (s.x - f.P.x) * f.N.x + (s.z - f.P.z) * f.N.z;
      if (Math.abs(v - LANE) > 5) continue;
      const d = Math.abs(s.x - X1);
      if (d < bd && d < 70) {
        bd = d;
        best = s;
      }
    }
    return best ? { x: best.x, y: best.y, z: best.z, yaw: best.yaw } : laneAt(X1, -2.2);
  };
  // 0..1 along the lane from the shop (X0) to the shrine
  const along = (p, s) => Math.max(0, Math.min(1.2, (X0 - p.x) / Math.max(1, X0 - s.x)));
  const inZone = (p, s) => {
    const f = frameAtX(p.x);
    const v = (p.x - f.P.x) * f.N.x + (p.z - f.P.z) * f.N.z;
    return p.x < X0 + 6 && p.x > s.x - 14 && Math.abs(v - LANE) < 9;
  };

  return {
    id: 'gali',
    title: 'Andheri Gali',
    night: true,
    giver: { name: 'Ramesh the halwai', avatarId: 'Male_Adult_09', clip: 'wait', hours: [19.5, 4], at: () => laneAt(X0, 2.2) },
    // (the test menu's horror jump: already under way, a few steps into the lane, diya in hand)
    scare: {
      label: 'Andheri Gali · into the dark lane',
      sub: 'The lamps die behind you, whispers, shades at the edge of the flame, a Vetala on the roofs',
      hours: 21.5,
      at: () => {
        const q = laneAt(X0 - 12);
        return { ...q, yaw: q.yaw + Math.PI };
      },
    },
    offer: [
      ['Ramesh the halwai', 'Bhaiya… my Chotu went down this gali at sunset with a lamp for Sankata Devi. He has not come back.'],
      ['Ramesh the halwai', 'Since then the lamps have been going out, one after another, down the whole lane. No wind did that.'],
      ['Ramesh the halwai', 'Take this diya. Keep it burning, whatever you hear. They say the dark down there is afraid of only one thing.'],
    ],
    start(m) {
      const s = shrine();
      m.state = { phase: 'go', s, kid: null, trail: [], spawned: 0, whisperT: 6, echo: 0, lamps: [], waitT: 0, outT: 0 };
      // Chotu, hiding in the shrine's light with his knees drawn up
      const k = { x: s.x + Math.sin(s.yaw) * 0.9, y: groundHeight(s.x, s.z), z: s.z + Math.cos(s.yaw) * 0.9, yaw: s.yaw };
      m.state.kid = m.actor({ avatarId: 'Male_Child_01', ...k, clip: 'floorSit', name: 'Chotu' });
      if (m.state.kid) m.state.kid.tint = 'saffron';
      // (the shades' bodies load now, while he walks into the lane)
      game.asuras.load();
      game.handDiya.carry(true);
      game.handDiya.windK = 1;
      game.handDiya.shy = new Set(['shade']); // (the Vetala is no shade: it comes for him out of the dark, light or no light)
      game.handDiya.onOut = () => {
        game.dread.want('gali-out', 0.85);
        game.audio.play('whisper-diya-bujhega', { volume: 0.7, at: game.player.position.clone().add(new THREE.Vector3(1.5, 1.6, -1)) });
      };
      game.handDiya.onLit = () => game.dread.want('gali-out', 0);
      // the lamps in the lane that will die as he passes them
      for (const l of game.night?.laneLamps ?? []) if (inZone(l.pos, s)) m.state.lamps.push(l);
      game.lampFilter = (p) => !(inZone(p, s) && m.state.dark);
    },
    update(m, dt) {
      const S = m.state;
      const p = game.player.position;
      const zone = inZone(p, S.s);
      const k = along(p, S.s);
      // ---- the dark: once he is in the lane it closes over him
      S.dark = S.phase !== 'home';
      const gloom = zone && S.dark ? (S.phase === 'lead' ? 0.6 : 0.85) : 0;
      game.sky.gloom = damp(game.sky.gloom || 0, gloom, 1.2, dt);
      game.nightDim = damp(game.nightDim || 0, gloom * 0.9, 1.2, dt);
      game.dread.want('gali', zone ? 0.35 + 0.3 * Math.min(1, k * 1.3) : 0);

      // ---- the lamps die behind him (a stutter first), and come back on as he brings Chotu home
      for (const l of S.lamps) {
        const passed = l.pos.x > p.x + 3;
        if (S.phase === 'go' && passed && !l.dead && !l.dying) l.dying = 1.1;
        if (l.dying) {
          l.dying -= dt;
          game.fire.setLit(l.id, Math.random() < 0.5 ? 0.15 : 1);
          if (l.dying <= 0) {
            l.dying = 0;
            l.dead = true;
            game.fire.setLit(l.id, 0);
          }
        }
        if (S.phase === 'lead' && l.dead && l.pos.x < p.x - 1) {
          l.dead = false;
          game.fire.setLit(l.id, 1);
          game.audio.play('ignite', { volume: 0.35, at: l.pos });
        }
      }

      // ---- they come up out of the dark: pairs of shades, then the Vetala on the walls
      const spawnAt = (ahead, side) => {
        const q = laneAt(p.x - ahead, side);
        return { x: q.x, y: q.y, z: q.z, yaw: q.yaw };
      };
      if (S.phase === 'go' && zone && game.asuras.ready) {
        if (S.spawned === 0 && k > 0.22) {
          S.spawned = 1;
          game.asuras.spawn('shade', spawnAt(9, 1.5), { name: 'Chhaya' });
          game.asuras.spawn('shade', spawnAt(-7, -1.2), { name: 'Chhaya' });
          game.audio.play('whisper-hum-yahin', { volume: 0.8, at: spawnAt(5, 2) });
        } else if (S.spawned === 1 && k > 0.6) {
          S.spawned = 2;
          game.asuras.spawn('vetala', spawnAt(12, 2.5), { name: 'Vetala' });
          game.asuras.spawn('shade', spawnAt(-6, 1), { name: 'Chhaya' });
        }
      }
      if (S.phase === 'lead' && S.spawned === 2 && k < 0.55 && game.asuras.ready) {
        S.spawned = 3;
        game.asuras.spawn('shade', spawnAt(-8, -1.5), { name: 'Chhaya' });
        game.asuras.spawn('shade', spawnAt(8, 1.5), { name: 'Chhaya' });
      }
      // the hunt: something close in the dark beyond the flame raises the heartbeat
      let near = 0;
      for (const a of game.asuras.list) if (a.alive) near = Math.max(near, 1 - Math.hypot(a.pos.x - p.x, a.pos.z - p.z) / 12);
      game.dread.threat(near * (game.handDiya.lit ? 0.7 : 1));

      // ---- voices in the dark, and footsteps a beat behind his own
      if (zone && S.dark) {
        S.whisperT -= dt;
        if (S.whisperT <= 0) {
          S.whisperT = 9 + Math.random() * 9;
          const a = game.player.yaw + Math.PI + (Math.random() - 0.5) * 2.2;
          const at = new THREE.Vector3(p.x + Math.sin(a) * 6, p.y + 1.4, p.z + Math.cos(a) * 6);
          const pool = WHISPERS.filter((w) => w !== S.lastWhisper);
          S.lastWhisper = pool[Math.floor(Math.random() * pool.length)];
          game.audio.play(S.lastWhisper, { volume: 0.75, at, ref: 4 });
        }
        if (game.player.lastStep !== S.stepSeen) {
          S.stepSeen = game.player.lastStep;
          if (game.player.speed > 0.4 && Math.random() < 0.35) {
            const b = game.player.yaw + Math.PI;
            game.audio.play('footstep', { volume: 0.5, delay: 0.38, rate: 0.82, at: { x: p.x + Math.sin(b) * 7, y: p.y, z: p.z + Math.cos(b) * 7 } });
          }
        }
      }

      // ---- the objectives
      if (S.phase === 'go') {
        m.objective(game.handDiya.lit ? 'Go down the dark lane to the Sankata Devi shrine. Walk: running fans the flame.' : 'The diya is out. Relight it at a shrine’s flame (E).');
        m.mark('item', { x: S.s.x, y: S.s.y + 1.2, z: S.s.z }, true);
      } else if (S.phase === 'lead') {
        this.follow(m, dt);
        m.objective(game.handDiya.lit ? 'Bring Chotu back to his father. Keep him inside the light.' : 'Relight the diya. Chotu won’t move in the dark.');
        if (m.giver) m.mark('objective', m.giver);
      }
    },
    follow(m, dt) {
      const S = m.state;
      const p = game.player;
      const kid = S.kid;
      if (!kid) return;
      if (p.state === 'ground') {
        const last = S.trail[S.trail.length - 1];
        if (!last || Math.hypot(p.position.x - last.x, p.position.z - last.z) > TRAIL_STEP) S.trail.push({ x: p.position.x, z: p.position.z });
        if (S.trail.length > 400) S.trail.shift();
      }
      let speed = 0;
      while (S.trail.length && Math.hypot(S.trail[0].x - kid.x, S.trail[0].z - kid.z) < 0.25) S.trail.shift();
      const gap = S.trail.length * TRAIL_STEP;
      // (in the dark he freezes where he is)
      if (S.trail.length && gap > 1.3 && game.handDiya.lit) {
        const t = S.trail[0];
        const dx = t.x - kid.x;
        const dz = t.z - kid.z;
        const d = Math.hypot(dx, dz) || 1;
        speed = Math.min(2.2, 0.9 + gap * 0.4);
        const step = Math.min(d, speed * dt);
        kid.x += (dx / d) * step;
        kid.z += (dz / d) * step;
        kid.yaw = Math.atan2(dx, dz);
      }
      kid.actor.speed = damp(kid.actor.speed, speed, 6, dt);
      kid.y = damp(kid.y, groundHeight(kid.x, kid.z), 12, dt);
      const far = Math.hypot(p.position.x - kid.x, p.position.z - kid.z);
      S.waitT -= dt;
      if (S.waitT <= 0 && (far > 7 || !game.handDiya.lit)) {
        S.waitT = 7;
        game.ui.subtitle(game.handDiya.lit ? 'Chotu: “Bhaiya, don’t leave me in the dark!”' : 'Chotu: “Bhaiya… the light! I can’t see you!”', 3);
      }
      const dad = m.giver;
      if (dad && Math.hypot(dad.x - kid.x, dad.z - kid.z) < 4) {
        S.phase = 'home';
        game.crowd.gesture(dad, 'pranam', 2.4, kid);
        kid.actor.speed = 0;
        m.done();
      }
    },
    interact(m) {
      const S = m.state;
      if (S.phase === 'go' && S.kid && m.near(S.kid, 2.6) && game.handDiya.lit)
        return {
          prompt: 'Kneel beside Chotu',
          action: () =>
            m.say([
              ['Chotu', '(whispering) …Bhaiya? They’re out there. They know my name. They kept saying it.'],
              ['Prady', 'They can’t come into the light. Hold the end of my dhoti and walk where I walk.'],
            ], {
              then: () => {
                S.phase = 'lead';
                S.kid.clip = 'idle';
                S.trail = [];
                game.audio.play('whisper-laut-ja', { volume: 0.8, at: { x: S.s.x, y: S.s.y + 1.5, z: S.s.z } });
              },
            }),
        };
      return null;
    },
    on(m, ev) {
      if (ev === 'combat:death') m.fail('The dark took the lane.');
    },
    stop() {
      game.handDiya.carry(false);
      game.handDiya.onOut = game.handDiya.onLit = null;
      game.handDiya.shy = new Set(['shade']);
      game.dread.want('gali', 0);
      game.dread.want('gali-out', 0);
      game.sky.gloom = 0;
      game.nightDim = 0;
      game.lampFilter = null;
      for (const l of game.night?.laneLamps ?? []) {
        if (l.dead || l.dying) {
          l.dead = false;
          l.dying = 0;
          game.fire.setLit(l.id, 1);
        }
      }
      for (const a of game.asuras.list) if (a.alive && (a.name === 'Chhaya' || a.name === 'Vetala')) a.banish();
    },
    outro: [
      ['Ramesh the halwai', 'Chotu! Look at you, shivering like a leaf… Come here, come here.'],
      ['Ramesh the halwai', 'Bhaiya, whatever you saw down there, don’t tell his grandmother. Take a box of my best rasgulla, and my blessings with it.'],
    ],
    reward: { punya: 40, note: 'Chotu is home, and the gali’s lamps burn again' },
  };
}
