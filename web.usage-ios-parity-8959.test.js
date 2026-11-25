'use strict';
/* kosmos#8959 slice D1c2a: the iPhone's Token usage figures are the page's.
 *
 * The phone ports web/index.html's usage functions to Swift (ios/Kosmos/UsageLogic.swift). Its logic suite
 * (ios/LogicTests/run-usage.sh) checks the port against ios/LogicTests/usage/expected.json; this test checks that the
 * PAGE still produces exactly that file, by running the page's own functions (lifted out between `function usageNum`
 * and `let USAGE_BUSY`) on ios/LogicTests/usage/fixture.json. So a change on either side fails one of the two: the
 * page's arithmetic or rounding moving, or the phone's.
 * If the page changes on purpose: run this test, copy the "actual" it prints into expected.json, then make the phone
 * match (run-usage.sh).
 *   node --test web.usage-ios-parity-8959.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const dir = path.join(__dirname, 'ios', 'LogicTests', 'usage');

function pageFunctions() {
  const a = page.indexOf('function usageNum(n) {');
  const b = page.indexOf('let USAGE_BUSY = false;');
  assert.ok(a > 0 && b > a, 'the usage functions moved: re-anchor this test');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* The page groups with toLocaleString() in the reader's own locale; this pins en-US, as the phone's suite does, so
     a machine with another locale does not read a grouping difference as the page's arithmetic changing. */
  const src = page.slice(a, b);
  const bare = (src.match(/\.toLocaleString\(\)/g) || []).length;
  const compares = (src.match(/\.localeCompare\(([^()]*)\)/g) || []).length;
  assert.ok(bare >= 1, 'the page no longer calls toLocaleString(): re-check what this pins');
  // Every locale-dependent call in the slice must be one this pins, or the machine's locale leaks back in.
  assert.equal((src.match(/toLocaleString\(|Intl\.|localeCompare\(|toLocale[A-Z]/g) || []).length, bare + compares,
    'the usage functions call something locale-dependent this test does not pin');
  const pinned = src.replace(/\.toLocaleString\(\)/g, ".toLocaleString('en-US')")
    .replace(/\.localeCompare\(([^()]*)\)/g, ".localeCompare($1, 'en-US')");
  // eslint-disable-next-line no-new-func
  return new Function('esc', pinned + '; return { usageTotals, usageGrandTotal, usageAbbr, usageBigTokens, usageUsd, usageUsdTileSub1M, usageRowValue, usageActiveDays, usageByModel, usageAgentRows, usageAgentNote, usageApiCost, usageHeroHtml, usageShareTableHtml, usageHistoryHtml };')(esc);
}

/* What the page shows for the fixture and for each formatter's inputs. Numbers are formatted in en-US, which the
   suite pins on the phone too (toLocaleString pinned to en-US above, NumberFormatter there). */
function actual(f, fx, inputs) {
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const cells = (html, re) => (html.match(re) || []).map((s) => unesc(s.replace(/<[^>]*>/g, '').replace(/<$/, '')));
  const totals = f.usageTotals(fx.byDay);
  const grand = f.usageGrandTotal(totals);
  const api = f.usageApiCost(fx.byDay);
  const days = f.usageActiveDays(fx);
  const models = f.usageByModel(fx.byDay);
  const table = cells(f.usageShareTableHtml('Model', models, grand, () => 'c'), /<div class="tv-num">[^<]*</g);
  const hist = cells(f.usageHistoryHtml(fx.byDay), /<div class="uh-[dmn]"[^>]*>[^<]*</g).slice(2);
  const rows = [];
  for (let i = 0; i < hist.length; i += 4) rows.push(hist.slice(i, i + 4));
  return {
    formatters: {
      abbr: inputs.abbr.map(f.usageAbbr),
      big: inputs.big.map(f.usageBigTokens),
      usd: inputs.usd.map(f.usageUsd),
      tile: inputs.tile.map(f.usageUsdTileSub1M),
      rowValue: inputs.rowValue.map(f.usageRowValue),
    },
    grand,
    apiCost: api.cost,
    unpriced: api.unpriced,
    hero: [String(days)].concat(cells(f.usageHeroHtml(totals, days, api.cost), /<div class="tv-fig">[^<]*</g)),
    models: models.map((m) => [m.name, m.tok]),
    modelCells: table.slice(2),
    agents: f.usageAgentRows(fx.byAgent).map((r) => [r.name, r.tok, r.muted]),
    agentNote: f.usageAgentNote(fx.byAgent),
    history: rows,
  };
}

test('#8959 the page computes exactly what the phone is checked against (expected.json)', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
  const got = actual(pageFunctions(), fx, expected.inputs);
  const want = { ...expected }; delete want.inputs;
  assert.deepEqual(got, want, 'the page now computes:\n' + JSON.stringify(got));
});

test('#8959 control: a fixture with one more token changes what the page computes', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
  fx.byDay['2026-11-24']['gpt-5.1'].output_tokens += 1;
  const got = actual(pageFunctions(), fx, expected.inputs);
  const want = { ...expected }; delete want.inputs;
  assert.notDeepEqual(got, want);
});
