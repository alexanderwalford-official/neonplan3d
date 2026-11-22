/**
 * Fork: an unnamed figure in every room whose motion, occupancy or presence sensor saw someone – "someone is in the
 * kitchen", without saying who. The sensor belongs to the room by its own or its device's Home Assistant area (the
 * room's area). Many sensors report "detected" only for a few seconds at a time, so the figure stays HOLD_MS after the
 * last detection. A room where a named person already stands (room sensor, NeonPlan's locating) gets no second figure:
 * the motion is most likely theirs. Off with the plan's setting motion_figures = false, or with people not shown.
 */
import { entityAreaId } from "./devices.ts";
import type { Building } from "./model.ts";
import { innerPoint } from "./model.ts";
import { parkingEntities } from "./parking.ts";
import type { PersonMarker } from "./presence.ts";
import type { HomeAssistant } from "./types.ts";

/** The sensors' kinds that mean someone is there. */
const SOMEONE = new Set(["motion", "occupancy", "presence"]);
/** How long the figure stays after the sensor cleared, unless the plan says otherwise (settings.motion_hold, minutes). */
export const HOLD_MINUTES = 10;
export const HOLD_MAX_MINUTES = 240;
/** A neutral grey: not one of the named people's colours. */
export const SOMEONE_COLOR = "#a7b0bb";

export function motionFiguresOn(building: Building | null | undefined): boolean {
  return building?.settings.motion_figures !== false;
}

/** The plan's hold time in milliseconds. */
export function holdMs(building: Building | null | undefined): number {
  const m = building?.settings.motion_hold;
  return (typeof m === "number" && m >= 1 ? Math.min(HOLD_MAX_MINUTES, m) : HOLD_MINUTES) * 60_000;
}

/**
 * When this screen last saw each sensor report someone. The hold counts from here as well as from Home Assistant's
 * last_changed: a tablet's clock running ahead of Home Assistant's ended the hold the moment the sensor cleared.
 */
const lastSeen = new Map<string, number>();

/** For tests: forget what was seen. */
export function forgetSeen(): void {
  lastSeen.clear();
}

/** Every motion, occupancy or presence sensor by its Home Assistant area (`skip`: sensors that mean something else). */
export function motionSensorsByArea(hass: HomeAssistant, skip: ReadonlySet<string> = new Set()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, st] of Object.entries(hass.states)) {
    if (!id.startsWith("binary_sensor.") || skip.has(id) || !SOMEONE.has(String(st.attributes?.device_class ?? ""))) continue;
    const area = entityAreaId(hass, id);
    if (!area) continue;
    (out.get(area) ?? out.set(area, []).get(area)!).push(id);
  }
  return out;
}

/** Whether a sensor sees someone now, or did within the hold time (`hold` in ms). */
export function sawSomeone(hass: HomeAssistant, id: string, now = Date.now(), hold = HOLD_MINUTES * 60_000): boolean {
  const st = hass.states[id];
  if (!st) return false;
  if (st.state === "on") {
    lastSeen.set(id, now);
    return true;
  }
  // seen by this screen (any state after it: cleared, or briefly unavailable)
  const seen = lastSeen.get(id);
  if (seen !== undefined && now - seen < hold) return true;
  // or, after a reload, by Home Assistant's own time of the change to "clear"
  if (st.state !== "off") return false;
  const changed = Date.parse(String(st.last_changed ?? ""));
  return Number.isFinite(changed) && now - changed < hold;
}

/**
 * The unnamed figures: one per room with a sensor that saw someone, beside the room's label (where a named person
 * would stand first). `taken` are the rooms that already hold a named person; `name` the word for the figure.
 */
export function motionFigures(hass: HomeAssistant, building: Building, taken: ReadonlySet<string>, name: string, now = Date.now()): PersonMarker[] {
  if (!motionFiguresOn(building)) return [];
  // a parking spot's occupancy sensor says a car stands there, not a person
  const byArea = motionSensorsByArea(hass, new Set(parkingEntities(building.floors)));
  const hold = holdMs(building);
  const out: PersonMarker[] = [];
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      if (room.points.length < 3 || !room.area_id) continue;
      // every sensor is looked at (also in a room a named person holds), so this screen remembers when it saw someone
      const sensors = (byArea.get(room.area_id) ?? []).filter((id) => sawSomeone(hass, id, now, hold));
      if (taken.has(room.id)) continue;
      if (!sensors.length) continue;
      const [cx, cz] = innerPoint(room.points);
      const a = -Math.PI / 2 + 0.9;
      out.push({
        id: `motion:${room.id}`,
        name,
        initials: "?",
        picture: null,
        floorId: floor.id,
        roomId: room.id,
        x: cx + Math.cos(a) * 0.75,
        z: cz + Math.sin(a) * 0.75,
        color: SOMEONE_COLOR,
        // a tap opens the sensor that saw someone
        entity: sensors[0],
      });
    }
  }
  return out;
}

/**
 * For the editor: which sensors were found for which room, and sensors whose area no room of the plan is linked to
 * (the usual reason no figure shows).
 */
export function motionSensorReport(hass: HomeAssistant, building: Building): { rooms: { room: string; sensors: string[] }[]; unlinked: { area: string; sensors: string[] }[] } {
  const byArea = motionSensorsByArea(hass, new Set(parkingEntities(building.floors)));
  const linked = new Set<string>();
  const rooms: { room: string; sensors: string[] }[] = [];
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      if (!room.area_id) continue;
      linked.add(room.area_id);
      const sensors = byArea.get(room.area_id);
      if (sensors?.length) rooms.push({ room: room.name || room.area_id, sensors });
    }
  }
  const unlinked = [...byArea].filter(([area]) => !linked.has(area)).map(([area, sensors]) => ({ area: hass.areas?.[area]?.name ?? area, sensors }));
  return { rooms, unlinked };
}
