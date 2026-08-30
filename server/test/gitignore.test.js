import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

function isIgnored(relativePath) {
  try {
    execFileSync('git', ['check-ignore', relativePath], { cwd: repoRoot, stdio: 'pipe' });
    return true; // exit code 0 -- path is ignored
  } catch (err) {
    if (err.status === 1) return false; // exit code 1 -- path is NOT ignored
    throw err; // any other exit code is a real error (e.g. not a git repo)
  }
}

describe('.env.amazon.local is ignored by git', () => {
  test('server/.env.amazon.local would never be committed', () => {
    assert.equal(isIgnored('server/.env.amazon.local'), true);
  });

  test('a bare .env.amazon.local at the repo root would also never be committed', () => {
    assert.equal(isIgnored('.env.amazon.local'), true);
  });

  test('the example/template env file is NOT ignored (it has no real secrets and should stay committed)', () => {
    assert.equal(isIgnored('server/.env.amazon.local.example'), false);
  });
});
