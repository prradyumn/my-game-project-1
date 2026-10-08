import './ui/style.css';
import { Game } from './core/Game.js';
import { installHeightFog } from './world/Atmosphere.js';
import { playIntro } from './ui/IntroVideo.js';

installHeightFog(); // must run before any material is created

// PRADY: Legend of Kashi — entry point. The gameplay montage plays over the loading screen.
playIntro();
const game = new Game(document.getElementById('game'), document.getElementById('ui'));
game.init().catch((err) => {
  console.error(err);
  const s = document.querySelector('#loading .status');
  if (s) s.textContent = `Something went wrong: ${err.message}. Check the console (WebGL2 is required).`;
});
window.__game = game; // handy for debugging in the console
