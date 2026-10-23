import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathIsAllowed, assertIndexDiffIsControlled, statusPaths, changedPublicPaths } from '../scripts/validate-public-diff.mjs';

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


test('new generated venue directories are validated as individual files, never allowed as whole folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'cgb-public-diff-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const newRoute = join(root, 'locations', 'la-victoria-cocina-mexicana-santa-ana');
    mkdirSync(newRoute, { recursive: true });
    writeFileSync(join(newRoute, 'index.html'), '<!doctype html><title>Venue</title>');
    writeFileSync(join(newRoute, 'unexpected.txt'), 'not a generated venue file');

    const changed = changedPublicPaths(root);
    assert.deepEqual(changed.sort(), [
      'locations/la-victoria-cocina-mexicana-santa-ana/index.html',
      'locations/la-victoria-cocina-mexicana-santa-ana/unexpected.txt'
    ]);
    assert.equal(changed.filter((path) => !pathIsAllowed(path)).length, 1);
    assert.equal(pathIsAllowed(changed[0]), true);
    assert.equal(pathIsAllowed(changed[1]), false);
    assert.equal(pathIsAllowed('locations/la-victoria-cocina-mexicana-santa-ana/'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
