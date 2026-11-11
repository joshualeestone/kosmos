'use strict';
/* #8379 item 1: the board keeps no thrown error alive.

   engine/win32boardlog.js (#8373) and engine/win32boardwatch.js record a crash from an uncaughtExceptionMonitor only
   when no uncaughtException handler exists, because a process with a handler lives on. A handler added to the board
   would make both stop recording crashes, and a capture callback or a domain would make both record a crash that never
   happened. Nothing else would say so.

   So this reads the board's own source (server.js and every engine module that is not a test, which is everything the
   board loads) as raw text, with no comment stripping: a stripper that does not parse strings swallows real code after
   a string holding a slash and a star. It counts:
     - every string literal that is exactly the event's name, in any quote: this catches a handler added by any call,
       including one whose event name is held in a variable or a list;
     - any call of setUncaughtExceptionCaptureCallback, and any require of the domain module.
   The literals the two monitors use themselves are allowed by file and by count, so a second one in either file reds. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EVENT = /(['"`])uncaughtException\1/g;
const CAPTURE = /setUncaughtExceptionCaptureCallback/g;
const DOMAIN = /require\(\s*(['"`])(node:)?domain\1\s*\)/g;
/* file -> how many event-name literals it may hold, and why. */
const ALLOWED = {
  'engine/win32boardlog.js': [2, 'its monitor reads listenerCount and names the origin; it adds no handler'],
  'engine/win32boardwatch.js': [1, 'its monitor reads listenerCount; it adds no handler'],
};

function boardSources() {
  const engine = fs.readdirSync(path.join(ROOT, 'engine'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => 'engine/' + f);
  return ['server.js', ...engine];
}

function count(src) {
  const n = (re) => (src.match(re) || []).length;
  return { event: n(EVENT), capture: n(CAPTURE), domain: n(DOMAIN) };
}

test('#8379 the board adds no uncaughtException handler, capture callback or domain', () => {
  const files = boardSources();
  assert.ok(files.length > 100, 'the scan found too few engine modules to mean anything: ' + files.length);
  const problems = [];
  for (const f of files) {
    const c = count(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const allowed = ALLOWED[f] ? ALLOWED[f][0] : 0;
    if (c.event !== allowed) problems.push(`${f}: ${c.event} event-name literal(s), ${allowed} allowed`);
    if (c.capture) problems.push(`${f}: setUncaughtExceptionCaptureCallback`);
    if (c.domain) problems.push(`${f}: require of domain`);
  }
  assert.deepStrictEqual(problems, [], 'a handler, a capture callback or a domain changes what win32boardlog and win32boardwatch record');
});

test('#8379 control: the scan sees each form, in real-shaped code', () => {
  /* Each starts with what broke an earlier comment-stripping scan: a string holding a slash-star, a URL in a regex,
     and a template holding a double slash, before the handler. */
  const before = "const g = 'image/*'; const re = /https?:\\/\\//; const u = `${p}//h`;\n";
  for (const form of ["process.on('uncaughtException', f)", 'process.once("uncaughtException", f)',
    'proc.addListener(`uncaughtException`, f)', "process['on']('uncaughtException', f)",
    "for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, f)"]) {
    assert.strictEqual(count(before + form).event, 1, form);
  }
  assert.strictEqual(count(before + 'process.setUncaughtExceptionCaptureCallback(f)').capture, 1);
  assert.strictEqual(count(before + "const d = require('node:domain')").domain, 1);
  assert.strictEqual(count(before + "process.on('uncaughtExceptionMonitor', f)").event, 0, 'a monitor is not a handler');
});
