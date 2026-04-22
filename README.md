# claude-auto-retry-timezone-fix

Fix for a day-boundary bug in [`claude-auto-retry`](https://github.com/cheapestinference/claude-auto-retry) where the timezone parser waits ~24 hours longer than necessary.

## The bug

When Claude Code shows a rate-limit message like:

```
You've hit your limit · resets 10pm (Asia/Seoul)
```

and the current time is *before* the target hour in that timezone (e.g., 12:56 KST with target 22:00 KST), `claude-auto-retry` computes a wait time of **~33 hours** instead of the correct **~9 hours**.

The result: the monitor sleeps through the actual reset window and only resumes the next day.

### Root cause

In `src/time-parser.js`, `getTargetTimestamp()` starts from `new Date("YYYY-MM-DDT22:00:00Z")` as an initial guess, then runs an iterative DST-correction loop. When the naive UTC interpretation of the target lands on tomorrow in the target timezone, the correction pushes forward another 15+ hours instead of backward 9 hours, ending up on tomorrow's 22:00 KST rather than today's.

### The fix

Normalize the candidate timestamp to the nearest future occurrence within a 24-hour window after the iterative correction:

```js
// Normalize to the nearest occurrence at or after `now`.
const nowMs = now.getTime();
while (candidate - nowMs >= 86400_000) candidate -= 86400_000;
while (candidate < nowMs) candidate += 86400_000;
```

See [`time-parser-fix.patch`](./time-parser-fix.patch) for the complete diff.

## Usage

### Apply to an installed `claude-auto-retry`

```bash
git clone https://github.com/JaeyeonBang/claude-auto-retry-timezone-fix.git
cd claude-auto-retry-timezone-fix
./apply.sh
```

The script is idempotent — running it twice is safe.

### After `npm update`

`npm update` overwrites the patched file. Re-run `./apply.sh` after any update or Node version switch (which implies re-running `claude-auto-retry install`).

### Verify

```bash
node test-time-parser.mjs
# Results: 50 passed, 0 failed, 50 total
```

## Tests

`test-time-parser.mjs` contains 50 tests across 10 categories:

| Category | Tests |
|---|---|
| `parseResetTime` absolute time parsing | 10 |
| `parseResetTime` relative time parsing | 4 |
| **Day-boundary bug (the fix)** | 12 |
| Half-hour timezone offsets (IST, Newfoundland) | 2 |
| Multiple timezone coverage (JST, London BST, PDT) | 5 |
| Ambiguous times (no am/pm) | 2 |
| Relative time calculation | 3 |
| Fallback / error paths | 5 |
| Real-world Claude Code message formats | 3 |
| Boundary invariants (non-negative, ≤25h) | 3 |
| Month / year rollover | 2 |

### Red-Green verification

To confirm the tests actually catch the bug:

1. Revert the patch by removing the "Normalize to the nearest occurrence" block in `src/time-parser.js`
2. Run `node test-time-parser.mjs` → 3 tests fail (bug reproduced)
3. Re-apply the patch → 50 tests pass (bug fixed)

## Upstream

If the [upstream repo](https://github.com/cheapestinference/claude-auto-retry) merges this fix, `npm update claude-auto-retry` will ship the fix and this local patch becomes unnecessary.

## License

MIT — same as upstream.
