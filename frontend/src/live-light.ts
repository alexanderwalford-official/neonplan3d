/**
 * Fork: the light of the "Realistic" style, from the real sun (sun.sun) and the weather outside (weather.*).
 *
 * Three numbers for the shader (see viewer/theme.ts): the direction towards the sun in the 3D world, the colour and
 * strength of the direct sunlight, and the colour and strength of the light from the sky that reaches every face.
 * - Day: a neutral white sky and sun; the faces turned to the sun are brightest, those turned away stay readable.
 * - Low sun: the direct light turns gold and then orange, the sky warms; blue hour after sunset is cool and dim.
 * - Night: only a faint blue sky light – lit lamps and screens keep their own glow in the shader.
 * - Clouds take the direct light and spread part of it into a brighter, greyer sky light (soft, even light);
 *   rain, snow and fog darken a little more.
 * Pure functions, no three.js.
 */

export type Rgb = [number, number, number];

export interface LiveLight {
  /** Unit vector towards the sun in world coordinates (x east-ish by the plan's north, y up). */
  dir: Rgb;
  /** Direct sunlight (colour × strength) on a face turned straight to the sun. */
  direct: Rgb;
  /** Light from the sky on every face (colour × strength); tops get a little more of it. */
  sky: Rgb;
}

export interface LiveSun {
  elevation: number;
  azimuth: number;
}

export interface LiveWeather {
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// colours of the sunlight by the sun's height, and of the sky light by day, at dusk and by night
const SUN_HIGH: Rgb = [1, 0.97, 0.92];
const SUN_GOLD: Rgb = [1, 0.84, 0.62];
const SUN_LOW: Rgb = [1, 0.58, 0.32];
const SKY_DAY: Rgb = [0.62, 0.65, 0.7];
const SKY_DUSK: Rgb = [0.42, 0.36, 0.44];
const SKY_NIGHT: Rgb = [0.17, 0.19, 0.29];
const OVERCAST: Rgb = [0.8, 0.81, 0.83];
/** Strength of the direct sunlight at its highest. */
const DIRECT = 0.55;

/** The light without a known sun: a bright, slightly cloudy day from the upper left, like the other homely looks. */
export const DEFAULT_LIGHT: LiveLight = {
  dir: normalize([-0.45, 0.8, 0.4]),
  direct: scale(SUN_HIGH, 0.45),
  sky: SKY_DAY,
};

function normalize(v: Rgb): Rgb {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Direction towards the sun in the 3D world: the same as the house's shadow on the ground uses (north in degrees). */
export function sunDirection(sun: LiveSun, northDeg: number): Rgb {
  const el = (Math.max(-90, Math.min(90, sun.elevation)) * Math.PI) / 180;
  const a = ((northDeg + sun.azimuth) * Math.PI) / 180;
  // a sun below the horizon still lights from just above it (its glow), never from under the floor
  const e = Math.max(el, 0.05);
  return normalize([Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]);
}

/** The light for the shader from the sun (null: unknown) and the weather (null: clear). */
export function liveLight(sun: LiveSun | null, northDeg: number, weather: LiveWeather | null): LiveLight {
  if (!sun) return DEFAULT_LIGHT;
  const e = sun.elevation;
  // direct light: none below the horizon, rising quickly in the first degrees, full from about 25°
  const sunUp = smooth(-1, 6, e) * (0.55 + 0.45 * smooth(6, 25, e));
  const sunColor = e < 12 ? mix(SUN_LOW, SUN_GOLD, smooth(0, 12, e)) : mix(SUN_GOLD, SUN_HIGH, smooth(12, 35, e));
  // sky light: night below -8° (nautical dusk), the warm dusk sky around the horizon, day from about 10°
  const night = 1 - smooth(-9, -2, e);
  const day = smooth(2, 14, e);
  let sky = mix(mix(SKY_DUSK, SKY_DAY, day), SKY_NIGHT, night);
  let direct = scale(sunColor, DIRECT * sunUp);
  const w = weather;
  if (w) {
    const cloud = clamp01(w.cloud);
    const wet = clamp01(Math.max(w.rain, w.snow * 0.8));
    const fog = clamp01(w.fog);
    // clouds hide the sun; part of its light comes back as an even, grey light from the whole sky
    const hidden = clamp01(cloud * 0.9 + wet * 0.3 + fog * 0.5);
    const spread = (DIRECT * sunUp * hidden) * 0.55;
    direct = scale(direct, 1 - hidden);
    sky = add(mix(sky, scale(OVERCAST, Math.max(...sky)), hidden * (1 - night)), scale(OVERCAST, spread));
    // rain, snow and fog: a darker day
    sky = scale(sky, 1 - 0.18 * wet - 0.1 * fog);
  }
  return { dir: sunDirection(sun, northDeg), direct, sky };
}

/** How bright a top face turned to the sun is (for tests and the line colour): sky plus direct, as luminance. */
export function topBrightness(l: LiveLight): number {
  const lum = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return lum(l.sky) + lum(l.direct) * Math.max(0, l.dir[1]);
}
