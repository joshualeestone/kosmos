/**
 * kosmos#5686: engine/backupsessions.js finds an agent's own provider sessions: Claude and Gemini as folders (snapshot
 * roots), Codex as files. Each case has a control: another agent's sessions, and the provider's sign-ins, never come back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bs = require('./backupsessions');

function world() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kbsess-')));
  const agent = path.join(base, 'work', 'workers', 'mikey');
  const other = path.join(base, 'work', 'workers', 'leo');
  for (const d of [agent, other]) fs.mkdirSync(d, { recursive: true });
  const claude = path.join(base, '.claude'), gemini = path.join(base, '.gemini'), codex = path.join(base, '.codex');
  const w = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  // Claude: one folder per agent folder, beside the account's sign-in.
  w(path.join(claude, 'projects', bs.flatten(agent), 's1.jsonl'), '{"m":"mikey"}\n');
  w(path.join(claude, 'projects', bs.flatten(other), 's2.jsonl'), '{"m":"leo"}\n');
  w(path.join(claude, '.credentials.json'), '{"secret":1}\n');
  // Gemini: projects.json maps the agent folder to a slug.
  w(path.join(gemini, 'projects.json'), JSON.stringify({ projects: { [agent]: 'mikey-slug', [other]: 'leo-slug' } }));
  w(path.join(gemini, 'tmp', 'mikey-slug', 'chats', 'session-1.jsonl'), '{"m":"mikey"}\n');
  w(path.join(gemini, 'tmp', 'leo-slug', 'chats', 'session-2.jsonl'), '{"m":"leo"}\n');
  w(path.join(gemini, 'oauth_creds.json'), '{"secret":1}\n');
  // Codex: one date tree for every agent; the first line names the folder.
  const roll = (name, cwd) => w(path.join(codex, 'sessions', '2026', '10', '09', name), JSON.stringify({ type: 'session_meta', payload: { cwd } }) + '\n{"m":"x"}\n');
  roll('rollout-a.jsonl', agent); roll('rollout-b.jsonl', other); roll('rollout-c.jsonl', agent + '/');
  w(path.join(codex, 'sessions', '2026', '10', '09', 'rollout-d.jsonl'), '{"type":"other"}\n');
  w(path.join(codex, 'auth.json'), '{"secret":1}\n');
  return { base, agent, other, claude, gemini, codex };
}

test('#5686: an agent\'s Claude and Gemini session folders and its own Codex rollouts, nothing of another agent\'s', () => {
  const w = world();
  try {
    const got = bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude], geminiHome: w.gemini, codexHome: w.codex });
    assert.deepEqual(got.roots, [
      { name: 'sessions/mikey/claude', path: path.join(w.claude, 'projects', bs.flatten(w.agent)), optional: true },
      { name: 'sessions/mikey/gemini', path: path.join(w.gemini, 'tmp', 'mikey-slug', 'chats'), optional: true },
    ]);
    const sessions = path.join(w.codex, 'sessions', '2026', '10', '09');
    // rollout-c names the folder with a trailing slash: the same folder on disk.
    assert.deepEqual(got.codexFiles, [path.join(sessions, 'rollout-a.jsonl'), path.join(sessions, 'rollout-c.jsonl')]);
    // CONTROL: the other agent gets its own, from the same provider folders.
    const leo = bs.sessionsFor(w.other, { id: 'leo', claudeRoots: [w.claude], geminiHome: w.gemini, codexHome: w.codex });
    assert.deepEqual(leo.codexFiles, [path.join(sessions, 'rollout-b.jsonl')]);
    assert.equal(leo.roots[1].path, path.join(w.gemini, 'tmp', 'leo-slug', 'chats'));
    // No root is a provider's whole folder (which holds its sign-in).
    for (const r of [...got.roots, ...leo.roots]) assert.ok(![w.claude, w.gemini, w.codex].includes(r.path), r.path);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: a Claude folder spelled two ways on disk (a symlinked agent folder) is one root, not two', () => {
  const w = world();
  try {
    const link = path.join(w.base, 'link-to-mikey');
    fs.symlinkSync(w.agent, link);
    // Claude wrote under the canonical spelling; a second folder under the link's spelling is another folder.
    const got = bs.sessionsFor(link, { id: 'mikey', claudeRoots: [w.claude] });
    assert.deepEqual(got.roots.map((r) => r.path), [path.join(w.claude, 'projects', bs.flatten(w.agent))]);
    fs.mkdirSync(path.join(w.claude, 'projects', bs.flatten(link)));
    const two = bs.sessionsFor(link, { id: 'mikey', claudeRoots: [w.claude] });
    assert.deepEqual(two.roots.map((r) => r.name), ['sessions/mikey/claude', 'sessions/mikey/claude-raw']);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: on a case-insensitive volume, the agent folder spelled in another case names one Claude folder, kept once', (t) => {
  const w = world();
  try {
    const upper = w.agent.replace('/workers/', '/WORKERS/');
    let same = false;
    try { same = fs.statSync(upper).ino === fs.statSync(w.agent).ino; } catch { /* case-sensitive */ }
    if (!same) { t.skip('this volume is case-sensitive'); return; }
    // flatten(canonical) and flatten(as given) differ only in case: one folder, two names for it.
    const got = bs.sessionsFor(upper, { id: 'mikey', claudeRoots: [w.claude] });
    assert.equal(got.roots.length, 1, JSON.stringify(got.roots));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686 review 6: a session folder that is a link out of its provider\'s folder is not returned', () => {
  const w = world();
  try {
    // Claude's folder for this agent replaced by a link to the home folder; Gemini's chats by a link to another agent's.
    const flat = path.join(w.claude, 'projects', bs.flatten(w.agent));
    fs.rmSync(flat, { recursive: true }); fs.symlinkSync(w.base, flat);
    const chats = path.join(w.gemini, 'tmp', 'mikey-slug', 'chats');
    fs.rmSync(chats, { recursive: true }); fs.symlinkSync(w.other, chats);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude], geminiHome: w.gemini }).roots, []);
    // CONTROL: a link that stays inside the provider's folder is followed (another account's folder in the same root).
    fs.rmSync(flat); fs.symlinkSync(path.join(w.claude, 'projects', bs.flatten(w.other)), flat);
    assert.equal(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude] }).roots.length, 1);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686 review 6: a root\'s stored name depends on which config root and spelling, not on what else exists', () => {
  const w = world();
  try {
    const second = path.join(w.base, '.claude-work');
    fs.mkdirSync(path.join(second, 'projects', bs.flatten(w.agent)), { recursive: true });
    const both = bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude, second] }).roots.map((r) => r.name);
    assert.deepEqual(both, ['sessions/mikey/claude', 'sessions/mikey/claude-2']);
    // The first account's folder gone: the second keeps its name.
    fs.rmSync(path.join(w.claude, 'projects', bs.flatten(w.agent)), { recursive: true });
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude, second] }).roots.map((r) => r.name), ['sessions/mikey/claude-2']);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: what cannot be used gives nothing, never a guess', () => {
  const w = world();
  try {
    const none = { roots: [], codexFiles: [] };
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'Mikey', claudeRoots: [w.claude] }), none, 'an id restore names cannot carry');
    assert.deepEqual(bs.sessionsFor('relative/mikey', { id: 'mikey', claudeRoots: [w.claude] }), none);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: ['relative'], geminiHome: 'relative', codexHome: 'relative' }), none);
    // A slug that would climb out of tmp/ is refused, not followed.
    // ../.. would land on <base>/chats: made real, so following the slug would return it.
    fs.mkdirSync(path.join(w.base, 'chats'));
    fs.writeFileSync(path.join(w.gemini, 'projects.json'), JSON.stringify({ projects: { [w.agent]: '../..' } }));
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', geminiHome: w.gemini }).roots, []);
    fs.writeFileSync(path.join(w.gemini, 'projects.json'), '{not json');
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', geminiHome: w.gemini }).roots, []);
    // CONTROL: the same agent with usable inputs finds its Claude folder.
    assert.equal(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude] }).roots.length, 1);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});
