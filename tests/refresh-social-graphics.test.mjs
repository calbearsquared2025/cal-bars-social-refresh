import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot, publicFallbackContentsDiffer, publicFallbackSnapshot, socialCardModel, updateRootSocialPreview } from '../scripts/refresh-social-graphics.mjs';

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

test('snapshot fetch retries request timeouts', async () => {
  let calls = 0;
  const snapshot = { games: [], venues: [], watchParties: [] };
  const result = await fetchSnapshot('https://example.invalid', (value) => value, {
    attempts: 2,
    retryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true, json: async () => snapshot };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result, snapshot);
});

test('snapshot fetch retries transient Apps Script 404s', async () => {
  let calls = 0;
  const snapshot = { games: [], venues: [], watchParties: [] };
  const result = await fetchSnapshot('https://script.google.com/macros/s/test/exec', (value) => value, {
    attempts: 2,
    retryDelaysMs: [0],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 404 };
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

test('root preview publishes an early-selection schedule without rewriting the visible cover', () => {
  const runtime = {
    siteOrigin: 'https://calgoldenbars.com',
    config: {
      identity: { productName: 'Cal Golden Bars' },
      copy: { findCrowd: 'Find your Cal crowd' },
      brand: { assets: { loadingFallback: 'assets/cgb-loading-fallback.svg' } },
      schedule: { homeTimeZone: 'America/Los_Angeles' }
    }
  };
  const manifest = {
    default_game_slug: 'unlv',
    games: [{ game_id: 'game_unlv', slug: 'unlv', title: 'Cal at UNLV',
      locations_mapped: 45, watch_parties: 10,
      image: 'assets/social-cards/unlv-50d9a6c596.png' }]
  };
  const snapshot = { games: [{ game_id: 'game_unlv', game_date: '2026-10-11',
    game_status: 'upcoming', schedule_order: 7 }] };
  const html = '<head>\n<!-- CGB current-game social metadata: start -->old<!-- CGB current-game social metadata: end -->\n' +
    '<!-- CGB loading-cover data: start -->\n' +
    '<script type="application/json" id="cgb-loading-cover-data">{"games":[]}</script>\n' +
    '<!-- CGB loading-cover data: end -->\n' +
    '<link id="cgb-loading-cover-preload" rel="preload" as="image">\n</head><body>' +
    '<img id="map-fallback-card" alt=""><main>same</main></body>';
  const updated = updateRootSocialPreview(html, manifest, runtime, snapshot);
  assert.match(updated, /<meta property="og:title" content="Cal Golden Bars · Cal at UNLV">/);
  const data = JSON.parse(updated.match(/id="cgb-loading-cover-data">([^<]*)<\/script>/)[1]);
  assert.equal(data.timeZone, 'America/Los_Angeles');
  assert.deepEqual(data.games, [{
    id: 'game_unlv', slug: 'unlv', date: '2026-10-11',
    status: 'upcoming', order: 7,
    image: 'assets/social-cards/unlv-50d9a6c596.png'
  }]);
  assert.doesNotMatch(updated, /id="map-fallback-card"[^>]*src=/);
  assert.doesNotMatch(updated, /id="cgb-loading-cover-preload"[^>]*href=/);
  assert.match(updated, /<main>same<\/main>/);
});

test('automation contract keeps the current renderer version explicit', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../scripts/refresh-social-graphics.mjs', import.meta.url), 'utf8'));
  assert.match(source, /RENDERER_VERSION = 8/);
  assert.match(source, /SNAPSHOT_FETCH_TIMEOUT_MS = 30_000/);
  assert.match(source, /SNAPSHOT_FETCH_ATTEMPTS = 4/);
  assert.match(source, /SNAPSHOT_RETRY_DELAYS_MS = \[1_000, 2_500, 5_000\]/);
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


test('fallback refresh ignores generatedAt-only churn but detects public data changes', () => {
  const base = {
    schemaVersion: '2.0',
    venues: [{ venue_id: 'v1', name: 'One' }],
    games: [{ game_id: 'g1', opponent_name: 'UCLA', game_title: 'The Big Game' }],
    watchParties: [],
    fanCounts: [],
    venueHistoryCounts: [],
    venueSeasonCounts: [],
    fanExperiences: [],
    generatedAt: '2026-10-01T00:00:00Z'
  };
  const newerTimestamp = { ...base, generatedAt: '2026-10-01T12:00:00Z' };
  const changed = { ...newerTimestamp, venues: [{ venue_id: 'v1', name: 'One' }, { venue_id: 'v2', name: 'Two' }] };
  assert.equal(publicFallbackContentsDiffer(base, newerTimestamp), false);
  assert.equal(publicFallbackContentsDiffer(base, changed), true);
});

test('fallback snapshot preserves public retired venue slug aliases', () => {
  const snapshot = {
    schemaVersion: '2.0',
    venues: [{ venue_id: 'v1', slug: 'current-route', slug_aliases: 'old-route' }],
    games: [],
    watchParties: [],
    fanCounts: [],
    venueHistoryCounts: [],
    venueSeasonCounts: [],
    fanExperiences: [],
    generatedAt: '2026-10-01T00:00:00Z'
  };
  assert.equal(publicFallbackSnapshot(snapshot).venues[0].slug_aliases, 'old-route');
});

test('fallback snapshot preserves public watch-party RSVP state', () => {
  const snapshot = {
    schemaVersion: '2.0',
    venues: [],
    games: [],
    watchParties: [{ watch_party_id: 'wp_1', rsvp_enabled: true }],
    fanCounts: [],
    venueHistoryCounts: [],
    venueSeasonCounts: [],
    fanExperiences: [],
    generatedAt: '2026-10-01T00:00:00Z'
  };
  assert.equal(publicFallbackSnapshot(snapshot).watchParties[0].rsvp_enabled, true);
});

test('fallback snapshot rejects unexpected public fields', () => {
  const snapshot = {
    schemaVersion: '2.0',
    venues: [{ venue_id: 'v1', secret: 'nope' }],
    games: [],
    watchParties: [],
    fanCounts: [],
    venueHistoryCounts: [],
    venueSeasonCounts: [],
    fanExperiences: [],
    generatedAt: '2026-10-01T00:00:00Z'
  };
  assert.throws(() => publicFallbackSnapshot(snapshot), /unexpected public fields: secret/);
  const topLevel = { ...snapshot, venues: [], privateThing: 'nope' };
  assert.throws(() => publicFallbackSnapshot(topLevel), /snapshot contains unexpected public fields: privateThing/);
});
