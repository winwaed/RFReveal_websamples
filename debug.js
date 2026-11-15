// The debug pane's pure parts: pretty-printing a JSON value with long
// strings shortened, and the one-line summary of an exchange with the
// service. An exchange is the record fetchJSON (patch.js) hands to its
// trace callback: { method, url, request, requestBytes, status, reply,
// bytes, ms, error }, filled in as the request goes out and the reply
// comes back.

// prettyJSON formats value with two-space indentation. With maxString
// above 0, a string longer than that is cut to its first maxString
// characters followed by "… (N chars)", so a base64 raster does not bury
// the rest of the reply. undefined (JSON's "nothing") gives "".
export function prettyJSON(value, { maxString = 0 } = {}) {
  const replacer = maxString > 0
    ? (_key, v) => (typeof v === "string" && v.length > maxString ? `${v.slice(0, maxString)}… (${v.length} chars)` : v)
    : undefined;
  return JSON.stringify(value, replacer, 2) ?? "";
}

// exchangeSummary describes an exchange in one line: the route, then the
// HTTP status, the time it took and the reply size once the reply is in,
// or the reason it failed.
export function exchangeSummary(x) {
  if (!x) return "No request sent yet.";
  const route = `${x.method} ${x.url}`;
  if (x.error) return `${route} · failed: ${x.error}`;
  if (x.status == null) return `${route} · ${formatBytes(x.requestBytes)} sent, waiting for the reply…`;
  const id = x.requestId ? ` · id ${x.requestId}` : "";
  return `${route} · HTTP ${x.status} · ${formatMs(x.ms)} · ${formatBytes(x.requestBytes)} sent, ${formatBytes(x.bytes)} received${id}`;
}

// savedExchange is the file "Save" writes: the exchange as traced (request,
// reply, status, timing, the service's request id) with when and where it
// was saved, so it can be attached to a support report and replayed. The
// raster is left in: it is what the service sent.
export function savedExchange(x, { page = "rfreveal-map", now = new Date() } = {}) {
  if (!x) return null;
  return { saved: now.toISOString(), page, method: x.method, url: x.url, status: x.status, ms: x.ms,
    request_id: x.requestId ?? null, error: x.error ?? null, request: x.request, reply: x.reply };
}

// savedExchangeName is the file name for a saved exchange.
export function savedExchangeName(x, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `rfreveal-request-${x?.requestId || stamp}.json`;
}

export function formatMs(ms) {
  if (typeof ms !== "number" || !(ms >= 0)) return "–";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatBytes(n) {
  if (typeof n !== "number" || !(n >= 0)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
