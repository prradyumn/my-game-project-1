import { ARTS } from '../gameplay/Combat.js';

// The string being played, top right (as the action games show it): a row of mouse glyphs, one
// per press (left button lit for a light blow, right for a heavy), and when the presses make an art
// its name over them (Vayu Chakra · Wheel of Wind), popping in. Fades a moment after the last.

const MOUSE = (side) => `<svg viewBox="0 0 20 28" width="18" height="25" aria-hidden="true">
<rect x="1.5" y="1.5" width="17" height="25" rx="8.5" fill="rgba(0,0,0,.35)" stroke="#f3dcae" stroke-width="1.6"/>
<path d="${side === 'L' ? 'M10 1.5 A8.5 8.5 0 0 0 1.5 10 L1.5 12 L10 12 Z' : 'M10 1.5 A8.5 8.5 0 0 1 18.5 10 L18.5 12 L10 12 Z'}" fill="${side === 'L' ? '#ffc35a' : '#7fc8ff'}"/>
<line x1="10" y1="1.5" x2="10" y2="12" stroke="#f3dcae" stroke-width="1.2"/></svg>`;

export class ComboHUD {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'combo-hud';
    this.el.innerHTML = `<style>
.combo-hud{position:fixed;right:24px;top:calc(38% + 66px);text-align:right;pointer-events:none;z-index:14;font-family:'Cinzel','Georgia',serif;opacity:0;transition:opacity .25s}
.combo-hud.on{opacity:1}
.combo-hud .nm{font-size:27px;font-weight:700;letter-spacing:.05em;color:#fff1d2;text-shadow:0 2px 0 #2a0c00,0 0 16px rgba(255,150,40,.75);line-height:1.05;min-height:1.05em;transform-origin:100% 50%}
.combo-hud .nm.pop{animation:combo-pop .32s ease-out}
.combo-hud .sub{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#e7c999;min-height:1.2em;margin-top:2px;text-shadow:0 1px 3px #000}
.combo-hud .keys{display:flex;gap:5px;justify-content:flex-end;margin-top:7px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))}
.combo-hud .keys span{display:inline-block;animation:combo-key .18s ease-out}
.combo-hud.art .keys svg rect{stroke:#ffd27a}
@keyframes combo-pop{0%{transform:scale(1.5);opacity:0}60%{transform:scale(.95);opacity:1}100%{transform:scale(1)}}
@keyframes combo-key{0%{transform:translateY(-6px) scale(1.3);opacity:0}100%{transform:none;opacity:1}}
</style><div class="nm"></div><div class="sub"></div><div class="keys"></div>`;
    document.body.appendChild(this.el);
    this.nm = this.el.querySelector('.nm');
    this.sub = this.el.querySelector('.sub');
    this.keys = this.el.querySelector('.keys');
    this.t = 9;
    this.chainStr = '';
    this.art = null;
    this.enabled = true;
  }

  /** A press of the string: chain 'LLR', art (ARTS key, or null). */
  chain(chain, art) {
    if (!this.enabled) return;
    // the glyphs: only those added since the last (so each new one pops in, the rest stay)
    if (!chain.startsWith(this.chainStr) || this.t > 1.6) this.keys.innerHTML = '';
    for (const c of chain.slice(this.keys.children.length)) {
      const s = document.createElement('span');
      s.innerHTML = MOUSE(c);
      this.keys.appendChild(s);
    }
    this.chainStr = chain;
    if (art && art !== this.art) {
      const [name, sub] = ARTS[art] || [art, ''];
      this.nm.textContent = name;
      this.sub.textContent = sub;
      this.nm.classList.remove('pop');
      void this.nm.offsetWidth; // (restart the pop)
      this.nm.classList.add('pop');
      this.el.classList.add('art');
    } else if (!art && chain.length === 1) {
      this.nm.textContent = '';
      this.sub.textContent = '';
      this.el.classList.remove('art');
    }
    this.art = art || (chain.length === 1 ? null : this.art);
    this.t = 0;
    this.el.classList.add('on');
  }

  update(dt) {
    this.t += dt;
    const on = this.enabled && this.t < (this.art ? 2.2 : 1.4);
    if (!on && this.el.classList.contains('on')) {
      this.el.classList.remove('on');
      this.art = null;
      this.chainStr = '';
    }
  }
}
