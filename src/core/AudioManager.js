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
  // A recorded file of the same name wins; the synth is then only its fallback.
  synth(name, fn) {
    this.synths = this.synths || {};
    this.synths[name] = fn;
    const ctx = this.ctx || (this._prep && this._ctx);
    if (ctx && !this.buffers[name] && !this.raw[name]) this.buffers[name] = fn(ctx);
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
        if (this.buffers[name]) continue; // (decoded from a recording)
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

  /** Fetch + decode a buffer on demand (battle music: not needed at the title). Cached promise. */
  fetchBuffer(name, url) {
    this.fetching = this.fetching || {};
    if (this.buffers[name]) return Promise.resolve(this.buffers[name]);
    if (!this.fetching[name]) {
      const ctx = this.ctx || this._ctx;
      this.fetching[name] = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab && ctx ? ctx.decodeAudioData(ab) : null))
        .then((b) => (b ? (this.buffers[name] = b) : null))
        .catch(() => null);
    }
    return this.fetching[name];
  }

  // ---------------------------------------------------------------- voiced lines (loaded per chapter)
  /** Fetch + decode a line (cached). Returns a promise of the buffer (null if missing). */
  loadVoice(url) {
    this.voices = this.voices || new Map();
    if (!this.voices.has(url)) {
      const ctx = this.ctx || this._ctx;
      const p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab && ctx ? ctx.decodeAudioData(ab) : null))
        .catch(() => null);
      p.then((b) => (p.buffer = b));
      this.voices.set(url, p);
    }
    return this.voices.get(url);
  }

  /** Speak a line now (stops the last one). Returns { duration } if it was ready, else null. */
  speak(url) {
    this.stopVoice();
    const p = this.loadVoice(url);
    if (!this.ctx) return null;
    const play = (buf) => {
      if (!buf || this._wantVoice !== url) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.buses.voice);
      src.start();
      this.duck(buf.duration);
      this._voiceSrc = src;
    };
    this._wantVoice = url;
    if (p.buffer) {
      play(p.buffer);
      return { duration: p.buffer.duration };
    }
    p.then(play);
    return null;
  }

  stopVoice() {
    this._wantVoice = null;
    try {
      this._voiceSrc?.stop();
    } catch {
      /* already ended */
    }
    this._voiceSrc = null;
  }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    if (this.buses?.[bus]) this.buses[bus].gain.setTargetAtTime(v, (this.ctx || this._ctx).currentTime, 0.1);
  }

  setUnderwater(on) {
    this.under = on;
    this.applyFilter(0.12);
  }

  /** Slow motion's hush: 0 clear .. 1 heavily muffled (combined with being under water). */
  setMuffle(k) {
    if (Math.abs((this.muffle || 0) - k) < 0.01) return;
    this.muffle = k;
    this.applyFilter(0.08);
  }

  applyFilter(tc) {
    if (!this.ctx) return;
    const f = this.under ? 650 : 20000 * Math.pow(1100 / 20000, this.muffle || 0);
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, tc);
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

  /**
   * A piece played once from `offset` seconds (a music cue): a handle to fade it, stop it and know
   * when it has ended. null before unlock or when the buffer isn't loaded yet.
   */
  cue(name, opts = {}) {
    if (!this.ctx || !this.buffers[name]) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[name];
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g).connect(this.buses[opts.channel || 'music']);
    const offset = Math.min(opts.offset ?? 0, src.buffer.duration - 0.05);
    src.start(0, offset);
    const handle = {
      name,
      ended: false,
      left: () => (handle.ended ? 0 : src.buffer.duration - offset - (ctx.currentTime - t0)),
      setVolume: (v, tc = 0.4) => g.gain.setTargetAtTime(v, ctx.currentTime, tc),
      stop: (fade = 0) => {
        if (handle.ended) return;
        g.gain.setTargetAtTime(0, ctx.currentTime, fade / 4 + 0.001);
        src.stop(ctx.currentTime + fade);
      },
    };
    const t0 = ctx.currentTime;
    src.onended = () => (handle.ended = true);
    return handle;
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
    // exact loop points (a file padded either side with its own wrapped audio loops gaplessly
    // whatever the decoder's priming delay)
    if (opts.loop) [src.loopStart, src.loopEnd] = opts.loop;
    const g = this.ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    let node = src.connect(g);
    let panner = null;
    if (opts.at) {
      panner = this._panner(opts.at, opts.ref ?? 10);
      node = node.connect(panner);
    }
    node.connect(this.buses[opts.channel || 'ambience']);
    src.start(0, opts.loop ? opts.loop[0] : Math.random() * src.buffer.duration);
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
      stop: (fade = 0) => {
        g.gain.setTargetAtTime(0, ctx.currentTime, fade / 4 + 0.001);
        src.stop(ctx.currentTime + fade);
        if (this.loops[name] === handle) delete this.loops[name];
      },
    };
    this.loops[name] = handle;
    return handle;
  }
}
