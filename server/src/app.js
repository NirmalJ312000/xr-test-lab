/**
 * Express application. Serves the dashboard AND the API from a single origin,
 * so http://localhost:3000 is the whole product.
 */
import express from 'express';
import config, { paths } from './config.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use('/api', apiRoutes);

  // The shared metrics module is imported by the browser as an ES module, so it
  // must be reachable over HTTP as well as from Node.
  app.use('/shared', express.static(paths.sharedDir, { extensions: ['js'] }));
  app.use(express.static(paths.webDir));

  // Unknown /api paths must be JSON; anything else falls back to the dashboard
  // so client-side routes survive a refresh.
  app.use('/api', notFoundHandler);
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(`${paths.webDir}/index.html`));

  app.use(errorHandler);
  return app;
}

export default createApp;
