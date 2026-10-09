import goddessSword from './chapters/GoddessSword.js';
import annapurna from './chapters/Annapurna.js';
import tenHorses from './chapters/TenHorses.js';
import lostEarring from './chapters/LostEarring.js';
import kaalBhairav from './chapters/KaalBhairav.js';

// The Legend of Varanasi, told in five chapters: one legend of Kashi each, each ending with
// one of the five sacred flames burning again. A chapter is a list of steps; each step sets an
// objective, can place people and markers, listens for events, and moves the story on with
// s.next(). Cutscenes (scene()) frame the moments that matter, with voiced lines.
//
// Chapter files (src/gameplay/chapters/*.js) export (game, story) => {
//   id, num, title, flame, ghat, legend,
//   steps: [{ id, text, prep?(g) (test jumps: make it reachable), start?(s), update?(s, dt),
//             interact?(s) -> { prompt, action } | null, on?(s, event, data), stop?(s) }],
//   reward: { note, apply?(g) } }
// `s` is the step's runtime: s.next(), s.mark(kind, pos), s.actor({...}), s.say(lines, then),
// s.scene({...}), s.state (scratch), s.g (the game).

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

class StepRun {
  constructor(story, chapter, index) {
    this.story = story;
    this.g = story.g;
    this.chapter = chapter;
    this.index = index;
    this.def = chapter.steps[index];
    this.state = {};
    this.marks = [];
    this.actors = [];
    this.t = 0;
    this.over = false;
  }

  next() {
    if (this.over) return;
    this.over = true;
    this.story.advance(this);
  }

  mark(kind, pos, compass = kind === 'objective') {
    this.marks.push({ kind, pos, compass });
  }

  actor(o) {
    const a = this.g.crowd?.addActor(o);
    if (a) this.actors.push(a);
    return a;
  }

  /** Voiced talk in the dialogue box: lines [[who, text, voice?]]. */
  say(lines, then, opts = {}) {
    this.g.missions.talk(lines, { ...opts, then });
  }

  scene(def) {
    return this.story.scene(def);
  }

  near(p, r) {
    const q = this.g.player.position;
    return Math.hypot(q.x - p.x, q.z - p.z) < r && Math.abs((p.y ?? this.g.player.feetY) - this.g.player.feetY) < 3.5;
  }

  objective(text) {
    this.story.text = text;
  }
}

export class Story {
  constructor(game) {
    this.g = game;
    this.chapters = [goddessSword, annapurna, tenHorses, lostEarring, kaalBhairav].map((f) => f(game, this));
    this.ch = 0; // the chapter in hand
    this.done = new Set();
    this.flags = {};
    this.run = null;
    this.text = '';
    this.cut = null;
    this._compassKey = '';
  }

  get chapter() {
    return this.chapters[this.ch] || null;
  }

  get complete() {
    return this.done.size >= this.chapters.length;
  }

  label() {
    if (this.complete) return 'The Legend complete';
    const c = this.chapter;
    return c ? `Chapter ${ROMAN[c.num]} · ${c.title}` : '';
  }

  serialize() {
    return { ch: this.ch, step: this.run?.index ?? 0, done: [...this.done], flags: this.flags };
  }

  /** A journey's story (or none: begin at Chapter I). Older journeys: lit flames count as chapters done. */
  restore(saved, litFlames = []) {
    this.stopRun();
    this.done = new Set(saved?.done || []);
    this.flags = saved?.flags || {};
    for (const c of this.chapters) if (litFlames.includes(c.flame)) this.done.add(c.id);
    this.ch = this.chapters.findIndex((c) => !this.done.has(c.id));
    if (this.ch < 0) this.ch = this.chapters.length;
    const step = saved && saved.ch === this.ch ? saved.step || 0 : 0;
    // resume at the start of a step that can be resumed (an earlier one if it set things up)
    if (this.chapter) this.begin(this.ch, this.chapter.steps[step]?.resumeFrom ?? step, true);
    this.refreshHud();
  }

  /** Can this flame be lit now? Only when its chapter has come to it (or the tale is told). */
  canLight(flameId) {
    const c = this.chapters.find((x) => x.flame === flameId);
    if (!c || this.done.has(c.id) || this.g.testSession && this.flags.freeFlames) return true;
    return this.run?.chapter === c && this.run.def.lightFlame;
  }

  // ------------------------------------------------------------- flow
  begin(chIndex, step = 0, quiet = false) {
    this.stopRun();
    this.ch = chIndex;
    const c = this.chapter;
    if (!c) return;
    if (!quiet && step === 0) {
      this.g.ui.chapterCard(ROMAN[c.num], c.title, c.legend);
      this.g.audio.play('title-shimmer', { volume: 0.7 });
    }
    this.start(c, step);
  }

  /** The chapter's title card (after the opening cinematic, on Continue). */
  showCard() {
    const c = this.chapter;
    if (c) {
      this.g.ui.chapterCard(ROMAN[c.num], c.title, c.legend);
      this.g.audio.play('title-shimmer', { volume: 0.7 });
    }
    if (c?.voices) this.g.preloadVoices(c.voices);
  }

  start(chapter, index) {
    const run = new StepRun(this, chapter, index);
    this.run = run;
    this.text = run.def.text;
    run.def.start?.(run);
    this.refreshHud();
    this.g.save();
  }

  advance(run) {
    if (run !== this.run) return;
    this.stopRun();
    const c = run.chapter;
    if (run.index + 1 < c.steps.length) return this.start(c, run.index + 1);
    // the chapter is done
    this.done.add(c.id);
    c.reward?.apply?.(this.g);
    this.g.ui.toast(`Chapter ${ROMAN[c.num]} complete`, c.reward?.note || c.title, 6);
    this.g.audio.play('bell', { volume: 0.4 });
    this.ch = this.chapters.findIndex((x) => !this.done.has(x.id));
    if (this.ch < 0) {
      this.ch = this.chapters.length;
      this.run = null;
      this.refreshHud();
      this.g.save();
      return;
    }
    this.g.after(6, () => this.chapter && !this.run && this.begin(this.ch));
    this.run = null;
    this.refreshHud();
    this.g.save();
  }

  stopRun() {
    const r = this.run;
    if (!r) return;
    r.def.stop?.(r);
    for (const a of r.actors) this.g.crowd?.removeActor(a);
    r.actors = [];
    this.run = null;
  }

  /** Test menu: drop into chapter `ci`, step `si`, with whatever the step needs prepared. */
  async jump(ci, si) {
    this.stopRun();
    if (this.cut) this.endScene();
    const c = this.chapters[ci];
    // earlier chapters count as done (their flames lit, their rewards given)
    this.done = new Set(this.chapters.slice(0, ci).map((x) => x.id));
    for (const x of this.chapters.slice(0, ci)) {
      this.g.quest.lightFlame(x.flame, true);
      x.reward?.apply?.(this.g);
    }
    for (let k = 0; k < si; k++) await c.steps[k].skip?.(this.g);
    await c.steps[si].prep?.(this.g);
    this.ch = ci;
    this.start(c, si);
  }

  onEvent(name, data) {
    this.run?.def.on?.(this.run, name, data);
  }

  onPlayerRevived() {
    this.run?.def.revived?.(this.run);
  }

  stopForTest() {
    this.stopRun();
    if (this.cut) this.endScene();
  }

  interaction() {
    if (this.cut || !this.run) return null;
    return this.run.def.interact?.(this.run) || null;
  }

  // ------------------------------------------------------------- cutscenes
  /**
   * A framed moment: { keys: [{ t, pos, look }] (camera path, seconds), lines: [[who, text,
   * voice?, secs?]], then(), actors? }. Lines play in turn, voiced; E / Space moves on a line,
   * Esc skips the scene. Prady can't move while it plays.
   */
  scene(def) {
    const g = this.g;
    if (this.cut) this.endScene();
    const keys = def.keys;
    this.cut = { def, i: -1, t: 0, lineT: 0, wait: 0, done: false, prevState: g.state };
    g.state = 'cutscene';
    g.ui.els.subtitle.classList.remove('show');
    g.ui.setCinematic(true);
    g.ui.setLetterbox(true);
    g.player.inputLocked = true;
    g.lockOn?.release();
    if (keys?.length) g.camRig.playCinematic(keys, () => {});
    this.nextLine();
  }

  nextLine() {
    const c = this.cut;
    if (!c) return;
    c.i++;
    const L = c.def.lines?.[c.i];
    if (!L) {
      // hold the last shot a moment, then hand back
      c.wait = 0.6;
      c.done = true;
      return;
    }
    const [who, text, voice, secs] = L;
    this.g.ui.caption(who, text);
    let dur = secs || Math.max(2.2, text.length * 0.058 + 1.2);
    if (voice) {
      const v = this.g.voice(voice);
      if (v?.duration) dur = Math.max(dur * 0.6, v.duration + 0.5);
    }
    c.lineT = dur;
    c.line = L;
    c.def.onLine?.(c.i, L);
  }

  endScene() {
    const c = this.cut;
    if (!c) return;
    const g = this.g;
    this.cut = null;
    g.camRig.cinematic = null;
    g.camRig.first = true;
    g.ui.caption(null);
    g.ui.setCinematic(false);
    g.ui.setLetterbox(false);
    g.stopVoice?.();
    g.state = 'play';
    g.player.inputLocked = false;
    c.def.then?.();
  }

  updateScene(dt, input) {
    const c = this.cut;
    if (!c) return;
    if (input.hit('Escape') || input.hit('Pad9') || input.hit('Pad1')) return this.endScene();
    if (input.hit('Space') || input.hit('Enter') || input.hit('KeyE') || input.hit('Pad0') || input.hit('Pad2')) {
      this.g.stopVoice?.();
      if (c.done) return this.endScene();
      return this.nextLine();
    }
    c.t += dt;
    if (c.done) {
      c.wait -= dt;
      const cam = this.g.camRig.cinematic;
      if (c.wait <= 0 && (!cam || cam.t >= cam.dur)) this.endScene();
      return;
    }
    c.lineT -= dt;
    if (c.lineT <= 0) this.nextLine();
  }

  // ------------------------------------------------------------- per frame
  update(dt) {
    const g = this.g;
    const r = this.run;
    if (r && !this.cut && g.state === 'play') {
      r.t += dt;
      r.marks.length = 0;
      r.def.update?.(r, dt);
      if (this.run === r) this.text = r.state.text || r.def.text;
    }
    this.refreshHud();
    this.updateCompass();
  }

  refreshHud() {
    const c = this.chapter;
    const show = !!c && !!this.run;
    this.g.ui.setStory(show ? { chapter: `Chapter ${ROMAN[c.num]}`, title: c.title, text: this.text } : this.complete ? { chapter: 'The Legend of Varanasi', title: 'All five flames burn', text: 'Kashi is yours to wander.' } : null);
  }

  updateCompass() {
    const ui = this.g.ui;
    const r = this.run;
    const list = [];
    if (r) for (const mk of r.marks) if (mk.compass) list.push({ id: `s${list.length}`, name: r.chapter.title, kind: 'story', pos: mk.pos });
    for (const mk of this.g.race?.marks || []) if (mk.compass) list.push({ id: `r${list.length}`, name: 'Nauka Daud', kind: 'story', pos: mk.pos });
    const key = list.map((m) => m.id).join('|') + (r ? `${r.chapter.id}:${r.index}` : '') + (this.g.race?.active ? `race${this.g.race.me?.next}` : '');
    if (key !== this._compassKey) {
      this._compassKey = key;
      const base = ui.compassMarks.filter((m) => m.kind !== 'story');
      ui.setCompassMarkers([...base.map(({ el, ...m }) => m), ...list]);
    } else {
      const live = ui.compassMarks.filter((m) => m.kind === 'story');
      live.forEach((m, i) => (m.pos = list[i]?.pos || m.pos));
    }
  }
}
