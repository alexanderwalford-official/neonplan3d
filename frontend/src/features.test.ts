import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_UNLOCKED, hasFeature, manualUrl, shopUrl, unlockedFeatures } from "./features.ts";

test("fork: built-in Pro features are on without a pack; module and unreleased ones still need one", () => {
  assert.deepEqual([...unlockedFeatures([])].sort(), [...BUILT_IN_UNLOCKED].sort());
  for (const f of ["camera_cockpit", "weather", "screens", "energy_pro", "sound", "auto_pro", "time_travel", "household", "fridge_smart"] as const)
    assert.equal(hasFeature(f, []), true, f);
  assert.equal(hasFeature("frames", []), false);
  assert.equal(hasFeature("pool", []), false);
  assert.equal(hasFeature("frames", [{ features: ["frames", "teleport"] }]), true);
  assert.equal(hasFeature("fun_pets", []), false);
});

test("time travel is a Pro add-on of its own with its section in the manual", () => {
  assert.equal(hasFeature("time_travel", []), true);
  assert.equal(manualUrl("de", "time_travel"), "https://mastershort.de/neonplan3d/anleitung/pro-erweiterungen/?lang=de#67-zeitreise");
  assert.equal(manualUrl("en", "time_travel"), "https://mastershort.de/en/neonplan3d/manual/pro-add-ons/?lang=en#67-time-travel");
});

test("manual and shop links follow the language and point Pro add-ons at their section", () => {
  assert.equal(manualUrl("de"), "https://mastershort.de/neonplan3d/anleitung/?lang=de");
  assert.equal(manualUrl("en-GB"), "https://mastershort.de/en/neonplan3d/manual/?lang=en");
  assert.equal(manualUrl("de", "weather"), "https://mastershort.de/neonplan3d/anleitung/pro-erweiterungen/?lang=de#62-wetter-drau%C3%9Fen");
  assert.equal(manualUrl("fr", "camera_cockpit"), "https://mastershort.de/en/neonplan3d/manual/pro-add-ons/?lang=en#61-camera-cockpit");
  assert.equal(shopUrl("de-AT"), "https://mastershort.de/neonplan3d/?lang=de");
  assert.equal(shopUrl("nl"), "https://mastershort.de/en/neonplan3d/?lang=en");
});

test("an unreleased add-on shows only to whoever has its pack", async () => {
  const { released, UNRELEASED } = await import("./features.ts");
  const { setPacks } = await import("./packs.ts");
  assert.ok(!UNRELEASED.includes("diagnostics"));
  setPacks([]);
  assert.equal(released("diagnostics"), true);
  assert.equal(released("auto_pro"), true);
  // Pool Pro is not released: hidden, unless the module is installed
  assert.equal(released("pool"), false);
  setPacks([{ id: "mastershort.pro_pool", name: "Pro: Pool Pro", items: [], features: ["pool"] } as never]);
  assert.equal(released("pool"), true);
  setPacks([]);
});
