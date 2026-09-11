'use strict';

/* #2682: the add-an-agent-from-a-folder UI. A source slice (no browser) pinning
 * the wiring: the folder input + button exist in the create/import panel, the
 * button is bound to loadImportFolder, and loadImportFolder POSTs the folder to
 * /api/agent-import-folder and loads the returned text into the SAME import
 * textarea the paste/choose path uses (so "Bring it in" then parses/validates/
 * creates it unchanged). The server read itself is covered end to end over HTTP
 * in server.agent-import-folder-2682.test.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function fnSrc(name) {
  const at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' vanished from the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', at); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(at, k + 1); }
  }
  throw new Error(name + ' had no balanced body');
}

test('#2682: the import panel carries a folder-path input and a load button', () => {
  assert.match(PAGE, /id="import-folder"/, 'the folder-path input is present');
  assert.match(PAGE, /id="import-folder-btn"/, 'the load-folder button is present');
});

test('#2682: the load-folder button is bound to loadImportFolder', () => {
  assert.match(
    PAGE,
    /getElementById\('import-folder-btn'\)\.addEventListener\('click',\s*loadImportFolder\)/,
    'the button must be wired to the handler, or clicking it does nothing',
  );
});

test('#2682: loadImportFolder POSTs the folder and loads the returned text into the import box', () => {
  const src = fnSrc('loadImportFolder');
  assert.match(src, /\/api\/agent-import-folder/, 'it must call the folder read endpoint');
  assert.match(src, /JSON\.stringify\(\{\s*dir:\s*dir\s*\}\)/, 'it must send the folder path as { dir }');
  assert.match(
    src,
    /getElementById\('import-text'\)\.value\s*=\s*String\(data\.text/,
    'on success it must load the returned CLAUDE.md text into the same import textarea',
  );
  assert.match(src, /data\.because\b/, 'a refusal must surface the server reason, not a generic message');
});
