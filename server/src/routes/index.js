import { Router } from 'express';
import { getDb } from '../db/index.js';
import config, { paths } from '../config.js';
import { wrap } from '../lib/errors.js';
import projects from './projects.js';
import students from './students.js';
import sessions from './sessions.js';
import bugs from './bugs.js';
import dashboard from './dashboard.js';
import reports from './reports.js';
import migrate from './migrate.js';
import data from './data.js';
import { CHECKLIST } from '../../../shared/xr-metrics/index.js';

const router = Router();

router.get(
  '/health',
  wrap((req, res) => {
    let database = 'ok';
    try {
      getDb().prepare('SELECT 1').get();
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      dbFile: paths.dbFile,
      version: config.version,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }),
);

/** The eight QA items, so the frontend never hardcodes a second copy. */
router.get('/checklist-items', (req, res) => res.json({ items: CHECKLIST }));

router.use('/projects', projects);
router.use('/students', students);
router.use('/sessions', sessions);
router.use('/bugs', bugs);
router.use('/dashboard', dashboard);
router.use('/reports', reports);
router.use('/migrate', migrate);
router.use('/data', data);

export default router;
