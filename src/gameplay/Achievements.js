import { SIDDHIS } from '../config.js';

// Achievements: kept across every journey on this machine (localStorage), shown as a banner the
// moment one is earned and listed in the journal. Systems report what happens with
// event(name, data); the rules below decide what that earns. Test sessions (Chapter Select)
// never earn them.

const KEY = 'lov-achievements';

export const ACHIEVEMENTS = [
  { id: 'firstBlood', name: 'The First Ember', text: 'Slay your first Asura.' },
  { id: 'hundred', name: 'Kotwal’s Right Hand', text: 'Slay 100 Asuras.', goal: 100 },
  { id: 'parry', name: 'Steel Answers', text: 'Parry a blow perfectly.' },
  { id: 'parry25', name: 'The Unmoved Guard', text: 'Parry 25 blows.', goal: 25 },
  { id: 'finisher', name: 'Mercy of the Blade', text: 'Finish an Asura.' },
  { id: 'finisher25', name: 'Twenty-Five Mercies', text: 'Perform 25 finishers.', goal: 25 },
  { id: 'reflect', name: 'Return to Sender', text: 'Parry a Pishacha’s fire back into it.' },
  { id: 'shield', name: 'Bronze Breaks', text: 'Break a Kavacha’s guard.' },
  { id: 'damaru5', name: 'The Cosmic Drum', text: 'Throw five Asuras flat with one beat of the damaru.' },
  { id: 'trishul', name: 'Pinned', text: 'Pin an Asura with the trishul.' },
  { id: 'siddhi', name: 'The First Siddhi', text: 'Earn a siddhi.' },
  { id: 'siddhiAll', name: 'Mahayogi', text: 'Earn all twelve siddhis.' },
  { id: 'mini', name: 'Named and Ended', text: 'Defeat a chapter’s champion of the dark.' },
  { id: 'andhaka', name: 'Light in the Blind Dark', text: 'Defeat Andhaka.' },
  { id: 'flawless', name: 'Untouched', text: 'Defeat Andhaka without taking a blow.' },
  { id: 'beads', name: 'The Mala of Kashi', text: 'Find all 108 rudraksha.' },
  { id: 'shrines', name: 'Every Hidden Shrine', text: 'Offer a pranam at every hidden shrine in the galis.' },
  { id: 'flames', name: 'Maha Aarti', text: 'Light all five sacred flames.' },
  { id: 'race', name: 'Nauka Daud', text: 'Win the boat race.' },
  { id: 'raceFast', name: 'Faster than the Current', text: 'Win the boat race by ten seconds or more.' },
  { id: 'missions', name: 'Friend of Kashi', text: 'Help every person who asks.' },
  { id: 'events', name: 'Always Nearby', text: 'Answer five calls for help on the ghats and the river.', goal: 5 },
  { id: 'rooftops', name: 'Above the Ghats', text: 'Climb onto the rooftops.' },
  { id: 'vault', name: 'Free as the Kites', text: 'Vault 25 railings and walls.', goal: 25 },
  { id: 'kite', name: 'Bo Kata!', text: 'Cut a rival’s kite string in a patang duel.' },
  { id: 'fall', name: 'Roll With It', text: 'Land a long drop with a roll.' },
  { id: 'photo', name: 'A Postcard from Kashi', text: 'Take a picture in photo mode.' },
  { id: 'hard', name: 'Andhaka’s Own', text: 'Win a fight on Hard.' },
];

export class Achievements {
  constructor(game) {
    this.g = game;
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      d = null;
    }
    this.got = d?.got || {}; // id -> when (ms)
    this.count = d?.count || {}; // id -> progress
    this.bossHurt = false;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ got: this.got, count: this.count }));
    } catch {
      /* private mode */
    }
  }

  has(id) {
    return !!this.got[id];
  }

  unlock(id) {
    if (this.got[id] || this.g.testSession) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.got[id] = Date.now();
    this.save();
    this.g.ui.achievement?.(a.name, a.text);
    this.g.audio?.play('chime', { volume: 0.55, rate: 1.1 });
  }

  /** Count toward a goal; earns it at the goal. */
  bump(id, n = 1) {
    if (this.got[id] || this.g.testSession) return;
    this.count[id] = (this.count[id] || 0) + n;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a && this.count[id] >= (a.goal || 1)) this.unlock(id);
    else this.save();
  }

  progress(id) {
    return this.count[id] || 0;
  }

  event(name, d = {}) {
    const g = this.g;
    switch (name) {
      case 'kill':
        this.unlock('firstBlood');
        this.bump('hundred');
        if (d.mini) this.unlock('mini');
        if (d.boss) {
          this.unlock('andhaka');
          if (!this.bossHurt) this.unlock('flawless');
        }
        break;
      case 'parry':
        this.unlock('parry');
        this.bump('parry25');
        break;
      case 'finisher':
        this.unlock('finisher');
        this.bump('finisher25');
        break;
      case 'reflect':
        this.unlock('reflect');
        break;
      case 'shieldBreak':
        this.unlock('shield');
        break;
      case 'damaru':
        if (d.n >= 5) this.unlock('damaru5');
        break;
      case 'trishulPin':
        this.unlock('trishul');
        break;
      case 'siddhi':
        this.unlock('siddhi');
        if (d.count >= SIDDHIS.length) this.unlock('siddhiAll');
        break;
      case 'hurt':
        if (g.asuras?.list.some((a) => a.alive && a.K.boss)) this.bossHurt = true;
        break;
      case 'bossBegin':
        this.bossHurt = false;
        break;
      case 'beads':
        if (d.n >= 108) this.unlock('beads');
        break;
      case 'shrines':
        if (d.all) this.unlock('shrines');
        break;
      case 'flames':
        if (d.n >= 5) this.unlock('flames');
        break;
      case 'race':
        if (d.won) this.unlock('race');
        if (d.won && d.margin >= 10) this.unlock('raceFast');
        break;
      case 'mission':
        if (d.all) this.unlock('missions');
        break;
      case 'worldEvent':
        this.bump('events');
        break;
      case 'roof':
        this.unlock('rooftops');
        break;
      case 'vault':
        this.bump('vault');
        break;
      case 'kite':
        this.unlock('kite');
        break;
      case 'rollLanding':
        this.unlock('fall');
        break;
      case 'photo':
        this.unlock('photo');
        break;
      case 'win':
        if (g.settings?.difficulty === 'hard') this.unlock('hard');
        break;
      default:
        break;
    }
  }
}
