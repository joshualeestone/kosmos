'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8958 slice B4: the iPhone draws a task's receipt in the board's words, so those words are written twice (web/index.html
   tkReceiptHtml and its helpers, ios/Kosmos/TaskPageLogic.swift). This holds them together through one file:
   ios/LogicTests/taskpage/receipt-words.json is what the page's own functions say for each case below, this test fails when
   the page no longer says it, and ios/LogicTests/run-taskpage.sh fails when the phone does not.
     node --test ios.receipt-words-8958.test.js
     node ios.receipt-words-8958.test.js --write     (after the page's words change: rewrites the file; then run-taskpage.sh) */
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const { modelsCost } = require('./engine/usageprice');

const FIXTURE = nodePath.join(__dirname, 'ios', 'LogicTests', 'taskpage', 'receipt-words.json');
const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

function pageFns() {
  /* usageNum groups digits as the browser's own locale does; the phone always as en-US, so the page is asked in en-US here
     whatever locale this runs under. */
  const num = page.lift(SCRIPT, 'usageNum');
  if (num.split('toLocaleString()').length !== 2) throw new Error('usageNum no longer calls toLocaleString() once; pin its locale here another way');
  const lift = (n) => (n === 'usageNum' ? num.replace('toLocaleString()', "toLocaleString('en-US')") : page.lift(SCRIPT, n));
  // eslint-disable-next-line no-new-func
  return new Function(page.liftConst(SCRIPT, 'USAGE_MODEL_PRICES') + '\n' + page.liftConst(SCRIPT, 'TKR_PROVIDER') + '\n'
    + page.liftConst(SCRIPT, 'TKU_WHY') + '\n'
    + ['esc', 'usageNum', 'usageAbbr', 'usageUsd', 'usageRowTokenTotal', 'usageModelPrice', 'usageApiCost', 'tkReceiptPrsHtml',
      'tkTokensAndCost', 'tkReceiptAgentHtml', 'tkReceiptHtml', 'tkUndoListHtml', 'tkUndoDoneLine'].map(lift).join('\n')
    + '\nfunction tkMemberName(p, sn) { return sn; }\n'
    + 'return { usageAbbr, usageUsd, tkReceiptAgentHtml, tkReceiptHtml, tkUndoListHtml, tkUndoDoneLine, TKU_WHY };')();
}

const plainText = (html) => html.replace(/<span class="vh">[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/* Every line of words, in the order the page draws them: paragraphs, the files button, the list's items. */
const linesOf = (html) => [...html.matchAll(/<(p|li|button|h3)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => plainText(m[2])).filter(Boolean);
const linksOf = (html) => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

const b = (i, o, cw, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, rows: 7 });
const did = (over) => ({ who: 'ann', available: true, provider: 'claude', transcriptsWithWork: 1, models: {}, files: [], filesMore: 0, commands: 0, ...over });
const pr = (repo, number, url) => ({ repo, number, url: url === undefined ? 'https://github.com/' + repo + '/pull/' + number : url });
const AGENTS = [
  did({ models: { 'claude-fable-5': b(1e6, 0, 0, 0) }, files: ['src/a.js', 'b.md'], filesMore: 3, commands: 1, folder: '/w/ann' }),
  did({ models: { 'claude-opus-5': b(1234567, 765432, 111111, 9999999), 'zz-new': b(5, 5, 5, 5) }, files: ['a <b> & "c".md'], commands: 1234, folder: '/w/ann' }),
  did({ models: { 'zz-new': b(10, 10, 0, 0), 'aa-new': b(1, 0, 0, 0), 'claude-opus-5': b(0, 0, 0, 0) }, commands: 2 }),
  did({ models: { 'zz-new': b(10, 10, 0, 0), 'aa-new': b(1, 0, 0, 0) }, commands: 2, folder: '/w/ann' }),
  did({ models: {}, files: ['one.md'], filesMore: 0 }),
  did({ models: { 'claude-opus-5': b(4e8, 1e8, 0, 9e9) }, files: [], filesMore: 1500, commands: 0 }),
  did({ prs: [pr('acme/app', 12)], prsMore: 0 }),
  did({ prs: [pr('acme/app', 1, null), pr('acme/relay', 2)], prsMore: 3 }),
  did({ prs: [pr('acme/app', 1), pr('acme/app', 2)], prsMore: 1200, upTo: true }),
  did({ prs: [pr('acme/app', 5, 'javascript:alert(1)'), pr('acme/app', 6, 'https://github.com/acme/app/pull/6/files'), pr('acme/app', 7, 'https://github.com/acme/app/pull/7\n')] }),
  did({ prs: [null, pr('acme/app', 9, null)] }),
  did({ prs: [], prsMore: 4 }),
  did({ transcriptsWithWork: 0 }),
  did({ transcriptsWithWork: 0, provider: undefined }),
  did({ transcriptsWithWork: 0, provider: 'gemini' }),
  did({ transcriptsWithWork: 0, provider: 'newtool' }),
  { who: 'bob', available: false, because: 'provider', provider: 'codex' },
  { who: 'bob', available: false, because: 'provider', provider: 'newtool' },
  { who: 'bob', available: false, because: 'provider' },
  { who: 'dee', available: false, because: 'no-folder' },
];
const WHOLE = [
  { r: { retries: { reopened: 1, handoffs: 2 }, agents: [AGENTS[12]] } },
  { r: { retries: { reopened: 0, handoffs: 1 }, agents: [] } },
  { r: { retries: { reopened: 1200, handoffs: 0 }, agents: [] }, replacedBy: 5 },
  { r: { retries: {}, agents: [] } },
  { r: { agents: [] } },
  { r: { retries: {}, agents: [] }, replacedBy: 5 },
  { r: { retries: {}, agents: [] }, notRun: true },
];
/* kosmos#8958 slice B5: the undo list, one file for every action and reason, then the shapes around them. */
const UNDO_ROOT = '/Users/sam/Kosmos/undo-saved';
function undoPlans(why) {
  const f = (name, over) => ({ path: '/w/ann/' + name, shown: name, agent: 'ann', action: 'restore', ok: true, ...over });
  return [
    { on: true, ready: true, savedRoot: UNDO_ROOT, files: [f('a.js', {}), f('new.md', { action: 'move-aside' }),
      ...Object.keys(why).filter((k) => k !== 'restore' && k !== 'move-aside').map((k) => f(k + '.md', { ok: false, why: k }))] },
    { on: true, files: [f('new.md', { action: 'move-aside' }), f('later.md', { ok: false, why: 'a-reason-from-later' }), f('none.md', { ok: false })] },
    { on: true, savedRoot: UNDO_ROOT, files: [f('a <b> & "c".md', {}), f('x.md', { shown: '' }), f('moved.md', { action: 'move-aside', ok: false, why: 'gone' })] },
  ];
}
/* How many were done and left, and where the old versions went; the lists are made from the counts here and on the phone. */
const UNDO_DONE = [[1, 0, UNDO_ROOT + '/1'], [2, 1, UNDO_ROOT + '/1'], [0, 2, null], [0, 0, null], [1234, 2345, '']];
const undone = ([done, skipped, savedIn]) => ({ done: Array.from({ length: done }, (_, i) => '/w/f' + i), skipped: Array.from({ length: skipped }, () => ({})), savedIn });
/* Each row of the list: the file sent back, its name and reason, and whether it is chosen and can be. */
const rowsOf = (html) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => {
  const [, input, name, why] = m[1].match(/<input ([^>]*)><span>([\s\S]*?)<span class="tku-why"[^>]*>([\s\S]*?)<\/span>/);
  return { path: plainText(input.match(/data-path="([^"]*)"/)[1]), shown: plainText(name), why: plainText(why), chosen: / checked\b/.test(input), choosable: !/ disabled\b/.test(input) };
});
/* A sentence the page writes inside its code, not through a function this can call. */
function sentence(re) {
  const found = [...new Set([...SCRIPT.matchAll(re)].map((m) => m[1]))];
  if (found.length !== 1) throw new Error('the page says ' + found.length + ' things for ' + re);
  return found[0];
}

/* Around every unit's edge, and exact ties (12.5, 0.125), where toFixed and printf round apart. */
const ABBR = [0, 1, 999, 1000, 1499, 1500, 2500, 12500, 999499, 999500, 999999, 1e6, 1250000, 1350000, 99949999, 999949999, 999950000, 1e9, 1250000000, 9949999999, 9950000000, 9999999999, 1e10, 10500000000, 12500000000, 150e9];
const USD = [0, 0.004, 0.005, 0.125, 0.375, 1.005, 2.5, 9.994, 9.995, 9.999, 10, 10.5, 11.5, 12.49, 999.4, 999.5, 1000, 1000.5, 176332.49, 999999.5, 1e6, 2500000, 3500000, 1e9, 1125000000, 2.5e9];

function build() {
  const P = pageFns();
  return {
    about: 'What web/index.html says for a task receipt. Written by ios.receipt-words-8958.test.js --write; never by hand.',
    abbr: ABBR.map((v) => [v, P.usageAbbr(v)]),
    usd: USD.map((v) => [v, P.usageUsd(v)]),
    agents: AGENTS.map((a) => {
      const html = P.tkReceiptAgentHtml(a, 'Ann');
      return { given: a.available ? { ...a, cost: modelsCost(a.models) } : a, lines: linesOf(html), links: linksOf(html) };
    }),
    whole: WHOLE.map(({ r, replacedBy, notRun }) => ({ given: r, replaced: Number.isInteger(replacedBy), unrun: notRun === true, lines: linesOf(P.tkReceiptHtml(r, {}, replacedBy, notRun)) })),
    undo: {
      why: P.TKU_WHY,
      plans: undoPlans(P.TKU_WHY).map((plan) => {
        const html = P.tkUndoListHtml(plan);
        return { given: plan, rows: rowsOf(html), title: plainText(html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)[1]),
          intro: plainText(html.match(/<p class="tkr-intro">([\s\S]*?)<\/p>/)[1]), go: plainText(html.match(/data-undo="go">([\s\S]*?)<\/button>/)[1]) };
      }),
      done: UNDO_DONE.map((c) => ({ done: c[0], skipped: c[1], savedIn: c[2], line: P.tkUndoDoneLine(undone(c)) })),
      open: sentence(/data-undo="open">([^<]*)<\/button>/g),
      choose: sentence(/if \(!paths\.length\) \{ msg\.textContent = '([^']*)'/g),
      failed: sentence(/if \(!res\.ok\) \{ msg\.textContent = out\.error \|\| '(We could not undo[^']*)'/g),
    },
  };
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(FIXTURE, JSON.stringify(build(), null, 1) + '\n');
  console.log('wrote ' + FIXTURE);
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  test('kosmos#8958 B4: the words the iPhone is tested against are the page\'s own', () => {
    const now = JSON.parse(JSON.stringify(build()));
    assert.ok(now.agents.some((a) => a.lines.some((l) => / at API prices/.test(l))), 'control: the page was lifted and priced something');
    assert.ok(now.agents.every((a) => a.lines.length >= 1) && now.whole.every((w) => w.lines.length >= 2), 'control: every case has words');
    assert.ok(now.undo.plans.every((x) => x.rows.length === x.given.files.length) && now.undo.plans[0].rows.length === Object.keys(now.undo.why).length,
      'control: a row for every file, and a file for every reason');
    assert.deepEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), now,
      'the page\'s receipt words changed: node ios.receipt-words-8958.test.js --write, then make ios/Kosmos/TaskPageLogic.swift say them (ios/LogicTests/run-taskpage.sh)');
  });
}
