/**
 * XR metric judgement + grading — THE single source of truth.
 *
 * Imported by BOTH the Express server (at import time, to derive
 * captureStatus / performanceStatus / grade) and the browser dashboard. Keeping
 * one copy is the point: a grading system whose client and server disagree
 * about what a "C" is would be a correctness bug.
 *
 * Every threshold, weight and penalty below is copied VERBATIM from the
 * pre-existing web/app.js. Do not "improve" them — see docs/GRADING.md.
 */

/* ------------------------------------------------------------------ judge --
   Judges captured numbers against VR/AR comfort targets. */

export function judgeFps(avg, target) {
  if (avg == null) return 'neutral';
  if (avg >= target * 0.97) return 'pass';
  if (avg >= target * 0.85) return 'warn';
  return 'fail';
}

/**
 * Retained for the stored `onePercentLowFps` field and future analysis.
 * NOT part of the score and not shown as a performance card — see GRADE_CONFIG.
 */
export function judgeOnePctLow(low, target) {
  if (low == null) return 'neutral';
  if (low >= target * 0.85) return 'pass'; // stutter is what makes people sick
  if (low >= target * 0.70) return 'warn';
  return 'fail';
}

export function judgeDropped(dropped, total) {
  if (total == null || total === 0) return 'neutral';
  const pct = (dropped / total) * 100;
  if (pct <= 1) return 'pass';
  if (pct <= 5) return 'warn';
  return 'fail';
}

export function judgeMemory(mb, platform) {
  if (mb == null || mb <= 0) return 'neutral';
  const cap = platform === 'AR' ? 1500 : 2800; // rough Quest/mobile budgets
  if (mb <= cap * 0.7) return 'pass';
  if (mb <= cap) return 'warn';
  return 'fail';
}

export function judgeFrameMs(ms, target) {
  if (ms == null || ms <= 0) return 'neutral';
  const budget = 1000 / target;
  if (ms <= budget * 1.03) return 'pass';
  if (ms <= budget * 1.18) return 'warn';
  return 'fail';
}

/* ---------------------------------------------------------------- capture --
   A capture that recorded no frames is a BROKEN PROFILER RUN, not a failing
   student project. Such sessions are surfaced as "INVALID CAPTURE" and are
   deliberately left ungraded. */

export function isInvalidCapture(s) {
  return !!s && !(s.totalFrames > 0);
}

/* ------------------------------------------------------------------ grade --
   Final score = Performance (60) + XR Checklist (40) = 100.

   Performance uses the four scored metrics, each worth 15 marks, awarded
   purely from the existing PASS/WARN/FAIL judgement functions above. No new
   thresholds are introduced here.

   Minimum FPS, 1% Low FPS, Draw Calls, Triangles and Battery are NOT scored
   and are not shown as performance cards — a single abnormal frame must not
   dominate a student's result. They remain in the profiler JSON and in the
   database for backward compatibility and future analysis. Defects are
   important QA information but carry no score penalty.

   EVERYTHING tunable lives in GRADE_CONFIG. See docs/GRADING.md. */

export const GRADE_CONFIG = {
  /** Marks per scored performance metric (4 metrics x 15 = 60). */
  performance: { pass: 15, warn: 10, fail: 0, neutral: 0 },
  /** Marks per checklist item (8 items x 5 = 40). */
  checklist: { pass: 5, warn: 3, fail: 0 },
  maxPerformance: 60,
  maxChecklist: 40,
  /** Final score -> letter. Evaluated top-down; first row met wins. */
  scale: [
    { grade: 'A', min: 90 },
    { grade: 'B', min: 80 },
    { grade: 'C', min: 70 },
    { grade: 'D', min: 60 },
    { grade: 'F', min: 0 },
  ],
  /** Final score -> overall status shown next to the score. */
  statusScale: [
    { status: 'pass', min: 70 },
    { status: 'warn', min: 60 },
    { status: 'fail', min: 0 },
  ],
};

/** The four metrics that carry marks, in report order. */
export function scoredMetrics(s) {
  return {
    avgFps: judgeFps(s.avgFps, s.targetFps),
    badFrames: judgeDropped(s.droppedFrames, s.totalFrames),
    frameTime: judgeFrameMs(s.avgFrameMs, s.targetFps),
    memory: judgeMemory(s.memoryMB, s.platform),
  };
}

/**
 * @param {object} s      session metrics
 * @param {object} [ctx]  { checklist: {itemId: 'pass'|'warn'|'fail'} }
 * @returns {object|null} null when the capture is invalid (score/grade = N/A)
 */
export function computeGrade(s, ctx = {}) {
  if (!s) return null;
  // A broken capture carries no evidence either way: N/A, never a failure.
  if (isInvalidCapture(s)) return null;

  const cfg = GRADE_CONFIG;

  const metrics = scoredMetrics(s);
  const metricMarks = {};
  let performanceScore = 0;
  for (const [key, judgement] of Object.entries(metrics)) {
    const marks = cfg.performance[judgement] ?? 0;
    metricMarks[key] = marks;
    performanceScore += marks;
  }

  const results = ctx.checklist ?? {};
  const checklistMarks = {};
  let checklistScore = 0;
  const counts = { pass: 0, warn: 0, fail: 0, notAssessed: 0 };
  for (const item of CHECKLIST) {
    const result = results[item.id];
    const marks = cfg.checklist[result] ?? 0;
    checklistMarks[item.id] = marks;
    checklistScore += marks;
    if (result === 'pass' || result === 'warn' || result === 'fail') counts[result]++;
    else counts.notAssessed++;
  }

  const score = Math.max(0, Math.min(100, performanceScore + checklistScore));
  const grade = cfg.scale.find((r) => score >= r.min).grade;
  const status = cfg.statusScale.find((r) => score >= r.min).status;

  return {
    grade,
    score,
    status,
    performanceScore,
    checklistScore,
    metrics,
    metricMarks,
    checklistMarks,
    checklistCounts: counts,
  };
}

/**
 * Overall status for a session. Derived from the final score band
 * (70+ pass, 60+ warn, else fail); an invalid capture has no status.
 */
export function performanceStatus(s, ctx = {}) {
  if (!s || isInvalidCapture(s)) return 'neutral';
  return computeGrade(s, ctx)?.status ?? 'neutral';
}

/* -------------------------------------------------------------- checklist --
   The eight QA items, copied verbatim from the original dashboard. */

export const CHECKLIST = [
  { id: 'launch', t: 'Launches without crash', d: 'App starts and reaches main scene' },
  { id: 'fps', t: 'Holds target frame rate', d: 'No sustained drops below target' },
  { id: 'track', t: 'Tracking / input works', d: 'Controllers, hands, or AR planes respond' },
  { id: 'interact', t: 'Core interactions function', d: 'Grab, point, select, UI buttons' },
  { id: 'comfort', t: 'Comfortable locomotion', d: 'No nausea-inducing movement / jerks' },
  { id: 'ui', t: 'UI readable in headset', d: 'Text legible, panels at comfortable depth' },
  { id: 'audio', t: 'Spatial audio correct', d: 'Sound positioned and not clipping' },
  { id: 'exit', t: 'Clean exit / reset', d: 'Can quit or restart without hang' },
];
