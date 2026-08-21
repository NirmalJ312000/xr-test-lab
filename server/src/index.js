/**
 * Entrypoint: initialise the local database, then serve the whole app.
 */
import fs from 'node:fs';
import config, { paths } from './config.js';
import { initDb, closeDb, getDb } from './db/index.js';
import { pruneOrphanReports } from './services/deletion.js';
import { regradeIfScoringChanged } from './services/grading.js';
import { createApp } from './app.js';

initDb();

// Scores are derived data: re-apply the current formula to anything graded
// under an older one.
try {
  const regraded = regradeIfScoringChanged();
  if (regraded) console.log(`[xr-test-lab] re-scored ${regraded} session(s) under the current formula`);
} catch (err) {
  console.warn('[xr-test-lab] re-scoring skipped:', err.message);
}

// A crash between "delete row" and "delete file" would otherwise leave a report
// on disk that nothing points at.
try {
  const pruned = pruneOrphanReports(fs, paths.reportsDir);
  if (pruned) console.log(`[xr-test-lab] pruned ${pruned} orphaned report file(s)`);
} catch (err) {
  console.warn('[xr-test-lab] orphan prune skipped:', err.message);
}

const sessions = getDb().prepare('SELECT COUNT(*) AS n FROM test_sessions').get().n;
const server = createApp().listen(config.port, () => {
  // ASCII only: Windows consoles frequently run a non-UTF-8 code page and
  // would render arrows and dashes as mojibake.
  console.log('');
  console.log('  XR Test Lab');
  console.log(`  ->  http://localhost:${config.port}`);
  console.log('');
  console.log(`  database : ${paths.dbFile}`);
  console.log(`  reports  : ${paths.reportsDir}`);
  console.log(`  sessions : ${sessions} stored`);
  console.log('');
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n[xr-test-lab] ${signal} — shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
