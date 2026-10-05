import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SAFE_ROUTE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceRequired(text, pattern, replacement, description) {
  if (!pattern.test(text)) throw new Error(`Unable to refresh venue routes: missing ${description}.`);
  pattern.lastIndex = 0;
  return text.replace(pattern, replacement);
}

function setMetaContent(html, name, value) {
  const escapedName = escapeRegExp(name);
  const tagPattern = new RegExp(`<meta\\b[^>]*\\bname=["']${escapedName}["'][^>]*>`, 'i');
  if (!tagPattern.test(html)) return html;
  tagPattern.lastIndex = 0;
  return html.replace(tagPattern, (tag) => {
    const content = `content="${escapeHtmlAttribute(value)}"`;
    return /\bcontent=["'][^"']*["']/i.test(tag)
      ? tag.replace(/\bcontent=["'][^"']*["']/i, content)
      : tag.replace(/>$/, ` ${content}>`);
  });
}

function setMetaPropertyContent(html, property, value) {
  const tagPattern = new RegExp('<meta\\b[^>]*\\bproperty="' + escapeRegExp(property) + '"[^>]*>', 'i');
  if (!tagPattern.test(html)) return html;
  tagPattern.lastIndex = 0;
  return html.replace(tagPattern, (tag) => {
    const content = 'content="' + escapeHtmlAttribute(value) + '"';
    return /\bcontent=["'][^"']*["']/i.test(tag)
      ? tag.replace(/\bcontent=["'][^"']*["']/i, content)
      : tag.replace(/>$/, ' ' + content + '>');
  });
}

export function venueRouteAliases(venue) {
  return String(venue?.slug_aliases || '')
    .split('|')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function assertSafeRouteSlug(slug, venue) {
  if (!SAFE_ROUTE_SLUG.test(slug)) {
    throw new Error(`Refusing unsafe venue route slug "${slug || '(missing)'}" for ${String(venue?.venue_id || '<unknown>')}.`);
  }
}

export function venueRouteRecords(venues) {
  if (!Array.isArray(venues)) throw new Error('Cannot refresh venue routes without a venues array.');
  const records = [];
  const seen = new Set();
  for (const venue of venues) {
    const canonicalSlug = String(venue?.slug || '').trim();
    assertSafeRouteSlug(canonicalSlug, venue);
    const routes = [
      { slug: canonicalSlug, alias: false },
      ...venueRouteAliases(venue).map((slug) => ({ slug, alias: true }))
    ];
    for (const route of routes) {
      assertSafeRouteSlug(route.slug, venue);
      if (seen.has(route.slug)) throw new Error(`Duplicate venue route in generated public outputs: ${route.slug}`);
      seen.add(route.slug);
      records.push({ ...route, venue });
    }
  }
  return records;
}

function venuePageDescription(runtime, venue) {
  const description = String(venue?.short_description || '').trim();
  if (description) return description;
  const location = [venue?.city, venue?.region].filter(Boolean).join(', ');
  return 'Find ' + venue.name + (location ? ' in ' + location : '') + ' on ' +
    runtime.config.identity.productName + '. See current game-day details, Watch Parties, and fan activity.';
}

function venuePageUrl(runtime, slug) {
  return new URL('locations/' + encodeURIComponent(slug) + '/', runtime.siteOrigin + '/').href;
}

export function materializeVenuePageHtml(sourceHtml, runtime, venue, { alias = false } = {}) {
  const canonicalUrl = venuePageUrl(runtime, venue.slug);
  const description = venuePageDescription(runtime, venue);
  const title = venue.name + ' | ' + runtime.config.identity.productName;
  let html = sourceHtml;

  if (!/<base\b/i.test(html)) html = html.replace(/<head>/i, '<head>\n  <base href="/">');
  html = replaceRequired(
    html,
    /<title>[\s\S]*?<\/title>/i,
    '<title>' + escapeHtmlAttribute(title) + '</title>',
    'document title'
  );
  html = setMetaContent(html, 'description', description);
  html = setMetaPropertyContent(html, 'og:title', title);
  html = setMetaPropertyContent(html, 'og:description', description);
  html = setMetaPropertyContent(html, 'og:url', canonicalUrl);
  html = replaceRequired(
    html,
    /<link\b[^>]*\brel=["']canonical["'][^>]*>/i,
    (tag) => tag.replace(/\bhref=["'][^"']*["']/i, 'href="' + escapeHtmlAttribute(canonicalUrl) + '"'),
    'venue canonical link'
  );
  if (alias && !/<meta\b[^>]*\bname=["']robots["']/i.test(html)) {
    html = html.replace(/<\/head>/i, '  <meta name="robots" content="noindex,follow">\n</head>');
  }
  return html;
}

export function buildVenueSitemap(sitemap, runtime, venues) {
  venueRouteRecords(venues);
  const locationPrefix = `${runtime.siteOrigin}/locations/`;
  const locationBlockPattern = new RegExp(
    `\\s*<url>\\s*<loc>${escapeRegExp(locationPrefix)}[^<]+<\\/loc>\\s*<\\/url>`,
    'g'
  );
  const withoutLocations = sitemap.replace(locationBlockPattern, '');
  if (new RegExp(`<loc>${escapeRegExp(locationPrefix)}`).test(withoutLocations)) {
    throw new Error('Unable to refresh sitemap because an existing venue URL block has an unexpected structure.');
  }
  const venueEntries = venues.map((venue) => (
    '  <url>\n    <loc>' + escapeXml(venuePageUrl(runtime, venue.slug)) + '</loc>\n  </url>'
  )).join('\n');
  return replaceRequired(
    withoutLocations,
    /\s*<\/urlset>\s*$/,
    '\n' + (venueEntries ? venueEntries + '\n' : '') + '</urlset>\n',
    'sitemap urlset closing tag'
  );
}

export async function refreshVenueRoutes(runtime, snapshot, sourceHtml) {
  const venues = Array.isArray(snapshot?.venues) ? snapshot.venues : [];
  const routes = venueRouteRecords(venues);
  const root = resolve(runtime.root);
  const locationsRoot = join(root, 'locations');
  await rm(locationsRoot, { recursive: true, force: true });
  await mkdir(locationsRoot, { recursive: true });

  for (const route of routes) {
    const directory = join(locationsRoot, route.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'index.html'),
      materializeVenuePageHtml(sourceHtml, runtime, route.venue, { alias: route.alias }),
      'utf8'
    );
  }

  const sitemapPath = join(root, 'sitemap.xml');
  const sitemap = await readFile(sitemapPath, 'utf8');
  const updatedSitemap = buildVenueSitemap(sitemap, runtime, venues);
  if (updatedSitemap !== sitemap) await writeFile(sitemapPath, updatedSitemap, 'utf8');

  return { routeCount: routes.length, canonicalCount: venues.length };
}
