#!/usr/bin/env python3
"""Build the page's buildings.json from the Microsoft Building Footprints
(the GlobalMLBuildingFootprints release, ODbL), which cover houses that
OpenStreetMap has not mapped in the study area.

The release is tiled by Bing quadkey (level 9) and indexed in
dataset-links.csv; this tool downloads the index and the UnitedStates
tiles covering the box, keeps the footprints whose centroid is within
DISTANCE km of any tower in towers.json (the rule of compact-buildings.py)
and writes the same compact format:

    {"id": "ms023112211-4711", "building": "yes", "rings": [[[lon, lat], ...]],
     "height_m": 4.2}

`height_m` is the release's estimated height where it has one. With
--osm, the names, building types and levels of the OpenStreetMap file are
carried over to the Microsoft footprint that contains the OSM footprint's
centroid, so the popups keep their names. Standard library only; the
downloads go to RAWDIR and are reused when present. Run it with
python3 -I, as the data is downloaded.

    fetch-ms-buildings.py RAWDIR TOWERS_JSON OUT_JSON [--distance-km 6]
        [--bbox S W N E] [--osm osm-buildings.json]
"""
import argparse
import csv
import gzip
import json
import math
import os
import sys
import urllib.request

INDEX_URL = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
LEVEL = 9
UA = "patch-sample/0.8 (building footprints; see web-samples/rfreveal-map/README.md)"


def tile_xy(lon, lat, z):
    s = math.sin(math.radians(lat))
    x = (lon + 180) / 360
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    n = 2 ** z
    return min(n - 1, max(0, int(x * n))), min(n - 1, max(0, int(y * n)))


def quadkey(tx, ty, z):
    q = ""
    for i in range(z, 0, -1):
        d, m = 0, 1 << (i - 1)
        if tx & m:
            d += 1
        if ty & m:
            d += 2
        q += str(d)
    return q


def quadkeys_covering(south, west, north, east):
    x0, y0 = tile_xy(west, north, LEVEL)  # north-west corner: smallest x and y
    x1, y1 = tile_xy(east, south, LEVEL)
    return sorted(quadkey(x, y, LEVEL) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1))


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return False
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=600) as r, open(path + ".part", "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(path + ".part", path)
    return True


def centroid(ring):
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def distance_m(lon1, lat1, lon2, lat2):
    r = 6371000.0
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return r * math.hypot(x, y)


def inside(ring, lon, lat):
    # Even-odd rule on the outer ring.
    n = len(ring)
    hit = False
    for i in range(n - 1):
        (x1, y1), (x2, y2) = ring[i], ring[i + 1]
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rawdir")
    ap.add_argument("towers")
    ap.add_argument("out")
    ap.add_argument("--distance-km", type=float, default=6.0)
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("S", "W", "N", "E"),
                    default=[33.64101, -98.80454, 34.16019, -98.23085], help="the dataset box (default wichitafalls)")
    ap.add_argument("--osm", help="OSM buildings.json whose names, types and levels are carried over")
    a = ap.parse_args()
    os.makedirs(a.rawdir, exist_ok=True)

    with open(a.towers) as f:
        towers = [(t["lon"], t["lat"]) for t in json.load(f)["towers"]]
    limit = a.distance_km * 1000

    index = os.path.join(a.rawdir, "dataset-links.csv")
    if download(INDEX_URL, index):
        print("downloaded the tile index", file=sys.stderr)
    keys = set(quadkeys_covering(*a.bbox))
    tiles = []
    with open(index, newline="") as f:
        for row in csv.DictReader(f):
            if row["Location"] == "UnitedStates" and row["QuadKey"] in keys:
                tiles.append((row["QuadKey"], row["Url"], row["Size"], row.get("UploadDate", "")))
    missing = keys - {t[0] for t in tiles}
    if missing:
        print(f"no UnitedStates tile for quadkeys {sorted(missing)}", file=sys.stderr)
    print(f"{len(tiles)} tiles cover the box: " + ", ".join(f"{q} ({s}, {d})" for q, _, s, d in tiles), file=sys.stderr)

    out, seen_total, kept = [], 0, 0
    for q, url, _, _ in tiles:
        path = os.path.join(a.rawdir, f"UnitedStates-{q}.geojsonl.gz")
        if download(url, path):
            print(f"downloaded {path}", file=sys.stderr)
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for n, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                seen_total += 1
                feat = json.loads(line)
                geom = feat.get("geometry") or {}
                polys = [geom["coordinates"]] if geom.get("type") == "Polygon" else \
                    geom["coordinates"] if geom.get("type") == "MultiPolygon" else []
                for k, rings in enumerate(polys):
                    rings = [[[round(x, 6), round(y, 6)] for x, y in ring] for ring in rings if len(ring) >= 4]
                    if not rings:
                        continue
                    lon, lat = centroid(rings[0])
                    if not any(distance_m(lon, lat, tl, tt) <= limit for tl, tt in towers):
                        continue
                    entry = {"id": f"ms{q}-{n}" + ("" if k == 0 else f"-{k + 1}"), "building": "yes", "rings": rings}
                    h = (feat.get("properties") or {}).get("height")
                    if isinstance(h, (int, float)) and h > 0:
                        entry["height_m"] = round(h, 1)
                    out.append(entry)
                    kept += 1

    named = 0
    if a.osm:
        with open(a.osm) as f:
            osm = json.load(f)
        # Grid index of the kept footprints by their bounding boxes, 0.002 degrees a cell.
        cell = 0.002
        grid = {}
        for i, b in enumerate(out):
            xs = [p[0] for p in b["rings"][0]]
            ys = [p[1] for p in b["rings"][0]]
            for gx in range(int(min(xs) / cell), int(max(xs) / cell) + 1):
                for gy in range(int(min(ys) / cell), int(max(ys) / cell) + 1):
                    grid.setdefault((gx, gy), []).append(i)
        for ob in osm:
            tags = {k: ob[k] for k in ("name", "levels") if k in ob}
            if ob.get("building", "yes") != "yes":
                tags["building"] = ob["building"]
            if not tags:
                continue
            lon, lat = centroid(ob["rings"][0])
            for i in grid.get((int(lon / cell), int(lat / cell)), []):
                if inside(out[i]["rings"][0], lon, lat):
                    for k, v in tags.items():
                        out[i].setdefault(k, v)
                    out[i]["osm_id"] = ob["id"]
                    named += 1
                    break

    out.sort(key=lambda b: b["id"])
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{kept} of {seen_total} footprints kept within {a.distance_km} km of {len(towers)} towers"
          + (f", {named} carry OSM names, types or levels" if a.osm else "") + f"; wrote {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
