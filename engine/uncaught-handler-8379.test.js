'use strict';
/* #8379 item 1: the board registers no uncaughtException handler.

   engine/win32boardlog.js (#8373) and engine/win32boardwatch.js both record a crash from an uncaughtExceptionMonitor
   only when no uncaughtException handler exists, because a process with a handler lives on. So a handler added to the
   board anywhere would make both stop recording crashes, and nothing else would say so. This reads the board's own
   source (server.js and every engine module that is not a test) for any way of adding one. A handler that is meant to
   be there goes in ALLOWED with the reason, and then both monitors need a look. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADDS = /\.\s*(on|once|addListener|prependListener|prependOnceListener)\s*\(\s*(['"`])uncaughtException\2/g;
const ALLOWED = [];   // [file, reason]

function boardSources() {
  const engine = fs.readdirSync(path.join(ROOT, 'engine'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => path.join('engine', f));
  return ['server.js', ...engine];
}

/* Comments are dropped first, so a comment naming the event (as this file's header does) is not a handler. */
function handlersIn(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  return [...code.matchAll(ADDS)].length;
}

test('#8379 the board registers no uncaughtException handler', () => {
  const files = boardSources();
  assert.ok(files.length > 100, 'the scan found too few engine modules to mean anything: ' + files.length);
  const found = files.filter((f) => handlersIn(fs.readFileSync(path.join(ROOT, f), 'utf8')) > 0)
    .filter((f) => !ALLOWED.some(([a]) => a === f));
  assert.deepStrictEqual(found, [], 'a handler means a caught crash is not recorded by win32boardlog or win32boardwatch');
});

test('#8379 control: the scan sees every way of adding one, and not a monitor or a comment', () => {
  for (const form of ["process.on('uncaughtException', f)", 'process.once("uncaughtException", f)',
    'proc.addListener(`uncaughtException`, f)', "process.prependListener( 'uncaughtException' , f)",
    "process.prependOnceListener('uncaughtException', f)"]) {
    assert.strictEqual(handlersIn(form), 1, form);
  }
  assert.strictEqual(handlersIn("process.on('uncaughtExceptionMonitor', f)"), 0, 'a monitor is not a handler');
  assert.strictEqual(handlersIn("// process.on('uncaughtException', f)\n/* process.on('uncaughtException', f) */"), 0);
  assert.strictEqual(handlersIn("const u = 'http://x'; process.on('uncaughtException', f)"), 1, 'a // inside a string does not hide the line');
});
