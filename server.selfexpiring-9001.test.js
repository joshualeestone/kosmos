'use strict';
/**
 * kosmos#9001 (Josh, 11-24 12:44: "I keep getting these"): Claude Code's own safety check on a shell command it cannot
 * read the way the shell will declines by itself in about two minutes ("Claude Code will automatically block this request
 * in 1:59"). Its PermissionRequest hook still fired a needs_you, so Kosmos pushed it to the phone as "asking permission"
 * and showed "Needs permission", for a prompt nobody needs to answer. Now that report is recorded as the plain line it is
 * (working), with no push, and the board's screen reader says the same; a prompt that waits for a person still pushes.
 *
 * The screens are real captures (Claude Code 2.1.331, both in bypass mode, measured 2026-11-24): the self-declining
 * safety check, and a prompt from a permission rule (`ask`), which has no timed line (the control).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9001-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const selfreport = require('./engine/selfreport');
const sendertoken = require('./engine/sendertoken');
const phonenotify = require('./engine/phonenotify');
const chat = require('./engine/chat');
const status = require('./engine/status');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const SELF_EXPIRING = fs.readFileSync(path.join(SCREENS, 'permission-prompt-self-expiring-2.1.331.txt'), 'utf8');
const ASK_RULE = fs.readFileSync(path.join(SCREENS, 'permission-prompt-ask-rule-bypass-2.1.331.txt'), 'utf8');
const WHO = 'casey';
const HOOK_TEXT = 'asking permission to use Bash: cd /tmp/work && for f in ${(f)"$(ls)"}; do rm -rf "$f"; done';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let TOKEN = '';
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': TOKEN }, body: JSON.stringify(body) });
  return res.json();
}

/* One agent whose screen is `screen`, every push this route asks for recorded, and the agent's report state fresh. */
async function withAgent(screen, fn, { runner = 'claude', state = 'working' } = {}) {
  // A clean start: an agent-typed working report (an automatic one cannot replace a standing wait, by design).
  selfreport.record(WHO, { state: 'working', because: 'starting a test' });
  const board = fleet.install([fleet.agent(WHO, { state, runner, command: runner === 'claude' ? 'claude' : 'node', screen })]);
  chat.setRunner((args) => {
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.331\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  const pushes = [];
  const real = phonenotify.happened;
  phonenotify.happened = (ev) => { pushes.push(ev); return true; };
  try {
    TOKEN = sendertoken.mint(WHO).token;
    await fn(pushes);
  } finally {
    phonenotify.happened = real;
    chat.setRunner(null);
    board.restore();
  }
}

test('premises, on the real captures', () => {
  const P = { command: '2.1.331', title: 'x', session: 'x', name: 'x' };
  assert.ok(status.claudePermissionPrompt(SELF_EXPIRING), 'the safety check reads as a permission prompt');
  assert.equal(status.claudeSelfExpiringPrompt(SELF_EXPIRING), true);
  assert.equal(status.claudeSelfExpiringPrompt(ASK_RULE), false, 'a rule prompt in the same mode has no timed line');
  assert.match(SELF_EXPIRING, /will automatically block this request in/);
  // The board's own read of each screen: the safety check is working with the line; the rule prompt still asks.
  assert.deepEqual(status.classify(P, SELF_EXPIRING), { state: status.STATE.WORKING, confidence: 'scraped', because: status.SELF_EXPIRING_DECLINE });
  assert.equal(status.classify(P, ASK_RULE).state, status.STATE.NEEDS_YOU);
  assert.equal(status.classify(P, ASK_RULE).because, status.APPROVAL_WAITING);
});

test('the hook\'s wait for a self-declining safety check is recorded as the plain line: working, no push', async () => {
  await withAgent(SELF_EXPIRING, async (pushes) => {
    const r = await report({ state: 'needs_you', text: HOOK_TEXT, auto: true });
    assert.equal(r.recorded, true, JSON.stringify(r));
    const now = selfreport.read(WHO);
    assert.equal(now.state, 'working', 'never a needs_you');
    assert.equal(now.because, status.SELF_EXPIRING_DECLINE);
    assert.equal(selfreport.isAutoPermissionWait(now), false, 'nothing for the phone notice or "Needs permission" to key on');
    assert.deepEqual(pushes, [], 'no phone push');
  });
});

test('CONTROL: a prompt that waits for a person (a permission rule) still records needs_you and pushes', async () => {
  await withAgent(ASK_RULE, async (pushes) => {
    const r = await report({ state: 'needs_you', text: 'asking permission to use Bash: touch /tmp/work/control-file', auto: true });
    assert.equal(r.recorded, true, JSON.stringify(r));
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1, 'pushed as before');
    assert.equal(pushes[0].kind, 'needs_you');
  }, { state: 'needs_you' });
});

test('only the hook\'s own permission wait from a Claude agent is read this way', async () => {
  // An agent's own question, even with the safety screen up, is the agent asking: kept and pushed.
  await withAgent(SELF_EXPIRING, async (pushes) => {
    await report({ state: 'needs_you', text: HOOK_TEXT });   // the hook's words, but sent by the agent itself (no auto)
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  });
  // Another runner's agent is never judged by Claude Code's screen.
  await withAgent(SELF_EXPIRING, async (pushes) => {
    await report({ state: 'needs_you', text: HOOK_TEXT, auto: true });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  }, { runner: 'codex' });
});

test('a real prompt whose command quotes the timed line is NOT taken for the safety check: it still waits and pushes', async () => {
  // Round 1's blocker: an agent grepping this very code. The phrase, even the whole timed line, inside the box.
  for (const cmd of ['grep -rn "will automatically block this request in" engine/', 'echo "⚠ Claude Code will automatically block this request in 1:59 not ruled out"']) {
    const screen = ASK_RULE.replace('touch /tmp/work/control-file\n', cmd + '\n');
    assert.notEqual(screen, ASK_RULE, 'premise: the command was replaced');
    assert.equal(status.claudeSelfExpiringPrompt(screen), false, cmd);
    await withAgent(screen, async (pushes) => {
      await report({ state: 'needs_you', text: 'asking permission to use Bash: ' + cmd, auto: true });
      assert.equal(selfreport.read(WHO).state, 'needs_you', cmd);
      assert.equal(pushes.length, 1, cmd);
    }, { state: 'needs_you' });
  }
});

test('only a "Bash command" box with the safety reason AND the timed line is the safety check', () => {
  assert.equal(status.claudeSelfExpiringPrompt(SELF_EXPIRING.replace(' Bash command\n', ' Edit file\n')), false, 'another kind of prompt with a timer waits for a person');
  assert.equal(status.claudeSelfExpiringPrompt(SELF_EXPIRING.replace(/Dangerous rm operation not ruled out[^\n]*/, 'Some other reason')), false, 'a timer with no safety reason');
  assert.equal(status.claudeSelfExpiringPrompt(SELF_EXPIRING.replace(/will automatically block this request in 1:59/, 'will block')), false, 'a reason with no timer');
  const selector = SELF_EXPIRING.replace('⚠ Claude Code', '⚠\uFE0F Claude Code');
  assert.notEqual(selector, SELF_EXPIRING, 'premise: the mark was found and changed');
  assert.equal(status.claudeSelfExpiringPrompt(selector), true, 'the mark with its variation selector');
  assert.equal(status.claudeSelfExpiringPrompt(SELF_EXPIRING.replace(/⚠ Claude Code will automatically block this request in 1:59/, 'a note says it will automatically block this request in 1:59')), false,
    'the words below the box, but not as Claude Code\'s own timed line (its mark and its countdown, anchored)');
});

test('a message typed while the safety check is up is held with words that match the card (nothing to answer)', async () => {
  await withAgent(SELF_EXPIRING, async () => {
    const roster = fleet.install([fleet.agent(WHO, { state: 'working', runner: 'claude', command: 'claude', screen: SELF_EXPIRING })]);
    try {
      assert.equal(chat.menuHeld(WHO, roster.agents), true, 'held: typing would answer the prompt');
      const v = chat.deliverAutomatic(WHO, 'hello', roster.agents);   // the hold's own words, before anything is typed
      assert.match(String(v.because), /declining a command on its screen by itself/);
      assert.doesNotMatch(String(v.because), /answer it in its window/);
    } finally { roster.restore(); }
  });
});

test('a report for another request while the safety check is up (another tool, another command) is kept and pushes', async () => {
  const boxCmd = status.selfExpiringCommand(SELF_EXPIRING);
  assert.ok(boxCmd, 'premise: the box command reads');
  for (const text of ['asking permission to use Edit', 'asking permission to use Bash: npm publish', 'asking permission to use mcp__deploy__run: go',
    // Round 3: a command that starts like the boxed one, or extends it, is another request.
    'asking permission to use Bash: cd /tmp/work', 'asking permission to use Bash: c', 'asking permission to use Bash: ' + boxCmd + ' && npm publish --access public']) {
    await withAgent(SELF_EXPIRING, async (pushes) => {
      await report({ state: 'needs_you', text, auto: true });
      assert.equal(selfreport.read(WHO).state, 'needs_you', text);
      assert.equal(pushes.length, 1, text);
    });
  }
  // CONTROL: the same report for the command in the box, its spacing different, is read as the safety check.
  await withAgent(SELF_EXPIRING, async (pushes) => {
    await report({ state: 'needs_you', text: HOOK_TEXT.replace(' && ', '   &&\n  '), auto: true });
    assert.equal(selfreport.read(WHO).state, 'working');
    assert.deepEqual(pushes, []);
  });
});

test('a long multi-line command (a heredoc), cut at the hook\'s 200 bytes, is still read as the safety check it is', async () => {
  // Built from the real capture: the box draws the whole heredoc, one line per row; the hook sends its first 200 bytes.
  const heredoc = "cd /tmp/work && python3 - <<'EOF'\nimport os, glob\nfor name in glob.glob('*.tmp'):\n    print('removing', name)\n    os.remove(name)\n"
    + "paths = [p for p in os.listdir('.') if p.startswith('scratch-')]\nfor p in paths:\n    os.remove(p)\nprint('done with', len(paths), 'scratch files')\nEOF";
  const boxLine = ' cd /tmp/work && for f in ${(f)"$(ls)"}; do rm -rf "$f"; done\n';
  assert.ok(SELF_EXPIRING.includes(boxLine), 'premise: the capture\'s box line');
  // The box's own line is the last one (the same command is also echoed above the box, where it is not the box).
  const at = SELF_EXPIRING.lastIndexOf(boxLine);
  const screen = SELF_EXPIRING.slice(0, at) + heredoc.split('\n').map((l) => ' ' + l).join('\n') + '\n' + SELF_EXPIRING.slice(at + boxLine.length);
  assert.ok(status.selfExpiringCommand(screen).startsWith("cd /tmp/work && python3 - <<'EOF' import os"), 'premise: the box now holds the heredoc');
  assert.ok(Buffer.byteLength(heredoc) > 200, 'premise: longer than the hook keeps');
  assert.ok(status.claudeSelfExpiringPrompt(screen), 'premise: still the safety prompt');
  const cut = Buffer.from(heredoc).subarray(0, 200).toString('utf8');   // what the hook's `head -c 200` sends
  await withAgent(screen, async (pushes) => {
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ' + cut, auto: true });
    assert.equal(selfreport.read(WHO).state, 'working');
    assert.deepEqual(pushes, []);
  });
  // CONTROL: the same first 30 characters alone (not cut by the hook) are another request, kept.
  await withAgent(screen, async (pushes) => {
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ' + heredoc.slice(0, 30), auto: true });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  });
});

test('a screen that cannot be read keeps the report as sent (any doubt pushes, as before)', async () => {
  await withAgent(SELF_EXPIRING, async (pushes) => {
    chat.setRunner((args) => (args[0] === 'capture-pane' ? { ran: true, spawnFailed: false, status: 1, out: '', err: 'no pane' } : { ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
    await report({ state: 'needs_you', text: HOOK_TEXT, auto: true });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  });
});

/* kosmos#9001 part 1b (Splinter, 22:13): a box TALLER than the window. Measured on Claude Code 2.1.332 at 80x24 with
   Baron's 21:29 command (a 33-line heredoc, paths pointed nowhere): the box's top and its "Bash command" header are cut,
   and Claude Code says so under the options ("↑ 47 more lines"). Part 1 needed the header, so the phone was pushed. */
const TALL = fs.readFileSync(path.join(SCREENS, 'permission-prompt-self-expiring-tall-2.1.332.txt'), 'utf8');
const LONG = 'asking permission to use Bash: ' + Buffer.from("W=/tmp/kosmos-9001/nowhere; python3 -I - $W <<'PY'\n" + 'x'.repeat(400)).subarray(0, 200).toString('utf8');

test('1b premises, on the real tall capture: read as the self-declining prompt, and the board reads it as working', () => {
  const P = { command: '2.1.332', title: 'x', session: 'x', name: 'x' };
  assert.equal(status.selfExpiringCommand(TALL), null, 'premise: part 1 alone could not read it (no box header on screen)');
  assert.ok(status.selfExpiringCutTail(TALL), 'the cut box is read');
  assert.match(TALL, /↑ \d+ more lines/, 'premise: Claude Code says the box is cut');
  assert.equal(status.claudeSelfExpiringPrompt(TALL), true);
  assert.deepEqual(status.classify(P, TALL), { state: status.STATE.WORKING, confidence: 'scraped', because: status.SELF_EXPIRING_DECLINE });
});

test('1b: the hook\'s wait for a tall self-declining prompt is the plain line, no push; a short report is kept', async () => {
  assert.ok(Buffer.byteLength(LONG.slice('asking permission to use Bash: '.length)) >= 190, 'premise: the hook cut the command at its cap');
  await withAgent(TALL, async (pushes) => {
    await report({ state: 'needs_you', text: LONG, auto: true });
    assert.equal(selfreport.read(WHO).state, 'working');
    assert.equal(selfreport.read(WHO).because, status.SELF_EXPIRING_DECLINE);
    assert.deepEqual(pushes, [], 'no phone push');
  });
  // CONTROL: a short command cannot be the box that is taller than the window: another request, kept and pushed.
  await withAgent(TALL, async (pushes) => {
    await report({ state: 'needs_you', text: 'asking permission to use Bash: touch /tmp/work/x', auto: true });
    assert.equal(selfreport.read(WHO).state, 'needs_you');
    assert.equal(pushes.length, 1);
  });
});

test('1b: only a cut box with the timed line BELOW it, the safety reason and Claude Code\'s scroll hint counts', () => {
  const lines = TALL.split('\n');
  const rule = lines.findIndex((l) => /^\s*╌{8,}\s*$/.test(l));
  assert.ok(rule > 0, 'premise: the closing rule is on screen');
  // the timed line moved INSIDE the box (a command quoting it): not the safety prompt
  const timed = lines.findIndex((l) => /will automatically block this request in/.test(l));
  const inside = lines.slice();
  const [t] = inside.splice(timed, 1);
  inside.splice(rule - 1, 0, ' │ ' + t.trim());
  assert.equal(status.selfExpiringCutTail(inside.join('\n')), null, 'a timed line inside the box is the command\'s text');
  // no scroll hint: Claude Code did not say the box is cut
  assert.equal(status.selfExpiringCutTail(lines.filter((l) => !/more lines?\s*$/.test(l)).join('\n')), null, 'no scroll hint');
  // a row above the rule that is not a box row (the header, or agent output): not a cut box
  const outside = lines.slice(); outside.splice(1, 0, '⏺ some earlier output');
  assert.equal(status.selfExpiringCutTail(outside.join('\n')), null, 'a row outside the box above it');
  // no safety reason below the rule
  assert.equal(status.selfExpiringCutTail(lines.filter((l) => !/rule out|not ruled out/.test(l)).join('\n')), null, 'no reason');
});
