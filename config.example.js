// Copy to config.js and fill in. config.js is read by index.html and holds
// your own key, so keep it out of version control.
window.RFREVEAL_CONFIG = {
  // Google Maps JavaScript API key.
  googleMapsApiKey: "",
  // Map ID; advanced markers need one. DEMO_MAP_ID works for development.
  mapId: "DEMO_MAP_ID",
  // Where the RF Reveal service listens. It must allow this page's origin:
  // run rfreveald with -cors-origin http://localhost:8000 (or the RFREVEAL_CORS_ORIGIN
  // environment variable in Docker).
  apiBase: "http://localhost:8080",
  // The tower file (see towers.js for its shape). Default: towers.json.
  towersUrl: "towers.json",
  // The building footprints (see building.js for the shape, tools/ for how
  // to make the file from OpenStreetMap). Default: buildings.json.
  buildingsUrl: "buildings.json",
};
