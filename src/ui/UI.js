import { DIFFICULTY, QUALITY_PRESETS } from '../config.js';
import { wrapAngle } from '../utils/math.js';

// DOM overlay: loading, title, HUD, toasts, pause/settings, photo mode.

const $ = (sel, root = document) => root.querySelector(sel);

export class UI {
  constructor(root, { keyArt }) {
    this.root = root;
    root.innerHTML = TEMPLATE;
    if (keyArt) {
      for (const el of root.querySelectorAll('.keyart')) el.style.backgroundImage = `url("${keyArt}")`;
    }
    this.els = {
      loading: $('#loading', root),
      bar: $('#loading .bar i', root),
      loadText: $('#loading .status', root),
      title: $('#title', root),
      begin: $('#btn-begin', root),
      cont: $('#btn-continue', root),
      hud: $('#hud', root),
      objective: $('#objective ul', root),
      purity: $('#purity i', root),
      purityText: $('#purity b', root),
      clock: $('#clock', root),
      beads: $('#beads b', root),
      compass: $('#compass .strip', root),
      prompt: $('#prompt', root),
      breath: $('#breath', root),
      breathRing: $('#breath circle.fg', root),
      toasts: $('#toasts', root),
      subtitle: $('#subtitle', root),
      pause: $('#pause', root),
      fps: $('#fps', root),
      flash: $('#flash', root),
      water: $('#underwater', root),
      photo: $('#photo-hint', root),
      region: $('#region', root),
      lock: $('#lockhint', root),
      mission: $('#mission', root),
      punya: $('#punya b', root),
      dialogue: $('#dialogue', root),
      health: $('#health', root),
      healthFill: $('#health .track i', root),
      healthTrail: $('#health .track u', root),
      hurt: $('#hurt', root),
      lock: $('#lockon', root),
      bars: $('#enemybars', root),
      boss: $('#bossbar', root),
      revive: $('#revive', root),
      menu: $('#menu', root),
      story: $('#story', root),
      card: $('#chaptercard', root),
      establish: $('#establish', root),
      caption: $('#caption', root),
      rhythm: $('#rhythm', root),
      fade: $('#fadeblack', root),
      race: $('#race', root),
      stroke: $('#stroke', root),
      countdown: $('#countdown', root),
      shakti: $('#shakti', root),
      finisher: $('#finisher', root),
      thirdEye: $('#thirdeye', root),
      achievement: $('#achievement', root),
      track: $('#track', root),
    };
    this.shaktiKey = '';
    this.barPool = [];
    this.healthShown = 0;
    this.padMode = false;
    // arrows / Esc inside the journey and chapter-select lists
    window.addEventListener('keydown', (e) => {
      if (!this.menuOpen || this.listening) return;
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.code];
      if (dir) {
        e.preventDefault();
        this.navigate(dir);
      } else if (e.code === 'Escape') this.els.menu.querySelector('.close').click();
    });
    this.compassMarks = [];
    this.lastRegion = '';
    this.buildCompass();
  }

  // ------------------------------------------------------------- loading / title
  setLoading(p, text) {
    this.els.bar.style.width = `${Math.round(p * 100)}%`;
    if (text) this.els.loadText.textContent = text;
  }

  showTitle({ hasSave, settings, onBegin, onContinue, onQuality, onIntro, onLoad, onTest, onDifficulty }) {
    this.els.loading.classList.add('hidden');
    const intro = $('#btn-intro', this.root);
    if (intro) intro.onclick = () => onIntro?.();
    const load = $('#btn-load', this.root);
    load.classList.toggle('hidden', !onLoad);
    load.onclick = () => onLoad?.();
    $('#btn-test', this.root).onclick = () => onTest?.();
    this.els.title.classList.remove('hidden');
    this.els.cont.classList.toggle('hidden', !hasSave);
    const sel = $('#title-quality', this.root);
    sel.innerHTML = Object.entries(QUALITY_PRESETS)
      .map(([k, v]) => `<option value="${k}" ${k === settings.quality ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    sel.onchange = () => onQuality(sel.value);
    const dif = $('#title-difficulty', this.root);
    dif.innerHTML = Object.entries(DIFFICULTY)
      .map(([k, v]) => `<option value="${k}" ${k === settings.difficulty ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    dif.onchange = () => onDifficulty?.(dif.value);
    this.els.begin.onclick = () => onBegin();
    this.els.cont.onclick = () => onContinue();
  }

  hideTitle() {
    this.els.title.classList.add('hidden');
    this.els.hud.classList.remove('hidden');
  }

  // ------------------------------------------------------------- HUD
  buildCompass() {
    const strip = this.els.compass;
    strip.innerHTML = '';
    const dirs = [
      ['N', Math.PI / 2],
      ['E', 0],
      ['S', -Math.PI / 2],
      ['W', Math.PI],
      ['NE', Math.PI / 4],
      ['SE', -Math.PI / 4],
      ['SW', (-3 * Math.PI) / 4],
      ['NW', (3 * Math.PI) / 4],
    ];
    this.compassDirs = dirs.map(([label, ang]) => {
      const el = document.createElement('span');
      el.className = label.length === 1 ? 'dir major' : 'dir';
      el.textContent = label;
      strip.appendChild(el);
      return { el, ang };
    });
  }

  setCompassMarkers(list) {
    for (const m of this.compassMarks) m.el.remove();
    this.compassMarks = list.map((m) => {
      const el = document.createElement('span');
      el.className = `mark ${m.kind}`;
      el.title = m.name;
      this.els.compass.appendChild(el);
      return { ...m, el };
    });
  }

  updateCompass(camYaw, playerPos) {
    const place = (el, ang) => {
      const rel = wrapAngle(ang - camYaw);
      const x = 50 - (rel / (Math.PI / 2)) * 50;
      el.style.left = `${x}%`;
      el.style.opacity = Math.abs(rel) < Math.PI / 2 ? 1 : 0;
    };
    for (const d of this.compassDirs) place(d.el, d.ang);
    let nearest = null;
    let nd = Infinity;
    for (const m of this.compassMarks) {
      if (m.hidden) {
        m.el.style.opacity = 0;
        continue;
      }
      const ang = Math.atan2(m.pos.x - playerPos.x, m.pos.z - playerPos.z);
      place(m.el, ang);
      const d = Math.hypot(m.pos.x - playerPos.x, m.pos.z - playerPos.z);
      m.el.dataset.dist = '';
      if (m.kind === 'flame' && d < nd) {
        nd = d;
        nearest = m;
      }
    }
    if (nearest) nearest.el.dataset.dist = `${Math.round(nd)}m`;
  }

  setObjectives(flames, complete) {
    this.els.objective.innerHTML = flames
      .map((f) => `<li class="${f.lit ? 'done' : ''}"><span class="diya"></span>${f.name}</li>`)
      .join('') + (complete ? '<li class="done finale">Ganga’s Blessing received</li>' : '');
  }

  updateHud({ purity, clock, beads, breath, underwater, prompt, fps, lockHint }) {
    this.els.lock.classList.toggle('hidden', !lockHint);
    this.els.purity.style.width = `${Math.round(purity * 100)}%`;
    this.els.purityText.textContent = `${Math.round(purity * 100)}%`;
    this.els.clock.textContent = clock;
    this.els.beads.textContent = beads;
    const showBreath = breath < 0.999;
    this.els.breath.classList.toggle('hidden', !showBreath);
    if (showBreath) {
      const c = 2 * Math.PI * 22;
      this.els.breathRing.style.strokeDasharray = `${c}`;
      this.els.breathRing.style.strokeDashoffset = `${c * (1 - breath)}`;
      this.els.breath.classList.toggle('low', breath < 0.3);
    }
    this.els.water.classList.toggle('on', !!underwater);
    if (prompt) {
      this.els.prompt.innerHTML = `<kbd>${this.padMode ? 'X' : this.keys?.interact || 'E'}</kbd> ${prompt}`;
      this.els.prompt.classList.remove('hidden');
    } else this.els.prompt.classList.add('hidden');
    if (fps !== undefined) this.els.fps.textContent = fps;
  }

  // ------------------------------------------------------------- combat
  /** Prana (health) 0..1; shown while hurt or fighting, the white trail catches up after a hit. */
  setHealth(frac, show) {
    const el = this.els.health;
    el.classList.toggle('off', !show);
    this.els.healthFill.style.width = `${(frac * 100).toFixed(1)}%`;
    if (frac >= this.healthShown) this.healthShown = frac;
    else this.healthShown += (frac - this.healthShown) * 0.04;
    this.els.healthTrail.style.width = `${(this.healthShown * 100).toFixed(1)}%`;
    el.classList.toggle('low', frac < 0.3);
    this.els.hurt.style.setProperty('--low', frac < 0.3 ? ((0.3 - frac) / 0.3).toFixed(2) : '0');
  }

  /** A red flash at the screen's edge when a blow lands (k 0..1). */
  hurtFlash(k = 1) {
    const el = this.els.hurt;
    el.style.setProperty('--k', k.toFixed(2));
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  /** Lock-on marker at screen point {x, y} (pixels), or null to hide. */
  setLock(pt) {
    const el = this.els.lock;
    el.classList.toggle('hidden', !pt);
    if (pt) el.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
  }

  /** Small health bars over hurt enemies: [{ x, y, frac, alpha }] in pixels. */
  setEnemyBars(list) {
    const box = this.els.bars;
    while (this.barPool.length < list.length) {
      const el = document.createElement('div');
      el.className = 'ebar';
      el.innerHTML = '<i></i>';
      box.appendChild(el);
      this.barPool.push(el);
    }
    this.barPool.forEach((el, i) => {
      const b = list[i];
      if (!b) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
      el.style.opacity = b.alpha.toFixed(2);
      el.firstChild.style.width = `${(b.frac * 100).toFixed(1)}%`;
    });
  }

  /** The boss's bar at the bottom of the screen: { name, title, frac } or null. */
  setBoss(b) {
    const el = this.els.boss;
    el.classList.toggle('off', !b);
    this.root.classList.toggle('bossfight', !!b);
    if (!b) return;
    if (el.dataset.name !== b.name) {
      el.dataset.name = b.name;
      el.querySelector('h5').textContent = b.name;
      el.querySelector('small').textContent = b.title || '';
    }
    el.querySelector('.track i').style.width = `${(Math.max(0, b.frac) * 100).toFixed(1)}%`;
  }

  /**
   * The Shakti meter under the prana bar and the powers it pays for:
   * { frac, show, powers: [{ kind, ready, cost, active }], denied, eye } or null.
   */
  setShakti(st) {
    const el = this.els.shakti;
    el.classList.toggle('hidden', !st);
    if (!st) return;
    el.classList.toggle('off', !st.show);
    el.classList.toggle('denied', !!st.denied);
    const need = el.querySelector('.need');
    need.textContent = st.need ? `Needs ${st.need} Shakti · fight to fill it` : '';
    el.querySelector('.track i').style.width = `${(st.frac * 100).toFixed(1)}%`;
    const K = this.keys || {};
    const keys = { damaru: this.padMode ? 'LT+X' : K.damaru || '1', trishul: this.padMode ? 'LT+Y' : K.trishul || '2', thirdEye: this.padMode ? 'LT+B' : K.thirdEye || '3' };
    const names = { damaru: 'Damaru', trishul: 'Trishul', thirdEye: 'Third Eye' };
    const key = st.powers.map((p) => p.kind).join('|') + this.padMode + Object.values(keys).join('');
    const box = el.querySelector('.powers');
    if (key !== this.shaktiKey) {
      this.shaktiKey = key;
      box.innerHTML = st.powers.map((p) => `<span class="pw ${p.kind}"><kbd>${keys[p.kind]}</kbd>${names[p.kind]}</span>`).join('');
      // the cost ticks on the bar
      el.querySelector('.track').querySelectorAll('b').forEach((b) => b.remove());
      for (const p of st.powers) {
        const b = document.createElement('b');
        b.style.left = `${(p.cost * 100).toFixed(1)}%`;
        el.querySelector('.track').appendChild(b);
      }
    }
    st.powers.forEach((p, i) => {
      const s = box.children[i];
      if (!s) return;
      s.classList.toggle('ready', p.ready);
      s.classList.toggle('active', p.active);
    });
  }

  /** The finisher mark over an enemy that can be ended: { x, y, key } (pixels) or null. */
  setFinisherMark(pt) {
    const el = this.els.finisher;
    el.classList.toggle('hidden', !pt);
    if (!pt) return;
    el.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
    const k = el.querySelector('kbd');
    if (k.textContent !== pt.key) k.textContent = pt.key;
  }

  /** Attacks coming from off-screen: [{ x, y, rot, k }] chevrons at the screen's edge. */
  setThreats(list) {
    const box = this.root.querySelector('#threats');
    this.threatPool = this.threatPool || [];
    while (this.threatPool.length < list.length) {
      const el = document.createElement('i');
      box.appendChild(el);
      this.threatPool.push(el);
    }
    this.threatPool.forEach((el, i) => {
      const t = list[i];
      el.style.display = t ? '' : 'none';
      if (!t) return;
      el.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px) rotate(${t.rot.toFixed(2)}rad)`;
      el.style.opacity = (0.45 + t.k * 0.55).toFixed(2);
    });
  }

  setThirdEye(on) {
    this.els.thirdEye.classList.toggle('on', on);
  }

  /** An achievement earned: a banner for a few seconds (several in a row wait their turn). */
  achievement(name, text) {
    this.achQueue = this.achQueue || [];
    if (this.achBusy) return void this.achQueue.push([name, text]);
    this.achBusy = true;
    setTimeout(() => {
      this.achBusy = false;
      const next = this.achQueue.shift();
      if (next) this.achievement(...next);
    }, 5600);
    const el = this.els.achievement;
    el.querySelector('b').textContent = name;
    el.querySelector('small:not(.k)').textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** What is pinned in the journal: { label, dist } or null. */
  setTrack(t) {
    const el = this.els.track;
    el.classList.toggle('hidden', !t);
    if (!t) return;
    const s = `${t.label}${t.dist != null ? ` · ${t.dist} m` : ''}`;
    if (el.textContent !== s) el.textContent = s;
  }

  /** Accessibility: caption size, softer flashes. */
  setAccess({ subtitleSize = 1, reduceFlashes = false }) {
    this.root.style.setProperty('--sub', subtitleSize);
    this.root.classList.toggle('softflash', reduceFlashes);
  }

  // ------------------------------------------------------------- the boat race
  /** { pos, of, time, gate, gates, board: [{ name, you, done }] } or null */
  setRace(r) {
    const el = this.els.race;
    el.classList.toggle('hidden', !r);
    this.root.classList.toggle('racing', !!r);
    if (!r) return;
    const ord = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
    el.querySelector('.pos b').textContent = ord(r.pos);
    el.querySelector('.pos .of').textContent = `of ${r.of}`;
    el.querySelector('.time').textContent = r.time;
    el.querySelector('.gate').textContent = r.gate;
    const key = r.board.map((b) => `${b.name}${b.done ? '*' : ''}`).join('|');
    if (key !== el.dataset.board) {
      el.dataset.board = key;
      el.querySelector('.board').innerHTML = r.board.map((b) => `<li class="${b.you ? 'you' : ''}${b.done ? ' done' : ''}">${b.name}</li>`).join('');
    }
  }

  /** The stroke ring: { k (0..1 through the stroke), win (the catch window, fraction of the
   *  ring at its top), streak, flash: 'good' | 'miss' | null } or null */
  setStroke(st) {
    const el = this.els.stroke;
    el.classList.toggle('hidden', !st);
    if (!st) return;
    const C = 2 * Math.PI * 24;
    const fg = el.querySelector('circle.fg');
    fg.style.strokeDasharray = `${C}`;
    fg.style.strokeDashoffset = `${C * (1 - st.k)}`;
    const win = el.querySelector('circle.win');
    win.style.strokeDasharray = `${C * st.win} ${C}`;
    win.style.strokeDashoffset = `${C * st.win * 0.6}`;
    el.querySelector('.streak').textContent = st.streak > 1 ? `×${st.streak}` : '';
    if (st.flash) {
      el.classList.remove('good', 'miss');
      void el.offsetWidth;
      el.classList.add(st.flash);
    }
  }

  /** The big count before a race: '3', '2', '1', 'Chalo!' ('' hides it). */
  countdown(text) {
    const el = this.els.countdown;
    el.textContent = text;
    el.classList.remove('pop');
    if (!text) return;
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /** A plain fade to black and back (a boatman rowing you across, time passing). */
  fadeBlack(on) {
    this.els.fade.classList.toggle('on', on);
  }

  /** Mother Ganga's grace after a fall: a golden-white fade with a line of text. */
  showRevive(on, text = '') {
    const el = this.els.revive;
    if (text) el.querySelector('p').textContent = text;
    el.classList.toggle('on', on);
  }

  // ------------------------------------------------------------- story
  /** The chapter in hand: { chapter, title, text } or null. */
  setStory(st) {
    const el = this.els.story;
    el.classList.toggle('hidden', !st);
    if (!st) return;
    const key = `${st.chapter}|${st.title}|${st.text}`;
    if (key === this._storyKey) return;
    const changed = this._storyKey && this._storyKey.split('|')[2] !== st.text;
    this._storyKey = key;
    el.querySelector('small').textContent = st.chapter;
    el.querySelector('h4').textContent = st.title;
    el.querySelector('p').textContent = st.text;
    if (changed) {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
  }

  /** A chapter opens: its number, its title and the legend behind it, over the world. */
  chapterCard(roman, title, legend) {
    const el = this.els.card;
    el.querySelector('small').textContent = `Chapter ${roman}`;
    el.querySelector('h2').textContent = title;
    el.querySelector('p').textContent = legend || '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** A place's name over its establishing shot (lower left, inside the bars), for `secs`. */
  establishTitle(small, title, line, secs = 7) {
    const el = this.els.establish;
    el.querySelector('small').textContent = small || '';
    el.querySelector('h1').textContent = title;
    el.querySelector('p').textContent = line || '';
    el.style.setProperty('--secs', `${secs}s`);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /** A line in a cutscene (speaker + words), or null to clear. */
  caption(who, text) {
    const el = this.els.caption;
    if (!who && !text) return el.classList.remove('on');
    el.querySelector('b').textContent = who || '';
    el.querySelector('span').textContent = text || '';
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  // ------------------------------------------------------------- the rhythm bar (stirring, rowing)
  /** opts: { title, hint, need, speed, zone } → call rhythmUpdate(dt, pressed) each frame. */
  rhythmStart(opts) {
    const el = this.els.rhythm;
    this.rh = { t: 0, x: 0, dir: 1, ok: 0, miss: 0, need: opts.need || 5, speed: opts.speed || 0.9, zone: opts.zone || 0.16, center: 0.5 + (Math.random() - 0.5) * 0.4, flash: 0 };
    el.querySelector('h5').textContent = opts.title || '';
    el.querySelector('small').textContent = opts.hint || '';
    el.classList.remove('hidden');
    this.rhythmDraw();
  }

  /** Returns 'done' when enough good presses, 'hit' / 'miss' on a press, else null. */
  rhythmUpdate(dt, pressed) {
    const r = this.rh;
    if (!r) return null;
    r.x += r.dir * r.speed * dt;
    if (r.x > 1) (r.x = 1), (r.dir = -1);
    if (r.x < 0) (r.x = 0), (r.dir = 1);
    let res = null;
    if (pressed) {
      if (Math.abs(r.x - r.center) < r.zone / 2) {
        r.ok++;
        res = 'hit';
        r.center = 0.15 + Math.random() * 0.7;
        r.speed *= 1.07;
      } else {
        r.miss++;
        res = 'miss';
      }
      r.flash = 1;
      r.last = res;
    }
    r.flash = Math.max(0, r.flash - dt * 3);
    this.rhythmDraw();
    if (r.ok >= r.need) {
      this.rhythmStop();
      return 'done';
    }
    return res;
  }

  rhythmDraw() {
    const r = this.rh;
    const el = this.els.rhythm;
    el.querySelector('.zone').style.left = `${((r.center - r.zone / 2) * 100).toFixed(1)}%`;
    el.querySelector('.zone').style.width = `${(r.zone * 100).toFixed(1)}%`;
    el.querySelector('.mark').style.left = `${(r.x * 100).toFixed(1)}%`;
    el.querySelector('.count').textContent = `${r.ok} / ${r.need}`;
    el.classList.toggle('good', r.flash > 0 && r.last === 'hit');
    el.classList.toggle('bad', r.flash > 0 && r.last === 'miss');
  }

  rhythmStop() {
    this.rh = null;
    this.els.rhythm.classList.add('hidden');
  }

  // ------------------------------------------------------------- missions
  /** title, text (the current step), meter 0..1 or null (a count or a timer) */
  setMission(m) {
    const el = this.els.mission;
    el.classList.toggle('hidden', !m);
    if (!m) return;
    el.querySelector('h4').textContent = m.title;
    el.querySelector('p').textContent = m.text;
    const meter = el.querySelector('.meter');
    meter.classList.toggle('hidden', m.meter == null);
    if (m.meter != null) meter.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, m.meter)) * 100)}%`;
  }

  setPunya(n) {
    this.els.punya.textContent = n;
  }

  /** A line of talk at the bottom of the screen. choices: [{ key, label }] or null (E continues). */
  showDialogue(who, line, choices = null) {
    const el = this.els.dialogue;
    this.root.classList.add('talking');
    el.classList.remove('hidden');
    el.querySelector('.who').textContent = who;
    el.querySelector('.line').textContent = line;
    el.querySelector('.next').innerHTML = choices ? choices.map((c) => `<span><kbd>${c.key}</kbd> ${c.label}</span>`).join('') : '<span><kbd>E</kbd> continue</span>';
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
  }

  hideDialogue() {
    this.els.dialogue.classList.add('hidden');
    this.root.classList.remove('talking');
  }

  showRegion(name) {
    if (!name || name === this.lastRegion) return;
    this.lastRegion = name;
    const el = this.els.region;
    el.textContent = name;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  toast(title, body = '', seconds = 5) {
    while (this.els.toasts.children.length >= 2) this.els.toasts.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<h3>${title}</h3>${body ? `<p>${body}</p>` : ''}`;
    this.els.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 800);
    }, seconds * 1000);
  }

  subtitle(text, seconds) {
    const el = this.els.subtitle;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._subT);
    this._subT = setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  flash() {
    const el = this.els.flash;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  setCinematic(on) {
    this.root.classList.toggle('cinematic', on);
  }

  setPhotoMode(on) {
    this.root.classList.toggle('photo', on);
  }

  setLetterbox(on) {
    this.root.classList.toggle('letterbox', on);
  }

  // ------------------------------------------------------------- menus (journeys, chapter select)
  /**
   * A full-screen list: { title, note, sections: [{ heading, items: [{ label, sub, onClick, disabled, tag }] }],
   * onClose }. Keyboard / gamepad: arrows move, Enter / A chooses, Esc / B closes.
   */
  openMenu(m) {
    const el = this.els.menu;
    el.classList.remove('hidden');
    el.querySelector('h2').textContent = m.title;
    el.querySelector('.note').textContent = m.note || '';
    const list = el.querySelector('.list');
    list.innerHTML = '';
    for (const sec of m.sections) {
      if (sec.heading) {
        const h = document.createElement('h3');
        h.textContent = sec.heading;
        list.appendChild(h);
      }
      const grid = document.createElement('div');
      grid.className = 'items';
      for (const it of sec.items) {
        const b = document.createElement('button');
        b.className = 'item' + (it.primary ? ' primary' : '');
        b.disabled = !!it.disabled;
        b.innerHTML = `<b>${it.label}</b>${it.sub ? `<small>${it.sub}</small>` : ''}${it.tag ? `<em>${it.tag}</em>` : ''}`;
        b.onclick = () => it.onClick?.();
        grid.appendChild(b);
      }
      list.appendChild(grid);
    }
    const close = el.querySelector('.close');
    close.onclick = () => {
      this.closeMenu();
      m.onClose?.();
    };
    this.menuOpen = m;
    list.scrollTop = 0;
    requestAnimationFrame(() => el.querySelector('button.item:not([disabled])')?.focus());
  }

  closeMenu() {
    this.els.menu.classList.add('hidden');
    this.menuOpen = null;
  }

  /** Gamepad / arrow navigation inside whatever screen is open: dir 'up'|'down'|'left'|'right'. */
  navigate(dir) {
    const screen = [this.els.menu, document.getElementById('journal'), this.els.pause, this.els.title].find((e) => e && !e.classList.contains('hidden'));
    if (!screen) return;
    const all = [...screen.querySelectorAll('button:not([disabled]):not(.hidden), select, input')].filter((b) => b.offsetParent !== null);
    if (!all.length) return;
    const cur = document.activeElement && all.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) return all[0].focus();
    // spatial: the nearest element in that direction
    const r0 = cur.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null;
    let bd = Infinity;
    for (const b of all) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - c0.x;
      const dy = c.y - c0.y;
      const ok = dir === 'down' ? dy > 4 : dir === 'up' ? dy < -4 : dir === 'right' ? dx > 4 : dx < -4;
      if (!ok) continue;
      const main = dir === 'down' || dir === 'up' ? Math.abs(dy) : Math.abs(dx);
      const side = dir === 'down' || dir === 'up' ? Math.abs(dx) : Math.abs(dy);
      const d = main + side * 2.5;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    (best || cur).focus();
    (best || cur).scrollIntoView?.({ block: 'nearest' });
  }

  activate() {
    const a = document.activeElement;
    if (a && a.tagName === 'BUTTON') a.click();
  }

  // ------------------------------------------------------------- pause / settings
  showPause(settings, handlers) {
    const p = this.els.pause;
    p.classList.remove('hidden');
    const q = $('#set-quality', p);
    q.innerHTML = Object.entries(QUALITY_PRESETS)
      .map(([k, v]) => `<option value="${k}" ${k === settings.quality ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    const bind = (id, key, type = 'range') => {
      const el = $(id, p);
      if (type === 'check') el.checked = !!settings[key];
      else el.value = settings[key];
      el.oninput = el.onchange = () => handlers.onSetting(key, type === 'check' ? el.checked : type === 'select' ? el.value : parseFloat(el.value));
    };
    bind('#set-quality', 'quality', 'select');
    bind('#set-adaptive', 'adaptiveResolution', 'check');
    bind('#set-music', 'musicVolume');
    bind('#set-sfx', 'sfxVolume');
    bind('#set-amb', 'ambienceVolume');
    bind('#set-sens', 'mouseSensitivity');
    bind('#set-invert', 'invertY', 'check');
    bind('#set-time', 'timeSpeed');
    bind('#set-weather', 'weather', 'select');
    bind('#set-fps', 'showFps', 'check');
    const dif = $('#set-difficulty', p);
    dif.innerHTML = Object.entries(DIFFICULTY)
      .map(([k, v]) => `<option value="${k}" title="${v.note}" ${k === settings.difficulty ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    bind('#set-difficulty', 'difficulty', 'select');
    bind('#set-shake', 'shake');
    bind('#set-sub', 'subtitleSize');
    bind('#set-telegraph', 'telegraph', 'select');
    bind('#set-guardtoggle', 'guardToggle', 'check');
    bind('#set-flash', 'reduceFlashes', 'check');
    bind('#set-rumble', 'rumble', 'check');
    $('#btn-resume', p).onclick = handlers.onResume;
    $('#btn-ptest', p).onclick = () => handlers.onTest?.();
    $('#btn-controls', p).onclick = () => handlers.onControls?.();
    $('#btn-journal', p).onclick = () => handlers.onJournal?.();
    for (const b of p.querySelectorAll('.timeofday button')) b.onclick = () => handlers.onTime?.(parseFloat(b.dataset.hour));
    $('#btn-reset', p).onclick = () => {
      if (confirm('Start a new journey? Lit flames and collected rudraksha will be reset.')) handlers.onReset();
    };
  }

  hidePause() {
    this.els.pause.classList.add('hidden');
  }

  setFpsVisible(on) {
    this.els.fps.classList.toggle('hidden', !on);
  }
}

const TEMPLATE = /* html */ `
<div id="loading" class="screen keyart">
  <div class="veil"></div>
  <div class="center">
    <div class="deva">वाराणसी</div>
    <div class="kicker">The Legend of</div>
    <h1 class="name">VARANASI</h1>
    <div class="bar"><i></i></div>
    <div class="status">Waking the city…</div>
  </div>
</div>

<div id="title" class="screen keyart hidden">
  <div class="veil"></div>
  <div class="title-col">
    <div class="deva">वाराणसी</div>
    <div class="kicker">The Legend of</div>
    <h1 class="name">VARANASI</h1>
    <p class="tag">The five sacred flames of the ghats have gone dark. Rekindle them and restore Mother Ganga.</p>
    <div class="buttons">
      <button id="btn-continue" class="primary hidden">Continue Journey</button>
      <button id="btn-begin" class="primary">Begin Journey</button>
      <button id="btn-load" class="hidden">Load Journey</button>
      <button id="btn-intro" type="button">Watch Gameplay</button>
      <button id="btn-test" type="button" title="Jump to any chapter or activity, no prerequisites">Chapter Select · Test</button>
    </div>
    <label class="inline">Graphics <select id="title-quality"></select></label>
    <label class="inline">Difficulty <select id="title-difficulty"></select></label>
    <div class="controls">
      <span><kbd>WASD</kbd> move</span><span><kbd>Mouse</kbd> look</span><span><kbd>Shift</kbd> sprint</span>
      <span><kbd>Space</kbd> jump · dive · swim up</span><span><kbd>C</kbd> dive</span><span><kbd>E</kbd> interact · boat</span>
      <span><kbd>F</kbd> float a diya</span><span><kbd>G</kbd> pranam</span><span><kbd>M</kbd> meditate</span><span><kbd>J</kbd> journal · map · siddhis</span><span><kbd>LMB</kbd> strike · <kbd>RMB</kbd> heavy (hold: charge)</span><span><kbd>Q</kbd> guard</span><span><kbd>E</kbd> finish a reeling Asura</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> powers</span><span><kbd>R</kbd> draw talwar</span><span><kbd>X</kbd> walk</span><span><kbd>N</kbd> night / dawn</span><span><kbd>P</kbd> photo mode</span><span><kbd>F9</kbd> screenshot</span><span><kbd>⌘</kbd> / <kbd>⌥</kbd> free the mouse</span><span><kbd>Esc</kbd> menu</span>
    </div>
  </div>
</div>

<div id="hud" class="hidden">
  <div id="compass"><div class="strip"></div><div class="tick"></div></div>
  <div id="story" class="hidden"><small></small><h4></h4><p></p></div>
  <div id="objective">
    <h4>The Five Flames of Kashi</h4>
    <ul></ul>
  </div>
  <div id="mission" class="hidden"><h4></h4><p></p><div class="meter hidden"><i></i></div></div>
  <div id="topright">
    <div id="clock">05:45</div>
    <div id="beads"><span class="rud"></span><b>0</b><small>/108</small></div>
    <div id="punya" title="Punya: merit earned by helping the people of Kashi"><span class="lotus"></span><b>0</b></div>
  </div>
  <div id="purity"><label>Ganga Purity <b>0%</b></label><div class="track"><i></i></div></div>
  <div id="health" class="off"><label>Prana</label><div class="track"><u></u><i></i></div></div>
  <div id="shakti" class="hidden off"><span class="need"></span><div class="track"><i></i></div><div class="powers"></div></div>
  <div id="threats"></div>
  <div id="track" class="hidden"></div>
  <div id="enemybars"></div>
  <div id="lockon" class="hidden"><span></span></div>
  <div id="finisher" class="hidden"><kbd>E</kbd></div>
  <div id="bossbar" class="off"><h5></h5><small></small><div class="track"><i></i></div></div>
  <div id="race" class="hidden"><h4>Nauka Daud</h4><div class="pos"><b>1st</b><span class="of">of 4</span><i class="time">0:00.0</i></div><p class="gate"></p><ol class="board"></ol></div>
  <div id="stroke" class="hidden"><svg viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="24"/><circle class="win" cx="30" cy="30" r="24"/><circle class="fg" cx="30" cy="30" r="24"/></svg><b class="streak"></b><small>Space on the catch</small></div>
  <div id="countdown"></div>
  <div id="breath" class="hidden"><svg viewBox="0 0 50 50"><circle class="bg" cx="25" cy="25" r="22"/><circle class="fg" cx="25" cy="25" r="22"/></svg><span>Breath</span></div>
  <div id="prompt" class="hidden"></div>
  <div id="dialogue" class="hidden"><div class="who"></div><div class="line"></div><div class="next"></div></div>
  <div id="toasts"></div>
  <div id="region"></div>
  <div id="subtitle"></div>
  <div id="fps" class="hidden"></div>
  <div id="lockhint" class="hidden">Click to look around with the mouse</div>
</div>

<div id="underwater"></div>
<div id="thirdeye"></div>
<div id="hurt"></div>
<div id="achievement"><i></i><div><small class="k">Achievement</small><b></b><small></small></div></div>
<div id="chaptercard"><small></small><h2></h2><p></p></div>
<div id="establish"><small></small><h1></h1><p></p></div>
<div id="caption"><b></b><span></span></div>
<div id="rhythm" class="hidden"><h5></h5><div class="bar"><i class="zone"></i><i class="mark"></i></div><div class="row"><small></small><b class="count"></b></div></div>
<div id="revive"><p></p></div>
<div id="fadeblack"></div>
<div id="flash"></div>
<div id="photo-hint">PHOTO MODE · mouse to orbit · [ ] time of day · C look · B focus · L letterbox · Enter save · P exit</div>
<div class="letterbox-bar top"></div><div class="letterbox-bar bottom"></div>

<div id="menu" class="screen hidden">
  <div class="panel">
    <h2></h2>
    <p class="note"></p>
    <div class="list"></div>
    <div class="buttons"><button class="close">Back</button></div>
  </div>
</div>

<div id="pause" class="screen hidden">
  <div class="panel">
    <h2>Paused</h2>
    <div class="grid">
      <label>Graphics quality <select id="set-quality"></select></label>
      <label class="check"><input type="checkbox" id="set-adaptive"> Adaptive resolution (keeps FPS smooth)</label>
      <label>Music <input type="range" id="set-music" min="0" max="1" step="0.05"></label>
      <label>Sound effects <input type="range" id="set-sfx" min="0" max="1" step="0.05"></label>
      <label>Ambience <input type="range" id="set-amb" min="0" max="1" step="0.05"></label>
      <label>Mouse sensitivity <input type="range" id="set-sens" min="0.3" max="2.5" step="0.05"></label>
      <label class="check"><input type="checkbox" id="set-invert"> Invert vertical look</label>
      <label>Day speed <input type="range" id="set-time" min="0" max="6" step="0.5"></label>
      <label>Weather <select id="set-weather"><option value="auto">Auto (monsoon showers)</option><option value="clear">Clear</option><option value="rain">Monsoon rain</option><option value="storm">Thunderstorm</option></select></label>
      <label class="check"><input type="checkbox" id="set-fps"> Show FPS</label>
      <label>Difficulty <select id="set-difficulty"></select></label>
      <label>Camera shake <input type="range" id="set-shake" min="0" max="1" step="0.1"></label>
      <label>Caption size <input type="range" id="set-sub" min="0.85" max="1.5" step="0.05"></label>
      <label>Warning flare <select id="set-telegraph"><option value="ember">Ember (default)</option><option value="blue">Blue (colour-blind safe)</option></select></label>
      <label class="check"><input type="checkbox" id="set-guardtoggle"> Guard toggles (tap Q) instead of hold</label>
      <label class="check"><input type="checkbox" id="set-flash"> Reduce flashes</label>
      <label class="check"><input type="checkbox" id="set-rumble"> Gamepad vibration</label>
    </div>
    <div class="timeofday">
      <span>Time of day</span>
      <button data-hour="6.6">Dawn</button><button data-hour="12">Noon</button><button data-hour="17.7">Sunset</button><button data-hour="20.4">Night</button>
    </div>
    <div class="controls small">
      <span><kbd>N</kbd> night / dawn</span><span><kbd>WASD</kbd> move</span><span><kbd>Shift</kbd> sprint</span><span><kbd>Space</kbd> jump / swim up</span><span><kbd>C</kbd> dive</span>
      <span><kbd>E</kbd> interact · board/leave boat</span><span><kbd>F</kbd> float a diya</span><span><kbd>X</kbd> toggle walk</span><span><kbd>P</kbd> photo mode</span>
    </div>
    <div class="buttons">
      <button id="btn-resume" class="primary">Resume</button>
      <button id="btn-journal">Journal</button>
      <button id="btn-controls">Controls</button>
      <button id="btn-ptest">Chapter Select · Test</button>
      <button id="btn-reset">New journey</button>
    </div>
  </div>
</div>
`;
