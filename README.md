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

Set `PORT` to use a different port for `npm run dev`.

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
- `__km.aim.clear()`: empty the log.

## Deploy

GitHub Pages must use the workflow: in the repository settings, open
Pages and set Source to "GitHub Actions". After that, a push to `main`
builds and deploys the site.
