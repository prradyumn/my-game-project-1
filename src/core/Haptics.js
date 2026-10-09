// Gamepad rumble: the weight of a blow in the hands. Dual-motor effects (the strong low motor
// for impacts, the weak high one for the sting) through the browser's vibrationActuator; silent
// on a keyboard, on pads without motors, or when switched off in the settings.

const FX = {
  hit: [0.18, 0.42, 60], // a light blow lands
  heavyHit: [0.45, 0.6, 110],
  hurt: [0.55, 0.45, 160],
  hurtHeavy: [0.9, 0.6, 260],
  block: [0.3, 0.35, 90],
  parry: [0.35, 0.95, 140],
  stomp: [1.0, 0.55, 420],
  finisher: [0.85, 0.75, 240],
  damaru: [0.9, 0.5, 380],
  throw: [0.2, 0.5, 80],
  pin: [0.6, 0.4, 150],
  land: [0.4, 0.2, 110],
  shield: [0.5, 0.8, 120],
};

export class Haptics {
  constructor(input) {
    this.input = input;
    this.enabled = true;
    this.busyUntil = 0;
    this.lastStrength = 0;
  }

  /** A named effect (FX above), scaled by k. */
  play(name, k = 1) {
    const f = FX[name];
    if (f) this.pulse(f[0] * k, f[1] * k, f[2]);
  }

  pulse(strong, weak, ms) {
    if (!this.enabled || !this.input.usingPad) return;
    const a = this.input.gamepad()?.vibrationActuator;
    if (!a?.playEffect) return;
    // a weaker effect never cuts a stronger one short
    const now = performance.now();
    if (now < this.busyUntil && strong < this.lastStrength) return;
    this.busyUntil = now + ms;
    this.lastStrength = strong;
    a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
  }
}
