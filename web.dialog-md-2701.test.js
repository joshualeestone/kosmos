'use strict';
/**
 * #2701: the dialog message renderers must render markdown TABLES and size
 * heading LEVELS. Josh (design channel, 2026-09-10): "tables don't render
 * correctly in the dialog box and neither do emojis at different sizes." Both
 * message renderers had the same gaps -- no table branch, and one mdh size for
 * every `#`..`######` -- so a table came out as literal piped text and a `#`
 * heading (and any emoji in it) was the same size as a `######` one.
 *
 * These lift the REAL renderers from web/index.html and assert both surfaces:
 * pjProse (the project room thread, .msg-b) and pjRich (the talk/DM dialog,
 * .dm-b, and the project message list, .pj-msg-text).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const lift = (names) => names.map((n) => page.lift(SCRIPT, n)).join('\n');

const TABLE_DEPS = ['esc', 'pjRichSpans', 'pjTableCells', 'pjTableAligns', 'pjTableHtml'];
const proseFn = () => new Function(lift(TABLE_DEPS.concat(['pjProse'])) + '\nreturn pjProse;')();
const richFn = () => new Function(lift(TABLE_DEPS.concat(['pjRich'])) + '\nreturn pjRich;')();

const TABLE = 'Head:\n| Col A | Col B |\n| :--- | ---: |\n| a1 | b1 |\n| a2 | b2 |';

for (const [name, make] of [['pjProse', proseFn], ['pjRich', richFn]]) {
  test(`#2701: ${name} renders a markdown table as a real table, not piped text`, () => {
    const fn = make();
    const html = fn(TABLE);
    assert.match(html, /<table class="mdtable">/, `${name}: no table element emitted`);
    assert.match(html, /<thead><tr><th[^>]*>Col A<\/th><th[^>]*>Col B<\/th><\/tr><\/thead>/, `${name}: header row wrong`);
    assert.match(html, /<td[^>]*>a1<\/td>/, `${name}: body cell a1 missing`);
    assert.match(html, /<td[^>]*>b2<\/td>/, `${name}: body cell b2 missing`);
    // The separator row must NOT appear as visible text, and the pipes must be gone.
    assert.doesNotMatch(html, /:---/, `${name}: the separator row leaked as text`);
    assert.doesNotMatch(html, /\| Col A \|/, `${name}: the raw piped header leaked as text (table not parsed)`);
    // Alignment colons become text-align.
    assert.match(html, /text-align:left/, `${name}: left-align (:---) not applied`);
    assert.match(html, /text-align:right/, `${name}: right-align (---:) not applied`);
  });

  test(`#2701: ${name} sizes heading levels (mdh1..mdh6), not one collapsed size`, () => {
    const fn = make();
    const html = fn('# One\n## Two\n### Three\n###### Six');
    assert.match(html, /class="mdh mdh1">One</, `${name}: # did not emit mdh1`);
    assert.match(html, /class="mdh mdh2">Two</, `${name}: ## did not emit mdh2`);
    assert.match(html, /class="mdh mdh3">Three</, `${name}: ### did not emit mdh3`);
    assert.match(html, /class="mdh mdh6">Six</, `${name}: ###### did not emit mdh6`);
  });

  test(`#2701: ${name} does NOT turn a stray pipe in prose into a table`, () => {
    const fn = make();
    // A `|` with no separator row after it is ordinary text, escaped, never a table.
    const html = fn('the cost is 5 | tax included');
    assert.doesNotMatch(html, /<table/, `${name}: a stray pipe was rendered as a table`);
    assert.match(html, /the cost is 5 \| tax included/, `${name}: the pipe text was mangled`);
  });
}

test('#2701: table cells keep inline markup escaped (no HTML injection via a cell)', () => {
  const fn = proseFn();
  const html = fn('| a | b |\n| --- | --- |\n| <b>x</b> | y |');
  assert.doesNotMatch(html, /<b>x<\/b>/, 'a cell let raw HTML through');
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/, 'a cell did not escape its HTML');
});
