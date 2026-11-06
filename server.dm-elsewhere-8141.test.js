'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #8141: an agent that answers its person on another channel (a chat app) must not read as having ignored them.
 * Kosmos cannot see an answer given outside it; the one thing it keeps is the agent's own declaration of where it
 * answers (kosmos reply-channel, #5805, engine/replychannel.js). Three places now honour it:
 *   1. the DM thread route puts the declared channel on an owed `owes` (`owes.elsewhere`);
 *   2. the page says where it answers instead of "Nothing back yet." (dmOwesLine), with the same grace;
 *   3. the daily feedback digest (engine/feedbackday.js) counts only what was said in Kosmos and says so.
 * Each has a control: an agent that declared nothing reads exactly as before.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-elsewhere-8141-')));
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
const { start, server, keepAgentReply } = require('./server');
const chat = require('./engine/chat');
const create = require('./engine/create');
const replychannel = require('./engine/replychannel');
const day = require('./engine/feedbackday');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, chat.threadFile(chat.DIRECT, 'elsedm')]);

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);
const owesLine = new Function('OWES',
  page.lift(SCRIPT, 'esc') + '\n' + page.lift(SCRIPT, 'pjOldEnoughToJudge') + '\n'
  + 'const PJ_SILENCE_AFTER_MS = ' + SCRIPT.match(/const PJ_SILENCE_AFTER_MS = ([^;]+);/)[1] + ';\n'
  + page.lift(SCRIPT, 'dmOwesLine') + '\nreturn dmOwesLine(OWES);');

const OLD = new Date(Date.now() - 10 * 60000).toISOString();
const NEW = new Date().toISOString();

function agent(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(name), 'CLAUDE.md'), `# ${name}\n`);
  return name;
}
function personWrote(name, minutesAgo) {
  chat.appendMessage(chat.DIRECT, name, {
    text: 'Could you check the invoice?',
    at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    delivery: { state: chat.DELIVERY.PLACED },
  });
}

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

async function owes(name) {
  const res = await fetch(`${base}/api/agent/${name}/thread`);
  assert.equal(res.status, 200, 'the thread route did not answer for ' + name);
  return (await res.json()).owes;
}

test('#8141: an owed thread for an agent that declared a channel carries it', async () => {
  const name = agent('elsedm');
  replychannel.set(name, 'Telegram');
  personWrote(name, 5);
  const o = await owes(name);
  assert.equal(o.state, 'owes', JSON.stringify(o));
  assert.equal(o.elsewhere, 'Telegram', 'the route left out the declared channel: ' + JSON.stringify(o));
});

test('#8141: an agent that declared nothing carries no channel (CONTROL)', async () => {
  const name = agent('heredm');
  personWrote(name, 5);
  const o = await owes(name);
  assert.equal(o.state, 'owes', JSON.stringify(o));
  assert.equal(o.elsewhere, undefined, JSON.stringify(o));
});

test('#8141: a reply in Kosmos still clears it, declared channel or not', async () => {
  const name = agent('bothdm');
  replychannel.set(name, 'Telegram');
  personWrote(name, 5);
  keepAgentReply(name, 'Checked: it is paid.', new Date(Date.now() - 60000).toISOString());
  const o = await owes(name);
  assert.equal(o.state, 'clear', JSON.stringify(o));
  assert.equal(o.elsewhere, undefined, JSON.stringify(o));
});

test('#8141: the page says where it answers, escaped, instead of "Nothing back yet."', () => {
  const html = owesLine({ state: 'owes', lastHeardAt: OLD, elsewhere: 'Chat <b>app</b>' });
  assert.equal(html, '<p class="dmnone dmquiet">It says it answers you on Chat &lt;b&gt;app&lt;/b&gt;, which Kosmos cannot see.</p>');
  assert.doesNotMatch(html, /Nothing back yet/);
});

test('#8141: the page keeps the grace, the unsent answer first, and the old line without a channel (CONTROLS)', () => {
  assert.equal(owesLine({ state: 'owes', lastHeardAt: NEW, elsewhere: 'Telegram' }), '', 'the two-minute grace was lost');
  assert.match(owesLine({ state: 'owes', lastHeardAt: OLD, elsewhere: 'Telegram', unsent: { text: 'Done' } }),
    /It finished without replying here/, 'what Kosmos saw in its own window must come before a declaration');
  assert.equal(owesLine({ state: 'owes', lastHeardAt: OLD }), '<p class="dmnone dmquiet">Nothing back yet.</p>');
  assert.equal(owesLine({ state: 'owes', lastHeardAt: OLD, elsewhere: '' }), '<p class="dmnone dmquiet">Nothing back yet.</p>');
});

/* The digest, with injected readers: no live store is read. */
const DATE = '2026-11-03';
const at = (h, m) => new Date(2026, 10, 3, h, m).toISOString();
function digest(o) {
  return day.digest({ name: 'Dana', date: DATE, listTaskFiles: () => [], readTask: () => [], isGuide: () => false,
    replyChannel: () => null, ...o }).join('\n');
}
const fromPerson = [{ at: at(9, 30), text: 'Can you check the catalogue?', from: null }, { at: at(14, 5), text: 'Any news?', from: null }];

test('#8141: the digest counts only what was said in Kosmos and names the declared channel', () => {
  const out = digest({ readThread: () => fromPerson, replyChannel: () => 'Telegram' });
  assert.ok(out.includes('Your conversation with your person in Kosmos today: 2 from them, 0 from you.'), out);
  assert.ok(out.includes('You told Kosmos you answer your person on Telegram. Kosmos cannot see that, so what you said there is not counted here.'), out);
  assert.ok(!out.includes('kosmos reply-channel'), 'a declared agent is told to declare again: ' + out);
});

test('#8141: an empty day in Kosmos with a declared channel is not a bare "nothing today"', () => {
  const out = digest({ readThread: () => [], replyChannel: () => 'Telegram' });
  assert.ok(out.includes('Your conversation with your person in Kosmos: nothing today.'), out);
  assert.ok(out.includes('on Telegram'), out);
});

test('#8141: undeclared, the person wrote and nothing went back here: the digest names kosmos reply-channel', () => {
  const out = digest({ readThread: () => fromPerson });
  assert.ok(out.includes('If you answered them somewhere else, tell Kosmos where with: kosmos reply-channel "<where>"'), out);
});

test('#8141: undeclared and answered in Kosmos, or a quiet day: no hint (CONTROLS)', () => {
  const answered = digest({ readThread: () => [...fromPerson, { at: at(14, 6), text: 'Yes, done.', from: 'Dana' }] });
  assert.ok(answered.includes('2 from them, 1 from you'), answered);
  assert.ok(!answered.includes('reply-channel'), answered);
  const quiet = digest({ readThread: () => [] });
  assert.ok(!quiet.includes('reply-channel'), quiet);
});

test('#8141: a channel reader that throws counts as no declaration', () => {
  const out = digest({ readThread: () => fromPerson, replyChannel: () => { throw new Error('unreadable'); } });
  assert.ok(out.includes('2 from them, 0 from you'), out);
  assert.ok(!out.includes('You told Kosmos'), out);
});
