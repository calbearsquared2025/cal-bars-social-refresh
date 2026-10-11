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

test('index validator allows only generated social metadata and first-paint mapping', () => {
  const base = '<head>\n<!-- CGB current-game social metadata: start -->old<!-- CGB current-game social metadata: end -->\n' +
    '<!-- CGB loading-cover data: start -->\n' +
    '<script type="application/json" id="cgb-loading-cover-data">PAYLOAD</script>\n' +
    '<!-- CGB loading-cover data: end -->\n</head><body><main>same</main></body>';
  const map = (image) => JSON.stringify({ timeZone: 'America/Los_Angeles',
    fallbackImage: 'assets/cgb-loading-fallback.svg',
    games: [{ id: 'g', slug: 'unlv', date: '2026-10-11', status: 'upcoming',
      order: 7, image }] });
  const before = base.replace('PAYLOAD', map('assets/social-cards/unlv-50d9a6c596.png'));
  const after = base.replace('PAYLOAD', map('assets/social-cards/unlv-aabbccdd11.png'))
    .replace('start -->old', 'start -->new');
  assert.doesNotThrow(() => assertIndexDiffIsControlled(before, after));
  assert.throws(() => assertIndexDiffIsControlled(before, after.replace('unlv-aabbccdd11.png', '../private.png')), /fingerprinted/);
  assert.throws(() => assertIndexDiffIsControlled(before, after.replace('<main>same</main>', '<main>changed</main>')), /outside/);
  assert.throws(() => assertIndexDiffIsControlled(before, after.replace('"id":"g"', '"id":"g2"').replace('</head>', '</head><script>changed</script>')), /outside/);
});

test('porcelain parsing preserves paths for unstaged deletions and untracked files', () => {
  assert.deepEqual(
    statusPaths(' D assets/social-cards/old.png\n?? assets/social-cards/new.png\n'),
    ['assets/social-cards/old.png', 'assets/social-cards/new.png']
  );
});
