# Wellington-chan — Optimisation Surface (v1)

> A single scoring function that collapses live Wellington civic conditions
> into one of six reactions. This document is the canonical spec; the design
> journal's "optimisation surface" section is derived from it.

---

## What Wellington-chan answers

She returns a **comfort verdict on a single axis** — never a fact.

- **Decision questions** → yes / no / maybe
- **Evaluation questions** → good / bad / okay

If a question wants a *number, time, or name* as its answer ("when does the sun
set?", "what's the temperature?", "when's the next bus?"), she returns
**Confused**. The refusal is part of the design.

---

## Pipeline

```
user input
   ↓
[1] Intent classification (Claude)        → profile + entities (place, deadline, date)
   ↓
[2] Geographic gate                       → early exit if out of region
   ↓
[3] Data fetch (parallel)                 → Open-Meteo, Sunrise-Sunset, Metlink
   ↓
[4] Component computation                 → 4 components, [0..1]
   ↓
[5] Profile scoring                       → weighted sum (dual-path for Commuter)
   ↓
[6] Soft cap                              → bound failed-deadline scores
   ↓
[7] Reaction selection                    → animation state
```

---

## [1] Intent classification

Claude maps the input to one profile + extracts entities.

| Profile | Triggers | Entities required |
|---|---|---|
| **Commuter** | "Can I make it to X in N?", "Will I get to X on time?" | place, deadline (default 15 min if "soon") |
| **Wayfinder** | "Can I catch a bus to X soon?", "Are there delays on the 2?" | place or route |
| **Pedestrian** | "Can I walk to X?", "Can I walk to X by N?" | place, optional deadline |
| **Outdoors** | "Is it nice out?", "What's the weather like (in X)?", "Should I go outside?", "Will I have enough daylight?" | optional place (defaults to user) |
| **Holistic** | "Should I go to X?" *(no deadline)* | place |
| **Confused** | factual lookups, non-Metlink modes (Uber/scooter/drive), non-civic asks, self-referential, out of NZ | — |

**Forecast queries.** Any of the above with a future date ("tomorrow", "Saturday", "next weekend") inherits its profile but uses forecast weather and forecast sunrise/sunset. Forecast horizon: ≤ 7 days. Beyond 7 days → Confused.

**Destination-less rule.** "Should I go outside?" / "Is it nice?" → **Outdoors**, not
Holistic. Holistic requires a destination.

---

## [2] Geographic gate

Run *before* any API calls. Saves latency on out-of-scope queries.

```
1. Resolve destination (if profile needs one):
     - check landmark dict   (~25 entries, e.g. Te Papa, VUW Kelburn, the airport)
     - check suburb list     (Wellington suburbs, normalised aliases)
     - else Open-Meteo geocoding with country=NZ bias
2. Coords check:
     - inside Wellington bbox  (lat -41.45 .. -41.10, lng 174.6 .. 175.0)
         → continue to data fetch
     - inside NZ but outside Wellington bbox
         → continue (will score → Distressed naturally via journey_feasibility = 0)
     - outside NZ or unresolvable
         → return Confused immediately (no API calls)
```

User location uses browser Geolocation. **Permission denied → "Wellington-chan
is down" idle for any query needing user-origin.** No fallback prompt.

---

## [3] Data fetch

All requests fire in parallel. **Any required source failing → idle / down.**

| Source | Endpoint | When |
|---|---|---|
| Open-Meteo Forecast | `/v1/forecast?latitude=&longitude=&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code,is_day` | Any query needing weather |
| Open-Meteo Geocoding | `/v1/search?name=&country=NZ` | Place-name resolution if not in landmark/suburb dict |
| Sunrise-Sunset | `/json?lat=&lng=&date=&formatted=0` | Any query needing daylight |
| Metlink stop-predictions | `/v1/stop-predictions?stop_id=X` | Commuter, Wayfinder |
| Metlink GTFS-RT alerts | `/v1/gtfs-rt/servicealerts` | Commuter, Wayfinder (transit_confidence) |
| Stops + route→suburbs | local (bundled JSON) | Commuter, Wayfinder, Pedestrian |

**Auth header:** `x-api-key` (Metlink). CORS verified open on all endpoints.

**Caching TTLs:** weather 5 min · sunrise/sunset 24 h · stop-predictions 30 s ·
service-alerts 60 s.

---

## [4] Components (three)

Each returns `[0, 1]` after clamping. 1 = good. Daylight was removed from v1
because the cold-at-night signal is already captured by `weather_comfort`'s
temperature term — daylight as its own component double-counted "night is
bad" *and* artificially propped up daytime scores.

### `journey_feasibility`
Used when the query has a destination.

```
walk_path_minutes = haversine(origin, dest) × 1.3 / 5 × 60     (∞ if > 5 km)

bus_path_minutes  = walk_to_stop + wait + ride + walk_from_stop
  where the chosen stop is the one minimising bus_path_minutes
  among stops near origin whose routes serve dest_suburb.
  If no such stop exists, bus_path_minutes = ∞.

earliest_arrival  = min(walk_path_minutes, bus_path_minutes)
journey_raw       = (deadline_min − earliest_arrival) / deadline_min
                    (= -∞ when no path exists)

journey_feasibility =
    1.0           if journey_raw ≥ 0.5     (≥ 50% buffer → comfortable)
    2 × raw       if 0 ≤ journey_raw < 0.5 (linear ramp)
    0             if journey_raw < 0       (missed deadline)
```

The piecewise curve replaces an earlier linear formula
`clamp((deadline − arrival) / deadline, 0, 1)`. The linear version could only
return 1.0 for arrival = 0 (teleportation), which meant any real journey —
even one with a generous buffer — dragged the score into the Uneasy band when
combined with moderate weather. The piecewise curve rewards "plenty of time"
as 1.0 and only starts penalising once the buffer drops below 50% of the
deadline. The *raw* value is preserved so the soft cap still distinguishes
"tight" (raw < 0.1) from "impossible" (raw < 0).

Default deadline (when none stated) = `1.5 × earliest_arrival` — buffer = 1/3
of deadline → `journey_feasibility = 0.67`, a neutral contributor that
intentionally lets the other components carry the score.

### `weather_comfort`
Always available. The temperature input is **apparent_temperature** ("feels
like") from Open-Meteo, not raw temperature — wind-chill is captured directly
rather than approximated. Curve is calibrated for Wellington winter: a 15°C
dry calm day reads as perfect, not Content.

```
temp_n   =  0                          if feels < 5
            (feels − 5) / 10           if 5 ≤ feels < 15   (5→0, 15→1.0)
            1                          if 15 ≤ feels ≤ 25  (PEAK widened)
            (30 − feels) / 5           if 25 < feels ≤ 30
            0                          if feels > 30

precip_n = clamp((5 − precip_mmhr) / 5)

wind_n   =  1                          if wind ≤ 15
            clamp((60 − wind_kph) / 45) if wind > 15        (kill at 60 km/h)

sun_n    = clamp((100 − cloud_cover_pct) / 100)             (NEW component)

weather_comfort = 0.50·temp_n + 0.30·precip_n + 0.10·wind_n + 0.10·sun_n
```

**Why these weights.** Temperature is the dominant winter comfort signal so it
takes 50%. Rain is still weighty at 30% — a warm-but-pouring day must not read
as comfortable. Wind drops to 10% because *apparent_temperature* already
captures wind-chill thermally; `wind_n` only catches the mechanical
unpleasantness (umbrellas inverting, hair, hard-to-stand). Cloud cover gets
10% because NZ sun-exposure is a real comfort factor — a 12°C sunny day feels
warmer than a 12°C overcast one.

### `transit_confidence`
Used when the bus path is active.

```
severity_weight(alert) =
    1.0  if effect = NO_SERVICE
    0.6  if effect = SIGNIFICANT_DELAYS or DETOUR
    0.3  if effect = REDUCED_SERVICE or STOP_MOVED
    0.1  otherwise

penalty = sum(severity_weight) over alerts on routes used by chosen path
transit_confidence = clamp(1 − penalty, 0, 1)
```

Walk-only paths exclude this component.

---

## [5] Profile scoring

Weights for each profile. `—` means the component is excluded; remaining
weights sum to 1.

| Profile | journey | weather | transit_conf |
|---|---|---|---|
| Commuter–Bus | 0.45 | 0.30 | 0.25 |
| Commuter–Walk | 0.30 | 0.70 | — |
| Wayfinder | 0.10 | 0.50 | 0.40 |
| Pedestrian | 0.30 | 0.70 | — |
| Outdoors | — | 1.00 | — |
| Holistic | 0.10 | 0.70 | 0.20 |

```
score = Σ weight_i × component_i
```

**Commuter dual-path.** For Commuter queries, both `score_bus_path` and
`score_walk_path` are computed; Wellington-chan reacts to `max(...)` — she
silently picks the better mode.

---

## [6] Soft cap (two-tier)

The cap uses the *raw* journey value (pre-clamp) so we can distinguish
"arriving exactly on time" from "physically impossible".

```
journey_raw = (deadline_min − earliest_arrival) / deadline_min
            = -∞ when no path exists (e.g. walk > 5 km cap)
            < 0  when arrival is after the deadline
```

Caps applied per path (per profile, in Commuter's dual-path case):

```
if profile != Outdoors:
    if journey_raw < 0:    score = min(score, 0.25)   # impossible → Distressed max
    elif journey_raw < 0.1: score = min(score, 0.40)  # tight       → Shiver max
    # else no cap
```

This prevents two pathologies:

1. *"You'll miss your deadline but the weather's lovely → Content"* — the 0.40
   cap stops nice atmospheric conditions from rescuing a slightly-too-tight
   plan.
2. *"Walking 8 km from Hataitai to Johnsonville on a sunny day → Shiver"* — the
   0.25 cap forces clearly-impossible plans to read as Distressed regardless of
   how nice the day is.

Outdoors is exempt (no journey component).

---

## [7] Reaction selection

```
score ≥ 0.85  →  Happy
0.70 – 0.85   →  Content
0.50 – 0.70   →  Uneasy
0.30 – 0.50   →  Shiver
< 0.30        →  Distressed
```

Plus the non-scored states:

```
intent = Confused   →  Confused
geo gate fail (NZ)  →  Distressed (via journey_feasibility = 0)
geo gate fail (intl)→  Confused
required API down   →  "Wellington-chan is down" idle
geolocation denied  →  "Wellington-chan is down" idle (for queries needing origin)
```

### Output: body language only

Wellington-chan does not speak, does not display text, does not return numbers.
The user's only feedback is which reaction sprite plays. The interface is
intentionally near-zero-affordance: a sprite, an input line, nothing else.

This is a stronger value-capture stance than a speech bubble: the user is given
a *feeling* in lieu of any data, and must accept that reading at face value.

---

## Acknowledged limitations *(material for the design journal)*

These are deliberately not-fixed and become the journal's "what does the
optimisation surface conceal?" content.

1. **Bus rides are weather-neutral.** The formula treats every bus ride as
   weather-protected, hiding the rain-soaked walks to and from stops, and the
   wait at the stop, that define a real Wellington commute.
2. **Symmetric temperature curve.** <0°C and >30°C are scored as equally bad.
   Wellington never reaches 30°C. The curve is shaped for a city that doesn't
   exist.
3. **Walking detour factor is constant (1.3×).** Aro Valley to Kelburn and
   Lambton Quay to Featherston Street get the same multiplier. Wellington's
   topography is silently flattened.
4. **Civic mobility = bus + walk.** No Uber, scooter, drive, train, ferry. By
   measuring only Metlink + walking, the dashboard claims that *those* are
   what counts as Wellington mobility.
5. **Verdict-only output.** The user is denied raw data. They cannot see the
   numbers behind the emotion — they must accept Wellington-chan's compressed
   judgment. (This is the value-capture critique, made operational.)

---

## Worked example

See [worked_example.md](./worked_example.md) — "Can I make it to Kelburn in 20
minutes?" traced through every stage.

---

## Alternative weighting (tabled)

The journal also presents one alternative weighting set (e.g. **Tourist mode**:
journey 0.05 / weather 0.45 / transit 0.10 / daylight 0.40) to demonstrate
what changes when the surface is reweighted. Outfit-swap UI for switching
weightings in real time is a stretch goal post-pitch.
