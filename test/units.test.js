import test from "node:test";
import assert from "node:assert/strict";

const { FIELDS, convertTowers, distanceUnit, fromMeters, km2ToArea, kmToDistance, lengthUnit, normalizeUnits, toMeters, unitsName } = await import("../units.js");

test("normalizeUnits defaults to imperial and refuses anything else", () => {
  assert.equal(normalizeUnits(undefined), "imperial");
  assert.equal(normalizeUnits(""), "imperial");
  assert.equal(normalizeUnits("metric"), "metric");
  assert.throws(() => normalizeUnits("feet"), /metric.*imperial/);
});

test("unit names", () => {
  assert.equal(lengthUnit("metric"), "m");
  assert.equal(lengthUnit("imperial"), "ft");
  assert.equal(distanceUnit("metric"), "km");
  assert.equal(distanceUnit("imperial"), "mi");
  assert.equal(unitsName("imperial"), "feet and miles");
});

test("conversions", () => {
  assert.equal(toMeters(10, "metric"), 10);
  assert.ok(Math.abs(toMeters(FIELDS.imperial.radius.value, "imperial") - 19.81) < 0.01);
  assert.ok(Math.abs(fromMeters(100, "imperial") - 328.084) < 0.001);
  assert.ok(Math.abs(kmToDistance(20, "imperial") - 12.427) < 0.001);
  assert.ok(Math.abs(km2ToArea(3240, "imperial") - 1251) < 1);
});

test("convertTowers converts heights, clearance and ranges and nothing else", () => {
  const towers = [{ id: "a", name: "A", lat: 1, lon: 2, radios: [{ id: "a-0", azimuth_deg: 0, height_rooftop: 6, apclearance: 30, range: 20, tx_power_dbm: 18 }, { id: "a-90", azimuth_deg: 90, height: 45, range: 2 }] }];
  const out = convertTowers(towers, "metric", "imperial");
  assert.equal(out[0].radios[0].height_rooftop, 19.685);
  assert.equal(out[0].radios[0].apclearance, 98.425);
  assert.equal(out[0].radios[0].range, 12.427);
  assert.equal(out[0].radios[0].tx_power_dbm, 18);
  assert.equal(out[0].radios[1].height, 147.638);
  assert.equal(out[0].radios[1].range, 1.243);
  assert.equal(towers[0].radios[0].height_rooftop, 6, "the input is untouched");
  assert.equal(convertTowers(towers, "metric", "metric"), towers);
  const back = convertTowers(out, "imperial", "metric");
  assert.ok(Math.abs(back[0].radios[0].height_rooftop - 6) < 0.001);
});

test("FIELDS give the same inputs in both units, within the service's limits", () => {
  assert.deepEqual(Object.keys(FIELDS.metric), Object.keys(FIELDS.imperial));
  for (const [id, m] of Object.entries(FIELDS.metric)) {
    const i = FIELDS.imperial[id];
    assert.ok(Math.abs(toMeters(i.value, "imperial") - m.value) / m.value < 0.1, `${id} default`);
    assert.ok(toMeters(i.max, "imperial") <= m.max + 0.01, `${id} max`);
    assert.ok(toMeters(i.min, "imperial") >= m.min - 0.01, `${id} min`);
  }
});
