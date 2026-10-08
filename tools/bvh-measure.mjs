// Measure CMU takes for baking: sideways travel relative to facing (which way a strafe goes),
// and the hands' speed peak (the moment a strike lands). node tools/bvh-measure.mjs <dir> '<json jobs>'
import fs from 'node:fs';
import * as THREE from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
const dir = process.argv[2];
const jobs = JSON.parse(process.argv[3]);
for (const j of jobs) {
  const r = new BVHLoader().parse(fs.readFileSync(`${dir}/${j.f}.bvh`, 'utf8'));
  const root = new THREE.Group();
  root.add(r.skeleton.bones[0]);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(r.clip).play();
  const B = {};
  root.traverse((o) => o.isBone && (B[o.name] = o));
  const get = (n) => B[n].getWorldPosition(new THREE.Vector3());
  const at = (t) => { mixer.setTime(t); root.updateMatrixWorld(true); };
  at(j.s);
  const h0 = get('Hips');
  const facing0 = (() => { const l = get('LeftUpLeg'), rr = get('RightUpLeg'); const side = new THREE.Vector3().subVectors(l, rr); return new THREE.Vector3(-side.z, 0, side.x).normalize(); })();
  at(j.e);
  const h1 = get('Hips');
  const d = new THREE.Vector3().subVectors(h1, h0); d.y = 0;
  const left = new THREE.Vector3(facing0.z, 0, -facing0.x); // hmm: facing x up
  const out = { f: j.f, travel: +d.length().toFixed(1), fwd: +d.dot(facing0).toFixed(1), side: +d.dot(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing0)).toFixed(1) };
  if (j.hand) {
    let prev = null; const sp = [];
    for (let t = j.s; t <= j.e; t += 1 / 60) {
      at(t);
      const p = new THREE.Vector3().addVectors(get('LeftHand'), get('RightHand')).multiplyScalar(0.5);
      const pl = get('LeftHand'), pr = get('RightHand');
      if (prev) sp.push({ t, v: Math.max(pl.distanceTo(prev.l), pr.distanceTo(prev.r)) * 60 });
      prev = { l: pl, r: pr };
    }
    const top = [...sp].sort((a, b) => b.v - a.v)[0];
    out.peakT = +top.t.toFixed(2);
    out.peakFrac = +((top.t - j.s) / (j.e - j.s)).toFixed(2);
    out.peakV = +top.v.toFixed(0);
  }
  if (j.abs) {
    // absolute hip / foot heights at given times (restHipY for takes whose first frame lies)
    out.abs = j.abs.map((t) => { at(t); return `${t}:hip ${get('Hips').y.toFixed(2)} foot ${get('LeftFoot').y.toFixed(2)}`; }).join('  ');
  }
  if (j.hips) {
    // hip height over the take (in leg lengths): where a roll, a fall or a get-up happens
    at(0);
    const leg = get('Hips').y - get('LeftFoot').y;
    const rows = [];
    for (let t = 0; t <= r.clip.duration; t += j.hips) {
      at(t);
      const h = get('Hips');
      rows.push(`${t.toFixed(1)}:${((h.y - get('LeftFoot').y) / leg).toFixed(2)}`);
    }
    out.hips = rows.join(' ');
  }
  if (j.scan) {
    // local maxima of hand speed over the whole take: candidate strikes
    let prev = null; const sp = [];
    for (let t = 0; t <= r.clip.duration; t += 1 / 30) {
      at(t);
      const pl = get('LeftHand'), pr = get('RightHand');
      if (prev) sp.push({ t, v: Math.max(pl.distanceTo(prev.l), pr.distanceTo(prev.r)) * 30, hand: pl.distanceTo(prev.l) > pr.distanceTo(prev.r) ? 'L' : 'R' });
      prev = { l: pl, r: pr };
    }
    out.peaks = sp.filter((x, i) => i > 2 && i < sp.length - 3 && x.v >= Math.max(...sp.slice(i - 6, i + 7).map((y) => y.v)) && x.v > j.scan).map((x) => `${x.t.toFixed(2)}${x.hand}:${x.v.toFixed(0)}`).join(' ');
  }
  console.log(JSON.stringify(out));
}
