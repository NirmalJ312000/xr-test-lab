/**
 * Builds the GitHub Pages demo into docs/.
 *
 * GitHub Pages serves static files only — it cannot run Node, Express or
 * SQLite. This assembles a browser-only build of the same interface:
 *
 *   web/            -> docs/            (unchanged UI, verbatim)
 *   js/api.static.js-> docs/js/api.js   (browser data layer replaces the API client)
 *   shared/         -> docs/shared/     (identical scoring module)
 *   ingest/validate -> docs/js/demo/    (identical validation, it is isomorphic)
 *   node_modules    -> docs/vendor/     (chart.js, jsPDF, exceljs browser bundles)
 *
 * Absolute paths ('/shared/...') are rewritten relative, because Pages serves
 * the site from /<repo-name>/ rather than the domain root.
 *
 * Run:  npm run build:pages
 */
import {
  mkdirSync, rmSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync, existsSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'docs');

const VENDOR = [
  ['node_modules/chart.js/dist/chart.umd.js', 'chart.umd.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['node_modules/exceljs/dist/exceljs.min.js', 'exceljs.min.js'],
];

function copyTree(from, to, skip = () => false) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (skip(src, name)) continue;
    if (statSync(src).isDirectory()) copyTree(src, dst, skip);
    else copyFileSync(src, dst);
  }
}

/** '/shared/x.js' -> the correct number of '../' for a file at `fileDir`. */
function toRelative(code, fileDir) {
  const up = relative(fileDir, OUT).split(sep).filter(Boolean).join('/');
  const prefix = up ? `${up}/` : './';
  return code.replace(/(['"])\/shared\//g, `$1${prefix}shared/`);
}

function rewriteJs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { rewriteJs(p); continue; }
    if (!name.endsWith('.js')) continue;
    const before = readFileSync(p, 'utf8');
    const after = toRelative(before, dirname(p));
    if (after !== before) writeFileSync(p, after);
  }
}

console.log('[pages] building demo into docs/');
rmSync(OUT, { recursive: true, force: true });

// 1. the interface, verbatim (minus the vendor folder, which we re-populate)
copyTree(join(root, 'web'), OUT, (_src, name) => name === 'vendor');

// 2. the browser data layer replaces the HTTP client
copyFileSync(join(OUT, 'js', 'api.static.js'), join(OUT, 'js', 'api.js'));
rmSync(join(OUT, 'js', 'api.static.js'), { force: true });

// 3. scoring module, shared with the real app
copyTree(join(root, 'shared'), join(OUT, 'shared'));

// 4. validation, reused directly from the server (no Node-only imports in it)
mkdirSync(join(OUT, 'js', 'demo'), { recursive: true });
writeFileSync(
  join(OUT, 'js', 'demo', 'validate.js'),
  readFileSync(join(root, 'server/src/ingest/validate.js'), 'utf8')
    .replace("'../../../shared/xr-metrics/index.js'", "'../../shared/xr-metrics/index.js'"),
);

// 5. browser bundles
mkdirSync(join(OUT, 'vendor'), { recursive: true });
let vendored = 0;
for (const [from, to] of VENDOR) {
  const src = join(root, from);
  if (existsSync(src)) { copyFileSync(src, join(OUT, 'vendor', to)); vendored++; }
  else console.warn(`[pages] missing ${from} — run npm install first`);
}

// 6. absolute -> relative imports, now that the tree is in place
rewriteJs(join(OUT, 'js'));
rewriteJs(OUT);

// 7. page shell: exceljs bundle + demo banner + reset control
const indexPath = join(OUT, 'index.html');
let html = readFileSync(indexPath, 'utf8');

html = html.replace(
  '<script src="vendor/jspdf.umd.min.js"></script>',
  '<script src="vendor/jspdf.umd.min.js"></script>\n<script src="vendor/exceljs.min.js"></script>',
);

html = html.replace(
  '<div class="layout">',
  `<div class="demobar" role="note">
  <span class="demobar-tag">Demo</span>
  <span>Browser-only preview with sample data &mdash; nothing is uploaded. The real
    application runs locally with Node&nbsp;+&nbsp;SQLite.</span>
  <button type="button" class="demobar-reset" id="demoReset">Reset sample data</button>
  <a href="https://github.com/NirmalJ312000/xr-test-lab">Source</a>
</div>
<div class="layout">`,
);
writeFileSync(indexPath, html);

// 8. demo-only styling for the banner
const cssPath = join(OUT, 'styles.css');
writeFileSync(cssPath, `${readFileSync(cssPath, 'utf8')}
/* ---- GitHub Pages demo banner (build-only, not part of the local app) ---- */
.demobar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:9px 22px;font-size:12.5px;color:var(--txt-2);
  border-bottom:1px solid var(--line);background:var(--surface-2);position:relative;z-index:2}
.demobar-tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;
  font-weight:600;color:var(--accent-bright);border:1px solid var(--accent-line);
  background:var(--accent-soft);border-radius:5px;padding:3px 9px}
.demobar a{margin-left:auto}
.demobar-reset{background:transparent;border:1px solid var(--line);color:var(--txt-2);
  border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit}
.demobar-reset:hover{border-color:var(--accent-line);color:var(--txt)}
@media (max-width:860px){.demobar{padding:8px 14px}.demobar a{margin-left:0}}
`);

// 9. wire the demo-only behaviour (exports + reset) into the entry module
const appPath = join(OUT, 'app.js');
writeFileSync(appPath, `${readFileSync(appPath, 'utf8')}
/* ---- demo build only: client-side exports and sample-data reset ---- */
import { wireExports } from './js/demo/exports.js';
import { toast as demoToast } from './js/ui.js';
import { api as demoApi } from './js/api.js';
wireExports(demoToast);
document.getElementById('demoReset')?.addEventListener('click', () => {
  demoApi.__resetDemo();
  location.hash = '#/';
  location.reload();
});
`);

// 10. Pages must not run the content through Jekyll (it would drop js/ dirs)
writeFileSync(join(OUT, '.nojekyll'), '');

const count = (d) => readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
console.log(`[pages] done — ${count(OUT)} files, ${vendored}/${VENDOR.length} vendor bundles`);
console.log('[pages] enable Pages on the repo:  Settings -> Pages -> Deploy from a branch -> main / docs');
