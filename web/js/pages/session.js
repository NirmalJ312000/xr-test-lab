import api from '../api.js';
import {
  esc, r1, r2, int, fmtDate, gradeBadge, platformPill, toast, confirmDanger, openModal,
  CHECK_DISPLAY,
} from '../ui.js';
import { scoreRingHTML, drawRings, countUp } from '../motion.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { drawFpsChart, drawFrameTimeChart, drawMemoryChart, destroyAllCharts } from '../charts.js';
import { openBugForm, bugListHTML, wireBugList } from './bugs.js';
import {
  judgeFps, judgeDropped, judgeMemory, judgeFrameMs, isInvalidCapture,
  computeGrade, GRADE_CONFIG,
} from '/shared/xr-metrics/index.js';

const CHECK_STATE = { pass: 'Pass', warn: 'Warn', fail: 'Fail' };
/** Marks a checklist result is worth, shown next to each item. */
const checkMarks = (v) => GRADE_CONFIG.checklist[v] ?? 0;

export async function renderSession(main, id) {
  destroyAllCharts();
  main.innerHTML = loadingState({ cards: 4, rows: 6, label: 'Loading performance report' });

  let s;
  try {
    s = (await api.session(id)).session;
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderSession(main, id));
    return;
  }

  const invalid = isInvalidCapture(s);
  const dropPct = s.totalFrames ? (s.droppedFrames / s.totalFrames) * 100 : null;
  const assessed = Object.keys(s.checklist).length;
  // Recomputed client-side from the same shared module the server uses, so the
  // verdict, grade and breakdown shown here are always internally consistent.
  const g = computeGrade(s, { checklist: s.checklist });
  const v = invalid
    ? { key: 'invalid', label: 'INVALID CAPTURE' }
    : { key: g.status, label: { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[g.status] };

  main.innerHTML = `
    <nav class="crumb" aria-label="Breadcrumb">
      <a href="#/projects/${s.projectId}">${esc(s.projectName)}</a>
      <span class="muted"> / </span>
      <a href="#/students/${s.studentRowId}">${esc(s.studentName)}</a>
    </nav>

    <div class="page-head">
      <div>
        <div class="eyebrow">Test Session</div>
        <h1>${esc(s.projectName)}</h1>
        <div class="meta">
          <span>Student <b>${esc(s.studentName)}</b></span>
          <span>${platformPill(s.platform)}</span>
          <span>Device <b>${esc(s.device ?? '—')}</b></span>
          <span>Captured <b>${fmtDate(s.capturedAt)}</b></span>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn" id="btnPdf">Download PDF Report</button>
        <a class="btn" href="${api.rawUrl(id, true)}" download>Download JSON</a>
        <button type="button" class="btn" id="btnRaw">View Raw</button>
        <button type="button" class="btn danger" id="btnDel">Delete Report</button>
      </div>
    </div>

    <div class="verdict ${v.key}">
      <div class="v-main">
        ${g ? scoreRingHTML(g.score, g.status, { label: '/ 100' }) : ''}
        <div class="focus-frame">
          <span class="v-label">Overall Result</span>
          <span class="v-status">${v.label}</span>
        </div>
        ${g ? gradeBadge(g.grade, g.score, 'lg') : ''}
      </div>
      <div class="v-sep" aria-hidden="true"></div>
      <div class="v-note" id="scoreNote">
        ${
          invalid
            ? 'The profiler ran but recorded no frames, so this session carries no performance evidence. Score and grade are <b>N/A</b> — this is not a student failure. Check the Unity console for <code>[XRTestProfiler] Session STARTED</code> and re-run the capture.'
            : scoreNoteHTML(g, s.targetFps)
        }
      </div>
    </div>

    ${invalid ? '' : metricsHTML(s, dropPct)}

    <section class="section" aria-labelledby="dev-h">
      <h3 id="dev-h">Device &amp; Capture</h3>
      <div class="infostrip">
        <span>Device <b>${esc(s.device ?? '—')}</b></span>
        <span>GPU <b>${esc(s.gpu ?? '—')}</b></span>
        <span>OS <b>${esc(s.os ?? '—')}</b></span>
        <span>Platform <b>${esc(s.platform)}</b></span>
        <span>Target FPS <b>${s.targetFps} Hz</b></span>
        <span>Duration <b>${r1(s.durationSec)}s</b></span>
        <span>Imported <b>${fmtDate(s.importedAt)}</b></span>
      </div>
    </section>

    ${invalid ? '' : chartsHTML(s)}

    <section class="section" aria-labelledby="chk-h">
      <h3 id="chk-h">XR Checklist
        <span class="hint">${checklistHint(assessed, s.checklistItems.length, g)}</span></h3>
      ${s.checklistItems.map((c, i) => checkRow(c, s.checklist[c.id], i)).join('')}
    </section>

    <section class="section" aria-labelledby="bug-h">
      <h3 id="bug-h">Defects <span class="hint">${s.bugs.length} on this application</span>
        <span class="h3-actions"><button type="button" class="btn sm" id="btnAddBug">Log Defect</button></span></h3>
      <div id="bugWrap">${s.bugs.length ? bugListHTML(s.bugs, { highlightSession: id }) : emptyState(EMPTY.bugs)}</div>
    </section>`;

  if (!invalid) {
    if (s.series.length) {
      drawFpsChart(s.series, s.targetFps);
      drawFrameTimeChart(s.series, s.targetFps);
      drawMemoryChart(s.series);
    }
  }

  const reload = () => renderSession(main, id);

  main.querySelectorAll('[data-check]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.check;
      const val = btn.dataset.val;
      const next = s.checklist[itemId] === val ? null : val;
      btn.disabled = true;
      try {
        const res = await api.setCheck(id, itemId, next);
        // Update in place rather than reloading the whole report.
        s.checklist = res.checklist;
        refreshChecklist(main, s, res.derived?.grade);
        refreshGrade(main, res.derived, s.targetFps);
      } catch (err) {
        toast(err.userMessage ?? err.message, 'error');
        btn.disabled = false;
      }
    }),
  );

  main.querySelector('#btnPdf').addEventListener('click', async () => {
    const btn = main.querySelector('#btnPdf');
    btn.disabled = true;
    btn.textContent = 'Building PDF…';
    try {
      const { downloadSessionPdf } = await import('../pdf.js');
      // Recomputed from the same shared module, so the PDF can never disagree
      // with what is on screen.
      downloadSessionPdf(s, computeGrade(s, { checklist: s.checklist }));
      toast('PDF report downloaded', 'success');
    } catch (err) {
      console.error('[pdf]', err);
      toast('Could not build the PDF report.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download PDF Report';
    }
  });

  main.querySelector('#btnRaw').addEventListener('click', async () => {
    try {
      const text = await (await fetch(api.rawUrl(id))).text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch { /* show as-is */ }
      openModal({
        title: `Original Report — ${s.originalFilename ?? 'report.json'}`,
        wide: true,
        body: `<pre class="rawjson" tabindex="0">${esc(pretty)}</pre>`,
        footer: `<a class="btn" href="${api.rawUrl(id, true)}" download>Download</a>
                 <button type="button" class="btn ghost" data-close>Close</button>`,
      });
    } catch (err) {
      toast('Could not load the original report.', 'error');
      console.error(err);
    }
  });

  main.querySelector('#btnAddBug').addEventListener('click', () =>
    openBugForm(
      { projectId: s.projectId, sessionId: id, students: [{ id: s.studentRowId, studentName: s.studentName }] },
      reload,
    ),
  );
  wireBugList(main.querySelector('#bugWrap'), reload);

  main.querySelector('#btnDel').addEventListener('click', () =>
    confirmDanger({
      title: 'Delete This Test Report Permanently?',
      intro:
        'This will remove the saved metrics, charts, checklist results, defects linked exclusively to this session, and the original JSON report from this PC.',
      lines: [
        ['Test session', 1],
        ['Performance samples', s.series.length],
        ['Checklist results', assessed],
        ['Original JSON report', 1],
      ],
      confirmLabel: 'Delete Permanently',
      onConfirm: () => api.deleteSession(id),
      onDone: (res) => {
        toast(`Report deleted — ${res.samples} sample(s) and the original JSON removed`, 'success');
        location.hash = `#/projects/${s.projectId}`;
      },
    }),
  );
}

function checkRow(c, value, index) {
  const n = String(index + 1).padStart(2, '0');
  return `<div class="check-row ${value ? 'done' : ''}">
    <div class="check-idx" aria-hidden="true">${n}</div>
    <div class="ctext">${esc(CHECK_DISPLAY[c.id] ?? c.t)}<small>${esc(c.d)}</small></div>
    <div class="check-state ${value ?? ''}">${value ? `${CHECK_STATE[value]} · ${checkMarks(value)}/5` : 'Not assessed · 0/5'}</div>
    <div class="seg" role="group" aria-label="${esc(c.t)} result">
      ${['pass', 'warn', 'fail']
        .map(
          (k) => `<button type="button" class="${value === k ? 'on ' + k : ''}"
            data-check="${esc(c.id)}" data-val="${k}"
            aria-pressed="${value === k}">${CHECK_STATE[k]}</button>`,
        )
        .join('')}
    </div>
  </div>`;
}

/** Score breakdown shown under the overall result. */
function scoreNoteHTML(g, targetFps) {
  if (!g) return `Judged against a ${targetFps} Hz comfort target.`;
  return `Judged against a ${targetFps} Hz comfort target.
    <b>Score ${g.score}/100</b> &mdash; performance ${g.performanceScore}/${GRADE_CONFIG.maxPerformance},
    checklist ${g.checklistScore}/${GRADE_CONFIG.maxChecklist}.`;
}

function checklistHint(assessed, total, g) {
  const marks = g ? ` · ${g.checklistScore}/${GRADE_CONFIG.maxChecklist} marks` : '';
  return `${assessed} of ${total} assessed${marks} · specific to this test session`;
}

/** Re-renders just the checklist section — no full page reload. */
function refreshChecklist(main, s, g) {
  const section = main.querySelector('#chk-h').closest('.section');
  const assessed = Object.keys(s.checklist).length;
  section.querySelector('.hint').textContent = checklistHint(assessed, s.checklistItems.length, g);
  section.querySelectorAll('.check-row').forEach((row, i) => {
    const c = s.checklistItems[i];
    const value = s.checklist[c.id];
    row.classList.toggle('done', !!value);
    const state = row.querySelector('.check-state');
    state.className = `check-state ${value ?? ''}`;
    state.textContent = value ? `${CHECK_STATE[value]} · ${checkMarks(value)}/5` : 'Not assessed · 0/5';
    row.querySelectorAll('[data-check]').forEach((b) => {
      const on = value === b.dataset.val;
      b.className = on ? `on ${b.dataset.val}` : '';
      b.setAttribute('aria-pressed', String(on));
      b.disabled = false;
    });
  });
}

/** Updates the verdict banner after a re-grade, in place. */
function refreshGrade(main, derived, targetFps) {
  if (!derived) return;
  const banner = main.querySelector('.verdict');
  const badge = banner.querySelector('.grade');
  const g = derived.grade;
  if (g) {
    const html = gradeBadge(g.grade, g.score, 'lg');
    if (badge) badge.outerHTML = html;
    else banner.querySelector('.v-main').insertAdjacentHTML('beforeend', html);

    // The overall status now follows the score band, so refresh it too.
    banner.className = `verdict ${g.status}`;
    const statusEl = banner.querySelector('.v-status');
    if (statusEl) statusEl.textContent = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[g.status] ?? '—';

    // Re-draw the score ring to the new value.
    const ring = banner.querySelector('[data-ring]');
    if (ring) {
      ring.className = `score-ring ${g.status}`;
      ring.dataset.ring = String(g.score);
      ring.setAttribute('aria-label', `Score ${g.score} out of 100`);
      const num = ring.querySelector('.rv b');
      if (num) { num.dataset.count = String(g.score); num.textContent = '0'; }
      drawRings(banner);
      countUp(ring);
    }

    const note = banner.querySelector('#scoreNote');
    if (note) note.innerHTML = scoreNoteHTML(g, targetFps);
  } else if (badge) {
    badge.remove();
  }
}

function chartsHTML(s) {
  if (!s.series.length) {
    return `<section class="section" aria-labelledby="ch-h">
      <h3 id="ch-h">Performance Over Time</h3>
      <div class="chart-empty">
        <div>No time-series data in this report</div>
        <div class="muted" style="font-size:12px">The profiler recorded summary metrics but no sample points.</div>
      </div>
    </section>`;
  }
  return `
    <section class="section" aria-labelledby="fps-h">
      <h3 id="fps-h">Frame Rate Over Time <span class="hint">${s.series.length} samples · FPS</span></h3>
      <div class="chartwrap"><canvas id="fpsChart" role="img"
        aria-label="Frames per second across the session against a ${s.targetFps} hertz target"></canvas></div>
    </section>
    <section class="section" aria-labelledby="ft-h">
      <h3 id="ft-h">Frame Time Over Time <span class="hint">milliseconds · budget ${r2(1000 / s.targetFps)} ms</span></h3>
      <div class="chartwrap"><canvas id="frameChart" role="img"
        aria-label="Frame time in milliseconds against a ${r2(1000 / s.targetFps)} millisecond budget"></canvas></div>
    </section>
    <section class="section" aria-labelledby="mem-h">
      <h3 id="mem-h">Memory Over Time <span class="hint">megabytes allocated</span></h3>
      <div class="chartwrap"><canvas id="memChart" role="img"
        aria-label="Allocated memory in megabytes across the session"></canvas></div>
    </section>`;
}

function metricsHTML(s, dropPct) {
  // Scored tiles animate their value; informational tiles are visually quieter
  // so the four that carry marks read first.
  const cell = (label, num, dec, unit, judge, note, info) => {
    const has = num != null && !isNaN(num);
    const val = has
      ? `<span data-count="${num}" data-dec="${dec}">0</span>`
      : '—';
    return `<div class="metric ${judge} ${info ? 'info' : ''}">
      <div class="label">${esc(label)}</div>
      <div class="val">${val}<span class="unit"> ${esc(unit ?? '')}</span></div>
      <div class="judge">${esc(note ?? { pass: 'Within target', warn: 'Borderline', fail: 'Below target', neutral: 'No data' }[judge])}</div>
      <div class="bar"></div>
    </div>`;
  };

  return `<div class="grid-metrics">
    ${cell('Average FPS', s.avgFps, 1, '', judgeFps(s.avgFps, s.targetFps), `Target ${s.targetFps} Hz`)}
    ${cell('Bad Frames', dropPct, 1, '%', judgeDropped(s.droppedFrames, s.totalFrames), `${int(s.droppedFrames)} of ${int(s.totalFrames)}`)}
    ${cell('Avg Frame Time', s.avgFrameMs, 2, 'ms', judgeFrameMs(s.avgFrameMs, s.targetFps), `Budget ${r2(1000 / s.targetFps)} ms`)}
    ${cell('Memory', s.memoryMB > 0 ? s.memoryMB : null, 1, 'MB', judgeMemory(s.memoryMB, s.platform), `${s.platform} budget`)}
  </div>
  <div class="grid-metrics">
    ${cell('Draw Calls', s.drawCalls ?? null, 0, '', 'neutral', s.drawCalls != null ? 'Editor capture' : 'Build run', true)}
    ${cell('Triangles', s.triangles ?? null, 0, '', 'neutral', s.triangles != null ? 'Editor capture' : 'Build run', true)}
    ${cell('Battery', s.batteryLevel != null ? s.batteryLevel * 100 : null, 0, '%', 'neutral', s.batteryStatus ?? 'Not reported', true)}
    ${cell('Minimum FPS', s.minFps, 1, '', 'neutral', 'Worst frame · not scored', true)}
    ${cell('1% Low FPS', s.onePercentLowFps, 1, '', 'neutral', 'Not scored', true)}
  </div>`;
}
