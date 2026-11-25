'use strict';
/* kosmos#9068: "did you mean" one level down. A mistyped subcommand under community, task, project, feedback or agent
   names the closest real one, from that group's own subcommands, on both CLIs; `kosmos community <unknown word>` says the
   word is unknown before anything else, and a bare `kosmos community` keeps the full usage.
   node --test engine/didyoumean-groups-9068.test.js */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dym = require('./didyoumean');
const wincli = require('../tools/windows/kosmos-cli');

const ROOT = path.join(__dirname, '..');
const MAC = fs.readFileSync(path.join(ROOT, 'install', 'kosmos'), 'utf8');
const GROUPS = ['community', 'task', 'project', 'feedback', 'agent'];
const winSubs = (g) => { const s = (wincli.SUBCOMMANDS || {})[g]; return Array.isArray(s) ? [...s] : Object.keys(s || {}); };

/* The verb list each group passes to _unknown_sub in install/kosmos (community's is KOSMOS_COMMUNITY_VERBS). */
function macSubs(g) {
  if (g === 'community') {
    const m = MAC.match(/^KOSMOS_COMMUNITY_VERBS="([^"]*)"/m);
    return m ? m[1].split(/\s+/).filter(Boolean) : [];
  }
  const m = MAC.match(new RegExp('_unknown_sub ' + g + ' "\\$sub" "[^"]*" ([^\\n]*)'));
  return m ? m[1].trim().split(/\s+/) : [];
}

test('kosmos#9068: the rule names a group\'s nearest subcommand, and nothing when far; the top level is unchanged', () => {
  const subs = ['post', 'read', 'comment', 'follow', 'unfollow', 'vote', 'votes'];
  assert.equal(dym.suggest('folow', subs, undefined, 'community'), 'kosmos community follow');
  assert.equal(dym.suggest('coment', subs, undefined, 'community'), 'kosmos community comment');
  assert.equal(dym.suggest('reads', subs, undefined, 'community'), 'kosmos community read', 'a plural gives the singular, no " list"');
  assert.equal(dym.suggest('zzqqxx', subs, undefined, 'community'), null, 'CONTROL: close to nothing');
  assert.equal(dym.suggest('follow', subs, undefined, 'community'), null, 'CONTROL: a real subcommand is not unknown');
  assert.equal(dym.suggest('Follow', subs, undefined, 'community'), 'kosmos community follow', 'review 1: another case is suggested as written');
  assert.equal(dym.suggest('Task', ['task', 'agent']), 'kosmos task', 'review 1: the same at the top level');
  assert.equal(dym.suggest('folow', subs, undefined, 'Not A Group'), 'kosmos follow', 'a group that is not a word is ignored');
  assert.equal(dym.line('folow', subs, undefined, 'community'), 'Did you mean: kosmos community follow');
  assert.equal(dym.suggest('tasks', ['task', 'agent']), 'kosmos task list', 'CONTROL: the top level keeps its list rule (#8948)');
});

test('kosmos#9068: each group\'s list on the Mac CLI is the Windows CLI\'s subcommands, and community\'s covers its dispatch', () => {
  for (const g of GROUPS) {
    const mac = macSubs(g);
    assert.ok(mac.length, 'install/kosmos passes no subcommand list for ' + g);
    assert.deepEqual([...mac].sort(), [...winSubs(g)].sort(), 'the two CLIs name different subcommands for ' + g);
  }
  // Every subcommand cmd_community dispatches is in KOSMOS_COMMUNITY_VERBS (a new one added there must be named here).
  const at = MAC.indexOf('\ncmd_community() {');
  const body = MAC.slice(at, MAC.indexOf('\n}\n', at));
  const dispatched = [...body.matchAll(/"\$sub" (?:=|!=) "([a-z][a-z-]*)"/g)].map((m) => m[1]);
  assert.ok(dispatched.length >= 10, 'CONTROL: the dispatch was not read');
  for (const v of dispatched) assert.ok(macSubs('community').includes(v), 'cmd_community takes ' + v + ', missing from KOSMOS_COMMUNITY_VERBS');
});

function macHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dym9068-home-'));
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.symlinkSync(path.join(ROOT, 'engine'), path.join(home, 'app', 'engine'));
  return home;
}
const NEAR = [['community', 'folow', 'follow'], ['task', 'reassign', 'assign'], ['project', 'creat', 'create'],
  ['feedback', 'wrte', 'write'], ['agent', 'restrt', 'restart']];

test('kosmos#9068: the Mac CLI names the nearest subcommand after "Unknown" in every group, and nothing when none is close', () => {
  const home = macHome();
  const run = (...a) => spawnSync('bash', [path.join(ROOT, 'install', 'kosmos'), ...a], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, KOSMOS_HOME: home, KOSMOS_PORT: '9', TMUX: '', TMUX_PANE: '' } });
  for (const [g, typo, meant] of NEAR) {
    const r = run(g, typo);
    assert.equal(r.status, 2, g + ': ' + r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp('Unknown: kosmos ' + g + ' ' + typo + '\\. Try: [^\\n]*\\n  Did you mean: kosmos ' + g + ' ' + meant + '\\n'),
      g + ': the suggestion is not right after the Unknown line:\n' + r.stdout);
    const far = run(g, 'zzqqxx');
    assert.match(far.stdout, new RegExp('Unknown: kosmos ' + g + ' zzqqxx'), 'CONTROL: ' + g + ' lost its Unknown line');
    assert.doesNotMatch(far.stdout + far.stderr, /Did you mean/, 'CONTROL: ' + g + ' suggested something for a word close to nothing');
  }
  // The community answer starts with the word it did not know, not the long usage.
  const c = run('community', 'folow');
  assert.match(c.stdout, /^\s*Unknown: kosmos community folow\./, 'community did not say the word was unknown first');
  assert.doesNotMatch(c.stdout, /Usage: kosmos community post/, 'the long usage still printed for an unknown word');
  const bare = run('community');
  assert.equal(bare.status, 2);
  assert.match(bare.stdout, /Usage: kosmos community post/, 'CONTROL: a bare `kosmos community` lost its usage');
  assert.doesNotMatch(bare.stdout, /Unknown/, 'CONTROL: a bare `kosmos community` is not an unknown word');
});

test('kosmos#9068: the Windows CLI does the same from its own subcommands', async () => {
  const run = async (...a) => {
    const out = []; const err = [];
    const code = await wincli.main(a, { env: {}, out: (x) => out.push(x), err: (x) => err.push(x) });
    return { code, err: err.join('\n') };
  };
  for (const [g, typo, meant] of NEAR) {
    const r = await run(g, typo);
    assert.equal(r.code, 2, g);
    assert.match(r.err, new RegExp('Unknown: kosmos ' + g + ' ' + typo + '\\. Try: [^\\n]*\\n  Did you mean: kosmos ' + g + ' ' + meant + '(\\n|$)'),
      g + ': the Windows CLI gave no suggestion after Unknown:\n' + r.err);
    const far = await run(g, 'zzqqxx');
    assert.doesNotMatch(far.err, /Did you mean/, 'CONTROL: ' + g);
  }
  const c = await run('community', 'folow');
  assert.match(c.err, /^Unknown: kosmos community folow\./, 'community did not say the word was unknown first');
  const bare = await run('community');
  assert.equal(bare.code, 2);
  assert.match(bare.err, /Usage: kosmos community post/, 'CONTROL: a bare `kosmos community` lost its usage');
});
