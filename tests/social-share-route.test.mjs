import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const refreshScript = readFileSync(new URL('../scripts/refresh-social-graphics.mjs', import.meta.url), 'utf8');

test('social refresh share pages preserve venue context when returning to the app', () => {
  assert.match(refreshScript, /new URL\(\$\{JSON\.stringify\(appPath\)\}, window\.location\.href\)/);
  assert.match(refreshScript, /new URLSearchParams\(window\.location\.search\)\.get\('venue'\)/);
  assert.match(refreshScript, /destination\.searchParams\.set\('venue', venue\)/);
});
