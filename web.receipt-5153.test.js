'use strict';
/* #5153 slice 1: the words a closed task's change receipt shows, from the real functions in web/index.html.
 *   node --test web.receipt-5153.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);

function bundle() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftConst(SCRIPT, 'USAGE_MODEL_PRICES') + '\n'
    + page.liftConst(SCRIPT, 'TKR_PROVIDER') + '\n'
    + lift('esc') + '\n'
    + lift('usageNum') + '\n'
    + lift('usageAbbr') + '\n'
    + lift('usageUsd') + '\n'
    + lift('usageRowTokenTotal') + '\n'
    + lift('usageModelPrice') + '\n'
    + lift('usageApiCost') + '\n'
    + lift('tkReceiptAgentHtml') + '\n'
    + lift('tkReceiptHtml') + '\n'
    + 'function tkMemberName(p, sn) { return sn === "ann" ? "Ann <Lee>" : sn; }\n'
    + 'return { tkReceiptAgentHtml, tkReceiptHtml, usageApiCost };',
  )();
}
const B = bundle();
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const buckets = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 1 });

test('a Claude agent: files, a command count, tokens and an at-API-prices figure from the one price table', () => {
  const models = { 'claude-fable-5': buckets(1e6, 0, 0, 0) };
  const priced = B.usageApiCost({ receipt: models }).cost;
  assert.ok(priced > 0, 'control: the fixture model is priced in the page\'s table');
  const html = B.tkReceiptAgentHtml({ who: 'ann', available: true, transcriptsWithWork: 1, models, files: ['src/a.js', 'b.md'], filesMore: 3, commands: 1, folder: '/w/ann' }, 'Ann');
  const t = text(html);
  assert.match(t, /Edited 5 files, ran 1 command, 1(\.0)?M tokens, \$10 at API prices\./);
  assert.match(t, /src\/a\.js b\.md and 3 more/);
  assert.match(t, /In \/w\/ann/);
  assert.doesNotMatch(t, /undo/i, 'no undo is offered in this slice');
});

test('an unpriced model is named, never guessed', () => {
  const t = text(B.tkReceiptAgentHtml({ available: true, transcriptsWithWork: 1, models: { 'claude-unknown-9': buckets(10, 10, 0, 0) }, files: [], commands: 0 }, 'Ann'));
  assert.match(t, /no published price for claude-unknown-9/);
  assert.doesNotMatch(t, /\$/);
});

test('another provider, no activity, and a missing folder each say so in words, never as zeros', () => {
  assert.match(text(B.tkReceiptAgentHtml({ available: false, because: 'provider', provider: 'codex' }, 'Bob')), /not available for Codex agents yet/);
  assert.match(text(B.tkReceiptAgentHtml({ available: true, transcriptsWithWork: 0, models: {}, files: [], commands: 0 }, 'Cy')), /No Claude Code activity found while it held this task/);
  assert.match(text(B.tkReceiptAgentHtml({ available: false, because: 'no-folder' }, 'Dee')), /nothing to read/);
});

test('the whole receipt: names escaped, the basis stated, put-backs and hand-offs counted', () => {
  const html = B.tkReceiptHtml({ retries: { reopened: 1, handoffs: 2 }, agents: [{ who: 'ann', available: true, transcriptsWithWork: 0, models: {} }] }, {});
  assert.ok(html.includes('Ann &lt;Lee&gt;'), 'the display name is escaped');
  assert.match(text(html), /including anything else it did in that time\. A file changed by a command counts as a command\./);
  assert.ok(html.indexOf('This task was put back') < html.indexOf('>Receipt<'), 'the put-back line comes first, then the receipt (Mona Lisa)');
  assert.ok(html.includes('<h3 class="dlab">Receipt</h3>'), 'the column\'s kicker heading');
  assert.match(text(html), /This task was put back 1 time and handed on 2 times\./);
  assert.match(text(B.tkReceiptHtml({ retries: {}, agents: [] }, {})), /^Done without being put back or handed on\. Receipt .*Nobody held this task/);
});

test('two unpriced models read "which have"', () => {
  const t = text(B.tkReceiptAgentHtml({ available: true, transcriptsWithWork: 1, models: { 'claude-fable-5': buckets(1e6, 0, 0, 0), 'x-one': buckets(1, 1, 0, 0), 'x-two': buckets(1, 1, 0, 0) }, files: [], commands: 0 }, 'Ann'));
  assert.match(t, /not counting x-one, x-two, which have no published price/);
});

/* paintTaskReceipt against stubs: the real function, with its page globals passed in. */
function painter(state) {
  const holder = { hidden: true, innerHTML: '' };
  // eslint-disable-next-line no-new-func
  const make = new Function('document', 'pjById', 'fetch', 'tkReceiptHtml', 'S',
    'var PJ_CURRENT = "p1"; var TKR_SEQ = 0; Object.defineProperty(globalThis, "TK_OPEN", { get: () => S.open, configurable: true });\n'
    + lift('tkTaskClosed') + '\n' + lift('paintTaskReceipt') + '\nreturn paintTaskReceipt;');
  const paint = make({ getElementById: () => holder }, () => ({ id: 'p1', tasks: [state.task] }), state.fetch, () => 'RECEIPT', state);
  return { paint, holder };
}

test('a task closed by closing its last part shows its receipt (its progress says closed, it has no closedAt)', async () => {
  const state = { open: 4, task: { number: 4, closedAt: null, progress: { closed: true } },
    fetch: async () => ({ ok: true, json: async () => ({ agents: [] }) }) };
  const { paint, holder } = painter(state);
  await paint(4);
  assert.equal(holder.hidden, false);
  assert.equal(holder.innerHTML, 'RECEIPT');
});

test('a slow receipt read that lands after the task was put back does not paint it', async () => {
  let release;
  const slow = new Promise((ok) => { release = ok; });
  const state = { open: 4, task: { number: 4, closedAt: '2026-10-01T12:00:00Z' },
    fetch: async () => { await slow; return { ok: true, json: async () => ({ agents: [] }) }; } };
  const { paint, holder } = painter(state);
  const first = paint(4);                                   // opened while closed: the read is slow
  state.task = { number: 4, closedAt: null };               // the person puts it back
  await paint(4);                                           // the reopen's repaint hides it
  release();
  await first;
  assert.equal(holder.hidden, true, 'the old read painted a receipt on a reopened task');
  assert.equal(holder.innerHTML, '');
});

test('the poll paints the receipt only when the open task or its closed state changed', () => {
  const calls = [];
  const state = { closed: false };
  // eslint-disable-next-line no-new-func
  const sync = new Function('pjById', 'paintTaskReceipt',
    'var PJ_CURRENT = "p1"; var TK_OPEN = 4; var TKR_SHOWN = null; var TKR_FAILED = null; var TKR_RETRY_MS = 30000;\n' + lift('tkTaskClosed') + '\n' + lift('tkReceiptSync') + '\nreturn tkReceiptSync;',
  )(() => ({ id: 'p1', tasks: [{ number: 4, closedAt: null, progress: { closed: state.closed } }] }), (n) => calls.push(n));
  sync();
  sync();
  assert.equal(calls.length, 1, 'painted on every poll, not on a change');
  state.closed = true;          // an agent closed it: the next poll shows the receipt
  sync();
  sync();
  state.closed = false;         // put back from another window: the next poll hides it
  sync();
  assert.deepEqual(calls, [4, 4, 4]);
});

test('a receipt read that fails is tried again on the next poll, not left hidden while the page stays open', async () => {
  const holder = { hidden: true, innerHTML: '' };
  let fails = 1;
  let reads = 0;
  // eslint-disable-next-line no-new-func
  let now = Date.parse('2026-10-03T12:00:00Z');
  const FakeDate = { now: () => now };
  const sync = new Function('document', 'pjById', 'fetch', 'tkReceiptHtml', 'Date',
    'var PJ_CURRENT = "p1"; var TK_OPEN = 4; var TKR_SHOWN = null; var TKR_SEQ = 0; var TKR_FAILED = null; var TKR_RETRY_MS = 30000;\n'
    + lift('tkTaskClosed') + '\n' + lift('paintTaskReceipt') + '\n' + lift('tkReceiptSync') + '\nreturn tkReceiptSync;',
  )({ getElementById: () => holder }, () => ({ id: 'p1', tasks: [{ number: 4, closedAt: '2026-10-01T12:00:00Z' }] }),
    async () => { reads += 1; if (fails-- > 0) throw new Error('board restarting'); return { ok: true, json: async () => ({ agents: [] }) }; },
    () => 'RECEIPT', FakeDate);
  sync();
  await new Promise((r) => setImmediate(r));
  assert.equal(holder.hidden, true, 'control: the first read failed');
  now += 5000;
  sync();                       // the next poll, five seconds on: too soon to read again
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 1, 'a failing read is retried on every poll');
  now += 30000;
  sync();                       // a poll after the wait
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 2, 'the failed read was not tried again');
  assert.equal(holder.hidden, false);
  sync();
  await new Promise((r) => setImmediate(r));
  assert.equal(reads, 2, 'a good read is not repeated on every poll');
});

test('closed, put back and closed again between two polls repaints for the new close', () => {
  const calls = [];
  const task = { number: 4, closedAt: '2026-10-01T12:00:00Z' };
  // eslint-disable-next-line no-new-func
  const sync = new Function('pjById', 'paintTaskReceipt',
    'var PJ_CURRENT = "p1"; var TK_OPEN = 4; var TKR_SHOWN = null; var TKR_FAILED = null; var TKR_RETRY_MS = 30000;\n' + lift('tkTaskClosed') + '\n' + lift('tkReceiptSync') + '\nreturn tkReceiptSync;',
  )(() => ({ id: 'p1', tasks: [task] }), (n) => calls.push(n));
  sync();
  task.closedAt = '2026-10-01T12:04:00Z';
  sync();
  assert.equal(calls.length, 2);
  // Closed through its last part (no closedAt of its own): the newest part's close is the key.
  delete task.closedAt;
  task.progress = { closed: true, done: 1 };
  task.parts = [{ id: 1, closedAt: '2026-10-01T12:10:00Z' }];
  sync();
  task.parts = [{ id: 1, closedAt: '2026-10-01T12:20:00Z' }];   // put back and closed again by its part
  sync();
  assert.equal(calls.length, 4);
});

test('the files are the page\'s own toggle ("N files", a plain list, the folder as its foot), and every line one size', () => {
  const html = B.tkReceiptAgentHtml({ available: true, transcriptsWithWork: 1, models: {}, files: ['a.md', 'b.md'], filesMore: 0, commands: 0, folder: '/w/x' }, 'Ann');
  assert.ok(!html.includes('<details'), 'the browser\'s own toggle');
  assert.match(html, /<button type="button" class="linkish tkr-files-btn" aria-expanded="false">2 files<svg/);
  assert.match(html, /<ul class="tkr-files" hidden><li>a\.md<\/li><li>b\.md<\/li><li class="tkr-where">In \/w\/x<\/li><\/ul>/);
  const na = B.tkReceiptAgentHtml({ available: false, because: 'provider', provider: 'codex' }, 'Cleo');
  assert.ok(na.includes('class="tkr-line tkr-muted"') && !na.includes('dhint'), 'the not-available line is the numbers line\'s size, muted');
  assert.match(RAW, /@media \(max-width: 40rem\) \{ \.linkish\.tkr-files-btn \{ display: flex; width: 100%; min-height: 44px; \} \}/);
  // The rendered height is measured by the phone shots' tap audit (mobile-shots task-receipt: taps<44 must read 0).
});

test('slice 2: a Codex or Gemini agent with no activity names its own tool', () => {
  assert.match(text(B.tkReceiptAgentHtml({ available: true, provider: 'codex', transcriptsWithWork: 0, models: {} }, 'Kay')), /No Codex activity found while it held this task/);
  assert.match(text(B.tkReceiptAgentHtml({ available: true, provider: 'gemini', transcriptsWithWork: 0, models: {} }, 'Lu')), /No Gemini CLI activity found/);
  assert.match(text(B.tkReceiptAgentHtml({ available: true, provider: 'claude', transcriptsWithWork: 0, models: {} }, 'Ann')), /No Claude Code activity found/);
});

/* ---- slice 3: Profile's Recent work ---- */
function workBundle() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftConst(SCRIPT, 'USAGE_MODEL_PRICES') + '\n' + page.liftConst(SCRIPT, 'TKR_PROVIDER') + '\n'
    + ['esc', 'usageNum', 'usageAbbr', 'usageUsd', 'usageRowTokenTotal', 'usageModelPrice', 'usageApiCost', 'dWorkMeta', 'dWorkRowHtml'].map(lift).join('\n')
    + '\nreturn { dWorkMeta, dWorkRowHtml };',
  )();
}
const WB = workBundle();
const NOW = Date.parse('2026-10-03T20:00:00Z');

test('a Recent work row: the task\'s sentence over "closed <date> · files · commands · tokens · about $ at API prices"', () => {
  const item = { project: 'p1', number: 7, sentence: 'Write the <launch> notes', closedAt: '2026-10-02T15:00:00Z',
    receipt: { who: 'ann', available: true, transcriptsWithWork: 1, files: ['a.md', 'b.md'], filesMore: 0, commands: 1,
      models: { 'claude-fable-5': buckets(1e6, 0, 0, 0) } } };
  const meta = WB.dWorkMeta(item, NOW);
  const day = new Date('2026-10-02T15:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });   // this machine's own words for the date
  assert.equal(meta.replace(/1\.0M/, '1M'), 'closed ' + day + ' · 2 files · 1 command · 1M tokens · about $10 at API prices');
  const html = WB.dWorkRowHtml(item, NOW);
  assert.ok(html.includes('Write the &lt;launch&gt; notes'), 'the sentence is escaped');
  assert.ok(html.includes('data-project="p1"') && html.includes('data-task="7"'));
  assert.ok(html.startsWith('<button type="button"'), 'a row is a button: reachable from the keyboard');
});

test('a Recent work row for an agent that cannot be read, or did nothing, says so instead of zeros', () => {
  const base = { project: 'p1', number: 1, sentence: 's', closedAt: '2026-10-02T15:00:00Z' };
  assert.match(WB.dWorkMeta({ ...base, receipt: { available: false, because: 'provider', provider: 'grok' } }, NOW), /not available for Grok agents yet$/);
  assert.match(WB.dWorkMeta({ ...base, receipt: { available: true, transcriptsWithWork: 0, models: {} } }, NOW), /no activity found$/);
  assert.doesNotMatch(WB.dWorkMeta({ ...base, receipt: { available: true, transcriptsWithWork: 0, models: {} } }, NOW), /0 files/);
  assert.match(WB.dWorkMeta({ ...base, closedAt: '2025-01-05T15:00:00Z', receipt: null }, NOW), /2025/, 'another year names its year');
});

test('Recent work sits inside Profile, not in the nav (Mona Lisa\'s placement)', () => {
  const profile = RAW.slice(RAW.indexOf('id="d-sec-profile"'), RAW.indexOf('id="d-sec-instr"'));
  assert.ok(profile.includes('id="d-work"') && profile.includes('>Recent work<'));
  const nav = RAW.slice(RAW.indexOf('class="dnav-pack"'), RAW.indexOf('class="dnav-pack"') + 2000);
  assert.ok(!/Recent work|data-go="work"/.test(nav), 'a nav entry was added');
});

test('the link under Recent work does not promise this agent\'s tasks while the Tasks page cannot filter by agent', () => {
  const box = RAW.slice(RAW.indexOf('id="d-work"'), RAW.indexOf('id="d-work"') + 1500);
  assert.match(box, />Open the Tasks page</);
  assert.doesNotMatch(box, />See all/);
});

test('Open the Tasks page goes through the Tasks page\'s own door for all tasks, and only while its tab is in the bar', () => {
  assert.match(SCRIPT, /getElementById\('d-work-more'\)\.addEventListener\('click', \(\) => openProjectTasks\(null\)\)/);
  assert.match(SCRIPT, /more\.hidden = !\(body\.more && !\(tab && tab\.hidden\)\)/);
});
