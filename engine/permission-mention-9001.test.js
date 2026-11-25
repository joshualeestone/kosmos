'use strict';
/**
 * kosmos#9001 part 1b: Kosmos's PermissionRequest hook (engine/kosmos-permission-allow.js) answers a shell command that
 * only MENTIONS a protected place (.claude, .claude.json, .git), and still leaves one that deletes, moves or writes one
 * to the person.
 *
 * Why: Josh ruled on 10-22 that Claude Code's own safety prompts are approved, and asked again on 11-24 21:30 ("These
 * should automatically be approved and if not I need an approve button"). But the hook stayed silent for any command
 * whose text named a protected place, and 8 of the 9 real safety prompts on the fleet's Mac (11-09 to 11-24) did: mostly
 * a heredoc editing a plan under .claude/plans. Each then reached his phone and declined itself. Splinter narrowed it at
 * 21:34: mentioning, reading or grepping is approved; deleting or moving waits for a person.
 *
 * Measured 11-24 on Claude Code 2.1.332 (`claude -p`, bypass mode, user settings left out): the command below, Baron's
 * from 21:29 with its paths pointed at a folder that does not exist, draws the safety prompt; a PermissionRequest hook
 * answering allow lets it run (it then failed on the missing path), and without one Claude Code refused it.
 *
 * ⚠️ PID( and ZF( are decoded at run time to the two shapes Claude Code refuses (the file itself holds neither).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const hook = require('./kosmos-permission-allow');

const d = (s) => s.replace(/PID\(/g, '$$$$(').replace(/ZF\(/g, '${(');
const req = (command, tool = 'Bash', extra = {}) =>
  JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: { command: d(command), ...extra } });
const answers = (command, tool, extra) => hook.decide(req(command, tool, extra)) !== null;

// Baron's 21:29 command, in its shape: a python heredoc editing a release file and a plan under .claude/plans, whose text
// names the two shapes, then a build and two checks. Paths point at a folder that does not exist.
const BARON = [
  "W=/tmp/kosmos-9001/nowhere; python3 -I - $W <<'PY'",
  'import sys',
  'w=sys.argv[1]',
  'def edit(f, pairs):',
  "    p=w+'/'+f; s=open(p).read()",
  '    for a,b in pairs:',
  '        assert s.count(a)==1, (f,a[:60]); s=s.replace(a,b)',
  "    open(p,'w').write(s)",
  "edit('release/whats-new-pool.json',[('Kosmos refuses a shell command', 'Kosmos refuses two shell shapes (PID( and a zsh ZF( flag)')])",
  "edit('.claude/plans/whatsnew-0822.md',[('- **Built but waiting**', '- **Built but waiting** (#9011 part 2)')])",
  'PY',
  'cd /tmp/kosmos-9001/nowhere && node tools/whats-new-pool.js build 0.8.22 2>&1 | head -3; for pf in mac windows; do node /tmp/kosmos-9001/nowhere/tools/whats-new-check.js 0.8.22 /tmp/kosmos-9001/nowhere/web/whats-new.json --platform=$pf >/dev/null 2>&1; echo "check $pf rc=$?"; done',
].join('\n');

test('#9001 1b: Baron\'s 11-24 command (a plan under .claude, only mentioned) is answered; rm -rf on a .git path is not', () => {
  assert.ok(d(BARON).includes('.claude/plans/'), 'premise: the command names a protected place');
  assert.equal(answers(BARON), true, 'a command that only mentions .claude/plans is approved');
  assert.equal(answers('rm -rf /tmp/w/.git'), false, 'rm -rf on a .git path waits for a person');
  assert.equal(answers(BARON + '\nrm -rf /tmp/w/.git'), false, 'the same command with a delete of .git added waits');
});

test('#9001 1b: mentioning, reading or grepping a protected place is answered', () => {
  for (const c of ['ls .claude; echo', 'cd .git && ls', 'grep -n x /p/.claude/plans/a.md', 'git -C /p/.git log -1',
    'cat ~/.claude.json | head -2', "python3 - <<'PY'\nopen('.claude/plans/x.md','w').write('x')\nPY",
    'echo hi > /p/.claude/plans/x.md', 'cp notes.md /p/.claude/plans/notes.md', 'echo ZF(f)x} .claude']) {
    assert.equal(answers(c), true, c);
  }
});

test('#9001 1b: deleting, moving or (outside a plan) writing a protected place waits for a person', () => {
  for (const c of ['rm -rf /p/.git', 'rm -f ~/.claude.json', 'rm -rf /p/.claude/plans', 'RM -rf .git', '\\rm -rf .git',
    '/bin/rm -rf .git', 'sudo rm -rf .claude', 'rmdir .claude', 'unlink .git/index.lock', 'mv ~/.claude ~/.claude.bak',
    'find /p/.git -name x -delete', 'find /p/.claude -type f -exec rm {} +', 'git -C /p clean -fdx .claude',
    'git rm -r --cached .claude', 'Remove-Item -Recurse C:\\p\\.git', 'Move-Item C:\\p\\.claude C:\\old',
    'cat x > .git/hooks/pre-commit', 'echo y >> ~/.claude/settings.json', 'cat>.git/hooks/x',
    'echo x | tee .claude/settings.local.json', 'cp a /p/.claude/settings.json', "sed -i '' s/a/b/ .claude/settings.json",
    'ln -s /tmp/x /p/.git/hooks/pre-push', ': .claude; rm /tmp/y']) {
    assert.equal(answers(c), false, c);
  }
});

test('#9001 1b: controls; nothing changes where no protected place is named, or for the file tools', () => {
  assert.equal(answers('rm -rf /tmp/x'), true, 'a delete that names no protected place was answered before and still is');
  assert.equal(answers('ls /p/.github; rm -f /p/repo.git/x'), true, '.github and repo.git are not protected places');
  // Only the command decides for a shell call: a description is words about it.
  assert.equal(answers('ls /tmp', 'Bash', { description: 'removes /p/.git' }), true, 'a description does not decide');
  // The file tools keep #5406's rule: any protected place, read or write, is left to the person.
  const file = (tool, input) => hook.decide(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input }));
  assert.equal(file('Edit', { file_path: '/p/.claude/plans/x.md' }), null, 'Edit on a plan under .claude: unchanged, left to the person');
  assert.equal(file('Write', { file_path: '/p/.git/config' }), null);
  // A shell call whose command is not text is judged the old way (any string anywhere).
  assert.equal(file('Bash', { command: ['rm', '.git'] }), null);
  assert.ok(file('Bash', { command: ['ls', '/tmp'] }));
});

test('#9001 1b: the real hook script answers Baron\'s command on stdout, and stays silent for rm -rf on .git', () => {
  const run = (input) => spawnSync(process.execPath, [path.join(__dirname, 'kosmos-permission-allow.js')], { input, encoding: 'utf8', timeout: 20000 });
  const yes = run(req(BARON));
  assert.equal(yes.status, 0);
  assert.equal(JSON.parse(yes.stdout).hookSpecificOutput.decision.behavior, 'allow');
  const no = run(req('rm -rf /tmp/w/.git'));
  assert.equal(no.status, 0);
  assert.equal(no.stdout, '', 'silent: Claude Code shows its prompt to the person');
});
