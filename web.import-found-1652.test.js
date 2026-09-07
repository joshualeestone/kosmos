'use strict';
/**
 * #1652 PR2 + #2419: the "or choose one below" found-import UI. The disk scan
 * (discover.scan().importable) finds loose agent files a person downloaded or was
 * sent; the rows render on the create import panel AND the find-agents screen.
 *
 * #2419 (Josh, 0.6.45): each row shows ONLY the agent name + an "Add to Kosmos"
 * button -- no role, no path, no instructions preview -- and the Add is one click in
 * place (addImportedInPlace: parse the file, then create straight from it), never a
 * jump to the create form.
 *
 * These assert the CLIENT logic a node --test can see: the row markup a candidate
 * produces, and that the wiring is present (populate reads the scan's importable, the
 * Add path POSTs the by-path parse route THEN the create route, the paste path still
 * shares finishImport). The end-to-end add is covered by docs/browser-checks/
 * render-import-add-inplace-2419.js, the paste fill by import-agent-flow.js, and the
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
  // Mirror the page's cssId, including its trailing .slice(-60) truncation, so the stub
  // models the real helper rather than only its escaping.
  const cssId = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '-').slice(-60);
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'cssId', src + '\nreturn foundImportRowsHtml;')(esc, cssId);
}

test('#2419: a found-import row shows ONLY the agent name + an Add to Kosmos button', () => {
  const foundImportRowsHtml = loadRowsFn();
  const html = foundImportRowsHtml([
    { file: '/Users/scarlett/Downloads/don.md', name: 'Don', role: 'researcher', preview: '# You are Don, a researcher.' },
  ]);
  // The path is carried on the row for the click handler, but NOT shown to the person.
  assert.match(html, /data-import-file="\/Users\/scarlett\/Downloads\/don\.md"/, 'the row does not carry the file path the click handler reads');
  assert.match(html, /class="fr-importname">Don</, 'the name is not shown');
  assert.match(html, /class="btn uprime fr-importgo"/, 'there is no Add action');
  assert.match(html, /Add to Kosmos/, 'the button does not read "Add to Kosmos"');
  assert.doesNotMatch(html, /Import this one/, 'the old "Import this one" label is still present');
  // Josh's ruling: NO role/title, NO path text, NO instructions preview in the row.
  assert.doesNotMatch(html, /researcher/, 'the role is shown, but Josh asked for name only');
  assert.doesNotMatch(html, /You are Don, a researcher/, 'the instructions preview is shown, but Josh asked for name only');
  assert.doesNotMatch(html, /fr-importrole|fr-importpath|fr-scanpreview|What it says/, 'a dropped role/path/preview element is still rendered');
  assert.doesNotMatch(html, />\/Users\/scarlett\/Downloads\/don\.md</, 'the file path is shown as text, but Josh asked for it gone');
});

test('#2419: a nameless found file still renders with a stand-in name, never blank', () => {
  const foundImportRowsHtml = loadRowsFn();
  const html = foundImportRowsHtml([{ file: '/x/y.md', name: '', role: '', preview: 'You are ...' }]);
  assert.match(html, /An agent file with no name in it/, 'a nameless file rendered blank instead of a stand-in');
  // The role stand-in is gone with the role; a nameless row is name + button only.
  assert.doesNotMatch(html, /No title in its instructions/, 'the role stand-in is still rendered');
});

test('#2419: an HTML-hostile field is escaped, not injected', () => {
  const foundImportRowsHtml = loadRowsFn();
  const html = foundImportRowsHtml([{ file: '/x/<img src=x>.md', name: '<b>x</b>', role: '', preview: '<script>bad</script>' }]);
  assert.doesNotMatch(html, /<img src=x>/, 'the file path (in data-import-file and the accessible name) was not escaped');
  assert.doesNotMatch(html, /<b>x<\/b>/, 'the name was not escaped');
});

test('#2419: the Add path parses by-path THEN creates, and the paste path still shares finishImport', () => {
  // populateFoundImports fetches the ON-DEMAND import scan (/api/scan-import), NOT the auto
  // /api/scan-agents (which is TCC-free per #2125), and reads its importable array.
  assert.match(SCRIPT, /function populateFoundImports\(/);
  assert.match(SCRIPT, /fetch\('\/api\/scan-import'/, 'the found list does not read the on-demand import scan');
  assert.doesNotMatch(SCRIPT.slice(SCRIPT.indexOf('function populateFoundImports'), SCRIPT.indexOf('function populateFoundImports') + 900), /fetch\('\/api\/scan-agents'/, 'the found list still reads the AUTO scan (which excludes the TCC folders)');
  assert.match(SCRIPT, /body\.importable/, 'the found list reads the wrong field (not importable)');
  // The one-click Add: addImportedInPlace parses the file by path, then creates from it.
  const addStart = SCRIPT.indexOf('async function addImportedInPlace');
  assert.ok(addStart >= 0, 'addImportedInPlace is missing');
  // Bound to the delegated click handler that follows, so the window is the whole
  // function (comments included) and no more (its length varies with the comments).
  const addEnd = SCRIPT.indexOf("document.addEventListener('click'", addStart);
  assert.ok(addEnd > addStart, 'could not bound addImportedInPlace');
  const addSrc = SCRIPT.slice(addStart, addEnd);
  assert.match(addSrc, /fetch\('\/api\/agent-import-file'/, 'the Add path does not read the file by its path');
  assert.match(addSrc, /fetch\('\/api\/agents'/, 'the Add path does not create the agent behind the scenes');
  // It must NOT jump into the create form: no call to finishImport/cstep/showTab on
  // this path (the comments may name finishImport; a CALL is what would jump).
  assert.doesNotMatch(addSrc, /finishImport\(|cstep\(|showTab\(/, 'the Add path still jumps into the create form (Josh: it must add in place)');
  // The paste/choose path is untouched and still shares finishImport.
  assert.match(SCRIPT, /function finishImport\(/);
  assert.match(SCRIPT, /await finishImport\(/, 'importLoad no longer routes through the shared finishImport');
  // The old jump-to-create helpers are gone.
  assert.doesNotMatch(SCRIPT, /function importFoundFile\(/, 'the old importFoundFile (jump-to-create) is still present');
  assert.doesNotMatch(SCRIPT, /function frImportFromScan\(/, 'the old frImportFromScan (jump-to-create) is still present');
});

test('#2419: the found list is wired to the import panel and its one Add handler on both surfaces', () => {
  // pickMode fills the list when the import radio is chosen.
  assert.match(SCRIPT, /populateFoundImports\(\);/, 'the found list is never populated');
  // The click listener is delegated on `document` (the rows render on the create-form
  // import panel AND the find-agents screen) and calls addImportedInPlace on both.
  assert.match(SCRIPT, /closest\('\.fr-importgo'\)/, 'the click handler does not target the Add button');
  assert.match(SCRIPT, /closest\('\.fr-importgo'\)[\s\S]{0,400}addImportedInPlace\(/,
    'the Add click handler does not call addImportedInPlace');
  // It no longer branches to a jump for the find-agents surface.
  assert.doesNotMatch(SCRIPT, /closest\('\.fr-importgo'\)[\s\S]{0,400}closest\('#fr-fleet'\)/,
    'the Add click handler still branches on #fr-fleet to jump into create');
  // The container exists in the panel markup.
  assert.match(PAGE, /<div class="import-found" id="import-found" hidden><\/div>/, 'the found-import container is missing from the import panel');
});
