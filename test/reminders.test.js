import { TEST_DIR } from './helpers/setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const STEPS = fileURLToPath(new URL('./helpers/reminder-steps.js', import.meta.url));
const DB = join(TEST_DIR, 'reminders.db');

// In order, on one database: before-restart and after-restart are two processes, so
// that really is a restart in between.
for (const step of ['old-schema', 'deliver', 'units', 'long', 'before-restart', 'after-restart', 'failures']) {
  test(`reminders: ${step}`, () => {
    const run = spawnSync(process.execPath, ['--no-warnings', STEPS, step], {
      env: { ...process.env, GHOST_DB_PATH: DB },
      encoding: 'utf-8',
      timeout: 60000,
    });
    const output = `${run.stdout}${run.stderr}`;
    assert.ok(/PASS/.test(output), `nothing ran:\n${output}`);
    assert.equal(run.status, 0, output);
  });
}
