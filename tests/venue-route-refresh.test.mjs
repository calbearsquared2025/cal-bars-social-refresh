import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { refreshVenueRoutes, venueRouteRecords } from '../scripts/refresh-venue-routes.mjs';
import { validateVenueArtifacts } from '../scripts/validate-public-diff.mjs';

function rootIndex() {
  return `<!doctype html>
<html><head>
<meta name="description" content="Root description">
<link rel="canonical" href="https://calgoldenbars.com/">
<meta property="og:title" content="Root">
<meta property="og:description" content="Root description">
<meta property="og:url" content="https://calgoldenbars.com/">
<title>Cal Golden Bars</title>
</head><body>App</body></html>
`;
}

function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://calgoldenbars.com/</loc>
  </url>
  <url>
    <loc>https://calgoldenbars.com/locations/la-note/</loc>
  </url>
</urlset>
`;
}

function runtime(root) {
  return {
    root,
    siteOrigin: 'https://calgoldenbars.com',
    config: { identity: { productName: 'Cal Golden Bars' } }
  };
}

test('venue refresh deletes retired routes and rebuilds canonical and alias pages from the snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cgb-venue-refresh-'));
  try {
    await mkdir(join(root, 'locations', 'la-note'), { recursive: true });
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'locations', 'la-note', 'index.html'), 'stale', 'utf8');
    await writeFile(join(root, 'index.html'), rootIndex(), 'utf8');
    await writeFile(join(root, 'sitemap.xml'), sitemap(), 'utf8');

    const snapshot = {
      venues: [{
        venue_id: 'venue_1',
        slug: 'new-place',
        slug_aliases: 'old-place',
        name: 'New Place',
        city: 'Berkeley',
        region: 'CA',
        short_description: ''
      }]
    };
    await writeFile(join(root, 'data', 'fallback-v2.json'), JSON.stringify(snapshot), 'utf8');

    const result = await refreshVenueRoutes(runtime(root), snapshot, rootIndex());
    assert.deepEqual(result, { routeCount: 2, canonicalCount: 1 });

    await assert.rejects(readFile(join(root, 'locations', 'la-note', 'index.html'), 'utf8'), /ENOENT/);
    const canonical = await readFile(join(root, 'locations', 'new-place', 'index.html'), 'utf8');
    const alias = await readFile(join(root, 'locations', 'old-place', 'index.html'), 'utf8');
    const updatedSitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');

    assert.match(canonical, /<title>New Place \| Cal Golden Bars<\/title>/);
    assert.match(canonical, /href="https:\/\/calgoldenbars\.com\/locations\/new-place\/"/);
    assert.match(canonical, /Find New Place in Berkeley, CA on Cal Golden Bars/);
    assert.doesNotMatch(canonical, /name="robots"/);
    assert.match(alias, /name="robots" content="noindex,follow"/);
    assert.match(alias, /href="https:\/\/calgoldenbars\.com\/locations\/new-place\/"/);
    assert.match(updatedSitemap, /locations\/new-place\//);
    assert.doesNotMatch(updatedSitemap, /locations\/old-place\//);
    assert.doesNotMatch(updatedSitemap, /locations\/la-note\//);

    await assert.doesNotReject(() => validateVenueArtifacts(root));
    await mkdir(join(root, 'locations', 'la-note'), { recursive: true });
    await writeFile(join(root, 'locations', 'la-note', 'index.html'), 'stale', 'utf8');
    await assert.rejects(() => validateVenueArtifacts(root), /generated venue route directories are out of sync/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('venue route generation rejects duplicate and unsafe slugs', () => {
  assert.throws(
    () => venueRouteRecords([
      { venue_id: 'v1', slug: 'one', slug_aliases: 'two' },
      { venue_id: 'v2', slug: 'two', slug_aliases: '' }
    ]),
    /Duplicate venue route/
  );
  assert.throws(
    () => venueRouteRecords([{ venue_id: 'v1', slug: '../escape', slug_aliases: '' }]),
    /unsafe venue route slug/
  );
});
