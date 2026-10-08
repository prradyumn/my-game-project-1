import { buildGalis } from './Galis.js';
import { WORLD } from '../config.js';
import { buildCity } from './City.js';
import { buildGhats } from './Ghats.js';
import { buildProps } from './Props.js';
import { buildStreetLife } from './StreetLife.js';
import { Akhara } from './Akhara.js';
import { buildTerrain } from './Terrain.js';
import { CITY_BACK_V, frameAtX, frameToWorld, generateLayout } from './WorldLayout.js';

// Builds the static world of Kashi from the layout, and its physics.

export function buildWorld(scene, textures, physics) {
  const t0 = performance.now();
  const layout = generateLayout();
  const terrain = buildTerrain(textures, physics);
  scene.add(terrain.mesh);
  const ghats = buildGhats(layout, textures, physics);
  scene.add(ghats.mesh);
  const city = buildCity(layout, textures, physics);
  scene.add(city.group);
  const props = buildProps(layout, textures, physics, city.flags);
  scene.add(props.group);
  const street = buildStreetLife(layout, physics);
  scene.add(street.mesh);
  const akhara = new Akhara({ scene, physics, textures });
  const galis = buildGalis(layout, textures, physics, scene);
  layout.clutter = [...street.clutter, ...akhara.clutter, ...galis.clutter];
  addBoundaries(physics);
  console.info(`[world] built in ${(performance.now() - t0).toFixed(0)} ms — ${layout.buildings.length} buildings, ${city.stats.windows} windows, ${physics.colliderCount} colliders`);
  return { layout, terrain, ghats, city, props, street, akhara, galis };
}

// Invisible walls: behind the city, both ends of the map, and the far side of the sandbank.
function addBoundaries(physics) {
  for (let x = WORLD.xMin; x < WORLD.xMax; x += 40) {
    const f = frameAtX(x + 20);
    const p = frameToWorld(f, 0, CITY_BACK_V);
    physics.addBox(p.x, 20, p.z, 44, 60, 2, f.yaw);
  }
  physics.addBox(WORLD.xMin, 0, (WORLD.zMin + WORLD.zMax) / 2, 2, 80, WORLD.zMax - WORLD.zMin + 200, 0);
  physics.addBox(WORLD.xMax, 0, (WORLD.zMin + WORLD.zMax) / 2, 2, 80, WORLD.zMax - WORLD.zMin + 200, 0);
  physics.addBox(0, 0, WORLD.zMax, WORLD.xMax - WORLD.xMin, 80, 2, 0);
}

