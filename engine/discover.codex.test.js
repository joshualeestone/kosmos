'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * #1159: a Codex user installs Kosmos and sees an empty screen.
 *
 * Discovery walked only `~/.claude/projects`. Measured on the card:
 *   engine/discover.js  mentions of codex/openai:  0
 *   engine/discover.js  mentions of claude:       13   <- control
 */

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pete-codex-'));
  fs.mkdirSync(path.join(root, 'codex', 'sessions', '2026', '08', '28'), { recursive: true });
  return root;
}
/* A rollout the real reader will accept: session_meta MUST be the first line,
   because metaOf reads the head and rejects anything else. */
function rollout(root, name, cwd, instructions) {
  const dir = path.join(root, 'codex', 'sessions', '2026', '08', '28');
  const lines = [JSON.stringify({ timestamp: '2026-08-28T04:00:00.000Z', ordinal: 0, type: 'session_meta',
    payload: { session_id: name, cwd, originator: 'codex-tui' } })];
  if (instructions) {
    lines.push(JSON.stringify({ type: 'response_item',
      payload: { content: `<INSTRUCTIONS>\n${instructions}\n</INSTRUCTIONS>` } }));
  }
  const f = path.join(dir, `rollout-2026-08-28T04-00-00-${name}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
function withCodexHome(root, fn) {
  const prev = process.env.AGENT_WORKFORCE_CODEX_HOME;
  process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(root, 'codex');
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_CODEX_HOME;
    else process.env.AGENT_WORKFORCE_CODEX_HOME = prev;
  }
}
const discover = require('./discover');

test('#1159: a Codex agent is found from AGENTS.md on disk', () => {
  const root = sandbox();
  const work = path.join(root, 'proj'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'AGENTS.md'), '# You are Codex Tester\n\nSome role text.\n');
  rollout(root, 'aaa', work, null);
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents.length, 1, 'a Codex agent with an AGENTS.md was not found');
  assert.equal(r.agents[0].name, 'Codex Tester');
  assert.equal(r.agents[0].runner, 'codex', 'the row does not say which provider it came from');
});

test('#1159: THE NOVEL ONE -- identity survives the folder being deleted', () => {
  /* 🔑 This is the capability the Claude path does not have. Codex embeds the
     project's AGENTS.md into the transcript, so the agent is still identifiable
     after its directory is gone. Measured on the real machine 2026-08-28: 24 of
     41 Claude project records could NOT produce an identity for exactly this
     reason. */
  const root = sandbox();
  const gone = path.join(root, 'deleted-long-ago');   // never created
  rollout(root, 'bbb', gone, '# You are Ghost Agent\n\nStill nameable.');
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents.length, 1, 'a Codex agent whose folder is gone was lost');
  assert.equal(r.agents[0].name, 'Ghost Agent');
  assert.equal(r.agents[0].unreadable, undefined);
});

test('#1159: the live file WINS over the embedded copy, so a rename takes effect', () => {
  const root = sandbox();
  const work = path.join(root, 'renamed'); fs.mkdirSync(work);
  fs.writeFileSync(path.join(work, 'AGENTS.md'), '# You are The New Name\n');
  rollout(root, 'ccc', work, '# You are The Old Name\n');
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents[0].name, 'The New Name',
    'the stale embedded copy beat the live file: a renamed agent would come back under its old name');
});

test('#1159: a session with no identity anywhere is COUNTED, not dropped', () => {
  /* Same rule as the Claude side (#1078): three situations end on one empty
     screen and only this one is knowable here. */
  const root = sandbox();
  rollout(root, 'ddd', path.join(root, 'nameless'), null);
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents.length, 0);
  assert.equal(r.unreadable, 1, 'an unidentifiable session vanished instead of being counted');
});

test('#1159: two sessions in one folder are one agent, and the NEWEST names it', () => {
  /* 🛑 THE COUNT ALONE CANNOT TEST THIS, and the first version of this test could
     not. `byDir` is a Map keyed on the folder, so it collapses duplicates by
     itself: removing the `byDir.has(cwd)` guard entirely still produced ONE
     agent and the test stayed green. Found by perturbation, 2026-08-28.

     The guard's real property is WHICH session wins. `rollouts()` returns newest
     first, so the guard keeps the newest; without it the last one processed --
     the OLDEST -- overwrites it, and a renamed agent comes back under a name it
     stopped using. The two rollouts therefore have to carry DIFFERENT identities
     for this to be a test at all. */
  const root = sandbox();
  const work = path.join(root, 'shared');   // no AGENTS.md: identity comes from each rollout
  rollout(root, 'aaa-older', work, '# You are Stale Name\n');
  rollout(root, 'zzz-newer', work, '# You are Current Name\n');
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents.length, 1, 'one folder produced two agents');
  assert.equal(r.agents[0].name, 'Current Name',
    'the older session won: an agent would be listed under a name it no longer uses');
});

test('#1159 CONTROL: an empty Codex tree finds nothing and does not throw', () => {
  /* Without this the assertions above are vacuous: the walk must be able to
     return zero, so a non-zero result elsewhere means it actually looked. */
  const root = sandbox();
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents.length, 0);
  assert.equal(r.unreadable, 0);
});

test('#1159 CONTROL: a rollout whose first line is NOT session_meta is skipped', () => {
  /* metaOf reads the HEAD and rejects anything else. A file that merely lives in
     the tree must not be treated as a session. */
  const root = sandbox();
  const dir = path.join(root, 'codex', 'sessions', '2026', '08', '28');
  fs.writeFileSync(path.join(dir, 'rollout-2026-08-28T05-00-00-xxx.jsonl'),
    JSON.stringify({ type: 'response_item', payload: {} }) + '\n');
  const r = withCodexHome(root, () => discover.foundCodex(undefined));
  assert.equal(r.agents.length, 0);
  assert.equal(r.unreadable, 0, 'a non-session file was counted as an unreadable agent');
});
