// Builds the whole site into dist/. esbuild is the only build tool.
//
//   node build.mjs            build once (npm run build)
//   node build.mjs --serve    build, serve dist/ and rebuild on change (npm run dev)
//
// What goes into dist/:
//   index.html, CNAME               the home page, copied as they are
//   kindlemoot/index.html, css/     the game page, copied
//   kindlemoot/js/main.js (+ .map)  the game and three.js in one minified bundle
// The dev command also builds the model preview page (kindlemoot/tools/models.html).
// The headless tools in kindlemoot/tools/*.mjs do not need a build.

import * as esbuild from 'esbuild';
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { watch, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');
const port = +(process.env.PORT || 8377);
const at = (...p) => path.join(root, ...p);
const out = (...p) => path.join(dist, ...p);

// Copy the files that need no build. The game page gets a version stamp on its
// script address, so a browser never runs an old bundle with a new page.
async function copyStatic() {
  await mkdir(out('kindlemoot'), { recursive: true });
  await cp(at('index.html'), out('index.html'));
  await cp(at('CNAME'), out('CNAME'));
  await cp(at('kindlemoot', 'css'), out('kindlemoot', 'css'), { recursive: true });
  let stamp = 'dev';
  try { stamp = createHash('sha256').update(await readFile(out('kindlemoot', 'js', 'main.js'))).digest('hex').slice(0, 10); } catch { /* first run */ }
  const page = await readFile(at('kindlemoot', 'index.html'), 'utf8');
  const marker = "import('./js/main.js')";
  if (!page.includes(marker)) throw new Error(`kindlemoot/index.html must load the game with ${marker}`);
  await writeFile(out('kindlemoot', 'index.html'), page.replace(marker, `import('./js/main.js?v=${stamp}')`));
  if (serve) {
    await mkdir(out('kindlemoot', 'tools'), { recursive: true });
    await cp(at('kindlemoot', 'tools', 'models.html'), out('kindlemoot', 'tools', 'models.html'));
  }
}

function report(meta) {
  for (const [file, info] of Object.entries(meta.outputs)) {
    if (!file.endsWith('.js')) continue;
    const gz = gzipSync(readFileSync(at(file))).length;
    console.log(`  ${file}  ${(info.bytes / 1024).toFixed(0)} kB, ${(gz / 1024).toFixed(0)} kB gzip`);
  }
}

const entryPoints = { 'kindlemoot/js/main': at('kindlemoot', 'js', 'main.js') };
if (serve) entryPoints['kindlemoot/tools/models'] = at('kindlemoot', 'tools', 'models.js');

const options = {
  absWorkingDir: root,
  entryPoints,
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  metafile: true,
  logLevel: 'warning',
  plugins: [{
    name: 'site-files',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        await copyStatic();
        console.log(`built ${new Date().toLocaleTimeString()}`);
        report(result.metafile);
      });
    },
  }],
};

await rm(dist, { recursive: true, force: true });

if (!serve) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const server = await ctx.serve({ servedir: dist, host: '127.0.0.1', port });
  console.log(`serving dist/ at http://127.0.0.1:${server.port}/  (game: /kindlemoot/)`);
  // esbuild watches the JavaScript. These watchers cover the copied files.
  let timer = null;
  const again = () => { clearTimeout(timer); timer = setTimeout(() => copyStatic().then(() => console.log('copied page files'), (e) => console.error(e.message)), 80); };
  for (const p of [at('index.html'), at('kindlemoot', 'index.html'), at('kindlemoot', 'css'), at('kindlemoot', 'tools', 'models.html')]) watch(p, { recursive: false }, again);
}
