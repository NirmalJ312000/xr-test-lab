/**
 * Client-side JSON and Excel export for the demo build.
 *
 * On the local app these are server routes. Here the same workbook is produced
 * in the browser with the exceljs UMD bundle, so the demo's "Download Excel"
 * yields the identical single-sheet report — same columns, same order.
 */
import api from '../api.js';
import { CHECKLIST, computeGrade } from '../../shared/xr-metrics/index.js';

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
const RESULT = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
const STATUS = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', neutral: '—' };
const SEV = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const BSTATUS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
const DATE_FMT = 'dd-mmm-yyyy hh:mm';

const asDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };
const round = (v, dp) => (v == null ? null : Number(Number(v).toFixed(dp)));

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Portable JSON bundle, matching /api/data/export. */
export function exportJson() {
  const d = api.__db();
  const bundle = {
    format: 'xr-test-lab-export-v1',
    exportedAt: new Date().toISOString(),
    appVersion: '1.0.0-demo',
    projects: d.projects, students: d.students, projectMembers: d.members,
    checklistItems: CHECKLIST.map((c, i) => ({ id: c.id, title: c.t, description: c.d, sortOrder: i })),
    bugs: d.bugs,
    sessions: d.sessions.map((s) => ({
      ...s,
      rawReport: (() => { try { return JSON.parse(s.rawReport); } catch { return s.rawReport; } })(),
      samples: s.series ?? [],
      checklist: d.checklist.filter((c) => c.sessionId === s.id),
    })),
  };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  download(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
    `xr-test-lab-backup-${stamp}.json`);
}

/** Single-sheet overall report, matching /api/data/export.xlsx. */
export async function exportExcel() {
  if (typeof ExcelJS === 'undefined') throw new Error('The spreadsheet library is still loading.');
  const d = api.__db();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'XR Test Lab';
  wb.created = new Date();
  const sheet = wb.addWorksheet('XR Test Lab - Overall Report', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Project Name', key: 'projectName', width: 30 },
    { header: 'Project Platform', key: 'projectPlatform', width: 15 },
    { header: 'Target FPS', key: 'targetFps', width: 11 },
    { header: 'Project Status', key: 'projectStatus', width: 14 },
    { header: 'Total Sessions for Project', key: 'totalSessions', width: 22 },
    { header: 'Student Name', key: 'studentName', width: 24 },
    { header: 'Student ID', key: 'studentCode', width: 14 },
    { header: 'Student Email', key: 'studentEmail', width: 26 },
    { header: 'Session Number', key: 'sessionNumber', width: 14 },
    { header: 'Test Date', key: 'testDate', width: 21, style: { numFmt: DATE_FMT } },
    { header: 'Test Duration (s)', key: 'duration', width: 15, style: { numFmt: '0.0' } },
    { header: 'Device', key: 'device', width: 26 },
    { header: 'GPU', key: 'gpu', width: 26 },
    { header: 'OS', key: 'os', width: 26 },
    { header: 'Platform', key: 'platform', width: 10 },
    { header: 'Average FPS', key: 'avgFps', width: 13, style: { numFmt: '0.0' } },
    { header: 'Bad Frames %', key: 'badFrames', width: 13, style: { numFmt: '0.00"%"' } },
    { header: 'Average Frame Time (ms)', key: 'avgFrameMs', width: 20, style: { numFmt: '0.00' } },
    { header: 'Memory (MB)', key: 'memoryMB', width: 13, style: { numFmt: '0.0' } },
    { header: 'Draw Calls', key: 'drawCalls', width: 12 },
    { header: 'Triangles', key: 'triangles', width: 13, style: { numFmt: '#,##0' } },
    { header: 'Battery Level', key: 'batteryLevel', width: 13, style: { numFmt: '0"%"' } },
    { header: 'Battery Status', key: 'batteryStatus', width: 15 },
    { header: 'Minimum FPS (info only)', key: 'minFps', width: 20, style: { numFmt: '0.0' } },
    { header: '1% Low FPS (info only)', key: 'onePctLow', width: 20, style: { numFmt: '0.0' } },
    ...CHECKLIST.map((c) => ({ header: CHECK_COLUMNS[c.id] ?? c.t, key: `chk_${c.id}`, width: 22 })),
    { header: 'Checklist Score / 40', key: 'checklistScore', width: 18 },
    { header: 'Performance Score / 60', key: 'performanceScore', width: 20 },
    { header: 'Final Score / 100', key: 'finalScore', width: 16 },
    { header: 'Grade', key: 'grade', width: 8 },
    { header: 'Overall Status', key: 'overallStatus', width: 16 },
    { header: 'Total Bugs', key: 'bugTotal', width: 11 },
    { header: 'Critical Bugs', key: 'bugCritical', width: 13 },
    { header: 'High Bugs', key: 'bugHigh', width: 11 },
    { header: 'Medium Bugs', key: 'bugMedium', width: 12 },
    { header: 'Low Bugs', key: 'bugLow', width: 10 },
    { header: 'Open Bugs', key: 'bugOpen', width: 11 },
    { header: 'Resolved Bugs', key: 'bugResolved', width: 14 },
  ];

  const ordered = [...d.sessions].sort((a, b) => {
    const pa = d.projects.find((p) => p.id === a.projectId)?.projectName ?? '';
    const pb = d.projects.find((p) => p.id === b.projectId)?.projectName ?? '';
    return pa.localeCompare(pb, undefined, { sensitivity: 'base' }) || a.capturedAt.localeCompare(b.capturedAt);
  });

  const totalFor = (pid) => d.sessions.filter((s) => s.projectId === pid).length;
  const seq = new Map();

  for (const s of ordered) {
    const project = d.projects.find((p) => p.id === s.projectId) ?? {};
    const student = d.students.find((x) => x.id === s.studentId) ?? {};
    const n = (seq.get(s.projectId) ?? 0) + 1;
    seq.set(s.projectId, n);

    const results = Object.fromEntries(
      d.checklist.filter((c) => c.sessionId === s.id).map((c) => [c.itemId, c.result]));
    const g = computeGrade(s, { checklist: results });
    const invalid = s.captureStatus === 'invalid';

    const bugs = d.bugs.filter((b) => b.projectId === s.projectId);
    const cnt = (f) => bugs.filter(f).length;

    const row = {
      projectName: project.projectName, projectPlatform: project.platform, targetFps: project.targetFps,
      projectStatus: project.status === 'archived' ? 'Archived' : 'Active', totalSessions: totalFor(s.projectId),
      studentName: student.studentName, studentCode: student.studentId ?? '', studentEmail: student.email ?? '',
      sessionNumber: n, testDate: asDate(s.capturedAt), duration: round(s.durationSec, 1),
      device: s.device ?? '', gpu: s.gpu ?? '', os: s.os ?? '', platform: s.platform,
      avgFps: invalid ? 'N/A' : round(s.avgFps, 1),
      badFrames: invalid || !(s.totalFrames > 0) ? 'N/A' : round((s.droppedFrames / s.totalFrames) * 100, 2),
      avgFrameMs: invalid ? 'N/A' : round(s.avgFrameMs, 2),
      memoryMB: round(s.memoryMB, 1) ?? '',
      drawCalls: s.drawCalls ?? '', triangles: s.triangles ?? '',
      batteryLevel: s.batteryLevel == null || s.batteryLevel < 0 ? '' : Math.round(s.batteryLevel * 100),
      batteryStatus: s.batteryStatus ?? '',
      minFps: invalid ? 'N/A' : round(s.minFps, 1),
      onePctLow: invalid ? 'N/A' : round(s.onePercentLowFps, 1),
      checklistScore: g ? g.checklistScore : 0,
      performanceScore: g ? g.performanceScore : 'N/A',
      finalScore: g ? g.score : 'N/A',
      grade: g ? g.grade : 'N/A',
      overallStatus: invalid ? 'INVALID CAPTURE' : (STATUS[s.performanceStatus] ?? '—'),
      bugTotal: bugs.length,
      bugCritical: cnt((b) => b.severity === 'critical'),
      bugHigh: cnt((b) => b.severity === 'high'),
      bugMedium: cnt((b) => b.severity === 'medium'),
      bugLow: cnt((b) => b.severity === 'low'),
      bugOpen: cnt((b) => ['open', 'in_progress'].includes(b.status)),
      bugResolved: cnt((b) => b.status === 'resolved'),
    };
    for (const c of CHECKLIST) row[`chk_${c.id}`] = RESULT[results[c.id]] ?? 'NOT ASSESSED';
    sheet.addRow(row);
  }

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FF1A2028' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  header.height = 32;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  for (const key of ['projectName', 'device', 'gpu', 'os', 'studentEmail']) {
    sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }

  const buf = await wb.xlsx.writeBuffer();
  download(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `XR_Test_Lab_Overall_Report_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

/**
 * Intercepts the export links, which point at '#export-json' / '#export-xlsx'
 * in this build, and runs the client-side equivalent instead.
 */
export function wireExports(toast) {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href="#export-json"], a[href="#export-xlsx"]');
    if (!a) return;
    e.preventDefault();
    try {
      if (a.getAttribute('href') === '#export-json') { exportJson(); toast?.('Backup downloaded', 'success'); }
      else { toast?.('Building your Excel workbook…'); await exportExcel(); toast?.('Excel workbook downloaded', 'success'); }
    } catch (err) {
      console.error('[demo export]', err);
      toast?.(err.message ?? 'Export failed', 'error');
    }
  });
}

export default wireExports;
