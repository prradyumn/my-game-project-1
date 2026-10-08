// Every voiced line of the five chapters, in one place (pure data: Node can read it, so
// tools/voice-lines.mjs turns it into speech with Gemini TTS). A line: key -> [who, text].
// The key is also the voice file: public/assets/audio/voice/<key>.mp3.

// who speaks, with which Gemini voice and how
export const CAST = {
  Prady: { voice: 'Puck', style: 'a young man from Varanasi in his twenties, earnest, warm and brave, with a light Indian accent' },
  Narrator: { voice: 'Charon', style: 'an old storyteller of Kashi telling a sacred legend by lamplight, deep, slow and reverent, with a light Indian accent' },
  'Pandit Shankar': { voice: 'Iapetus', style: 'an elderly Banarasi priest, gentle and wise, unhurried, with an Indian accent' },
  'Guru Ramdas': { voice: 'Fenrir', style: 'an old wrestling guru, gruff and blunt but kind underneath, with a strong Indian accent' },
  Amma: { voice: 'Gacrux', style: 'an elderly Indian woman who runs a temple kitchen, motherly, brisk and warm, with an Indian accent' },
  'The Sadhu': { voice: 'Algenib', style: 'an ancient wandering ascetic, calm, amused and mysterious, low voice, Indian accent' },
  'Acharya Mishra': { voice: 'Orus', style: 'a dignified temple priest who leads the evening Ganga aarti, measured and proud, Indian accent' },
  Kallu: { voice: 'Alnilam', style: 'a weathered keeper of the funeral fires at Manikarnika, quiet, dry and sad, with a Banarasi accent' },
  'Bhairav Baba': { voice: 'Rasalgethi', style: 'an intense old priest of Kaal Bhairav, low and commanding, almost a growl, Indian accent' },
  'Raja’s Steward': { voice: 'Sadaltager', style: 'an old, courteous steward of the Ramnagar Fort, formal and a little pompous, Indian accent' },
  Andhaka: { voice: 'Algieba', style: 'a vast ancient demon of darkness, slow, deep, contemptuous, echoing', pitch: 0.78 },
};

export const LINES = {
  // ------------------------------------------------------------- I · The Goddess's Sword (Assi)
  'ch1/legend': ['Narrator', 'When the goddess Durga slew the demons Shumbha and Nishumbha, she cast her sword down at the edge of Kashi. Where it struck the earth, a river sprang up: the Assi.'],
  'ch1/meet-01': ['Pandit Shankar', 'You came. Good. Sit, sit... no, stand, there is no time to sit.'],
  'ch1/meet-02': ['Pandit Shankar', 'Every night the river grows darker. Last night something walked up these steps out of the water. It had a body of smoke, and eyes like coals.'],
  'ch1/meet-03': ['Prady', 'Asuras? Panditji, those are stories.'],
  'ch1/meet-04': ['Pandit Shankar', 'In Kashi, beta, the stories are the truth that is tired of waiting. The five flames held them down. Now the flames are dark, and the old ones are rising.'],
  'ch1/meet-05': ['Pandit Shankar', 'The Goddess left her sword here once. You will need a blade of your own. Go to Tulsi Ghat. Guru Ramdas will make a fighter of you, if anyone can.'],
  'ch1/dusk-01': ['Pandit Shankar', 'So, the guru gave you his grandfather’s talwar. Then he believes in you. So do I.'],
  'ch1/dusk-02': ['Pandit Shankar', 'The sun is going down. Stand with me here. When the dark comes out of the water, we will see what it wants.'],
  'ch1/rise-01': ['Pandit Shankar', 'There! Out of the river! Prady, they are coming up the steps!'],
  'ch1/won-01': ['Prady', 'They burned away... like paper in a fire.'],
  'ch1/won-02': ['Pandit Shankar', 'Then light the flame, quickly, before more come. Durga’s fire was always stronger than their dark.'],
  'ch1/lit-01': ['Pandit Shankar', 'Jai Maa Durga! Do you feel it? The river is breathing easier already.'],
  'ch1/lit-02': ['Pandit Shankar', 'One flame of five. Go north to Kedar Ghat. Amma runs the temple kitchen there. Tell her Shankar sent you. And eat something, you look half-starved.'],

  // ------------------------------------------------------------- II · Annapurna's Kitchen (Kedar)
  'ch2/legend': ['Narrator', 'Kashi is the city of Annapurna, the Mother who feeds the world. At Kedar Ghat, they say, Shiva himself once rose out of a devotee’s humble pot of khichdi.'],
  'ch2/meet-01': ['Amma', 'Shankar sent you? Then you can carry things. Two hundred pilgrims are on these steps, and not one grain of rice in my pot.'],
  'ch2/meet-02': ['Amma', 'When the flame went dark, the bhandara stopped. No food for the hungry in Annapurna’s own city! Shameful.'],
  'ch2/meet-03': ['Amma', 'Go up into the galis. Rice from Gopal, dal from the Agarwal shop, ghee from Mohan, salt and turmeric from Sushila. Run!'],
  'ch2/rice': ['Prady', 'Amma sent me for rice. Gopal-bhai, she says put it on her account.'],
  'ch2/dal': ['Prady', 'Two kilos of toor dal, for Amma’s kitchen.'],
  'ch2/spice': ['Prady', 'Salt and haldi for the bhandara, Sushila-ji.'],
  'ch2/ghee': ['Prady', 'And the ghee... hey! That monkey has the ghee! Come back here!'],
  'ch2/ghee-back': ['Prady', 'Got it! Sorry, friend, this belongs to the hungry. Here, have a banana instead.'],
  'ch2/cook-01': ['Amma', 'All of it? Good boy. Now stir. Slowly, steadily, with love. Khichdi knows when you are angry.'],
  'ch2/cook-02': ['Amma', 'Smell that. That is how Kashi used to smell every evening. Now, serve them. The old ones first.'],
  'ch2/serve-last': ['The Sadhu', 'For me also? I came from very far. The mountains are cold this time of year.'],
  'ch2/sadhu-01': ['The Sadhu', 'Mm. Rice, dal, ghee and a little salt. In the high Himalaya I am called Kedar. But this... this is why I stayed in Kashi.'],
  'ch2/sadhu-02': ['The Sadhu', 'A full belly and a full heart. Light the flame, young one. I will be watching from the steps.'],
  'ch2/lit-01': ['Amma', 'He is gone? Where did that old baba go? Hai Ram... the flame is burning! Annapurna Mata ki jai!'],
  'ch2/lit-02': ['Amma', 'Take this. Annapurna’s prasad. Go to Dashashwamedh; Acharya Mishra will need strong arms for the evening aarti.'],

  // ------------------------------------------------------------- III · The Ten Horses (Dashashwamedh)
  'ch3/legend': ['Narrator', 'To welcome Shiva home to Kashi, Brahma, the creator, performed ten great horse sacrifices on these steps. The ghat still carries their name: Dashashwamedh.'],
  'ch3/meet-01': ['Acharya Mishra', 'You are the one who lit the flames at Assi and Kedar? Then perhaps you can help me light the aarti.'],
  'ch3/meet-02': ['Acharya Mishra', 'For the aarti tonight I need Ganga jal from the middle of the river, where the water runs clean and fast. Take the boat. Fill this kalash.'],
  'ch3/water': ['Prady', 'Clear as glass out here. Har Har Gange.'],
  'ch3/back-01': ['Acharya Mishra', 'Good. Now rest your arms. Take the boat out again at dusk and watch from the water. Everyone should see the aarti from the river once.'],
  'ch3/aarti-01': ['Acharya Mishra', 'Om Jai Gange Mata... Shree Jai Gange Mata...'],
  'ch3/attack-01': ['Acharya Mishra', 'The lamps are flickering... what is in the water? Prady! Come back to the steps! Protect the aarti!'],
  'ch3/won-01': ['Acharya Mishra', 'Not one lamp went out. Not one. Light the flame of the Ten Sacrifices, Prady. You have earned it more than any of us.'],
  'ch3/lit-01': ['Acharya Mishra', 'Three flames. Tonight Kashi will sleep. But the darkest place on these ghats is Manikarnika, where the fires never go out. Go to Kallu there. He sees what the rest of us cannot.'],

  // ------------------------------------------------------------- IV · The Lost Earring (Manikarnika / Ratneshwar)
  'ch4/legend': ['Narrator', 'While Shiva and Parvati bathed in a pool here, her jewelled earring, the manikarnika, fell into the water. Shiva searches for it still, the legend says, among the fires of the burning ghat.'],
  'ch4/meet-01': ['Kallu', 'You are not here to burn anyone. So you are here to ask something.'],
  'ch4/meet-02': ['Kallu', 'Every night I see a light under the water, by the leaning temple. Green and gold. My grandfather said it is the Mother’s earring, still waiting to be found.'],
  'ch4/meet-03': ['Kallu', 'The Asuras want it. They circle that temple in the deep. Swim, if you are brave. Take a long breath first.'],
  'ch4/glint': ['Prady', 'Just a brass lota. The light is coming from inside the temple.'],
  'ch4/found': ['Prady', 'The earring... it is warm, like it was worn a moment ago.'],
  'ch4/ambush': ['Kallu', 'They followed you up out of the water! Fight, boy! The fires are with you!'],
  'ch4/won-01': ['Kallu', 'Give it to the river and to the flame together. The Mother lost it so that we would have to search. Searching is the prayer.'],
  'ch4/lit-01': ['Kallu', 'Four. One left: the Thousand Lamps at Panchganga. The dogs have been howling there all week. In Kashi, when the dogs howl, it is Bhairav calling.'],

  // ------------------------------------------------------------- V · Kaal Bhairav's Watch (Panchganga)
  'ch5/legend': ['Narrator', 'Kaal Bhairav is the guardian of Kashi, the Kotwal of the city. His mount is a black dog. Once, Shiva’s own darkness took the shape of a blind demon, Andhaka, and it was cut down here. Darkness forgets, but it does not die.'],
  'ch5/dog-01': ['Prady', 'A black dog... are you the one who has been howling? All right, lead the way.'],
  'ch5/temple-01': ['Bhairav Baba', 'The Kotwal’s dog brought you. Then the Kotwal wants you. Bow.'],
  'ch5/temple-02': ['Bhairav Baba', 'Andhaka is waking under Panchganga. He is the dark that was cut from Shiva himself. Swords alone will not hold him.'],
  'ch5/temple-03': ['Bhairav Baba', 'The Thousand Lamps must burn all at once. For that, you need the Raja’s mustard oil, pressed for the Ram Lila, stored in the Ramnagar Fort across the river. Go. The dog will wait.'],
  'ch5/fort-01': ['Raja’s Steward', 'The royal oil? For Bhairav Baba? Hmm. The Maharaja would want it so. Take it, and the Maharaja’s blessings.'],
  'ch5/fort-02': ['Raja’s Steward', 'And young man... hurry. The river looks very black tonight.'],
  'ch5/rise-01': ['Andhaka', 'Little flame-lighter. You have kindled four lamps against a night that is older than the gods.'],
  'ch5/rise-02': ['Prady', 'Then I will light the fifth, and you can go back to sleep.'],
  'ch5/phase-1': ['Andhaka', 'Come, children of the deep! Put out his little light!'],
  'ch5/phase-2': ['Andhaka', 'I am the blindness in every eye! I cannot be cut!'],
  'ch5/fall': ['Andhaka', 'The lamps... too many lamps...'],
  'ch5/lit-01': ['Bhairav Baba', 'Jai Kaal Bhairav! The Kotwal keeps his city. Look, Prady. Look at the river.'],
  'ch5/end-01': ['Narrator', 'And so the five flames of Kashi burned again, and Mother Ganga shone like the sky. They still tell it on the ghats at night: the legend of Varanasi, and the boy who lit the lamps.'],
};

/** [[who, text, voiceKey], ...] for a list of keys (the dialogue box / cutscenes take these). */
export function lines(...keys) {
  return keys.map((k) => {
    const l = LINES[k];
    if (!l) throw new Error(`no line ${k}`);
    return [l[0], l[1], k];
  });
}
