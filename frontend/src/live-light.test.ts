import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIGHT, glassTint, liveLight, sunDirection, topBrightness } from "./live-light.ts";
import { STYLES } from "./looks.ts";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("fork: the realistic style is a homely style with live light", () => {
  const real = STYLES.find((s) => s.id === "real");
  assert.ok(real);
  assert.equal(real.live, true);
  assert.equal(real.natural, true);
  assert.equal(real.group, "homely");
});

test("fork: the sun's direction turns with its azimuth and the plan's north, like the house's shadow", () => {
  // the shadow code's convention, toSun = [sin(a), -cos(a)]: with north up, a sun due south (180°) lies towards +z
  const south = sunDirection({ elevation: 30, azimuth: 180 }, 0);
  assert.ok(near(south[0], 0, 1e-9) && south[2] > 0.8 && near(south[1], 0.5, 1e-9));
  const east = sunDirection({ elevation: 0.0001, azimuth: 90 }, 0);
  assert.ok(east[0] > 0.99);
  // the plan turned by 90°: the same sun comes from the other axis
  const turned = sunDirection({ elevation: 30, azimuth: 180 }, 90);
  assert.ok(turned[0] < -0.8);
  // a sun below the horizon never lights from below
  assert.ok(sunDirection({ elevation: -20, azimuth: 0 }, 0)[1] > 0);
  for (const v of [south, east, turned]) assert.ok(near(Math.hypot(...v), 1));
});

test("fork: noon is bright and white, sunset warm, night dark", () => {
  const noon = liveLight({ elevation: 55, azimuth: 180 }, 0, null);
  const sunset = liveLight({ elevation: 3, azimuth: 280 }, 0, null);
  const night = liveLight({ elevation: -25, azimuth: 0 }, 0, null);
  assert.ok(topBrightness(noon) > 0.95 && topBrightness(noon) < 1.25, `noon ${topBrightness(noon)}`);
  // linear light: 0.1 already shows as about a third of full brightness on screen
  assert.ok(topBrightness(night) < 0.1, `night ${topBrightness(night)}`);
  assert.ok(topBrightness(sunset) < topBrightness(noon));
  // warm: red well above blue in the low sun's light
  assert.ok(sunset.direct[0] > sunset.direct[2] * 1.6);
  // neutral at noon
  assert.ok(noon.direct[0] - noon.direct[2] < 0.06);
  // no direct sun at night
  assert.deepEqual(night.direct.map((v) => +v.toFixed(6)), [0, 0, 0]);
});

test("fork: clouds take the direct sun and leave an even, grey light; rain makes it darker", () => {
  const clear = liveLight({ elevation: 45, azimuth: 180 }, 0, { cloud: 0, rain: 0, snow: 0, fog: 0 });
  const overcast = liveLight({ elevation: 45, azimuth: 180 }, 0, { cloud: 1, rain: 0, snow: 0, fog: 0 });
  const rainy = liveLight({ elevation: 45, azimuth: 180 }, 0, { cloud: 1, rain: 1, snow: 0, fog: 0 });
  assert.ok(overcast.direct[0] < clear.direct[0] * 0.2);
  // the sky light grows with the clouds, so an overcast day is not much darker on top – just flat
  assert.ok(overcast.sky[0] > clear.sky[0]);
  assert.ok(topBrightness(overcast) > 0.75 && topBrightness(overcast) < topBrightness(clear));
  assert.ok(topBrightness(rainy) < topBrightness(overcast));
  // grey: the sky light's channels lie close together
  assert.ok(Math.max(...overcast.sky) - Math.min(...overcast.sky) < 0.06);
});

test("fork: the see-through walls stay white in the sun and go dark at night", () => {
  const noon = glassTint(liveLight({ elevation: 50, azimuth: 180 }, 0, null));
  const night = glassTint(liveLight({ elevation: -25, azimuth: 0 }, 0, null));
  assert.ok(noon.every((v) => v > 0.95 && v <= 1), `noon ${noon}`);
  assert.ok(night.every((v) => v < 0.15), `night ${night}`);
});

test("fork: without a known sun the light is a plain bright day", () => {
  assert.equal(liveLight(null, 0, null), DEFAULT_LIGHT);
  assert.ok(topBrightness(DEFAULT_LIGHT) > 0.8);
});
