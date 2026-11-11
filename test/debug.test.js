// Unit tests for debug.js and the trace hook of fetchJSON (patch.js),
// run with Node's own test runner (no npm):  node --test
import { test } from "node:test";
import assert from "node:assert/strict";

const { exchangeSummary, formatBytes, formatMs, prettyJSON } = await import("../debug.js");

test("prettyJSON indents by two and shortens only long strings when asked", () => {
  const v = { a: 1, s: "x".repeat(30), nested: { t: "short" } };
  assert.equal(prettyJSON(v), JSON.stringify(v, null, 2));
  const cut = prettyJSON(v, { maxString: 10 });
  assert.match(cut, /"s": "xxxxxxxxxx… \(30 chars\)"/);
  assert.match(cut, /"t": "short"/); // under the limit: untouched
  assert.equal(prettyJSON(undefined), "");
  assert.equal(prettyJSON(null), "null");
});

test("exchangeSummary follows an exchange through its states", () => {
  assert.equal(exchangeSummary(null), "No request sent yet.");
  const x = { method: "POST", url: "http://h/api/v1/patch", request: {}, requestBytes: 2048, status: null, reply: null, bytes: null, ms: null, error: null };
  assert.equal(exchangeSummary(x), "POST http://h/api/v1/patch · 2.0 KB sent, waiting for the reply…");
  Object.assign(x, { status: 200, bytes: 3 * 1024 * 1024, ms: 1234 });
  assert.equal(exchangeSummary(x), "POST http://h/api/v1/patch · HTTP 200 · 1.2 s · 2.0 KB sent, 3.00 MB received");
  assert.equal(exchangeSummary({ ...x, error: "aborted" }), "POST http://h/api/v1/patch · failed: aborted");
});

test("formatMs and formatBytes pick units", () => {
  assert.equal(formatMs(999), "999 ms");
  assert.equal(formatMs(1500), "1.5 s");
  assert.equal(formatMs(null), "–");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(undefined), "–");
});

// fetchJSON reports each exchange to its trace callback twice: once as
// the request goes out, once with the reply (or the failure) filled in.
test("fetchJSON traces the request, the reply and failures", async () => {
  const { fetchJSON } = await import("../patch.js");
  const saved = globalThis.fetch;
  const seen = [];
  const trace = (x) => seen.push({ ...x });
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://h/api/v1/patch");
      assert.equal(init.method, "POST");
      return { ok: true, status: 200, statusText: "OK", text: async () => '{"status":"ok"}' };
    };
    const reply = await fetchJSON("http://h", "/api/v1/patch", { radius: 50 }, { trace });
    assert.deepEqual(reply, { status: "ok" });
    assert.equal(seen.length, 2);
    assert.equal(seen[0].status, null);
    assert.deepEqual(seen[0].request, { radius: 50 });
    assert.equal(seen[0].requestBytes, '{"radius":50}'.length);
    assert.equal(seen[1].status, 200);
    assert.deepEqual(seen[1].reply, { status: "ok" });
    assert.equal(seen[1].bytes, '{"status":"ok"}'.length);
    assert.ok(seen[1].ms >= 0);

    // A service error: the reply body is kept for the pane and the error thrown.
    seen.length = 0;
    globalThis.fetch = async () => ({ ok: false, status: 400, statusText: "Bad Request", text: async () => '{"error":{"code":"bad_request","message":"no"}}' });
    await assert.rejects(fetchJSON("http://h", "/api/v1/patch", {}, { trace }), /bad_request: no/);
    assert.equal(seen[1].status, 400);
    assert.equal(seen[1].reply.error.code, "bad_request");
    assert.equal(seen[1].error, null);

    // A network failure: no status, the error text recorded.
    seen.length = 0;
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(fetchJSON("http://h", "/api/v1/patch", {}, { trace }), /cannot reach/);
    assert.equal(seen[1].status, null);
    assert.match(seen[1].error, /Failed to fetch/);
  } finally {
    globalThis.fetch = saved;
  }
});
