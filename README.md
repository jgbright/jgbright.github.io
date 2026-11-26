# jgbright.github.io

The source of a personal site, served at jgbright.com by GitHub Pages.

The site has a build step. esbuild builds everything into `dist/`, and a
GitHub Actions workflow deploys `dist/` on each push to `main`. Git ignores
`dist/`.

## Commands

You need Node.js 22 or later.

```
npm ci          # install three.js and esbuild (pinned in package-lock.json)
npm run build   # build the site into dist/
npm run dev     # build, serve dist/ at http://127.0.0.1:8377/ and rebuild on change
```

Set `PORT` to use a different port for `npm run dev`. Set `HOST=0.0.0.0` to
serve it on the local network too.

## What is here

- `index.html`, `CNAME`: the home page. The build copies them as they are.
- `kindlemoot/`: Kindlemoot, a holiday hero shooter that runs in the browser.
  - `index.html`, `css/`: the game page. A small script checks for a phone
    first, and loads the game bundle only on a desktop.
  - `js/`: the game source. The build makes one minified bundle from it,
    `dist/kindlemoot/js/main.js`, with three.js inside and a source map.
  - `js/data/heroes.js`: every hero, weapon and match number. Change balance here.
  - `js/sim/`: the match simulation. It has no browser code.
  - `tools/`: tools for development. They are not part of the built site.
- `build.mjs`: the build script.
- `.github/workflows/pages.yml`: the build and deploy workflow.

## Tools that need no build

The simulation runs in plain Node.js, so these work on the source directly:

```
node kindlemoot/tools/smoke.mjs 6     # six fast bot matches; fails on errors
node kindlemoot/tools/balance.mjs     # about 1,250 bot matches on all CPU cores; prints win rates
node kindlemoot/tools/telemetry-test.mjs  # the telemetry tests (npm test)
node kindlemoot/tools/telemetry.mjs <file.ndjson>  # a summary of a telemetry export
```

`balance.mjs` has options for the number of matches, one test suite and the
bot skill. Its first lines list them. Use it after each change to
`js/data/heroes.js`.

`npm run dev` also serves a model preview page at
`/kindlemoot/tools/models.html`.

## Test switches for the game page

Add these to the address of the game page, for example
`/kindlemoot/?auto&speed=8`. They are for tests; settings do not save them.

- `?auto`: a bot plays your slot, and you watch. No pointer lock is needed.
- `?speed=8`: the match runs 8 times faster (0.1 to 16).
- `?nolock`: play without pointer lock. Drag with the left button to look.
- `?quality=low`, `medium` or `high`: force a graphics level.
- `?retest`: run the automatic graphics test again.
- `?seed=123`: use a fixed random seed for the match.
- `?phone`: show the phone message on a desktop.
- `?debug`: turn on shader checks in the console.
- `?aimlog`: print aim events to the console as they happen (clamps,
  dropped mouse jumps, view resets and pointer-lock changes).
- `?otel`: also send the telemetry to the OpenTelemetry collector on this
  machine (see below). It works only when the page runs on `127.0.0.1`,
  `localhost` or `[::1]`. On any other host, such as jgbright.com, the page
  sends nothing, even with `?otel`.

The page also puts a `__km` object on `window` for browser tests. For
example, `__km.bench(40, 1920, 1080)` gives the cost of one frame in
milliseconds.

### Aim telemetry

The game always keeps a log of the last 4,096 aim events in memory. Each
mouse move gives one row: the raw `movementX` and `movementY`, the
sensitivity, the radians for each mouse count, the pitch before and after
the move, and flags. A view reset and a pointer-lock change also give a row.
The flags are `clampUp` and `clampDown` (the pitch hit its limit), `spike`
(the game dropped one sudden mouse jump), `notFinite`, `zoom`, `invertY`,
`locked`, `raw` (the lock asked for raw input) and `drag` (a `?nolock` drag).

If the aim goes wrong, open the browser console and run these:

- `__km.aim.summary()`: counts, the largest deltas and the lock mode (`lockMode`).
- `copy(__km.aim.text())`: copy the whole log as tab-separated text.
- `__km.aim.dump(50)`: the last 50 rows as objects.
- `__km.aim.clear()`: empty the log. The stored telemetry keeps its rows.

### Stored telemetry

The game keeps its telemetry across page loads, in the browser's IndexedDB.
This runs on every page, on jgbright.com too, and nothing leaves the
browser. The code is in `kindlemoot/js/telemetry.js` and
`kindlemoot/js/telemetry-format.js`.

The telemetry is a set of named streams. Each stream has a list of columns.
There are two streams now:

- `aim`: every row of the aim log above.
- `match`: the start, the end and the leave of each match, with a random
  match id, the hero, the seed, the team mix and the bot skill.

Every 5 seconds, on pause, at the end of a match and when the page closes,
the game moves the new rows to the store in batches. The mouse handler only
writes to the in-memory log. If the browser blocks IndexedDB, for example in
a private window, the rows stay in memory for this page load only.

The store keeps the last 40 page loads and at most 250,000 rows, and drops
the oldest first. Each page load gets a random session id. A session records
the build (the commit), the browser's user agent, `devicePixelRatio`,
`public` or `local` for the host, and the test switches. It records no name,
address or account. Every stored record has a schema version, `v`.

In the browser console:

- `await __km.telemetry.summary()`: a summary of each stored session.
- `await __km.telemetry.export()`: download every stored session as one
  NDJSON file, `kindlemoot-telemetry-<date>-<time>.ndjson` (the time is UTC).
- `__km.telemetry.status()`: this session's id, the store, and the
  OpenTelemetry export state.
- `await __km.telemetry.clear()`: delete every stored session.

To read an export without a browser:

```
node kindlemoot/tools/telemetry.mjs kindlemoot-telemetry-20261126-0436.ndjson
```

It prints each session: the build, the browser, the rows of each stream, and
for the aim stream the counts of moves, clamps, spikes, resets and lock
errors, the largest deltas and the lock mode. `--largest 10` lists more
moves, `--rows aim` prints every aim row as tab-separated text, `--session
<id>` keeps one session, and `--json` prints the summary as JSON.

To add a stream, add one call in `kindlemoot/js/main.js`:
`tel.events(name, columns)` for a slow stream (it returns an object with
`add(row)`), or `tel.source(name, columns, drain)` for a fast stream that
keeps its own ring buffer, like `AimLog.drain`.

### OpenTelemetry export

With `?otel` on a local host, the game also posts each batch to the
OpenTelemetry collector on this machine, at `http://127.0.0.1:4318/v1/logs`,
as OTLP/JSON log records. Each row is one log record. The resource has
`service.name` `kindlemoot` and `service.version` (the build). Each record
has the attributes `km.stream`, `km.session`, `km.row` and `km.schema`, and
one attribute for each column, named `<stream>.<column>`, such as `aim.dy`.
A clamp, a dropped spike or a lock error has the severity `WARN`.

The collector sends logs to Loki. The collector must allow the dev page's
origin (CORS). Its config at `C:\otel\otelcol\config.yaml` has this under
`receivers.otlp.protocols.http`:

```yaml
cors:
  allowed_origins: ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
```

To see the rows, run `npm run dev`, open
`http://127.0.0.1:8377/kindlemoot/?otel`, and query Loki in Grafana
(Explore, the Loki data source):

```
{service_name="kindlemoot"} | km_stream="aim"
{service_name="kindlemoot"} | km_stream="aim" | severity_text="WARN"
{service_name="kindlemoot"} | km_session="<id from __km.telemetry.status()>"
sum by (km_stream) (count_over_time({service_name="kindlemoot"}[15m]))
```

Loki makes only `service_name` a label. The other attributes are structured
metadata, with `_` in place of `.`: `km_stream`, `km_session`, `aim_dy`,
`aim_flags`, `service_version` and so on. A failed send is counted in
`__km.telemetry.status().sent`, and the rows stay in the local store.

## Deploy

GitHub Pages must use the workflow: in the repository settings, open
Pages and set Source to "GitHub Actions". After that, a push to `main`
builds and deploys the site.
