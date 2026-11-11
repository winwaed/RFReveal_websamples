// Settings for the rfreveal-map demo, read by index.html.
//
// GOOGLE MAPS KEY: the demo needs your own Google Maps JavaScript API key.
// Either put it in googleMapsApiKey below, or (recommended if you use git)
// put it in config.local.js, which .gitignore keeps out of version control:
//
//   Object.assign(window.RFREVEAL_CONFIG, { googleMapsApiKey: "YOUR_KEY" });
//
// Never commit a real key. Get one at
// https://developers.google.com/maps/documentation/javascript/get-api-key
// and restrict it to your site's address.
window.RFREVEAL_CONFIG = {
  // Google Maps JavaScript API key: put your own key between the quotes.
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
