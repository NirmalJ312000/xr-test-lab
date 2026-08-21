/**
 * Configuration. Deliberately tiny — this is a localhost-only application with
 * no secrets, no database credentials and no deployment environments.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const paths = {
  root,
  webDir: resolve(root, 'web'),
  sharedDir: resolve(root, 'shared'),
  dataDir: resolve(root, 'data'),
  reportsDir: resolve(root, 'data/reports'),
  dbFile: process.env.XRLAB_DB ?? resolve(root, 'data/xr-test-lab.db'),
  schemaFile: resolve(root, 'server/src/db/schema.sql'),
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // Reports are a few KB each; 25mb comfortably covers a bulk multi-file import.
  jsonBodyLimit: process.env.JSON_BODY_LIMIT ?? '25mb',
  version: '1.0.0',
};

export default config;
