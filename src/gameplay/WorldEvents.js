import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../utils/math.js';
import { bankCoords, frameAtX, GHAT_SEGMENTS, ghatToWorld, groundHeight, PROFILE_LEN, segmentForX } from '../world/WorldLayout.js';

// Things that happen on the ghats between the chapters and the missions: a call for help near
// wherever Prady is, every few minutes of free roaming. One at a time, never over a story scene,
// a fight, a side mission or a race.
//
//   chor     "Chor! Chor!": a pickpocket snatches a pilgrim's purse and sprints off along the top
//            of the ghats; catch him (he jinks when you close in) and bring the purse back
//   bachao   someone swept off the bottom step is drifting downstream, crying for help: swim out,
//            take hold, tow them back to the steps before the current wins
//   ambush   at night the dark comes up out of the river at a boatman sleeping by his boat
//   patang   a kite-flyer up on a haveli roof calls a challenge: climb up (the bamboo ladder),
//            take the manjha and cut his string ("Bo kata!") on the beat
//
// Each gives punya; every answered call counts toward "Always Nearby".

const _v = new THREE.Vector3();
const AVATARS = { thief: 'Male_Adult_09', victim: 'Female_Adult_06', swimmer: 'Male_Adult_14', boatman: 'Male_Adult_08', flyer: 'Male_Adult_20' };

function onGhatTop(g, u) {
  // the top terrace of ghat g at u (flat, between the steps and the havelis)
  const p = ghatToWorld(g, clamp(u, 2, g.width - 2), 2.0);
  return { x: p.x, y: groundHeight(p.x, p.z), z: p.z };
}

export class WorldEvents {
  constructor(game) {
    this.g = game;
    this.cur = null;
    this.nextT = 150; // the first call after a while of free roaming (and never before Chapter I is told)
    this.marks = [];
    this.defs = { chor: this.chor(), bachao: this.bachao(), ambush: this.ambush(), patang: this.patang() };
    this.lastKind = null;
    this.kites = null;
  }

  get active() {
    return !!this.cur;
  }

  /** May one begin now? */
  quiet() {
    const g = this.g;
    return g.state === 'play' && !g.testSession && (g.story?.done.size ?? 0) >= 1 && !g.encounters.active && !g.missions.active && !g.missions.dialogue && !g.race?.active && !g.riverAarti?.active && !g.story?.cut && !g.asuras.active && g.player.state !== 'boat';
  }

  /** Start event `kind` now (test menu), or the first that fits here. */
  start(kind = null) {
    const g = this.g;
    if (this.cur) this.stop();
    const order = kind ? [kind] : Object.keys(this.defs).filter((k) => k !== this.lastKind).sort(() => Math.random() - 0.5);
    for (const k of order) {
      const def = this.defs[k];
      const spot = def.can(kind !== null);
      if (!spot) continue;
      this.cur = { kind: k, def, t: 0, s: { spot }, actors: [], title: def.title, text: '', meter: null };
      def.begin(this.cur);
      this.lastKind = k;
      g.audio.play('bell', { volume: 0.4, rate: 1.3 });
      return true;
    }
    return false;
  }

  actor(E, o) {
    const a = this.g.crowd?.addActor(o);
    if (a) E.actors.push(a);
    return a;
  }

  objective(text, meter = null) {
    this.cur.text = text;
    this.cur.meter = meter;
  }

  mark(pos) {
    this.marks.push({ kind: 'objective', pos, compass: true });
  }

  done(punya, line) {
    const g = this.g;
    const E = this.cur;
    if (!E) return;
    g.missions.punya += punya;
    g.ui.setPunya(g.missions.punya);
    g.ui.toast(`${E.title} · done`, `+${punya} punya${line ? ` · ${line}` : ''}`, 4.5);
    g.audio.play('ignite', { volume: 0.45 });
    g.achievements?.event('worldEvent', { kind: E.kind });
    this.after(4);
  }

  fail(line) {
    const E = this.cur;
    if (!E) return;
    this.g.ui.toast(E.title, line, 4);
    this.after(2.5);
  }

  /** Wind up: the people stay a moment, then go. */
  after(secs) {
    const E = this.cur;
    E.ending = secs;
  }

  stop() {
    const E = this.cur;
    if (!E) return;
    E.def.stop?.(E);
    for (const a of E.actors) this.g.crowd?.removeActor(a);
    this.cur = null;
    this.marks.length = 0;
    this.g.ui.setMission(null);
    this.nextT = 140 + Math.random() * 90;
  }

  interaction() {
    const E = this.cur;
    if (!E || E.ending) return null;
    return E.def.interact?.(E) || null;
  }

  update(dt) {
    const g = this.g;
    this.marks.length = 0;
    const E = this.cur;
    if (!E) {
      if (g.state === 'play' && this.quiet()) {
        this.nextT -= dt;
        if (this.nextT <= 0) {
          this.nextT = 25; // (nothing fitted here: look again soon)
          this.start();
        }
      }
      return;
    }
    E.t += dt;
    if (E.ending !== undefined) {
      E.ending -= dt;
      E.def.update(E, dt, true);
      if (E.ending <= 0) this.stop();
      return;
    }
    E.def.update(E, dt, false);
    if (this.cur === E && !g.missions.active) g.ui.setMission({ title: E.title, text: E.text, meter: E.meter });
  }

  // ------------------------------------------------------------ Chor! (the pickpocket)
  chor() {
    const self = this;
    const g = this.g;
    return {
      title: 'Chor! Chor!',
      can(force) {
        const h = g.sky.hours;
        if (!force && (h < 8 || h > 19)) return null;
        const P = g.player.position;
        const { u, v, seg } = bankCoords(P.x, P.z);
        const gh = seg || segmentForX(P.x);
        if (!gh || (!force && (v < -6 || v > 26))) return null;
        // a pilgrim along the top of the ghats a little way off; the thief runs on from there
        const dir = u < gh.width / 2 ? 1 : -1;
        const vu = u + dir * 12;
        return { gh, u: vu, dir };
      },
      begin(E) {
        const { gh, u, dir } = E.s.spot;
        const vp = onGhatTop(gh, u);
        const tp = onGhatTop(gh, u + dir * 1.2);
        const yaw = Math.atan2(gh.N.x, gh.N.z);
        E.s.victim = self.actor(E, { avatarId: AVATARS.victim, ...vp, yaw, clip: 'wait', name: 'a pilgrim' });
        E.s.thief = self.actor(E, { avatarId: AVATARS.thief, ...tp, yaw: yaw + Math.PI / 2 * dir, clip: 'idle', name: 'the thief' });
        if (E.s.thief) E.s.thief.actor.run = true;
        // his route: along the top of the ghats, on past the next one if he gets that far
        const path = [];
        let gx = gh;
        let uu = u + dir * 2;
        for (let i = 0; i < 40; i++) {
          uu += dir * 4;
          if (uu > gx.width - 1 || uu < 1) {
            const idx = GHAT_SEGMENTS.indexOf(gx) + dir;
            if (idx < 0 || idx >= GHAT_SEGMENTS.length) break;
            gx = GHAT_SEGMENTS[idx];
            uu = dir > 0 ? 1.5 : gx.width - 1.5;
          }
          path.push(onGhatTop(gx, uu));
        }
        Object.assign(E.s, { phase: 'run', path, i: 0, lost: 0, jink: 0, jinkT: 0, side: 0, cry: 0 });
        g.ui.toast('Chor! Chor!', 'A thief has snatched a pilgrim’s purse. Catch him!', 3.5);
        g.ui.subtitle('A pilgrim: “Chor! Chor! My purse! Somebody stop him!”', 4);
        g.audio.play('whoosh', { volume: 0.5, rate: 0.7 });
      },
      update(E, dt, ending) {
        const s = E.s;
        const t = s.thief;
        const P = g.player.position;
        if (!t) return self.stop();
        if (s.phase === 'run') {
          self.objective('Catch the thief before he loses you along the ghats.', clamp(1 - s.lost / 5, 0, 1));
          self.mark(t);
          const goal = s.path[s.i];
          if (!goal) return self.fail('He slipped away into the galis.');
          const d = Math.hypot(P.x - t.x, P.z - t.z);
          // he jinks when you close in: a quick sidestep and a burst
          s.jinkT -= dt;
          if (d < 4.2 && s.jinkT <= 0) {
            s.jinkT = 2.6;
            s.jink = 0.9;
            s.side = Math.random() < 0.5 ? 1 : -1;
          }
          s.jink = Math.max(0, s.jink - dt);
          // a chase you can win: he eases off when you fall behind (a sprint is 5.4 m/s), tires
          // as it goes on, and now and then catches a foot on a basket or a pilgrim
          s.run = (s.run || 0) + dt;
          s.tripT = (s.tripT ?? 5 + Math.random() * 3) - dt;
          if (s.tripT <= 0) {
            s.tripT = 6 + Math.random() * 4;
            s.trip = 0.7;
            if (d < 30) g.audio.play('thump', { volume: 0.35, rate: 1.4 });
          }
          s.trip = Math.max(0, (s.trip || 0) - dt);
          const tired = s.run > 22 ? 0.8 : s.run > 14 ? 0.9 : 1;
          const speed = s.trip > 0 ? 1.6 : (d > 18 ? 3.4 : s.jink > 0 ? 5.8 : d > 9 ? 4.4 : 4.9) * tired;
          let dx = goal.x - t.x;
          let dz = goal.z - t.z;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l;
          dz /= l;
          // the sidestep is across his line, toward the steps or the houses
          const sx = dx + -dz * s.side * (s.jink > 0.5 ? 0.9 : 0);
          const sz = dz + dx * s.side * (s.jink > 0.5 ? 0.9 : 0);
          const sl = Math.hypot(sx, sz) || 1;
          t.x += (sx / sl) * speed * dt;
          t.z += (sz / sl) * speed * dt;
          t.y = damp(t.y, groundHeight(t.x, t.z), 14, dt);
          t.yaw = Math.atan2(sx, sz);
          t.faceGoal = t.yaw;
          t.actor.speed = damp(t.actor.speed, speed, 5, dt);
          if (l < 1.2) s.i++;
          s.lost = d > 34 ? s.lost + dt : Math.max(0, s.lost - dt);
          if (s.lost > 5) return self.fail('He slipped away into the galis.');
          if (d < 1.7) {
            // caught: he gives it up
            s.phase = 'caught';
            t.actor.speed = 0;
            t.faceGoal = Math.atan2(P.x - t.x, P.z - t.z);
            g.crowd.gesture(t, 'headShake', 2.6, P);
            g.ui.subtitle('The thief: “Maaf karo, bhaiya! Here, take it, take it!”', 3.5);
            g.audio.play('thump', { volume: 0.5, rate: 1.2 });
            g.camRig.shake(0.12);
            s.purse = true;
          }
        } else if (s.phase === 'caught' || s.phase === 'back') {
          s.phase = 'back';
          // the thief, once he has begged, slinks off away from Prady
          s.slink = (s.slink || 0) + dt;
          if (t.actor && s.slink > 2.6) {
            const ax = t.x - P.x;
            const az = t.z - P.z;
            const al = Math.hypot(ax, az) || 1;
            t.x += (ax / al) * 1.2 * dt;
            t.z += (az / al) * 1.2 * dt;
            t.y = damp(t.y, groundHeight(t.x, t.z), 14, dt);
            t.faceGoal = t.yaw = Math.atan2(ax, az);
            t.actor.run = false;
            t.actor.speed = damp(t.actor.speed, 1.2, 4, dt);
          }
          // the pilgrim comes hurrying along the ghat to meet him
          const v = s.victim;
          if (v?.actor) {
            const vd = Math.hypot(P.x - v.x, P.z - v.z);
            const sp = vd > 12 ? 3.0 : vd > 2.2 ? 1.4 : 0;
            if (sp > 0) {
              v.x += ((P.x - v.x) / vd) * sp * dt;
              v.z += ((P.z - v.z) / vd) * sp * dt;
              v.y = damp(v.y, groundHeight(v.x, v.z), 14, dt);
            }
            v.actor.run = true;
            v.actor.speed = damp(v.actor.speed, sp, 4, dt);
            v.faceGoal = v.yaw = Math.atan2(P.x - v.x, P.z - v.z);
          }
          if (!ending) {
            self.objective('Bring the purse back to the pilgrim.');
            self.mark(s.victim);
          }
        }
      },
      interact(E) {
        const s = E.s;
        if (s.phase === 'back' && s.victim && Math.hypot(g.player.position.x - s.victim.x, g.player.position.z - s.victim.z) < 2.6)
          return {
            prompt: 'Return the purse',
            action: () => {
              g.crowd.gesture(s.victim, 'pranam', 2.6, g.player.position);
              g.actions.pranam();
              g.ui.subtitle('The pilgrim: “Jeete raho, beta! Mahadev bless you.”', 3.5);
              s.phase = 'done';
              self.done(10, 'the purse is back');
            },
          };
        return null;
      },
    };
  }

  // ------------------------------------------------------------ Bachao! (someone in the river)
  bachao() {
    const self = this;
    const g = this.g;
    return {
      title: 'Bachao!',
      can(force) {
        const h = g.sky.hours;
        if (!force && (h < 6 || h > 18.5)) return null;
        const P = g.player.position;
        const { u, v, seg } = bankCoords(P.x, P.z);
        const gh = seg || segmentForX(P.x);
        if (!gh || (!force && (v < 4 || v > PROFILE_LEN + 30))) return null;
        return { gh, u: clamp(u - 8, 4, gh.width - 4) };
      },
      begin(E) {
        const { gh, u } = E.s.spot;
        const p = ghatToWorld(gh, u, PROFILE_LEN + 13);
        const y = g.water.heightAt(p.x, p.z) - 1.42;
        E.s.who = self.actor(E, { avatarId: AVATARS.swimmer, x: p.x, y, z: p.z, yaw: Math.atan2(-gh.N.x, -gh.N.z), clip: 'wave', name: 'a pilgrim in the river', noCollider: true });
        Object.assign(E.s, { phase: 'drift', time: 75, cry: 0, splash: 0, gh });
        g.ui.toast('Bachao! Bachao!', 'Someone has been swept off the steps. Swim out to them!', 4);
        g.ui.subtitle('“Bachao! Bachao! I can’t… swim…”', 4);
      },
      update(E, dt, ending) {
        const s = E.s;
        const w = s.who;
        const P = g.player.position;
        if (!w) return self.stop();
        const surf = g.water.heightAt(w.x, w.z);
        if (s.phase === 'drift' || s.phase === 'tow') {
          s.time -= dt;
          s.splash -= dt;
          if (s.splash <= 0) {
            s.splash = s.phase === 'drift' ? 0.35 : 0.7;
            g.fx.spray(w.x + (Math.random() - 0.5) * 0.6, surf, w.z + (Math.random() - 0.5) * 0.6);
            if (Math.random() < 0.3) g.ripples.spawn(w.x, surf, w.z, 1.2, 1.4);
          }
        }
        if (s.phase === 'drift') {
          // the current carries them downstream, bobbing, arms up
          const c = g.water.currentAt(w.x, w.z, _v);
          w.x += c.x * 0.8 * dt;
          w.z += c.z * 0.8 * dt;
          w.y = surf - 1.42 + Math.sin(E.t * 2.6) * 0.12;
          w.clip = 'wave';
          s.cry -= dt;
          if (s.cry <= 0) {
            s.cry = 5;
            g.ui.subtitle('“Bachao! Help!”', 2);
          }
          self.objective('Swim out to them before the current takes them.', clamp(s.time / 75, 0, 1));
          self.mark(w);
          if (s.time <= 0) {
            s.phase = 'gone';
            g.ui.subtitle('A boatman hauls them aboard further down. You were too slow this time.', 4);
            return self.fail('A boatman reached them first.');
          }
        } else if (s.phase === 'tow') {
          // held at his shoulder, kicking along behind him
          const yaw = g.player.yaw;
          const tx = P.x - Math.sin(yaw) * 0.75 + Math.cos(yaw) * 0.35;
          const tz = P.z - Math.cos(yaw) * 0.75 - Math.sin(yaw) * 0.35;
          w.x = damp(w.x, tx, 5, dt);
          w.z = damp(w.z, tz, 5, dt);
          w.yaw = dampAngle(w.yaw, yaw, 4, dt);
          const ground = groundHeight(w.x, w.z);
          w.y = damp(w.y, Math.max(ground, surf - 1.42), 6, dt);
          w.clip = 'idle';
          self.objective('Bring them back to the steps.', clamp(s.time / 75, 0, 1));
          self.mark(onGhatTop(s.gh, bankCoords(P.x, P.z).u));
          // on his feet: shallow enough to stand
          if (surf - ground < 1.0 && g.player.state === 'ground') {
            s.phase = 'safe';
            w.y = ground;
            g.crowd.gesture(w, 'pranam', 3, P);
            g.ui.subtitle('“Ganga Maiya sent you… thank you, thank you.”', 3.5);
            self.done(18, 'safe on the steps');
          }
          if (s.time <= -30) return self.fail('They slipped from your grasp.');
        } else if (s.phase === 'safe' || ending) {
          w.y = damp(w.y, groundHeight(w.x, w.z), 4, dt);
        }
      },
      interact(E) {
        const s = E.s;
        const w = s.who;
        const p = g.player;
        if (s.phase === 'drift' && w && (p.state === 'swim' || p.state === 'dive') && Math.hypot(p.position.x - w.x, p.position.z - w.z) < 2.0)
          return {
            prompt: 'Take hold of them',
            action: () => {
              s.phase = 'tow';
              g.ui.subtitle('Prady: “I have you. Breathe. Hold on to me.”', 3);
              g.fx.splash(w.x, g.water.heightAt(w.x, w.z), w.z, 0.4);
            },
          };
        return null;
      },
    };
  }

  // ------------------------------------------------------------ the night ambush at the boats
  ambush() {
    const self = this;
    const g = this.g;
    return {
      title: 'Darkness at the Boats',
      can(force) {
        const h = g.sky.hours;
        if (!force && h > 4.5 && h < 20) return null;
        const P = g.player.position;
        const { v, seg } = bankCoords(P.x, P.z);
        const gh = seg || segmentForX(P.x);
        if (!gh || (!force && (v < -4 || v > PROFILE_LEN + 4))) return null;
        // a moored boat at this ghat
        let best = null;
        let bd = 70;
        for (const b of g.world.layout.boats.moored) {
          const d = Math.hypot(b.x - P.x, b.z - P.z);
          const bc = bankCoords(b.x, b.z);
          if (d < bd && bc.seg === gh) {
            bd = d;
            best = b;
          }
        }
        if (!best && !force) return null;
        const bc = best ? bankCoords(best.x, best.z) : bankCoords(P.x, P.z);
        return { gh, u: clamp(bc.u, 6, gh.width - 6), boat: best };
      },
      begin(E) {
        const { gh, u } = E.s.spot;
        // the boatman on the bottom dry step by his boat, shouting
        let v = PROFILE_LEN - 0.4;
        let p = ghatToWorld(gh, u, v);
        while (v > 12 && groundHeight(p.x, p.z) < 0.3) {
          v -= 0.4;
          p = ghatToWorld(gh, u, v);
        }
        E.s.boatman = self.actor(E, { avatarId: AVATARS.boatman, x: p.x, y: groundHeight(p.x, p.z), z: p.z, yaw: Math.atan2(-gh.N.x, -gh.N.z), clip: 'wave', name: 'a boatman' });
        E.s.phase = 'fight';
        g.ui.toast('Darkness at the Boats', 'Asuras rise beside a boatman’s boat. Defend him!', 3.5);
        g.ui.subtitle('A boatman: “Rakshasa! They’re coming out of the water! Somebody!”', 4);
        const waves = g.sky.nightFactor > 0.5 && Math.random() < 0.5 ? [{ n: 2, kind: 'shade' }, { n: 1, kind: 'vetala' }] : [{ n: 2, kind: 'shade' }, { n: 1, kind: 'pishacha' }];
        g.encounters.start({
          ghat: gh.id,
          u,
          waves,
          title: gh.name,
          onWin: () => {
            if (self.cur !== E) return;
            E.s.phase = 'won';
            if (E.s.boatman) g.crowd.gesture(E.s.boatman, 'pranam', 3, g.player.position);
            g.ui.subtitle('The boatman: “You fight like Kaal Bhairav’s own dog, bhaiya. My boat is yours, any night.”', 4.5);
            self.done(20, 'the boatman is safe');
          },
          onLose: () => self.cur === E && self.fail('The boatman fled into the lanes.'),
        });
      },
      update(E, dt, ending) {
        const s = E.s;
        if (s.phase === 'fight' && !ending) {
          self.objective('Drive the Asuras back into the river.');
          const P = g.player.position;
          if (s.boatman && Math.hypot(P.x - s.boatman.x, P.z - s.boatman.z) > 90) {
            g.encounters.clear();
            self.fail('You left the boatman to the dark.');
          }
        }
      },
      stop() {},
    };
  }

  // ------------------------------------------------------------ Patang (the kite duel)
  patang() {
    const self = this;
    const g = this.g;
    return {
      title: 'Pench! A Kite Duel',
      can(force) {
        const h = g.sky.hours;
        if (!force && (h < 13 || h > 18.5 || (g.weather?.rain ?? 0) > 0.2)) return null;
        const T = g.traversal;
        if (!T?.ladders.length) return null;
        const P = g.player.position;
        let best = null;
        let bd = force ? Infinity : 130;
        for (const L of T.ladders) {
          if (L.roof) continue;
          const d = Math.hypot(L.wall.x - P.x, L.wall.z - P.z);
          if (d < bd) {
            bd = d;
            best = L;
          }
        }
        return best ? { L: best } : null;
      },
      begin(E) {
        const L = E.s.spot.L;
        const b = L.b;
        const roofY = b.baseY + b.h;
        // the challenger on the far half of the roof; Prady's spot near the ladder's head
        const c = Math.cos(b.yaw);
        const sn = Math.sin(b.yaw);
        const at = (lx, lz) => ({ x: b.x + lx * c + lz * sn, z: b.z - lx * sn + lz * c });
        const toward = -Math.sign((L.wall.x - b.x) * c - (L.wall.z - b.z) * sn) || 1;
        // both a few steps in from the ladder's head, so its "Climb down" never covers the manjha
        const headLz = (L.wall.x - b.x) * sn + (L.wall.z - b.z) * c;
        const lz = clamp(headLz - 4.2, -b.d / 2 + 1.6, b.d / 2 - 1.6);
        const fp = at(toward * b.w * 0.22, lz);
        const yaw = Math.atan2(frameAtX(b.x).N.x, frameAtX(b.x).N.z);
        E.s.flyer = self.actor(E, { avatarId: AVATARS.flyer, x: fp.x, y: roofY, z: fp.z, yaw, clip: 'wave', name: 'a kite-flyer' });
        const sp = at(-toward * b.w * 0.18, lz);
        E.s.spotP = { x: sp.x, y: roofY, z: sp.z };
        E.s.phase = 'go';
        E.s.roofY = roofY;
        self.makeKites(E);
        g.ui.toast('Pench! A Kite Duel', 'A kite-flyer calls a challenge from the rooftops. Climb up and cut his string.', 4.5);
      },
      update(E, dt, ending) {
        const s = E.s;
        const P = g.player.position;
        self.updateKites(E, dt);
        if (ending) return;
        if (s.phase === 'go') {
          const up = g.player.feetY > s.roofY - 1;
          self.objective(up ? 'Take up the manjha: your red charkhi waits by the kite-flyer.' : 'Climb to the rooftops: the bamboo ladder against the haveli.');
          self.mark(up ? s.spotP : g.traversal.ladderPoint(s.spot.L, s.spot.L.y0 + 1, new THREE.Vector3()));
          if (up && Math.hypot(P.x - s.spotP.x, P.z - s.spotP.z) < 20) g.achievements?.event('roof', {});
        } else if (s.phase === 'duel') {
          self.objective(`Pull on the beat to bring your kite over his and cut his string. ${4 - s.his} miss${4 - s.his === 1 ? '' : 'es'} before he cuts yours.`, s.mine);
          const r = g.ui.rhythmUpdate(dt, g.input.hit('Space') || g.input.hit('Mouse0') || g.input.hit('Pad0'));
          if (r === 'hit') {
            s.mine = Math.min(1, s.mine + 0.17);
            g.audio.play('whoosh', { volume: 0.4, rate: 1.4 });
          } else if (r === 'miss') {
            s.his += 1;
            g.audio.play('block', { volume: 0.25, rate: 1.8 });
            if (s.his >= 4) {
              g.ui.rhythmStop();
              s.phase = 'lost';
              s.cut = 'mine';
              g.player.inputLocked = false;
              g.animator.stop(0.4);
              g.ui.subtitle('The kite-flyer: “Bo kata! Ha! Come back when your manjha has some glass in it!”', 4);
              return self.fail('Your string was cut.');
            }
          }
          if (r === 'done') {
            s.phase = 'won';
            s.cut = 'his';
            g.player.inputLocked = false;
            g.animator.stop(0.4);
            g.ui.subtitle('“BO KATA!” The whole lane shouts it from the roofs.', 4);
            g.audio.play('conch', { volume: 0.5, rate: 1.2 });
            if (s.flyer) g.crowd.gesture(s.flyer, 'agree', 3, P);
            g.achievements?.event('kite', {});
            self.done(14, 'his kite drifts away over the river');
          }
        }
      },
      interact(E) {
        const s = E.s;
        if (s.phase === 'go' && Math.hypot(g.player.position.x - s.spotP.x, g.player.position.z - s.spotP.z) < 3 && Math.abs(g.player.feetY - s.roofY) < 1.2)
          return {
            prompt: 'Take up the manjha',
            action: () => {
              s.phase = 'duel';
              s.mine = 0;
              s.his = 0;
              g.player.inputLocked = true;
              g.player.yaw = Math.atan2(s.kitePos.x - g.player.position.x, s.kitePos.z - g.player.position.z);
              // the camera turns up to the two kites over the river
              g.camRig.yaw = g.player.yaw;
              g.camRig.pitch = -0.32;
              g.animator.play('wave', { loop: true, fadeIn: 0.3, fadeOut: 0.4, cancelOnMove: false, noLook: true, timeScale: 0.6 });
              g.ui.rhythmStart({ title: 'Pench! Pull on the beat', hint: 'Space / click when the mark is in the gold', need: 6, speed: 0.95, zone: 0.17 });
            },
          };
        return null;
      },
      stop(E) {
        self.removeKites();
        if (E.s.phase === 'duel') {
          g.ui.rhythmStop();
          g.player.inputLocked = false;
          g.animator.stop(0.3);
        }
      },
    };
  }

  makeKites(E) {
    const g = this.g;
    const s = E.s;
    const L = s.spot.L;
    const N = frameAtX(L.b.x).N;
    // two kites high over the river in front of the roof
    const base = new THREE.Vector3(L.b.x + N.x * 24, s.roofY + 15, L.b.z + N.z * 24);
    s.kitePos = base.clone();
    // a patang: a diamond of paper on a bamboo cross, a little tail (drawn large enough to follow)
    const K = 1.6;
    const kiteGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(-0.5, 0.05, 0), new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.55, 0), new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0.5, 0.05, 0), new THREE.Vector3(-0.08, -0.5, 0), new THREE.Vector3(0, -0.78, 0), new THREE.Vector3(0.08, -0.5, 0)].map((v) => v.multiplyScalar(K)));
    kiteGeo.computeVertexNormals();
    const mk = (color) => {
      const m = new THREE.Mesh(kiteGeo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, emissive: color, emissiveIntensity: 0.15 }));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xf2e6d0, transparent: true, opacity: 0.55 }));
      line.frustumCulled = false;
      g.scene.add(m, line);
      return { m, line, pos: base.clone(), vel: new THREE.Vector3(), fall: 0 };
    };
    this.kites = { mine: mk(0xd8241a), his: mk(0xf2c21a), base, t: 0 };
    this.kites.mine.pos.x += 4;
    this.kites.his.pos.x -= 4;
    // Prady's charkhi (the spool of manjha) waiting on the roof, a soft ring around it until he
    // takes it up: what "Take up the manjha" means, visible from the ladder's head
    const spool = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 });
    const thread = new THREE.MeshStandardMaterial({ color: 0xd8241a, roughness: 0.55 });
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 12), thread);
    const ends = [-0.14, 0.14].map((y) => {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 12), wood);
      e.position.y = y;
      return e;
    });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), wood);
    handle.position.y = 0;
    spool.add(drum, ...ends, handle);
    spool.rotation.z = Math.PI / 2;
    spool.position.set(s.spotP.x, s.roofY + 0.2, s.spotP.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 40), new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.5, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.spotP.x, s.roofY + 0.03, s.spotP.z);
    g.scene.add(spool, ring);
    this.kites.spool = spool;
    this.kites.ring = ring;
  }

  removeKites() {
    if (!this.kites) return;
    for (const k of [this.kites.mine, this.kites.his]) {
      this.g.scene.remove(k.m, k.line);
      k.m.geometry.dispose?.();
      k.line.geometry.dispose();
    }
    const { spool, ring } = this.kites;
    this.g.scene.remove(spool, ring);
    spool.traverse((o) => o.geometry?.dispose());
    ring.geometry.dispose();
    this.kites = null;
  }

  updateKites(E, dt) {
    const K = this.kites;
    if (!K) return;
    const g = this.g;
    const s = E.s;
    K.t += dt;
    const hand = s.phase === 'duel' ? g.animator.boneWorld('RightHand', new THREE.Vector3()) : null;
    const fl = s.flyer;
    // the spool rides in his hand through the duel; before it, the ring breathes around it
    K.ring.visible = s.phase === 'go';
    K.ring.material.opacity = 0.3 + Math.sin(K.t * 3.2) * 0.18;
    if (hand) {
      // held by its handle, the spool across his body to the left of the hand
      const yaw = g.player.yaw;
      K.spool.rotation.set(0, yaw, Math.PI / 2);
      K.spool.position.set(hand.x + Math.cos(yaw) * 0.33, hand.y, hand.z - Math.sin(yaw) * 0.33);
    } else {
      K.spool.rotation.set(0, 0, Math.PI / 2);
      K.spool.position.set(s.spotP.x, s.roofY + 0.2, s.spotP.z);
    }
    for (const [name, k, from] of [
      ['mine', K.mine, hand || K.spool.position],
      ['his', K.his, fl ? new THREE.Vector3(fl.x, s.roofY + 1.9, fl.z) : K.base],
    ]) {
      const cut = s.cut === name;
      if (cut) {
        // its string gone: it slips sideways, tumbles and drifts down over the river
        k.fall += dt;
        k.pos.x += dt * (4 + Math.sin(k.fall * 3) * 2);
        k.pos.y -= dt * (1.4 + k.fall * 0.8);
        k.m.rotation.z += dt * 3.2;
        k.line.visible = false;
      } else {
        // dancing in the wind; the duel: mine climbs as the pulls land, his drops toward it
        const lead = name === 'mine' ? (s.mine ?? 0) : -(s.mine ?? 0) * 0.5;
        const want = _v.set(K.base.x + (name === 'mine' ? 3 : -3) + Math.sin(K.t * 0.9 + (name === 'mine' ? 0 : 2)) * 3, K.base.y + lead * 4 + Math.sin(K.t * 1.7 + (name === 'mine' ? 1 : 0)) * 1.5, K.base.z + Math.cos(K.t * 0.7) * 2);
        k.pos.lerp(want, Math.min(1, dt * 1.5));
        k.m.rotation.z = Math.sin(K.t * 2.3 + (name === 'mine' ? 0 : 1)) * 0.4;
        k.line.visible = true;
        const P = k.line.geometry.attributes.position;
        for (let i = 0; i < 16; i++) {
          const t = i / 15;
          const sag = Math.sin(t * Math.PI) * 2.2;
          P.setXYZ(i, from.x + (k.pos.x - from.x) * t, from.y + (k.pos.y - from.y) * t - sag, from.z + (k.pos.z - from.z) * t);
        }
        P.needsUpdate = true;
      }
      k.m.position.copy(k.pos);
      k.m.lookAt(from);
    }
  }
}
