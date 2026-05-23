"""
Preprocess Metlink GTFS static data into a single JS bundle for Wellington-chan.

Reads ./metlink datasets/*.txt + ./bus_stops_with_suburbs.csv and writes
./metlink_static.js with:
  window.METLINK_STATIC = {
    routes:        { route_id: {n: short_name, l: long_name} },
    patterns:      { pattern_id: {r: route_id, d: direction, s: [[stop_id, t_sec], ...]} },
    stop_patterns: { stop_id: [pattern_id, ...] }   # only for stops we have coords for
    stops:         { stop_id: [lat, lng] }           # 3xxx-7xxx Wellington City stops
    generated:     'YYYYMMDD',
    weekday:       'monday',
  }

Filters:
  - bus routes only (route_type == 3)
  - services active on the target date (default = today)
  - one representative trip per pattern (averaging across trips would add cost
    and noise — minute-resolution travel times are stable enough)
  - stop_patterns index pruned to stops we have coordinates for (Wellington City
    only); pattern.s arrays keep the full sequence so ride-time deltas are intact
"""

import csv
import json
import sys
from collections import defaultdict
from datetime import date

GTFS = 'metlink datasets'
OUT = 'metlink_static.js'

TARGET_DATE = date(2026, 5, 25)  # Wellington-chan demo date (final submission)
WEEKDAY_KEY = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][TARGET_DATE.weekday()]
TARGET_STR = TARGET_DATE.strftime('%Y%m%d')

def parse_time(s):
    h, m, sec = s.split(':')
    return int(h) * 3600 + int(m) * 60 + int(sec)

# --- 1. Bus routes
bus_routes = {}
with open(f'{GTFS}/routes.txt', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if row['route_type'] == '3':
            bus_routes[row['route_id']] = {
                'short_name': row['route_short_name'],
                'long_name': row['route_long_name'],
            }
print(f'bus routes: {len(bus_routes)}', file=sys.stderr)

# --- 2. Active services for the target date
# Metlink encodes service days via calendar_dates.txt (exception_type=1 means
# "service runs on this date"); calendar.txt flags are all zero in this feed.
active_services = set()
with open(f'{GTFS}/calendar_dates.txt', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if row['date'] == TARGET_STR and row['exception_type'] == '1':
            active_services.add(row['service_id'])
print(f'services active on {TARGET_STR} ({WEEKDAY_KEY}): {len(active_services)}', file=sys.stderr)

# --- 3. Bus trips on active services
trips_meta = {}
with open(f'{GTFS}/trips.txt', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if row['route_id'] in bus_routes and row['service_id'] in active_services:
            trips_meta[row['trip_id']] = {
                'route_id': row['route_id'],
                'direction_id': row['direction_id'] or '0',
            }
print(f'kept trips: {len(trips_meta)}', file=sys.stderr)

# --- 4. Pattern ↔ kept trips
pattern_trips = defaultdict(list)
with open(f'{GTFS}/stop_pattern_trips.txt', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if row['trip_id'] in trips_meta:
            pattern_trips[row['stop_pattern_id']].append(row['trip_id'])
print(f'patterns with kept trips: {len(pattern_trips)}', file=sys.stderr)

# --- 5. One representative trip per pattern
sample_trips = {pid: trips[0] for pid, trips in pattern_trips.items()}
sample_trip_set = set(sample_trips.values())

# --- 6. Pull stop_times for sample trips only (single streaming pass)
trip_stop_times = defaultdict(list)
with open(f'{GTFS}/stop_times.txt', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        if row['trip_id'] in sample_trip_set:
            trip_stop_times[row['trip_id']].append((
                int(row['stop_sequence']),
                row['stop_id'],
                parse_time(row['arrival_time']),
            ))
print(f'sample trips with times: {len(trip_stop_times)}', file=sys.stderr)

# --- 7. Build pattern entries
pattern_data = {}
for pid, sample_trip in sample_trips.items():
    times = sorted(trip_stop_times.get(sample_trip, []))
    if not times:
        continue
    base = times[0][2]
    meta = trips_meta[sample_trip]
    pattern_data[pid] = {
        'r': meta['route_id'],
        'd': int(meta['direction_id']),
        's': [[s, sec - base] for (_, s, sec) in times],
    }
print(f'patterns emitted: {len(pattern_data)}', file=sys.stderr)

# --- 8. Stop coordinates (Wellington City only — bus_stops_with_suburbs.csv)
stop_coords = {}
with open('bus_stops_with_suburbs.csv', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        stop_coords[row['stop_id']] = [
            round(float(row['stop_lat']), 6),
            round(float(row['stop_lon']), 6),
        ]
print(f'stop coords loaded: {len(stop_coords)}', file=sys.stderr)

# --- 9. Stop → patterns reverse index, pruned to coord-bearing stops
stop_patterns = defaultdict(list)
covered = 0
for pid, pdata in pattern_data.items():
    for entry in pdata['s']:
        sid = entry[0]
        if sid in stop_coords:
            stop_patterns[sid].append(pid)
            covered += 1
# Only emit coords for stops that actually have bus service this day
stops_out = {sid: stop_coords[sid] for sid in stop_patterns}
print(f'stops with bus service & coords: {len(stop_patterns)}', file=sys.stderr)

# --- 10. Output
# Compact route metadata as {n: short_name, l: long_name} to save bytes
routes_compact = {rid: {'n': r['short_name'], 'l': r['long_name']} for rid, r in bus_routes.items()}
out = {
    'routes': routes_compact,
    'patterns': pattern_data,
    'stop_patterns': dict(stop_patterns),
    'stops': stops_out,
    'generated': TARGET_STR,
    'weekday': WEEKDAY_KEY,
}
with open(OUT, 'w') as f:
    f.write('window.METLINK_STATIC = ')
    json.dump(out, f, separators=(',', ':'))
    f.write(';\n')
print(f'wrote {OUT}', file=sys.stderr)
