import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// The build leaves out the source copies of models the game never loads: the originals beside
// their meshopt/KTX2 copies in public/assets/opt (tools/ still read them in development), and
// superseded motion files. Only the built dist/ is touched (public/ stays as it is), and only a
// file no source file names (recomputed every build) in the folders that have opt copies.
function pruneUnusedOriginals() {
  return {
    name: 'prune-unused-originals',
    apply: 'build',
    closeBundle() {
      const root = process.cwd();
      const dist = path.join(root, 'dist', 'assets');
      const text = [];
      (function walk(d) {
        for (const f of fs.readdirSync(d)) {
          const p = path.join(d, f);
          if (fs.statSync(p).isDirectory()) walk(p);
          else if (/\.(js|html|json)$/.test(f)) text.push(fs.readFileSync(p, 'utf8'));
        }
      })(path.join(root, 'src'));
      text.push(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
      const all = text.join('\n');
      let bytes = 0;
      let n = 0;
      for (const dir of ['people', 'villains', 'characters', 'models', 'animals']) {
        const d = path.join(dist, dir);
        if (!fs.existsSync(d)) continue;
        for (const f of fs.readdirSync(d)) {
          const named = all.includes(`/${dir}/${f}`.replace(/^/, '')) && !all.includes(`opt/${dir}/${f}`);
          const named2 = all.includes('${A}/' + `${dir}/${f}`);
          if (named || named2) continue;
          const p = path.join(d, f);
          bytes += fs.statSync(p).size;
          fs.rmSync(p);
          n++;
        }
      }
      console.log(`[prune] left ${n} unused source files out of dist (${(bytes / 1e6).toFixed(1)} MB)`);
    },
  };
}

export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
  plugins: [pruneUnusedOriginals()],
});
