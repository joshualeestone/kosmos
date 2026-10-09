/**
 * kosmos#5686: engine/backupsessions.js finds an agent's own provider sessions as snapshot roots. Each case has a
 * control: another agent's sessions (or a stranger's in the agent's own Claude folder) and the provider's sign-ins
 * never come back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bs = require('./backupsessions');

const transcript = (cwd) => `{"type":"start","sessionId":"s"}\n{"type":"user","cwd":${JSON.stringify(cwd)},"m":"hi"}\n`;

function world() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kbsess-')));
  const agent = path.join(base, 'work', 'workers', 'mikey');
  const other = path.join(base, 'work', 'workers', 'leo');
  for (const d of [agent, other]) fs.mkdirSync(d, { recursive: true });
  const claude = path.join(base, '.claude'), gemini = path.join(base, '.gemini'), codex = path.join(base, '.codex');
  const w = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  // Claude: one folder per flattened agent folder, beside the account's sign-in; a subagent transcript one level down.
  w(path.join(claude, 'projects', bs.flatten(agent), 's1.jsonl'), transcript(agent));
  w(path.join(claude, 'projects', bs.flatten(agent), 's1', 'subagents', 'agent-1.jsonl'), transcript(agent));
  w(path.join(claude, 'projects', bs.flatten(other), 's2.jsonl'), transcript(other));
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
  return { base, agent, other, claude, gemini, codex, w };
}
const byName = (roots) => Object.fromEntries(roots.map((r) => [r.name, r]));

test('#5686: an agent\'s Claude transcripts, Gemini chats and Codex rollouts, nothing of another agent\'s', () => {
  const w = world();
  try {
    const roots = bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude], geminiHome: w.gemini, codexHome: w.codex });
    const r = byName(roots);
    assert.deepEqual(Object.keys(r), ['sessions/mikey/claude', 'sessions/mikey/gemini', 'sessions/mikey/codex']);
    assert.equal(r['sessions/mikey/claude'].path, path.join(w.claude, 'projects', bs.flatten(w.agent)));
    assert.deepEqual(r['sessions/mikey/claude'].only, ['s1.jsonl', 's1/subagents/agent-1.jsonl']);
    assert.equal(r['sessions/mikey/gemini'].path, path.join(w.gemini, 'tmp', 'mikey-slug', 'chats'));
    assert.equal(r['sessions/mikey/gemini'].only, undefined, 'one slug per folder: the whole chats folder');
    assert.equal(r['sessions/mikey/codex'].path, path.join(w.codex, 'sessions'));
    // rollout-c names the folder with a trailing slash: the same folder on disk.
    assert.deepEqual(r['sessions/mikey/codex'].only, ['2026/10/09/rollout-a.jsonl', '2026/10/09/rollout-c.jsonl']);
    assert.ok(roots.every((x) => x.optional === true));
    // CONTROL: the other agent gets its own, from the same provider folders.
    const leo = byName(bs.sessionsFor(w.other, { id: 'leo', claudeRoots: [w.claude], geminiHome: w.gemini, codexHome: w.codex }));
    assert.deepEqual(leo['sessions/leo/codex'].only, ['2026/10/09/rollout-b.jsonl']);
    assert.deepEqual(leo['sessions/leo/claude'].only, ['s2.jsonl']);
    // No root is a provider's whole folder (which holds its sign-in).
    for (const x of roots) assert.ok(![w.claude, w.gemini, w.codex].includes(x.path), x.path);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686 review 8: a transcript in the agent\'s Claude folder recorded for another folder is not the agent\'s', () => {
  const w = world();
  try {
    // Claude's flattening is many-to-one: `mike.y` and `mike-y` share one projects folder, so a person running Claude
    // in `mike.y` writes into agent `mike-y`'s folder. Only transcripts recorded for the agent's own folder are its.
    const alike = w.agent.replace(/mikey$/, 'mike.y');
    assert.equal(bs.flatten(alike), bs.flatten(w.agent.replace(/mikey$/, 'mike-y')));
    const twin = w.agent.replace(/mikey$/, 'mike-y');
    fs.mkdirSync(twin, { recursive: true });
    w.w(path.join(w.claude, 'projects', bs.flatten(twin), 'own.jsonl'), transcript(twin));
    w.w(path.join(w.claude, 'projects', bs.flatten(twin), 'stranger.jsonl'), transcript(alike));
    w.w(path.join(w.claude, 'projects', bs.flatten(twin), 'silent.jsonl'), '{"type":"start"}\n');
    const r = byName(bs.sessionsFor(twin, { id: 'mike-y', claudeRoots: [w.claude] }));
    assert.deepEqual(r['sessions/mike-y/claude'].only, ['own.jsonl'], 'a stranger\'s or a silent transcript is not taken');
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: a Claude folder spelled two ways on disk (a symlinked agent folder) is one root, not two', () => {
  const w = world();
  try {
    const link = path.join(w.base, 'link-to-mikey');
    fs.symlinkSync(w.agent, link);
    // Claude wrote under the canonical spelling; the transcripts record the canonical folder.
    const got = bs.sessionsFor(link, { id: 'mikey', claudeRoots: [w.claude] });
    assert.deepEqual(got.map((r) => r.path), [path.join(w.claude, 'projects', bs.flatten(w.agent))]);
    // A second folder under the link's spelling, holding a transcript recorded by that spelling.
    w.w(path.join(w.claude, 'projects', bs.flatten(link), 's3.jsonl'), transcript(link));
    assert.deepEqual(bs.sessionsFor(link, { id: 'mikey', claudeRoots: [w.claude] }).map((r) => r.name), ['sessions/mikey/claude', 'sessions/mikey/claude-raw']);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: on a case-insensitive volume, the agent folder spelled in another case names one Claude folder, kept once', (t) => {
  const w = world();
  try {
    const upper = w.agent.replace('/workers/', '/WORKERS/');
    let same = false;
    try { same = fs.statSync(upper).ino === fs.statSync(w.agent).ino; } catch { /* case-sensitive */ }
    if (!same) { t.skip('this volume is case-sensitive'); return; }
    const got = bs.sessionsFor(upper, { id: 'mikey', claudeRoots: [w.claude] });
    assert.equal(got.length, 1, JSON.stringify(got));
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: a session folder that is a link, or sits under one below the provider\'s folder, is not returned', () => {
  const w = world();
  try {
    const flat = path.join(w.claude, 'projects', bs.flatten(w.agent));
    fs.rmSync(flat, { recursive: true }); fs.symlinkSync(w.base, flat);
    const chats = path.join(w.gemini, 'tmp', 'mikey-slug', 'chats');
    fs.rmSync(chats, { recursive: true }); fs.symlinkSync(w.other, chats);
    const codexSessions = path.join(w.codex, 'sessions');
    fs.renameSync(codexSessions, codexSessions + '-real'); fs.symlinkSync(codexSessions + '-real', codexSessions);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude], geminiHome: w.gemini, codexHome: w.codex }), []);
    // A link to another agent's folder, or to all of projects/, inside the provider's folder: refused too.
    fs.rmSync(flat); fs.symlinkSync(path.join(w.claude, 'projects', bs.flatten(w.other)), flat);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude] }), []);
    fs.rmSync(flat); fs.symlinkSync(path.join(w.claude, 'projects'), flat);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude] }), []);
    // CONTROL: the config folder itself kept elsewhere behind a link is fine; the real path is returned.
    fs.rmSync(flat); w.w(path.join(flat, 's1.jsonl'), transcript(w.agent));
    const linkedRoot = path.join(w.base, 'claude-link');
    fs.symlinkSync(w.claude, linkedRoot);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [linkedRoot] }).map((r) => r.path), [flat]);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: a root\'s stored name depends on which config root and spelling, not on what else exists', () => {
  const w = world();
  try {
    const second = path.join(w.base, '.claude-work');
    w.w(path.join(second, 'projects', bs.flatten(w.agent), 's9.jsonl'), transcript(w.agent));
    const both = bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude, second] }).map((r) => r.name);
    assert.deepEqual(both, ['sessions/mikey/claude', 'sessions/mikey/claude-2']);
    fs.rmSync(path.join(w.claude, 'projects', bs.flatten(w.agent)), { recursive: true });
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude, second] }).map((r) => r.name), ['sessions/mikey/claude-2']);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});

test('#5686: what cannot be used gives nothing, never a guess', () => {
  const w = world();
  try {
    const all = { claudeRoots: [w.claude], geminiHome: w.gemini, codexHome: w.codex };
    // Review 8: ids whose names the snapshot refuses (restore, the deny-list, the name shape): nothing, not a whole
    // world's snapshot failed on one agent.
    for (const id of ['aux', 'con', 'secrets', 'Mikey', '../x']) assert.deepEqual(bs.sessionsFor(w.agent, Object.assign({ id }, all)), [], id);
    assert.deepEqual(bs.sessionsFor('relative/mikey', Object.assign({ id: 'mikey' }, all)), []);
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: ['relative'], geminiHome: 'relative', codexHome: 'relative' }), []);
    // A slug that would climb out of tmp/ is refused, not followed (../.. would land on <base>/chats, made real here).
    fs.mkdirSync(path.join(w.base, 'chats'));
    fs.writeFileSync(path.join(w.gemini, 'projects.json'), JSON.stringify({ projects: { [w.agent]: '../..' } }));
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', geminiHome: w.gemini }), []);
    fs.writeFileSync(path.join(w.gemini, 'projects.json'), '{not json');
    assert.deepEqual(bs.sessionsFor(w.agent, { id: 'mikey', geminiHome: w.gemini }), []);
    // CONTROL: the same agent with usable inputs finds its Claude folder.
    assert.equal(bs.sessionsFor(w.agent, { id: 'mikey', claudeRoots: [w.claude] }).length, 1);
  } finally { fs.rmSync(w.base, { recursive: true, force: true }); }
});
