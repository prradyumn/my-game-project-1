import { FAR_BANK_V, SACRED_FLAMES, SIDDHI_PATHS, SIDDHIS } from '../config.js';
import { ACHIEVEMENTS } from '../gameplay/Achievements.js';
import { frameAtX, frameToWorld, GHAT_SEGMENTS, ghatToWorld, PROFILE_LEN } from '../world/WorldLayout.js';

// The journal (J): four pages over a paused world.
//   Map           Kashi drawn as a pilgrim's map: the river, the ghats, the havelis, the flames,
//                 the people who ask for help, the ladders to the rooftops, Prady. Drag to pan,
//                 wheel to zoom; choose a mark to track it (a marker in the world and on the
//                 compass) or, at a lit flame or an honoured shrine, to travel there.
//   Tasks         the chapter in hand, the task in hand, who is waiting to ask, what there is to do
//   Siddhis       the mandala of the three paths (Siddhis.js): offer rudraksha and embers
//   Achievements  what has been earned, on this machine
// Keyboard: Q / E or 1–4 change page, Esc or J closes. Gamepad: LB / RB, B closes.

const TABS = [
  ['map', 'Map'],
  ['tasks', 'Tasks'],
  ['siddhis', 'Siddhis'],
  ['ach', 'Achievements'],
];

export class Journal {
  constructor(game, root) {
    this.g = game;
    const el = document.createElement('div');
    el.id = 'journal';
    el.className = 'screen hidden';
    el.innerHTML = `<div class="panel">
      <nav>${TABS.map(([id, label], i) => `<button data-tab="${id}"><kbd>${i + 1}</kbd>${label}</button>`).join('')}<span class="hint">Q / E · Esc</span></nav>
      <section class="page" data-page="map"><canvas></canvas><aside><h3></h3><p></p><div class="acts"></div><div class="legend"></div></aside></section>
      <section class="page" data-page="tasks"><div class="list"></div></section>
      <section class="page" data-page="siddhis"><div class="paths"><div class="purse"></div><div class="cols"></div></div><aside><h3></h3><p></p><div class="cost"></div><div class="acts"></div></aside></section>
      <section class="page" data-page="ach"><div class="grid"></div></section>
    </div>`;
    root.appendChild(el);
    this.el = el;
    this.tab = 'map';
    for (const b of el.querySelectorAll('nav button')) b.onclick = () => this.show(b.dataset.tab);
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.view = { cx: 0, cz: 0, s: 1.6 };
    this.sel = null;
    this.bindMap();
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (i >= 0) this.show(TABS[i][0]);
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.cycle(e.code === 'KeyE' ? 1 : -1);
      if (e.code === 'Escape' || this.g.input.translate(e.code) === 'KeyJ') {
        e.preventDefault();
        this.g.closeJournal();
      }
    });
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  cycle(d) {
    const i = TABS.findIndex((t) => t[0] === this.tab);
    this.show(TABS[(i + d + TABS.length) % TABS.length][0]);
  }

  openAt(tab = 'map') {
    this.el.classList.remove('hidden');
    const P = this.g.player.position;
    this.view.cx = P.x;
    this.view.cz = P.z + 20;
    this.sel = null;
    this.show(tab);
  }

  close() {
    this.el.classList.add('hidden');
  }

  show(tab) {
    this.tab = tab;
    for (const b of this.el.querySelectorAll('nav button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const p of this.el.querySelectorAll('.page')) p.classList.toggle('on', p.dataset.page === tab);
    if (tab === 'map') this.drawMap();
    if (tab === 'tasks') this.drawTasks();
    if (tab === 'siddhis') this.drawSiddhis();
    if (tab === 'ach') this.drawAch();
    requestAnimationFrame(() => this.el.querySelector('.page.on button:not([disabled])')?.focus?.());
  }

  /** Per frame while open (the map's live marks; a gamepad pans, zooms and picks). */
  update() {
    if (!this.open || this.tab !== 'map') return;
    this.mapT = (this.mapT || 0) + 1;
    const input = this.g.input;
    const gp = input.usingPad ? input.gamepad() : null;
    this.padMode = !!gp;
    if (gp) {
      // left stick pans, the triggers zoom, X picks the mark under the cross
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const ax = dz(gp.axes[0] || 0);
      const ay = dz(gp.axes[1] || 0);
      const zoom = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
      if (ax || ay || Math.abs(zoom) > 0.1) {
        this.view.cx += (ax * 9) / this.view.s;
        this.view.cz += (ay * 9) / this.view.s;
        if (Math.abs(zoom) > 0.1) this.view.s = Math.max(0.6, Math.min(9, this.view.s * (1 + zoom * 0.04)));
        this.drawMap();
      }
      if (input.hit('Pad2')) {
        const r = this.canvas.getBoundingClientRect();
        this.pick({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      }
    }
    if (this.mapT % 6 === 0) this.drawMap();
  }

  // ------------------------------------------------------------ the map
  bindMap() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      this.view.cx = drag.cx - dx / this.view.s;
      this.view.cz = drag.cz - dy / this.view.s;
      this.drawMap();
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.pick(e);
      drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const mx = e.clientX - r.left - r.width / 2;
        const my = e.clientY - r.top - r.height / 2;
        const wx = this.view.cx + mx / this.view.s;
        const wz = this.view.cz + my / this.view.s;
        this.view.s = Math.max(0.6, Math.min(9, this.view.s * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        this.view.cx = wx - mx / this.view.s;
        this.view.cz = wz - my / this.view.s;
        this.drawMap();
      },
      { passive: false }
    );
  }

  /** Everything the map marks: [{ kind, x, z, name, text, travel?, track? }] */
  marks() {
    const g = this.g;
    const out = [];
    for (const f of g.quest.flames) {
      const def = SACRED_FLAMES.find((d) => d.id === f.id);
      out.push({ kind: f.lit ? 'flame' : 'flameDark', x: f.pos.x, z: f.pos.z, y: f.pos.y, name: f.name, text: f.lit ? `${def?.lore || ''} Lit: you can travel here.` : 'Dark still. Its chapter will bring you here.', travel: f.lit ? { x: f.pos.x + 2.5, z: f.pos.z, label: f.name } : null });
    }
    for (const s of g.world.galis.shrines) {
      if (!g.worldState.shrines.has(s.id)) continue;
      out.push({ kind: 'shrine', x: s.x, z: s.z, y: s.y, name: 'A hidden shrine', text: 'You offered a pranam here. You can travel here.', travel: { x: s.x, z: s.z, label: 'a hidden shrine in the galis', y: s.y } });
    }
    const M = g.missions;
    if (!M.active) {
      for (const def of M.defs) {
        const a = M.givers.get(def.id);
        if (!a || !M.available(def)) continue;
        out.push({ kind: 'giver', x: a.x, z: a.z, y: a.y, name: def.giver.name, text: `${def.title}. Waiting to ask for help${def.giver.hours ? ` (${fmtH(def.giver.hours[0])}–${fmtH(def.giver.hours[1])})` : ''}.` });
      }
    }
    for (const mk of M.active?.marks || []) if (mk.compass) out.push({ kind: 'task', x: mk.pos.x, z: mk.pos.z, y: mk.pos.y, name: M.active.def.title, text: M.active.text });
    for (const mk of g.story?.run?.marks || []) if (mk.kind === 'objective' || mk.compass) out.push({ kind: 'story', x: mk.pos.x, z: mk.pos.z, y: mk.pos.y, name: g.story.label(), text: g.story.text });
    for (const mk of g.worldEvents?.marks || []) out.push({ kind: 'event', x: mk.pos.x, z: mk.pos.z, y: mk.pos.y, name: g.worldEvents.cur?.title || 'A call for help', text: g.worldEvents.cur?.text || '' });
    for (const L of g.traversal?.ladders || []) if (!L.roof) out.push({ kind: 'ladder', x: L.wall.x + L.out.x, z: L.wall.z + L.out.z, y: L.y0, name: 'A bamboo ladder', text: 'Up to the rooftops.' });
    const st = g.race?.startAt;
    if (st) out.push({ kind: 'race', x: st.x, z: st.z, y: 0, name: 'Nauka Daud', text: 'The boat race: row up to the start banner (mornings).' });
    out.push({ kind: 'boat', x: g.boat.x, z: g.boat.z, y: 0, name: 'Your boat', text: '' });
    if (g.kitchen?.pos) out.push({ kind: 'place', x: g.kitchen.pos.x, z: g.kitchen.pos.z, y: g.kitchen.pos.y, name: 'Amma’s kitchen', text: 'Kedar Ghat.' });
    if (g.world.akhara?.center) out.push({ kind: 'place', x: g.world.akhara.center.x, z: g.world.akhara.center.z, y: 10.5, name: 'Tulsi Akhara', text: 'The wrestlers’ ground, and the guru with the talwar.' });
    if (g.bhairav?.lot || g.world.layout.bhairav) {
      const b = g.world.layout.bhairav;
      out.push({ kind: 'place', x: b.x, z: b.z, y: 10.5, name: 'Kaal Bhairav Mandir', text: 'The Kotwal of Kashi keeps his watch here.' });
    }
    if (g.ramnagar?.center) out.push({ kind: 'place', x: g.ramnagar.center.x, z: g.ramnagar.center.z, y: 0, name: 'Ramnagar Fort', text: 'Across the river, upstream.' });
    return out;
  }

  toScreen(x, z) {
    const r = this.box;
    return [(x - this.view.cx) * this.view.s + r.w / 2, (z - this.view.cz) * this.view.s + r.h / 2];
  }

  drawMap() {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    this.box = { w: rect.width, h: rect.height };
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = (x, z) => this.toScreen(x, z);
    const s = this.view.s;
    // parchment
    const bg = ctx.createRadialGradient(rect.width / 2, rect.height / 2, 50, rect.width / 2, rect.height / 2, rect.width * 0.75);
    bg.addColorStop(0, '#ecdcb9');
    bg.addColorStop(1, '#c9b083');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    // the river: from the waterline to the far bank, the sand beyond
    const band = (v0, v1, fill) => {
      ctx.beginPath();
      for (let x = -480; x <= 480; x += 12) {
        const p = frameToWorld(frameAtX(x), 0, v0);
        const [sx, sy] = S(p.x, p.z);
        x === -480 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      for (let x = 480; x >= -480; x -= 12) {
        const p = frameToWorld(frameAtX(x), 0, v1);
        const [sx, sy] = S(p.x, p.z);
        ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    band(PROFILE_LEN - 6, FAR_BANK_V, '#8fb3ad');
    band(FAR_BANK_V, FAR_BANK_V + 140, '#e3cc98');
    // the current: faint lines along the river
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    for (let v = PROFILE_LEN + 20; v < FAR_BANK_V; v += 40) {
      ctx.beginPath();
      for (let x = -480; x <= 480; x += 16) {
        const p = frameToWorld(frameAtX(x), 0, v + Math.sin(x * 0.03 + v) * 4);
        const [sx, sy] = S(p.x, p.z);
        x === -480 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    // the ghats: stone down to the water, step lines across
    for (const gh of GHAT_SEGMENTS) {
      const q = [ghatToWorld(gh, 0, 0), ghatToWorld(gh, gh.width, 0), ghatToWorld(gh, gh.width, PROFILE_LEN - 6), ghatToWorld(gh, 0, PROFILE_LEN - 6)].map((p) => S(p.x, p.z));
      ctx.beginPath();
      q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = '#d6bd92';
      ctx.fill();
      ctx.strokeStyle = 'rgba(110, 80, 50, 0.25)';
      if (s > 1.2) {
        for (let v = 4; v < PROFILE_LEN - 6; v += s > 3 ? 0.9 : 2.7) {
          const a = S(...xz(ghatToWorld(gh, 0, v)));
          const b = S(...xz(ghatToWorld(gh, gh.width, v)));
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(90, 60, 30, 0.6)';
      ctx.beginPath();
      q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
    }
    // the havelis
    ctx.lineWidth = 1;
    for (const b of this.g.world.layout.buildings) {
      const c0 = Math.cos(b.yaw);
      const s0 = Math.sin(b.yaw);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, w]) => S(b.x + ((u * b.w) / 2) * c0 + ((w * b.d) / 2) * s0, b.z - ((u * b.w) / 2) * s0 + ((w * b.d) / 2) * c0));
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = b.kind === 'palace' || b.kind === 'fort' ? '#b48a5c' : '#c49a68';
      ctx.fill();
      ctx.strokeStyle = 'rgba(80, 50, 25, 0.55)';
      ctx.stroke();
    }
    for (const t of this.g.world.layout.temples) {
      const [x, y] = S(t.x, t.z);
      ctx.fillStyle = '#a8401c';
      ctx.beginPath();
      ctx.moveTo(x, y - t.size * s * 0.6);
      ctx.lineTo(x + t.size * s * 0.45, y + t.size * s * 0.4);
      ctx.lineTo(x - t.size * s * 0.45, y + t.size * s * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    // names
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(60, 35, 15, 0.85)';
    ctx.font = `600 ${Math.max(10, Math.min(15, 6 + s * 3))}px Cinzel, Georgia, serif`;
    for (const gh of GHAT_SEGMENTS) {
      const p = ghatToWorld(gh, gh.width / 2, PROFILE_LEN + 6);
      const [x, y] = S(p.x, p.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(gh.T.z, gh.T.x));
      ctx.fillText(gh.name.replace(' Ghat', ''), 0, 0);
      ctx.restore();
    }
    ctx.font = `italic ${Math.max(14, Math.min(26, 8 + s * 6))}px Marcellus, Georgia, serif`;
    ctx.fillStyle = 'rgba(30, 60, 70, 0.6)';
    {
      const p = frameToWorld(frameAtX(this.view.cx), 0, (PROFILE_LEN + FAR_BANK_V) / 2);
      const [x, y] = S(p.x, p.z);
      ctx.fillText('Mother Ganga', x, y);
    }
    // the marks
    this.mk = this.marks();
    const icon = { flame: '#ff8a2a', flameDark: '#5a4630', shrine: '#d0507a', giver: '#ffb03a', task: '#3d8fd6', story: '#ff7a1a', event: '#e0432a', ladder: '#6b4a25', race: '#c0392b', boat: '#2f7fb5', place: '#7a4a1e' };
    const T = this.g.tracker;
    for (const m of this.mk) {
      const [x, y] = S(m.x, m.z);
      if (x < -20 || y < -20 || x > rect.width + 20 || y > rect.height + 20) continue;
      ctx.save();
      ctx.translate(x, y);
      const sel = this.sel && this.sel.kind === m.kind && this.sel.name === m.name && Math.abs(this.sel.x - m.x) < 0.5;
      const r = m.kind === 'ladder' ? 4 : m.kind === 'place' || m.kind === 'race' ? 6 : 8;
      if (m.kind === 'flame' || m.kind === 'flameDark') {
        ctx.fillStyle = icon[m.kind];
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.quadraticCurveTo(7, -2, 0, 6);
        ctx.quadraticCurveTo(-7, -2, 0, -11);
        ctx.fill();
        if (m.kind === 'flame') {
          ctx.shadowColor = '#ffb03a';
          ctx.shadowBlur = 12;
          ctx.fill();
        }
      } else if (m.kind === 'task' || m.kind === 'story' || m.kind === 'event') {
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = icon[m.kind];
        ctx.fillRect(-6, -6, 12, 12);
        ctx.strokeStyle = '#fff6e0';
        ctx.strokeRect(-6, -6, 12, 12);
      } else if (m.kind === 'ladder') {
        ctx.strokeStyle = icon.ladder;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-3, -6, 6, 12);
        for (let k = -3; k <= 3; k += 3) {
          ctx.beginPath();
          ctx.moveTo(-3, k);
          ctx.lineTo(3, k);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = icon[m.kind] || '#444';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff6e0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
      if (sel || (T && Math.abs(T.x - m.x) < 0.5 && Math.abs(T.z - m.z) < 0.5)) {
        ctx.strokeStyle = sel ? '#1c1208' : '#e8a020';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Prady: an arrow the way he faces
    {
      const P = this.g.player.position;
      const [x, y] = S(P.x, P.z);
      const yaw = this.g.player.yaw;
      ctx.save();
      ctx.translate(x, y);
      // (facing (sin yaw, cos yaw) in x, z; the map draws +x right and +z down)
      ctx.rotate(Math.atan2(Math.cos(yaw), Math.sin(yaw)));
      ctx.fillStyle = '#fff3da';
      ctx.strokeStyle = '#5a1e00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-7, 7);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-7, -7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // the compass rose
    ctx.save();
    ctx.translate(rect.width - 46, 46);
    ctx.strokeStyle = 'rgba(60, 35, 15, 0.7)';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
    // north is downstream (+x): the Ganga flows north past Kashi
    ctx.fillStyle = 'rgba(60, 35, 15, 0.85)';
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 11px Cinzel, Georgia, serif';
    ctx.fillText('N', 31, 4);
    ctx.restore();
    // (with a gamepad: the cross that X picks under)
    if (this.padMode) {
      ctx.strokeStyle = 'rgba(40, 20, 5, 0.8)';
      ctx.lineWidth = 2;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.moveTo(cx - 16, cy);
      ctx.lineTo(cx - 6, cy);
      ctx.moveTo(cx + 6, cy);
      ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx, cy - 6);
      ctx.moveTo(cx, cy + 6);
      ctx.lineTo(cx, cy + 16);
      ctx.stroke();
    }
    this.legend();
  }

  legend() {
    const L = this.el.querySelector('.page[data-page="map"] .legend');
    if (L.dataset.done) return;
    L.dataset.done = '1';
    L.innerHTML = [
      ['flame', 'A sacred flame (travel when lit)'],
      ['shrine', 'A hidden shrine you honoured (travel)'],
      ['giver', 'Someone who needs help'],
      ['story', 'The chapter'],
      ['task', 'The task in hand'],
      ['event', 'A call for help'],
      ['ladder', 'A ladder to the rooftops'],
    ]
      .map(([k, t]) => `<span class="lg ${k}"></span>${t}`)
      .join('<br>');
  }

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = null;
    let bd = this.padMode ? 26 : 16;
    for (const m of this.mk || []) {
      const [x, y] = this.toScreen(m.x, m.z);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    this.sel = best;
    this.aside();
    this.drawMap();
  }

  aside() {
    const A = this.el.querySelector('.page[data-page="map"] aside');
    const m = this.sel;
    A.querySelector('h3').textContent = m ? m.name : 'Kashi';
    A.querySelector('p').textContent = m ? m.text : 'Choose a mark on the map: track it, or travel to a lit flame or a shrine you have honoured. Drag to look around, the wheel to zoom.';
    const acts = A.querySelector('.acts');
    acts.innerHTML = '';
    if (!m) return;
    const g = this.g;
    const btn = (label, fn, primary = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = fn;
      acts.appendChild(b);
    };
    const T = g.tracker;
    if (T && Math.abs(T.x - m.x) < 0.5 && Math.abs(T.z - m.z) < 0.5) btn('Stop tracking', () => (g.setTracker(null), this.aside(), this.drawMap()));
    else if (m.kind !== 'boat') btn('Track', () => (g.setTracker({ label: m.name, x: m.x, y: m.y ?? 0, z: m.z }), this.aside(), this.drawMap()), true);
    if (m.travel) btn('Travel here', () => g.fastTravel(m.travel));
  }

  // ------------------------------------------------------------ tasks
  drawTasks() {
    const g = this.g;
    const L = this.el.querySelector('.page[data-page="tasks"] .list');
    const sec = (title, rows) => `<h3>${title}</h3>${rows.join('') || '<p class="none">Nothing here now.</p>'}`;
    const row = (name, text, act = '') => `<div class="row"><div><b>${name}</b><small>${text}</small></div>${act}</div>`;
    const M = g.missions;
    const story = g.story?.complete ? [row('The Legend of Varanasi', 'Every chapter told. Kashi is yours to wander.')] : [row(g.story?.label() || 'The story', g.story?.text || '')];
    const task = M.active ? [row(M.active.def.title, M.active.text, '<button data-act="aside">Set aside</button>')] : [];
    const givers = M.defs.filter((d) => !M.done.has(d.id) && !(M.active?.def === d)).map((d) => {
      const a = M.givers.get(d.id);
      const at = d.giver.at();
      return row(`${d.giver.name}: ${d.title}`, `${M.available(d) ? 'Waiting now' : d.giver.hours ? `Comes ${fmtH(d.giver.hours[0])}–${fmtH(d.giver.hours[1])}` : 'Not now'}`, `<button data-track="${at.x.toFixed(1)},${(a?.y ?? at.y).toFixed(1)},${at.z.toFixed(1)}" data-label="${d.giver.name}">Track</button>`);
    });
    const done = M.defs.filter((d) => M.done.has(d.id)).map((d) => row(d.title, 'Done'));
    const ev = g.worldEvents?.cur ? [row(g.worldEvents.cur.title, g.worldEvents.cur.text || '')] : [];
    const shrines = g.world.galis.shrines.length;
    const collect = [
      row('Rudraksha', `${g.quest.collected} of 108 found · ${g.siddhis.beads} in hand to offer`),
      row('Embers', `${g.siddhis.embers} in hand (${g.siddhis.embersTotal} gathered)`),
      row('Hidden shrines', `${g.worldState.shrines.size} of ${shrines} honoured`),
      row('Sacred flames', `${g.quest.litCount} of 5 burning`),
      row('Punya', `${M.punya}`),
    ];
    L.innerHTML = sec('The chapter', story) + sec('The task in hand', task.concat(ev)) + sec('People who need help', givers) + sec('Kashi gathered', collect) + (done.length ? sec('Helped', done) : '');
    for (const b of L.querySelectorAll('button[data-track]')) {
      b.onclick = () => {
        const [x, y, z] = b.dataset.track.split(',').map(Number);
        g.setTracker({ label: b.dataset.label, x, y, z });
        this.show('map');
      };
    }
    const aside = L.querySelector('button[data-act="aside"]');
    if (aside) aside.onclick = () => (M.active.fail('Set aside. Its giver will be waiting at the same place.'), this.drawTasks());
  }

  // ------------------------------------------------------------ siddhis
  drawSiddhis() {
    const g = this.g;
    const S = g.siddhis;
    const page = this.el.querySelector('.page[data-page="siddhis"]');
    page.querySelector('.purse').innerHTML = `<span><i class="rud"></i><b>${S.beads}</b> rudraksha to offer</span><span><i class="emb"></i><b>${S.embers}</b> embers</span><small>Rudraksha are found in the world; embers are what a slain Asura leaves. Each siddhi needs the one above it.</small>`;
    const cols = page.querySelector('.cols');
    cols.innerHTML = '';
    for (const [path, P] of Object.entries(SIDDHI_PATHS)) {
      const col = document.createElement('div');
      col.className = 'col';
      col.style.setProperty('--c', P.color);
      col.innerHTML = `<h4>${P.name}</h4>`;
      SIDDHIS.filter((x) => x.path === path).forEach((x, i) => {
        const st = S.status(x.id);
        const b = document.createElement('button');
        b.className = `card ${st}`;
        b.dataset.id = x.id;
        b.innerHTML = `<i>${['I', 'II', 'III', 'IV'][i]}</i><span><b>${x.name}</b><small>${st === 'owned' ? 'Earned' : st === 'locked' ? 'Needs the one above' : `${x.beads} rudraksha · ${x.embers} embers`}</small></span>`;
        b.onclick = () => this.siddhiAside(x.id);
        b.onfocus = () => this.siddhiAside(x.id);
        col.appendChild(b);
      });
      cols.appendChild(col);
    }
    this.siddhiAside(this.selSiddhi || SIDDHIS.find((x) => S.status(x.id) === 'ready')?.id || SIDDHIS[0].id);
  }

  siddhiAside(id) {
    this.selSiddhi = id;
    const g = this.g;
    const S = g.siddhis;
    const s = SIDDHIS.find((x) => x.id === id);
    const A = this.el.querySelector('.page[data-page="siddhis"] aside');
    const st = S.status(id);
    A.querySelector('h3').textContent = s.name;
    A.querySelector('p').textContent = s.text;
    const prev = S.before(s);
    A.querySelector('.cost').innerHTML =
      st === 'owned'
        ? '<em>Earned</em>'
        : `<span class="${S.beads >= s.beads ? '' : 'short'}">${s.beads} rudraksha</span> · <span class="${S.embers >= s.embers ? '' : 'short'}">${s.embers} embers</span>${st === 'locked' ? `<br><em>First: ${prev.name}</em>` : ''}`;
    const acts = A.querySelector('.acts');
    acts.innerHTML = '';
    if (st !== 'owned') {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = 'Offer';
      b.disabled = st !== 'ready';
      b.onclick = () => {
        if (S.buy(id)) this.drawSiddhis();
      };
      acts.appendChild(b);
    }
    for (const n of this.el.querySelectorAll('.paths .card')) n.classList.toggle('sel', n.dataset.id === id);
  }

  // ------------------------------------------------------------ achievements
  drawAch() {
    const A = this.g.achievements;
    const grid = this.el.querySelector('.page[data-page="ach"] .grid');
    const n = ACHIEVEMENTS.filter((a) => A.has(a.id)).length;
    grid.innerHTML =
      `<h3>${n} of ${ACHIEVEMENTS.length} earned</h3>` +
      ACHIEVEMENTS.map((a) => {
        const got = A.has(a.id);
        const prog = !got && a.goal ? ` · ${Math.min(a.goal, A.progress(a.id))} / ${a.goal}` : '';
        return `<div class="ach ${got ? 'got' : ''}"><i></i><div><b>${a.name}</b><small>${a.text}${prog}${got ? ` · ${new Date(A.got[a.id]).toLocaleDateString()}` : ''}</small></div></div>`;
      }).join('');
  }
}

const xz = (p) => [p.x, p.z];
function fmtH(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
