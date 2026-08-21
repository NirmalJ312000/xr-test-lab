/**
 * XR Test Lab — dashboard entry point.
 *
 * The local SQLite database behind the API is the source of truth. localStorage
 * is read exactly once, to offer a migration of data left by the pre-1.0
 * dashboard.
 */
import api from './js/api.js';
import { toast, openModal, closeModal, esc, int } from './js/ui.js';
import { destroyAllCharts } from './js/charts.js';
import { errorState } from './js/states.js';
import { renderHome } from './js/pages/home.js';
import { renderProjects } from './js/pages/projects.js';
import { renderProject } from './js/pages/project.js';
import { renderStudents, renderStudent } from './js/pages/students.js';
import { renderSessions } from './js/pages/sessions.js';
import { renderSession } from './js/pages/session.js';
import { renderBugs } from './js/pages/bugs.js';
import { renderImport } from './js/pages/import.js';
import { renderData } from './js/pages/data.js';
import { icons } from './js/icons.js';
import { pageEnter, revealStagger, countUp, drawRings, reducedMotion } from './js/motion.js';
import { initField } from './js/field.js';

const LEGACY_KEY = 'xrtestlab.v1';
const main = () => document.getElementById('main');

/* -------------------------------------------------------------- routing -- */

const ROUTES = [
  [/^#?\/?$/, 'dashboard', 'Dashboard', () => renderHome(main())],
  [/^#\/projects$/, 'projects', 'Applications', () => renderProjects(main())],
  [/^#\/projects\/([^/]+)$/, 'projects', 'Application', (m) => renderProject(main(), m[1])],
  [/^#\/students$/, 'students', 'Students', () => renderStudents(main())],
  [/^#\/students\/([^/]+)$/, 'students', 'Student', (m) => renderStudent(main(), m[1])],
  [/^#\/sessions$/, 'sessions', 'Test Sessions', () => renderSessions(main())],
  [/^#\/sessions\/([^/]+)$/, 'sessions', 'Performance Report', (m) => renderSession(main(), m[1])],
  [/^#\/bugs$/, 'bugs', 'Defects', () => renderBugs(main())],
  [/^#\/import$/, 'import', 'Import Report', () => renderImport(main())],
  [/^#\/data$/, 'data', 'Data Management', () => renderData(main())],
];

let currentToken = 0;

async function route() {
  const hash = location.hash || '#/';
  closeModal();
  destroyAllCharts();

  const match = ROUTES.find(([re]) => re.test(hash));
  if (!match) {
    location.hash = '#/';
    return;
  }

  const [re, navKey, title, handler] = match;
  document.title = `${title} · XR Test Lab`;
  syncNav(navKey);

  // Guards against a slow request from a previous route painting over a newer one.
  const token = ++currentToken;
  try {
    await handler(hash.match(re));
  } catch (err) {
    if (token !== currentToken) return;
    console.error('[route]', hash, err);
    main().innerHTML = errorState(err);
  }
  if (token !== currentToken) return;

  // Entrance choreography, applied once the view has painted. Routes that open
  // a single object get the "focus acquisition" settle instead of a plain fade.
  const el = main();
  const isDetail = /^#\/(projects|students|sessions)\/[^/]+$/.test(hash);
  pageEnter(el, isDetail);
  revealStagger(el);
  countUp(el);
  drawRings(el);
  window.scrollTo(0, 0);
}

function syncNav(key) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    if (el.dataset.nav === key) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

/* -------------------------------------------- one-time legacy migration -- */

function legacyProjects() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.projects?.length ? parsed.projects : null;
  } catch {
    return null;
  }
}

async function offerLegacyMigration() {
  const projects = legacyProjects();
  if (!projects) return;

  const status = await api.migrateStatus().catch(() => null);
  if (status?.alreadyMigrated) return;

  const sessions = projects.reduce((n, p) => n + (p.sessions?.length ?? 0), 0);
  openModal({
    title: 'Import Your Previous Browser Data?',
    body: `
      <p class="danger-intro">This browser still holds data from the older localStorage version of XR Test Lab:</p>
      <ul class="danger-list">
        <li><span>Applications</span><b>${int(projects.length)}</b></li>
        <li><span>Test sessions</span><b>${int(sessions)}</b></li>
      </ul>
      <p class="muted" style="font-size:12.5px;margin-top:14px">
        Importing copies it into the local database, where it is stored permanently.
        Your browser data is left untouched, so nothing is lost either way.
      </p>`,
    footer: `<button type="button" class="btn ghost" data-close>Not Now</button>
             <button type="button" class="btn primary" data-migrate>Import Into Database</button>`,
    onMount(root, close) {
      const btn = root.querySelector('[data-migrate]');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Importing…';
        try {
          const m = (await api.migrateLocalStorage(projects)).migrated;
          toast(`Imported ${m.projects} application(s), ${m.students} student(s), ${m.sessions} session(s)`, 'success');
          close();
          route();
        } catch (err) {
          toast(err.userMessage ?? err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Retry Import';
        }
      });
    },
  });
}

/* ----------------------------------------------------------------- boot -- */

// The drifting particle layer was replaced by The Field — see js/field.js.

document.getElementById('overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
window.addEventListener('hashchange', route);

(async function boot() {
  document.getElementById('brandMark').innerHTML = icons.reticle(26);
  initField(document.getElementById('field'));
  await route();
  try {
    await offerLegacyMigration();
  } catch (err) {
    console.warn('[migrate] legacy check failed', err);
  }
})();
