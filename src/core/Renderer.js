import * as THREE from 'three';
import { BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, GodRaysEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { QUALITY_PRESETS } from '../config.js';
import { clamp } from '../utils/math.js';
import { ColorGradeEffect } from './Grading.js';
import { ContactShadowEffect } from './ContactShadows.js';
import { WetReflectionEffect } from './WetReflections.js';
import { PainterlyEffect } from './Painterly.js';
import { HazeEffect } from './Haze.js';
import { HeatShimmerEffect } from './HeatShimmer.js';
import { ImpactEffect } from './Impact.js';
import { UpscalePass } from './Upscale.js';

const _gv = new THREE.Vector3();

// Renderer + post stack (pmndrs/postprocessing): optional N8AO ambient occlusion, bloom for
// flames and sun glitter, SMAA, AgX tone mapping and a soft vignette.
// Adaptive resolution nudges the render scale to hold ~55-60 fps on laptops.

export class RenderSystem {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;
    this.scale = 1;
    this.adaptive = settings.adaptiveResolution;
    this.frameTimes = [];
    this.settle = 0;
    this.setQuality(settings.quality, true);
  }

  get quality() {
    return QUALITY_PRESETS[this.qualityName];
  }

  /** Render pixels per CSS pixel (what particles and screen-space sizes are measured in; the
   *  canvas itself may be finer: see resize). */
  get pixelRatio() {
    return this.renderPR ?? this.renderer.getPixelRatio();
  }

  /** The render resolution in pixels (the composer's buffers, below the canvas when upscaling). */
  renderSize(out = new THREE.Vector2()) {
    return out.copy(this._renderSize || this.renderer.getDrawingBufferSize(out));
  }

  setQuality(name, initial = false) {
    this.qualityName = QUALITY_PRESETS[name] ? name : 'medium';
    this.renderer.shadowMap.enabled = this.quality.shadows > 0;
    this.scale = 1;
    this.slow = this.upHold = 0;
    if (!initial && this.scene) this.buildComposer(this.scene, this.camera);
    this.resize();
  }

  buildComposer(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.composer?.dispose();
    const q = this.quality;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const ao = new N8AOPostPass(scene, camera, size.x, size.y);
      ao.configuration.aoRadius = 2.5;
      ao.configuration.distanceFalloff = 1.2;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = true;
      ao.configuration.gammaCorrection = false;
      // N8AO turns this on by itself when the scene holds any transparent material, and then
      // walks the whole scene four times and draws it twice more every frame (~5-9 ms of CPU on
      // a MacBook Air: the stutter at High/Very High). Water and smoke write no depth, so the
      // AO under them is the faint AO of what lies behind: side by side it looks identical.
      ao.configuration.transparencyAware = false;
      ao.setQualityMode(q.aoMode || 'Low');
      // half resolution, upsampled along depth edges, two light denoise passes: side by side at
      // 100% on Prady's back it matches the full-resolution AO (no blotches, no grain in the
      // creases) for ~3.7 ms less a frame at Very High (2026-10-14). The old half-res setting, one
      // wide blur, crawled as grain over faces; full resolution cost 8 ms.
      ao.configuration.halfRes = q.aoHalfRes ?? true;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.denoiseSamples = 4;
      ao.configuration.denoiseRadius = 6;
      ao.configuration.denoiseIterations = 2;
      if (q.aoMode === 'Performance') ao.configuration.aoSamples = 16;
      composer.addPass(ao);
      this.ao = ao;
    } else this.ao = null;
    // reflections in wet stone and puddles (WetReflections.js: its own pass, before the tone
    // map; Game switches it on only where something can be wet; ?nossr to compare)
    if (q.ssr && !(typeof location !== 'undefined' && /[?&]nossr/.test(location.search))) {
      this.wet = new WetReflectionEffect(camera);
      if (this._wetWorld) this.wet.bindWorld(this._wetWorld);
      this.wetPass = new EffectPass(camera, this.wet);
      this.wetPass.enabled = false;
      composer.addPass(this.wetPass);
    } else this.wet = this.wetPass = null;
    // hot air over fires (its own pass: it bends the picture, so it can't merge with SMAA)
    if (this.qualityName !== 'low') {
      this.heat = new HeatShimmerEffect();
      this.heatPass = new EffectPass(camera, this.heat);
      this.heatPass.enabled = false;
      composer.addPass(this.heatPass);
    } else this.heat = this.heatPass = null;
    // photo mode depth of field (its own pass, only on while a photo is being framed)
    if (this.qualityName !== 'low') {
      this.dof = new DepthOfFieldEffect(camera, { focusDistance: 6, focusRange: 3, bokehScale: 3, resolutionScale: 0.5 });
      this.dofPass = new EffectPass(camera, this.dof);
      composer.addPass(this.dofPass);
      this.setDof(this.dofLevel ?? 0, this.dofTarget);
    } else this.dof = this.dofPass = null;
    const effects = [];
    // contact shadows first: on the scene's own light, before haze, bloom and the tone map
    this.contact = typeof location !== 'undefined' && /[?&]nocontact/.test(location.search) ? null : new ContactShadowEffect(camera);
    if (this.contact) effects.push(this.contact);
    // sun shafts through the havelis, umbrellas and mist at sunrise / sunset (not on Low); in a
    // pass of their own so they cost nothing (no light pass, no blur) when the sun is high or set
    if (this.qualityName !== 'low') {
      this.sunMesh = this.sunMesh || new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
      this.godRays = new GodRaysEffect(camera, this.sunMesh, { resolutionScale: 0.45, samples: 52, density: 0.97, decay: 0.95, weight: 0.6, exposure: 0, clampMax: 1, blur: true });
      this.godRaysPass = new EffectPass(camera, this.godRays);
      this.godRaysPass.enabled = false;
      composer.addPass(this.godRaysPass);
    } else this.godRays = this.godRaysPass = null;
    // the lamps' light in the haze (Haze.js), before the bloom so its brightest blooms (not on Low)
    if (this.qualityName !== 'low') {
      this.haze = new HazeEffect();
      effects.push(this.haze);
    } else this.haze = null;
    if (q.bloom) {
      // (at half resolution: a glow loses nothing by it, and it was a full-size pass)
      this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 3.2, luminanceSmoothing: 0.8, mipmapBlur: true, radius: 0.6, levels: 6, resolutionScale: 0.5 });
      effects.push(this.bloom);
    }
    // Khronos PBR Neutral: colour kept true up to the highlights, which then roll off to white,
    // instead of ACES's cream-and-grey clip of the sky and its saturation spike in the mids (the
    // "plastic" look). ?tm=aces / ?tm=agx to compare.
    const tm = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tm') : null;
    this.toneMapping = new ToneMappingEffect({ mode: tm === 'aces' ? ToneMappingMode.ACES_FILMIC : tm === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.NEUTRAL });
    this.tmName = tm || 'neutral';
    effects.push(this.toneMapping);
    this.grade = new ColorGradeEffect();
    this.grade.satScale = this.tmName === 'neutral' ? 0.9 : 1;
    effects.push(this.grade);
    effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.42 }));
    if (q.smaa) effects.push(new SMAAEffect({ preset: this.qualityName === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH }));
    // the jolt of a blow (its own pass: it reads neighbouring pixels; off unless a blow just
    // landed, and never the last pass, so switching it off can't leave the screen unpainted)
    this.impact = new ImpactEffect();
    this.impactPass = new EffectPass(camera, this.impact);
    this.impactPass.enabled = false;
    composer.addPass(this.impactPass);
    composer.addPass(new EffectPass(camera, ...effects));
    // last: up to the screen's own resolution, sharpened in the same pass (Upscale.js; it was a
    // pass of its own, a whole frame's reads and writes for nothing)
    // the Painterly look (Painterly.js): its own pass (it reads neighbours), off unless chosen
    this.paint = new PainterlyEffect();
    this.paintPass = new EffectPass(camera, this.paint);
    this.paintPass.enabled = false;
    composer.addPass(this.paintPass);
    composer.addPass((this.upscalePass = new UpscalePass(q.sharpen || 0)));
    this.composer = composer;
    this.resize();
  }

  /** The haze lit by the lamps (Haze.js). */
  setHaze(camera, lights, density, waterY) {
    this.haze?.set(camera, lights, density, waterY);
  }

  /** The Painterly look, 0 off .. 1 full (eased by Game). */
  setPaint(k) {
    if (!this.paint) return;
    this.paint.set(k, { ink: 0.6, step: 1.8 });
    this.paintPass.enabled = k > 0.001;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = clamp(this.quality.pixelRatio * this.scale, 0.45, 2) * Math.min(dpr, this.quality.dprCap ?? 1.25);
    // The canvas is the screen's own resolution and the picture is drawn at `pr`, then upscaled by
    // the last pass (Upscale.js) instead of the browser's bilinear stretch. The cheap presets
    // (below 1.2x) keep the browser's stretch: a native-size pass is not free on a weak GPU.
    const canvasPR = pr >= 1.2 ? Math.max(pr, dpr) : pr;
    this.renderPR = pr;
    this.renderer.setPixelRatio(canvasPR);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // (the composer would size its buffers to the canvas: they are sized to the render instead)
    const rw = Math.max(1, Math.round(w * pr));
    const rh = Math.max(1, Math.round(h * pr));
    this._renderSize = new THREE.Vector2(rw, rh);
    const c = this.composer;
    if (c) {
      c.inputBuffer.setSize(rw, rh);
      c.outputBuffer.setSize(rw, rh);
      c.depthRenderTarget?.setSize(rw, rh);
      for (const pass of c.passes) pass.setSize(rw, rh);
    }
    this.rest(30);
  }

  /** Ignore the next `frames` frames (start of play, after a resize: they hitch by themselves). */
  rest(frames) {
    this.settle = Math.max(this.settle || 0, frames);
    this.frameTimes.length = 0;
    this.busy = this.spent = 0;
  }

  // Called once per frame with the real frame time. Judges the typical frame: the slowest 15%
  // are dropped, because one-off hitches (a shader compiling, a texture uploading) are not
  // fixed by rendering fewer pixels — counting them used to walk the scale down to a blurry
  // 0.6 during the first minute. Two slow windows in a row are needed to step down, and only
  // when the GPU is the limit: `cpu` is the script time of the frame (update + draw
  // submission) — if it fills most of the frame, the laptop is CPU-bound and fewer pixels would
  // only blur the picture without adding a frame. A scale that proved too slow is not retried
  // for ~30 s (no sharp/soft pumping).
  adapt(dt, cpu) {
    if (!this.adaptive) return;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    const ft = this.frameTimes;
    ft.push(dt);
    this.busy += cpu;
    this.spent += dt;
    if (ft.length < 120) return;
    this.busyRatio = this.busy / this.spent; // shown by ?debug tools
    const gpuBound = this.busyRatio < 0.7;
    this.busy = this.spent = 0;
    ft.sort((a, b) => a - b);
    const keep = Math.floor(ft.length * 0.85);
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += ft[i];
    ft.length = 0;
    const fps = keep / sum;
    if (this.upHold > 0) this.upHold--;
    this.slow = fps < 48 && gpuBound ? this.slow + 1 : 0;
    if (this.slow >= 2 && this.scale > (this.quality.minScale ?? 0.7) + 1e-3) {
      this.slow = 0;
      this.tooSlow = this.scale;
      this.upHold = 15;
      this.setScale(Math.max(this.quality.minScale ?? 0.7, this.scale - 0.1));
    } else if (fps > 56 && this.scale < 1) {
      const next = Math.min(1, this.scale + 0.1);
      if (!(this.upHold > 0 && next >= this.tooSlow - 1e-3)) this.setScale(next);
    }
  }

  setScale(s) {
    this.scale = s;
    this.resize();
  }

  // keep the god-ray source on the sun and fade it with the time of day (0..1)
  updateGodRays(camera, sunDir, sunColor, amount) {
    if (!this.godRays) return;
    const m = this.sunMesh;
    m.position.copy(camera.position).addScaledVector(sunDir, 1400);
    m.scale.setScalar(62);
    m.material.color.copy(sunColor);
    // (only with the sun in front of the lens: behind it the rays add nothing but still cost a
    // radial blur of the whole frame, ~1-4 ms)
    camera.getWorldDirection(_gv);
    const facing = _gv.dot(sunDir) > 0.2;
    this.godRays.godRaysMaterial.exposure = 0.78 * amount;
    this.godRays.blendMode.opacity.value = amount > 0.01 && facing ? 1 : 0;
    this.godRaysPass.enabled = amount > 0.01 && facing;
  }

  /** chroma: the colour split, blur: the streak toward (cx, cy) (screen uv); 0, 0 switches it off. */
  setImpact(chroma, blur, cx = 0.5, cy = 0.5, frame = 0, invert = 0) {
    if (!this.impact) return;
    const on = chroma > 0.0004 || blur > 0.0004 || frame > 0.001;
    this.impactPass.enabled = on;
    if (on) this.impact.set(chroma, blur, cx, cy, frame, invert);
  }

  /** level 0 off, 1 soft, 2 strong; target: world point to keep sharp. */
  /** Depth of field on `target` (null: off at level 0). opts: { range (m in focus), bokeh } for a
   *  long lens on a far subject (an establishing shot) rather than a portrait. */
  setDof(level, target, opts = {}) {
    this.dofLevel = level;
    this.dofTarget = target;
    if (!this.dof) return;
    this.dofPass.enabled = level > 0;
    this.dof.target = target || null;
    this.dof.bokehScale = opts.bokeh ?? (level > 1 ? 5.5 : 2.6);
    this.dof.cocMaterial.focusRange = opts.range ?? (level > 1 ? 1.6 : 3.2);
  }

  /** What wet means (WetReflectionEffect.bindWorld); kept for when the composer is rebuilt. */
  bindWetWorld(world) {
    this._wetWorld = world;
    this.wet?.bindWorld(world);
  }

  /** On while something on screen can be wet (the river's edge, or rain). */
  setWet(on) {
    if (this.wetPass) this.wetPass.enabled = on;
  }

  updateHeat(camera, sources) {
    if (!this.heat) return;
    this.heatPass.enabled = this.heat.updateSources(camera, sources) > 0;
  }

  render(exposure) {
    // (ACES lifts the mids by ~1/0.6 on its own; Neutral and AgX don't: the same scene at the
    // same exposure would come out a stop darker)
    this.renderer.toneMappingExposure = exposure * (this.tmName === 'aces' ? 1 : 1.42);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.info.reset();
    this.composer.render();
    this.keepPrograms();
  }

  /**
   * Shader programs are kept once compiled. three.js frees a program when the last material
   * using it lets go, and compiles it again from nothing the next time it is needed: a crowd
   * body fading in, a night effect, a particle burst. On a cold GPU shader cache (the first run
   * after every update) each recompile froze the game for up to seconds. A program costs little
   * GPU memory, so none is ever freed (one extra use each).
   */
  keepPrograms() {
    const list = this.renderer.info.programs;
    if (!list || list.length === this._kept) return;
    for (const p of list) {
      if (p.kept) continue;
      p.kept = true;
      p.usedTimes++;
    }
    this._kept = list.length;
  }

  /**
   * Compile what the scene holds before it is first seen, off the main thread
   * (KHR_parallel_shader_compile): things added after loading (the crowd's people, animals, a
   * temple, the Asuras, effects) would otherwise compile at their first frame on screen. Called
   * every frame, it acts every two seconds at most, and only when the scene has changed.
   */
  prewarm(scene, camera, dt) {
    this._warmT = (this._warmT ?? 0) - dt;
    if (this._warmT > 0 || this._warming) return;
    this._warmT = 2;
    let n = 0;
    scene.traverse(() => n++);
    if (n === this._warmN) return;
    this._warmN = n;
    this._warming = true;
    const done = () => (this._warming = false);
    this.compile(scene, camera, true).then(done, done);
  }

  /**
   * Compile the scene's shaders as they will actually be drawn. Everything renders into a render
   * target (the composer's buffers, the river's mirror), and three.js builds a different program
   * for a target (linear output) than for the screen (sRGB): compiling with none bound made the
   * screen variants, never used, and every material compiled again on its first frame in view.
   */
  compile(scene, camera, async = false, targetScene = null) {
    const r = this.renderer;
    this._compileRT ||= new THREE.WebGLRenderTarget(1, 1);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this._compileRT);
    try {
      return async ? r.compileAsync(scene, camera, targetScene) : r.compile(scene, camera, targetScene);
    } finally {
      r.setRenderTarget(prev);
    }
  }

  /** One render with every post pass on (depth of field, heat shimmer...): their shaders
   *  compile behind the loading screen, not the first time a cutscene or photo needs them. */
  renderAllPasses(exposure) {
    const off = this.composer.passes.filter((p) => !p.enabled);
    for (const p of off) p.enabled = true;
    this.render(exposure);
    for (const p of off) p.enabled = false;
  }
}
