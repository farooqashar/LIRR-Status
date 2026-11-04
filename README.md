# LIRR Live

Live Long Island Rail Road departures with track numbers: posted tracks, expected (scheduled) tracks, and track changes. Built mobile-first for checking the next train from Huntington, Penn Station or Grand Central.

Live at **https://lirr-live.vercel.app**.

## Features

- Pick any **From** and **To** station, or use the quick routes (Huntington ⇄ Penn / Grand Central). The route is saved in the URL (`?from=HUN&to=NYK`) and remembered on your device.
- Countdown and clock time for each train, refreshed every 30 seconds.
- On-time / late / held / canceled status.
- Track display:
  - **Posted**: the track is up on the board.
  - **Expected** (dashed): the scheduled track, shown before posting.
  - **Changed** (orange): posted on a different track than scheduled.
- Departures and arrivals tabs, stop lists (tap a train), and service alerts.

## How it works

| File | What it does |
|---|---|
| `api/arrivals.js` | Vercel function that fetches the MTA TrainTime backend (`backend-unified.mylirr.org/arrivals/<station>`, header `Accept-Version: 3.0`), trims it, and caches it for 15 seconds. Needed because the browser can't call that backend directly. |
| `src.html` | The whole page (HTML, CSS, JS), with a `__STATIONS__` placeholder. |
| `stations.json` | Station code → name, taken from the LIRR GTFS `stops.txt`. |
| `build.mjs` | Inlines the stations into the page and writes `public/index.html`. |

No AI and no API keys are involved. It runs on Vercel's free tier.

**Caveats:**
- The TrainTime backend is what the MTA's own TrainTime app uses. It isn't a documented public API and could change.
- "Minutes late" assumes a negative `otp` value means late, which matches observed data.

## Develop

```bash
node build.mjs          # writes public/index.html
npx vercel dev          # serves the page and /api/arrivals locally
```

Try the API directly: `/api/arrivals?station=HUN`.
