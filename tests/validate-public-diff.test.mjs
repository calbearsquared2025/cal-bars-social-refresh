import test from 'node:test';
import assert from 'node:assert/strict';
import { pathIsAllowed, assertIndexDiffIsControlled, statusPaths } from '../scripts/validate-public-diff.mjs';

test('public social refresh allowlist is intentionally narrow', () => {
  assert.equal(pathIsAllowed('index.html'), true);
  assert.equal(pathIsAllowed('assets/social-cards/manifest.json'), true);
  assert.equal(pathIsAllowed('data/fallback-v2.json'), true);
  assert.equal(pathIsAllowed('sitemap.xml'), true);
  assert.equal(pathIsAllowed('locations/new-place/index.html'), true);
  assert.equal(pathIsAllowed('assets/social-cards/ucla.png'), true);
  assert.equal(pathIsAllowed('share/ucla/index.html'), true);
  assert.equal(pathIsAllowed('js/app.mjs'), false);
  assert.equal(pathIsAllowed('data/other.json'), false);
  assert.equal(pathIsAllowed('css/design-system.css'), false);
  assert.equal(pathIsAllowed('.github/workflows/x.yml'), false);
  assert.equal(pathIsAllowed('share/ucla/extra.txt'), false);
  assert.equal(pathIsAllowed('locations/new-place/extra.txt'), false);
});

test('index validator allows only generated metadata and synchronized loading-cover references', () => {
  const before = '<head>\n<!-- CGB current-game social metadata: start -->old<!-- CGB current-game social metadata: end -->\n<link id="cgb-loading-cover-preload" href="assets/social-cards/clemson-523e8f106d.png">\n</head><body><img id="map-fallback-card" src="assets/social-cards/clemson-523e8f106d.png"><main>same</main></body>';
  const after = '<head>\n<!-- CGB current-game social metadata: start -->new<!-- CGB current-game social metadata: end -->\n<link id="cgb-loading-cover-preload" href="assets/social-cards/unlv-50d9a6c596.png">\n</head><body><img id="map-fallback-card" src="assets/social-cards/unlv-50d9a6c596.png"><main>same</main></body>';
  assert.doesNotThrow(() => assertIndexDiffIsControlled(before, after));
  assert.throws(
    () => assertIndexDiffIsControlled(before, after.replace('src="assets/social-cards/unlv-50d9a6c596.png"', 'src="assets/social-cards/clemson-523e8f106d.png"')),
    /stay synchronized/
  );
  assert.throws(
    () => assertIndexDiffIsControlled(before, after.replaceAll('unlv-50d9a6c596.png', 'unlv.png')),
    /fingerprinted/
  );
  assert.throws(() => assertIndexDiffIsControlled(before, after.replace('<main>same</main>', '<main>changed</main>')), /outside/);
});

test('porcelain parsing preserves paths for unstaged deletions and untracked files', () => {
  assert.deepEqual(
    statusPaths(' D assets/social-cards/old.png\n?? assets/social-cards/new.png\n'),
    ['assets/social-cards/old.png', 'assets/social-cards/new.png']
  );
});
