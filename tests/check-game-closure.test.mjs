import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGameCompletion, extractPublicEndpoint } from '../scripts/check-game-closure.mjs';

const snapshot = (games, generatedAt = '2026-10-31T23:30:00Z') => ({ generatedAt, games });
const game = (overrides = {}) => ({
  game_status: 'upcoming', opponent_name: 'NC State', game_date: '2026-10-31',
  kickoff_status: 'confirmed', kickoff_at: '2026-10-31T16:00:00Z', ...overrides
});
const now = new Date('2026-10-31T23:30:00Z');

test('confirmed 9am Pacific kickoff waits for six hours plus one hourly grace', () => {
  assert.equal(checkGameCompletion(snapshot([game()], '2026-10-31T22:59:00Z'), new Date('2026-10-31T22:59:00Z')).problems.length, 0);
  assert.equal(checkGameCompletion(snapshot([game()], '2026-10-31T23:00:00Z'), new Date('2026-10-31T23:00:00Z')).problems.length, 1);
});

test('completed, postponed, and cancelled games are ignored', () => {
  const games = ['completed', 'postponed', 'cancelled'].map(game_status => game({ game_status }));
  assert.equal(checkGameCompletion(snapshot(games), now).problems.length, 0);
});

test('upcoming evening game is not flagged prematurely', () => {
  assert.equal(checkGameCompletion(snapshot([game({kickoff_at:'2026-11-01T02:30:00Z'})]), now).problems.length, 0);
});

test('TBD completion uses following school-local day at 6am with one-hour grace across fall DST', () => {
  const tbd = game({ game_date: '2026-10-31', kickoff_status: 'tbd', kickoff_at: '' });
  const before = new Date('2026-11-01T14:59:00Z');
  const after = new Date('2026-11-01T15:00:00Z');
  assert.equal(checkGameCompletion(snapshot([tbd], before.toISOString()), before).problems.length, 0);
  assert.equal(checkGameCompletion(snapshot([tbd], after.toISOString()), after).problems.length, 1);
});

test('TBD completion uses following school-local day across spring DST', () => {
  const tbd = game({ game_date: '2027-03-13', kickoff_status: 'tbd', kickoff_at: '' });
  const before = new Date('2027-03-14T13:59:00Z');
  const after = new Date('2027-03-14T14:00:00Z');
  assert.equal(checkGameCompletion(snapshot([tbd], before.toISOString()), before).problems.length, 0);
  assert.equal(checkGameCompletion(snapshot([tbd], after.toISOString()), after).problems.length, 1);
});

test('malformed or stale public snapshots fail visibly instead of silently passing', () => {
  assert.throws(() => checkGameCompletion({}, now), /no Games/);
  assert.throws(() => checkGameCompletion(snapshot([game()], '2026-10-30T20:00:00Z'), now), /stale/);
  assert.match(checkGameCompletion(snapshot([game({kickoff_at:'bad'})]), now).problems[0], /invalid/);
});

test('extracts only the public Apps Script endpoint from live HTML', () => {
  const html = '<meta name="cgb-data-endpoint"\n content="https://script.google.com/macros/s/AKfycb_example/exec">';
  assert.equal(extractPublicEndpoint(html), 'https://script.google.com/macros/s/AKfycb_example/exec');
  assert.throws(() => extractPublicEndpoint('<meta name="cgb-data-endpoint" content="https://example.org/private">'), /unexpected/);
});
