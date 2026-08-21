/**
 * Single-session PDF report.
 *
 * Uses jsPDF, already vendored locally at /vendor/jspdf.umd.min.js, so this
 * works entirely offline. Charts are re-rendered on a detached canvas with a
 * light palette — the dashboard's dark theme would be unreadable on paper.
 */
import { GRADE_CONFIG } from '../shared/xr-metrics/index.js';

const CHECK_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const BUG_STATUS_LABEL = {
  open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed',
};

// Print palette: darker shades that read well on white.
const C = {
  text: [24, 28, 42], gray: [92, 100, 122], line: [208, 213, 228], soft: [246, 247, 252],
  pass: [26, 127, 55], warn: [154, 103, 0], fail: [180, 35, 24],
  neutral: [92, 100, 122],
  accent: [59, 100, 214],   // electric blue, darkened for print
  indigo: [92, 78, 208],
  violet: [126, 88, 200],
};
const statusColor = (j) => ({ pass: C.pass, warn: C.warn, fail: C.fail }[j] ?? C.neutral);

export function reportFilename(session) {
  const slug = (s) =>
    (s || 'unknown')
      .toString()
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'unknown';
  const date = new Date(session.capturedAt);
  const stamp = Number.isNaN(date.getTime())
    ? 'unknown_date'
    : date.toISOString().slice(0, 10);
  return `XR_Test_Report_${slug(session.projectName)}_${slug(session.studentName)}_${stamp}.pdf`;
}

/**
 * Renders one chart offscreen with a light theme and returns a PNG data URL.
 * Returns null when there is no series or Chart.js is unavailable.
 */
function chartImage({ series, label, valueKey, colour, targetValue, targetLabel, yTitle }) {
  if (!series?.length || typeof Chart === 'undefined') return null;

  const cv = document.createElement('canvas');
  cv.width = 1100;
  cv.height = 300;

  const whiteBg = {
    id: 'whiteBg',
    beforeDraw(c) {
      const x = c.ctx;
      x.save();
      x.globalCompositeOperation = 'destination-over';
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
      x.restore();
    },
  };

  const datasets = [
    {
      label,
      data: series.map((p) => p[valueKey]),
      borderColor: colour,
      backgroundColor: `${colour}14`,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      fill: true,
    },
  ];
  if (targetValue != null) {
    datasets.push({
      label: targetLabel,
      data: series.map(() => targetValue),
      borderColor: '#1a7f37',
      borderWidth: 1,
      borderDash: [3, 3],
      pointRadius: 0,
    });
  }

  const chart = new Chart(cv, {
    type: 'line',
    data: { labels: series.map((p) => (+p.t).toFixed(1)), datasets },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 2,
      plugins: { legend: { labels: { color: '#24292f', font: { size: 13 }, boxWidth: 14 } } },
      scales: {
        x: {
          ticks: { color: '#57606a', maxTicksLimit: 12 },
          grid: { color: '#e6eaef' },
          title: { display: true, text: 'seconds', color: '#57606a', font: { size: 12 } },
        },
        y: {
          min: 0,
          ticks: { color: '#57606a' },
          grid: { color: '#e6eaef' },
          title: { display: true, text: yTitle, color: '#57606a', font: { size: 12 } },
        },
      },
    },
    plugins: [whiteBg],
  });

  let url = null;
  try {
    url = chart.toBase64Image('image/jpeg', 0.92);
  } catch {
    url = null;
  }
  chart.destroy();
  return url;
}

/**
 * Builds and downloads the PDF for one session.
 * @param {object} s     the session as returned by GET /api/sessions/:id
 * @param {object|null} g the computed grade (null for an invalid capture)
 */
export function downloadSessionPdf(s, g) {
  const { jsPDF } = window.jspdf ?? {};
  if (!jsPDF) throw new Error('The PDF library is not loaded.');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const W = 595;
  const H = 842;
  const CW = W - 2 * M;
  const invalid = s.captureStatus === 'invalid';

  let y = M;
  let page = 1;

  const footer = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.gray);
    doc.text(`Generated ${new Date().toLocaleString()}  ·  XR Test Lab`, M, H - 22);
    doc.text(`Page ${page}`, W - M, H - 22, { align: 'right' });
  };

  /** Starts a new page when `needed` points will not fit. */
  const room = (needed) => {
    if (y + needed <= H - 46) return;
    footer();
    doc.addPage();
    page += 1;
    y = M;
  };

  const heading = (text) => {
    room(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.text);
    doc.text(text, M, y);
    y += 6;
    doc.setDrawColor(...C.line);
    doc.line(M, y, W - M, y);
    y += 14;
  };

  /* ------------------------------------------------------------ header -- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...C.text);
  doc.text('XR Test Lab', M, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.gray);
  doc.text('Performance Report', M, y + 19);

  // Grade badge, top-right.
  if (g) {
    const bw = 62;
    const bh = 44;
    const bx = W - M - bw;
    const by = y - 8;
    doc.setFillColor(...statusColor(g.status));
    doc.roundedRect(bx, by, bw, bh, 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text(g.grade, bx + bw / 2, by + bh / 2 + 8, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text(`${g.score}/100`, bx + bw / 2, by + bh + 11, { align: 'center' });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.gray);
    doc.text('SCORE N/A', W - M, y + 8, { align: 'right' });
  }
  y += 46;

  doc.setDrawColor(...C.line);
  doc.line(M, y, W - M, y);
  y += 18;

  /* ------------------------------------------------------ identification */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...C.text);
  doc.text(doc.splitTextToSize(s.projectName ?? '—', CW), M, y);
  y += 18;

  const pairs = [
    ['Student', s.studentName ?? '—'],
    ['Student ID', s.studentCode ?? '—'],
    ['Test Date', new Date(s.capturedAt).toLocaleString()],
    ['Duration', `${Number(s.durationSec ?? 0).toFixed(1)} s`],
    ['Platform', s.platform ?? '—'],
    ['Target FPS', `${s.targetFps} Hz`],
    ['Device', s.device ?? '—'],
    ['GPU', s.gpu ?? '—'],
    ['OS', s.os ?? '—'],
  ];
  doc.setFontSize(9);
  const colW = CW / 3;
  pairs.forEach(([label, value], i) => {
    const x = M + (i % 3) * colW;
    const py = y + Math.floor(i / 3) * 26;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.gray);
    doc.text(label.toUpperCase(), x, py);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.text);
    doc.text(doc.splitTextToSize(String(value), colW - 8)[0] ?? '—', x, py + 12);
  });
  y += Math.ceil(pairs.length / 3) * 26 + 12;

  /* ------------------------------------------------------- performance -- */
  heading('Performance');

  if (invalid) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.gray);
    doc.text('INVALID CAPTURE', M, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      doc.splitTextToSize(
        'The profiler ran but recorded no frames, so this session carries no performance evidence. Score and grade are N/A — this is not a student failure.',
        CW,
      ),
      M,
      y,
    );
    y += 30;
  } else {
    const dropPct = s.totalFrames > 0 ? (s.droppedFrames / s.totalFrames) * 100 : null;
    const m = g?.metrics ?? {};
    const marks = g?.metricMarks ?? {};
    const cells = [
      ['Average FPS', Number(s.avgFps).toFixed(1), m.avgFps, marks.avgFps],
      ['Bad Frames %', dropPct == null ? '—' : `${dropPct.toFixed(1)} %`, m.badFrames, marks.badFrames],
      ['Avg Frame Time', `${Number(s.avgFrameMs).toFixed(2)} ms`, m.frameTime, marks.frameTime],
      ['Memory', s.memoryMB > 0 ? `${Number(s.memoryMB).toFixed(0)} MB` : '—', m.memory, marks.memory],
    ];

    const cols = 4;
    const gap = 10;
    const cw = (CW - gap * (cols - 1)) / cols;
    const ch = 62;
    cells.forEach((c, i) => {
      const x = M + i * (cw + gap);
      doc.setDrawColor(...C.line);
      doc.setFillColor(...C.soft);
      doc.roundedRect(x, y, cw, ch, 5, 5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.gray);
      doc.text(c[0].toUpperCase(), x + 8, y + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...C.text);
      doc.text(String(c[1]), x + 8, y + 34);
      doc.setFontSize(7.5);
      doc.setTextColor(...statusColor(c[2]));
      doc.text(
        `${(CHECK_LABEL[c[2]] ?? '—')}${c[3] != null ? `   ${c[3]}/${GRADE_CONFIG.performance.pass}` : ''}`,
        x + 8,
        y + 50,
      );
    });
    y += ch + 16;

    // Score summary strip
    if (g) {
      room(46);
      doc.setDrawColor(...C.line);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M, y, CW, 40, 5, 5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.gray);
      doc.text('FINAL SCORE', M + 12, y + 15);
      doc.text('GRADE', M + 160, y + 15);
      doc.text('OVERALL STATUS', M + 250, y + 15);
      doc.text('BREAKDOWN', M + 380, y + 15);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...C.text);
      doc.text(`${g.score} / 100`, M + 12, y + 31);
      doc.text(g.grade, M + 160, y + 31);
      doc.setTextColor(...statusColor(g.status));
      doc.text(CHECK_LABEL[g.status] ?? '—', M + 250, y + 31);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.gray);
      doc.text(
        `Performance ${g.performanceScore}/${GRADE_CONFIG.maxPerformance}   ·   Checklist ${g.checklistScore}/${GRADE_CONFIG.maxChecklist}`,
        M + 380,
        y + 31,
      );
      y += 52;
    }
  }

  /* ------------------------------------------------------------ charts -- */
  if (!invalid && s.series?.length) {
    const charts = [
      chartImage({ series: s.series, label: 'FPS', valueKey: 'fps', colour: '#3B64D6', targetValue: s.targetFps, targetLabel: 'Target', yTitle: 'FPS' }),
      chartImage({ series: s.series, label: 'Frame time (ms)', valueKey: 'frameMs', colour: '#5C4ED0', targetValue: 1000 / s.targetFps, targetLabel: 'Budget', yTitle: 'ms' }),
      chartImage({ series: s.series, label: 'Memory (MB)', valueKey: 'memMB', colour: '#7E58C8', yTitle: 'MB' }),
    ];
    const titles = ['Frame Rate Over Time', 'Frame Time Over Time', 'Memory Over Time'];

    charts.forEach((img, i) => {
      if (!img) return;
      const ih = 132;
      room(ih + 34);
      heading(titles[i]);
      doc.addImage(img, 'JPEG', M, y, CW, ih);
      y += ih + 16;
    });
  }

  /* --------------------------------------------------------- checklist -- */
  heading('XR Checklist');
  const items = s.checklistItems ?? [];
  items.forEach((c) => {
    const value = s.checklist?.[c.id];
    const note = s.checklistNotes?.[c.id];
    const lines = doc.splitTextToSize(c.t, CW - 130);
    const noteLines = note ? doc.splitTextToSize(`Note: ${note}`, CW - 130) : [];
    room(lines.length * 11 + noteLines.length * 10 + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    doc.text(lines, M, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...statusColor(value ?? 'neutral'));
    doc.text(value ? CHECK_LABEL[value] : 'NOT ASSESSED', W - M, y, { align: 'right' });

    y += lines.length * 11;
    if (noteLines.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...C.gray);
      doc.text(noteLines, M + 10, y);
      y += noteLines.length * 10;
    }
    y += 4;
    doc.setDrawColor(238, 241, 245);
    doc.line(M, y - 2, W - M, y - 2);
  });
  y += 10;

  /* -------------------------------------------------------------- bugs -- */
  const bugs = s.bugs ?? [];
  heading(`Defects (${bugs.length})`);
  if (!bugs.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.gray);
    doc.text('No defects logged for this application.', M, y);
    y += 16;
  } else {
    bugs.forEach((b) => {
      const titleLines = doc.splitTextToSize(b.title ?? '', CW - 150);
      const descLines = b.description ? doc.splitTextToSize(b.description, CW - 20) : [];
      const resLines = b.resolutionNote ? doc.splitTextToSize(`Resolution: ${b.resolutionNote}`, CW - 20) : [];
      room(titleLines.length * 11 + descLines.length * 10 + resLines.length * 10 + 16);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.text);
      doc.text(titleLines, M, y);

      doc.setFontSize(8);
      doc.setTextColor(...(b.severity === 'critical' ? C.fail : b.severity === 'high' ? C.warn : C.neutral));
      doc.text(
        `${SEVERITY_LABEL[b.severity] ?? b.severity}  ·  ${BUG_STATUS_LABEL[b.status] ?? b.status}`,
        W - M,
        y,
        { align: 'right' },
      );
      y += titleLines.length * 11;

      if (descLines.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...C.gray);
        doc.text(descLines, M, y);
        y += descLines.length * 10;
      }
      if (resLines.length) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor(...C.pass);
        doc.text(resLines, M, y);
        y += resLines.length * 10;
      }
      y += 8;
      doc.setDrawColor(238, 241, 245);
      doc.line(M, y - 4, W - M, y - 4);
    });
  }

  footer();
  doc.save(reportFilename(s));
}
