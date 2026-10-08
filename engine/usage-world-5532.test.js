'use strict';
/**
 * kosmos#5532: usage scoped to THIS Kosmos's own agents. The computer-wide reader counts every Claude session on the
 * computer; the scoped one counts only sessions launched from one of the given agent folders, per day and model.
 * Real transcripts in a sandboxed config root; the other providers are stood in where noted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-world-5532-')));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
for (const v of ['AGENT_WORKFORCE_AGY_HOME', 'CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME']) delete process.env[v];
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');
// chmod 000 does not stop root, and is not a permission on Windows; symlinks need privileges there (review 4).
const NO_CHMOD = process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0);
const NO_LINKS = process.platform === 'win32';

const TODAY = new Date().toISOString().slice(0, 10);
const AGENT = path.join(SANDBOX, 'workers', 'leo');
const PERSONAL = path.join(SANDBOX, 'home', 'my-own-project');
const SUB = path.join(AGENT, 'a-subfolder');
for (const d of [AGENT, PERSONAL, SUB]) fs.mkdirSync(d, { recursive: true });

function session(name, cwd, id, model, input) {
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', name, 's.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd, timestamp: TODAY + 'T01:00:00.000Z' }),
    JSON.stringify({ timestamp: TODAY + 'T02:00:00.000Z', cwd, message: { id, model, usage: { input_tokens: input, output_tokens: 1 } } }),
  ].join('\n') + '\n');
}
session('agent', AGENT, 'm-agent', 'claude-opus-5-5', 100);
session('personal', PERSONAL, 'm-personal', 'claude-personal-model', 7000);
session('sub', SUB, 'm-sub', 'claude-sub-model', 300);

const NOPROV = { scanProviders: async () => ({ folderModels: {}, complete: true }) };

/* Review 7: every `complete: false` below is preceded by this CONTROL in the same state, so a fault an earlier test
   left in the shared sandbox cannot make it pass for the wrong reason. */
async function wholeBefore(what) {
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal(w.complete, true, 'CONTROL: the count was already incomplete before ' + what + ', so the check below proves nothing');
}

test('#5532: only sessions launched from this Kosmos\'s own agent folders count, per model; a subfolder is not claimed', async () => {
  // CONTROL: the computer-wide scan sees all three sessions, so what the scoped reader leaves out is real.
  const all = await usage.scanUsage({ sinceDay: TODAY, untilDay: TODAY });
  assert.deepEqual(Object.keys(all.days[TODAY]).sort(), ['claude-opus-5-5', 'claude-personal-model', 'claude-sub-model']);
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.deepEqual(Object.keys(w.byDay[TODAY] || {}), ['claude-opus-5-5'], 'usage from outside this Kosmos\'s agents was counted: ' + JSON.stringify(w.byDay));
  assert.equal(w.byDay[TODAY]['claude-opus-5-5'].input_tokens, 100);
  assert.equal(w.complete, true);
  const none = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [] }, NOPROV));
  assert.deepEqual(none.byDay, {}, 'a Kosmos with no agents counted usage');
});

test('#5532: other providers are scoped the same way, and a partly read provider says complete: false', async () => {
  const providers = async () => ({
    complete: false,
    folderModels: { [TODAY]: { [AGENT]: { 'gpt-5.1': { input_tokens: 40, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } },
      [PERSONAL]: { 'gemini-2.5-flash': { input_tokens: 9, output_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } } } },
  });
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, { scanProviders: providers }));
  assert.deepEqual(Object.keys(w.byDay[TODAY]).sort(), ['claude-opus-5-5', 'gpt-5.1']);
  assert.equal(w.complete, false, 'a partly read provider was reported as the whole count');
  const thrown = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, { scanProviders: async () => { throw new Error('no homes'); } }));
  assert.equal(thrown.complete, false);
});

test('#5532: an agent folder reached through a link matches its real folder', { skip: NO_LINKS && 'symlinks need privileges here' }, async () => {
  const link = path.join(SANDBOX, 'link-to-leo');
  fs.symlinkSync(AGENT, link);
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [link] }, NOPROV));
  assert.deepEqual(Object.keys(w.byDay[TODAY] || {}), ['claude-opus-5-5'], 'a linked agent folder did not match');
});

test('#5532: a session launched through a link to an agent\'s folder counts for that agent', { skip: NO_LINKS && 'symlinks need privileges here' }, async () => {
  const link = path.join(SANDBOX, 'another-link-to-leo');
  fs.symlinkSync(AGENT, link);
  session('via-link', link, 'm-link', 'claude-via-link', 55);
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal((w.byDay[TODAY] || {})['claude-via-link'] && w.byDay[TODAY]['claude-via-link'].input_tokens, 55, 'a session recorded under a link to the agent\'s folder was not counted: ' + JSON.stringify(w.byDay));
});

function sub(sessionDir, cwd, id, model, input, day) {
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', sessionDir, 'subagents', 'a.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd, timestamp: (day || TODAY) + 'T01:00:00.000Z' }),
    JSON.stringify({ timestamp: (day || TODAY) + 'T03:00:00.000Z', cwd, message: { id, model, usage: { input_tokens: input, output_tokens: 1 } } }),
  ].join('\n') + '\n');
}

test('#5532 review 1: a subagent with no top-level transcript counts for nobody; one under the agent\'s own session counts', async () => {
  sub('orphan-sess', AGENT, 'm-orphan', 'claude-orphan-sub', 11);   // a person's session cd'd into the agent's folder, its top level pruned
  const parentFile = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'kid', 'sess.jsonl');
  fs.mkdirSync(path.dirname(parentFile), { recursive: true });
  fs.writeFileSync(parentFile, JSON.stringify({ type: 'user', cwd: AGENT, timestamp: TODAY + 'T00:30:00.000Z' }) + '\n');
  sub('kid/sess', path.join(AGENT, 'worktree'), 'm-kid', 'claude-kid-sub', 22);   // spawned from a worktree under the agent's session
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal((w.byDay[TODAY] || {})['claude-orphan-sub'], undefined, 'an orphaned subagent in the agent\'s folder was counted');
  assert.equal(((w.byDay[TODAY] || {})['claude-kid-sub'] || {}).input_tokens, 22, 'a subagent of the agent\'s own session was not counted');
  // The usage screen's per-folder totals keep their behaviour (review 3): the orphan stays under its own first folder.
  const all = await usage.scanUsage({ sinceDay: TODAY, untilDay: TODAY });
  assert.ok((all.folders[TODAY][AGENT] || {}).input_tokens >= 11, 'the orphan rule leaked into the usage screen\'s per-folder totals');
});

test('#5532 review 1: an unreadable transcript or a failing scan gives complete: false, never a throw', { skip: NO_CHMOD && 'chmod cannot make a file unreadable here' }, async (t) => {
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'locked', 's.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ type: 'user', cwd: AGENT, timestamp: TODAY + 'T01:00:00.000Z' }) + '\n');
  await wholeBefore('the transcript was locked');
  fs.chmodSync(file, 0o000);
  t.after(() => { try { fs.chmodSync(file, 0o600); } catch { /* removed with the sandbox */ } });
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal(w.complete, false, 'an unreadable Claude transcript was reported as the whole count');
  fs.chmodSync(file, 0o600);
  const thrown = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, { scanUsage: async () => { throw new Error('no roots'); }, scanProviders: NOPROV.scanProviders }));
  assert.deepEqual(thrown, { byDay: {}, complete: false });
});

const ROW = (model) => ({ [model]: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 } });
const AT = (folder, model) => async () => ({ folderModels: { [TODAY]: { [folder]: ROW(model) } }, unreadable: 0 });

test('#5532 review 1: a relative agent folder claims nothing and makes the count incomplete', async () => {
  // A session launched in this process's own folder: '.' would resolve to it if a relative agent folder were taken.
  const here = process.cwd();
  // CONTROL: the same session IS claimed by that folder named absolutely, so the miss below is the guard.
  const abs = await usage.worldUsageByModel(1, { agentDirs: [here], scanUsage: AT(here, 'claude-rel'), scanProviders: NOPROV.scanProviders });
  assert.ok((abs.byDay[TODAY] || {})['claude-rel'], 'CONTROL: the session was not counted for its own folder');
  const rel = await usage.worldUsageByModel(1, { agentDirs: ['.'], scanUsage: AT(here, 'claude-rel'), scanProviders: NOPROV.scanProviders });
  assert.deepEqual(rel.byDay, {}, 'a relative agent folder claimed the session in this server\'s own folder');
  assert.equal(rel.complete, false, 'a dropped relative agent folder left the count looking whole');
});

test('#5532 review 9: a root or an unresolvable agent folder claims nothing and makes the count incomplete', async () => {
  const root = path.parse(SANDBOX).root;
  const asRoot = await usage.worldUsageByModel(1, { agentDirs: [root], scanUsage: AT(root, 'claude-at-root'), scanProviders: NOPROV.scanProviders });
  assert.equal((asRoot.byDay[TODAY] || {})['claude-at-root'], undefined, 'a filesystem root as an agent folder claimed a session launched there');
  assert.equal(asRoot.complete, false, 'a dropped root folder left the count looking whole');
  // An agent the roster could not resolve (worldAgentDirs keeps it as null) leaves its sessions out: incomplete.
  const unresolved = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [null, AGENT] }, NOPROV));
  assert.ok(unresolved.byDay[TODAY]['claude-opus-5-5'], 'the resolvable agent lost its usage');
  assert.equal(unresolved.complete, false, 'an unresolvable agent left the count looking whole');
});

test('#5532 review 1: the window is the last N UTC days, today included', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const old = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'yday', 's.jsonl');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.writeFileSync(old, [
    JSON.stringify({ type: 'user', cwd: AGENT, timestamp: yesterday + 'T01:00:00.000Z' }),
    JSON.stringify({ timestamp: yesterday + 'T02:00:00.000Z', cwd: AGENT, message: { id: 'm-yday', model: 'claude-yesterday', usage: { input_tokens: 9, output_tokens: 1 } } }),
  ].join('\n') + '\n');
  const one = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal(one.byDay[yesterday], undefined, 'a one-day window counted yesterday');
  const two = await usage.worldUsageByModel(2, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal(((two.byDay[yesterday] || {})['claude-yesterday'] || {}).input_tokens, 9, 'a two-day window left out yesterday');
});

test('#5532 review 2: a home folder or a root as an agent folder claims nothing; a gone agent folder makes the count incomplete', async () => {
  const home = path.join(SANDBOX, 'home');
  session('in-home', home, 'm-home', 'claude-home-session', 66);   // a person's own session started in their home folder
  const asHome = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [home] }, { scanProviders: NOPROV.scanProviders, home }));
  assert.equal((asHome.byDay[TODAY] || {})['claude-home-session'], undefined, 'an agent folder set to the home folder claimed the person\'s own session');
  assert.equal(asHome.complete, false, 'a dropped home folder left the count looking whole');
  await wholeBefore('a gone folder was added');
  const gone = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT, path.join(SANDBOX, 'workers', 'deleted-agent')] }, NOPROV));
  assert.equal(gone.complete, false, 'a gone agent folder was reported as a complete count');
  assert.ok(gone.byDay[TODAY]['claude-opus-5-5'], 'the agents that remain were not counted');
});

test('#5532 review 3: a skipped parent that cannot be head-read makes the count incomplete, not quietly short', { skip: NO_CHMOD && 'chmod cannot make a file unreadable here' }, async (t) => {
  const parent = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'oldkid', 'sess.jsonl');
  fs.mkdirSync(path.dirname(parent), { recursive: true });
  fs.writeFileSync(parent, JSON.stringify({ type: 'user', cwd: AGENT, timestamp: '2020-01-01T00:00:00.000Z' }) + '\n');
  const old = new Date(Date.now() - 5 * 86400000);
  fs.utimesSync(parent, old, old);   // last written before the window: skipped, then head-read for its subagent
  await wholeBefore('the parent was locked');
  fs.chmodSync(parent, 0o000);
  t.after(() => { try { fs.chmodSync(parent, 0o600); } catch { /* removed with the sandbox */ } });
  sub('oldkid/sess', AGENT, 'm-oldkid', 'claude-oldkid-sub', 8);
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal(w.complete, false, 'a parent that could not be read left the count looking whole');
});

test('#5532 review 4: a project folder that cannot be listed makes the count incomplete', { skip: NO_CHMOD && 'chmod cannot make a folder unlistable here' }, async (t) => {
  const dir = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'locked-dir');
  fs.mkdirSync(dir, { recursive: true });
  await wholeBefore('the folder was locked');
  fs.chmodSync(dir, 0o000);
  t.after(() => { try { fs.chmodSync(dir, 0o700); } catch { /* removed with the sandbox */ } });
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [AGENT] }, NOPROV));
  assert.equal(w.complete, false, 'an unlistable project folder left the count looking whole');
});

test('#5532 review 5: the folders come from this Kosmos\'s roster, and a shared parent folder claims nothing', async () => {
  // Behaviour, not arity (review 6): a list passed where a caller might pass one is not used as the folders.
  const passed = await usage.worldUsageByModel(1, [AGENT]);
  assert.deepEqual(passed.byDay, {}, 'a caller\'s folder list was used instead of the roster');
  // The roster here is the sandboxed store, with no agents: the default reads it, not a listing of any folder.
  assert.deepEqual(usage.worldAgentDirs(), []);
  const none = await usage.worldUsageByModel(1, NOPROV);
  assert.deepEqual(none.byDay, {}, 'with an empty roster something was counted');
  // A parent that contains another agent's folder (the workers root, a person's ~/work) claims nothing.
  const workers = path.join(SANDBOX, 'workers');
  session('in-workers', workers, 'm-workers', 'claude-workers-root', 44);
  await wholeBefore('the parent folder was listed');
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [workers, AGENT] }, NOPROV));
  assert.equal((w.byDay[TODAY] || {})['claude-workers-root'], undefined, 'a folder containing another agent\'s folder claimed a session');
  assert.ok((w.byDay[TODAY] || {})['claude-opus-5-5'], 'the agent beneath it lost its own usage');
  assert.equal(w.complete, false, 'a dropped parent folder left the count looking whole');
});

test('#5532 review 7: no file outside the tests passes worldUsageByModel a second argument (its deps are for tests only)', () => {
  const { execFileSync } = require('node:child_process');
  const root = path.join(__dirname, '..');
  const files = execFileSync('git', ['-C', root, 'ls-files', '*.js'], { encoding: 'utf8' }).split('\n').filter((f) => f && !/\.test\.js$/.test(f) && !f.startsWith('test-support/'));
  // CONTROL: the file that defines it is among those read, so an empty list cannot pass.
  assert.ok(files.includes('engine/usage.js'), 'CONTROL: the tracked-file listing did not reach engine/usage.js');
  // An accident net, not a boundary: an aliased call, .call/.apply, or a first argument holding `)` is not seen.
  const CALL = /worldUsageByModel\s*\(([^)]*)\)/g;   // [^)] spans lines, so a call split over lines is read whole
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(CALL)) if (m[1].includes(',')) bad.push(f + ': ' + m[0].replace(/\s+/g, ' ').slice(0, 80));
  }
  // engine/usage.js's own definition takes (days, deps); it is the one allowed.
  assert.deepEqual(bad.filter((b) => !b.startsWith('engine/usage.js: worldUsageByModel(days, deps)')), [], 'a caller passes deps, and could hand it a folder listing that sweeps in another Kosmos');
});

test('#5532 review 8: the home Kosmos uses (AGENT_WORKFORCE_HOME) claims nothing, with no home passed in', async () => {
  const home = process.env.AGENT_WORKFORCE_HOME;
  session('in-env-home', home, 'm-env-home', 'claude-env-home-session', 55);
  await wholeBefore('the home folder was named as an agent folder');
  // CONTROL: the same session IS claimed by a folder that is not a home, so the miss below is the guard.
  const asOther = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [home], home: path.join(SANDBOX, 'not-a-home') }, NOPROV));
  assert.ok((asOther.byDay[TODAY] || {})['claude-env-home-session'], 'CONTROL: the session in that folder was not read at all');
  const w = await usage.worldUsageByModel(1, Object.assign({ agentDirs: [home] }, NOPROV));
  assert.equal((w.byDay[TODAY] || {})['claude-env-home-session'], undefined, 'the home Kosmos uses, as an agent folder, claimed the person\'s own session');
  assert.equal(w.complete, false, 'the dropped env home left the count looking whole');
});

test('#5532 review 8: a provider result that does not say complete is not complete', async () => {
  await wholeBefore('the provider answer lost its complete field');
  const w = await usage.worldUsageByModel(1, { agentDirs: [AGENT], scanProviders: async () => ({ folderModels: {} }) });
  assert.equal(w.complete, false, 'a provider result with no complete field was read as the whole count');
});

test('#5532 review 11: the REAL provider reader scopes by launch folder (a Codex rollout from an agent folder and one from elsewhere)', async () => {
  const { scanProviders } = require('./usageproviders');
  const home = path.join(SANDBOX, 'codex-home');
  const [y, m, d] = TODAY.split('-');
  const dir = path.join(home, 'sessions', y, m, d);
  fs.mkdirSync(dir, { recursive: true });
  const rollout = (name, cwd, model, output) => fs.writeFileSync(path.join(dir, name), [
    { timestamp: TODAY + 'T01:00:00Z', type: 'session_meta', payload: { cwd } },
    { timestamp: TODAY + 'T01:00:00Z', type: 'turn_context', payload: { model } },
    { timestamp: TODAY + 'T01:00:05Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: output } } } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  rollout('rollout-' + TODAY + 'T01-00-00-agent.jsonl', AGENT, 'gpt-agent-model', 7);
  rollout('rollout-' + TODAY + 'T01-00-00-mine.jsonl', PERSONAL, 'gpt-personal-model', 9);
  const real = (o) => scanProviders(Object.assign({}, o, { homes: { codex: [home], gemini: [], grok: [] } }));
  // CONTROL: the real reader read both rollouts, so a missing personal model below is the scoping, not an empty read.
  const all = await real({ sinceDay: TODAY, untilDay: TODAY });
  assert.ok(all.days[TODAY] && all.days[TODAY]['gpt-agent-model'] && all.days[TODAY]['gpt-personal-model'], 'CONTROL: the rollouts were not read: ' + JSON.stringify(all.days));
  const w = await usage.worldUsageByModel(1, { agentDirs: [AGENT], scanProviders: real });
  assert.equal(((w.byDay[TODAY] || {})['gpt-agent-model'] || {}).output_tokens, 7, 'the agent\'s own Codex session was not counted: ' + JSON.stringify(w.byDay));
  assert.equal((w.byDay[TODAY] || {})['gpt-personal-model'], undefined, 'a Codex session launched outside the agent\'s folder was counted for it');
});
