// Level streaming: the heavy things of the world start as light stand-ins (a model simplified a
// hundredfold, textures an eighth the size: loaded with the game, a few hundred KB each), and the
// full model is fetched in the background only as Prady comes within reach of it, swapped in when
// it lands, and freed again when he has gone far enough (a margin between the two so walking the
// line never loads and drops it over and over). Checked twice a second.
//
// add({ name, near, far, url, distance(pos) | at:{x,z}, apply(gltf), drop() })

export class Streamer {
  constructor(assets) {
    this.assets = assets;
    this.items = [];
    this.t = 0;
  }

  add(item) {
    item.state = 'low';
    this.items.push(item);
    return item;
  }

  update(dt, pos) {
    this.t -= dt;
    if (this.t > 0 || !pos) return;
    this.t = 0.5;
    for (const it of this.items) {
      const d = it.distance ? it.distance(pos) : Math.hypot(pos.x - it.at.x, pos.z - it.at.z);
      if (it.state === 'low' && d < it.near) {
        it.state = 'loading';
        this.assets
          .gltfAsync(it.url)
          .then((g) => {
            if (it.state !== 'loading' || !g) {
              if (g) disposeObject(g.scene);
              return;
            }
            it.full = g;
            it.apply(g);
            it.state = 'full';
          })
          .catch(() => (it.state = 'low'));
      } else if (it.state === 'full' && d > it.far) {
        it.drop();
        disposeObject(it.full.scene);
        it.full = null;
        it.state = 'low';
      } else if (it.state === 'loading' && d > it.far) it.state = 'low'; // (abandoned: freed as it lands)
    }
  }

  /** What is loaded now (for the debug overlay and tests). */
  status() {
    return this.items.map((i) => `${i.name}:${i.state}`).join(' ');
  }
}

/** Free a loaded model's geometry, materials and textures. */
export function disposeObject(root) {
  root?.traverse((o) => {
    o.geometry?.dispose();
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m) continue;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) m[k]?.dispose();
      m.dispose();
    }
  });
}
