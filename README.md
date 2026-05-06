# claude-auto-retry-timezone-fix

Local patches for [`claude-auto-retry`](https://github.com/cheapestinference/claude-auto-retry) — fixes a 24-hour wait bug and adds resilience against Claude Code's modal token-exhaustion menu.

## Patches included

### 1. Day-boundary timezone bug

When Claude Code shows a rate-limit message like:

```
You've hit your limit · resets 10pm (Asia/Seoul)
```

and the current time is *before* the target hour in that timezone (e.g., 12:56 KST with target 22:00 KST), upstream `claude-auto-retry` computes a wait time of **~33 hours** instead of the correct **~9 hours**. The monitor sleeps through the actual reset window and only resumes the next day.

**Root cause** — `src/time-parser.js#getTargetTimestamp()` starts from `new Date("YYYY-MM-DDT22:00:00Z")` as an initial guess, then runs an iterative DST-correction loop. When the naive UTC interpretation lands on tomorrow in the target timezone, the correction pushes forward another 15+ hours instead of backward 9 hours, ending up on tomorrow's 22:00 KST rather than today's.

**Fix** — Normalize the candidate timestamp to the nearest occurrence inside `[now, now+24h)` after the iterative correction:

```js
const nowMs = now.getTime();
while (candidate - nowMs >= 86400_000) candidate -= 86400_000;
while (candidate < nowMs) candidate += 86400_000;
```

### 2. Pre-action Enter for modal prompts

When Claude Code's tokens are exhausted, it sometimes shows a selection menu like:

```
> wait for reset
  upgrade plan
  restart session
```

`claude-auto-retry`'s default behavior (send "continue" + Enter) breaks because the menu intercepts keystrokes — the typed "continue" goes nowhere useful and Claude stays stuck on the menu.

**Fix** — Send a bare Enter first (selecting the highlighted default, typically "wait"), then wait `preActionEnterDelaySeconds` (default 3s) for the menu to clear, then send the retry message normally.

Configurable via `~/.claude-auto-retry.json`:

```json
{ "preActionEnterDelaySeconds": 3 }
```

Set to `0` to disable.

> **Risk** — If the menu's highlighted default is *not* "wait" (e.g., "restart"), this auto-selects the wrong option and may lose your session. In practice Claude Code defaults to wait, so this is safe in the typical case. Set to `0` if you've customized this or are unsure.

See [`fix.patch`](./fix.patch) for the complete diff.

## Usage

### Apply to an installed `claude-auto-retry`

```bash
git clone https://github.com/JaeyeonBang/claude-auto-retry-timezone-fix.git
cd claude-auto-retry-timezone-fix
./apply.sh
```

The script is idempotent — running it twice is safe.

### After `npm update`

`npm update` overwrites the patched files. Re-run `./apply.sh` after any update or Node version switch (which implies re-running `claude-auto-retry install`).

### Verify

```bash
node test-time-parser.mjs       # 50 tests for timezone fix
node test-pre-action-enter.mjs  # 12 tests for pre-action Enter
```

## Tests

**`test-time-parser.mjs`** — 50 tests across 10 categories:

| Category | Tests |
|---|---|
| `parseResetTime` absolute time parsing | 10 |
| `parseResetTime` relative time parsing | 4 |
| **Day-boundary bug** | 12 |
| Half-hour timezone offsets (IST, Newfoundland) | 2 |
| Multiple timezones (JST, BST, PDT, KST, EST) | 5 |
| Ambiguous times (no am/pm) | 2 |
| Relative time calculation | 3 |
| Fallback / error paths | 5 |
| Real-world Claude Code message formats | 3 |
| Boundary invariants (non-negative, ≤25h) | 3 |
| Month / year rollover | 2 |

**`test-pre-action-enter.mjs`** — 12 tests:

| Category | Tests |
|---|---|
| Config defaults | 2 |
| Config validation (custom values, bad input, NaN/Infinity) | 7 |
| Real-tmux integration (timing + key-order verification) | 3 |

The tmux integration tests are skipped if tmux is not installed.

### Red-Green verification (timezone fix)

To confirm the tests actually catch the bug:

1. Revert the "Normalize to the nearest occurrence" block in `src/time-parser.js`
2. Run `node test-time-parser.mjs` → 3 tests fail (bug reproduced)
3. Re-apply the patch → 50 tests pass (bug fixed)

## Upstream

If the [upstream repo](https://github.com/cheapestinference/claude-auto-retry) merges these fixes, `npm update claude-auto-retry` will ship them and this local patch becomes unnecessary.

## License

MIT — same as upstream.
