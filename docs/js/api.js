/**
 * STATIC DATA LAYER — GitHub Pages demo build only.
 *
 * A drop-in replacement for js/api.js implementing the identical interface
 * against browser storage instead of the Express + SQLite backend. The build
 * script (scripts/build-pages.js) swaps this in; the local application never
 * loads it.
 *
 * Everything meaningful is reused rather than reimplemented:
 *   - validation  -> the server's own ingest/validate.js (it is isomorphic)
 *   - scoring     -> shared/xr-metrics, byte-identical to the real app
 *   - duplicates  -> SHA-256 via crypto.subtle
 *
 * The honest difference: reports live in localStorage, not in data/reports/ on
 * disk, because a static host has no filesystem and no database.
 */
import { validateReport, explain } from './demo/validate.js';
import { computeGrade, isInvalidCapture, CHECKLIST } from '../shared/xr-metrics/index.js';
import { SEED } from './demo/seed.js';

const KEY = 'xrtestlab.demo.v1';

/* -------------------------------------------------------------- storage -- */

const blank = () => ({ projects: [], students: [], members: [], sessions: [], checklist: [], bugs: [] });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank(), ...JSON.parse(raw) };
  } catch { /* corrupt or blocked storage: fall through to a fresh seed */ }
  const seeded = SEED();
  try { localStorage.setItem(KEY, JSON.stringify(seeded)); } catch { /* private mode */ }
  return seeded;
}

let DB = null;
const db = () => (DB ??= load());
function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (err) { console.warn('[demo] storage unavailable — changes will not persist', err); }
}

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const now = () => new Date().toISOString();
const norm = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  e.userMessage = message;
  throw e;
}

/* ---------------------------------------------------------- derivations -- */

const checklistFor = (sid) =>
  Object.fromEntries(db().checklist.filter((c) => c.sessionId === sid).map((c) => [c.itemId, c.result]));

/** Mirrors services/grading.js exactly. */
function regrade(s) {
  const g = computeGrade(s, { checklist: checklistFor(s.id) });
  s.captureStatus = isInvalidCapture(s) ? 'invalid' : 'valid';
  s.performanceStatus = g ? g.status : 'neutral';
  s.gradeLetter = g ? g.grade : null;
  s.gradeScore = g ? g.score : null;
  return g;
}

const sessionsOf = (key, id) =>
  db().sessions.filter((s) => s[key] === id).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

const nameOfProject = (id) => db().projects.find((p) => p.id === id)?.projectName ?? '';
const nameOfStudent = (id) => db().students.find((s) => s.id === id)?.studentName ?? '';
const sessionRow = (s) => ({ ...s, projectName: nameOfProject(s.projectId), studentName: nameOfStudent(s.studentId) });

function projectRow(p) {
  const list = sessionsOf('projectId', p.id);
  const ls = list[list.length - 1] ?? null;
  return {
    ...p,
    studentCount: db().members.filter((m) => m.projectId === p.id).length,
    sessionCount: list.length,
    openBugs: db().bugs.filter((b) => b.projectId === p.id && ['open', 'in_progress'].includes(b.status)).length,
    latestSessionId: ls?.id ?? null,
    latestCapturedAt: ls?.capturedAt ?? null,
    latestAvgFps: ls?.avgFps ?? null,
    latestOnePercentLowFps: ls?.onePercentLowFps ?? null,
    latestMemoryMB: ls?.memoryMB ?? null,
    latestGrade: ls?.gradeLetter ?? null,
    latestScore: ls?.gradeScore ?? null,
    latestStatus: ls?.performanceStatus ?? null,
    latestCaptureStatus: ls?.captureStatus ?? null,
  };
}

function studentRow(st) {
  const list = sessionsOf('studentId', st.id);
  const ls = list[list.length - 1] ?? null;
  return {
    ...st,
    projectCount: db().members.filter((m) => m.studentId === st.id).length,
    sessionCount: list.length,
    latestSessionId: ls?.id ?? null,
    latestCapturedAt: ls?.capturedAt ?? null,
    latestAvgFps: ls?.avgFps ?? null,
    latestGrade: ls?.gradeLetter ?? null,
    latestStatus: ls?.performanceStatus ?? null,
  };
}

/* -------------------------------------------------------------- ingest -- */

function resolveProject(r) {
  const n = norm(r.projectName);
  const found = db().projects.find((x) => x.normalizedName === n);
  if (found) return { project: found, created: false };
  const p = {
    id: uid('prj'), projectName: r.projectName, normalizedName: n, platform: r.platform,
    targetFps: r.targetFps, description: null, status: 'active', createdAt: now(), updatedAt: now(),
  };
  db().projects.push(p);
  return { project: p, created: true };
}

function resolveStudent(r) {
  let st = r.studentId ? db().students.find((x) => x.studentId === r.studentId) : null;
  if (!st) st = db().students.find((x) => x.normalizedName === norm(r.studentName) && !x.studentId);
  if (st) return { student: st, created: false };
  const made = {
    id: uid('stu'), studentId: r.studentId, studentName: r.studentName,
    normalizedName: norm(r.studentName), email: null, status: 'active', createdAt: now(), updatedAt: now(),
  };
  db().students.push(made);
  return { student: made, created: true };
}

async function checkFile({ filename, content }, seen) {
  const res = validateReport(content, filename);
  if (!res.ok) {
    return { filename, status: 'invalid', errorCode: res.errorCode, reason: explain(res.errorCode) };
  }
  const hash = await sha256(content);
  if (db().sessions.some((s) => s.contentHash === hash)) {
    return { filename, status: 'duplicate', errorCode: 'DUPLICATE_REPORT', reason: explain('DUPLICATE_REPORT') };
  }
  if (seen?.has(hash)) {
    return { filename, status: 'duplicate', errorCode: 'DUPLICATE_IN_SELECTION', reason: explain('DUPLICATE_IN_SELECTION') };
  }
  seen?.add(hash);
  const r = res.report;
  return {
    filename, status: 'valid', contentHash: hash, warnings: res.warnings, platform: r.platform,
    preview: {
      projectName: r.projectName, studentName: r.studentName, studentId: r.studentId,
      platform: r.platform, capturedAt: r.capturedAt, avgFps: r.avgFps, totalFrames: r.totalFrames,
      targetFps: r.targetFps, captureStatus: r.totalFrames > 0 ? 'valid' : 'invalid', samples: r.series.length,
    },
  };
}

const summarise = (rs) => ({
  total: rs.length,
  valid: rs.filter((r) => r.status === 'valid').length,
  imported: rs.filter((r) => r.status === 'imported').length,
  duplicate: rs.filter((r) => r.status === 'duplicate').length,
  invalid: rs.filter((r) => r.status === 'invalid').length,
});

/* ----------------------------------------------------------------- api -- */

export const api = {
  health: async () => ({ status: 'ok', database: 'demo', version: '1.0.0-demo' }),

  stats: async () => {
    const d = db();
    const latest = d.projects.filter((p) => p.status === 'active')
      .map((p) => sessionsOf('projectId', p.id).at(-1)).filter(Boolean);
    const dist = { pass: 0, warn: 0, fail: 0, invalid: 0 };
    for (const s of latest) {
      if (s.captureStatus === 'invalid') dist.invalid++;
      else if (dist[s.performanceStatus] !== undefined) dist[s.performanceStatus]++;
    }
    const graded = dist.pass + dist.warn + dist.fail;
    const pct = (n) => (graded ? Math.round((n / graded) * 100) : 0);
    return {
      totals: {
        projects: d.projects.filter((p) => p.status === 'active').length,
        archivedProjects: d.projects.filter((p) => p.status === 'archived').length,
        students: d.students.filter((s) => s.status === 'active').length,
        sessions: d.sessions.length,
        openBugs: d.bugs.filter((b) => ['open', 'in_progress'].includes(b.status)).length,
        criticalBugs: d.bugs.filter((b) => b.severity === 'critical' && ['open', 'in_progress'].includes(b.status)).length,
      },
      distribution: { ...dist, counted: graded },
      distributionPct: { pass: pct(dist.pass), warn: pct(dist.warn), fail: pct(dist.fail) },
      recentSessions: [...d.sessions].sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
        .slice(0, 10).map(sessionRow),
      version: '1.0.0-demo',
    };
  },

  projects: async (includeArchived = false) => ({
    projects: db().projects.filter((p) => includeArchived || p.status === 'active')
      .map(projectRow).sort((a, b) => byName(a.projectName, b.projectName)),
  }),

  project: async (id) => {
    const p = db().projects.find((x) => x.id === id);
    if (!p) fail('NOT_FOUND', 'That application no longer exists.');
    const row = projectRow(p);
    row.students = db().members.filter((m) => m.projectId === id).map((m) => {
      const st = db().students.find((s) => s.id === m.studentId);
      return st ? { ...st, role: m.role ?? null,
        sessionCount: db().sessions.filter((s) => s.projectId === id && s.studentId === st.id).length } : null;
    }).filter(Boolean).sort((a, b) => byName(a.studentName, b.studentName));
    row.sessions = sessionsOf('projectId', id).map((s) => ({ ...sessionRow(s), studentRowId: s.studentId }));
    row.bugs = db().bugs.filter((b) => b.projectId === id)
      .map((b) => ({ ...b, projectName: nameOfProject(b.projectId), studentName: nameOfStudent(b.studentId) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { project: row };
  },

  createProject: async (b) => {
    if (!b.projectName?.trim()) fail('BAD_REQUEST', 'Enter an application name.');
    if (db().projects.some((p) => p.normalizedName === norm(b.projectName))) {
      fail('DUPLICATE', 'An application with this name already exists.');
    }
    const p = { id: uid('prj'), projectName: b.projectName.trim(), normalizedName: norm(b.projectName),
      platform: b.platform, targetFps: Math.round(b.targetFps), description: b.description ?? null,
      status: 'active', createdAt: now(), updatedAt: now() };
    db().projects.push(p); commit();
    return { project: projectRow(p) };
  },

  updateProject: async (id, b) => {
    const p = db().projects.find((x) => x.id === id);
    if (!p) fail('NOT_FOUND', 'That application no longer exists.');
    if (b.projectName?.trim()) {
      const n = norm(b.projectName);
      if (db().projects.some((x) => x.id !== id && x.normalizedName === n)) {
        fail('DUPLICATE', 'An application with this name already exists.');
      }
      p.projectName = b.projectName.trim();
      p.normalizedName = n;
    }
    if (b.platform) p.platform = b.platform;
    if (b.targetFps != null) p.targetFps = Math.round(b.targetFps);
    if (b.description !== undefined) p.description = b.description;
    if (b.status) { p.status = b.status; p.archivedAt = b.status === 'archived' ? now() : null; }
    p.updatedAt = now(); commit();
    return { project: projectRow(p) };
  },

  projectImpact: async (id) => {
    const ss = db().sessions.filter((s) => s.projectId === id);
    const ids = new Set(ss.map((s) => s.id));
    return { impact: {
      sessions: ss.length,
      samples: ss.reduce((a, s) => a + (s.series?.length ?? 0), 0),
      checklistResults: db().checklist.filter((c) => ids.has(c.sessionId)).length,
      bugs: db().bugs.filter((b) => b.projectId === id).length,
      reportFiles: ss.length,
    } };
  },

  deleteProject: async (id, permanent) => {
    const d = db();
    if (!permanent) {
      const p = d.projects.find((x) => x.id === id);
      if (p) { p.status = 'archived'; p.archivedAt = now(); p.updatedAt = now(); }
      commit();
      return { deleted: 'archived' };
    }
    const impact = (await api.projectImpact(id)).impact;
    const ids = new Set(d.sessions.filter((s) => s.projectId === id).map((s) => s.id));
    d.sessions = d.sessions.filter((s) => s.projectId !== id);
    d.checklist = d.checklist.filter((c) => !ids.has(c.sessionId));
    d.bugs = d.bugs.filter((b) => b.projectId !== id);
    d.members = d.members.filter((m) => m.projectId !== id);
    d.projects = d.projects.filter((p) => p.id !== id);
    commit();
    return { deleted: 'permanent', ...impact, filesRemoved: impact.reportFiles };
  },

  students: async (includeArchived = false) => ({
    students: db().students.filter((s) => includeArchived || s.status === 'active')
      .map(studentRow).sort((a, b) => byName(a.studentName, b.studentName)),
  }),

  student: async (id) => {
    const st = db().students.find((x) => x.id === id);
    if (!st) fail('NOT_FOUND', 'That student no longer exists.');
    const row = studentRow(st);
    row.projects = db().members.filter((m) => m.studentId === id).map((m) => {
      const p = db().projects.find((x) => x.id === m.projectId);
      return p ? { ...p, role: m.role ?? null,
        sessionCount: db().sessions.filter((s) => s.projectId === p.id && s.studentId === id).length } : null;
    }).filter(Boolean).sort((a, b) => byName(a.projectName, b.projectName));
    row.sessions = sessionsOf('studentId', id).map((s) => ({ ...sessionRow(s), projectRowId: s.projectId }));
    return { student: row };
  },

  createStudent: async (b) => {
    if (!b.studentName?.trim()) fail('BAD_REQUEST', 'Enter a student name.');
    if (b.studentId && db().students.some((s) => s.studentId === b.studentId)) {
      fail('DUPLICATE', 'A student with this ID already exists.');
    }
    const st = { id: uid('stu'), studentId: b.studentId ?? null, studentName: b.studentName.trim(),
      normalizedName: norm(b.studentName), email: b.email ?? null,
      status: 'active', createdAt: now(), updatedAt: now() };
    db().students.push(st); commit();
    return { student: studentRow(st) };
  },

  updateStudent: async (id, b) => {
    const st = db().students.find((x) => x.id === id);
    if (!st) fail('NOT_FOUND', 'That student no longer exists.');
    if (b.studentName?.trim()) { st.studentName = b.studentName.trim(); st.normalizedName = norm(b.studentName); }
    if (b.studentId !== undefined) st.studentId = b.studentId;
    if (b.email !== undefined) st.email = b.email;
    if (b.status) { st.status = b.status; st.archivedAt = b.status === 'archived' ? now() : null; }
    st.updatedAt = now(); commit();
    return { student: studentRow(st) };
  },

  studentImpact: async (id) => {
    const ss = db().sessions.filter((s) => s.studentId === id);
    return { impact: { sessions: ss.length,
      samples: ss.reduce((a, s) => a + (s.series?.length ?? 0), 0), reportFiles: ss.length } };
  },

  deleteStudent: async (id, permanent) => {
    const d = db();
    if (!permanent) {
      const st = d.students.find((x) => x.id === id);
      if (st) { st.status = 'archived'; st.archivedAt = now(); st.updatedAt = now(); }
      commit();
      return { deleted: 'archived' };
    }
    const impact = (await api.studentImpact(id)).impact;
    const ids = new Set(d.sessions.filter((s) => s.studentId === id).map((s) => s.id));
    d.sessions = d.sessions.filter((s) => s.studentId !== id);
    d.checklist = d.checklist.filter((c) => !ids.has(c.sessionId));
    d.members = d.members.filter((m) => m.studentId !== id);
    d.students = d.students.filter((s) => s.id !== id);
    commit();
    return { deleted: 'permanent', ...impact, filesRemoved: impact.reportFiles };
  },

  sessions: async (q = '') => {
    const p = new URLSearchParams(q.replace(/^\?/, ''));
    let list = db().sessions.map(sessionRow);
    if (p.get('projectId')) list = list.filter((s) => s.projectId === p.get('projectId'));
    if (p.get('studentId')) list = list.filter((s) => s.studentId === p.get('studentId'));
    if (p.get('platform')) list = list.filter((s) => s.platform === p.get('platform'));
    if (p.get('status')) list = list.filter((s) => s.performanceStatus === p.get('status'));
    return { sessions: list.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)) };
  },

  session: async (id) => {
    const s = db().sessions.find((x) => x.id === id);
    if (!s) fail('NOT_FOUND', 'That test session no longer exists.');
    const out = sessionRow(s);
    out.studentRowId = s.studentId;
    out.studentCode = db().students.find((x) => x.id === s.studentId)?.studentId ?? null;
    out.series = s.series ?? [];
    out.checklist = checklistFor(id);
    out.checklistNotes = Object.fromEntries(
      db().checklist.filter((c) => c.sessionId === id && c.note).map((c) => [c.itemId, c.note]));
    out.checklistItems = CHECKLIST;
    out.bugs = db().bugs.filter((b) => b.projectId === s.projectId)
      .map((b) => ({ ...b, projectName: nameOfProject(b.projectId), studentName: nameOfStudent(b.studentId) }));
    return { session: out };
  },

  deleteSession: async (id) => {
    const d = db();
    const s = d.sessions.find((x) => x.id === id);
    if (!s) fail('NOT_FOUND', 'That test session no longer exists.');
    const samples = s.series?.length ?? 0;
    const checklistResults = d.checklist.filter((c) => c.sessionId === id).length;
    d.sessions = d.sessions.filter((x) => x.id !== id);
    d.checklist = d.checklist.filter((c) => c.sessionId !== id);
    d.bugs.forEach((b) => { if (b.sessionId === id) b.sessionId = null; });
    commit();
    return { deleted: 'permanent', samples, checklistResults, fileRemoved: true, projectId: s.projectId };
  },

  setCheck: async (id, itemId, result) => {
    const d = db();
    const s = d.sessions.find((x) => x.id === id);
    if (!s) fail('NOT_FOUND', 'That test session no longer exists.');
    d.checklist = d.checklist.filter((c) => !(c.sessionId === id && c.itemId === itemId));
    if (result) d.checklist.push({ sessionId: id, itemId, result, note: null, assessedAt: now() });
    const g = regrade(s);
    commit();
    return { checklist: checklistFor(id),
      derived: { captureStatus: s.captureStatus, performanceStatus: s.performanceStatus, grade: g } };
  },

  /** No server to fetch from: hand back a blob URL of the stored report. */
  rawUrl: (id) => {
    const s = db().sessions.find((x) => x.id === id);
    if (!s) return '#';
    return URL.createObjectURL(new Blob([s.rawReport ?? '{}'], { type: 'application/json' }));
  },

  bugs: async (q = '') => {
    const p = new URLSearchParams(q.replace(/^\?/, ''));
    let list = db().bugs.map((b) => ({ ...b,
      projectName: nameOfProject(b.projectId), studentName: nameOfStudent(b.studentId) }));
    if (p.get('projectId')) list = list.filter((b) => b.projectId === p.get('projectId'));
    if (p.get('sessionId')) list = list.filter((b) => b.sessionId === p.get('sessionId'));
    if (p.get('status')) list = list.filter((b) => b.status === p.get('status'));
    if (p.get('severity')) list = list.filter((b) => b.severity === p.get('severity'));
    const term = p.get('q');
    if (term) {
      const t = term.toLowerCase();
      list = list.filter((b) => `${b.title} ${b.description ?? ''}`.toLowerCase().includes(t));
    }
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorters = {
      severity: (a, b) => rank[a.severity] - rank[b.severity] || b.createdAt.localeCompare(a.createdAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      status: (a, b) => a.status.localeCompare(b.status) || b.createdAt.localeCompare(a.createdAt),
      project: (a, b) => byName(a.projectName, b.projectName),
    };
    return { bugs: list.sort(sorters[p.get('sort')] ?? sorters.created) };
  },

  bug: async (id) => {
    const b = db().bugs.find((x) => x.id === id);
    if (!b) fail('NOT_FOUND', 'That defect no longer exists.');
    return { bug: { ...b, projectName: nameOfProject(b.projectId), studentName: nameOfStudent(b.studentId) } };
  },

  createBug: async (b) => {
    if (!b.title?.trim()) fail('BAD_REQUEST', 'Enter a title for the defect.');
    const bug = { id: uid('bug'), projectId: b.projectId, sessionId: b.sessionId ?? null,
      studentId: b.studentId ?? null, title: b.title.trim(), description: b.description ?? null,
      severity: b.severity, status: 'open', resolutionNote: null,
      createdAt: now(), updatedAt: now(), resolvedAt: null };
    db().bugs.push(bug); commit();
    return { bug: { ...bug, projectName: nameOfProject(bug.projectId), studentName: nameOfStudent(bug.studentId) } };
  },

  updateBug: async (id, b) => {
    const bug = db().bugs.find((x) => x.id === id);
    if (!bug) fail('NOT_FOUND', 'That defect no longer exists.');
    Object.assign(bug, {
      title: b.title?.trim() ?? bug.title,
      description: b.description !== undefined ? b.description : bug.description,
      severity: b.severity ?? bug.severity,
      status: b.status ?? bug.status,
      resolutionNote: b.resolutionNote !== undefined ? b.resolutionNote : bug.resolutionNote,
      updatedAt: now(),
    });
    bug.resolvedAt = bug.status === 'resolved' ? (bug.resolvedAt ?? now()) : null;
    commit();
    return { bug: { ...bug, projectName: nameOfProject(bug.projectId), studentName: nameOfStudent(bug.studentId) } };
  },

  deleteBug: async (id) => {
    db().bugs = db().bugs.filter((b) => b.id !== id);
    commit();
    return { deleted: true };
  },

  previewReports: async (files) => {
    const seen = new Set();
    const results = [];
    for (const f of files) results.push(await checkFile(f, seen));
    return { summary: summarise(results), results, supportedSchemas: ['xr-test-profile-v1'] };
  },

  importReports: async (files) => {
    const results = [];
    for (const f of files) {
      const check = await checkFile(f, null);
      if (check.status !== 'valid') { results.push(check); continue; }

      const r = validateReport(f.content, f.filename).report;
      const { project, created: projectCreated } = resolveProject(r);
      const { student, created: studentCreated } = resolveStudent(r);
      if (!db().members.some((m) => m.projectId === project.id && m.studentId === student.id)) {
        db().members.push({ projectId: project.id, studentId: student.id, role: null, joinedAt: now() });
      }

      const s = {
        id: uid('ses'), projectId: project.id, studentId: student.id,
        schemaVersion: r.schema, contentHash: check.contentHash, originalFilename: f.filename,
        rawReport: f.content, fileSizeBytes: new Blob([f.content]).size, importedAt: now(),
        capturedAt: r.capturedAt, durationSec: r.durationSec, targetFps: r.targetFps,
        platform: r.platform, device: r.device, gpu: r.gpu, os: r.os,
        batteryLevel: r.batteryLevel, batteryStatus: r.batteryStatus,
        avgFps: r.avgFps, minFps: r.minFps, onePercentLowFps: r.onePercentLowFps,
        avgFrameMs: r.avgFrameMs, droppedFrames: r.droppedFrames, totalFrames: r.totalFrames,
        memoryMB: r.memoryMB, drawCalls: r.drawCalls, triangles: r.triangles,
        series: r.series, notes: null,
      };
      regrade(s);
      db().sessions.push(s);

      results.push({ filename: f.filename, status: 'imported', sessionId: s.id, warnings: check.warnings,
        projectId: project.id, projectName: project.projectName, projectCreated,
        studentId: student.id, studentName: student.studentName, studentCreated,
        captureStatus: s.captureStatus, grade: s.gradeLetter });
    }
    commit();
    return { summary: summarise(results), results };
  },

  // The legacy localStorage migration is a local-app concern only.
  migrateStatus: async () => ({ alreadyMigrated: 'demo', hasData: db().sessions.length > 0 }),
  migrateLocalStorage: async () => ({
    migrated: { projects: 0, students: 0, sessions: 0, bugs: 0, checklistResults: 0, skipped: [] } }),

  dataSummary: async () => {
    const d = db();
    const bytes = new Blob([localStorage.getItem(KEY) ?? '']).size;
    return {
      version: '1.0.0-demo',
      location: {
        database: 'Browser storage (demo build)',
        reports: 'Browser storage (demo build)',
        dataFolder: 'This demo keeps everything in your browser only — nothing is uploaded',
      },
      counts: { projects: d.projects.length, students: d.students.length, sessions: d.sessions.length,
        samples: d.sessions.reduce((a, s) => a + (s.series?.length ?? 0), 0),
        checklistResults: d.checklist.length, bugs: d.bugs.length, reportFiles: d.sessions.length },
      storage: { databaseBytes: bytes, reportsBytes: 0, totalBytes: bytes },
      schemaVersion: 'demo',
    };
  },

  // Export handlers are wired client-side by js/demo/exports.js in this build.
  exportUrl: () => '#export-json',
  excelUrl: () => '#export-xlsx',

  /** Demo-only helpers used by the reset control. */
  __resetDemo: () => { localStorage.removeItem(KEY); DB = null; },
  __db: () => db(),
};

export default api;
