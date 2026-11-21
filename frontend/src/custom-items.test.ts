import assert from "node:assert/strict";
import { test } from "node:test";
import { climateReading, customEntities, propColor, propGlow, propShape, readHumidity, readTemperature, refOf, PROP_COLOR, PROP_GLOW, SENSOR_COLOR } from "./custom-items.ts";
import { FURNITURE_TYPES, type Furniture } from "./model.ts";
import type { HassEntity } from "./types.ts";

const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes }) as unknown as HassEntity;
const item = (patch: Partial<Furniture>): Furniture => ({ id: "p", type: "prop", x: 0, z: 0, rotation: 0, w: 0.3, d: 0.3, h: 0.3, variant: null, ...patch });

test("fork: both custom items are built-in furniture types", () => {
  assert.ok((FURNITURE_TYPES as readonly string[]).includes("prop"));
  assert.ok((FURNITURE_TYPES as readonly string[]).includes("climate_sensor"));
});

test("fork: a temperature comes from a sensor's number or a climate / weather attribute", () => {
  assert.deepEqual(readTemperature(st("sensor.t", "21.46", { unit_of_measurement: "°C" })), { value: 21.46, unit: "°C" });
  assert.deepEqual(readTemperature(st("sensor.t", "70.1", { unit_of_measurement: "°F" })), { value: 70.1, unit: "°F" });
  assert.deepEqual(readTemperature(st("climate.lr", "heat", { current_temperature: 20.5, temperature: 22 })), { value: 20.5, unit: "°C" });
  assert.deepEqual(readTemperature(st("weather.home", "sunny", { temperature: 12, temperature_unit: "°C" })), { value: 12, unit: "°C" });
  // a humidity sensor is not a temperature; nothing usable gives null
  assert.equal(readTemperature(st("sensor.h", "48", { unit_of_measurement: "%" })), null);
  assert.equal(readTemperature(st("sensor.t", "unavailable")), null);
  assert.equal(readTemperature(undefined), null);
});

test("fork: a humidity comes from a % sensor or a humidity attribute", () => {
  assert.equal(readHumidity(st("sensor.h", "48.2", { unit_of_measurement: "%" })), 48.2);
  assert.equal(readHumidity(st("sensor.h", "55", { device_class: "humidity" })), 55);
  assert.equal(readHumidity(st("climate.lr", "heat", { current_humidity: 41 })), 41);
  assert.equal(readHumidity(st("weather.home", "rainy", { humidity: 90 })), 90);
  assert.equal(readHumidity(st("sensor.t", "21", { unit_of_measurement: "°C" })), null);
  assert.equal(readHumidity(st("sensor.h", "unknown", { unit_of_measurement: "%" })), null);
});

test("fork: the sensor reads both entities, or the humidity of its temperature entity", () => {
  const states = {
    "sensor.t": st("sensor.t", "21.4", { unit_of_measurement: "°C" }),
    "sensor.h": st("sensor.h", "48", { unit_of_measurement: "%" }),
    "climate.lr": st("climate.lr", "heat", { current_temperature: 20, current_humidity: 44 }),
  };
  assert.deepEqual(climateReading({ temp_entity: "sensor.t", humidity_entity: "sensor.h" }, states), { temp: { value: 21.4, unit: "°C" }, humidity: 48 });
  assert.deepEqual(climateReading({ temp_entity: "climate.lr", humidity_entity: null }, states), { temp: { value: 20, unit: "°C" }, humidity: 44 });
  assert.deepEqual(climateReading({ temp_entity: "sensor.t" }, states), { temp: { value: 21.4, unit: "°C" }, humidity: null });
  assert.deepEqual(climateReading({ temp_entity: "none", humidity_entity: "sensor.missing" }, states), { temp: null, humidity: null });
});

test("fork: shape, colours and glow fall back to their defaults", () => {
  assert.equal(propShape(item({})), "box");
  assert.equal(propShape(item({ prop_shape: "cylinder" })), "cylinder");
  assert.equal(propShape(item({ type: "climate_sensor", prop_shape: "cylinder" })), "rounded");
  assert.equal(propColor(item({})), PROP_COLOR);
  assert.equal(propColor(item({ type: "climate_sensor" })), SENSOR_COLOR);
  assert.equal(propColor(item({ prop_color: "#FF0000" })), "#ff0000");
  assert.equal(propColor(item({ prop_color: "red" })), PROP_COLOR);
  assert.equal(propGlow(item({})), PROP_GLOW);
  assert.equal(propGlow(item({ prop_glow: "#00ff00" })), "#00ff00");
  assert.equal(propGlow(item({ prop_glow: "#00ff00", prop_no_glow: true })), null);
});

test("fork: the view watches every entity of a custom item, and only of those", () => {
  assert.deepEqual(customEntities(item({ entity: "switch.fan", extra: "sensor.w" })), ["switch.fan", "sensor.w"]);
  assert.deepEqual(customEntities(item({ type: "climate_sensor", temp_entity: "sensor.t", humidity_entity: "none" })), ["sensor.t"]);
  assert.deepEqual(customEntities(item({ type: "sofa", entity: "media_player.tv" })), []);
  assert.equal(refOf("none"), null);
  assert.equal(refOf(null), null);
  assert.equal(refOf("light.a"), "light.a");
});
