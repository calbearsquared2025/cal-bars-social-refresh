import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { venueRouteRecords } from './refresh-venue-routes.mjs';

const SOCIAL_START_MARKER = '<!-- CGB current-game social metadata: start -->';
const SOCIAL_END_MARKER = '<!-- CGB current-game social metadata: end -->';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trimEnd();
}

export function pathIsAllowed(path) {
  return path === 'index.html' || path === 'sitemap.xml' || path === 'data/fallback-v2.json' || path === 'assets/social-cards/manifest.json' || /^assets\/social-cards\/[^/]+\.png$/.test(path) || /^share\/[^/]+\/index\.html$/.test(path) || /^locations\/[^/]+\/index\.html$/.test(path);
}

const COVER_START = '<!-- CGB loading-cover data: start -->';
const COVER_END = '<!-- CGB loading-cover data: end -->';
const COVER_DATA_PATTERN = new RegExp(COVER_START + '[\\s\\S]*?' + COVER_END);
const FINGERPRINTED_SOCIAL_IMAGE_PATTERN = /^assets\/social-cards\/[a-z0-9-]+-[a-f0-9]{10}\.png$/;

function loadingCoverData(html) {
  const block = html.match(COVER_DATA_PATTERN)?.[0];
  if (!block) throw new Error('index.html is missing generated first-paint loading-cover data.');
  const json = block.match(/<script type="application\/json" id="cgb-loading-cover-data">([^<]*)<\/script>/)?.[1];
  if (!json) throw new Error('index.html is missing safe loading-cover JSON.');
  const data = JSON.parse(json);
  if (!Array.isArray(data.games) || typeof data.timeZone !== 'string' ||
      typeof data.fallbackImage !== 'string') {
    throw new Error('Invalid generated first-paint loading-cover data.');
  }
  const seen = new Set();
  for (const game of data.games) {
    if (typeof game.slug !== 'string' || typeof game.date !== 'string' ||
        typeof game.id !== 'string' || seen.has(game.id) ||
        !['upcoming', 'completed', 'postponed', 'cancelled'].includes(game.status) ||
        !FINGERPRINTED_SOCIAL_IMAGE_PATTERN.test(game.image)) {
      throw new Error('Generated loading-cover entries must be public, unique, and fingerprinted.');
    }
    seen.add(game.id);
  }
  return data;
}

function normalizeControlledIndexRegions(html) {
  const social = new RegExp(SOCIAL_START_MARKER + '[\\s\\S]*?' + SOCIAL_END_MARKER);
  if (!social.test(html)) throw new Error('index.html is missing the generated social metadata markers.');
  loadingCoverData(html);
  return html
    .replace(social, SOCIAL_START_MARKER + '\n' + SOCIAL_END_MARKER)
    .replace(COVER_DATA_PATTERN, COVER_START + '\n' + COVER_END);
}

export function assertIndexDiffIsControlled(before, after) {
  loadingCoverData(after);
  if (normalizeControlledIndexRegions(before) !== normalizeControlledIndexRegions(after)) {
    throw new Error('index.html changed outside the generated social metadata and loading-cover data.');
  }
}

function sortedStrings(values) {
  return [...values].map(String).sort((a, b) => a.localeCompare(b));
}

function assertSameStrings(actual, expected, description) {
  const actualSorted = sortedStrings(actual);
  const expectedSorted = sortedStrings(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(`Refusing generated refresh because ${description} are out of sync. Expected [${expectedSorted.join(', ')}]; found [${actualSorted.join(', ')}].`);
  }
}

function rootSiteOrigin(indexHtml) {
  const canonicalTag = indexHtml.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0] || '';
  const href = canonicalTag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
  if (!href) throw new Error('Could not resolve the root canonical URL while validating venue routes.');
  return new URL(href).origin;
}

export async function validateVenueArtifacts(siteRoot) {
  const root = resolve(siteRoot);
  const [fallbackText, indexHtml, sitemap, locationEntries] = await Promise.all([
    readFile(join(root, 'data', 'fallback-v2.json'), 'utf8'),
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'sitemap.xml'), 'utf8'),
    readdir(join(root, 'locations'), { withFileTypes: true })
  ]);
  const fallback = JSON.parse(fallbackText);
  const routes = venueRouteRecords(fallback.venues || []);
  const expectedRouteSlugs = routes.map((route) => route.slug);
  const nonDirectories = locationEntries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  if (nonDirectories.length) {
    throw new Error(`Refusing generated refresh because locations contains non-route files: ${nonDirectories.join(', ')}`);
  }
  const actualRouteSlugs = locationEntries.map((entry) => entry.name);
  assertSameStrings(actualRouteSlugs, expectedRouteSlugs, 'generated venue route directories');

  for (const slug of actualRouteSlugs) {
    const routeFiles = await readdir(join(root, 'locations', slug));
    assertSameStrings(routeFiles, ['index.html'], `files for venue route ${slug}`);
  }

  const siteOrigin = rootSiteOrigin(indexHtml);
  const locationPrefix = `${siteOrigin}/locations/`;
  const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith(locationPrefix));
  const expectedSitemapLocations = (fallback.venues || []).map((venue) => (
    new URL('locations/' + encodeURIComponent(venue.slug) + '/', siteOrigin + '/').href
  ));
  assertSameStrings(sitemapLocations, expectedSitemapLocations, 'canonical venue sitemap entries');
  return { routeCount: expectedRouteSlugs.length, canonicalCount: expectedSitemapLocations.length };
}

export function statusPaths(porcelain) {
  return String(porcelain || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

export async function validatePublicDiff(siteRoot) {
  const root = resolve(siteRoot);
  const changed = statusPaths(git(root, ['status', '--porcelain=v1']));
  const disallowed = changed.filter((path) => !pathIsAllowed(path));
  if (disallowed.length) throw new Error(`Refusing generated refresh because disallowed public files changed: ${disallowed.join(', ')}`);
  if (changed.includes('index.html')) {
    const before = git(root, ['show', 'HEAD:index.html']);
    const after = await readFile(join(root, 'index.html'), 'utf8');
    assertIndexDiffIsControlled(`${before}\n`, after);
  }
  await validateVenueArtifacts(root);
  return changed;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const siteRoot = process.argv[2];
  if (!siteRoot) {
    console.error('Usage: node scripts/validate-public-diff.mjs <public-site-root>');
    process.exitCode = 2;
  } else {
    validatePublicDiff(siteRoot).then((changed) => {
      console.log(changed.length ? `Validated generated public diff: ${changed.join(', ')}` : 'No generated public changes detected.');
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
