'use strict';
/* kosmos#8048 item 3: what an agent would lose moving between two Claude account folders. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const carry = require('./accountcarry');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-carry-8048-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let n = 0;
/* A folder shaped as Claude Code reads one: skills/<name>/SKILL.md, and settings.json's hooks by event. */
function folder({ skills = [], hooks = [], settings } = {}) {
  const d = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(path.join(d, 'skills'), { recursive: true });
  for (const s of skills) { fs.mkdirSync(path.join(d, 'skills', s)); fs.writeFileSync(path.join(d, 'skills', s, 'SKILL.md'), '# x\n'); }
  const body = settings !== undefined ? settings
    : JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: hooks.map((c) => ({ type: 'command', command: c })) }] } });
  fs.writeFileSync(path.join(d, 'settings.json'), body);
  return d;
}

/* A home of its own, with the gate scripts in it: hook paths resolve against it, never the runner's real home. */
const HOMEDIR = path.join(TMP, 'home');
for (const g of ['pre-challenge-gate.sh', 'destructive-cmd-gate.sh', 'vercel-login-gate.sh']) {
  fs.mkdirSync(path.join(HOMEDIR, '.claude', 'hooks', 'user'), { recursive: true });
  fs.writeFileSync(path.join(HOMEDIR, '.claude', 'hooks', 'user', g), `#!/bin/sh\n# ${g}\n`);
}
const H = { home: HOMEDIR };

test('kosmos#8048: the drift measured on Mortals is named: two skills and two gates in the main folder only', () => {
  const main = folder({ skills: ['pick-up', 'design-shots', 'verify-release'],
    hooks: ['bash ~/.claude/hooks/user/pre-challenge-gate.sh', 'bash ~/.claude/hooks/user/destructive-cmd-gate.sh', 'bash ~/.claude/hooks/user/vercel-login-gate.sh'] });
  const acct = folder({ skills: ['pick-up'], hooks: ['bash $HOME/.claude/hooks/user/pre-challenge-gate.sh'] });
  const l = carry.losses(main, acct, H);
  assert.deepEqual(l, { ok: true, skills: ['design-shots', 'verify-release'], changed: [], hooks: ['destructive-cmd-gate.sh', 'vercel-login-gate.sh'], hooksChanged: [] },
    'the loss was not named (the pre-challenge gate, spelled with $HOME, must count as kept)');
  assert.equal(carry.sentence(l), 'On that account it would not have the skills design-shots, verify-release, or the hooks destructive-cmd-gate.sh, vercel-login-gate.sh it has now.');
  // CONTROL: the other way, nothing the account folder has is missing from the main one.
  assert.deepEqual(carry.losses(acct, main, H), { ok: true, skills: [], changed: [], hooks: [], hooksChanged: [] });
  assert.equal(carry.sentence(carry.losses(acct, main, H)), null);
});

test('kosmos#8048: a linked skills folder (how Agent1s shares one) counts as having them', () => {
  const main = folder({ skills: ['pick-up', 'design-shots'] });
  const acct = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(acct);
  fs.symlinkSync(path.join(main, 'skills'), path.join(acct, 'skills'));
  fs.symlinkSync(path.join(main, 'settings.json'), path.join(acct, 'settings.json'));
  assert.deepEqual(carry.losses(main, acct), { ok: true, skills: [], changed: [], hooks: [], hooksChanged: [] }, 'a linked folder read as missing its skills');
  // Each skill linked on its own (a skills/ folder of links) counts too.
  const perSkill = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(path.join(perSkill, 'skills'), { recursive: true });
  for (const s of ['pick-up', 'design-shots']) fs.symlinkSync(path.join(main, 'skills', s), path.join(perSkill, 'skills', s));
  assert.deepEqual(carry.losses(main, perSkill).skills, [], 'skills linked one by one read as missing');
});

test('kosmos#8048: a folder that cannot be read is "cannot tell", never "nothing lost"', () => {
  const ok = folder({ skills: ['a'], hooks: ['echo x'] });   // #8063: inline, so the control is not a script it cannot resolve
  const broken = folder({ settings: '{ not json' });
  assert.equal(carry.losses(ok, broken).ok, false, 'a target whose settings do not parse read as safe');
  assert.match(carry.losses(ok, broken).because, /account it would move to/);
  assert.equal(carry.losses(broken, ok).ok, false, 'a source whose settings do not parse read as safe');
  assert.match(carry.losses(broken, ok).because, /account it is on/);
  const noSkills = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(noSkills);
  fs.writeFileSync(path.join(noSkills, 'skills'), 'a file, not a folder');
  assert.equal(carry.losses(ok, noSkills).ok, false, 'a skills path that is not a folder read as safe');
  // CONTROL: a folder with no skills/ and no settings.json at all is readable, and loses everything the source has.
  const empty = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(empty);
  assert.deepEqual(carry.losses(ok, empty), { ok: true, skills: ['a'], changed: [], hooks: ['echo x'], hooksChanged: [] });
});

test('kosmos#8048: the default account is ~/.claude under the given home', () => {
  const home = path.join(TMP, `home-${++n}`);
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'only-main'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'only-main', 'SKILL.md'), '# only main\n');
  const acct = folder({ skills: [] });
  assert.deepEqual(carry.losses(null, acct, { home }), { ok: true, skills: ['only-main'], changed: [], hooks: [], hooksChanged: [] });
  assert.deepEqual(carry.losses('', acct, { home }).skills, ['only-main']);
});

test('kosmos#8048: a hook is named by the script it runs; an inline command is its own name', () => {
  assert.equal(carry.hookId('bash ~/.claude/hooks/user/pre-challenge-gate.sh'), 'pre-challenge-gate.sh');
  assert.equal(carry.hookId('"$HOME/.claude/hooks/a.js" --flag'), 'a.js');
  assert.equal(carry.hookId('  echo hi  '), 'echo hi');
});

test('kosmos#8048 review 1: a gate counts as kept only if it would fire: same event and matcher, the script there with the same contents, hooks not switched off', () => {
  const gate = 'bash $CLAUDE_CONFIG_DIR/hooks/gate.sh';
  const withGate = (o = {}) => {
    const d = folder({ settings: JSON.stringify({ ...(o.off ? { disableAllHooks: true } : {}),
      hooks: { [o.event || 'PreToolUse']: [{ matcher: o.matcher || 'Bash', hooks: [{ type: 'command', command: gate }] }] } }) });
    if (o.script !== false) { fs.mkdirSync(path.join(d, 'hooks'), { recursive: true }); fs.writeFileSync(path.join(d, 'hooks', 'gate.sh'), o.body || '#!/bin/sh\nexit 0\n'); }
    return d;
  };
  const from = withGate();
  assert.deepEqual(carry.losses(from, withGate(), H).hooks, [], 'CONTROL: the same gate, wired the same, with the same script, was not kept');
  assert.deepEqual(carry.losses(from, withGate({ script: false }), H).hooks, ['gate.sh'], 'a gate whose script is missing on the target read as kept');
  const diff = carry.losses(from, withGate({ body: '#!/bin/sh\nexit 1\n' }), H);
  assert.deepEqual([diff.hooks, diff.hooksChanged, carry.loses(diff)], [[], ['gate.sh'], true], 'a different copy of the gate read as kept, or as missing');
  assert.deepEqual(carry.losses(from, withGate({ event: 'Stop' }), H).hooks, ['gate.sh'], 'a gate wired under another event read as kept');
  assert.deepEqual(carry.losses(from, withGate({ matcher: 'Edit' }), H).hooks, ['gate.sh'], 'a gate on another matcher read as kept');
  assert.deepEqual(carry.losses(from, withGate({ off: true }), H).hooks, ['gate.sh'], 'a target with all hooks switched off read as keeping them');
  // A hook that does not run where the agent is now (its script missing there) is not one it loses.
  assert.deepEqual(carry.losses(withGate({ script: false }), withGate({ script: false }), H).hooks, []);
});

test('kosmos#8048 review 2: a same-named skill with other contents, a hook with other arguments, and a Windows script are compared', () => {
  const skill = (body) => { const d = folder({ skills: ['pick-up'] }); fs.writeFileSync(path.join(d, 'skills', 'pick-up', 'SKILL.md'), body); return d; };
  assert.deepEqual(carry.losses(skill('# new\n'), skill('# new\n'), H).skills, [], 'CONTROL: the same skill was not kept');
  const stale = carry.losses(skill('# new\n'), skill('# old\n'), H);
  assert.deepEqual([stale.skills, stale.changed], [[], ['pick-up']], 'a same-named skill with other contents was not said as a different copy');
  assert.equal(carry.loses(stale), false, 'a different copy counted as a loss');
  assert.equal(carry.sentence(stale), 'That account has a different copy of the skill pick-up.');
  const pre = folder({ hooks: ['bash $HOME/.claude/hooks/user/pre-challenge-gate.sh pre'] });
  const post = folder({ hooks: ['bash $HOME/.claude/hooks/user/pre-challenge-gate.sh post'] });
  assert.deepEqual(carry.losses(pre, post, H).hooks, ['pre-challenge-gate.sh'], 'a hook with other arguments read as the same hook');
  assert.deepEqual(carry.losses(pre, folder({ hooks: ['bash ~/.claude/hooks/user/pre-challenge-gate.sh pre'] }), H).hooks, [], 'CONTROL: the same hook spelled ~ was not kept');
  assert.equal(carry.hookId('powershell -File C:\\hooks\\gate.ps1'), 'gate.ps1');
});

test('kosmos#8048 review 3: $CLAUDE_CONFIG_DIR is unset for the default account, so a hook spelled with it does not fire there', () => {
  const home = path.join(TMP, `home-${++n}`);
  const main = path.join(home, '.claude');
  const acct = path.join(home, '.claude-spare');
  const gate = 'bash $CLAUDE_CONFIG_DIR/hooks/gate.sh';
  for (const d of [main, acct]) {
    fs.mkdirSync(path.join(d, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(d, 'hooks', 'gate.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: gate }] }] } }));
  }
  // Onto the main account: there the gate resolves to /hooks/gate.sh, which does not fire, so it is lost.
  assert.deepEqual(carry.losses(acct, main, { home }).hooks, ['gate.sh'], 'a gate that will not fire on the main account read as kept');
  // Off the main account: the gate never fired there, so it is not one the agent loses.
  assert.deepEqual(carry.losses(main, acct, { home }).hooks, [], 'a gate that never fired on the main account read as lost');
});

test('kosmos#8048 review 4: one hook written two ways is not a loss; a missing target script behind a relative source is', () => {
  const g = (cmd, script = true) => {
    const d = folder({ hooks: [cmd] });
    if (script) { fs.mkdirSync(path.join(HOMEDIR, '.claude', 'hooks'), { recursive: true }); fs.writeFileSync(path.join(HOMEDIR, '.claude', 'hooks', 'g.sh'), '#!/bin/sh\n'); }
    return d;
  };
  assert.deepEqual(carry.losses(g('bash ~/.claude/hooks/g.sh ~/.claude/state'), g('bash $HOME/.claude/hooks/g.sh $HOME/.claude/state'), H).hooks, [],
    'the same hook with its argument spelled ~ and $HOME read as lost');
  assert.deepEqual(carry.losses(g('bash ~/.claude/hooks/g.sh ~/.claude/a'), g('bash ~/.claude/hooks/g.sh ~/.claude/b'), H).hooks, ['g.sh'],
    'CONTROL: a hook with a different argument read as kept');
  /* #8063 item 2: a relative source path cannot be checked at all, so the answer is "cannot tell", not a named loss. */
  const rel = carry.losses(folder({ hooks: ['bash gate.sh'] }), folder({ hooks: ['bash /nonexistent-8048/gate.sh'] }), H);
  assert.equal(rel.ok, false, 'a relative source script was answered as if checked: ' + JSON.stringify(rel));
  assert.match(rel.because, /gate\.sh/);
});

test('kosmos#8048 review 5: shell syntax left in a hook path, a prompt hook, and an empty skill folder on the target are all losses', () => {
  const src = folder({ settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/gate.sh' }] }] } }) });
  fs.mkdirSync(path.join(src, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(src, 'hooks', 'gate.sh'), '#!/bin/sh\n');   // review 7: the :- default now resolves, so the gate needs its script to run
  const empty = folder({ settings: '{}' });
  assert.deepEqual(carry.losses(src, empty, H).hooks, ['gate.sh'], 'a gate spelled with a shell default read as kept when the target has no hooks');
  assert.deepEqual(carry.losses(src, src, H).hooks, [], 'CONTROL: the same spelling on both sides was not kept');
  const prompt = (words) => folder({ settings: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: words }] }] } }) });
  assert.deepEqual(carry.losses(prompt('check the work'), empty, H).hooks, ['a prompt hook on Stop'], 'a prompt hook was never compared');
  assert.deepEqual(carry.losses(prompt('check the work'), prompt('check the work'), H).hooks, [], 'CONTROL: the same prompt hook was not kept');
  const withSkill = folder({ skills: ['pick-up'] });
  const hollow = folder({ skills: [] });
  fs.mkdirSync(path.join(hollow, 'skills', 'pick-up'), { recursive: true });   // the folder, no SKILL.md
  const l = carry.losses(withSkill, hollow, H);
  assert.deepEqual([l.skills, l.changed], [['pick-up'], []], 'a skill folder with no SKILL.md on the target read as a different copy, not a loss');
  assert.equal(carry.loses(l), true);
});

test('kosmos#8048 review 6: a skill is its whole folder; other hook types, matcher spellings and an unreadable script are handled', () => {
  const skill = (extra) => { const d = folder({ skills: ['pick-up'] }); if (extra) { fs.mkdirSync(path.join(d, 'skills', 'pick-up', 'scripts'), { recursive: true }); fs.writeFileSync(path.join(d, 'skills', 'pick-up', 'scripts', 'run.sh'), extra); } return d; };
  assert.deepEqual(carry.losses(skill('#!/bin/sh\n'), skill('#!/bin/sh\n'), H).changed, [], 'CONTROL: the same whole skill differed');
  assert.deepEqual(carry.losses(skill('#!/bin/sh\n'), skill(null), H).changed, ['pick-up'], 'a skill missing its scripts/ (same SKILL.md) read as the same');
  const other = (url) => folder({ settings: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'http', url }] }] } }) });
  const none = folder({ settings: '{}' });
  assert.deepEqual(carry.losses(other('http://a'), none, H).hooks, ['a http hook on Stop'], 'a hook of another type was skipped');
  assert.deepEqual(carry.losses(other('http://a'), other('http://a'), H).hooks, [], 'CONTROL: the same other-type hook was not kept');
  const m = (matcher) => folder({ settings: JSON.stringify({ hooks: { PreToolUse: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', command: 'echo gate' }] }] } }) });
  assert.deepEqual(carry.losses(m(undefined), m('*'), H).hooks, [], 'no matcher and "*" read as different');
  assert.deepEqual(carry.losses(m(''), m('*'), H).hooks, [], '"" and "*" read as different');
  assert.deepEqual(carry.losses(m('Bash'), m('*'), H).hooks, ['echo gate'], 'CONTROL: another matcher read as the same');
  // An account folder's own path as an argument, spelled ~ in one and $CLAUDE_CONFIG_DIR in the other, is one hook.
  const home = path.join(TMP, `home-${++n}`);
  const a = path.join(home, '.claude-a'); const b = path.join(home, '.claude-b');
  for (const [d, arg] of [[a, '~/.claude-a/state'], [b, '$CLAUDE_CONFIG_DIR/state']]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `echo ${arg}` }] }] } }));
  }
  assert.deepEqual(carry.losses(a, b, { home }).hooks, [], 'the folder spelled ~/.claude-a and $CLAUDE_CONFIG_DIR read as different');
  // A source script that is there but cannot be read is "cannot tell", not "does not run here".
  if (process.getuid && process.getuid() !== 0) {
    const s = folder({ hooks: ['bash $CLAUDE_CONFIG_DIR/hooks/locked.sh'] });
    fs.mkdirSync(path.join(s, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(s, 'hooks', 'locked.sh'), '#!/bin/sh\n', { mode: 0o000 });
    assert.equal(carry.losses(s, none, H).ok, false, 'an unreadable source script read as "does not run here"');
  }
});

test('kosmos#8048 review 7: quoted variables and a :- default resolve as the shell does; a link loop ends; matcher alternations are one', () => {
  const home = path.join(TMP, `home-${++n}`);
  const a = path.join(home, '.claude-a'); const b = path.join(home, '.claude-b');
  const wire = (d, cmd, script) => {
    fs.mkdirSync(path.join(d, 'hooks'), { recursive: true });
    if (script) fs.writeFileSync(path.join(d, 'hooks', 'gate.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }] } }));
  };
  wire(a, 'bash "$CLAUDE_CONFIG_DIR"/hooks/gate.sh', true);
  wire(b, '{}', false); fs.writeFileSync(path.join(b, 'settings.json'), '{}');
  assert.deepEqual(carry.losses(a, b, { home }).hooks, ['gate.sh'], 'a gate spelled with a quoted variable read as kept when the target has none');
  wire(a, 'bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/gate.sh', true);
  wire(b, 'bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/gate.sh', false);
  assert.deepEqual(carry.losses(a, b, { home }).hooks, ['gate.sh'], 'the same :- spelling, script missing on the target, read as kept');
  wire(b, 'bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/gate.sh', true);
  assert.deepEqual(carry.losses(a, b, { home }).hooks, [], 'CONTROL: the same :- spelling with the script there was not kept');
  // A skill folder with links back to itself ends.
  const loopy = folder({ skills: ['pick-up'] });
  fs.symlinkSync('.', path.join(loopy, 'skills', 'pick-up', 'x'));
  fs.symlinkSync('.', path.join(loopy, 'skills', 'pick-up', 'y'));
  assert.equal(carry.losses(loopy, loopy, H).ok, true);
  const m = (matcher) => folder({ settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: 'echo gate' }] }] } }) });
  assert.deepEqual(carry.losses(m('Bash|Edit'), m('Edit|Bash'), H).hooks, [], 'Bash|Edit and Edit|Bash read as different');
  assert.deepEqual(carry.losses(m('Bash'), m('^Bash$'), H).hooks, [], 'Bash and ^Bash$ read as different');
  assert.equal(carry.sentence({ ok: true, skills: [], changed: [], hooks: [], hooksChanged: ['gate.sh'] }), "It has a different copy of the hook gate.sh, which may not do what the agent's does now.");
});

test('kosmos#8063 item 1: a hook\'s if, timeout, async and shell are part of its wiring; a narrower if on the target is not the same gate', () => {
  const gate = 'bash $CLAUDE_CONFIG_DIR/hooks/gate.sh';
  const withGate = (extra = {}) => {
    const d = folder({ settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: gate, ...extra }] }] } }) });
    fs.mkdirSync(path.join(d, 'hooks'), { recursive: true }); fs.writeFileSync(path.join(d, 'hooks', 'gate.sh'), '#!/bin/sh\nexit 0\n');
    return d;
  };
  const from = withGate({ if: 'Bash(git push*)' });
  assert.deepEqual(carry.losses(from, withGate({ if: 'Bash(git push*)' }), H).hooks, [], 'CONTROL: the same gate with the same if was not kept');
  assert.deepEqual(carry.losses(from, withGate({ if: 'Bash(git push --force*)' }), H).hooks, ['gate.sh'], 'a gate with a narrower if on the target read as kept');
  assert.deepEqual(carry.losses(from, withGate(), H).hooks, ['gate.sh'], 'a gate whose if differs (absent on the target) read as kept');
  const t = withGate({ timeout: 60 });
  assert.deepEqual(carry.losses(t, withGate({ timeout: 5 }), H).hooks, ['gate.sh'], 'a gate with another timeout read as kept');
  assert.deepEqual(carry.losses(withGate(), withGate({ async: true }), H).hooks, ['gate.sh'], 'a blocking gate made async on the target read as kept');
  assert.deepEqual(carry.losses(withGate(), withGate({ shell: 'powershell' }), H).hooks, ['gate.sh'], 'a gate run by another shell read as kept');
  assert.deepEqual(carry.losses(withGate(), withGate(), H).hooks, [], 'CONTROL: no extra fields on either side was not kept');
  const prompt = (extra) => folder({ settings: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'check it', ...extra }] }] } }) });
  assert.deepEqual(carry.losses(prompt({ if: 'x' }), prompt({}), H).hooks, ['a prompt hook on Stop'], 'a prompt hook\'s if was not compared');
});

test('kosmos#8063 item 2: a script path that cannot be resolved makes the answer "cannot tell", never kept', () => {
  const w = (cmd) => folder({ settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }] } }) });
  /* Measured in review 8: %USERPROFILE% with the script absent on both sides came out hooks: []. */
  const up = carry.losses(w('powershell -File %USERPROFILE%\\hooks\\gate.ps1'), w('powershell -File %USERPROFILE%\\hooks\\gate.ps1'), H);
  assert.equal(up.ok, false, '%USERPROFILE% read as checked: ' + JSON.stringify(up));
  assert.match(up.because, /gate\.ps1/);
  assert.equal(carry.loses(up), false, 'premise: callers read ok false as cannot tell, not as a loss list');
  const sp = carry.losses(w('bash /Users/John Smith/.claude/hooks/gate.sh'), w('bash /Users/John Smith/.claude/hooks/gate.sh'), H);
  assert.equal(sp.ok, false, 'a path with a space read as checked: ' + JSON.stringify(sp));
  /* CONTROL: an inline command (no script) and a resolvable script still answer. */
  assert.equal(carry.losses(w('echo hi'), w('echo hi'), H).ok, true);
  assert.equal(carry.losses(w('bash ~/.claude/hooks/user/pre-challenge-gate.sh'), w('bash ~/.claude/hooks/user/pre-challenge-gate.sh'), H).ok, true);
});

test('kosmos#8063 item 3: a skill is read in bounded bytes and folders, and a cut read still tells copies apart', () => {
  const big = (fill) => { const d = folder({ skills: ['huge'] }); fs.writeFileSync(path.join(d, 'skills', 'huge', 'blob.bin'), Buffer.alloc(3 * 1024 * 1024, fill)); return d; };
  const a = big(1);
  assert.deepEqual(carry.losses(a, big(1), H).changed, [], 'CONTROL: the same large skill read as different');
  /* Same first megabyte, different size: still a different copy. */
  const b = folder({ skills: ['huge'] }); fs.writeFileSync(path.join(b, 'skills', 'huge', 'blob.bin'), Buffer.alloc(2 * 1024 * 1024, 1));
  assert.deepEqual(carry.losses(a, b, H).changed, ['huge'], 'a large file with another size read as the same');
  /* The walk stops at 200 folders: two skills that differ only in folder 250 read as the same copy. That is the
     stated cost of the bound, asserted so a lost bound (an unbounded walk on the board's thread) turns this red. */
  const wide = (odd) => {
    const d = folder({ skills: ['wide'] });
    for (let i = 0; i < 300; i++) { const f = path.join(d, 'skills', 'wide', 'd' + String(i).padStart(4, '0')); fs.mkdirSync(f); fs.writeFileSync(path.join(f, 'f.txt'), i === 250 && odd ? 'other' : 'same'); }
    return d;
  };
  const w = carry.losses(wide(false), wide(true), H);
  assert.equal(w.ok, true);
  assert.deepEqual(w.changed, [], 'the walk went past 200 folders');
  /* CONTROL: a difference inside the first folders is still seen. */
  const early = wide(false); fs.writeFileSync(path.join(early, 'skills', 'wide', 'd0003', 'f.txt'), 'other');
  assert.deepEqual(carry.losses(wide(false), early, H).changed, ['wide'], 'a difference before the cut was not seen');
});

test('kosmos#8063 review 1: the exec form is compared by its arguments, and its script resolved as one word', () => {
  const ex = (args, scriptAt) => {
    const d = folder({ settings: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args }] }] } }) });
    if (scriptAt) { fs.mkdirSync(path.dirname(scriptAt), { recursive: true }); fs.writeFileSync(scriptAt, '// gate\n'); }
    return d;
  };
  const gate = path.join(TMP, 'exec dir', 'gate.js');   // a space in the path, as on Windows
  const other = path.join(TMP, 'exec dir', 'other.js');
  const a = ex([gate], gate);
  assert.deepEqual(carry.losses(a, ex([gate], gate), H).hooks, [], 'CONTROL: the same exec hook was not kept');
  assert.deepEqual(carry.losses(a, ex([other], other), H).hooks, ['gate.js'], 'an exec hook running another script read as kept');
  assert.deepEqual(carry.losses(a, ex([gate, '--strict'], gate), H).hooks, ['gate.js'], 'an exec hook with other arguments read as kept');
});

test('kosmos#8063 review 1: what is known is said beside a hook that cannot be checked; $CLAUDE_PROJECT_DIR and a relative path resolve in the agent folder', () => {
  const w = (cmd, skills = []) => folder({ skills, settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }] } }) });
  const l = carry.losses(w('powershell -File %USERPROFILE%\\hooks\\gate.ps1', ['pick-up', 'design-shots']), w('echo other', ['pick-up']), H);
  assert.equal(l.ok, false);
  assert.deepEqual([l.unchecked, l.skills], [['gate.ps1'], ['design-shots']], 'the skill loss beside an unchecked hook was hidden: ' + JSON.stringify(l));
  assert.match(l.because, /design-shots/);
  const project = path.join(TMP, `agent-${++n}`);
  fs.mkdirSync(path.join(project, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'hooks', 'g.sh'), '#!/bin/sh\n');
  const P = { ...H, project };
  for (const cmd of ['bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/g.sh', 'bash .claude/hooks/g.sh']) {
    assert.deepEqual(carry.losses(w(cmd), w(cmd), P), { ok: true, skills: [], changed: [], hooks: [], hooksChanged: [] }, cmd + ' in the agent folder was not kept');
    assert.deepEqual(carry.losses(w(cmd), w('echo other'), P).hooks, ['g.sh'], cmd + ' missing on the target read as kept');
    assert.equal(carry.losses(w(cmd), w(cmd), H).ok, false, 'CONTROL: without the agent folder, ' + cmd + ' is cannot tell');
  }
});

test('kosmos#8063 review 1: SKILL.md is read before any cap; written-out defaults are the defaults', () => {
  /* Nine files past the 1 MB read each: the 8 MB budget runs out before SKILL.md sorts. */
  const s = (body) => { const d = folder({ skills: ['big'] }); fs.mkdirSync(path.join(d, 'skills', 'big', 'Assets')); for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(d, 'skills', 'big', 'Assets', `blob${i}.bin`), Buffer.alloc(1024 * 1024 + 7, 2)); fs.writeFileSync(path.join(d, 'skills', 'big', 'SKILL.md'), body); return d; };
  assert.deepEqual(carry.losses(s('one'), s('two'), H).changed, ['big'], 'a changed SKILL.md behind a large folder read as the same');
  const h = (extra) => folder({ settings: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi', ...extra }] }] } }) });
  assert.deepEqual(carry.losses(h({}), h({ async: false }), H).hooks, [], 'async false read as a different hook');
  assert.deepEqual(carry.losses(h({ timeout: 60 }), h({ timeout: '60' }), H).hooks, [], 'a timeout written as text read as a different hook');
  assert.deepEqual(carry.losses(h({}), h({ async: true }), H).hooks, ['echo hi'], 'CONTROL: async true is still a different hook');
});
