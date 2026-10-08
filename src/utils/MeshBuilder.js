import * as THREE from 'three';

// Accumulates boxes / quads / lathes into ONE BufferGeometry (position, normal, uv, color).
// The whole city is a handful of these, which keeps draw calls tiny on a laptop GPU.
// UVs are in metres / tile so textures keep a constant real-world scale on every surface.

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.matrix = null; // optional THREE.Matrix4 applied to everything added
    this.normalMatrix = new THREE.Matrix3();
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  setTransform(matrix) {
    this.matrix = matrix;
    if (matrix) this.normalMatrix.getNormalMatrix(matrix);
    return this;
  }

  _vertex(x, y, z, nx, ny, nz, u, v, color) {
    if (this.matrix) {
      _v.set(x, y, z).applyMatrix4(this.matrix);
      _n.set(nx, ny, nz).applyMatrix3(this.normalMatrix).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
    } else {
      this.pos.push(x, y, z);
      this.nor.push(nx, ny, nz);
    }
    this.uv.push(u, v);
    this.col.push(color.r, color.g, color.b);
  }

  // p: [x,y,z] corners in CCW order seen from the front, uvs: [[u,v] x4]
  quad(p0, p1, p2, p3, normal, uvs, color, color2 = color) {
    const base = this.vertexCount;
    this._vertex(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], uvs[0][0], uvs[0][1], color2);
    this._vertex(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], uvs[1][0], uvs[1][1], color2);
    this._vertex(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], uvs[2][0], uvs[2][1], color);
    this._vertex(p3[0], p3[1], p3[2], normal[0], normal[1], normal[2], uvs[3][0], uvs[3][1], color);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Axis-aligned box in a local frame rotated by `yaw` around +Y, centred at (cx, cy, cz).
   * opts.tile: metres per texture repeat. opts.grime: 0..1 darkening at the bottom edge.
   * opts.faces: subset of ['px','nx','py','ny','pz','nz'] to emit (default: all but bottom).
   */
  box(cx, cy, cz, w, h, d, yaw, color, opts = {}) {
    const tile = opts.tile ?? 2;
    const faces = opts.faces ?? ['px', 'nx', 'py', 'pz', 'nz'];
    const ou = opts.uvOffset?.[0] ?? 0;
    const ov = opts.uvOffset?.[1] ?? 0;
    const col = color instanceof THREE.Color ? color : _c.set(color);
    const top = col.clone();
    const bottom = col.clone().multiplyScalar(1 - (opts.grime ?? 0));
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // local -> world (rotation about Y): x' = x*c + z*s, z' = -x*s + z*c
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const N = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const U = (a) => a / tile;
    const yb = (cy - hh) / tile;
    const yt = (cy + hh) / tile;
    if (faces.includes('pz'))
      this.quad(P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd), N(0, 0, 1),
        [[ou, yb + ov], [ou + U(w), yb + ov], [ou + U(w), yt + ov], [ou, yt + ov]], top, bottom);
    if (faces.includes('nz'))
      this.quad(P(hw, -hh, -hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(hw, hh, -hd), N(0, 0, -1),
        [[ou, yb + ov], [ou + U(w), yb + ov], [ou + U(w), yt + ov], [ou, yt + ov]], top, bottom);
    if (faces.includes('px'))
      this.quad(P(hw, -hh, hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(hw, hh, hd), N(1, 0, 0),
        [[ou + 0.37, yb + ov], [ou + 0.37 + U(d), yb + ov], [ou + 0.37 + U(d), yt + ov], [ou + 0.37, yt + ov]], top, bottom);
    if (faces.includes('nx'))
      this.quad(P(-hw, -hh, -hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(-hw, hh, -hd), N(-1, 0, 0),
        [[ou + 0.61, yb + ov], [ou + 0.61 + U(d), yb + ov], [ou + 0.61 + U(d), yt + ov], [ou + 0.61, yt + ov]], top, bottom);
    if (faces.includes('py'))
      this.quad(P(-hw, hh, hd), P(hw, hh, hd), P(hw, hh, -hd), P(-hw, hh, -hd), N(0, 1, 0),
        [[ou, ov], [ou + U(w), ov], [ou + U(w), ov + U(d)], [ou, ov + U(d)]], top, top);
    if (faces.includes('ny'))
      this.quad(P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, -hh, hd), P(-hw, -hh, hd), N(0, -1, 0),
        [[ou, ov], [ou + U(w), ov], [ou + U(w), ov + U(d)], [ou, ov + U(d)]], bottom, bottom);
  }

  /**
   * Surface of revolution around +Y at (cx, cy, cz).
   * profile: [[radius, y], ...] bottom to top. radiusFn(theta, t) optionally modulates radius.
   */
  lathe(cx, cy, cz, profile, segments, color, opts = {}) {
    const tile = opts.tile ?? 2;
    const radiusFn = opts.radiusFn;
    const col = color instanceof THREE.Color ? color : _c.set(color).clone();
    const yaw = opts.yaw ?? 0;
    const rings = profile.length;
    const base = this.vertexCount;
    // positions first, normals from neighbours afterwards
    const pts = [];
    for (let i = 0; i < rings; i++) {
      const [r, y] = profile[i];
      const t = i / (rings - 1);
      for (let j = 0; j <= segments; j++) {
        const th = (j / segments) * Math.PI * 2 + yaw;
        const rr = radiusFn ? r * radiusFn(th, t) : r;
        pts.push([cx + Math.cos(th) * rr, cy + y, cz + Math.sin(th) * rr, th, y]);
      }
    }
    const row = segments + 1;
    const get = (i, j) => pts[Math.max(0, Math.min(rings - 1, i)) * row + ((j + segments) % segments)];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j <= segments; j++) {
        const p = pts[i * row + j];
        const a = get(i, j + 1);
        const b = get(i, j - 1);
        const up = get(i + 1, j);
        const dn = get(i - 1, j);
        const tx = a[0] - b[0];
        const ty = a[1] - b[1];
        const tz = a[2] - b[2];
        const vx = up[0] - dn[0];
        const vy = up[1] - dn[1];
        const vz = up[2] - dn[2];
        _n.set(ty * vz - tz * vy, tz * vx - tx * vz, tx * vy - ty * vx);
        if (_n.lengthSq() < 1e-10) _n.set(0, 1, 0);
        _n.normalize();
        // make sure normals face outward
        const ox = p[0] - cx;
        const oz = p[2] - cz;
        if (_n.x * ox + _n.z * oz < 0 && Math.abs(_n.y) < 0.99) _n.negate();
        if (opts.colorFn) _c.copy(opts.colorFn(p[3], i / (rings - 1)));
        else _c.copy(col).multiplyScalar(opts.shadeFn ? opts.shadeFn(p[3], i / (rings - 1)) : 1);
        const perim = (j / segments) * Math.PI * 2 * Math.max(0.3, profile[i][0]);
        this._vertex(p[0], p[1], p[2], _n.x, _n.y, _n.z, perim / tile, p[4] / tile, _c);
      }
    }
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const a = base + i * row + j;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  cylinder(cx, cy, cz, rBottom, rTop, h, segments, color, opts = {}) {
    this.lathe(cx, cy, cz, [[rBottom, 0], [rTop, h]], segments, color, opts);
    if (opts.capTop !== false) this.disc(cx, cy + h, cz, rTop, segments, color, opts.tile ?? 2);
  }

  disc(cx, cy, cz, r, segments, color, tile = 2) {
    const col = color instanceof THREE.Color ? color : _c.set(color).clone();
    const base = this.vertexCount;
    this._vertex(cx, cy, cz, 0, 1, 0, cx / tile, cz / tile, col);
    for (let j = 0; j <= segments; j++) {
      const th = (j / segments) * Math.PI * 2;
      const x = cx + Math.cos(th) * r;
      const z = cz + Math.sin(th) * r;
      this._vertex(x, cy, z, 0, 1, 0, x / tile, z / tile, col);
    }
    for (let j = 0; j < segments; j++) this.idx.push(base, base + j + 2, base + j + 1);
  }

  // Merge an existing (non-indexed or indexed) three.js geometry with a matrix and flat colour.
  geometry(geom, matrix, color) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    const col = color instanceof THREE.Color ? color : _c.set(color).clone();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.vertexCount;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      if (this.matrix) {
        _v.applyMatrix4(this.matrix);
        _n.applyMatrix3(this.normalMatrix).normalize();
      }
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.col.push(col.r, col.g, col.b);
      this.idx.push(base + i);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const count = this.vertexCount;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
