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
  assert.deepEqual(l, { ok: true, skills: ['design-shots', 'verify-release'], changed: [], hooks: ['destructive-cmd-gate.sh', 'vercel-login-gate.sh'] },
    'the loss was not named (the pre-challenge gate, spelled with $HOME, must count as kept)');
  assert.equal(carry.sentence(l), 'On that account it would not have the skills design-shots, verify-release, or the hooks destructive-cmd-gate.sh, vercel-login-gate.sh it has now.');
  // CONTROL: the other way, nothing the account folder has is missing from the main one.
  assert.deepEqual(carry.losses(acct, main, H), { ok: true, skills: [], changed: [], hooks: [] });
  assert.equal(carry.sentence(carry.losses(acct, main, H)), null);
});

test('kosmos#8048: a linked skills folder (how Agent1s shares one) counts as having them', () => {
  const main = folder({ skills: ['pick-up', 'design-shots'] });
  const acct = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(acct);
  fs.symlinkSync(path.join(main, 'skills'), path.join(acct, 'skills'));
  fs.symlinkSync(path.join(main, 'settings.json'), path.join(acct, 'settings.json'));
  assert.deepEqual(carry.losses(main, acct), { ok: true, skills: [], changed: [], hooks: [] }, 'a linked folder read as missing its skills');
  // Each skill linked on its own (a skills/ folder of links) counts too.
  const perSkill = path.join(TMP, `acct-${++n}`);
  fs.mkdirSync(path.join(perSkill, 'skills'), { recursive: true });
  for (const s of ['pick-up', 'design-shots']) fs.symlinkSync(path.join(main, 'skills', s), path.join(perSkill, 'skills', s));
  assert.deepEqual(carry.losses(main, perSkill).skills, [], 'skills linked one by one read as missing');
});

test('kosmos#8048: a folder that cannot be read is "cannot tell", never "nothing lost"', () => {
  const ok = folder({ skills: ['a'], hooks: ['bash x.sh'] });
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
  assert.deepEqual(carry.losses(ok, empty), { ok: true, skills: ['a'], changed: [], hooks: ['x.sh'] });
});

test('kosmos#8048: the default account is ~/.claude under the given home', () => {
  const home = path.join(TMP, `home-${++n}`);
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'only-main'), { recursive: true });
  const acct = folder({ skills: [] });
  assert.deepEqual(carry.losses(null, acct, { home }), { ok: true, skills: ['only-main'], changed: [], hooks: [] });
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
  assert.deepEqual(carry.losses(from, withGate({ body: '#!/bin/sh\nexit 1\n' }), H).hooks, ['gate.sh'], 'a different copy of the gate read as kept');
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
  assert.deepEqual(carry.losses(folder({ hooks: ['bash gate.sh'] }), folder({ hooks: ['bash /nonexistent-8048/gate.sh'] }), H).hooks, ['gate.sh'],
    'a target whose script is missing read as keeping the gate');
});
