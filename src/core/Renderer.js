import * as THREE from 'three';
import { BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, GodRaysEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { QUALITY_PRESETS } from '../config.js';
import { clamp } from '../utils/math.js';
import { ColorGradeEffect } from './Grading.js';
import { HeatShimmerEffect } from './HeatShimmer.js';
import { ImpactEffect } from './Impact.js';
import { SharpenEffect } from './Sharpen.js';

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

  get pixelRatio() {
    return this.renderer.getPixelRatio();
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
      // a thorough blur of the half-resolution AO: with N8AO's 4-sample denoise it crawled as
      // grain over faces and clothes (most visible on Prady close up)
      ao.configuration.denoiseSamples = 8;
      ao.configuration.denoiseRadius = 10;
      if (q.aoMode === 'Performance') ao.configuration.aoSamples = 12;
      // full resolution where the preset can afford it: no blotches to blur away on a face, and
      // so a light denoise is enough (the thorough one above is for the half-resolution AO)
      ao.configuration.halfRes = q.aoHalfRes ?? true;
      if (!ao.configuration.halfRes) {
        ao.configuration.denoiseSamples = 4;
        ao.configuration.denoiseRadius = 6;
      }
      composer.addPass(ao);
      this.ao = ao;
    } else this.ao = null;
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
    // sun shafts through the havelis, umbrellas and mist at sunrise / sunset (not on Low); in a
    // pass of their own so they cost nothing (no light pass, no blur) when the sun is high or set
    if (this.qualityName !== 'low') {
      this.sunMesh = this.sunMesh || new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
      this.godRays = new GodRaysEffect(camera, this.sunMesh, { resolutionScale: 0.45, samples: 52, density: 0.97, decay: 0.95, weight: 0.6, exposure: 0, clampMax: 1, blur: true });
      this.godRaysPass = new EffectPass(camera, this.godRays);
      this.godRaysPass.enabled = false;
      composer.addPass(this.godRaysPass);
    } else this.godRays = this.godRaysPass = null;
    if (q.bloom) {
      this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 3.2, luminanceSmoothing: 0.8, mipmapBlur: true, radius: 0.6, levels: 6 });
      effects.push(this.bloom);
    }
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    effects.push(this.toneMapping);
    this.grade = new ColorGradeEffect();
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
    // last: restore the detail lost to upscaling (its own pass: it reads neighbouring pixels)
    if (q.sharpen > 0) composer.addPass(new EffectPass(camera, new SharpenEffect(q.sharpen)));
    this.composer = composer;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = clamp(this.quality.pixelRatio * this.scale, 0.45, 2) * Math.min(dpr, this.quality.dprCap ?? 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.composer?.setSize(w, h, false);
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
    this.godRays.godRaysMaterial.exposure = 0.78 * amount;
    this.godRays.blendMode.opacity.value = amount > 0.01 ? 1 : 0;
    this.godRaysPass.enabled = amount > 0.01;
  }

  /** chroma: the colour split, blur: the streak toward (cx, cy) (screen uv); 0, 0 switches it off. */
  setImpact(chroma, blur, cx = 0.5, cy = 0.5) {
    if (!this.impact) return;
    const on = chroma > 0.0004 || blur > 0.0004;
    this.impactPass.enabled = on;
    if (on) this.impact.set(chroma, blur, cx, cy);
  }

  /** level 0 off, 1 soft, 2 strong; target: world point to keep sharp. */
  setDof(level, target) {
    this.dofLevel = level;
    this.dofTarget = target;
    if (!this.dof) return;
    this.dofPass.enabled = level > 0;
    this.dof.target = target || null;
    this.dof.bokehScale = level > 1 ? 5.5 : 2.6;
    this.dof.cocMaterial.focusRange = level > 1 ? 1.6 : 3.2;
  }

  updateHeat(camera, sources) {
    if (!this.heat) return;
    this.heatPass.enabled = this.heat.updateSources(camera, sources) > 0;
  }

  render(exposure) {
    this.renderer.toneMappingExposure = exposure;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.info.reset();
    this.composer.render();
  }
}
