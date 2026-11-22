/**
 * Fork: an unnamed figure in every room whose motion, occupancy or presence sensor is on – "someone is in the
 * kitchen", without saying who. The sensor belongs to the room by its own or its device's Home Assistant area (the
 * room's area). A room where a named person already stands (room sensor, NeonPlan's locating) gets no second figure:
 * the motion is most likely theirs. Off with the plan's setting motion_figures = false, or with people not shown.
 */
import { areaEntities } from "./devices.ts";
import type { Building } from "./model.ts";
import { innerPoint } from "./model.ts";
import { parkingEntities } from "./parking.ts";
import type { PersonMarker } from "./presence.ts";
import type { HomeAssistant } from "./types.ts";

/** The sensors' kinds that mean someone is there. */
const SOMEONE = new Set(["motion", "occupancy", "presence"]);
/** A neutral grey: not one of the named people's colours. */
export const SOMEONE_COLOR = "#a7b0bb";

export function motionFiguresOn(building: Building | null | undefined): boolean {
  return building?.settings.motion_figures !== false;
}

/** The sensors in a room's area that report someone right now (`skip`: sensors that mean something else). */
export function activeMotionSensors(hass: HomeAssistant, areaId: string | null | undefined, skip: ReadonlySet<string> = new Set()): string[] {
  if (!areaId) return [];
  return areaEntities(hass, areaId).filter((id) => {
    if (!id.startsWith("binary_sensor.") || skip.has(id)) return false;
    const st = hass.states[id];
    return !!st && st.state === "on" && SOMEONE.has(String(st.attributes?.device_class ?? ""));
  });
}

/**
 * The unnamed figures: one per room with an active sensor, beside the room's label (where a named person would
 * stand first). `taken` are the rooms that already hold a named person; `name` the word for the figure ("Someone").
 */
export function motionFigures(hass: HomeAssistant, building: Building, taken: ReadonlySet<string>, name: string): PersonMarker[] {
  if (!motionFiguresOn(building)) return [];
  // a parking spot's occupancy sensor says a car stands there, not a person
  const skip = new Set(parkingEntities(building.floors));
  const out: PersonMarker[] = [];
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      if (room.points.length < 3 || taken.has(room.id)) continue;
      const sensors = activeMotionSensors(hass, room.area_id, skip);
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
