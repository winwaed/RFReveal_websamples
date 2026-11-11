#!/usr/bin/env python3
"""Turn the GeoJSON written by fetch-osm-buildings.sh into the page's
buildings.json: a JSON array of

    {"id": "w123" | "r456" | "r456-2", "name": "...", "building": "house",
     "levels": 2, "rings": [[[lon, lat], ...], ...]}

with the first ring the outer one and the rest holes (a multipolygon
becomes one entry per polygon, the id suffixed -2, -3, ...). Only the
buildings within DISTANCE km of any tower in towers.json are kept, so the
file stays a few megabytes. Standard library only.

    compact-buildings.py GEOJSON TOWERS_JSON OUT_JSON [--distance-km 6]
"""
import argparse
import json
import math
import sys


def centroid(ring):
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def distance_m(lon1, lat1, lon2, lat2):
    # Equirectangular approximation: fine for a few kilometres.
    r = 6371000.0
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return r * math.hypot(x, y)


def levels_of(other_tags):
    # other_tags is GDAL's hstore-like string: "k"=>"v","k2"=>"v2"
    if not other_tags:
        return None
    key = '"building:levels"=>"'
    i = other_tags.find(key)
    if i < 0:
        return None
    j = other_tags.find('"', i + len(key))
    try:
        return float(other_tags[i + len(key):j])
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("geojson")
    ap.add_argument("towers")
    ap.add_argument("out")
    ap.add_argument("--distance-km", type=float, default=6.0)
    a = ap.parse_args()

    with open(a.towers) as f:
        towers = [(t["lon"], t["lat"]) for t in json.load(f)["towers"]]
    with open(a.geojson) as f:
        fc = json.load(f)

    out, seen, kept, dropped, invalid = [], set(), 0, 0, 0
    for feat in fc.get("features", []):
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        polys = []
        if geom.get("type") == "Polygon":
            polys = [geom["coordinates"]]
        elif geom.get("type") == "MultiPolygon":
            polys = geom["coordinates"]
        else:
            invalid += 1
            continue
        base = f"w{props['osm_way_id']}" if props.get("osm_way_id") else f"r{props.get('osm_id')}"
        for k, rings in enumerate(polys):
            rings = [[[round(x, 6), round(y, 6)] for x, y in ring] for ring in rings if len(ring) >= 4]
            if not rings:
                invalid += 1
                continue
            lon, lat = centroid(rings[0])
            if not any(distance_m(lon, lat, tl, tt) <= a.distance_km * 1000 for tl, tt in towers):
                dropped += 1
                continue
            bid = base if k == 0 else f"{base}-{k + 1}"
            if bid in seen:
                invalid += 1
                continue
            seen.add(bid)
            entry = {"id": bid, "building": props.get("building") or "yes", "rings": rings}
            if props.get("name"):
                entry["name"] = props["name"]
            lv = levels_of(props.get("other_tags"))
            if lv is not None:
                entry["levels"] = lv
            out.append(entry)
            kept += 1
    out.sort(key=lambda b: b["id"])
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{kept} buildings kept within {a.distance_km} km of {len(towers)} towers, "
          f"{dropped} farther away, {invalid} unusable; wrote {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
