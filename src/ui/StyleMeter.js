// The fight's style, as the great action games keep it: a running count of blows and a rank that
// rises with variety (a new blow, a kick after a cut, a power, a parry, a perfect dodge, a counter)
// and falls with repetition, with time (it drains between blows) and hard when Prady is struck.
// Ranks: Veer · Shoor · Mahaveer · Rudra · Mahakaal. Game feeds it combat events; its rank also
// lifts the battle music (BattleMusic) a little.

const RANKS = ['Veer', 'Shoor', 'Mahaveer', 'Rudra', 'Mahakaal'];
const THRESH = [0, 120, 280, 500, 800]; // style points at each rank
const COLORS = ['#e9d8b4', '#ffcf7a', '#ffab3d', '#ff6a2a', '#ff2e4d'];

export class StyleMeter {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'style-meter';
    this.el.innerHTML = `<style>
.style-meter{position:fixed;right:22px;top:38%;transform:translateY(-50%);text-align:right;pointer-events:none;z-index:14;font-family:'Cinzel','Georgia',serif;opacity:0;transition:opacity .3s}
.style-meter.on{opacity:1}
.style-meter .n{font-size:44px;font-weight:700;color:#fff3d6;text-shadow:0 2px 0 #3a1500,0 0 12px rgba(255,140,40,.6);line-height:1}
.style-meter .n small{font-size:15px;letter-spacing:.12em;margin-left:6px;color:#e9caa0}
.style-meter .r{font-size:26px;font-weight:700;letter-spacing:.06em;margin-top:4px;text-shadow:0 2px 0 #2a0c00,0 0 14px currentColor;transition:transform .12s}
.style-meter .r.pop{transform:scale(1.25)}
.style-meter .bar{width:150px;height:4px;margin:6px 0 0 auto;background:rgba(0,0,0,.4);border-radius:2px;overflow:hidden}
.style-meter .bar i{display:block;height:100%;background:currentColor;width:0}
</style><div class="n"><b>0</b><small>HITS</small></div><div class="r">Veer</div><div class="bar"><i></i></div>`;
    document.body.appendChild(this.el);
    this.nEl = this.el.querySelector('.n b');
    this.unitEl = this.el.querySelector('.n small');
    this.rEl = this.el.querySelector('.r');
    this.barEl = this.el.querySelector('.bar i');
    this.hits = 0;
    this.points = 0;
    this.rank = 0;
    this.idle = 99;
    this.recent = [];
    this.enabled = true;
    this.shown = false;
  }

  /** A combat event: type 'hit' | 'parry' | 'counter' | 'perfectDodge' | 'power' | 'kill' | 'hurt'. */
  event(type, d = {}) {
    if (type === 'hurt') {
      // struck: the rank falls hard, the count ends
      this.points = Math.max(0, this.points * 0.4 - 40);
      this.hits = 0;
      this.idle = 0;
      this.render(true);
      return;
    }
    let pts = 0;
    if (type === 'hit') {
      this.hits++;
      const key = d.move || 'hit';
      // variety: a blow not among the last three scores in full, a repeat ever less
      const rep = this.recent.filter((k) => k === key).length;
      pts = 14 * (rep === 0 ? 1.6 : rep === 1 ? 1 : rep === 2 ? 0.5 : 0.2);
      if (d.heavy) pts += 12;
      if (d.kick) pts += 8;
      if (d.final) pts += 15;
      if (d.riposte) pts += 25;
      if (d.charged) pts += 18;
      if (d.killed) pts += 30;
      this.recent.push(key);
      if (this.recent.length > 3) this.recent.shift();
    } else if (type === 'parry') pts = 40;
    else if (type === 'counter') pts = 45 * (d.n || 1);
    else if (type === 'perfectDodge') pts = 35;
    else if (type === 'power') pts = 50;
    else if (type === 'kill') pts = 30;
    // (higher ranks are harder to climb)
    this.points += pts * (1 - this.rank * 0.12);
    this.idle = 0;
    this.render();
  }

  update(dt, inCombat) {
    this.idle += dt;
    // drains between blows, faster the higher it stands; the count ends after a pause
    if (this.idle > 1.2) this.points = Math.max(0, this.points - dt * (25 + this.rank * 22));
    if (this.idle > 3.2) this.hits = 0;
    const show = this.enabled && inCombat && (this.hits > 1 || this.points > 30);
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('on', show);
    }
    if (this.shown) this.render();
  }

  render(force = false) {
    let r = 0;
    while (r < RANKS.length - 1 && this.points >= THRESH[r + 1]) r++;
    if (r !== this.rank || force) {
      if (r > this.rank) {
        this.rEl.classList.add('pop');
        setTimeout(() => this.rEl.classList.remove('pop'), 140);
      }
      this.rank = r;
      this.rEl.textContent = RANKS[r];
      this.el.style.color = COLORS[r];
      this.rEl.style.color = COLORS[r];
    }
    this.nEl.textContent = String(this.hits);
    this.unitEl.textContent = this.hits === 1 ? 'HIT' : 'HITS';
    const lo = THRESH[r];
    const hi = THRESH[r + 1] ?? THRESH[r] + 300;
    this.barEl.style.width = `${Math.min(100, ((this.points - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  }

  /** 0 .. 1: how high the fight's style stands (the music listens). */
  get level() {
    return Math.min(1, this.points / THRESH[THRESH.length - 1]);
  }
}
