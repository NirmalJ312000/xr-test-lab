# XR QA Score

Every **valid** test session receives a score out of 100 and a letter grade:

```
Final Score = Performance Score (60) + XR Checklist Score (40)
```

All of it lives in one place: `GRADE_CONFIG` and `computeGrade()` in
[`shared/xr-metrics/index.js`](../shared/xr-metrics/index.js), imported by both
the server and the browser so the two can never disagree.

## 1. Performance — 60 marks

Four metrics, **15 marks each**. Marks come straight from the existing
PASS/WARN/FAIL judgement functions — there are no separate scoring thresholds.

| Metric | PASS | WARN | FAIL |
|---|---|---|---|
| Average FPS | 15 | 10 | 0 |
| Bad Frames % | 15 | 10 | 0 |
| Average Frame Time | 15 | 10 | 0 |
| Memory | 15 | 10 | 0 |

The judgement thresholds themselves are unchanged:

| Metric | PASS | WARN | FAIL |
|---|---|---|---|
| Average FPS | ≥ 97% of target | ≥ 85% | below |
| Bad Frames | ≤ 1% | ≤ 5% | above |
| Frame Time | ≤ 1.03× budget | ≤ 1.18× | above |
| Memory | ≤ 70% of cap | ≤ cap | above (AR 1500 MB, VR 2800 MB) |

A metric with no data at all scores 0 for that metric.

## 2. XR Checklist — 40 marks

The eight checklist items, **5 marks each**:

| Result | Marks |
|---|---|
| Pass | 5 |
| Warn | 3 |
| Fail | 0 |
| Not assessed | 0 |

Checklist results belong to the **individual test session**, so assessing Test 2
never changes Test 1's score.

## 3. Not scored

**Minimum FPS** and **1% Low FPS** are no longer part of the score and are no
longer shown as performance cards or in the session tables. A single abnormal
frame — a shader compile, a GC spike, an Editor stall — must not
disproportionately decide a student's result; Bad Frames already measures
stutter across the whole session in a fair, proportional way.

They are **still produced by `XRTestProfiler.cs`, still present in the JSON
contract, and still stored in the database** for backward compatibility and
future analysis. Nothing about the profiler or the import path changed.

Also collected and displayed, but contributing nothing to the score:

- **Draw Calls**
- **Triangles**
- **Battery**
- **Defects / bugs** — tracked, filtered and reported as QA information, but
  they never subtract marks. A project can score 88/100 with two critical
  defects open; the defects are shown separately.

## 4. Grade

| Score | Grade |
|---|---|
| 90–100 | **A** |
| 80–89 | **B** |
| 70–79 | **C** |
| 60–69 | **D** |
| 0–59 | **F** |

## 5. Overall status

| Score | Status |
|---|---|
| 70–100 | PASS |
| 60–69 | WARN |
| 0–59 | FAIL |

The per-metric PASS/WARN/FAIL pills on the report are unchanged — they still
reflect each metric's own judgement.

## 6. Invalid capture

A report with `totalFrames <= 0` recorded no frames. It is stored as evidence a
test was attempted, but:

```
Score  = N/A
Grade  = N/A
Status = INVALID CAPTURE
```

A broken capture is never treated as a student failure.

## 7. Worked example

Metric judgements: Average FPS **PASS**, Bad Frames **WARN**,
Frame Time **PASS**, Memory **PASS**.

```
Performance = 15 + 10 + 15 + 15 = 55 / 60
```

Checklist: 6 Pass, 1 Warn, 1 Fail.

```
Checklist   = (6 × 5) + (1 × 3) + (1 × 0) = 33 / 40
```

```
Final       = 55 + 33 = 88 / 100  →  Grade B  →  Status PASS
```

If that project also has **2 critical defects**, the score is still **88/100**.

## 8. Changing the weighting

Edit `GRADE_CONFIG` in
[`shared/xr-metrics/index.js`](../shared/xr-metrics/index.js) — nothing else
needs to change:

```js
export const GRADE_CONFIG = {
  performance: { pass: 15, warn: 10, fail: 0, neutral: 0 },
  checklist:   { pass: 5,  warn: 3,  fail: 0 },
  maxPerformance: 60,
  maxChecklist: 40,
  scale: [ {grade:'A',min:90}, {grade:'B',min:80}, {grade:'C',min:70},
           {grade:'D',min:60}, {grade:'F',min:0} ],
  statusScale: [ {status:'pass',min:70}, {status:'warn',min:60}, {status:'fail',min:0} ],
};
```
