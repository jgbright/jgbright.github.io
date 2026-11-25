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
node kindlemoot/tools/smoke.mjs 6   # six fast bot matches; fails on errors
```

`npm run dev` also serves a model preview page at
`/kindlemoot/tools/models.html`.

## Deploy

GitHub Pages must use the workflow: in the repository settings, open
Pages and set Source to "GitHub Actions". After that, a push to `main`
builds and deploys the site.
