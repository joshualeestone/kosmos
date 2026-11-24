'use strict';
/**
 * kosmos#9001 part 2: the report hook refuses, before it runs, a Bash command that Claude Code's own safety check
 * would put to the person as a self-declining permission prompt ("Claude Code can't be sure it read this command the
 * way the shell will ... will automatically block this request"), and says how to write it instead.
 *
 * Every case is measured, not assumed: Claude Code 2.1.331 run as `claude -p` in bypass mode with no user settings,
 * one command per run, reading whether the tool result was the safety check's refusal (2026-11-24, 59 commands). The
 * REFUSED and RAN lists below are those measurements; the guard must agree with Claude Code on each.
 *
 * ⚠️ Written with placeholders, decoded at run time: PID( is the three characters dollar, dollar, open paren, and ZF(
 * is dollar, open brace, open paren. So no command an agent runs on this file (a grep, a sed) holds the shapes itself.
 *
 * The CLI the hook reports through is a stub (KOSMOS_REPORT_CLI); nothing here reaches a board and no command is run.
 *
 * CONTROLS: the RAN list must exit 0 (a guard that refuses everything fails), the allow-hook arm must let a shape run
 * when Kosmos's allow hook would answer, and KOSMOS_SHAPE_GUARD=off, no perl, and another tool must all exit 0.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it is the Mac and Linux report hook (install/kosmos-report-hook.sh), run through /bin/bash by an absolute POSIX path; Windows agents use engine/kosmos-report-hook.js');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const ALLOW = path.join(__dirname, 'engine', 'kosmos-permission-allow.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-9001-'));
const STUB = path.join(SANDBOX, 'kosmos');
fs.writeFileSync(STUB, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const d = (s) => s.replace(/PID\(/g, '$$$$(').replace(/ZF\(/g, '${(');

// By default each call is a Kosmos agent's (the allow hook is present) naming a plan file under .claude in its
// description, so the allow hook steps aside: the one case where Claude Code's prompt reaches the person, and so the
// one case the guard judges. The allow-hook test below takes each of those away in turn.
const PLAN = 'edits /tmp/w/.claude/plans/x.md';
function run(command, { tool = 'Bash', allowHook = true, protectedName = true, env: extra = {}, input } = {}) {
  const toolInput = input || { command: d(command), ...(protectedName ? { description: PLAN } : {}) };
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, session_id: 's' });
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX, ...extra };
  for (const k of ['TMUX_PANE', 'KOSMOS_AGENT_SESSION', 'KOSMOS_AGENT_TOKEN', 'KOSMOS_SHAPE_GUARD', 'KOSMOS_KILL_GUARD',
    'KOSMOS_REPORT_HOOK_NO_PERL', 'KOSMOS_PERMISSION_ALLOW_NODE', 'KOSMOS_PERMISSION_ALLOW_SCRIPT']) {
    if (!(k in extra)) delete env[k];
  }
  if (allowHook) { env.KOSMOS_PERMISSION_ALLOW_NODE = process.execPath; env.KOSMOS_PERMISSION_ALLOW_SCRIPT = ALLOW; }
  const r = spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, stderr: r.stderr || '' };
}

// Refused by Claude Code 2.1.331 (measured). Txx is the probe's case number.
const REFUSED = [
  ['T01 a zsh line split in a loop', `for f in ZF(f)"$(printf 'a\\nb')"}; do echo "$f"; done`, 'zsh'],
  ['T04 zsh unique', 'x=(a b a); echo ZF(u)x}', 'zsh'],
  ['T11 nested flags in double quotes', `echo "ZF(j:,:)ZF(f)"$(printf 'a\\nb')"}}"`, 'zsh'],
  ['T15 a flag in an UNQUOTED heredoc body', 'x=a; cat <<EOF\nZF(f)x}\nEOF', 'zsh'],
  ['T16 a flag in double quotes', 'x=a; echo "ZF(f)x}"', 'zsh'],
  ['T40 page.PID( in a QUOTED heredoc body', "cat <<'PY'\nx = page.PID('a')\nPY", 'pid'],
  ['T45 PID( in a quoted heredoc', "cat <<'PY'\nx = PID(a)\nPY", 'pid'],
  ['T50 PID( in single quotes', "echo 'page.PID(a)'", 'pid'],
  ['T51 PID( in a comment', 'echo "x" # page.PID(a)', 'pid'],
  ['T52 PID( at the end, in a comment', "python3 -c 'print(1)' # PID(", 'pid'],
  ['T56 PID( in a printf argument', `printf '%s\\n' 'page.PID("a")'`, 'pid'],
  ['real shape: a python heredoc editing a browser check (2026-11-16)',
    "ROOT=/tmp/w; python3 - \"$ROOT/a.js\" <<'PY'\nimport sys\ns=open(sys.argv[1]).read()\ns+=\"chk((await page.PID('.ptabs button')).length === 8, 'chips wrap')\"\nopen(sys.argv[1],'w').write(s)\nPY", 'pid'],
  ['real shape: a file list made unique (2026-11-20)', 'files=($(grep -rl x /tmp/w)); files=(ZF(u)files}); echo "${#files[@]}"', 'zsh'],
];
// Run by Claude Code 2.1.331 with no prompt (measured): the guard must let each one run.
const RAN = [
  ['T02 a flag in single quotes', "echo 'ZF(f)x}'"],
  ['T03 grep for the flag, single quoted', "grep -c 'ZF(f)' /dev/null; echo done"],
  ['T05 a plain loop', 'for f in a b; do echo $f; done'],
  ['T06 a python heredoc after cd', "cd /tmp/w && python3 - <<'EOF'\nprint(\"hi\")\nEOF"],
  ['T08 rm on a variable path', 'D=/tmp/w; rm -f "$D/none"'],
  ['T10 the plain line loop the message suggests', `while IFS= read -r f; do echo "$f"; done <<< "$(printf 'a\\nb')"`],
  ['T12 zsh word split', 'x="a b"; echo ${=x}'],
  ['T13 zsh tail modifier', 'f=/a/b.txt; echo ${f:t}'],
  ['T14 a flag in a QUOTED heredoc body', "cat <<'EOF'\nZF(f)x}\nEOF"],
  ['T17 rm under a mktemp folder', 'D=$(mktemp -d); rm -rf "$D/x"'],
  ['T18 rm on an unset variable', 'rm -rf "$NOPE_9001/none-9001"'],
  ['T20 a flag in a comment', 'echo a # ZF(f)x}'],
  ['T25 a flag in a quoted python heredoc', "python3 - <<'EOF'\nprint('ZF(f)x}')\nEOF"],
  ['T30 an apostrophe in a quoted heredoc', "python3 - <<'EOF'\nprint(\"April's\")\nEOF"],
  ['T46 the escaped form the message suggests', 'cat <<PY\nx = \\$\\$(a)\nPY'],
  ['T53 a bare $$ in double quotes', `node -e 'const x = 1' && echo "$$"`],
  ['T54 $$ then a space and a paren', 'echo $$ (a)'],
  ['T55 an escaped pattern for it', "grep -c 'page\\.\\$\\$(' /dev/null; echo done"],
  ['T60 $?( in quotes', "echo '$?(a)'"], ['T61 $!(', "echo '$!(a)'"], ['T62 $#(', "echo '$#(a)'"],
  ['T63 $1(', "echo '$1(a)'"], ['T65 $_(', "echo '$_(a)'"], ['T67 $*(', "echo '$*(a)'"],
  ['T69 $a(', "echo '$a(a)'"], ['T70 ${a}(', "echo '${a}(a)'"], ['T71 a$$b(c)', "echo 'a$$b(c)'"],
];

test('every command Claude Code refused (measured) is refused, with the matching way out', { skip: SKIP_POSIX_SHELL }, () => {
  for (const [name, cmd, kind] of REFUSED) {
    const r = run(cmd);
    assert.equal(r.code, 2, `${name}: should be refused (got ${r.code}) ${r.stderr}`);
    assert.match(r.stderr, /kosmos#9001/, name);
    if (kind === 'pid') assert.match(r.stderr, /Write or Edit tool and run that file/, `${name}: the file advice`);
    else assert.match(r.stderr, /while IFS= read -r line/, `${name}: the plain loop`);
  }
});

test('every command Claude Code ran (measured) runs: no refusal, no message', { skip: SKIP_POSIX_SHELL }, () => {
  for (const [name, cmd] of RAN) {
    const r = run(cmd);
    assert.equal(r.code, 0, `${name}: should run (got ${r.code}) ${r.stderr}`);
    assert.equal(r.stderr, '', name);
  }
});

test('only where the prompt would reach the person: the allow hook answers, it runs (as today); it steps aside, refused',
  { skip: SKIP_POSIX_SHELL }, () => {
    const plain = "cat <<'PY'\nx = page.PID('a')\nPY";
    assert.equal(run(plain).code, 2, 'premise: a Kosmos agent, naming .claude: refused');
    assert.equal(run(plain, { protectedName: false }).code, 0, 'the allow hook answers: it runs, as today');
    assert.equal(run('x=a; echo "ZF(f)x}"', { protectedName: false }).code, 0, 'zsh, the allow hook answers');
    // The allow hook steps aside for a protected place named in the command itself, too.
    const plan = "python3 - /tmp/w/.claude/plans/x.md <<'PY'\nx = page.PID('a')\nPY";
    assert.equal(run(plan, { protectedName: false }).code, 2, '.claude in the command');
    assert.equal(run('for f in ZF(f)x}; do git -C /tmp/w/.git log; done', { protectedName: false }).code, 2, '.git, zsh');
    assert.equal(run('echo ZF(f)x} > ~/.claude.json.bak', { protectedName: false }).code, 2, '.claude.json');
    // No allow hook: the person's own Claude Code (setup wires this hook there too), where the prompt is theirs to
    // answer at their own screen. Left alone, even naming .claude (review round 1).
    assert.equal(run(plain, { allowHook: false }).code, 0, "the person's own session: runs, the prompt is theirs");
    assert.equal(run('x=a; echo "ZF(f)x}"', { allowHook: false }).code, 0, "the person's own session, zsh");
    // An allow-hook path that is not the allow hook is no hook: left alone too.
    assert.equal(run(plain, { allowHook: false, env: { KOSMOS_PERMISSION_ALLOW_NODE: process.execPath, KOSMOS_PERMISSION_ALLOW_SCRIPT: path.join(SANDBOX, 'kosmos-permission-allow.js') } }).code, 0,
      'an allow-hook script that does not exist: not a Kosmos agent');
    // Text beyond ASCII survives the rename to PermissionRequest (the allow hook still reads it).
    assert.equal(run("cat <<'PY'\nx = page.PID('café ✓')\nPY", { protectedName: false }).code, 0, 'non-ASCII, the allow hook answers');
    assert.equal(run("cat <<'PY'\nx = page.PID('café ✓')\nPY").code, 2, 'non-ASCII, naming .claude');
  });

test('controls: switched off, no perl, another tool, another event, unreadable input: all run', { skip: SKIP_POSIX_SHELL }, () => {
  const shape = "echo 'page.PID(a)'";
  assert.equal(run(shape).code, 2, 'premise: the shape is refused');
  assert.equal(run(shape, { env: { KOSMOS_SHAPE_GUARD: 'off' } }).code, 0, 'KOSMOS_SHAPE_GUARD=off');
  assert.equal(run(shape, { env: { KOSMOS_REPORT_HOOK_NO_PERL: '1' } }).code, 0, 'no perl: fails open');
  assert.equal(run(null, { tool: 'Write', input: { file_path: '/tmp/w/a.test.js', content: d("const r = await page.PID('li');") } }).code, 0,
    'a Write holding it: Claude Code checks only shell commands');
  assert.equal(run(null, { input: { command: 42 } }).code, 0, 'a command that is not text');
  const payload = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: d(shape) } });
  const env = { ...process.env, KOSMOS_REPORT_CLI: STUB, TMPDIR: SANDBOX, HOME: SANDBOX };
  delete env.TMUX_PANE; delete env.KOSMOS_SHAPE_GUARD; delete env.KOSMOS_PERMISSION_ALLOW_NODE; delete env.KOSMOS_PERMISSION_ALLOW_SCRIPT;
  assert.equal(spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8' }).status, 0, 'only PreToolUse refuses');
});

test('the reader: quotes, escapes, $\'...\', nested $( ) in double quotes, <<- heredocs', { skip: SKIP_POSIX_SHELL }, () => {
  assert.equal(run("echo $'ZF(f)x}'").code, 0, "$'...' is literal");
  assert.equal(run('echo \\ZF(f)x}').code, 0, 'a backslash before the dollar');
  assert.equal(run('echo "\\ZF(f)x}"').code, 0, 'an escaped dollar in double quotes');
  assert.equal(run(`echo "$(echo 'a') ZF(f)x}"`).code, 2, 'a flag after a $( ) inside double quotes');
  assert.equal(run(`echo "$(printf '%s' "ZF(f)x}")"`).code, 2, 'a flag in double quotes inside $( ) inside double quotes');
  assert.equal(run('cat <<-EOF\n\tZF(f)x}\n\tEOF').code, 2, '<<- unquoted: the body is read');
  assert.equal(run("cat <<-'EOF'\n\tZF(f)x}\n\tEOF\necho ok").code, 0, '<<- quoted: not read, and its end is found');
  assert.equal(run("cat <<'EOF'\nfine\nEOF\necho ZF(f)x}").code, 2, 'a flag AFTER a quoted heredoc ends is read');
  assert.equal(run('cat <<\\EOF\nZF(f)x}\nEOF').code, 0, '<<\\EOF is a quoted delimiter');
  assert.equal(run('cat <<EOF\n\\ZF(f)x}\nEOF').code, 0, 'an escaped dollar in an unquoted heredoc');
  assert.equal(run("x=1 # it's\necho ZF(f)x}").code, 2, 'an apostrophe in a comment does not open a quote');
  // review round 1: <<< is a here-string, not a heredoc that swallows the lines after it
  assert.equal(run('cat <<< "ZF(f)x}"').code, 2, 'a flag in a here-string, double quoted');
  assert.equal(run('cat <<< "a"\necho ZF(f)x}').code, 2, 'a here-string does not hide the next line');
  assert.equal(run(`while IFS= read -r l; do echo "$l"; done <<< "$(printf 'a')"`).code, 0, 'the suggested form itself runs');
  // review round 1: backticks are their own unquoted level, also inside double quotes
  assert.equal(run("echo \"`echo 'ZF(f)x}'`\"").code, 0, 'single quotes inside backticks inside double quotes');
  assert.equal(run('echo `echo ZF(f)x}`').code, 2, 'a flag inside backticks');
  assert.equal(run("echo `echo 'a'` ZF(f)x}").code, 2, 'a flag after backticks close');
});
