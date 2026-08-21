# XR Test Lab

A self-contained **localhost** XR QA dashboard for university VR/AR projects.

Students capture performance data from their Unity projects with
`XRTestProfiler.cs`; the Project Guide imports the resulting JSON reports and
reviews, judges and grades them — all on one PC, with no accounts, no cloud and
no internet connection required.

```
Unity student project
  └─ XRTestProfiler.cs ──▶ xrtest_*.json
                              │
                    Import in the dashboard
                              ▼
        Express API ──▶ SQLite (data/xr-test-lab.db)
                   └──▶ original JSON (data/reports/)
                              ▲
                     http://localhost:3000
```

## Quick start

```bash
npm install
```

```bash
npm start
```

Then open **<http://localhost:3000>**.

That is the whole application. There is no login, no admin panel and no separate
database to install — the SQLite file and the `data/` folders are created
automatically on first run.

## What you get

| Page | Purpose |
|---|---|
| **Dashboard** | Totals, PASS/WARN/FAIL/INVALID summary, recent test sessions, and every application at a glance |
| **Applications** | Search, filter by platform and status, sort, create, edit, archive, delete |
| **Application detail** | Students, latest result, full test history (nothing is ever overwritten), trend charts, defects |
| **Students** | Search, filter by application, create, edit, archive |
| **Student detail** | Their applications, sessions grouped per application, performance history |
| **Test Sessions** | Every imported report, filterable by application, platform, result and date |
| **Performance Report** | Overall verdict + grade, 9 metric cards, FPS / frame-time / memory charts, XR checklist, defects, raw JSON |
| **Defects** | Search, filter by severity, status and application, sort, create, edit, resolve, delete |
| **Data** | Storage locations, record counts, storage size, and a one-click portable backup |
| **Import Report** | Drag-and-drop one or many files; valid / duplicate / invalid preview with plain-English reasons before anything is saved |

Defect severity is **Critical / High / Medium / Low**; status is **Open / In Progress /
Resolved / Closed**. Defects are tracked as QA information and do not change the
numeric score.

## Where your data lives

| Path | Contents |
|---|---|
| `data/xr-test-lab.db` | SQLite database — the permanent source of truth |
| `data/reports/*.json` | The original uploaded report, byte-for-byte, one file per session |

Data survives closing the browser, restarting the server, restarting the PC and
clearing browser storage. `localStorage` is **not** used as a database — the
first time you open the app it offers a one-time import of any data left by the
older localStorage-based version, and never deletes it.

To back up or move the whole system, copy the `data/` folder — or use **Data →
Export All Data**, which downloads a single portable JSON bundle containing every
application, student, session, sample, checklist result, defect and original
profiler report.

## Deletion policy

Nothing is ever deleted silently — every destructive action states exactly what
it will remove.

| Action | Behaviour |
|---|---|
| Remove a **project** or **student** | **Archive** by default — hidden from active lists, all history stays viewable. Permanent delete is a separate, explicit choice |
| Permanent delete | Removes the record, its test sessions, performance samples, checklist results, bugs **and** the original JSON files from `data/reports/` |
| Delete a **test report** | Always permanent: database rows, samples, checklist results and the original JSON file |

A startup check also prunes any report file left behind by an interrupted
delete, so `data/reports/` can never accumulate files the dashboard cannot see.

## Input contract

`XRTestProfiler.cs` is unchanged. The importer accepts `schema` =
`"xr-test-profile-v1"` and reads every field the profiler emits, including
`series[]`. Unknown schema versions are rejected with a clear message rather
than guessed at.

Sentinels are preserved in meaning: `drawCalls`, `triangles` and `batteryLevel`
of `-1` mean "unavailable" and display as `—`. A report with `totalFrames <= 0`
is stored as an **INVALID CAPTURE** — it is evidence a test was attempted, and
is deliberately left ungraded rather than scored 0.

Duplicate imports are detected by SHA-256 of the file contents, both against
already-stored sessions and within a single multi-file selection.

## Grading

Thresholds and weights are unchanged from the original dashboard and live in one
place: `shared/xr-metrics/index.js`, imported by **both** the server and the
browser so they can never disagree. See [docs/GRADING.md](docs/GRADING.md).

| Scored metric | PASS | WARN | FAIL |
|---|---|---|---|
| Average FPS | ≥ 97% of target | ≥ 85% | below |
| Bad frames | ≤ 1% | ≤ 5% | above |
| Frame time | ≤ 1.03× budget | ≤ 1.18× | above |
| Memory | ≤ 70% of cap | ≤ cap | above (AR 1500 MB, VR 2800 MB) |

**Score = Performance (60) + XR Checklist (40) = 100.**

Performance is those four metrics, worth 15 marks each: PASS 15 / WARN 10 /
FAIL 0. The checklist is eight items worth 5 marks each: Pass 5 / Warn 3 /
Fail 0.

Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F. Status: PASS ≥ 70, WARN ≥ 60,
else FAIL.

**Minimum FPS, 1% Low FPS, Draw Calls, Triangles, Battery and defects do not
affect the score** — one abnormal frame should not decide a student's result.
Minimum FPS and 1% Low FPS are still produced by the profiler, still part of the
JSON contract and still stored, but are no longer shown as scored performance
cards. An invalid capture (`totalFrames <= 0`) scores N/A, not zero.

## Offline

After `npm install`, the app needs no internet. Chart.js and jsPDF are copied
out of `node_modules` into `web/vendor/` automatically and served locally — no
CDN is contacted at any point.

## Layout

```
xr-test-lab/
├─ unity/XRTestProfiler.cs     Drop into a student Unity project
├─ web/                        Dashboard (vanilla ES modules, no build step)
├─ server/src/                 Express API + SQLite
│  ├─ db/                      schema.sql, connection
│  ├─ routes/                  projects, students, sessions, bugs, reports, dashboard
│  ├─ services/                identity resolution, grading, deletion
│  └─ ingest/                  validation + import pipeline
├─ shared/xr-metrics/          Judgement + grading (used by server AND browser)
├─ data/                       SQLite database + original reports  (gitignored)
└─ docs/
```

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Run the app on port 3000 |
| `npm run dev` | Same, with file watching |
| `npm test` | Full API + integrity test suite (uses a temporary database) |

Set `PORT` to use a different port. Tests never touch `data/` — they run against
a throwaway database in the system temp directory.

## Requirements

Node.js 22.5+ (SQLite is built into Node — there is nothing else to install).
