// Prady's health (prana). Blows take it; it flows back once the fighting stops (slowly while
// enemies are near, quickly when alone); a few moments of grace follow every hit so a pack of
// Asuras can't chain him to death. At zero he falls, and Mother Ganga brings him back.

export class Health {
  constructor(max = 100) {
    this.max = max;
    this.hp = max;
    this.time = 0;
    this.lastHurt = -99;
    this.grace = 0; // seconds of invulnerability left after a hit
    this.dead = false;
    this.invincible = false; // test menu: "Invincible"
    this.regenMul = 1; // Annapurna's prasad heals faster
    this.regenDiff = 1; // the difficulty (Story heals faster, Hard slower)
    this.onDeath = null;
    this.onChange = null;
  }

  get frac() {
    return this.hp / this.max;
  }

  /** Returns the damage actually taken. */
  damage(amount, { ignoreGrace = false } = {}) {
    if (this.dead || amount <= 0) return 0;
    if (this.grace > 0 && !ignoreGrace) return 0;
    if (this.invincible) amount = 0;
    const before = this.hp;
    this.hp = Math.max(this.invincible ? 1 : 0, this.hp - amount);
    this.lastHurt = this.time;
    this.grace = 0.45;
    this.onChange?.(this.hp, before);
    if (this.hp <= 0) {
      this.dead = true;
      this.onDeath?.();
    }
    return before - this.hp;
  }

  heal(amount) {
    if (this.dead) return;
    const before = this.hp;
    this.hp = Math.min(this.max, this.hp + amount);
    if (this.hp !== before) this.onChange?.(this.hp, before);
  }

  revive(frac = 1) {
    this.dead = false;
    this.hp = this.max * frac;
    this.grace = 2;
    this.onChange?.(this.hp, 0);
  }

  setMax(max) {
    const f = this.frac;
    this.max = max;
    this.hp = max * f;
  }

  /** inCombat: enemies are close and awake (regeneration is slow then). */
  update(dt, inCombat) {
    this.time += dt;
    this.grace = Math.max(0, this.grace - dt);
    if (this.dead || this.hp >= this.max) return;
    const since = this.time - this.lastHurt;
    if (since > (inCombat ? 6 : 3)) this.heal((inCombat ? 2.5 : 14) * this.regenMul * this.regenDiff * dt);
  }
}
