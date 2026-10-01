'use strict';
/**
 * Every inline classic <script> in web/index.html is valid JavaScript.
 *
 * kosmos#4557 review 31: a one-line edit put a `//` comment in the middle of a statement, the comment swallowed the
 * rest of the line, and the page's main script no longer parsed. Every focused test stayed green, because each one
 * reads the page as TEXT (ids, routes, strings) and none asks whether the script compiles. In a browser the whole
 * board would have been dead. This compiles each inline script (without running it) so that cannot pass again.
 *
 *   node --test web.script-parses-4557.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* The inline classic scripts: no src, and a type that is absent or a JavaScript type. JSON and module scripts are
   not compiled as classic scripts by the browser either, so they are not compiled here. */
function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text|application)\/(java|ecma)script$/i.test(type)) continue;
    const line = html.slice(0, m.index).split('\n').length;
    out.push({ code: m[2], line, attrs: attrs.trim() });
  }
  return out;
}

test('#4557 review 31: every inline classic script in web/index.html compiles', () => {
  const scripts = inlineScripts(PAGE);
  // CONTROL on the reader: the page has its main script and more, and the main one is large.
  assert.ok(scripts.length >= 2, 'found ' + scripts.length + ' inline scripts; the reader is broken, not the page');
  assert.ok(scripts.some((s) => s.code.length > 100000), 'the main board script was not found by the reader');
  /* Review 32: a `</script>` inside a JS string would end a match early and drop the rest of that script from coverage
     without anything failing; every opener must have produced exactly one script (none here has a src or a non-JS type). */
  const openers = (PAGE.match(/<script\b/gi) || []).length;
  assert.equal(scripts.length, openers, 'the page has ' + openers + ' <script> openers but the reader found ' + scripts.length + ' scripts');
  for (const s of scripts) {
    try {
      new vm.Script(s.code, { filename: 'web/index.html:' + s.line });
    } catch (e) {
      assert.fail('the <script ' + s.attrs + '> starting at web/index.html:' + s.line + ' does not parse: ' + e.message);
    }
  }
});

test('CONTROL: the compile check fails on the exact defect it was written for', () => {
  const broken = "if (x) { const p = 1; p.textContent = f(p);   // a note row.append(p); }\nfoo();";
  const scripts = inlineScripts('<script>' + broken + '</script>');
  assert.equal(scripts.length, 1);
  assert.throws(() => new vm.Script(scripts[0].code), SyntaxError);
});
