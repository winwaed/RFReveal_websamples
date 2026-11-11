// node --test test/  (Node 18 or later)
// patch.test.js covers expandTowers over the shipped towers.json; these
// are the remaining refusals and loadTowers with a stubbed fetch.
import { test } from "node:test";
import assert from "node:assert/strict";

import { expandTowers, loadTowers } from "../towers.js";

const tower = (over = {}) => ({ id: "a", name: "A", lat: 33.9, lon: -98.5, height: 10, radios: [{ azimuth_deg: 0 }], ...over });

test("expandTowers refuses files with the place named", () => {
  assert.throws(() => expandTowers(null), /non-empty towers array/);
  assert.throws(() => expandTowers({}), /non-empty towers array/);
  assert.throws(() => expandTowers({ towers: "chase" }), /non-empty towers array/);
  for (const k of ["id", "name", "lat", "lon"]) {
    const t = tower();
    delete t[k];
    assert.throws(() => expandTowers({ towers: [t] }), new RegExp(`towers\\[0\\] lacks ${k}`), `missing ${k}`);
    t[k] = null;
    assert.throws(() => expandTowers({ towers: [t] }), new RegExp(`towers\\[0\\] lacks ${k}`), `null ${k}`);
  }
  assert.throws(() => expandTowers({ towers: [tower(), tower({ name: "B" })] }), /towers\[1\]: duplicate tower id a/);
  assert.throws(() => expandTowers({ towers: [tower({ radios: [] })] }), /towers\[0\] \(a\) has no radios/);
  assert.throws(() => expandTowers({ towers: [tower({ radios: undefined })] }), /has no radios/);
  assert.throws(() => expandTowers({ towers: [tower({ radios: [{ azimuth_deg: "90" }] })] }), /radios\[0\] lacks azimuth_deg/);
  assert.throws(() => expandTowers({ towers: [tower({ radios: [{ azimuth_deg: 0 }, { azimuth_deg: 90, height: 1, height_rooftop: 2 }] })] }), /radios\[1\] gives both height and height_rooftop/);
  assert.throws(() => expandTowers({ towers: [tower({ height: undefined })] }), /radios\[0\] has no height or height_rooftop, and the tower gives none/);
});

test("expandTowers keeps a radio's own id and name and a zero lat/lon", () => {
  const doc = {
    towers: [tower({ lat: 0, lon: 0, radios: [{ azimuth_deg: 270, id: "west", name: "West" }, { azimuth_deg: 0, height_rooftop: 2 }] })],
  };
  const { towers, center } = expandTowers(doc);
  assert.equal(towers.length, 1);
  assert.deepEqual(towers[0].radios[0], { azimuth_deg: 270, id: "west", name: "West", height: 10 });
  assert.deepEqual(towers[0].radios[1], { azimuth_deg: 0, id: "a-0", name: "0°", height_rooftop: 2 }, "a radio's own mount is kept, not the tower's");
  assert.equal("height" in towers[0], false);
  assert.deepEqual(center, { lat: 0, lng: 0 }, "zero is a valid coordinate");
  // Every other tower field passes through untouched.
  const extra = expandTowers({ towers: [tower({ note: "keep me", radios: [{ azimuth_deg: 0, custom: [1, 2] }] })] }).towers[0];
  assert.equal(extra.note, "keep me");
  assert.deepEqual(extra.radios[0].custom, [1, 2]);
  // The input is not modified.
  assert.equal(doc.towers[0].height, 10);
  assert.equal(doc.towers[0].radios[0].id, "west");
});

test("expandTowers takes map_center only when both coordinates are numbers", () => {
  const towers = [tower()];
  assert.deepEqual(expandTowers({ towers, map_center: { lat: 1, lon: 2 } }).center, { lat: 1, lng: 2 });
  assert.deepEqual(expandTowers({ towers, map_center: { lat: 1 } }).center, { lat: 33.9, lng: -98.5 });
  assert.deepEqual(expandTowers({ towers, map_center: { lat: "1", lon: "2" } }).center, { lat: 33.9, lng: -98.5 });
  assert.deepEqual(expandTowers({ towers, map_center: null }).center, { lat: 33.9, lng: -98.5 });
  assert.deepEqual(expandTowers({ towers, map_center: { lat: 1, lng: 2 } }).center, { lat: 33.9, lng: -98.5 }, "the file says lon, not lng");
});

// withFetch runs f with globalThis.fetch replaced by a stub that records
// its calls and answers as told.
async function withFetch(reply, f) {
  const calls = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return typeof reply === "function" ? reply(url) : reply;
  };
  try {
    return await f(calls);
  } finally {
    globalThis.fetch = old;
  }
}

const jsonResponse = (doc) => ({ ok: true, status: 200, statusText: "OK", json: async () => doc });

test("loadTowers fetches the file afresh and expands it", async () => {
  const doc = { map_center: { lat: 5, lon: 6 }, towers: [tower()] };
  await withFetch(jsonResponse(doc), async (calls) => {
    const { towers, center } = await loadTowers();
    assert.deepEqual(calls.map((c) => c.url), ["towers.json"], "the default URL");
    assert.equal(calls[0].init.cache, "reload", "the browser cache is bypassed");
    assert.deepEqual(center, { lat: 5, lng: 6 });
    assert.deepEqual(towers[0].radios[0], { azimuth_deg: 0, id: "a-0", name: "0°", height: 10 });
  });
  await withFetch(jsonResponse(doc), async (calls) => {
    await loadTowers("sites/other.json");
    assert.deepEqual(calls.map((c) => c.url), ["sites/other.json"]);
  });
});

test("loadTowers reports HTTP failures, bad JSON and bad files", async () => {
  await withFetch({ ok: false, status: 404, statusText: "Not Found" }, async () => {
    await assert.rejects(loadTowers("missing.json"), /cannot load missing.json: 404 Not Found/);
  });
  await withFetch({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }, async () => {
    await assert.rejects(loadTowers("page.html"), /page.html is not valid JSON: Unexpected token </);
  });
  await withFetch(jsonResponse({ towers: [] }), async () => {
    await assert.rejects(loadTowers(), /non-empty towers array/);
  });
  await withFetch(() => { throw new TypeError("Failed to fetch"); }, async () => {
    await assert.rejects(loadTowers(), /Failed to fetch/, "network errors pass through");
  });
});
