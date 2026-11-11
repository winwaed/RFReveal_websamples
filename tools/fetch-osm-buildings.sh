#!/bin/sh
# Download the OpenStreetMap building footprints of the study area from the
# Overpass API as OSM XML (ways and multipolygon relations tagged building,
# with their nodes), then convert them to GeoJSON with ogr2ogr, whose OSM
# driver assembles the multipolygons and treats closed building ways as
# polygons. Usage:
#
#   tools/fetch-osm-buildings.sh OUTDIR [SOUTH WEST NORTH EAST]
#
# The box defaults to the wichitafalls dataset's 25 km box. OUTDIR gets
# wichitafalls-buildings.osm (the raw download, keep it: Overpass asks that
# the public server is not queried repeatedly for the same data) and
# wichitafalls-buildings.geojson. Then run compact-buildings.py on the
# GeoJSON. Both files are regenerable bulk data; the working copy is
# ~/rfreveal/data/osm (SSD), the archive copy on GeoData.
#
# The Overpass server refuses requests without a User-Agent; give yours.
set -eu
out=${1:?usage: fetch-osm-buildings.sh OUTDIR [S W N E]}
south=${2:-33.64101}; west=${3:--98.80454}; north=${4:-34.16019}; east=${5:--98.23085}
mkdir -p "$out"
bbox="$south,$west,$north,$east"
query="[out:xml][timeout:600][maxsize:536870912];(way[\"building\"]($bbox);relation[\"building\"]($bbox););(._;>;);out body;"
# The public servers refuse when busy (a 429 or 502 with a note asking for
# exponential backoff): retry with doubling waits, alternating two servers.
ua='patch-sample/0.7 (building footprints; see web-samples/rfreveal-map/README.md)'
wait=10
attempt=0
while :; do
  attempt=$((attempt + 1))
  case $((attempt % 2)) in
    1) server=https://overpass-api.de/api/interpreter ;;
    0) server=https://overpass.kumi.systems/api/interpreter ;;
  esac
  echo "attempt $attempt: fetching buildings in ($bbox) from $server ..."
  code=$(curl -sS -m 900 -A "$ua" -X POST "$server" --data-urlencode "data=$query" \
         -o "$out/wichitafalls-buildings.osm" -w '%{http_code}') || code=000
  if [ "$code" = 200 ] && grep -q '<osm' "$out/wichitafalls-buildings.osm"; then
    break
  fi
  echo "  server answered $code; retrying in ${wait}s"
  [ "$attempt" -ge 8 ] && { echo "giving up after $attempt attempts" >&2; exit 1; }
  sleep "$wait"
  wait=$((wait * 2))
done
ls -l "$out/wichitafalls-buildings.osm"
echo "converting to GeoJSON ..."
rm -f "$out/wichitafalls-buildings.geojson"
OSM_MAX_TMPFILE_SIZE=1024 ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=6 \
  -select osm_id,osm_way_id,name,building,other_tags -where "building IS NOT NULL" \
  "$out/wichitafalls-buildings.geojson" "$out/wichitafalls-buildings.osm" multipolygons
ls -l "$out/wichitafalls-buildings.geojson"
