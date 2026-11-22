import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetSeen, HOLD_MINUTES, holdMs, motionFigures, motionFiguresOn, motionSensorReport, sawSomeone, SOMEONE_COLOR } from "./motion-figures.ts";

const HOLD_MS = HOLD_MINUTES * 60_000;
import { emptyBuilding, newFloor } from "./model.ts";
import type { HomeAssistant } from "./types.ts";

const NOW = Date.parse("2026-11-22T14:12:30Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** Sensors on a device in the "bedroom" area (the area comes from the device, as with most sensors). */
function setup(states: Record<string, { state: string; device_class?: string; changed?: string }>, area = "bedroom") {
  forgetSeen();
  const hass = {
    states: Object.fromEntries(
      Object.entries(states).map(([id, s]) => [id, { entity_id: id, state: s.state, last_changed: s.changed ?? ago(1000), attributes: s.device_class ? { device_class: s.device_class } : {} }]),
    ),
    entities: Object.fromEntries(Object.keys(states).map((id) => [id, { entity_id: id, device_id: "dev1", area_id: null }])),
    devices: { dev1: { id: "dev1", area_id: area } },
    areas: { bedroom: { area_id: "bedroom", name: "Bedroom" }, garage: { area_id: "garage", name: "Garage" } },
  } as unknown as HomeAssistant;
  const b = emptyBuilding();
  const floor = newFloor("og", "Upstairs", 2.7);
  floor.rooms = [{ id: "r", name: "Bedroom", area_id: "bedroom", points: [[0, 0], [4, 0], [4, 3], [0, 3]], floor_material: "wood" }];
  b.floors = [floor];
  return { hass, b };
}

test("fork: a room whose sensor (on a device in its area) sees someone gets an unnamed figure", () => {
  const { hass, b } = setup({ "binary_sensor.motion_sensor_occupancy": { state: "on", device_class: "occupancy" }, "sensor.motion_sensor_signal_level": { state: "-60" } });
  const figs = motionFigures(hass, b, new Set(), "Someone", NOW);
  assert.equal(figs.length, 1);
  assert.equal(figs[0].roomId, "r");
  assert.equal(figs[0].color, SOMEONE_COLOR);
  assert.equal(figs[0].entity, "binary_sensor.motion_sensor_occupancy");
});

test("fork: the figure stays for the hold time after the sensor cleared (sensors that report seconds at a time)", () => {
  const recent = setup({ "binary_sensor.m": { state: "off", device_class: "occupancy", changed: ago(10_000) } });
  assert.equal(motionFigures(recent.hass, recent.b, new Set(), "x", NOW).length, 1);
  const old = setup({ "binary_sensor.m": { state: "off", device_class: "occupancy", changed: ago(HOLD_MS + 1000) } });
  assert.equal(motionFigures(old.hass, old.b, new Set(), "x", NOW).length, 0);
  const gone = setup({ "binary_sensor.m": { state: "unavailable", device_class: "motion", changed: ago(1000) } });
  assert.equal(sawSomeone(gone.hass, "binary_sensor.m", NOW), false);
});

test("fork: other kinds, taken rooms and a parking spot's car sensor do not count", () => {
  const door = setup({ "binary_sensor.k": { state: "on", device_class: "door" } });
  assert.equal(motionFigures(door.hass, door.b, new Set(), "x", NOW).length, 0);
  const busy = setup({ "binary_sensor.k": { state: "on", device_class: "motion" } });
  assert.equal(motionFigures(busy.hass, busy.b, new Set(["r"]), "x", NOW).length, 0);
  const car = setup({ "binary_sensor.car": { state: "on", device_class: "occupancy" } });
  car.b.floors[0].furniture = [{ id: "p", type: "parking", x: 2, z: 1.5, rotation: 0, w: 2.6, d: 5.2, h: 0.02, variant: null, entity: "binary_sensor.car" }];
  assert.equal(motionFigures(car.hass, car.b, new Set(), "x", NOW).length, 0);
});

test("fork: the report lists the sensors per room and those in an area no room is linked to", () => {
  const linked = setup({ "binary_sensor.m": { state: "off", device_class: "occupancy" } });
  assert.deepEqual(motionSensorReport(linked.hass, linked.b), { rooms: [{ room: "Bedroom", sensors: ["binary_sensor.m"] }], unlinked: [] });
  const other = setup({ "binary_sensor.m": { state: "on", device_class: "motion" } }, "garage");
  assert.deepEqual(motionSensorReport(other.hass, other.b), { rooms: [], unlinked: [{ area: "Garage", sensors: ["binary_sensor.m"] }] });
  assert.equal(motionFigures(other.hass, other.b, new Set(), "x", NOW).length, 0);
});

test("fork: the plan can switch the unnamed figures off", () => {
  const { hass, b } = setup({ "binary_sensor.k": { state: "on", device_class: "motion" } });
  assert.equal(motionFiguresOn(b), true);
  b.settings.motion_figures = false;
  assert.equal(motionFiguresOn(b), false);
  assert.equal(motionFigures(hass, b, new Set(), "x", NOW).length, 0);
});

test("fork: once this screen saw someone, the figure holds even if Home Assistant's clock disagrees", () => {
  const { hass, b } = setup({ "binary_sensor.m": { state: "on", device_class: "occupancy" } });
  assert.equal(motionFigures(hass, b, new Set(), "x", NOW).length, 1);
  // cleared, with a last_changed far in the past (a tablet clock ahead of Home Assistant's)
  hass.states["binary_sensor.m"] = { ...hass.states["binary_sensor.m"], state: "off", last_changed: ago(HOLD_MS * 3) };
  assert.equal(motionFigures(hass, b, new Set(), "x", NOW + 60_000).length, 1);
  assert.equal(motionFigures(hass, b, new Set(), "x", NOW + HOLD_MS + 1000).length, 0);
});

test("fork: the hold time is the plan's own, 10 minutes without one", () => {
  const { b } = setup({});
  assert.equal(holdMs(b), 10 * 60_000);
  b.settings.motion_hold = 30;
  assert.equal(holdMs(b), 30 * 60_000);
  b.settings.motion_hold = 9999;
  assert.equal(holdMs(b), 240 * 60_000);
});
