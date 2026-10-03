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
  const html = B.tkReceiptAgentHtml({ who: 'ann', available: true, sessions: 1, models, files: ['src/a.js', 'b.md'], filesMore: 3, commands: 1, folder: '/w/ann' }, 'Ann');
  const t = text(html);
  assert.match(t, /Changed 5 files, ran 1 command, 1(\.0)?M tokens, \$10 at API prices\./);
  assert.match(t, /src\/a\.js b\.md and 3 more/);
  assert.match(t, /In \/w\/ann/);
  assert.doesNotMatch(t, /undo/i, 'no undo is offered in this slice');
});

test('an unpriced model is named, never guessed', () => {
  const t = text(B.tkReceiptAgentHtml({ available: true, sessions: 1, models: { 'claude-unknown-9': buckets(10, 10, 0, 0) }, files: [], commands: 0 }, 'Ann'));
  assert.match(t, /no published price for claude-unknown-9/);
  assert.doesNotMatch(t, /\$/);
});

test('another provider, no activity, and a missing folder each say so in words, never as zeros', () => {
  assert.match(text(B.tkReceiptAgentHtml({ available: false, because: 'provider', provider: 'codex' }, 'Bob')), /not available for Codex agents yet/);
  assert.match(text(B.tkReceiptAgentHtml({ available: true, sessions: 0, models: {}, files: [], commands: 0 }, 'Cy')), /No Claude Code activity found while it held this task/);
  assert.match(text(B.tkReceiptAgentHtml({ available: false, because: 'no-folder' }, 'Dee')), /nothing to read/);
});

test('the whole receipt: names escaped, the basis stated, put-backs and hand-offs counted', () => {
  const html = B.tkReceiptHtml({ retries: { reopened: 1, handoffs: 2 }, agents: [{ who: 'ann', available: true, sessions: 0, models: {} }] }, {});
  assert.ok(html.includes('Ann &lt;Lee&gt;'), 'the display name is escaped');
  assert.match(text(html), /Anything else it did in that time is included/);
  assert.match(text(html), /This task was put back 1 time and handed on 2 times\./);
  assert.match(text(B.tkReceiptHtml({ retries: {}, agents: [] }, {})), /Nobody held this task.*Done without being put back or handed on\./);
});
