import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOCIAL_START_MARKER = '<!-- CGB current-game social metadata: start -->';
const SOCIAL_END_MARKER = '<!-- CGB current-game social metadata: end -->';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

export function pathIsAllowed(path) {
  return path === 'index.html' || path === 'assets/social-cards/manifest.json' || /^assets\/social-cards\/[^/]+\.png$/.test(path) || /^share\/[^/]+\/index\.html$/.test(path);
}

function normalizeControlledIndexRegions(html) {
  const blockPattern = new RegExp(`${SOCIAL_START_MARKER}[\\s\\S]*?${SOCIAL_END_MARKER}`);
  if (!blockPattern.test(html)) throw new Error('index.html is missing the generated social metadata markers.');
  let normalized = html.replace(blockPattern, `${SOCIAL_START_MARKER}\n${SOCIAL_END_MARKER}`);
  const preloadPattern = /(<link\b[^>]*\bid="cgb-loading-cover-preload"[^>]*\bhref=")[^"]*(")/i;
  const imagePattern = /(<img\b[^>]*\bid="map-fallback-card"[^>]*\bsrc=")[^"]*(")/i;
  if (!preloadPattern.test(normalized) || !imagePattern.test(normalized)) throw new Error('index.html is missing the loading cover hooks.');
  return normalized.replace(preloadPattern, '$1__SOCIAL_IMAGE__$2').replace(imagePattern, '$1__SOCIAL_IMAGE__$2');
}

export function assertIndexDiffIsControlled(before, after) {
  if (normalizeControlledIndexRegions(before) !== normalizeControlledIndexRegions(after)) {
    throw new Error('index.html changed outside the generated social metadata or loading-cover references.');
  }
}

export async function validatePublicDiff(siteRoot) {
  const root = resolve(siteRoot);
  const changed = git(root, ['status', '--porcelain=v1'])
    .split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
  const disallowed = changed.filter((path) => !pathIsAllowed(path));
  if (disallowed.length) throw new Error(`Refusing social refresh because disallowed public files changed: ${disallowed.join(', ')}`);
  if (changed.includes('index.html')) {
    const before = git(root, ['show', 'HEAD:index.html']);
    const after = await readFile(join(root, 'index.html'), 'utf8');
    assertIndexDiffIsControlled(`${before}\n`, after);
  }
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
      console.log(changed.length ? `Validated social-only public diff: ${changed.join(', ')}` : 'No public social changes detected.');
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
