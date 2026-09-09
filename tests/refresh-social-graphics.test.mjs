import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot, socialCardModel } from '../scripts/refresh-social-graphics.mjs';

test('snapshot fetch retries transient errors and preserves validation', async () => {
  let calls = 0;
  const snapshot = { games: [], venues: [], watchParties: [] };
  const result = await fetchSnapshot('https://example.invalid', (value) => value, {
    attempts: 2,
    retryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503 };
      return { ok: true, json: async () => snapshot };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result, snapshot);
});

test('snapshot fetch does not retry permanent client errors', async () => {
  let calls = 0;
  await assert.rejects(() => fetchSnapshot('https://example.invalid', (value) => value, {
    attempts: 3,
    retryDelaysMs: [0, 0],
    fetchImpl: async () => { calls += 1; return { ok: false, status: 404 }; }
  }), /HTTP 404/);
  assert.equal(calls, 1);
});

test('automation contract keeps the current renderer version explicit', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../scripts/refresh-social-graphics.mjs', import.meta.url), 'utf8'));
  assert.match(source, /RENDERER_VERSION = 8/);
  assert.match(source, /does not match automation renderer version/);
});

test('social image URL changes when public counts change', () => {
  const runtime = {
    siteOrigin: 'https://calgoldenbars.com',
    config: {
      identity: { schoolShortName: 'Cal', productName: 'Cal Golden Bars' },
      brand: { assets: { socialCardsDirectory: 'assets/social-cards' } },
      copy: { findCrowd: 'Find your Cal crowd' }
    },
    core: {
      gameRouteParam: () => 'ucla',
      gameTitle: () => 'vs. UCLA'
    }
  };
  const game = { game_id: 'g1' };
  const first = socialCardModel({ venues: [{}], watchParties: [] }, game, runtime);
  const second = socialCardModel({ venues: [{}, {}], watchParties: [] }, game, runtime);
  assert.match(first.imagePath, /^assets\/social-cards\/ucla-[a-f0-9]{10}\.png$/);
  assert.notEqual(first.imagePath, second.imagePath);
  assert.equal(first.imageUrl, `https://calgoldenbars.com/${first.imagePath}`);
});
