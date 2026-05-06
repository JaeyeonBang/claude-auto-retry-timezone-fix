// Tests for the preActionEnterDelaySeconds feature
// (sends a bare Enter before the retry message to dismiss menu prompts)

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function resolveSrc(file) {
  if (process.env.SRC_DIR) return `${process.env.SRC_DIR}/${file}`;
  const prefix = process.env.NPM_PREFIX ||
    execSync('npm prefix -g', { encoding: 'utf8' }).trim();
  const p = `${prefix}/lib/node_modules/claude-auto-retry/src/${file}`;
  if (!existsSync(p)) {
    throw new Error(
      `Cannot find ${p}. Set SRC_DIR=/path/to/src or install claude-auto-retry globally.`
    );
  }
  return p;
}

const { loadConfig, DEFAULT_CONFIG } = await import(resolveSrc('config.js'));
const { sendKeys } = await import(resolveSrc('tmux.js'));

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((r) => {
      if (r === true) { pass++; console.log(`  PASS  ${name}`); }
      else { fail++; failures.push({ name, reason: r }); console.log(`  FAIL  ${name}  — ${r}`); }
    })
    .catch((e) => { fail++; failures.push({ name, reason: e.message }); console.log(`  FAIL  ${name}  — ${e.message}`); });
}

function section(t) { console.log(`\n[${t}]`); }

// =============================================================================
section('config defaults');
// =============================================================================

await test('DEFAULT_CONFIG has preActionEnterDelaySeconds = 3', () => {
  return DEFAULT_CONFIG.preActionEnterDelaySeconds === 3
    ? true : `got ${DEFAULT_CONFIG.preActionEnterDelaySeconds}`;
});

await test('loadConfig() with no file returns default', async () => {
  const cfg = await loadConfig('/tmp/nonexistent-config-' + Date.now() + '.json');
  return cfg.preActionEnterDelaySeconds === 3
    ? true : `got ${cfg.preActionEnterDelaySeconds}`;
});

// =============================================================================
section('config validation — preActionEnterDelaySeconds');
// =============================================================================

import { writeFileSync, unlinkSync } from 'node:fs';

async function withConfig(obj, fn) {
  const path = `/tmp/test-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(path, JSON.stringify(obj));
  try { return await fn(path); }
  finally { try { unlinkSync(path); } catch {} }
}

await test('loadConfig accepts custom value (0)', async () => {
  return withConfig({ preActionEnterDelaySeconds: 0 }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 0 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

await test('loadConfig accepts custom value (5)', async () => {
  return withConfig({ preActionEnterDelaySeconds: 5 }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 5 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

await test('loadConfig falls back to default for negative value', async () => {
  return withConfig({ preActionEnterDelaySeconds: -1 }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 3 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

await test('loadConfig falls back to default for non-number', async () => {
  return withConfig({ preActionEnterDelaySeconds: 'three' }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 3 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

await test('loadConfig accepts fractional value', async () => {
  return withConfig({ preActionEnterDelaySeconds: 0.5 }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 0.5 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

await test('loadConfig falls back for NaN', async () => {
  return withConfig({ preActionEnterDelaySeconds: NaN }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 3 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

await test('loadConfig falls back for Infinity', async () => {
  return withConfig({ preActionEnterDelaySeconds: Infinity }, async (p) => {
    const cfg = await loadConfig(p);
    return cfg.preActionEnterDelaySeconds === 3 ? true : `got ${cfg.preActionEnterDelaySeconds}`;
  });
});

// =============================================================================
section('integration — sendKeys with real tmux pane');
// =============================================================================

let tmuxAvailable = false;
let session = '';
let pane = '';
try {
  execFileSync('tmux', ['-V'], { stdio: 'pipe' });
  tmuxAvailable = true;
} catch {
  console.log('  SKIP  tmux not installed; integration tests skipped');
}

if (tmuxAvailable) {
  session = `caretest-${Date.now()}`;
  // Start a session running `cat` so we can verify keystrokes are received
  execFileSync('tmux', ['new-session', '-d', '-s', session, 'cat']);
  pane = execFileSync('tmux', ['list-panes', '-t', session, '-F', '#{pane_id}'], { encoding: 'utf8' }).trim();
}

function capturePane() {
  return execFileSync('tmux', ['capture-pane', '-t', pane, '-p'], { encoding: 'utf8' });
}

async function runIntegration(name, fn) {
  if (!tmuxAvailable) return;
  return test(name, fn);
}

await runIntegration('sendKeys with delay=0 sends only [text, Enter]', async () => {
  // Reset cat by clearing pane
  execFileSync('tmux', ['send-keys', '-t', pane, 'C-u']);
  await new Promise((r) => setTimeout(r, 100));
  execFileSync('tmux', ['send-keys', '-t', pane, 'clear', 'Enter']);
  await new Promise((r) => setTimeout(r, 200));

  const before = Date.now();
  await sendKeys(pane, 'TEST_NO_WAKE_42', 0);
  const elapsed = Date.now() - before;

  // Expected: just the 300ms inter-key delay; no extra wake delay
  if (elapsed > 1000) return `took ${elapsed}ms, expected <1s`;

  await new Promise((r) => setTimeout(r, 200));
  const out = capturePane();
  return out.includes('TEST_NO_WAKE_42') ? true : `pane content: ${out.slice(-200)}`;
});

await runIntegration('sendKeys with delay=2 waits ~2s before sending text', async () => {
  execFileSync('tmux', ['send-keys', '-t', pane, 'C-u']);
  await new Promise((r) => setTimeout(r, 100));
  execFileSync('tmux', ['send-keys', '-t', pane, 'clear', 'Enter']);
  await new Promise((r) => setTimeout(r, 200));

  const before = Date.now();
  await sendKeys(pane, 'TEST_WITH_WAKE_99', 2);
  const elapsed = Date.now() - before;

  // Expected: ~2000ms wake + ~300ms inter-key delay = ~2300ms minimum
  if (elapsed < 2000) return `took ${elapsed}ms, expected >=2000ms (wake delay missing)`;
  if (elapsed > 4000) return `took ${elapsed}ms, expected <4000ms`;

  await new Promise((r) => setTimeout(r, 200));
  const out = capturePane();
  return out.includes('TEST_WITH_WAKE_99') ? true : `pane content: ${out.slice(-200)}`;
});

await runIntegration('sendKeys with delay > 0 sends Enter before text', async () => {
  // To verify Enter is sent first, we'll use a python script that prints
  // distinct markers for each Enter received.
  execFileSync('tmux', ['kill-session', '-t', session]);
  session = `caretest2-${Date.now()}`;
  execFileSync('tmux', [
    'new-session', '-d', '-s', session,
    'sh', '-c', 'i=0; while IFS= read -r line; do i=$((i+1)); echo "LINE$i:$line"; done'
  ]);
  pane = execFileSync('tmux', ['list-panes', '-t', session, '-F', '#{pane_id}'], { encoding: 'utf8' }).trim();
  await new Promise((r) => setTimeout(r, 200));

  await sendKeys(pane, 'PAYLOAD', 1);
  await new Promise((r) => setTimeout(r, 500));

  const out = capturePane();
  // Should see LINE1: (empty from wake Enter) and LINE2:PAYLOAD
  const hasLine1Empty = /LINE1:\s*$/m.test(out);
  const hasLine2Payload = /LINE2:PAYLOAD/.test(out);
  if (!hasLine1Empty) return `wake-Enter didn't produce empty line. Out: ${out.slice(-300)}`;
  if (!hasLine2Payload) return `payload not on line 2. Out: ${out.slice(-300)}`;
  return true;
});

// Cleanup
if (tmuxAvailable && session) {
  try { execFileSync('tmux', ['kill-session', '-t', session]); } catch {}
}

// =============================================================================
console.log('\n' + '='.repeat(60));
console.log(`Results: ${pass} passed, ${fail} failed, ${pass + fail} total`);
console.log('='.repeat(60));
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.reason}`);
  process.exit(1);
}
process.exit(0);
