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
  return `${route} · HTTP ${x.status} · ${formatMs(x.ms)} · ${formatBytes(x.requestBytes)} sent, ${formatBytes(x.bytes)} received`;
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
