/**
 * Excel export — one worksheet, one row per test session.
 *
 * This is an overall testing report, not a database dump: every useful fact
 * about a session (its project, student, metrics, checklist and the project's
 * defect summary) is flattened onto a single row so a Project Guide can filter
 * and sort the whole cohort in one place.
 *
 * Read straight from SQLite. No IDs, no raw JSON, no per-sample data.
 */
import ExcelJS from 'exceljs';
import { getDb } from '../db/index.js';
import { CHECKLIST, computeGrade } from '../../../shared/xr-metrics/index.js';

export const SHEET_NAME = 'XR Test Lab - Overall Report';

const RESULT_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
const STATUS_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', neutral: '—' };

/** Friendly column titles for the eight checklist items, in rubric order. */
const CHECK_COLUMNS = {
  launch: 'Launches Without Crash',
  fps: 'Holds Target Frame Rate',
  track: 'Tracking / Input Works',
  interact: 'Core Interactions Function',
  comfort: 'Comfortable Locomotion',
  ui: 'UI Readable in Headset',
  audio: 'Spatial Audio Correct',
  exit: 'Clean Exit / Reset',
};

const DATE_FMT = 'dd-mmm-yyyy hh:mm';
const asDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const round = (v, dp) => (v == null ? null : Number(Number(v).toFixed(dp)));

export async function buildWorkbook() {
  const db = getDb();
  const all = (sql) => db.prepare(sql).all();

  // Every session, oldest first within each project — this ordering also
  // defines the Session Number shown to the user.
  const sessions = all(`
    SELECT s.*, p.projectName, p.platform AS projectPlatform, p.targetFps AS projectTargetFps,
           p.status AS projectStatus,
           st.studentName, st.studentId AS studentCode, st.email AS studentEmail
    FROM test_sessions s
    JOIN projects p ON p.id = s.projectId
    JOIN students st ON st.id = s.studentId
    ORDER BY p.projectName COLLATE NOCASE, s.capturedAt ASC, s.importedAt ASC
  `);

  // Checklist results, grouped per session.
  const checklistBySession = new Map();
  for (const r of all('SELECT sessionId, itemId, result FROM checklist_results')) {
    if (!checklistBySession.has(r.sessionId)) checklistBySession.set(r.sessionId, {});
    checklistBySession.get(r.sessionId)[r.itemId] = r.result;
  }

  // Defect summary per project. Defects belong to the application (they outlive
  // any single build), so every row of a project reports the same totals.
  const bugsByProject = new Map();
  for (const b of all('SELECT projectId, severity, status FROM bugs')) {
    if (!bugsByProject.has(b.projectId)) {
      bugsByProject.set(b.projectId, {
        total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0, resolved: 0,
      });
    }
    const t = bugsByProject.get(b.projectId);
    t.total += 1;
    if (t[b.severity] !== undefined) t[b.severity] += 1;
    if (b.status === 'open' || b.status === 'in_progress') t.open += 1;
    if (b.status === 'resolved') t.resolved += 1;
  }

  // Session number within its project, and the project's total session count.
  const totalByProject = new Map();
  for (const s of sessions) {
    totalByProject.set(s.projectId, (totalByProject.get(s.projectId) ?? 0) + 1);
  }
  const seqByProject = new Map();

  /* ----------------------------------------------------------- workbook -- */
  const wb = new ExcelJS.Workbook();
  wb.creator = 'XR Test Lab';
  wb.created = new Date();

  const sheet = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const checklistCols = CHECKLIST.map((c) => ({
    header: CHECK_COLUMNS[c.id] ?? c.t,
    key: `chk_${c.id}`,
    width: 22,
  }));

  sheet.columns = [
    // ---- project ----
    { header: 'Project Name', key: 'projectName', width: 30 },
    { header: 'Project Platform', key: 'projectPlatform', width: 15 },
    { header: 'Target FPS', key: 'targetFps', width: 11 },
    { header: 'Project Status', key: 'projectStatus', width: 14 },
    { header: 'Total Sessions for Project', key: 'totalSessions', width: 22 },
    // ---- student ----
    { header: 'Student Name', key: 'studentName', width: 24 },
    { header: 'Student ID', key: 'studentCode', width: 14 },
    { header: 'Student Email', key: 'studentEmail', width: 26 },
    // ---- testing ----
    { header: 'Session Number', key: 'sessionNumber', width: 14 },
    { header: 'Test Date', key: 'testDate', width: 21, style: { numFmt: DATE_FMT } },
    { header: 'Test Duration (s)', key: 'duration', width: 15, style: { numFmt: '0.0' } },
    { header: 'Device', key: 'device', width: 26 },
    { header: 'GPU', key: 'gpu', width: 26 },
    { header: 'OS', key: 'os', width: 26 },
    { header: 'Platform', key: 'platform', width: 10 },
    // ---- performance ----
    { header: 'Average FPS', key: 'avgFps', width: 13, style: { numFmt: '0.0' } },
    { header: 'Bad Frames %', key: 'badFrames', width: 13, style: { numFmt: '0.00"%"' } },
    { header: 'Average Frame Time (ms)', key: 'avgFrameMs', width: 20, style: { numFmt: '0.00' } },
    { header: 'Memory (MB)', key: 'memoryMB', width: 13, style: { numFmt: '0.0' } },
    { header: 'Draw Calls', key: 'drawCalls', width: 12 },
    { header: 'Triangles', key: 'triangles', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Battery Level', key: 'batteryLevel', width: 13, style: { numFmt: '0"%"' } },
    { header: 'Battery Status', key: 'batteryStatus', width: 15 },
    // Stored but never scored — kept for diagnosis only.
    { header: 'Minimum FPS (info only)', key: 'minFps', width: 20, style: { numFmt: '0.0' } },
    { header: '1% Low FPS (info only)', key: 'onePctLow', width: 20, style: { numFmt: '0.0' } },
    // ---- checklist ----
    ...checklistCols,
    { header: 'Checklist Score / 40', key: 'checklistScore', width: 18 },
    // ---- result ----
    { header: 'Performance Score / 60', key: 'performanceScore', width: 20 },
    { header: 'Final Score / 100', key: 'finalScore', width: 16 },
    { header: 'Grade', key: 'grade', width: 8 },
    { header: 'Overall Status', key: 'overallStatus', width: 16 },
    // ---- defects (project level) ----
    { header: 'Total Bugs', key: 'bugTotal', width: 11 },
    { header: 'Critical Bugs', key: 'bugCritical', width: 13 },
    { header: 'High Bugs', key: 'bugHigh', width: 11 },
    { header: 'Medium Bugs', key: 'bugMedium', width: 12 },
    { header: 'Low Bugs', key: 'bugLow', width: 10 },
    { header: 'Open Bugs', key: 'bugOpen', width: 11 },
    { header: 'Resolved Bugs', key: 'bugResolved', width: 14 },
  ];

  const NO_BUGS = { total: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0, resolved: 0 };

  for (const s of sessions) {
    const n = (seqByProject.get(s.projectId) ?? 0) + 1;
    seqByProject.set(s.projectId, n);

    const invalid = s.captureStatus === 'invalid';
    const results = checklistBySession.get(s.id) ?? {};
    const bugs = bugsByProject.get(s.projectId) ?? NO_BUGS;

    // The score breakdown comes from the shared metrics module — the same one
    // the server and dashboard use — so this can never drift from them.
    // An invalid capture has no score and must never read as a numeric zero.
    const g = computeGrade(s, { checklist: results });

    const row = {
      projectName: s.projectName,
      projectPlatform: s.projectPlatform,
      targetFps: s.projectTargetFps,
      projectStatus: s.projectStatus === 'archived' ? 'Archived' : 'Active',
      totalSessions: totalByProject.get(s.projectId) ?? 0,

      studentName: s.studentName,
      studentCode: s.studentCode ?? '',
      studentEmail: s.studentEmail ?? '',

      sessionNumber: n,
      testDate: asDate(s.capturedAt),
      duration: round(s.durationSec, 1),
      device: s.device ?? '',
      gpu: s.gpu ?? '',
      os: s.os ?? '',
      platform: s.platform,

      avgFps: invalid ? 'N/A' : round(s.avgFps, 1),
      badFrames: invalid || !(s.totalFrames > 0)
        ? 'N/A'
        : round((s.droppedFrames / s.totalFrames) * 100, 2),
      avgFrameMs: invalid ? 'N/A' : round(s.avgFrameMs, 2),
      memoryMB: round(s.memoryMB, 1) ?? '',
      drawCalls: s.drawCalls ?? '',
      triangles: s.triangles ?? '',
      batteryLevel: s.batteryLevel == null ? '' : Math.round(s.batteryLevel * 100),
      batteryStatus: s.batteryStatus ?? '',
      minFps: invalid ? 'N/A' : round(s.minFps, 1),
      onePctLow: invalid ? 'N/A' : round(s.onePercentLowFps, 1),

      checklistScore: g ? g.checklistScore : 0,
      performanceScore: g ? g.performanceScore : 'N/A',
      finalScore: g ? g.score : 'N/A',
      grade: g ? g.grade : 'N/A',
      overallStatus: invalid ? 'INVALID CAPTURE' : (STATUS_LABEL[s.performanceStatus] ?? '—'),

      bugTotal: bugs.total,
      bugCritical: bugs.critical,
      bugHigh: bugs.high,
      bugMedium: bugs.medium,
      bugLow: bugs.low,
      bugOpen: bugs.open,
      bugResolved: bugs.resolved,
    };

    for (const c of CHECKLIST) {
      row[`chk_${c.id}`] = RESULT_LABEL[results[c.id]] ?? 'NOT ASSESSED';
    }

    sheet.addRow(row);
  }

  /* ------------------------------------------------------------ styling -- */
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF1A2028' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  header.height = 32;

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  // Long free-text columns wrap; everything else stays on one line.
  for (const key of ['projectName', 'device', 'gpu', 'os', 'studentEmail']) {
    sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }

  return wb;
}

export const workbookFilename = () =>
  `XR_Test_Lab_Overall_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
