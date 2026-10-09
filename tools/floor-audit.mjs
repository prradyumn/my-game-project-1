// node tools/floor-audit.mjs [out.json]   (needs `npm run dev` and Chrome; ~1 min)
//
// Where does Prady sink into what we see? For every walkable floor (physics, what his controller
// stands on, several layers per column), find the highest visible surface between 0.3 m below and
// 0.6 m above it (GPU, top-down, the scene clipped per texel to that band). Visible > physics by
// more than SINK = his feet are inside the stone. Clusters are reported with the object found there.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2] || 'tools/out/floor-audit.json';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
p.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('[audit]')) console.log(m.text()); });
await p.addInitScript(() => localStorage.setItem('prady-settings-v1', JSON.stringify({ quality: 'medium', adaptiveResolution: false })));
await p.goto('http://localhost:5173/');
await p.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 });
await p.evaluate(async () => { const g = window.__game; const e = g.testMenu.entries.find((x) => x.label.startsWith('Dawn at Dashashwamedh')); await g.testMenu.jump(e, 'title'); });
await p.waitForTimeout(6000);
const res = await p.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const g = window.__game;
  g.paused = true;
  const R = g.physics.RAPIER;
  const world = g.physics.world;
  const renderer = g.rs.renderer;
  const scene = g.scene;
  // what his controller stands on, minus people (capsules) — GROUPS.mover without PEOPLE
  const groups = ((0xffff << 16) | (0xffff & ~0x02 & ~0x04 & ~0x10 & ~0x40)) >>> 0;
  const SINK = 0.1;
  const CELL = 0.25;
  const TILE = 40;
  const N = TILE / CELL;
  // hide what is not floor: people, animals, water, sky, fx, cloth, boats
  const hidden = [];
  scene.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    const skip = o.isSkinnedMesh || o.isPoints || o.isLine || o.isSprite || /crowd|animal|asura|street-life|mist|sky|water|boat|kite|flag|lantern|firework|particle|smoke|ember|ripple|wake|foam|cloud|star|moon|sun|godray|marker|ring|shock/.test(n) || (o.isMesh && o.material && (Array.isArray(o.material) ? o.material.some((m) => m.transparent && !m.depthWrite) : o.material.transparent && !o.material.depthWrite));
    if (skip && o.visible) {
      hidden.push(o);
      o.visible = false;
    }
  });
  if (g.character) { g.character.visible = false; hidden.push(g.character); }
  const hpTex = new THREE.DataTexture(new Float32Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.FloatType);
  hpTex.magFilter = hpTex.minFilter = THREE.NearestFilter;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.NoBlending,
    uniforms: { uHp: { value: hpTex }, uTile: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vW; void main() { vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      vec4 w = modelMatrix * p; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D uHp; uniform vec3 uTile; varying vec3 vW;
      void main() { vec2 uv = (vW.xz - uTile.xy) / uTile.z; if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
        float hp = texture2D(uHp, uv).r; if (hp < -9000.0) discard; if (vW.y > hp + 0.6 || vW.y < hp - 0.3) discard; gl_FragColor = vec4(vW.y + 10000.0, hp + 10000.0, vW.x + 10000.0, vW.z + 10000.0); }`,
  });
  const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const cam = new THREE.OrthographicCamera(0, TILE, 0, -TILE, 0.1, 400); // set per tile below
  const buf = new Float32Array(N * N * 4);
  const flags = [];
  let floors = 0;
  // the world's walkable bounds: the ghats and the city behind them
  const xs = [-460, 460];
  const zs = [-140, 70];
  const prevOverride = scene.overrideMaterial;
  const prevBg = scene.background;
  const prevFog = scene.fog;
  scene.background = null;
  scene.fog = null;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  for (let x0 = xs[0]; x0 < xs[1]; x0 += TILE) {
    for (let z0 = zs[0]; z0 < zs[1]; z0 += TILE) {
      // the floors in each column: up to four, each with 1.8 m clear above it
      const layers = [new Float32Array(N * N).fill(-9999), new Float32Array(N * N).fill(-9999), new Float32Array(N * N).fill(-9999)];
      let any = false;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = x0 + (i + 0.5) * CELL;
          const z = z0 + (j + 0.5) * CELL;
          let top = 120;
          let above = 1e9;
          let k = 0;
          for (let it = 0; it < 6 && k < 3; it++) {
            ray.origin = { x, y: top, z };
            const h = world.castRayAndGetNormal(ray, top + 30, false, undefined, groups);
            if (!h) break;
            const y = top - h.timeOfImpact;
            if (h.normal.y > 0.6) {
              if (above - y >= 1.8 && y > -0.9) {
                layers[k][j * N + i] = y;
                k++;
                any = true;
              }
            }
            above = y;
            top = y - 0.02;
          }
        }
      }
      if (!any) continue;
      for (let k = 0; k < 3; k++) {
        const L = layers[k];
        if (!L.some((v) => v > -9000)) continue;
        const d = hpTex.image.data;
        for (let n = 0; n < N * N; n++) d[n * 4] = L[n];
        hpTex.needsUpdate = true;
        mat.uniforms.uTile.value.set(x0, z0, TILE);
        // camera above the tile looking down: image x = +X, image up = -Z
        cam.left = 0; cam.right = TILE; cam.top = TILE; cam.bottom = 0;
        cam.position.set(x0, 200, z0 + TILE);
        cam.up.set(0, 0, -1);
        cam.lookAt(x0, 0, z0 + TILE);
        cam.left = 0; cam.right = TILE; cam.top = TILE; cam.bottom = 0;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        scene.overrideMaterial = mat;
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
        renderer.setRenderTarget(null);
        for (let py = 0; py < N; py++) {
          for (let px = 0; px < N; px++) {
            const o = (py * N + px) * 4;
            if (buf[o] < 1) continue;
            // (the shader writes what it saw: the surface's height, the floor it was clipped
            // to, and where it is)
            const hv = buf[o] - 10000;
            const hp = buf[o + 1] - 10000;
            const x = buf[o + 2] - 10000;
            const z = buf[o + 3] - 10000;
            if (hp < -9000) continue;
            floors++;
            if (hv - hp > SINK) flags.push([+x.toFixed(2), +z.toFixed(2), +hp.toFixed(2), +hv.toFixed(2), k]);
          }
        }
      }
    }
    console.log(`[audit] x ${x0}: ${flags.length} flagged so far`);
  }
  scene.overrideMaterial = prevOverride;
  scene.background = prevBg;
  scene.fog = prevFog;
  renderer.setClearColor(prevClear, prevAlpha);
  // clusters: flagged cells within 0.4 m (same layer)
  const key = (x, z) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  const byLayer = [new Map(), new Map(), new Map()];
  for (const f of flags) byLayer[f[4]].set(key(f[0], f[1]), f);
  const clusters = [];
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) { let v = true; for (let q = o; q; q = q.parent) if (!q.visible) v = false; if (v) meshes.push(o); } });
  for (let k = 0; k < 3; k++) {
    const M = byLayer[k];
    const seen = new Set();
    for (const [kk, f] of M) {
      if (seen.has(kk)) continue;
      const stack = [kk];
      seen.add(kk);
      const cells = [];
      while (stack.length) {
        const c = stack.pop();
        const ff = M.get(c);
        cells.push(ff);
        const [ci, cj] = c.split(',').map(Number);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const nk = `${ci + di},${cj + dj}`;
          if (!seen.has(nk) && M.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      if (cells.length < 6) continue;
      const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
      const cz = cells.reduce((s, c) => s + c[1], 0) / cells.length;
      const gaps = cells.map((c) => c[3] - c[2]).sort((a, b) => a - b);
      const minx = Math.min(...cells.map((c) => c[0])), maxx = Math.max(...cells.map((c) => c[0]));
      const minz = Math.min(...cells.map((c) => c[1])), maxz = Math.max(...cells.map((c) => c[1]));
      // which object is that visible surface? (the one cell nearest the centre)
      const mid = cells.reduce((best, c) => (Math.hypot(c[0] - cx, c[1] - cz) < Math.hypot(best[0] - cx, best[1] - cz) ? c : best));
      const rc = new THREE.Raycaster(new THREE.Vector3(mid[0], mid[3] + 0.05, mid[1]), new THREE.Vector3(0, -1, 0), 0, 0.4);
      const hits = rc.intersectObjects(meshes, false);
      const obj = hits[0]?.object;
      const path = [];
      for (let o = obj; o && path.length < 3; o = o.parent) if (o.name) path.push(o.name);
      clusters.push({ layer: k, cx: +cx.toFixed(1), cz: +cz.toFixed(1), area: +(cells.length * CELL * CELL).toFixed(2), size: [+(maxx - minx + CELL).toFixed(1), +(maxz - minz + CELL).toFixed(1)], floorY: +mid[2].toFixed(2), visY: +mid[3].toFixed(2), gapMed: +gaps[gaps.length >> 1].toFixed(2), gapMax: +gaps[gaps.length - 1].toFixed(2), obj: path.join('<') || obj?.type || '?', mat: obj?.material?.name || '' });
    }
  }
  for (const o of hidden) o.visible = true;
  clusters.sort((a, b) => b.area - a.area);
  return { floors, flagged: flags.length, clusters };
});
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`floors ${res.floors} flagged ${res.flagged} clusters ${res.clusters.length}`);
for (const c of res.clusters.slice(0, 40)) console.log(JSON.stringify(c));
await b.close();
