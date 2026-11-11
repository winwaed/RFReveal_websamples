# rfreveal-map

A single HTML page that shows a Google map with the sample towers, lets you
switch each tower on or off, and on a map click asks the RF Reveal service for
the patch at that point using the ticked towers. A mode switch at the top
of the panel chooses between Patches and Buildings: the second colours the
OpenStreetMap buildings around the towers by their coverage (Buildings,
below). Only the current mode's controls, overlays and key are shown, so
the key never mixes the two palettes; switching back brings the other
mode's overlays back as they were. The reply's GeoTIFF raster
is decoded in the browser and drawn over the map with a white circle at
the patch radius (the centre and radius the service echoes), where both
stay until the Clear rasters button removes every drawn patch; the
circles are vector shapes, which Google Maps draws above every ground
overlay, so a later patch's raster never hides an earlier patch's circle
(sample 0.8.1). Water cells are
transparent, and so are tree cells (vegetation more than 1 m tall, where
no receiver can be mounted) unless the receiver above ground is reached
under the canopy by a non-line-of-sight path (service 0.8.2); the popup's
cell count says how many trees there were.
The key under the panel
shows the signal palette, with the minimum signal as its weakest stop,
and the hatching that marks pixels reached by a non-line-of-sight path. A
popup anchored to the top edge of the patch (so it does not hide the
raster; a marker shows the clicked point)
shows the summary and, per tower, its best covering radio (most
coverage, then strongest signal); the side panel lists every radio with
coverage. Radios with none, and skipped ones, are only counted.

**Line of sight and non-line-of-sight (sample 0.8.0, service 0.8.0).**
Two checkboxes under Options choose which path types count, sent as the
request's `enable_los` and `enable_nlos` (both on by default; the page
refuses to send a request with neither, which the service would reject).
With NLOS on, a cell without line of sight gets the service's estimate of
the diffraction loss over the surface and the vegetation loss through
tree canopy (`docs/nlos-plan.md`), and the raster carries a second band
with each pixel's path type: pixels reached by a non-line-of-sight path
are drawn in the same colour ramp with a diagonal hatch, and where
patches overlap the hatching follows whichever patch's pixel wins. The
Receiver clearance field (`rxclearance`, metres, 1 to 20, default 3) is
how far around the receiver the surface is ignored in the NLOS profile,
so a roof edge or mast beside the receiver does not block it. The result
shows which paths the service counted and the clearance it applied, a
best-coverage line for the LOS figures and one for LOS + NLOS (the
`nlos` block counts both path types; `docs/patch-api.md` 4.10), and the
radio table has a LOS pair of columns and a LOS + NLOS pair. The 60 GHz
sectors are above the service's NLOS frequency ceiling (26 GHz) and are
evaluated line of sight only: their NLOS cells show "–" and a note
counts them. `foliage_tuning` is a per-radio value set in `towers.json`
(not exposed in the panel). There is only
ever one popup, and Clear rasters closes it. Where patches
overlap, each map pixel shows the strongest signal of the patches covering
it, drawn once, so overlapping patches never look stronger than either of
them.

**Debug pane (sample 0.8.1).** The Debug button at the top right of the
display opens a pane down the right side showing the last message sent to
the service and the reply it returned, both pretty printed in boxes that
scroll both ways, with a summary line (route, HTTP status, time taken,
bytes sent and received). It covers both modes: a patch request, a
building batch, and a rejected request, whose error body is shown. Long
strings, in practice the base64 raster, are shortened to their first 96
characters with the length appended; untick "shorten long strings" for
the whole thing. The Copy buttons put the full JSON of either side on the
clipboard. The pane can be dragged wider at its bottom-right corner. The
map's full-screen control is off, since the button sits in that corner
and full screen would hide the panels anyway.

**Point query (sample 0.8.4 to 0.8.6, service 0.8.7).** A right click anywhere on
the map, in either mode, asks the `point` endpoint
(`docs/point-api.md`) for the link budget from every radio of the ticked
towers to a receiver at that point, at the heights of the current mode
(above ground and above the surface in Patches, above the surface only in
Buildings, as the mode's own requests). A line is drawn from the point to
each tower, coloured by the tower's best signal in the signal palette:
solid for line of sight, dashed for a non-line-of-sight path, grey dotted
when nothing reaches the point (or every radio is skipped). A dot marks the
point and a card beside it lists one row per tower: its best radio, the
level, the path, the distance and the bearing from the point to the tower
(to aim a subscriber antenna; the service also returns the bearing from
the tower, which the page does not show). The card is a draggable marker
rather than an InfoWindow, so it can be pulled off the lines it would
otherwise cover (sample 0.8.5). The marker's own element is a box the size
of its content with its bottom centre at the point, and the browser
outlines it while it has focus (on a drag); sample 0.8.6 therefore gives
both markers a zero-size anchor at the point and places the card (below
and to the right) and the dot from it in CSS, so no empty outline appears
beside the card, and widens the card so its table needs no scrollbar. The
side panel lists every radio with its
off-axis angle and the elevation angle up to the AP, and each level's
tooltip gives the candidate heights' link budgets. The card's Hide button
removes the card, the dot and the lines; the next right click replaces
them. The lines are vector shapes, so they draw above the patch rasters
and the footprints.

**Point card fixes (sample 0.8.8).** A click on the card's Hide button
also reached the map as a click at that spot and drew a patch there; the
map's click and right-click handlers now ignore events whose target is
inside the card, and the button stops its click. Dragging the card moved
its marker to another place on the ground, which then drifted from the
point as the map zoomed; at the end of a drag the marker now returns to
the point and the drag becomes a change of the card's pixel offset from
it, so the card keeps its screen distance from the point at every zoom.
The card is also a little wider (up to 600 px).

**Path profile (sample 0.8.9, service 0.8.9).** Every row of the point
card (a tower's best radio) and of the panel's radio table (each radio)
has a **Profile** link. It asks the `profile` endpoint
(`docs/profile-api.md`) to explain the path from that radio to the
point, at the height of the candidate the row shows (`rx_height` of the
radio, or the request's one height), with the card's threshold, options
and path flags, and opens a drawer along the bottom of the map; the map
shrinks to make room and that tower's line gets a white halo. The chart
is plain SVG built from the reply's bins (`profile.js`): the ground in
brown and the clutter above it in grey, green where a bin is mostly
vegetation, both lifted by the Earth bulge (the curved-Earth frame, so
the radio line is straight); the first Fresnel zone as a translucent blue
band around the line with the 0.6 F1 boundary dashed; the two antennas on
their masts; the AP and receiver clearance zones shaded; the tightest
sample as an orange ring labelled with its Fresnel clearance; and on an
NLOS path the Bullington construction in red: the obstacle samples seen
from each end, the tangents and the equivalent knife edge with its `v`.
The caption gives the path, the level, the free-space level, the excess
loss split into diffraction and vegetation, the tightest clearance, the
distance, the frequency and the Earth model. Moving the pointer over the
chart reads out the bin under it (distance, ground, surface, clearance
in metres and in F1, the Fresnel radius and the bulge). The toolbar in
the drawer's head shows the stretch on view and zooms (`+`, `−`, about
the middle), pans (`◀`, `▶`, by a quarter of the stretch) and returns to the
whole path (**Full**); the wheel zooms about the pointer, dragging the
chart pans, and a double click shows the whole path again (sample
0.8.10). The page holds one reply, the whole path at the most bins the
service gives (2000), and draws each view from it; it asks the service
again only when the view needs finer bins than it holds (one bin per
pixel, down to 1 m) or runs past the held stretch, and then it asks for
the longest stretch the service can return at that step, centred on
the view, so the next pans and zooms nearby are drawn without a request
(one request in flight; a view that moves meanwhile is shown when the
reply is in). The drawer's top edge drags to resize it. Its Close button, the card's Hide button or the next
right click close it. Links in the card do not reach the map as clicks.

**Elevation extent (sample 0.8.7, service 0.8.8).** At start-up the page
asks `GET /api/v1/extent` (`docs/extent-api.md`) for the area the
service's elevation dataset covers and shades the map outside it: one
Polygon whose first path is the whole map and whose other paths are the
feature's rings, so each island of the dataset is cut out of the shading
and any hole inside an island is shaded again (the rings keep the
feature's orientation, outer counter-clockwise and holes clockwise, which
works under either fill rule). The mask is not clickable, so clicks and
right clicks outside the dataset still reach the map and get the
service's `unprocessable` answer. The hint line under the mode hints
names the dataset, its area and tile count, and its islands and holes
when there are any.

**Tidying (sample 0.8.3).** The Cell rasters box and the footprints /
rasters switch of sample 0.8.2 are gone: the service's per-building cell
raster (`raster: "composite"`, `docs/building-api.md` 4.5) stays
available to other clients, but this page shows the figures only. The
controls that belong to one mode (the patch radius and the receiver
above ground are the Patches mode's) are now really hidden in the other
mode: a stylesheet rule makes the `hidden` attribute win over the
flex display of the control rows, which it did not before.

No build step and no npm: plain HTML, CSS and ES modules. One library is
vendored under `vendor/` with its licence: geotiff.js 2.1.3, which decodes
the raster. The service returns the raster in Web Mercator (EPSG:3857), the
projection Google Maps draws in, so the overlay needs no reprojection: the
image's two corners convert to latitude and longitude with a closed form.

The towers are defined in `towers.json`, a data file the page fetches at
start, so they can be changed without touching any script (`config.js`
can point `towersUrl` at another file). The file gives the map centre,
`radio_defaults` that every radio inherits unless it sets its own, and
the towers, each with `id`, `name`, `lat`, `lon`, a mount (`height` above
the ground or `height_rooftop` above the surface, inherited by its radios
unless a radio gives its own) and its radios, each at least an
`azimuth_deg`. Any other field is passed to the service as written, so a
radio can carry its own `antenna`, `frequency_mhz`, `rx_gain_dbi` and so
on. Radio ids default to `<tower id>-<azimuth>`. The shape is documented
at the top of `towers.js`, which validates the file and names the entry
at fault.

The sample towers: Chase (33.8664, -98.53435) with four sectors covering
the NE, SE, SW and NW quadrants, a water tower with three sectors, a
mast to the north-west with four, and a 22 m downtown building (33.9160, -98.4978, the
radios 4 m above its roof) with two 60 GHz sectors (a Cambium V5000 at
60.48 GHz, vertical polarization, 2 km range: at 60 GHz the oxygen
absorption alone costs about 15 dB/km, so wet weather ends its coverage
within a kilometre). The
5.8 GHz radios are evaluated out to 20 km, the service's maximum. The default patch radius is 20 m (the service allows up to 100 m) and the default minimum signal −80 dBm. The Chase
coordinates are on the roof of a building about 45 m tall, so its radios
use `height_rooftop` (metres above the surface) rather than `height`
(metres above the ground); 6 m above the roof clears a higher roof section
nearby. A `height` of 35 m would put the antennas inside the building.
Every radio also sets `apclearance` to 30 m (the service default is
10 m), so terrain and surface data within 30 m of an AP, such as the
roof it stands on or its own tower, never block it.

## Buildings

The Buildings mode evaluates building footprints instead of patches; map
clicks do not start patches in this mode. Evaluate buildings takes every building of `buildings.json` whose centroid
lies within the radius (default 1000 m) of any ticked tower, draws them as
outlines on the map's Data layer, and sends them to `POST /api/v1/building`
in batches of 300 neighbours (400 before 0.8.0; the NLOS walk made the largest batch run close to the 120 s deadline) (grouped by 200 m squares, ordered along a
Hilbert curve so each batch is a compact block and the service's own
clusters are full), one request at a time. As each reply arrives the
buildings fill with a colour: by the percentage of the footprint's 1 m
cells with a signal at or above the minimum signal from any radio
(grey 0 %, red low, green 100 %), or by the third-strongest cell's signal
in the signal palette; the key follows the colouring. Stop ends the run after the current batch, Clear
buildings removes the footprints. The receiver is the panel's "above
rooftop" height, 2 m above the DSM at every cell: on a footprint the DSM
is the roof, and a receiver above the ground would be inside the
building. Cells the dataset flags as vegetation (a tree over the roof)
are never evaluated: they count against the coverage and never for it,
and the popup says how many there are. The LOS and NLOS checkboxes and
the receiver clearance apply to buildings too: the figures count every
cell reached by a selected path type (`docs/building-plan.md` 1.3), and
the popup says which paths were counted. Clicking a building opens its
figures (cells, combined coverage and third-strongest cell, the best and
strongest radio, one row per tower with its best radio) in the popup,
anchored to the footprint's northern edge so it does not cover the
building, and every radio in the side panel; a click elsewhere is still a patch. A
building that a ticked tower stands in (the coliseum under the 60 GHz
site) hosts an access point: the service excludes it, and it stays dark
grey with "hosts an access point" in its popup. About 3900 buildings lie within 1 km of the four sample towers (1474
around Chase, 1147 around the water tower, 1054 around Northwest, 849
around the 60 GHz site); 14 batches with every tower ticked.

The footprints come from the **Microsoft Building Footprints** (the
GlobalMLBuildingFootprints release, ODbL, machine-extracted from imagery)
since 2026-10-29: OpenStreetMap, the source until then, has most of the
commercial buildings of Wichita Falls but few of its houses (198
footprints within 1 km of Chase against 1474 now). The release is tiled
by Bing quadkey; the tool downloads the index and the four tiles that
cover the dataset's box (13 MB), keeps the footprints within 6 km of the
towers and writes the compact file, carrying over the names, building
types and levels of the OpenStreetMap footprints whose centroid falls
inside a Microsoft footprint (about 2600 of 46,775), so the popups keep
their names. Each footprint has the release's estimated `height_m` where
it has one (35,447 of them). The downloads and the file are kept on the
SSD in `~/rfreveal/data/msbuildings` (archive copy on GeoData):

```bash
python3 -I tools/fetch-ms-buildings.py ~/rfreveal/data/msbuildings/raw towers.json \
    ~/rfreveal/data/msbuildings/buildings.json --distance-km 6 --osm ~/rfreveal/data/osm/buildings.json
ln -sfn ~/rfreveal/data/msbuildings/buildings.json buildings.json
```

The OpenStreetMap file is still built and kept at `~/rfreveal/data/osm/buildings.json`:
the speed suite (`tests/speed`) selects its building cases from it, and
its reference replies depend on exactly those footprints. The OSM route:

```bash
tools/fetch-osm-buildings.sh ~/rfreveal/data/osm       # Overpass → .osm → .geojson (ogr2ogr)
python3 -I tools/compact-buildings.py ~/rfreveal/data/osm/wichitafalls-buildings.geojson \
    towers.json ~/rfreveal/data/osm/buildings.json --distance-km 6
```

`fetch-osm-buildings.sh` asks the public Overpass API for the ways and
multipolygon relations tagged `building` in the dataset's 25 km box
(retrying with backoff when the server is busy, as its policy asks) and
converts the OSM XML with `ogr2ogr`, whose OSM driver assembles the
multipolygons. `compact-buildings.py` keeps the buildings within a
distance of the towers in `towers.json` and writes an array of
`{ id, name?, building, levels?, rings }` with six-decimal `[lon, lat]`
positions, the first ring the outer one and the rest holes
(`building.js` documents the shape; `config.js` can point `buildingsUrl`
elsewhere). On 2026-10-23 the box held 18,516 OSM buildings (13.5 MB of
XML, 7.2 MB of GeoJSON), 15,814 of them within 6 km of the towers (3.5 MB
compact). That is a partial map of the city: the residential areas north
and west of the towers are well covered, the commercial centre and the
south less so. Both files are regenerable bulk data and live in
`~/rfreveal/data/osm/` (copied from GeoData on 2026-10-28), where the symlink points. If OSM coverage proves too thin, the Overture Maps buildings
theme (which includes the Microsoft footprints) can replace the download;
`compact-buildings.py` only needs GeoJSON polygons with an id.

The Atmosphere option selects what the service adds to the free-space
loss: `none` (the default), or `dry` and `wet`, which add the P.676 gas
loss and the P.838/P.530 rain loss for the rain rate exceeded 95 % (dry)
or 5 % (wet) of rainy time at each tower, from the ITU maps built into
the service image. The result shows the mode and rain rate used and, per
radio, the gas plus rain specific attenuation in dB/km.

## Run

1. Start the service with the Wichita Falls dataset, allowing this page's
   origin (the service sends no CORS headers unless asked; see
   `server/README.md`):

   ```bash
   docker run --rm -p 127.0.0.1:8080:8080 \
     -e RFREVEAL_CORS_ORIGIN=http://localhost:8000 \
     -v /home/richard/rfreveal/data/elevation/wichitafalls:/data/elevation:ro \
     rfreveald:0.8.5
   ```

2. Add your own Google Maps JavaScript API key. `config.js` is committed
   with an empty key. Put your key in `config.local.js`, which `.gitignore`
   keeps out of version control and which overrides `config.js`:

   ```bash
   cat > config.local.js <<'EOF'
   Object.assign(window.RFREVEAL_CONFIG, { googleMapsApiKey: "YOUR_KEY" });
   EOF
   ```

   Or, if you don't use git, edit `googleMapsApiKey` in `config.js`. Never
   commit a real key.

3. Serve the directory with any static file server and open it (after
   updating the sample, reload the page with the cache bypassed, for
   example Ctrl+Shift+R, so the browser does not keep the old scripts; the
   footer shows the sample version and the Towers heading the count read
   from `towers.json`):

   ```bash
   python3 tools/serve.py 8000       # then http://localhost:8000/
   ```

   `tools/serve.py` is Python's `http.server` with a `Cache-Control:
   no-store` header on every file, so a plain reload always fetches the
   current scripts; a bare `python3 -m http.server 8000` works too.
   Browsers keep ES modules served without cache headers for a while, so
   `index.html` also carries the sample version in the module URLs (an
   import map rewrites every `./x.js` import to `./x.js?v=<version>`, and
   the `app.js` script tag has it too): a plain reload revalidates
   `index.html` and so fetches the current modules, never a mix of old
   and new. Bump that version, with the footer's, on each change.

   The page is ES modules, so it must come from an http URL rather than a
   `file://` one. Any other port works as long as `RFREVEAL_CORS_ORIGIN`
   names it.

`node --test` (run in this directory) runs the unit tests (Node 20 or newer; on the
development machine use `/usr/bin/node`, since a stale Node 18.0.0 in
`/usr/local/bin` comes first on the PATH). The raster test talks to the
service when it is reachable at `RFREVEALD_URL` (default `http://127.0.0.1:8080`)
and is skipped otherwise.

## Files

- `index.html`, `styles.css`: the page.
- `app.js`: loads the Maps API, places the tower markers, wires the
  checkboxes and the click handler, draws each patch's overlay and radius
  circle and fills the result panel. A click while a request is in flight
  aborts the earlier one. It also runs the buildings mode (the Data layer,
  its style function, the batch loop and the building popup) and the
  debug pane.
- `debug.js`: the debug pane's pure parts: pretty printing with long
  strings shortened, and the summary line of an exchange. `fetchJSON` in
  `patch.js` reports each exchange to a `trace` callback as the request
  goes out and again when the reply (or failure) is in.
- `patch.js`: builds the request (metric units), posts it, decodes the
  base64 GeoTIFF with geotiff.js, checks it is EPSG:3857, converts its
  corners to WGS 84 and paints the bytes (negated dBm, 255 = transparent)
  into an enlarged PNG for a `GroundOverlay`, hatching the pixels whose
  path band says non-line-of-sight; the path flags and the receiver
  clearance of both requests (`pathFlags`, `flagsValid`).
- `extent.js`: the extent's pure parts: the mask paths from the GeoJSON
  feature (the world ring first) and the panel summary; `fetchExtent`.
- `profile.js`: the path profile's pure parts: the request from a card
  row, the chart's scales, the SVG as a string (ground, clutter, Fresnel
  zone, line, markers, axes), the title, caption and hover readout, the
  wheel zoom arithmetic; `fetchProfile`.
- `point.js`: the right-click query's pure parts: the request, the best
  radio per tower, the line colour and dash, the formatting.
- `building.js`: the buildings mode's pure parts: loading and checking
  `buildings.json`, selecting footprints within a radius of the towers,
  batching by 200 m squares, the request, the colours and the per-tower
  best radios.
- `buildings.json`: the OpenStreetMap footprints (a symlink to the
  regenerable file; see Buildings above). `tools/`: the download and
  compaction scripts.
- `towers.js`: the three towers (all inside the dataset) and their radios,
  heights in metres and ranges in kilometres.
- `config.js`: map ID, service address, file locations, and an empty key (committed).
- `config.local.js`: your own key and any other overrides (not committed).
- `test/`: Node unit tests.

A pixel of the raster is one ground metre; at this latitude that is 1.2
projected metres, and the service's grid is centred on the clicked point.
