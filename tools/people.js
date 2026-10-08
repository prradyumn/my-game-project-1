// Builds the crowd of Kashi: Microsoft Rocketbox avatars (MIT) + motion capture (Mixamo clips
// from the three.js examples, CMU mocap) retargeted onto each avatar, exported as one GLB per
// person into public/assets/people/. Run: npm run bake:people (needs npm run dev).
//   ?analyze=1   print a timeline of each CMU take to choose clean loop segments
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { bipedKey, cmuKey, retargetClip } from '../src/gameplay/Retarget.js';
import { MOTIONS, AVATARS, PACKS } from './people-config.js';

const out = document.getElementById('o');
const log = (s) => (out.textContent += `\n${s}`);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- motion sources
const CMU_ALL = ["18_08", "13_04", "13_05", "14_30", "02_10", "40_10", "13_26", "16_01", "42_01"];
async function loadSources(all = false) {
  const gl = new GLTFLoader();
  const xbot = await gl.loadAsync('/source-assets/mixamo/Xbot.glb');
  const src = { xbot: { root: xbot.scene, clips: xbot.animations } };
  const bvh = new BVHLoader();
  const packMotions = Object.values(PACKS).flatMap((pk) => pk.motions);
  const files = all ? CMU_ALL : [...new Set([...MOTIONS, ...packMotions].filter((m) => m.cmu).map((m) => m.cmu))];
  for (const f of files) {
    const res = bvh.parse(await (await fetch(`/source-assets/cmu/${f}.bvh`)).text());
    const root = new THREE.Group();
    root.add(res.skeleton.bones[0]);
    src[f] = { root, clips: [res.clip], bvh: true };
  }
  return src;
}

function sourceFor(src, m) {
  if (m.cmu) {
    const s = src[m.cmu];
    return { root: s.root, clip: s.clips[0], keyOf: cmuKey, restTime: 0, start: m.start, end: m.end, restHipY: m.restHipY };
  }
  const s = src.xbot;
  return { root: s.root, clip: s.clips.find((c) => c.name === m.clip), start: m.start, end: m.end };
}

// ---------------------------------------------------------------- analysis (choose segments)
function analyse(src) {
  const lines = [];
  for (const [name, s] of Object.entries(src)) {
    if (!s.bvh) continue;
    const clip = s.clips[0];
    const mixer = new THREE.AnimationMixer(s.root);
    mixer.clipAction(clip).play();
    const bones = {};
    s.root.traverse((o) => o.isBone && (bones[o.name] = o));
    mixer.setTime(0);
    s.root.updateMatrixWorld(true);
    const h0 = bones.Hips.getWorldPosition(new THREE.Vector3());
    const f0 = bones.LeftFoot.getWorldPosition(new THREE.Vector3());
    const leg = h0.y - f0.y;
    let prev = null;
    const row = [];
    for (let t = 0.5; t < clip.duration; t += 0.5) {
      mixer.setTime(t);
      s.root.updateMatrixWorld(true);
      const h = bones.Hips.getWorldPosition(new THREE.Vector3());
      const lh = bones.LeftHand.getWorldPosition(new THREE.Vector3());
      const rh = bones.RightHand.getWorldPosition(new THREE.Vector3());
      const sp = prev ? Math.hypot(h.x - prev.x, h.z - prev.z) / 0.5 / leg : 0;
      prev = h.clone();
      row.push(`${t.toFixed(1)}:h${((h.y - f0.y) / leg).toFixed(2)} v${sp.toFixed(2)} L${((lh.y - f0.y) / leg).toFixed(1)} R${((rh.y - f0.y) / leg).toFixed(1)}`);
    }
    lines.push(`== ${name} (${clip.duration.toFixed(1)}s) hip/leg, speed legs/s, hands\n${row.join('  ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- avatars
const texLoader = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res) => texLoader.load(url, res, undefined, () => res(null)));

function canvasOf(img, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(img, 0, 0, size, size);
  return c;
}

// specular (bright = shiny) -> roughness in the G channel
async function roughnessFrom(url) {
  const t = await loadTex(url);
  if (!t) return null;
  const c = canvasOf(t.image, 512);
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < d.data.length; i += 4) {
    const s = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / (3 * 255);
    const r = Math.round((0.95 - s * 0.65) * 255);
    d.data[i] = 255;
    d.data[i + 1] = r;
    d.data[i + 2] = 0;
  }
  ctx.putImageData(d, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.userData.mimeType = 'image/jpeg';
  return tex;
}

// body | head side by side (2:1), same orientation conventions as texture()
async function atlasTexture(dir, id, kind, { srgb = false } = {}) {
  const [b, h] = await Promise.all([loadTex(`${dir}${id}_body_${kind}.png`), loadTex(`${dir}${id}_head_${kind}.png`)]);
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d');
  if (b) ctx.drawImage(b.image, 0, 0, 1024, 1024);
  if (h) ctx.drawImage(h.image, 1024, 0, 1024, 1024);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.mimeType = 'image/jpeg';
  return tex;
}

async function atlasRoughness(dir, id) {
  const [b, h] = await Promise.all([roughnessFrom(`${dir}${id}_body_specular.png`), roughnessFrom(`${dir}${id}_head_specular.png`)]);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffd200';
  ctx.fillRect(0, 0, 1024, 512);
  if (b) ctx.drawImage(b.image, 0, 0, 512, 512);
  if (h) ctx.drawImage(h.image, 512, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.userData.mimeType = 'image/jpeg';
  return tex;
}

async function texture(url, { srgb = false, jpeg = true } = {}) {
  const t = await loadTex(url);
  if (!t) return null;
  const tex = new THREE.CanvasTexture(canvasOf(t.image)); // FBX UVs: keep flipY = true (the exporter un-flips)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (jpeg) tex.userData.mimeType = 'image/jpeg';
  return tex;
}

async function buildAvatar(a) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => (/\.(tga|png|jpg)$/i.test(u) && !u.includes('/tex/') ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' : u));
  const fbx = await new FBXLoader(manager).loadAsync(`/source-assets/rocketbox/${a.id}/${a.id}.fbx`);
  // the children's rig is "Bip02 …": one naming for every body, so clips and the crowd code match
  fbx.traverse((o) => {
    if (o.name) o.name = o.name.replace(/^Bip0\d([_ ])/, 'Bip01$1');
  });
  log(`  ${a.id}: fbx loaded`);
  let mesh = null;
  fbx.traverse((o) => o.isSkinnedMesh && !mesh && (mesh = o));
  const dir = `/source-assets/rocketbox/${a.id}/tex/`;
  const files = await (await fetch(`${dir}`)).text().catch(() => '');
  void files;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  // One material per texture set, and body + head packed side by side into one atlas
  // ("skin": body on the left half, head on the right), so a person is a single draw call
  // (two with hair cards). The FBX splits them into many sub-materials otherwise.
  const partOfMat = mats.map((m) => (/head/i.test(m.name) ? 'head' : /opacity|hair|lash/i.test(m.name) ? 'opacity' : 'body'));
  const id = mats.map((m) => m.name.match(/c?[mf]\d{3}/)?.[0]).find(Boolean);
  const geo0 = mesh.geometry;
  const uvA = geo0.attributes.uv;
  // (some FBX files end their last group with count = Infinity: clamp to the real length)
  const vCount = geo0.index ? geo0.index.count : geo0.attributes.position.count;
  const groups0 = (geo0.groups.length ? geo0.groups : [{ start: 0, count: vCount, materialIndex: 0 }]).map((g) => ({ ...g, count: Math.min(g.count, vCount - g.start) }));
  let inRange = !geo0.index;
  for (const g of groups0) {
    if (partOfMat[g.materialIndex] === 'opacity') continue;
    for (let k = g.start; k < g.start + g.count && inRange; k++) {
      const u = uvA.getX(k);
      if (u < -0.002 || u > 1.002) inRange = false;
    }
  }
  const hasHead = partOfMat.includes('head');
  const atlas = inRange && hasHead && partOfMat.includes('body');
  const newMats = [];
  const partIndex = {};
  const addMat = async (part) => {
    if (partIndex[part] !== undefined) return partIndex[part];
    let mat;
    if (part === 'opacity') {
      mat = new THREE.MeshStandardMaterial({ name: `${id}_opacity`, map: await texture(`${dir}${id}_opacity_color.png`, { srgb: true, jpeg: false }), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
    } else if (part === 'skin') {
      mat = new THREE.MeshStandardMaterial({
        name: `${id}_skin`,
        map: await atlasTexture(dir, id, 'color', { srgb: true }),
        normalMap: await atlasTexture(dir, id, 'normal'),
        roughnessMap: await atlasRoughness(dir, id),
        roughness: 1,
        metalness: 0,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        name: `${id}_${part}`,
        map: await texture(`${dir}${id}_${part}_color.png`, { srgb: true }),
        normalMap: await texture(`${dir}${id}_${part}_normal.png`),
        roughnessMap: await roughnessFrom(`${dir}${id}_${part}_specular.png`),
        roughness: 1,
        metalness: 0,
      });
    }
    partIndex[part] = newMats.length;
    newMats.push(mat);
    return partIndex[part];
  };
  const remap = [];
  for (const part of partOfMat) remap.push(await addMat(atlas && part !== 'opacity' ? 'skin' : part));
  if (atlas) {
    // squeeze the UVs into their half of the atlas (unindexed: every corner is its own vertex)
    for (const g of groups0) {
      const part = partOfMat[g.materialIndex];
      if (part === 'opacity') continue;
      for (let k = g.start; k < g.start + g.count; k++) uvA.setX(k, (part === 'head' ? 0.5 : 0) + uvA.getX(k) * 0.5);
    }
    uvA.needsUpdate = true;
  }
  mesh.material = newMats.length === 1 ? newMats[0] : newMats;
  log(`  ${a.id}: materials (${newMats.map((m) => m.name).join(', ')})`);
  // FBX geometry arrives unindexed with an unused colour channel: weld it (about 3x smaller)
  mesh.geometry.deleteAttribute('color');
  const groups = groups0;
  log(`  ${a.id}: weld ${mesh.geometry.attributes.position.count} verts, attrs ${Object.keys(mesh.geometry.attributes).join(',')}, morph ${Object.keys(mesh.geometry.morphAttributes).join(',')}`);
  mesh.geometry = mergeVertices(mesh.geometry, 1e-4);
  log(`  ${a.id}: welded to ${mesh.geometry.attributes.position.count}`);
  // regroup the triangles so each material is one contiguous range (one draw call)
  if (groups.length) {
    const geo = mesh.geometry;
    const idx = geo.index.array;
    const buckets = newMats.map(() => []);
    for (const g of groups) for (let k = g.start; k < g.start + g.count; k++) buckets[remap[g.materialIndex] ?? 0].push(idx[k]);
    const all = [];
    geo.clearGroups();
    buckets.forEach((bk, mi) => {
      if (!bk.length) return;
      geo.addGroup(all.length, bk.length, mi);
      for (const v of bk) all.push(v);
    });
    geo.setIndex(all);
    if (newMats.length === 1) geo.clearGroups();
  }
  log(`  ${a.id}: regrouped`);
  // cm -> m, feet on the ground, facing +Z
  fbx.scale.setScalar(0.01);
  fbx.updateMatrixWorld(true);
  const toe = fbx.getObjectByName('Bip01_L_Toe0').getWorldPosition(new THREE.Vector3());
  const foot = fbx.getObjectByName('Bip01_L_Foot').getWorldPosition(new THREE.Vector3());
  if (toe.z < foot.z) fbx.rotation.y = Math.PI;
  fbx.updateMatrixWorld(true);
  log(`  ${a.id}: oriented`);
  const box = new THREE.Box3().setFromObject(fbx, true);
  log(`  ${a.id}: bounds ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`);
  fbx.position.y = -box.min.y;
  fbx.updateMatrixWorld(true);
  fbx.animations = [];
  fbx.name = a.id;
  return { root: fbx, mesh, height: box.max.y - box.min.y };
}

// natural walking speed of a clip on this body (planted foot slides back at body speed)
function walkSpeed(root, clip) {
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const L = root.getObjectByName('Bip01_L_Toe0');
  const R = root.getObjectByName('Bip01_R_Toe0');
  const N = 60;
  const S = [];
  for (let i = 0; i < N; i++) {
    mixer.setTime((i / N) * clip.duration);
    root.updateMatrixWorld(true);
    S.push({ L: L.getWorldPosition(new THREE.Vector3()), R: R.getWorldPosition(new THREE.Vector3()) });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  const minL = Math.min(...S.map((s) => s.L.y));
  const minR = Math.min(...S.map((s) => s.R.y));
  let v = 0;
  let n = 0;
  const dt = clip.duration / N;
  for (let i = 0; i < N; i++) {
    const a = S[i];
    const b = S[(i + 1) % N];
    if (a.L.y < minL + 0.02 && b.L.y < minL + 0.02) (v += -(b.L.z - a.L.z) / dt), n++;
    if (a.R.y < minR + 0.02 && b.R.y < minR + 0.02) (v += -(b.R.z - a.R.z) / dt), n++;
  }
  return n ? v / n : 1.3;
}

// ---------------------------------------------------------------- main
const t0 = performance.now();
const src = await loadSources(params.has("analyze"));
log(`sources loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (params.has('analyze')) {
  window.__analysis = analyse(src);
  out.textContent = window.__analysis;
} else {
  const only = params.get('only');
  const pack = params.get('pack');
  const results = {};
  // shared motion packs: the representative body's skeleton (no mesh) + the clips
  for (const [key, pk] of Object.entries(pack ? PACKS : {})) {
    if (pack !== 'all' && pack !== key) continue;
    const { root } = await buildAvatar(AVATARS.find((a) => a.id === pk.avatar));
    log(`${key}: body ready`);
    const clips = [];
    for (const m of pk.motions) {
      const t1 = performance.now();
      clips.push(retargetClip(sourceFor(src, m), root, { fps: m.fps ?? 24, name: m.name, targetKeyOf: bipedKey, inPlace: true, loopBlend: m.loopBlend ?? 0, faceForward: true, staticKeys: /Hand(Thumb|Index|Middle|Ring|Pinky)/ }));
      { const tr = clips[clips.length - 1].tracks.find((t) => t.name.endsWith('.position')); let mn = Infinity, mx = -Infinity; for (let i = 0; i < tr.values.length; i += 3) { mn = Math.min(mn, tr.values[i + 2]); mx = Math.max(mx, tr.values[i + 2]); } log(`  ${m.name} ${((performance.now() - t1) / 1000).toFixed(1)} s  hipsZ ${mn.toFixed(1)}..${mx.toFixed(1)}`); }
      await new Promise((r) => setTimeout(r, 0));
    }
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    for (const m of meshes) m.removeFromParent();
    root.userData = { pack: key, from: pk.avatar };
    const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips });
    const bytes = new Uint8Array(glb);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    results[`motions-${key}`] = btoa(bin);
    log(`motions-${key}: ${(bytes.length / 1e6).toFixed(2)} MB, ${clips.length} clips (${clips.map((c) => c.name).join(', ')})`);
  }
  for (const a of pack ? [] : AVATARS) {
    if (only && a.id !== only) continue;
    const { root, height } = await buildAvatar(a);
    const clips = [];
    for (const m of MOTIONS) {
      if (m.for && !m.for.includes('crowd')) continue;
      const clip = retargetClip(sourceFor(src, m), root, {
        fps: 24,
        name: m.name,
        targetKeyOf: bipedKey,
        inPlace: m.inPlace !== false,
        loopBlend: m.loopBlend ?? 0,
        faceForward: !!m.cmu,
        staticKeys: /Hand(Thumb|Index|Middle|Ring|Pinky)/,
      });
      clips.push(clip);
    }
    const walk = clips.find((c) => c.name === 'walk');
    root.userData = { role: a.role, label: a.label, height: +height.toFixed(3), walkSpeed: walk ? +walkSpeed(root, walk).toFixed(3) : 1.3 };
    const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips, maxTextureSize: 1024 });
    const bytes = new Uint8Array(glb);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    results[a.id] = btoa(bin);
    log(`${a.id}: ${(bytes.length / 1e6).toFixed(2)} MB, ${clips.length} clips, height ${height.toFixed(2)} m, walk ${root.userData.walkSpeed} m/s`);
  }
  window.__people = results;
}
window.__done = true;
