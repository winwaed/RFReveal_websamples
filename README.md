# rfreveal-map

rfreveal-map is the web demo for [RF Reveal](https://rfreveal.com/), and
consists of a single HTML page that puts your towers on a Google map and
asks the RF Reveal service what they cover. Click the map for a coverage
**patch** drawn over the imagery,
switch to **Buildings** to color every footprint in an area by its
coverage, or right-click anywhere for a **point** link budget with a **path
profile** from each tower. There is no no build step or npm, and only uses
plain HTML, CSS and ES modules with one vendored library (geotiff.js), and
two data files that you can replace with your own.

The page is open source under the BSD 3-Clause License. The RF Reveal
service it talks to is commercial software that runs in Docker on your
own machine with the elevation data that you licensed; "RF Reveal" is a
product name the license does not grant. Everything the demo shows is
computed by the service: the page only draws it.

- **[Try it](#try-it)**: run the page against a service in a few minutes.
- **[Run it for real](#run-it-for-real)**: your towers, your footprints,
  your network.
- **[Customize it](#customize-it)**: change the page or build your own
  client on the same requests.
- **[What the page does](#what-the-page-does)**: every control, mode and
  figure.
- **[Changelog](#changelog)**.

## Try it

First you will need the RF Reveal service running with an elevation dataset
(Docker is the only prerequisite; your delivery README has the `docker
run` line), a Google Maps JavaScript API key of your own, and any static
file server (Python 3 is enough).

1. **Start the RF Reveal service, allowing this page's origin.** The
   service sends
   no CORS headers unless asked, and a browser blocks the page's requests
   without them:

   ```bash
   docker run --rm -p 127.0.0.1:8080:8080 \
     -e RFREVEAL_CORS_ORIGIN=http://localhost:8000 \
     -v /path/to/your/elevation:/data/elevation:ro \
     -v /path/to/your/license.json:/data/license.json:ro \
     rfreveald:<version>
   ```

   RFREVEAL_CORS_ORIGIN allows calls from the specified origin. This allows
   rfreveal-map (localhost, port 8000) to access RF Reveal's webservice.

2. **Add your Google Maps key.** `config.js` is committed with an empty
   key. Put your Google Maps key in `config.local.js`, which `.gitignore`
   keeps out of
   version control and which overrides `config.js`:

   ```bash
   cat > config.local.js <<'EOF'
   Object.assign(window.RFREVEAL_CONFIG, { googleMapsApiKey: "YOUR_KEY" });
   EOF
   ```

   The map is Google's, not part of this project: whoever deploys the
   page needs their own key from the Google Cloud console and accepts the
   [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)
   and its billing (the Maps JavaScript API has a free monthly allowance;
   restrict the key to your site's address).

3. **Set towers.json** This specifies your tower and AP information.
   The sample gives four towers in the Wichita Falls (Texas) area.
   See below for more information.

4. **Serve the directory and open it.** The page contains ES modules, so it
   must come from an `http://` URL, not `file://`:

   ```bash
   python3 tools/serve.py 8000       # then http://localhost:8000/
   ```

   `tools/serve.py` is Python's `http.server` with `Cache-Control:
   no-store`, so a plain reload always fetches the current scripts; a
   bare `python3 -m http.server 8000` works too. Any other port works as
   long as `RFREVEAL_CORS_ORIGIN` names it.

4. **Look around.** The sample `towers.json` holds four fictional sites in
   Wichita Falls, Texas. The map will be shaded outside your elevation data.
   With the sample towers over your own dataset you will see only the
   shading: replace them with your own (next section). Then:

   - **Click** the map: a coverage patch at that point from the ticked
     towers, with a popup of the figures.
   - **Buildings** mode, **Evaluate buildings**: every footprint around
     the towers, or inside a window you draw, colored by coverage.
   - **Right-click**: the link budget from every tower to that point,
     with a **Profile** link per tower that opens the path profile.
   - **Debug** (top right): the last request and reply, and the two
     files to attach to a support message.

## Run it for real

### Your towers

`towers.json` is fetched at the start, so the towers can be changed without
touching any of the scripts (`config.js` can point `towersUrl` at another file). It specifies the `units` (`"metric"` or `"imperial"`) for towers information.
The units can be different to the display units in `config.js`.
The units cover the ranges, `apclearance`, and heights.

The `towers.json` file also specifies the map center, `radio_defaults`
defaults for each radio), and the actual tower definitions:

```json
{
  "units" : "metric",
  "map_center": { "lat": 33.9137, "lon": -98.4934 },
  "radio_defaults": { "antenna": "cn-450-micropop-sector-antenna-5g", "frequency_ghz": 5.8,
                      "tilt_deg": -2, "tx_power_dbm": 18, "apclearance": 30, "range": 20 },
  "towers": [
    { "id": "chase", "name": "Chase", "lat": 33.8664, "lon": -98.53435, "height_rooftop": 6,
      "radios": [ { "azimuth_deg": 45, "name": "NE sector" }, { "azimuth_deg": 135, "name": "SE sector" } ] }
  ]
}
```

Each tower has `id`, `name`, `lat`, `lon`, a mount (`height` above the
ground, or `height_rooftop` above the surface for a radio on a roof,
inherited by its radios unless a radio gives its own) and its radios,
each at least an `azimuth_deg`. Any other field is passed to the service
as written, so a radio can carry its own `antenna`, `frequency_mhz`,
`rx_gain_dbi`, `foliage_tuning` and so on; radio ids default to
`<tower id>-<azimuth>`. The shape is documented at the top of
`towers.js`, which validates the file and names the entry at fault. Two
lessons from the sample: a tower whose coordinates are on a roof wants
`height_rooftop`, since a `height` above the ground of less than the
building's height puts the antennas inside it; and `apclearance` of
30 m (the service default is 10 m) keeps the roof or mast the AP stands
on from blocking it. The 5.8 GHz sample radios reach the service's 20 km
maximum; the 60 GHz pair (a Cambium V5000) reaches 2 km, because oxygen
absorption alone costs about 15 dB/km there.

### Your building footprints

The Buildings mode needs `buildings.json`, a compact file of footprints
(`config.js` can point `buildingsUrl` elsewhere). The demo does not ship
with one, but you can use `tools/fetch-buildings.py` to create a file from
the **Microsoft Global ML Building Footprints** release (Open Database
License). This fetches all building footprints within your elevation extents.
It can also optionally download OpenStreetMap footprints.

This script only requires the standard Python library. Run it with `python3 -I` since it downloads data:

```bash
python3 -I tools/fetch-buildings.py /path/to/raw towers.json buildings.json \
    --extent http://localhost:8080            # reads GET /api/v1/extent from the service
# optional: --osm osm-buildings.json  (names from an OpenStreetMap file, below)
# alternative: --distance-km 6       (footprints within 6 km of the towers instead)
```

The release is tiled by Bing quadkey; the tool downloads the index and
the tiles covering the extent into `/path/to/raw` (reused when present)
and writes an array of `{ id, building, rings, height_m?, name?, levels? }`
with six-decimal `[lon, lat]` positions, the first ring the outer one and
the rest holes. As a guide, the whole 3,240 km² Wichita Falls extent gives
76,759 footprints (17 MB), which the page loads in about a second.

Both Microsoft Buildings and OpenStreetMaps are licensed under the ODbL,
which requires their credit where the
map is shown: the page carries it (see **Credits** below). If you use a
different source, change the credit.

### Serving it to your team

The page consists of static files: put the directory on any web server and set
`apiBase` in `config.local.js` to where the service is reachable. The
service itself has no authentication or TLS; reach it on your internal
network or through a reverse proxy that adds both (the deployment guide
in the RF Reveal documentation has a complete example), and give the
proxy's origin to `RFREVEAL_CORS_ORIGIN`. Keep `config.local.js` out of
version control: it holds your key.

### Credits

Two data credits must appear where the map is shown: the footprints
(Microsoft, with names © OpenStreetMap contributors, both ODbL) and the
elevation (USGS 3DEP lidar processed by Winwaed Software Technology LLC).
A one-line credit sits at the lower left of the map, and its **About**
link, like the one under the panel, opens a dialog with the full credits
and links, the demo's license, and the service's version and dataset
read from `GET /api/v1/health`. If you replace the footprints or the
elevation data, change the credit line in `app.js` (`addCreditControl`)
and the dialog in `index.html`.

## Customize it

### Layout of the code

Every module except `app.js` contains pure functions, testable in Node without
a browser; `app.js` holds the page state and the Google Maps calls.

- `index.html`, `styles.css`: the page, the About dialog, the import map
  that pins every module URL to the sample version.
- `app.js`: loads the Maps API, places the markers, wires the controls,
  draws patches, footprints, point lines and the profile drawer, runs the
  batch loop and the Debug pane.
- `patch.js`: the patch request, `fetchJSON` (used by
  every request, with a `trace` callback for the Debug pane), the
  GeoTIFF decode and the raster painting (negated dBm bytes, 255
  transparent, NLOS pixels hatched), the path flags.
- `building.js`: loading and checking `buildings.json`, selection by
  radius or window, batching by 200 m squares along a Hilbert curve, the
  request, the colors, the per-tower best radios.
- `point.js`, `profile.js`, `extent.js`: the right-click query, the path
  profile chart (SVG as a string, scales, zoom arithmetic) and the
  dataset mask, each with its request builder.
- `debug.js`: pretty printing and the summary line of an exchange.
- `towers.js`: reads and validates `towers.json`.
- `config.js` and `config.local.js`: settings (below).
- `tools/`: the footprint scripts and `serve.py`. `test/`: Node tests.
- `vendor/`: geotiff.js 2.1.3 with its MIT license.

`node --test` (Node 20 or newer, in this directory) runs the tests; the
raster test talks to a service at `RFREVEALD_URL` (default
`http://127.0.0.1:8080`) when one is reachable and is skipped otherwise.
When you change a module, bump the sample version in three places so
browsers never mix old and new modules: the import map and the script
tag in `index.html`, and `SAMPLE_VERSION` in `app.js` (the footer shows
it). Reload with the cache bypassed (Ctrl+Shift+R) after an update.

### Settings (`config.js`)

| Setting | Meaning |
|---|---|
| `googleMapsApiKey` | Your key; put it in `config.local.js`. |
| `mapId` | Map ID; `DEMO_MAP_ID` works for development, advanced markers need one. |
| `apiBase` | Where the service listens (default `http://localhost:8080`). |
| `towersUrl`, `buildingsUrl` | The data files. |
| `units` | `"imperial"` (feet and miles, the service's default) or `"metric"` (meters and kilometers): the units of the panel's fields, every request and every figure shown. The towers file declares its own units and is converted. |
| `reverseSignalColors` | `true` draws red as the strongest signal and green as the weakest, the order cnHeat uses, in every palette and the coverage ramp. |

### Building your own client

The page is a worked example of the four requests: `POST /api/v1/patch`,
`/building`, `/point` and `/profile`, plus `GET /api/v1/extent` and
`/health`. Each request builder is a pure function you can lift
(`buildPatchRequest`, `buildBuildingRequest`, ...), and the Debug pane
shows the exact JSON sent and received, which is the quickest way to
learn the shapes. The API references are in the RF Reveal documentation.
Points worth copying: send building batches as compact blocks of
neighbors (the service clusters each batch in one projection zone);
hold one profile reply at the most bins the service gives and redraw
views from it, asking again only when a view needs finer bins; draw the
patch raster as a `GroundOverlay` straight from the service's Web
Mercator GeoTIFF, which needs no reprojection on a Google map.

## What the page does

### Patches

Left click performs a query of the selected towers to produce a patch
centerd on the click point. Options include patch radius and minimum signal.

The patch RSL is drawn over the map with a white circle at the patch radius.
Colors vary from green (strongest signal) to red (weakest). Hatching shows an
NLOS (non-line-of-sight) connection.

Press the **Clear rasters* to clear all of the current displayed patches.

Water cells are transparent, and so are tree cells (vegetation over 1 m,
where no receiver can be mounted) unless the receiver above ground is
reachable under the canopy by a non-line-of-sight path. The popup window
gives summary coverage information, including the number of pixels
marked as trees.

**Options** apply to every mode. *Receiver above ground* and *above
rooftop* are the two candidate heights of a patch (a roof-mounted
receiver and a pole). *Line of sight* and *Non-line-of-sight* choose
which path types count (`enable_los`, `enable_nlos`; the page refuses
neither). With NLOS on, a cell without line of sight gets the service's
estimate of the diffraction loss over the surface and the vegetation loss
through canopy, and the raster's second band marks it: NLOS pixels are
drawn with a diagonal hatch. *Receiver clearance* (1 to 20 m, default 3)
is how far around the receiver the surface is ignored, so a roof edge
beside it does not block it. *Atmosphere* adds nothing (`none`), or the
ITU gas and rain losses for the rain rate exceeded 95 % (`dry`) or 5 %
(`wet`) of rainy time at each tower. Radios above the service's 26 GHz
NLOS ceiling (the 60 GHz sample pair) are evaluated line of sight only.
The key under the panel shows the palette with the minimum signal as its
weakest stop, and the hatch.

### Buildings

The Buildings mode evaluates footprints instead of patches. **Select**
chooses them: every footprint whose center is within a radius (default
1000 m) of a ticked tower, or inside a **window** you draw. To draw,
press **Draw window** and drag with the left mouse button, or hold
**Shift** and drag at any time; the drag lands on a transparent layer
laid over the map only while a drag is wanted, so panning, wheel zoom
and the right-click query are untouched otherwise. **Esc** cancels a
drag, a new window replaces the old, **Remove window** takes it off; the
window's size and building count show under the field.

**Evaluate buildings** draws the selection as outlines and sends it in
batches of 300 neighbors, one request at a time. As each reply arrives
the buildings fill: by the percentage of their 1 m cells with a signal at
or above the minimum from any radio (gray 0 %, red low, green 100 %), or
by the third-strongest cell's signal in the palette (**Color by**). The
receiver is the *above rooftop* height at every cell, since on a
footprint the surface is the roof. Tree cells over a roof count against
the coverage, never for it. **Stop** ends the run after the current
batch; **Clear buildings** removes the footprints and keeps the window.
Clicking a building opens its figures (cells, combined coverage and
third-strongest cell, best and strongest radio, one row per tower) in a
popup anchored to its northern edge, and every radio in the panel. A
building a ticked tower stands in hosts an access point: the service
excludes it and it stays dark gray.

### Point query

A right click anywhere, in either mode, asks for the link budget from
every radio of the ticked towers to a receiver at that point, at the
heights of the current mode. A line is drawn to each tower, colored by
its best signal: solid for line of sight, dashed for NLOS, gray dotted
when nothing reaches the point. A card beside the point lists one row per
tower with its best radio, level, path, distance and the bearing from
the point to the tower (to aim a subscriber antenna); the panel lists
every radio with its off-axis and elevation angles. The card drags out of
the way and keeps its screen offset at every zoom; **Hide**, or the next
right click, removes everything.

### Path profile

Every row of the point card and of the panel's radio table has a
**Profile** link. It opens a drawer along the bottom of the map with the
path from that radio to the point: the ground in brown and the clutter
above it in gray (green where a bin is mostly vegetation), lifted by the
Earth bulge so the radio line is straight; the first Fresnel zone as a
blue band with the 0.6 F1 boundary dashed; both antennas on their masts;
the AP and receiver clearance zones; the tightest sample ringed in orange
with its Fresnel clearance; and on an NLOS path the Bullington
construction in red (the obstacle samples seen from each end, the
tangents, the equivalent knife edge with its `v`). The caption gives the
path, the level, the free-space level, the excess loss split into
diffraction and vegetation, the tightest clearance, the distance, the
frequency and the Earth model; the pointer reads out the bin under it.
The toolbar zooms and pans; the wheel zooms about the pointer, dragging
pans, a double click shows the whole path. The drawer's top edge drags
to resize it.

### Elevation extent

At start the page asks `GET /api/v1/extent` for the area the service's
dataset covers and shades the map outside it (islands cut out, holes
shaded again). The mask is not clickable, so a click outside still
reaches the map and gets the service's `unprocessable` answer. The hint
line names the dataset, its area and tile count.

### Debug pane

The **Debug** button opens a pane down the right side with the last
request and reply, pretty printed, with a summary line (route, HTTP
status, time, bytes, the service's request id). Long strings (i.e. the
base64 GeoTIFF) are shortened unless you untick the box; **Copy**
puts the full JSON on the clipboard. **Save request + reply** writes the
exchange as `rfreveal-request-<request id>.json`; **Diagnostics report**
downloads the service's `GET /api/v1/diagnostics` zip. Both can be included
in support requests.

### Credits and About

The credit line at the lower left of the map and the **About and data
credits** link under the panel open the About dialog: the demo and its
license, the service's version and dataset, and the data credits with
links (Credits, above).

## Changelog

Entries start with the first release of RF Reveal. The sample version is
shown in the page footer and in every module URL.

## Notes

A pixel of the raster is one ground meter; at Wichita Falls' latitude
that is 1.2 projected meters, and the service's grid is centerd on the
clicked point. The service returns the raster in Web Mercator
(EPSG:3857), the projection Google Maps draws in, so the overlay needs
no reprojection. Vector shapes (circles, lines, the window) draw above
every ground overlay, so a later patch never hides an earlier circle.
