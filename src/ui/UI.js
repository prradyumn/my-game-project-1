import { QUALITY_PRESETS } from '../config.js';
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
    };
    this.compassMarks = [];
    this.lastRegion = '';
    this.buildCompass();
  }

  // ------------------------------------------------------------- loading / title
  setLoading(p, text) {
    this.els.bar.style.width = `${Math.round(p * 100)}%`;
    if (text) this.els.loadText.textContent = text;
  }

  showTitle({ hasSave, settings, onBegin, onContinue, onQuality, onIntro }) {
    this.els.loading.classList.add('hidden');
    const intro = $('#btn-intro', this.root);
    if (intro) intro.onclick = () => onIntro?.();
    this.els.title.classList.remove('hidden');
    this.els.cont.classList.toggle('hidden', !hasSave);
    const sel = $('#title-quality', this.root);
    sel.innerHTML = Object.entries(QUALITY_PRESETS)
      .map(([k, v]) => `<option value="${k}" ${k === settings.quality ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    sel.onchange = () => onQuality(sel.value);
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
      this.els.prompt.innerHTML = `<kbd>E</kbd> ${prompt}`;
      this.els.prompt.classList.remove('hidden');
    } else this.els.prompt.classList.add('hidden');
    if (fps !== undefined) this.els.fps.textContent = fps;
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
    $('#btn-resume', p).onclick = handlers.onResume;
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
      <button id="btn-intro" type="button">Watch Gameplay</button>
    </div>
    <label class="inline">Graphics <select id="title-quality"></select></label>
    <div class="controls">
      <span><kbd>WASD</kbd> move</span><span><kbd>Mouse</kbd> look</span><span><kbd>Shift</kbd> sprint</span>
      <span><kbd>Space</kbd> jump · dive · swim up</span><span><kbd>C</kbd> dive</span><span><kbd>E</kbd> interact · boat</span>
      <span><kbd>F</kbd> float a diya</span><span><kbd>G</kbd> pranam</span><span><kbd>M</kbd> meditate</span><span><kbd>J</kbd> task</span><span><kbd>LMB</kbd> strike · <kbd>RMB</kbd> kick / heavy cut</span><span><kbd>Q</kbd> guard</span><span><kbd>R</kbd> draw talwar</span><span><kbd>X</kbd> walk</span><span><kbd>N</kbd> night / dawn</span><span><kbd>P</kbd> photo mode</span><span><kbd>Esc</kbd> menu</span>
    </div>
  </div>
</div>

<div id="hud" class="hidden">
  <div id="compass"><div class="strip"></div><div class="tick"></div></div>
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
<div id="flash"></div>
<div id="photo-hint">PHOTO MODE · mouse to orbit · [ ] time of day · C look · B focus · L letterbox · Enter save · P exit</div>
<div class="letterbox-bar top"></div><div class="letterbox-bar bottom"></div>

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
      <button id="btn-reset">New journey</button>
    </div>
  </div>
</div>
`;
