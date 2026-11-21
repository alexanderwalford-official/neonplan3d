/**
 * Fork: two built-in items of our own, kept in this file so upstream merges touch little else.
 *
 * - "prop": a generic prop – a box, rounded box or cylinder in any size and colour. It may link any Home Assistant
 *   entity: a tap switches or opens it, the prop glows (in its own colour) while the entity is on, and a second
 *   entity's value can stand at its symbol.
 * - "climate_sensor": a temperature and humidity sensor, a small cube. Its pin shows "21.4 °C · 48 %" from any entity:
 *   a sensor's number, or the temperature / humidity attributes of a climate, weather or water_heater entity.
 */
import type { EntityRef, Furniture } from "./model.ts";
import type { HassEntity } from "./types.ts";

export const PROP = "prop";
export const CLIMATE_SENSOR = "climate_sensor";
export const CUSTOM_TYPES = new Set<string>([PROP, CLIMATE_SENSOR]);

export const PROP_SHAPES = ["box", "rounded", "cylinder"] as const;
export type PropShape = (typeof PROP_SHAPES)[number];

/** Default colours: a neutral grey prop, a white sensor. */
export const PROP_COLOR = "#8a94a6";
export const SENSOR_COLOR = "#eef0f2";
/** Glow while the linked entity is on, when the prop has no glow colour of its own: the app's neon cyan. */
export const PROP_GLOW = "#38e0ff";

const HEX = /^#[0-9a-f]{6}$/i;

/** The entity id a reference names (null for none or automatic). */
export function refOf(v: EntityRef | undefined): string | null {
  return typeof v === "string" && v !== "none" && v.includes(".") ? v : null;
}

export function isCustomType(type: string): boolean {
  return CUSTOM_TYPES.has(type);
}

/** The prop's shape (a sensor is always a rounded cube). */
export function propShape(f: Pick<Furniture, "type" | "prop_shape">): PropShape {
  if (f.type === CLIMATE_SENSOR) return "rounded";
  return f.prop_shape && (PROP_SHAPES as readonly string[]).includes(f.prop_shape) ? f.prop_shape : "box";
}

/** Body colour as "#rrggbb". */
export function propColor(f: Pick<Furniture, "type" | "prop_color">): string {
  if (f.prop_color && HEX.test(f.prop_color)) return f.prop_color.toLowerCase();
  return f.type === CLIMATE_SENSOR ? SENSOR_COLOR : PROP_COLOR;
}

/** Glow colour as "#rrggbb", or null when the prop is set not to glow. */
export function propGlow(f: Pick<Furniture, "prop_glow" | "prop_no_glow">): string | null {
  if (f.prop_no_glow) return null;
  return f.prop_glow && HEX.test(f.prop_glow) ? f.prop_glow.toLowerCase() : PROP_GLOW;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** Every entity a custom item uses (for the 3D view to redraw when one changes). */
export function customEntities(f: Furniture): string[] {
  if (!CUSTOM_TYPES.has(f.type)) return [];
  return [f.entity, f.extra, f.temp_entity, f.humidity_entity].map(refOf).filter((id): id is string => !!id);
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const TEMP_UNITS = new Set(["°C", "°F", "K", "C", "F"]);

/**
 * A temperature from any entity: a sensor whose state is a number, or the current_temperature (climate,
 * water_heater) or temperature (weather) attribute. Null when it tells none.
 */
export function readTemperature(st: HassEntity | undefined): { value: number; unit: string } | null {
  if (!st) return null;
  const a = st.attributes ?? {};
  const unit = typeof a.unit_of_measurement === "string" ? a.unit_of_measurement : null;
  const state = num(st.state);
  // a plain sensor: its own number (a humidity sensor picked by mistake is not a temperature)
  if (state !== null && unit !== "%" && a.device_class !== "humidity") return { value: state, unit: unit ?? "°C" };
  const attr = num(a.current_temperature) ?? num(a.temperature);
  if (attr !== null) {
    const u = typeof a.temperature_unit === "string" ? a.temperature_unit : unit && TEMP_UNITS.has(unit) ? unit : "°C";
    return { value: attr, unit: u };
  }
  return null;
}

/** A humidity (%) from any entity: a sensor whose state is a number, or the current_humidity / humidity attribute. */
export function readHumidity(st: HassEntity | undefined): number | null {
  if (!st) return null;
  const a = st.attributes ?? {};
  const unit = typeof a.unit_of_measurement === "string" ? a.unit_of_measurement : null;
  const state = num(st.state);
  if (state !== null && (unit === "%" || a.device_class === "humidity")) return state;
  const attr = num(a.current_humidity) ?? num(a.humidity);
  if (attr !== null) return attr;
  // a number without a unit, picked as the humidity: take it as it is
  return state !== null && unit === null ? state : null;
}

/**
 * The sensor's two values: the temperature from its temperature entity, the humidity from its humidity entity –
 * or, without one, from the temperature entity's own humidity attribute (a climate or weather entity tells both).
 */
export function climateReading(
  f: Pick<Furniture, "temp_entity" | "humidity_entity">,
  states: Record<string, HassEntity | undefined>,
): { temp: { value: number; unit: string } | null; humidity: number | null } {
  const t = refOf(f.temp_entity);
  const h = refOf(f.humidity_entity);
  const ts = t ? states[t] : undefined;
  const temp = readTemperature(ts);
  const humidity = h ? readHumidity(states[h]) : ts && (ts.attributes?.current_humidity != null || ts.attributes?.humidity != null) ? readHumidity({ ...ts, state: "" }) : null;
  return { temp, humidity };
}
