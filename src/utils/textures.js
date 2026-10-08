import * as THREE from 'three';
import { RNG } from './math.js';

// Texture helpers:
//  - makeSurfaceSet(): turns ANY photo (Genex image, your own photo, a CC0 texture) into a
//    seamless tiling PBR set: colour + normal + roughness, computed in the browser at load.
//  - procedural canvas textures for windows, foliage, particles, the moon, etc.

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(tex, { srgb = true, repeat = true, aniso = 8 } = {}) {
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

/**
 * Seamless PBR set from a photo.
 * opts.size: output resolution, opts.normalStrength, opts.roughness [min,max], opts.tint
 */
export function makeSurfaceSet(img, opts = {}) {
  const size = opts.size ?? 1024;
  const crop = Math.min(img.width, img.height);
  const src = canvas(size);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, size, size);
  const a = sctx.getImageData(0, 0, size, size).data;

  // Cross-blend with a half-offset copy so the edges wrap (classic offset/feather trick).
  const out = new Uint8ClampedArray(a.length);
  const half = size / 2;
  const feather = size * 0.22;
  for (let y = 0; y < size; y++) {
    const dy = Math.min(y, size - 1 - y);
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - 1 - x);
      let w = Math.min(dx, dy) / feather;
      w = w >= 1 ? 1 : w * w * (3 - 2 * w);
      const i = (y * size + x) * 4;
      const j = (((y + half) % size) * size + ((x + half) % size)) * 4;
      out[i] = a[i] * w + a[j] * (1 - w);
      out[i + 1] = a[i + 1] * w + a[j + 1] * (1 - w);
      out[i + 2] = a[i + 2] * w + a[j + 2] * (1 - w);
      out[i + 3] = 255;
    }
  }
  const colorCanvas = canvas(size);
  colorCanvas.getContext('2d').putImageData(new ImageData(out, size, size), 0, 0);

  // Height from luminance (with a little blur) -> normal map; roughness from inverted luminance.
  const lum = new Float32Array(size * size);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = (out[p] * 0.299 + out[p + 1] * 0.587 + out[p + 2] * 0.114) / 255;
  const blur = new Float32Array(lum.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) s += lum[((y + oy + size) % size) * size + ((x + ox + size) % size)];
      blur[y * size + x] = s / 9;
    }
  }
  const strength = opts.normalStrength ?? 3.0;
  const [rMin, rMax] = opts.roughness ?? [0.75, 0.98];
  const nData = new Uint8ClampedArray(lum.length * 4);
  const rData = new Uint8ClampedArray(lum.length * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = blur[y * size + ((x - 1 + size) % size)];
      const r = blur[y * size + ((x + 1) % size)];
      const u = blur[((y - 1 + size) % size) * size + x];
      const d = blur[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength; // OpenGL convention (+Y up in tangent space)
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      nData[i * 4] = (nx * 0.5 + 0.5) * 255;
      nData[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nData[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      nData[i * 4 + 3] = 255;
      const rough = rMax - (rMax - rMin) * Math.min(1, blur[i] * 1.2);
      // roughness lives in the G channel for three.js (metalness in B)
      rData[i * 4] = 255;
      rData[i * 4 + 1] = rough * 255;
      rData[i * 4 + 2] = 0;
      rData[i * 4 + 3] = 255;
    }
  }
  const nCanvas = canvas(size);
  nCanvas.getContext('2d').putImageData(new ImageData(nData, size, size), 0, 0);
  const rCanvas = canvas(size);
  rCanvas.getContext('2d').putImageData(new ImageData(rData, size, size), 0, 0);

  return {
    map: finish(new THREE.CanvasTexture(colorCanvas)),
    normalMap: finish(new THREE.CanvasTexture(nCanvas), { srgb: false }),
    roughnessMap: finish(new THREE.CanvasTexture(rCanvas), { srgb: false }),
  };
}

// Procedural stand-in when an image is missing (keeps the game running without any asset).
export function proceduralSurface(kind) {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rng = new RNG(kind.length * 977);
  const base = { stone: '#c2a47c', plaster: '#e6e0d4', sand: '#a89c86' }[kind] || '#999';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const v = rng.range(-28, 28);
    ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 240 : 0},${v > 0 ? 220 : 0},${Math.abs(v) / 400})`;
    const r = rng.range(1, kind === 'sand' ? 3 : 14);
    ctx.beginPath();
    ctx.arc(rng.range(0, size), rng.range(0, size), r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (kind === 'stone') {
    ctx.strokeStyle = 'rgba(60,45,30,0.55)';
    ctx.lineWidth = 3;
    for (let y = 0; y <= size; y += 128) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
      const off = (y / 128) % 2 ? 128 : 0;
      for (let x = off; x <= size; x += 256) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 128);
        ctx.stroke();
      }
    }
  }
  return makeSurfaceSet(c, { size: 512 });
}

// Arched jharokha-style window: dark interior, carved frame, optional shutters.
export function windowTexture({ lit = false } = {}) {
  const w = 128;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const arch = (inset) => {
    ctx.beginPath();
    const r = (w - inset * 2) / 2;
    ctx.moveTo(inset, h - inset);
    ctx.lineTo(inset, r + inset + 30);
    ctx.quadraticCurveTo(inset, inset, w / 2, inset);
    ctx.quadraticCurveTo(w - inset, inset, w - inset, r + inset + 30);
    ctx.lineTo(w - inset, h - inset);
    ctx.closePath();
  };
  // frame
  arch(0);
  ctx.fillStyle = '#7a5a3c';
  ctx.fill();
  // interior
  arch(12);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (lit) {
    g.addColorStop(0, '#ffcf7a');
    g.addColorStop(1, '#ff9a3c');
  } else {
    g.addColorStop(0, '#15110d');
    g.addColorStop(1, '#2a2119');
  }
  ctx.fillStyle = g;
  ctx.fill();
  // mullions / jaali grid
  ctx.strokeStyle = lit ? 'rgba(90,50,20,0.8)' : 'rgba(110,85,60,0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, 20);
  ctx.lineTo(w / 2, h - 12);
  ctx.moveTo(12, h * 0.55);
  ctx.lineTo(w - 12, h * 0.55);
  ctx.stroke();
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

export function leafTexture() {
  const s = 256;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  const rng = new RNG(42);
  for (let i = 0; i < 70; i++) {
    const x = rng.range(30, s - 30);
    const y = rng.range(30, s - 30);
    const r = rng.range(10, 22);
    const a = rng.range(0, Math.PI * 2);
    const g = 70 + rng.range(0, 70);
    ctx.fillStyle = `rgb(${g * 0.45},${g},${g * 0.3})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    // peepal leaf: heart with a drip tip
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r, -r, r * 0.9, r * 0.4, 0, r * 1.6);
    ctx.bezierCurveTo(-r * 0.9, r * 0.4, -r, -r, 0, -r);
    ctx.fill();
    ctx.restore();
  }
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

export function softDotTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const s = 128;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return finish(new THREE.CanvasTexture(c), { repeat: false, srgb: false });
}

export function smokeTexture() {
  const s = 128;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  const rng = new RNG(7);
  for (let i = 0; i < 40; i++) {
    const x = s / 2 + rng.range(-22, 22);
    const y = s / 2 + rng.range(-22, 22);
    const r = rng.range(14, 34);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return finish(new THREE.CanvasTexture(c), { repeat: false, srgb: false });
}

export function moonTexture() {
  const s = 256;
  const c = canvas(s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.42, 'rgba(255,248,230,1)');
  g.addColorStop(0.46, 'rgba(200,210,255,0.35)');
  g.addColorStop(1, 'rgba(120,140,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const rng = new RNG(3);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(150,145,140,${rng.range(0.08, 0.2)})`;
    ctx.beginPath();
    ctx.arc(s / 2 + rng.range(-40, 40), s / 2 + rng.range(-40, 40), rng.range(4, 14), 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

// Tileable water normal map: sum of sinusoids with integer wave numbers (perfectly periodic).
export function waterNormalTexture(size = 256) {
  const rng = new RNG(11);
  const waves = [];
  for (let i = 0; i < 24; i++) {
    const kx = rng.int(-9, 9);
    const ky = rng.int(-9, 9);
    if (!kx && !ky) continue;
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / Math.pow(k, 1.25), p: rng.range(0, Math.PI * 2) });
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (const w of waves) s += w.a * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p);
      h[y * size + x] = s;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      let nx = -dx * 1.6;
      let ny = -dy * 1.6;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return finish(tex, { srgb: false });
}
