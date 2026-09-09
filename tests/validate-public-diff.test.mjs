import test from 'node:test';
import assert from 'node:assert/strict';
import { pathIsAllowed, assertIndexDiffIsControlled } from '../scripts/validate-public-diff.mjs';

test('public social refresh allowlist is intentionally narrow', () => {
  assert.equal(pathIsAllowed('index.html'), true);
  assert.equal(pathIsAllowed('assets/social-cards/manifest.json'), true);
  assert.equal(pathIsAllowed('assets/social-cards/ucla.png'), true);
  assert.equal(pathIsAllowed('share/ucla/index.html'), true);
  assert.equal(pathIsAllowed('js/app.mjs'), false);
  assert.equal(pathIsAllowed('css/design-system.css'), false);
  assert.equal(pathIsAllowed('.github/workflows/x.yml'), false);
  assert.equal(pathIsAllowed('share/ucla/extra.txt'), false);
});

test('index validator allows only generated metadata and loading-cover references', () => {
  const before = '<head>\n<!-- CGB current-game social metadata: start -->old<!-- CGB current-game social metadata: end -->\n<link id="cgb-loading-cover-preload" href="assets/social-cards/a.png">\n</head><body><img id="map-fallback-card" src="assets/social-cards/a.png"><main>same</main></body>';
  const after = '<head>\n<!-- CGB current-game social metadata: start -->new<!-- CGB current-game social metadata: end -->\n<link id="cgb-loading-cover-preload" href="assets/social-cards/b.png">\n</head><body><img id="map-fallback-card" src="assets/social-cards/b.png"><main>same</main></body>';
  assert.doesNotThrow(() => assertIndexDiffIsControlled(before, after));
  assert.throws(() => assertIndexDiffIsControlled(before, after.replace('<main>same</main>', '<main>changed</main>')), /outside/);
});
