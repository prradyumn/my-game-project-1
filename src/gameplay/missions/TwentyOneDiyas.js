import { segmentForX } from '../../world/WorldLayout.js';
import { ghatById, waterEdge } from './places.js';

// Twenty-One Diyas. Kamla Amma made a vow for her late husband: twenty-one lamps on the Ganga
// at dusk, set adrift from three different ghats "so he finds one wherever he is walking".
// Her hands shake too much now. Float them for her (F at the water's edge, in the water or
// from the boat), then come back and tell her.

const NEED = 21;
const GHATS = 3;

export default function twentyOneDiyas(game) {
  const dash = ghatById('dashashwamedh');
  return {
    id: 'diyas',
    title: 'Twenty-One Diyas',
    giver: { name: 'Kamla Amma', avatarId: 'Female_Adult_15', clip: 'wait', hours: [16.5, 22.5], at: () => waterEdge(dash, dash.width * 0.14) },
    offer: [
      ['Kamla Amma', 'Beta, forty-one years I was married to a man who walked every ghat of this city before breakfast.'],
      ['Kamla Amma', 'I promised him twenty-one diyas, from three different ghats, so he finds one wherever he is walking. My hands shake too much now.'],
    ],
    start(m) {
      m.state = { n: 0, ghats: new Set() };
      game.ui.toast('Deep Daan', 'F at the water’s edge, in the river or from your boat', 4);
    },
    update(m) {
      const s = m.state;
      if (s.n >= NEED && s.ghats.size >= GHATS) {
        m.objective('Tell Kamla Amma at Dashashwamedh that the lamps are on the river.', 1);
        if (m.giver) m.mark('objective', m.giver);
        return;
      }
      const g = s.ghats.size < GHATS ? ` · from ${s.ghats.size}/${GHATS} ghats` : '';
      m.objective(`Float diyas on the Ganga: ${Math.min(s.n, NEED)}/${NEED}${g}`, Math.min(s.n, NEED) / NEED);
    },
    on(m, event, data) {
      if (event !== 'diya') return;
      const s = m.state;
      s.n++;
      const seg = segmentForX(data.x);
      if (seg) s.ghats.add(seg.id);
      if (s.n === NEED && s.ghats.size < GHATS) game.ui.toast('Twenty-one!', `But only from ${s.ghats.size} ghat${s.ghats.size > 1 ? 's' : ''}. Amma asked for three.`, 4);
    },
    interact(m) {
      const s = m.state;
      if (s.n < NEED || s.ghats.size < GHATS || !m.giver || !m.near(m.giver, 2.8)) return null;
      return { prompt: 'Tell Kamla Amma', action: () => m.done() };
    },
    outro: [
      ['Kamla Amma', 'I saw them from here, drifting past Kedar… twenty-one little stars on the water.'],
      ['Kamla Amma', 'He always said the river carries what we cannot. Jeete raho, beta. Jeete raho.'],
    ],
    reward: { punya: 21, note: "Kamla Amma's blessing" },
  };
}
