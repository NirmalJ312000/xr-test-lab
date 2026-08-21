/**
 * Sample archive for the GitHub Pages demo.
 *
 * Entirely fictional — no real student data ever leaves the local machine.
 * The set is chosen to exercise every state the interface can show: a healthy
 * project improving over three runs, a failing AR project with defects, a
 * borderline WARN, and a zero-frame INVALID CAPTURE.
 */
import { computeGrade, isInvalidCapture } from '../../shared/xr-metrics/index.js';

const iso = (d) => new Date(d).toISOString();

/** Deterministic pseudo-random so the demo looks identical for everyone. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** Builds a plausible frame-rate trace around `base`. */
function series(base, mem, n, seed, dipAt) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const dip = dipAt && i > dipAt && i < dipAt + 5 ? base * 0.42 : 0;
    const fps = Math.max(8, base + Math.sin(i / 4) * 3 - dip + (r() * 4 - 2));
    return {
      t: +(i * 0.5).toFixed(1),
      fps: +fps.toFixed(1),
      frameMs: +(1000 / fps).toFixed(2),
      memMB: +(mem - 60 + i * 2.4 + r() * 12).toFixed(1),
    };
  });
}

/** Reconstructs the profiler JSON so "View raw" and PDF export stay truthful. */
function rawReport(s, projectName, studentName, studentCode) {
  return JSON.stringify({
    schema: 'xr-test-profile-v1',
    projectName, studentName, studentId: studentCode ?? '',
    platform: s.platform, capturedAt: s.capturedAt, durationSec: s.durationSec,
    targetFps: s.targetFps, avgFps: s.avgFps, minFps: s.minFps,
    onePercentLowFps: s.onePercentLowFps, avgFrameMs: s.avgFrameMs,
    droppedFrames: s.droppedFrames, totalFrames: s.totalFrames, memoryMB: s.memoryMB,
    drawCalls: s.drawCalls ?? -1, triangles: s.triangles ?? -1,
    batteryLevel: s.batteryLevel ?? -1, batteryStatus: s.batteryStatus ?? 'Unknown',
    device: s.device, gpu: s.gpu, os: s.os, series: s.series,
  }, null, 2);
}

export function SEED() {
  const P = (id, projectName, platform, targetFps, description) => ({
    id, projectName, normalizedName: projectName.toLowerCase(), platform, targetFps,
    description, status: 'active', createdAt: iso('2026-07-20T09:00:00Z'), updatedAt: iso('2026-08-14T09:00:00Z'),
  });
  const S = (id, studentId, studentName, email) => ({
    id, studentId, studentName, normalizedName: studentName.toLowerCase(), email,
    status: 'active', createdAt: iso('2026-07-20T09:00:00Z'), updatedAt: iso('2026-07-20T09:00:00Z'),
  });

  const projects = [
    P('prj_museum', 'VR Heritage Museum', 'VR', 72, 'Guided walkthrough of a reconstructed heritage site.'),
    P('prj_chem', 'AR Chemistry Lab', 'AR', 60, 'Molecule assembly on a tabletop AR surface.'),
    P('prj_anatomy', 'VR Anatomy Explorer', 'VR', 90, 'Layered anatomical dissection in room scale.'),
    P('prj_survey', 'AR Campus Survey', 'AR', 60, 'Outdoor plane tracking and waypoint capture.'),
  ];

  const students = [
    S('stu_priya', '21BCE1042', 'Priya Kannan', 'priya.k@example.edu'),
    S('stu_arjun', '21BIT0233', 'Arjun Menon', null),
    S('stu_divya', '21BCE0871', 'Divya Suresh', 'divya.s@example.edu'),
    S('stu_rahul', '21BCE1190', 'Rahul Nair', null),
  ];

  const members = [
    ['prj_museum', 'stu_priya'], ['prj_museum', 'stu_divya'],
    ['prj_chem', 'stu_arjun'], ['prj_anatomy', 'stu_divya'], ['prj_survey', 'stu_rahul'],
  ].map(([projectId, studentId]) => ({ projectId, studentId, role: null, joinedAt: iso('2026-07-21T09:00:00Z') }));

  const raw = [
    // Museum: three runs showing real improvement across the term.
    { id: 'ses_m1', projectId: 'prj_museum', studentId: 'stu_priya', capturedAt: iso('2026-08-02T10:15:00Z'),
      targetFps: 72, platform: 'VR', device: 'Meta Quest 3', gpu: 'Adreno 740', os: 'Android 14',
      durationSec: 32.5, avgFps: 63.4, minFps: 28, onePercentLowFps: 41, avgFrameMs: 15.77,
      droppedFrames: 96, totalFrames: 2060, memoryMB: 1840, drawCalls: 412, triangles: 1240000,
      batteryLevel: 0.78, batteryStatus: 'Discharging', series: series(63, 1840, 65, 11, 38) },
    { id: 'ses_m2', projectId: 'prj_museum', studentId: 'stu_priya', capturedAt: iso('2026-08-08T10:05:00Z'),
      targetFps: 72, platform: 'VR', device: 'Meta Quest 3', gpu: 'Adreno 740', os: 'Android 14',
      durationSec: 30.0, avgFps: 70.2, minFps: 49, onePercentLowFps: 58, avgFrameMs: 14.25,
      droppedFrames: 31, totalFrames: 2100, memoryMB: 1620, drawCalls: 268, triangles: 980000,
      batteryLevel: 0.64, batteryStatus: 'Discharging', series: series(70, 1620, 60, 22) },
    { id: 'ses_m3', projectId: 'prj_museum', studentId: 'stu_divya', capturedAt: iso('2026-08-14T11:40:00Z'),
      targetFps: 72, platform: 'VR', device: 'Meta Quest 3', gpu: 'Adreno 740', os: 'Android 14',
      durationSec: 28.5, avgFps: 71.6, minFps: 58, onePercentLowFps: 66, avgFrameMs: 13.97,
      droppedFrames: 11, totalFrames: 2040, memoryMB: 1510, drawCalls: 214, triangles: 870000,
      batteryLevel: 0.52, batteryStatus: 'Discharging', series: series(71.6, 1510, 57, 33) },

    // Chemistry: genuinely failing, with defects logged against it.
    { id: 'ses_c1', projectId: 'prj_chem', studentId: 'stu_arjun', capturedAt: iso('2026-08-05T14:02:00Z'),
      targetFps: 60, platform: 'AR', device: 'Pixel 7', gpu: 'Mali-G710', os: 'Android 14',
      durationSec: 40.0, avgFps: 41.2, minFps: 19, onePercentLowFps: 26, avgFrameMs: 24.27,
      droppedFrames: 402, totalFrames: 2400, memoryMB: 1660, drawCalls: 512, triangles: 1520000,
      batteryLevel: 0.41, batteryStatus: 'Discharging', series: series(41, 1660, 80, 44, 46) },

    // Anatomy: borderline — a good capture that just misses a 90 Hz target.
    { id: 'ses_a1', projectId: 'prj_anatomy', studentId: 'stu_divya', capturedAt: iso('2026-08-11T09:20:00Z'),
      targetFps: 90, platform: 'VR', device: 'Valve Index', gpu: 'NVIDIA RTX 4070', os: 'Windows 11',
      durationSec: 35.0, avgFps: 82.4, minFps: 61, onePercentLowFps: 70, avgFrameMs: 12.14,
      droppedFrames: 74, totalFrames: 2880, memoryMB: 2210, drawCalls: 338, triangles: 2100000,
      batteryLevel: -1, batteryStatus: 'Unknown', series: series(82, 2210, 70, 55) },

    // Survey: the profiler ran but captured nothing — INVALID CAPTURE.
    { id: 'ses_s1', projectId: 'prj_survey', studentId: 'stu_rahul', capturedAt: iso('2026-08-13T08:30:00Z'),
      targetFps: 60, platform: 'AR', device: 'Samsung Galaxy S23', gpu: 'Adreno 740', os: 'Android 14',
      durationSec: 0, avgFps: 0, minFps: 0, onePercentLowFps: 0, avgFrameMs: 0,
      droppedFrames: 0, totalFrames: 0, memoryMB: 740, drawCalls: -1, triangles: -1,
      batteryLevel: -1, batteryStatus: 'Unknown', series: [] },
  ];

  const checklist = [
    ...['launch', 'fps', 'track', 'interact', 'comfort', 'ui', 'audio', 'exit']
      .map((itemId) => ({ sessionId: 'ses_m3', itemId, result: itemId === 'comfort' ? 'warn' : 'pass',
        note: itemId === 'comfort' ? 'Slight vection on the staircase transition.' : null,
        assessedAt: iso('2026-08-14T12:10:00Z') })),
    { sessionId: 'ses_c1', itemId: 'launch', result: 'pass', note: null, assessedAt: iso('2026-08-05T15:00:00Z') },
    { sessionId: 'ses_c1', itemId: 'fps', result: 'fail', note: 'Collapses below 25 FPS with 3+ molecules.', assessedAt: iso('2026-08-05T15:00:00Z') },
    { sessionId: 'ses_c1', itemId: 'track', result: 'warn', note: 'Drifts on low-texture surfaces.', assessedAt: iso('2026-08-05T15:00:00Z') },
    { sessionId: 'ses_c1', itemId: 'interact', result: 'pass', note: null, assessedAt: iso('2026-08-05T15:00:00Z') },
    { sessionId: 'ses_a1', itemId: 'launch', result: 'pass', note: null, assessedAt: iso('2026-08-11T10:00:00Z') },
    { sessionId: 'ses_a1', itemId: 'fps', result: 'warn', note: null, assessedAt: iso('2026-08-11T10:00:00Z') },
    { sessionId: 'ses_a1', itemId: 'ui', result: 'pass', note: null, assessedAt: iso('2026-08-11T10:00:00Z') },
  ];

  const bugs = [
    { id: 'bug_1', projectId: 'prj_chem', sessionId: 'ses_c1', studentId: 'stu_arjun',
      title: 'Frame rate collapses when three or more molecules are spawned',
      description: 'Each molecule issues its own draw call; nothing is batched or pooled.',
      severity: 'critical', status: 'open', resolutionNote: null,
      createdAt: iso('2026-08-05T15:20:00Z'), updatedAt: iso('2026-08-05T15:20:00Z'), resolvedAt: null },
    { id: 'bug_2', projectId: 'prj_chem', sessionId: 'ses_c1', studentId: 'stu_arjun',
      title: 'AR plane tracking drifts on low-texture surfaces',
      description: 'On a plain white table the anchor slides several centimetres.',
      severity: 'high', status: 'in_progress', resolutionNote: null,
      createdAt: iso('2026-08-05T15:26:00Z'), updatedAt: iso('2026-08-09T09:00:00Z'), resolvedAt: null },
    { id: 'bug_3', projectId: 'prj_museum', sessionId: 'ses_m1', studentId: 'stu_priya',
      title: 'Hand menu flickers when both controllers are raised',
      description: 'Z-fighting between the menu quad and the wrist attachment point.',
      severity: 'medium', status: 'resolved',
      resolutionNote: 'Offset the menu 2 cm along the wrist normal.',
      createdAt: iso('2026-08-02T12:00:00Z'), updatedAt: iso('2026-08-08T11:00:00Z'), resolvedAt: iso('2026-08-08T11:00:00Z') },
    { id: 'bug_4', projectId: 'prj_anatomy', sessionId: null, studentId: 'stu_divya',
      title: 'Label text clips through the ribcage mesh at close range',
      description: null, severity: 'low', status: 'open', resolutionNote: null,
      createdAt: iso('2026-08-11T10:30:00Z'), updatedAt: iso('2026-08-11T10:30:00Z'), resolvedAt: null },
  ];

  // Attach provenance and derived state exactly as the real import pipeline would.
  const sessions = raw.map((s) => {
    const project = projects.find((p) => p.id === s.projectId);
    const student = students.find((x) => x.id === s.studentId);
    const results = Object.fromEntries(
      checklist.filter((c) => c.sessionId === s.id).map((c) => [c.itemId, c.result]));
    const g = computeGrade(s, { checklist: results });
    return {
      ...s,
      schemaVersion: 'xr-test-profile-v1',
      contentHash: `seed-${s.id}`,
      originalFilename: `xrtest_${project.projectName.replace(/\s+/g, '_')}_${s.capturedAt.slice(0, 10).replace(/-/g, '')}.json`,
      rawReport: rawReport(s, project.projectName, student.studentName, student.studentId),
      fileSizeBytes: 0,
      importedAt: s.capturedAt,
      notes: null,
      captureStatus: isInvalidCapture(s) ? 'invalid' : 'valid',
      performanceStatus: g ? g.status : 'neutral',
      gradeLetter: g ? g.grade : null,
      gradeScore: g ? g.score : null,
    };
  });

  return { projects, students, members, sessions, checklist, bugs };
}

export default SEED;
