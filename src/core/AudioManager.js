import * as THREE from 'three';

// Web Audio mixer: music / ambience / sfx / voice buses -> underwater low-pass -> output.
// The AudioContext is made and every buffer decoded during loading (prepare); it is allowed to
// run on the first click (browser rule), and any looping track requested before that starts.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.raw = {}; // name -> ArrayBuffer (before the context exists)
    this.buffers = {};
    this.loops = {};
    this.volumes = { music: 0.45, sfx: 0.8, ambience: 0.7, voice: 1.0 };
    this.pendingLoops = [];
    this.listenerPos = new THREE.Vector3();
  }

  // A sound made in code (rain, thunder…): fn(ctx) -> AudioBuffer, built when audio unlocks.
  synth(name, fn) {
    this.synths = this.synths || {};
    this.synths[name] = fn;
    const ctx = this.ctx || (this._prep && this._ctx);
    if (ctx) this.buffers[name] = fn(ctx);
  }

  setRaw(name, arrayBuffer) {
    if (arrayBuffer) this.raw[name] = arrayBuffer;
  }

  // During loading (no click needed): make the context (it stays suspended until the first
  // click) and decode / synthesize every buffer, so pressing Begin doesn't stall on ~1.5 s of
  // decoding and noise generation.
  prepare() {
    if (this._prep) return this._prep;
    const ctx = (this._ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.master.connect(this.filter).connect(ctx.destination);
    this.buses = {};
    for (const k of ['music', 'ambience', 'sfx', 'voice']) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[k];
      g.connect(this.master);
      this.buses[k] = g;
    }
    this._prep = (async () => {
      await Promise.all(
        Object.entries(this.raw).map(async ([name, ab]) => {
          try {
            this.buffers[name] = await ctx.decodeAudioData(ab.slice(0));
          } catch (e) {
            console.warn('[audio] decode failed', name, e);
          }
        })
      );
      for (const [name, fn] of Object.entries(this.synths || {})) {
        try {
          this.buffers[name] = fn(ctx);
        } catch (e) {
          console.warn('[audio] synth failed', name, e);
        }
      }
    })();
    return this._prep;
  }

  // On the first click: let the (already prepared) context run and start the waiting loops.
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const prep = this.prepare();
    // resume inside the click (browser rule); sources started meanwhile play once it runs
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    await prep;
    this.ctx = this._ctx;
    for (const p of this.pendingLoops) this.loop(p.name, p.opts);
    this.pendingLoops = [];
  }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    if (this.buses?.[bus]) this.buses[bus].gain.setTargetAtTime(v, (this.ctx || this._ctx).currentTime, 0.1);
  }

  setUnderwater(on) {
    if (!this.ctx) return;
    this.filter.frequency.setTargetAtTime(on ? 650 : 20000, this.ctx.currentTime, 0.12);
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.getWorldPosition(this.listenerPos);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t);
      l.forwardY.setValueAtTime(f.y, t);
      l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(u.x, t);
      l.upY.setValueAtTime(u.y, t);
      l.upZ.setValueAtTime(u.z, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  _panner(at, ref = 6) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.1;
    p.maxDistance = 400;
    p.positionX ? (p.positionX.value = at.x, p.positionY.value = at.y, p.positionZ.value = at.z) : p.setPosition(at.x, at.y, at.z);
    return p;
  }

  play(name, opts = {}) {
    if (!this.ctx || !this.buffers[name]) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let node = src.connect(g);
    if (opts.at) node = node.connect(this._panner(opts.at, opts.ref));
    node.connect(this.buses[opts.channel || 'sfx']);
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
    if (opts.channel === 'voice') this.duck(src.buffer.duration + (opts.delay ?? 0));
    return src;
  }

  duck(seconds) {
    const g = this.buses.music.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.volumes.music * 0.35, t, 0.3);
    g.setTargetAtTime(this.volumes.music, t + seconds, 0.8);
  }

  // Looping track. Returns a handle; safe to call before unlock (it starts after).
  loop(name, opts = {}) {
    if (this.loops[name]) return this.loops[name];
    if (!this.ctx) {
      this.pendingLoops.push({ name, opts });
      return null;
    }
    if (!this.buffers[name]) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let node = src.connect(g);
    let panner = null;
    if (opts.at) {
      panner = this._panner(opts.at, opts.ref ?? 10);
      node = node.connect(panner);
    }
    node.connect(this.buses[opts.channel || 'ambience']);
    src.start(0, Math.random() * src.buffer.duration);
    const ctx = this.ctx;
    const handle = {
      gain: g,
      setVolume: (v, tc = 0.4) => g.gain.setTargetAtTime(v, ctx.currentTime, tc),
      setPosition: (p) => {
        if (!panner) return;
        if (panner.positionX) {
          panner.positionX.setTargetAtTime(p.x, ctx.currentTime, 0.1);
          panner.positionY.setTargetAtTime(p.y, ctx.currentTime, 0.1);
          panner.positionZ.setTargetAtTime(p.z, ctx.currentTime, 0.1);
        } else panner.setPosition(p.x, p.y, p.z);
      },
      stop: () => src.stop(),
    };
    this.loops[name] = handle;
    return handle;
  }
}
