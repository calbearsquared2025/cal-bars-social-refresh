#!/usr/bin/env node
// Independent read-only game-status monitor. Uses only the public CGB snapshot.
import { pathToFileURL } from 'node:url';

const SITE_URL = 'https://calgoldenbars.com/';
const HOME_TIME_ZONE = 'America/Los_Angeles';
const COMPLETION_DELAY_MS = 6 * 60 * 60 * 1000;
const TRIGGER_GRACE_MS = 60 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

function localTimestamp(date, timeZone = HOME_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}`;
}

function dateAfter(gameDate) {
  if (typeof gameDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return null;
  const day = new Date(`${gameDate}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== gameDate) return null;
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function elapsedCutoff(game, now, timeZone) {
  const kickoffStatus = String(game.kickoff_status || '').trim().toLowerCase();
  if (kickoffStatus === 'confirmed') {
    const kickoff = typeof game.kickoff_at === 'string' ? Date.parse(game.kickoff_at) : NaN;
    if (!Number.isFinite(kickoff)) return { invalid: 'confirmed kickoff_at is missing or invalid' };
    const cutoff = new Date(kickoff + COMPLETION_DELAY_MS + TRIGGER_GRACE_MS);
    return { overdue: now.getTime() >= cutoff.getTime(), cutoff: cutoff.toISOString() };
  }
  if (kickoffStatus === 'tbd') {
    const nextDate = dateAfter(game.game_date);
    if (!nextDate) return { invalid: 'TBD game_date is missing or invalid' };
    // Existing trigger completes at 06:00 next school-local day, plus one hour grace.
    const localCutoff = `${nextDate} 07:00`;
    return { overdue: localTimestamp(now, timeZone) >= localCutoff,
      cutoff: `${localCutoff} ${timeZone}` };
  }
  return { invalid: 'kickoff_status is not confirmed or tbd' };
}

export function checkGameCompletion(snapshot, now = new Date(), {
  timeZone = HOME_TIME_ZONE, maxAgeMs = SNAPSHOT_MAX_AGE_MS
} = {}) {
  if (!snapshot || snapshot.ok === false || !Array.isArray(snapshot.games) || snapshot.games.length === 0) {
    throw new Error('Public snapshot is unavailable or contains no Games array');
  }
  if (typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new Error('Public snapshot is missing a valid generatedAt timestamp');
  }
  const age = now.getTime() - Date.parse(snapshot.generatedAt);
  if (age > maxAgeMs || age < -5 * 60 * 1000) {
    throw new Error('Public snapshot is stale or has an invalid future generatedAt timestamp');
  }
  const problems = [];
  let upcoming = 0;
  for (const game of snapshot.games) {
    if (game?.game_status !== 'upcoming') continue;
    upcoming++;
    const opponent = String(game.opponent_name || '(unknown opponent)').slice(0, 100);
    const date = String(game.game_date || '(missing date)').slice(0, 40);
    const cutoff = elapsedCutoff(game, now, timeZone);
    if (cutoff.invalid) problems.push(`${opponent} (${date}): ${cutoff.invalid}`);
    else if (cutoff.overdue) problems.push(`${opponent} (${date}) remains upcoming past ${cutoff.cutoff}`);
  }
  return { problems, checked: snapshot.games.length, upcoming };
}

export function extractPublicEndpoint(html) {
  const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(value => /\bname\s*=\s*["']cgb-data-endpoint["']/i.test(value));
  const url = tag?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!url) throw new Error('Live site is missing its public data endpoint');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname)) {
    throw new Error('Live site has an unexpected public data endpoint');
  }
  return endpoint.href;
}

async function loadLiveSnapshot(fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const site = await fetchImpl(SITE_URL, { signal: controller.signal, redirect: 'follow', cache: 'no-store' });
    if (!site.ok) throw new Error(`Live site returned HTTP ${site.status}`);
    const endpoint = extractPublicEndpoint(await site.text());
    // Reuse the public-refresh repository's existing retry handling.
    const { fetchSnapshot } = await import('./refresh-social-graphics.mjs');
    return await fetchSnapshot(endpoint, value => value, {
      fetchImpl, timeoutMs: 15_000, attempts: 3, retryDelaysMs: [1000, 3000]
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCheck({ fetchImpl = fetch, now = new Date() } = {}) {
  return checkGameCompletion(await loadLiveSnapshot(fetchImpl), now);
}

async function main() {
  try {
    const result = await runCheck();
    if (result.problems.length) {
      console.error('CGB GAME COMPLETION ALERT:');
      for (const problem of result.problems) console.error(`- ${problem}`);
      console.error('The existing Google Apps Script scheduler may be disabled or failing. This monitor does not change data.');
      process.exitCode = 1;
      return;
    }
    console.log(`CGB game-completion check OK: ${result.checked} games, ${result.upcoming} upcoming, none overdue.`);
  } catch (error) {
    console.error(`CGB GAME COMPLETION MONITOR ERROR: ${error.message}`);
    console.error('Could not verify live completion. Inspect the public endpoint and Google Apps Script account status.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
