'use strict';
/**
 * #1652 PR2: the "or choose one below" found-import UI in the create import panel.
 * The disk scan (discover.scan().importable) finds loose agent files a person
 * downloaded or was sent; this panel lists them and imports one by path.
 *
 * These assert the CLIENT logic a node --test can see: the row markup a candidate
 * produces, and that the wiring is actually present (populate reads the scan's
 * importable, the click path POSTs the by-path route, both entry points share the
 * one finishImport). The end-to-end fill is covered by docs/browser-checks/
 * import-agent-flow.js (both the paste and found paths reach finishImport), and the
 * server route by server.agent-import-1652.test.js.
 *
 *   node --test web.import-found-1652.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

// Pull foundImportRowsHtml's source and run it for real, with the same esc/cssId
// helpers the page defines (stubbed to their observable behaviour) so the assertions
// are about what the function actually emits, not a regex over its text.
function loadRowsFn() {
  const start = SCRIPT.indexOf('function foundImportRowsHtml');
  assert.ok(start >= 0, 'foundImportRowsHtml is missing from the page');
  // The function ends at the first line that is exactly "}" at column 0 after it.
  const end = SCRIPT.indexOf('\n}\n', start);
  assert.ok(end > start, 'could not bound foundImportRowsHtml');
  const src = SCRIPT.slice(start, end + 2);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cssId = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '-');
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'cssId', src + '\nreturn foundImportRowsHtml;')(esc, cssId);
}

test('#1652 PR2: a found-import row carries the file path, name, role, preview and an Import action', () => {
  const foundImportRowsHtml = loadRowsFn();
  const html = foundImportRowsHtml([
    { file: '/Users/scarlett/Downloads/don.md', name: 'Don', role: 'researcher', preview: '# You are Don, a researcher.' },
  ]);
  assert.match(html, /data-import-file="\/Users\/scarlett\/Downloads\/don\.md"/, 'the row does not carry the file path the click handler reads');
  assert.match(html, />Don</, 'the name is not shown');
  assert.match(html, /researcher/, 'the role is not shown');
  assert.match(html, /You are Don, a researcher\./, 'the preview (what it says) is not shown');
  assert.match(html, /class="btn uprime fr-importgo"/, 'there is no Import action');
  assert.match(html, /Import this one/, 'the Import button has no label');
});

test('#1652 PR2: a nameless found file still renders with a stand-in name, never blank', () => {
  const foundImportRowsHtml = loadRowsFn();
  const html = foundImportRowsHtml([{ file: '/x/y.md', name: '', role: '', preview: 'You are ...' }]);
  assert.match(html, /An agent file with no name in it/, 'a nameless file rendered blank instead of a stand-in');
  assert.match(html, /No title in its instructions/, 'a roleless file rendered blank instead of a stand-in');
});

test('#1652 PR2: an HTML-hostile field is escaped, not injected', () => {
  const foundImportRowsHtml = loadRowsFn();
  const html = foundImportRowsHtml([{ file: '/x/<img src=x>.md', name: '<b>x</b>', role: '', preview: '<script>bad</script>' }]);
  assert.doesNotMatch(html, /<img src=x>/, 'the file path was not escaped');
  assert.doesNotMatch(html, /<b>x<\/b>/, 'the name was not escaped');
  assert.doesNotMatch(html, /<script>bad/, 'the preview was not escaped');
});

test('#1652 PR2: populate reads the scan importable list, and import posts the by-path route', () => {
  // populateFoundImports fetches the SAME disk scan the board poll uses and reads its
  // importable array (not candidates), and only shows the block when there is at least one.
  assert.match(SCRIPT, /function populateFoundImports\(/);
  assert.match(SCRIPT, /fetch\('\/api\/scan-agents'/, 'the found list does not read the disk scan');
  assert.match(SCRIPT, /body\.importable/, 'the found list reads the wrong field (not importable)');
  // importFoundFile posts the by-path route (the server validates the path against the scan).
  assert.match(SCRIPT, /function importFoundFile\(/);
  assert.match(SCRIPT, /fetch\('\/api\/agent-import-file'/, 'the found import does not call the by-path route');
  // Both entry points share finishImport, so the create-form fill cannot drift between them.
  assert.match(SCRIPT, /function finishImport\(/);
  assert.match(SCRIPT, /await finishImport\(/, 'importLoad no longer routes through the shared finishImport');
});

test('#1652 PR2: the found list is wired to open with the import panel and to its click handler', () => {
  // pickMode fills the list when the import radio is chosen.
  assert.match(SCRIPT, /populateFoundImports\(\);/, 'the found list is never populated');
  // The click listener delegates on the Import button inside the found block.
  assert.match(SCRIPT, /getElementById\('import-found'\)\.addEventListener\('click'/, 'the found list has no click handler');
  assert.match(SCRIPT, /closest\('\.fr-importgo'\)/, 'the click handler does not target the Import button');
  // The container exists in the panel markup.
  assert.match(PAGE, /<div class="import-found" id="import-found" hidden><\/div>/, 'the found-import container is missing from the import panel');
});
