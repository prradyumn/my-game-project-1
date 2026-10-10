// node render.mjs name[:blur] ...  -> frames/<name>/  (1920x1080, 30 fps; :blur = 60 Hz sub-frames)
import { open } from './rig.mjs';
const list = process.argv.slice(2);
const s = await open();
await s.begin(); await s.lib(); await s.manual();
for (const item of list) {
  const [name, mode] = item.split(':');
  try {
    const dur = await s.shot(name);
    await s.rec(name, dur + 0.3, { blur: mode === 'blur' });
  } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); }
}
console.log('errors:', s.errs.slice(0, 6).join(' | '));
await s.close();
