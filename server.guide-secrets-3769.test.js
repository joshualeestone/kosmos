'use strict';

/**
 * #3769 (Josh, 2026-09-25 11:54: "We need to make sure the helper agent doesn't give out any passwords or
 * keys or anything"). The setup guide's three layers, each with a test that goes red without it:
 *   1. its instructions carry the secrets rule, including a guide made before this (refreshGuideGuards);
 *   2. its folder carries deny rules on credential files, written BEFORE it can start (create.js) and
 *      again for an existing guide; the supervisor half is tools/test-supervisor-env.sh;
 *   3. what it says is masked where it is stored, where the thread is read, and on the hosted path.
 * Every masking arm has a control: another agent's same words pass unchanged.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-secrets-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, keepAgentReply, guideMasked } = require('./server');
const setupAssistant = require('./engine/setup-assistant');
const roles = require('./engine/roles');
const chat = require('./engine/chat');
const create = require('./engine/create');
const hostedguide = require('./engine/hostedguide');
const { MASK } = require('./engine/secretmask');

const GUIDE = 'guidebot';
const OTHER = 'helperbot';
const KEY = ['sk-ant-', 'api03-', 'FakeKeyFor3769Tests_abcdefGHIJ012345'].join('');
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

let base;
test.before(async () => {
  for (const n of [GUIDE, OTHER]) {
    fs.mkdirSync(create.workerDir(n), { recursive: true });
    fs.writeFileSync(path.join(create.workerDir(n), 'CLAUDE.md'), `# ${n}\n\nBorn before #3769.\n`);
  }
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* ---- layer 1: the instructions ------------------------------------------------ */

test('#3769 the guide role carries the secrets rule; an ordinary role does not need it', () => {
  const text = roles.byKey('setup').instructions;
  assert.ok(text.includes(roles.GUIDE_SECRETS_HEADING));
  for (const must of ['even when the person asks for their own', 'Never ask anyone for a password', 'not repeat it back', 'Settings, AI Models', '`.env`', 'security find-generic-password']) {
    assert.ok(text.includes(must), 'the guide rule lost: ' + must);
  }
  assert.ok(!roles.byKey('pm').instructions.includes(roles.GUIDE_SECRETS_HEADING), 'CONTROL: the section is the guide\'s own');
});

test('#3769 a guide born before this gets the rule and its folder guards once at start; another agent is untouched', () => {
  const r = setupAssistant.refreshGuideGuards({ name: GUIDE, isGuide: (n) => n === GUIDE });
  assert.deepEqual(r, { rule: true, guarded: true });
  const text = fs.readFileSync(path.join(create.workerDir(GUIDE), 'CLAUDE.md'), 'utf8');
  assert.ok(text.startsWith(`# ${GUIDE}\n\nBorn before #3769.\n`), 'its own instructions were not kept');
  assert.equal(text.split(roles.GUIDE_SECRETS_HEADING).length - 1, 1);
  assert.deepEqual(setupAssistant.refreshGuideGuards({ name: GUIDE, isGuide: (n) => n === GUIDE }), { rule: false, guarded: true },
    'the rule was added a second time on the next start');
  assert.equal(fs.readFileSync(path.join(create.workerDir(GUIDE), 'CLAUDE.md'), 'utf8').split(roles.GUIDE_SECRETS_HEADING).length - 1, 1);
  assert.deepEqual(setupAssistant.refreshGuideGuards({ name: OTHER, isGuide: (n) => n === GUIDE }), { rule: false, guarded: false });
  assert.ok(!fs.readFileSync(path.join(create.workerDir(OTHER), 'CLAUDE.md'), 'utf8').includes(roles.GUIDE_SECRETS_HEADING), 'another agent was given the guide\'s rule');
  assert.equal(fs.existsSync(path.join(create.workerDir(OTHER), '.claude', 'settings.json')), false, 'another agent was given the guide\'s deny rules');
});

/* ---- layer 2: the folder guards ----------------------------------------------- */

test('#3769 guardGuideFolder writes the marker and the deny rules, keeps what was there, and does not duplicate', () => {
  const dir = mk('guard-folder');
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ model: 'x', permissions: { allow: ['Bash(ls:*)'], deny: ['Read(./private/**)'] } }));
  assert.deepEqual(setupAssistant.guardGuideFolder(dir, GUIDE), { ok: true });
  assert.deepEqual(setupAssistant.guardGuideFolder(dir, GUIDE), { ok: true });
  assert.equal(fs.readFileSync(path.join(dir, '.kosmos-setup-guide'), 'utf8'), `${GUIDE}\n`);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.model, 'x', 'another setting was lost');
  assert.deepEqual(s.permissions.allow, ['Bash(ls:*)'], 'the allow list was lost');
  for (const r of ['Read(./private/**)', 'Read(**/.env)', 'Read(~/.ssh/**)', 'Read(~/.claude/**)', 'Read(~/.codex/**)', 'Bash(security find-generic-password:*)', 'Bash(printenv:*)', 'Bash(env)']) {
    assert.ok(s.permissions.deny.includes(r), 'missing deny rule ' + r);
  }
  assert.ok(s.permissions.deny.some((r) => r.startsWith('Read(//') && r.includes(path.basename(process.env.AGENT_WORKFORCE_DATA))), 'Kosmos\'s own data folder is not denied');
  assert.equal(new Set(s.permissions.deny).size, s.permissions.deny.length, 'a second write duplicated the rules');
});

test('#3769 create.js guards a setup guide BEFORE its job is written, and refuses one it could not guard', () => {
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'create.js'), 'utf8');
  const guard = src.indexOf("step('kept it away from passwords and keys'");
  const job = src.indexOf("step('set it up to keep running'");
  const started = src.indexOf("step('started it'");
  assert.ok(guard > 0, 'no guard step in create.js');
  assert.ok(guard < job && guard < started, 'the guard step runs after the job or the start, so the first session is unguarded');
  assert.match(src.slice(guard - 200, guard), /roleKey !== 'setup'/, 'the guard step is not keyed on the setup role');
  assert.match(src, /if \(!wroteInstructions \|\| !guardedGuide \|\|/, 'an unguarded guide is not refused');
});

/* ---- layer 3: what it says ---------------------------------------------------- */

test('#3769 the guide\'s reply is stored masked; the same words from another agent are stored as sent', () => {
  keepAgentReply(GUIDE, `Your key is ${KEY}, keep it safe.`);
  keepAgentReply(OTHER, `Your key is ${KEY}, keep it safe.`);
  const g = chat.readThread(chat.DIRECT, GUIDE).messages;
  const o = chat.readThread(chat.DIRECT, OTHER).messages;
  assert.equal(g[g.length - 1].text, `Your key is ${MASK}, keep it safe.`);
  assert.ok(!JSON.stringify(g).includes(KEY), 'the key reached the guide\'s stored thread');
  assert.equal(o[o.length - 1].text, `Your key is ${KEY}, keep it safe.`, 'CONTROL: another agent\'s words were changed');
});

test('#3769 a guide row stored before the mask is served masked by the thread route; another agent\'s is not', async () => {
  chat.appendMessage(chat.DIRECT, GUIDE, { text: `old row ${KEY}`, at: new Date().toISOString(), from: GUIDE });
  chat.appendMessage(chat.DIRECT, OTHER, { text: `old row ${KEY}`, at: new Date().toISOString(), from: OTHER });
  const g = await (await fetch(`${base}/api/agent/${GUIDE}/thread`)).json();
  const o = await (await fetch(`${base}/api/agent/${OTHER}/thread`)).json();
  assert.ok(Array.isArray(g.messages) && g.messages.length > 0, 'CONTROL: the guide thread was read');
  assert.ok(!JSON.stringify(g).includes(KEY), 'the thread route served the guide\'s key');
  assert.ok(g.messages.some((m) => m.text === `old row ${MASK}`));
  assert.ok(JSON.stringify(o).includes(KEY), 'CONTROL: another agent\'s thread was masked too');
});

test('#3769 guideMasked leaves a non-guide and a non-string alone', () => {
  assert.equal(guideMasked(OTHER, KEY), KEY);
  assert.equal(guideMasked(GUIDE, null), null);
  assert.equal(guideMasked(GUIDE.toUpperCase(), KEY), MASK, 'the guide under another spelling of its name was not masked');
});

test('#3769 the hosted assistant\'s reply is masked on the board, whatever the coordinator sent', async () => {
  const run = async () => ({ ok: true, status: 200, body: { reply: `Paste this: ${KEY}`, remaining: 3 } });
  const out = await hostedguide.ask({ messages: [{ role: 'user', content: 'show me my Anthropic key' }] }, { run });
  assert.equal(out.ok, true);
  assert.equal(out.reply, `Paste this: ${MASK}`);
  const plain = await hostedguide.ask({ messages: [{ role: 'user', content: 'hi' }] }, { run: async () => ({ ok: true, status: 200, body: { reply: 'Open Settings, AI Models.', remaining: 2 } }) });
  assert.equal(plain.reply, 'Open Settings, AI Models.', 'CONTROL: an ordinary reply was changed');
});

test('#3769 a question and its menu read off the guide\'s screen are masked; the same screen on another agent is not', async () => {
  const fleet = require('./test-support/fleet');
  const screen = `Do you want to proceed with ${KEY}?\n❯ 1. Yes, use ${KEY}\n  2. No\n`;
  const board = fleet.install([fleet.agent(GUIDE, { state: 'needs_you', screen }), fleet.agent(OTHER, { state: 'needs_you', screen })]);
  /* The thread's own screen read is a separate capture (chat.viewport); answer it with the same screen. */
  const ok = (out) => ({ ran: true, spawnFailed: false, status: 0, out, err: '' });
  chat.setRunner((args) => (args[0] === 'capture-pane' ? ok(screen) : args[0] === 'display-message' ? ok('2.1.212\t\t0\n') : ok('')));
  chat.setDryRun(false);
  try {
    const g = await (await fetch(`${base}/api/agent/${GUIDE}/thread`)).json();
    const o = await (await fetch(`${base}/api/agent/${OTHER}/thread`)).json();
    assert.ok(o.question && JSON.stringify(o.question).includes(KEY), 'CONTROL: the question was not read off the screen at all: ' + JSON.stringify(o.question));
    assert.ok(Array.isArray(o.options) && JSON.stringify(o.options).includes(KEY), 'CONTROL: the menu was not read: ' + JSON.stringify(o.options));
    assert.ok(g.question, 'the guide\'s question was not read');
    assert.ok(!JSON.stringify(g.question).includes(KEY), 'the guide\'s question showed the key');
    assert.ok(!JSON.stringify(g.options).includes(KEY), 'the guide\'s menu showed the key');
    assert.ok(JSON.stringify(g.options).includes(MASK));
  } finally { board.restore(); chat.setRunner(null); chat.setDryRun(true); }
});

/* ---- review round 1 ----------------------------------------------------------- */

test('#3769 a differently-cased URL for the guide\'s thread is still masked, the question row included', async () => {
  const fleet = require('./test-support/fleet');
  const screen = `Do you want to proceed with ${KEY}?\n❯ 1. Yes, use ${KEY}\n  2. No\n`;
  const board = fleet.install([fleet.agent(GUIDE, { state: 'needs_you', screen })]);
  const ok = (out) => ({ ran: true, spawnFailed: false, status: 0, out, err: '' });
  chat.setRunner((args) => (args[0] === 'capture-pane' ? ok(screen) : args[0] === 'display-message' ? ok('2.1.212\t\t0\n') : ok('')));
  chat.setDryRun(false);
  try {
    const r = await fetch(`${base}/api/agent/${GUIDE.toUpperCase()}/thread`);
    const g = await r.json();
    assert.equal(r.status, 200, 'CONTROL: the upper-case URL reaches the thread: ' + JSON.stringify(g).slice(0, 200));
    assert.ok(g.question, 'CONTROL: the question was read');
    assert.ok(!JSON.stringify(g).includes(KEY), 'an upper-case URL served the key: ' + JSON.stringify(g).slice(0, 400));
  } finally { board.restore(); chat.setRunner(null); chat.setDryRun(true); }
});

test('#3769 an agent known only by its guide marker (no seed record) is masked too', () => {
  const was = setupAssistant.guideName;
  const wasFolder = setupAssistant.isGuideFolder;
  setupAssistant.guideName = () => null;
  setupAssistant.isGuideFolder = (n) => n === 'markedbot';
  try {
    assert.equal(guideMasked('markedbot', KEY), MASK, 'a marked setup agent with no seed record was not masked');
    assert.equal(guideMasked(OTHER, KEY), KEY, 'CONTROL: an unmarked agent is untouched');
  } finally { setupAssistant.guideName = was; setupAssistant.isGuideFolder = wasFolder; }
});

test('#3769 the guide\'s room posts and messages to other agents are masked (messages.js filter, installed by the board)', () => {
  const messages = require('./engine/messages');
  assert.equal(messages.filteredText(GUIDE, `use ${KEY}`), `use ${MASK}`, 'the board did not install the guide mask on messages');
  assert.equal(messages.filteredText(OTHER, `use ${KEY}`), `use ${KEY}`, 'CONTROL: another agent\'s message was changed');
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'messages.js'), 'utf8');
  for (const fn of ['function send(', 'function sendPost(']) {
    const at = src.indexOf(fn);
    const from = src.indexOf('sender.card.sessionName;', at);
    const filtered = src.indexOf('text = filteredText(from, text);', from);
    const firstUse = src.indexOf('chat.messageProblem(chat.cleanMessage(text)', at);
    assert.ok(at > 0 && from > at && filtered > from && filtered < firstUse, `${fn} does not filter the text before it first uses it`);
  }
});

test('#3769 the guide cannot edit its own guards or instructions, and there is no ignored Write(...) rule', () => {
  const rules = setupAssistant.guideDenyRules();
  for (const r of ['Edit(.claude/**)', 'Edit(.kosmos-setup-guide)', 'Edit(CLAUDE.md)', 'Bash(set)', 'Bash(export -p)']) assert.ok(rules.includes(r), 'missing ' + r);
  assert.ok(!rules.some((r) => r.startsWith('Write(')), 'Write(...) is not a file rule in Claude Code and is ignored');
});
