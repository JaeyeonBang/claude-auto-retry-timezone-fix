// Comprehensive tests for claude-auto-retry time-parser.js bug fix
// Tests the day-boundary normalization bug and broader parsing/calculation logic.
//
// Usage:
//   # With the patch applied to your global npm install of claude-auto-retry:
//   NPM_PREFIX=$(npm prefix -g) node test-time-parser.mjs
//
//   # Or point at any checkout of the claude-auto-retry source:
//   TIME_PARSER=/path/to/claude-auto-retry/src/time-parser.js node test-time-parser.mjs

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function resolveTimeParser() {
  if (process.env.TIME_PARSER) return process.env.TIME_PARSER;
  const prefix = process.env.NPM_PREFIX ||
    execSync('npm prefix -g', { encoding: 'utf8' }).trim();
  const p = `${prefix}/lib/node_modules/claude-auto-retry/src/time-parser.js`;
  if (!existsSync(p)) {
    throw new Error(
      `Cannot find time-parser.js at ${p}. ` +
      `Set TIME_PARSER=/path/to/time-parser.js or install claude-auto-retry globally.`
    );
  }
  return p;
}

const { parseResetTime, calculateWaitMs } = await import(resolveTimeParser());

let pass = 0, fail = 0;
const failures = [];

function approx(actual, expected, tolerance = 120) {
  // tolerance in seconds (default 2 minutes, mostly to accommodate 60s margin)
  if (expected === null) return actual === null;
  return Math.abs(actual - expected) <= tolerance;
}

function test(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      pass++;
      console.log(`  PASS  ${name}`);
    } else {
      fail++;
      failures.push({ name, reason: result });
      console.log(`  FAIL  ${name}  — ${result}`);
    }
  } catch (e) {
    fail++;
    failures.push({ name, reason: e.message });
    console.log(`  FAIL  ${name}  — ${e.message}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

// Helper: wait-seconds calculation
function waitSec(text, nowIso, margin = 60, fallback = 5) {
  const parsed = parseResetTime(text);
  const now = new Date(nowIso);
  return calculateWaitMs(parsed, margin, fallback, now) / 1000;
}

// =============================================================================
section('parseResetTime — absolute time');
// =============================================================================

test('simple "resets 3pm"', () => {
  const p = parseResetTime('resets 3pm');
  return p && p.hour === 15 && p.minute === 0 && p.ampm === undefined && p.ambiguous === false
    ? true : `got ${JSON.stringify(p)}`;
});

test('"resets at 3:30pm (UTC)"', () => {
  const p = parseResetTime('resets at 3:30pm (UTC)');
  return p && p.hour === 15 && p.minute === 30 && p.timezone === 'UTC' && !p.ambiguous
    ? true : `got ${JSON.stringify(p)}`;
});

test('"resets 10pm (Asia/Seoul)" — the bug trigger', () => {
  const p = parseResetTime("⎿  You've hit your limit · resets 10pm (Asia/Seoul)");
  return p && p.hour === 22 && p.minute === 0 && p.timezone === 'Asia/Seoul' && !p.ambiguous
    ? true : `got ${JSON.stringify(p)}`;
});

test('"Claude usage limit reached. Resets at 2pm"', () => {
  const p = parseResetTime('Claude usage limit reached. Resets at 2pm');
  return p && p.hour === 14 && p.minute === 0
    ? true : `got ${JSON.stringify(p)}`;
});

test('"5-hour limit reached - resets 3pm (UTC)"', () => {
  const p = parseResetTime('5-hour limit reached - resets 3pm (UTC)');
  return p && p.hour === 15 && p.timezone === 'UTC'
    ? true : `got ${JSON.stringify(p)}`;
});

test('12am → midnight (hour 0)', () => {
  const p = parseResetTime('resets 12am (UTC)');
  return p && p.hour === 0 ? true : `got ${JSON.stringify(p)}`;
});

test('12pm → noon (hour 12)', () => {
  const p = parseResetTime('resets 12pm (UTC)');
  return p && p.hour === 12 ? true : `got ${JSON.stringify(p)}`;
});

test('No am/pm → ambiguous=true', () => {
  const p = parseResetTime('resets 3 (UTC)');
  return p && p.ambiguous === true && p.hour === 3
    ? true : `got ${JSON.stringify(p)}`;
});

test('24-hour format: "resets 22:30"', () => {
  const p = parseResetTime('resets 22:30');
  // No ampm, hour 22 > 12, so ambiguous is false
  return p && p.hour === 22 && p.minute === 30 && !p.ambiguous
    ? true : `got ${JSON.stringify(p)}`;
});

test('unparseable text → null', () => {
  const p = parseResetTime('hello world nothing here');
  return p === null ? true : `got ${JSON.stringify(p)}`;
});

// =============================================================================
section('parseResetTime — relative time');
// =============================================================================

test('"try again in 5 minutes"', () => {
  const p = parseResetTime('try again in 5 minutes');
  return p && p.relative && p.waitMs === 5 * 60_000
    ? true : `got ${JSON.stringify(p)}`;
});

test('"try again in 2 hours"', () => {
  const p = parseResetTime('try again in 2 hours');
  return p && p.relative && p.waitMs === 2 * 3600_000
    ? true : `got ${JSON.stringify(p)}`;
});

test('"resets in 30 minutes"', () => {
  const p = parseResetTime('resets in 30 minutes');
  return p && p.relative && p.waitMs === 30 * 60_000
    ? true : `got ${JSON.stringify(p)}`;
});

test('"wait 1 hour"', () => {
  const p = parseResetTime('wait 1 hour');
  return p && p.relative && p.waitMs === 3600_000
    ? true : `got ${JSON.stringify(p)}`;
});

// =============================================================================
section('calculateWaitMs — the DAY-BOUNDARY BUG (fixed)');
// =============================================================================

test('BUG FIX: KST 12:56 → 10pm today (not tomorrow)', () => {
  const w = waitSec('resets 10pm (Asia/Seoul)', '2026-04-22T03:56:22Z');
  // 03:56:22 UTC = 12:56:22 KST; target 22:00 KST = 13:00 UTC; diff ~32618s + 60 margin
  return approx(w, 32678) ? true : `got ${w}s (expected ~32678s, was 119078 before fix)`;
});

test('KST 23:00 → 10pm next day', () => {
  // 14:00 UTC = 23:00 KST; target 22:00 next day KST = 13:00 next day UTC
  // diff = 23h + 60 margin
  const w = waitSec('resets 10pm (Asia/Seoul)', '2026-04-22T14:00:00Z');
  return approx(w, 23 * 3600 + 60) ? true : `got ${w}s (expected ~${23*3600+60}s)`;
});

test('UTC 10:00 → 3pm today', () => {
  const w = waitSec('resets 3pm (UTC)', '2026-04-22T10:00:00Z');
  return approx(w, 5 * 3600 + 60) ? true : `got ${w}s`;
});

test('UTC 15:30 (just past 3pm) → 3pm next day', () => {
  const w = waitSec('resets 3pm (UTC)', '2026-04-22T15:30:00Z');
  return approx(w, 23.5 * 3600 + 60) ? true : `got ${w}s`;
});

test('UTC exactly at target (3pm) → reset "just happened", wait margin only', () => {
  const w = waitSec('resets 3pm (UTC)', '2026-04-22T15:00:00Z');
  // At the exact reset moment, we can continue immediately after the margin buffer.
  // This preserves the original behavior: only diff<0 rolls to next day.
  return approx(w, 60, 5) ? true : `got ${w}s (expected ~60s)`;
});

test('EST 14:00 EDT → 5pm today', () => {
  // 2026-04-22 is EDT (UTC-4). 14:00 EDT = 18:00 UTC. Target 17:00 EDT = 21:00 UTC. diff 3h
  const w = waitSec('resets 5pm (America/New_York)', '2026-04-22T18:00:00Z');
  return approx(w, 3 * 3600 + 60) ? true : `got ${w}s`;
});

test('UTC 2am → 5am today', () => {
  const w = waitSec('resets 5am (UTC)', '2026-04-22T02:00:00Z');
  return approx(w, 3 * 3600 + 60) ? true : `got ${w}s`;
});

test('UTC 6am → 5am tomorrow', () => {
  const w = waitSec('resets 5am (UTC)', '2026-04-22T06:00:00Z');
  return approx(w, 23 * 3600 + 60) ? true : `got ${w}s`;
});

test('Minute precision: 3:30pm', () => {
  const w = waitSec('resets 3:30pm (UTC)', '2026-04-22T10:00:00Z');
  return approx(w, 5.5 * 3600 + 60) ? true : `got ${w}s`;
});

test('Midnight: 12am (UTC) when current is 6pm', () => {
  const w = waitSec('resets 12am (UTC)', '2026-04-22T18:00:00Z');
  return approx(w, 6 * 3600 + 60) ? true : `got ${w}s`;
});

test('Noon: 12pm (UTC) when current is 10am', () => {
  const w = waitSec('resets 12pm (UTC)', '2026-04-22T10:00:00Z');
  return approx(w, 2 * 3600 + 60) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — half-hour timezone offsets');
// =============================================================================

test('IST (UTC+5:30): 10am IST when current is 1am UTC', () => {
  // 1am UTC = 6:30am IST; target 10am IST = 4:30am UTC; diff 3.5h
  const w = waitSec('resets 10am (Asia/Kolkata)', '2026-04-22T01:00:00Z');
  return approx(w, 3.5 * 3600 + 60) ? true : `got ${w}s`;
});

test('Newfoundland (UTC-2:30 DST): 3pm NDT', () => {
  // NDT is UTC-2:30 in April. 15:00 UTC = 12:30 NDT; target 3pm NDT = 17:30 UTC; diff 2.5h
  const w = waitSec('resets 3pm (America/St_Johns)', '2026-04-22T15:00:00Z');
  return approx(w, 2.5 * 3600 + 60) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — multiple timezones same target');
// =============================================================================

test('JST 9am (Asia/Tokyo) — exactly at target', () => {
  // 2026-04-22T00:00:00Z = 09:00 JST exactly; reset moment → wait margin only
  const w = waitSec('resets 9am (Asia/Tokyo)', '2026-04-22T00:00:00Z');
  return approx(w, 60, 5) ? true : `got ${w}s (expected ~60s)`;
});

test('JST 9am (Asia/Tokyo) — 1 second before target', () => {
  // 23:59:59 UTC April 21 = 08:59:59 JST April 22; target 9am JST = 0 UTC. diff 1s
  const w = waitSec('resets 9am (Asia/Tokyo)', '2026-04-21T23:59:59Z');
  return approx(w, 1 + 60, 2) ? true : `got ${w}s (expected ~61s)`;
});

test('JST 9am (Asia/Tokyo) — 1 second after target', () => {
  // 00:00:01 UTC = 09:00:01 JST; missed today → 9am next day
  const w = waitSec('resets 9am (Asia/Tokyo)', '2026-04-22T00:00:01Z');
  return approx(w, 24 * 3600 + 60 - 1, 5) ? true : `got ${w}s`;
});

test('London 5pm (Europe/London, BST)', () => {
  // Late April in London is BST (UTC+1). 10:00 UTC = 11:00 BST; target 17:00 BST = 16:00 UTC. diff 6h
  const w = waitSec('resets 5pm (Europe/London)', '2026-04-22T10:00:00Z');
  return approx(w, 6 * 3600 + 60) ? true : `got ${w}s`;
});

test('PDT 10am (America/Los_Angeles, UTC-7)', () => {
  // 14:00 UTC = 7am PDT; target 10am PDT = 17:00 UTC. diff 3h
  const w = waitSec('resets 10am (America/Los_Angeles)', '2026-04-22T14:00:00Z');
  return approx(w, 3 * 3600 + 60) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — ambiguous times (no am/pm)');
// =============================================================================

test('Ambiguous "resets 3" when 3am is 9h away, 3pm is 21h away → picks 3am', () => {
  // 18:00 UTC; 3am tomorrow = 9h; 3pm tomorrow = 21h
  const w = waitSec('resets 3 (UTC)', '2026-04-22T18:00:00Z');
  return approx(w, 9 * 3600 + 60) ? true : `got ${w}s`;
});

test('Ambiguous "resets 5" when 5am is 3h, 5pm is 15h → picks 5am', () => {
  const w = waitSec('resets 5 (UTC)', '2026-04-22T02:00:00Z');
  return approx(w, 3 * 3600 + 60) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — relative time');
// =============================================================================

test('Relative: "in 5 minutes"', () => {
  const w = waitSec('try again in 5 minutes', '2026-04-22T10:00:00Z');
  return approx(w, 5 * 60 + 60) ? true : `got ${w}s`;
});

test('Relative: "in 2 hours"', () => {
  const w = waitSec('try again in 2 hours', '2026-04-22T10:00:00Z');
  return approx(w, 2 * 3600 + 60) ? true : `got ${w}s`;
});

test('Relative: "wait 30 minutes"', () => {
  const w = waitSec('wait 30 minutes', '2026-04-22T10:00:00Z');
  return approx(w, 30 * 60 + 60) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — fallback / error paths');
// =============================================================================

test('parseResetTime returned null → uses fallback (5h default)', () => {
  const now = new Date('2026-04-22T10:00:00Z');
  const ms = calculateWaitMs(null, 60, 5, now);
  return approx(ms / 1000, 5 * 3600 + 60) ? true : `got ${ms/1000}s`;
});

test('Custom fallback (3 hours)', () => {
  const now = new Date('2026-04-22T10:00:00Z');
  const ms = calculateWaitMs(null, 60, 3, now);
  return approx(ms / 1000, 3 * 3600 + 60) ? true : `got ${ms/1000}s`;
});

test('Invalid timezone (garbled) → fallback', () => {
  const parsed = { hour: 15, minute: 0, timezone: 'Not/AValidTZ', ambiguous: false };
  const now = new Date('2026-04-22T10:00:00Z');
  const ms = calculateWaitMs(parsed, 60, 5, now);
  return approx(ms / 1000, 5 * 3600 + 60) ? true : `got ${ms/1000}s`;
});

test('Custom margin (0 seconds)', () => {
  const w = waitSec('resets 3pm (UTC)', '2026-04-22T10:00:00Z', 0);
  return approx(w, 5 * 3600, 5) ? true : `got ${w}s`;
});

test('Large margin (300 seconds)', () => {
  const w = waitSec('resets 3pm (UTC)', '2026-04-22T10:00:00Z', 300);
  return approx(w, 5 * 3600 + 300, 5) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — specific real-world Claude Code messages');
// =============================================================================

test('Real: "You\'re out of extra usage · resets 3pm (UTC)"', () => {
  const w = waitSec("You're out of extra usage · resets 3pm (UTC)", '2026-04-22T10:00:00Z');
  return approx(w, 5 * 3600 + 60) ? true : `got ${w}s`;
});

test('Real: "Rate limit hit. Resets at 4pm (Europe/Dublin)"', () => {
  // Dublin April 22 2026 is IST (UTC+1). 10 UTC = 11 IST; 4pm IST = 15 UTC. diff 5h
  const w = waitSec('Rate limit hit. Resets at 4pm (Europe/Dublin)', '2026-04-22T10:00:00Z');
  return approx(w, 5 * 3600 + 60) ? true : `got ${w}s`;
});

test('Real TUI multi-char: "⎿ You\'ve hit your limit · resets 10pm (Asia/Seoul)"', () => {
  const w = waitSec("⎿  You've hit your limit · resets 10pm (Asia/Seoul)", '2026-04-22T03:56:22Z');
  return approx(w, 32678, 5) ? true : `got ${w}s`;
});

// =============================================================================
section('calculateWaitMs — boundary: always returns non-negative');
// =============================================================================

test('Target just missed (1s past) → correctly schedules to next day', () => {
  // At 15:00:01 UTC, target "3pm UTC" should be ~24h away
  const w = waitSec('resets 3pm (UTC)', '2026-04-22T15:00:01Z');
  return w >= 23 * 3600 && w <= 24.5 * 3600 + 60 ? true : `got ${w}s`;
});

test('Result wait never negative', () => {
  // Multiple scenarios — just verify no negative results
  const scenarios = [
    ['resets 3pm (UTC)', '2026-04-22T10:00:00Z'],
    ['resets 3pm (UTC)', '2026-04-22T14:59:59Z'],
    ['resets 3pm (UTC)', '2026-04-22T15:00:00Z'],
    ['resets 3pm (UTC)', '2026-04-22T15:00:01Z'],
    ['resets 3pm (UTC)', '2026-04-22T23:59:59Z'],
    ['resets 12am (UTC)', '2026-04-22T00:00:00Z'],
    ['resets 12pm (UTC)', '2026-04-22T12:00:00Z'],
  ];
  for (const [text, now] of scenarios) {
    const w = waitSec(text, now);
    if (w < 0) return `negative wait for "${text}" at ${now}: ${w}`;
  }
  return true;
});

test('Result wait never exceeds 25 hours (with margin)', () => {
  // Max is 24h + margin. Should never exceed that for valid inputs
  const scenarios = [
    ['resets 3pm (UTC)', '2026-04-22T10:00:00Z'],
    ['resets 3pm (UTC)', '2026-04-22T14:59:59Z'],
    ['resets 3pm (UTC)', '2026-04-22T15:00:00Z'],
    ['resets 3pm (UTC)', '2026-04-22T15:00:01Z'],
    ['resets 10pm (Asia/Seoul)', '2026-04-22T03:56:22Z'],
    ['resets 10pm (Asia/Seoul)', '2026-04-22T14:00:00Z'],
  ];
  for (const [text, now] of scenarios) {
    const w = waitSec(text, now);
    if (w > 25 * 3600) return `wait exceeds 25h for "${text}" at ${now}: ${w}s`;
  }
  return true;
});

// =============================================================================
section('Month/year rollover');
// =============================================================================

test('End of month: "resets 3am (UTC)" on April 30 at 11pm', () => {
  // 30 April 23:00 UTC, target 3am = next day (May 1) 03:00 UTC. diff 4h
  const w = waitSec('resets 3am (UTC)', '2026-04-30T23:00:00Z');
  return approx(w, 4 * 3600 + 60) ? true : `got ${w}s`;
});

test('End of year: Dec 31 at 11pm UTC → 3am Jan 1', () => {
  const w = waitSec('resets 3am (UTC)', '2026-12-31T23:00:00Z');
  return approx(w, 4 * 3600 + 60) ? true : `got ${w}s`;
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(60));
console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
console.log('='.repeat(60));

if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.reason}`);
  }
  process.exit(1);
}
process.exit(0);
