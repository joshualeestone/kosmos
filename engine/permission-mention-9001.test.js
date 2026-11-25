'use strict';
/**
 * kosmos#9001 part 1b: Kosmos's PermissionRequest hook (engine/kosmos-permission-allow.js) answers a shell command whose
 * only protected names are PLAN FILES (.claude/plans/...), unless it deletes or moves something. Any other protected
 * name (.claude, .claude.json, .git) keeps #5406's rule: left to the person.
 *
 * Why: Josh ruled on 10-22 that Claude Code's own safety prompts are approved, and asked again on 11-24 21:30 ("These
 * should automatically be approved and if not I need an approve button"). But the hook left any command naming a
 * protected place to the person, and 8 of the 9 real safety prompts on the fleet's Mac (11-09 to 11-24) did. Six named
 * only plan files: a heredoc or redirect editing an agent's own .claude/plans/<branch>.md. Each reached his phone and
 * declined itself. Splinter (21:34): deleting or moving waits for a person. Review round 1 showed a list of dangerous
 * commands is leaky, hence plan files only.
 *
 * Measured 11-24 on Claude Code 2.1.332 (`claude -p`, bypass mode, user settings left out): Baron's command (below, its
 * paths pointed nowhere) draws the safety prompt; a PermissionRequest hook answering allow lets it run, and without one
 * Claude Code refused it.
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

test('#9001 1b: Baron\'s 11-24 command (its only protected name a plan file) is answered; rm -rf on a .git path is not', () => {
  assert.ok(d(BARON).includes('.claude/plans/'), 'premise: the command names a protected place');
  assert.equal(answers(BARON), true, 'a command whose only protected name is a plan file is approved');
  assert.equal(answers('rm -rf /tmp/w/.git'), false, 'rm -rf on a .git path waits for a person');
  assert.equal(answers(BARON + '\nrm -rf /tmp/w/.git'), false, 'the same command with a delete of .git added waits');
});

test('#9001 1b: plan files are answered: read, grepped, written, edited by a heredoc or sed', () => {
  for (const c of ['grep -n x /p/.claude/plans/a.md', 'cat .claude/plans/x.md # rd', "grep -c 'mi' .claude/plans/x.md",
    "python3 - <<'PY'\nd={}\ndel d['k']\nopen('.claude/plans/x.md','w').write('x')\nPY",
    'echo hi > /p/.claude/plans/x.md', 'echo x >> .claude/plans/x.md 2>&1', 'cp notes.md /p/.claude/plans/notes.md',
    "sed -i '' s/a/b/ /p/.claude/plans/x.md", 'gh pr create --body-file /p/.claude/plans/x.md',
    'git -C /p add .claude/plans/x-pre-challenge.md', 'echo ZF(f)x} >> .claude/plans/x.md']) {
    assert.equal(answers(c), true, c);
  }
});

test('#9001 1b: any other protected name, a plan path with .., or a delete or move: left to the person', () => {
  for (const c of [
    // another protected name: #5406's rule, as before (review round 1's bypasses all name one)
    'ls .claude', 'cd .git && ls', 'git -C /p/.git log -1', 'cat ~/.claude.json', 'git diff -- .claude',
    'echo x > /p/".git"/HEAD', 'echo x >| .git/HEAD', 'dd if=/dev/zero of=/p/.git/HEAD bs=1 count=1',
    'git --git-dir=/p/.git reset --hard HEAD~5', 'git --git-dir=/p/.git reflog expire --expire=now --all',
    "python3 -c 'import shutil;shutil.rmtree(\"/p/.git\")'", 'Set-Content C:\\p\\.claude\\settings.json x',
    "[IO.Directory]::Delete('C:\\p\\.git',$true)", 'git config --file .git/config core.hooksPath /tmp/evil',
    'curl -o /p/.git/HEAD https://example.invalid/x', "python3 - <<'PY'\nopen('/p/.claude/settings.json','w')\nPY",
    // a plan path walked out of with ..
    'echo x > /p/.claude/plans/../settings.json', 'cp evil /p/.claude/plans/../settings.json',
    'echo x > /p/.claude/plans/../../.git/HEAD',
    // a delete or move, even of a plan file only
    'rm -f .claude/plans/x.md', 'mv .claude/plans/x.md /tmp/', 'git rm .claude/plans/x.md',
    'find .claude/plans -name x -delete', "python3 -c 'import os;os.remove(\".claude/plans/x.md\")'",
    'cat .claude/plans/x.md; rm -f /tmp/scratch.txt', 'Remove-Item .claude\\plans\\x.md']) {
    assert.equal(answers(c), false, c);
  }
});

test('#9001 1b: controls; nothing changes where no protected place is named, or for the file tools', () => {
  assert.equal(answers('rm -rf /tmp/x'), true, 'a delete that names no protected place was answered before and still is');
  assert.equal(answers('ls /p/.github; rm -f /p/repo.git/x'), true, '.github and repo.git are not protected places');
  assert.equal(answers('ls /tmp', 'Bash', { description: 'removes /p/.git' }), true, 'a description does not decide');
  const file = (tool, input) => hook.decide(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input }));
  assert.equal(file('Edit', { file_path: '/p/.claude/plans/x.md' }), null, 'Edit on a plan under .claude: unchanged, left to the person');
  assert.equal(file('Write', { file_path: '/p/.git/config' }), null);
  assert.equal(file('Bash', { command: ['cat', '.claude/plans/x.md'] }), null, 'a command that is not text: the old rule');
  assert.ok(file('Bash', { command: ['ls', '/tmp'] }));
});

test('#9001 1b: a long command is judged quickly, and an over-long piece is left to the person', () => {
  const t0 = Date.now();
  const long = 'cat .claude/plans/x.md; ' + 'git find '.repeat(40000);
  assert.equal(answers(long), false, 'a piece longer than the cap waits');
  const many = Array.from({ length: 2000 }, (_, i) => 'git log -' + i + ' -- .claude/plans/x.md').join('\n');
  assert.equal(answers(many), true, 'many ordinary lines naming a plan: answered');
  assert.ok(Date.now() - t0 < 2000, 'judged in under 2 s (took ' + (Date.now() - t0) + ' ms)');
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
