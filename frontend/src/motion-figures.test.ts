import assert from "node:assert/strict";
import { test } from "node:test";
import { activeMotionSensors, motionFigures, motionFiguresOn, SOMEONE_COLOR } from "./motion-figures.ts";
import { emptyBuilding, newFloor } from "./model.ts";
import type { HomeAssistant } from "./types.ts";

function setup(states: Record<string, { state: string; device_class?: string }>) {
  const hass = {
    states: Object.fromEntries(
      Object.entries(states).map(([id, s]) => [id, { entity_id: id, state: s.state, attributes: s.device_class ? { device_class: s.device_class } : {} }]),
    ),
    entities: Object.fromEntries(Object.keys(states).map((id) => [id, { entity_id: id, area_id: "kitchen" }])),
    devices: {},
    areas: { kitchen: { area_id: "kitchen", name: "Kitchen" } },
  } as unknown as HomeAssistant;
  const b = emptyBuilding();
  const floor = newFloor("eg", "Ground floor", 0);
  floor.rooms = [{ id: "k", name: "Kitchen", area_id: "kitchen", points: [[0, 0], [4, 0], [4, 3], [0, 3]], floor_material: "tiles" }];
  b.floors = [floor];
  return { hass, b };
}

test("fork: a room whose motion sensor is on gets an unnamed figure in its area", () => {
  const { hass, b } = setup({ "binary_sensor.kitchen_motion": { state: "on", device_class: "motion" }, "sensor.kitchen_motion_signal": { state: "-60" } });
  assert.deepEqual(activeMotionSensors(hass, "kitchen"), ["binary_sensor.kitchen_motion"]);
  const figs = motionFigures(hass, b, new Set(), "Someone");
  assert.equal(figs.length, 1);
  assert.equal(figs[0].roomId, "k");
  assert.equal(figs[0].name, "Someone");
  assert.equal(figs[0].color, SOMEONE_COLOR);
  assert.equal(figs[0].entity, "binary_sensor.kitchen_motion");
});

test("fork: occupancy and presence count too; off, other kinds and taken rooms do not", () => {
  assert.equal(motionFigures(setup({ "binary_sensor.k": { state: "on", device_class: "occupancy" } }).hass, setup({}).b, new Set(), "x").length, 1);
  assert.equal(motionFigures(setup({ "binary_sensor.k": { state: "on", device_class: "presence" } }).hass, setup({}).b, new Set(), "x").length, 1);
  const off = setup({ "binary_sensor.k": { state: "off", device_class: "motion" } });
  assert.equal(motionFigures(off.hass, off.b, new Set(), "x").length, 0);
  const door = setup({ "binary_sensor.k": { state: "on", device_class: "door" } });
  assert.equal(motionFigures(door.hass, door.b, new Set(), "x").length, 0);
  // a named person stands there already
  const busy = setup({ "binary_sensor.k": { state: "on", device_class: "motion" } });
  assert.equal(motionFigures(busy.hass, busy.b, new Set(["k"]), "x").length, 0);
});

test("fork: a parking spot's occupancy sensor (a car) does not count as someone", () => {
  const { hass, b } = setup({ "binary_sensor.garage_car": { state: "on", device_class: "occupancy" } });
  b.floors[0].furniture = [{ id: "p", type: "parking", x: 2, z: 1.5, rotation: 0, w: 2.6, d: 5.2, h: 0.02, variant: null, entity: "binary_sensor.garage_car" }];
  assert.equal(motionFigures(hass, b, new Set(), "x").length, 0);
});

test("fork: the plan can switch the unnamed figures off", () => {
  const { hass, b } = setup({ "binary_sensor.k": { state: "on", device_class: "motion" } });
  assert.equal(motionFiguresOn(b), true);
  b.settings.motion_figures = false;
  assert.equal(motionFiguresOn(b), false);
  assert.equal(motionFigures(hass, b, new Set(), "x").length, 0);
});
