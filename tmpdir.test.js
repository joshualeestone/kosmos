'use strict';

/* #1402. The property under test is that the directory is GONE AFTER THE
   PROCESS EXITS, which no in-process assertion can observe: the handler has not
   run yet while the test is running. So each test spawns a real child, has it
   print the path it made, waits for it to exit, and then looks at the disk.

   ⭐ AND THE CONTROL IS THE HALF THAT MAKES IT EVIDENCE. A child using raw
   `fs.mkdtempSync` must LEAVE its directory behind. Without that arm, a green
   result is equally consistent with the test never having created anything. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTemp, registered } = require('./test-support/tmpdir.js');

const HELPER = path.join(__dirname, 'test-support', 'tmpdir.js');

/* Runs `src` in a child and returns every line it printed, so the caller can
   look at the disk once the child is definitely gone. */
function inChild(src) {
  return execFileSync(process.execPath, ['-e', src], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

test('#1402: a directory made with mkTemp is gone once the process exits, and a raw one is not', () => {
  const [kept] = inChild(
    `const {mkTemp}=require(${JSON.stringify(HELPER)});
     const d=mkTemp('aw-tmpclean-treatment-');
     require('node:fs').writeFileSync(d+'/f','x');
     console.log(d);`
  );
  const [leaked] = inChild(
    `const fs=require('node:fs'),os=require('node:os'),p=require('node:path');
     const d=fs.mkdtempSync(p.join(os.tmpdir(),'aw-tmpclean-control-'));
     fs.writeFileSync(d+'/f','x');
     console.log(d);`
  );

  /* CONTROL FIRST. If the raw child did not leak, the treatment's absence means
     nothing and this test must fail rather than pass quietly. */
  assert.equal(fs.existsSync(leaked), true,
    'control arm did not leak, so this test cannot distinguish cleanup from never having created anything');
  assert.equal(fs.existsSync(kept), false,
    'mkTemp left its directory behind after the process exited');

  fs.rmSync(leaked, { recursive: true, force: true });
});

test('#1402: mkTemp returns a real directory under tmpdir and registers it', () => {
  const before = registered().length;
  const d = mkTemp('aw-tmpclean-unit-');
  assert.equal(fs.statSync(d).isDirectory(), true);
  /* realpath both sides: on macOS `os.tmpdir()` is a /var symlink to /private/var. */
  assert.equal(fs.realpathSync(path.dirname(d)), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(d), /^aw-tmpclean-unit-/);
  assert.equal(registered().length, before + 1);
  assert.equal(registered().includes(d), true);
});

test('#1402: one unremovable directory does not strand the others', () => {
  /* The exit handler must not abandon the rest of the list when one removal
     throws, and it must not throw at all: a cleanup failure turning a green
     suite red would be a worse defect than the litter it cleans up. */
  const lines = inChild(
    `const {mkTemp,sweep}=require(${JSON.stringify(HELPER)});
     const fs=require('node:fs');
     const a=mkTemp('aw-tmpclean-order-a-'), b=mkTemp('aw-tmpclean-order-b-');
     const orig=fs.rmSync;
     fs.rmSync=(p,o)=>{ if(p===a) throw new Error('planted'); return orig(p,o); };
     sweep();
     fs.rmSync=orig;
     console.log(a); console.log(b);`
  );
  const [a, b] = lines;
  assert.equal(fs.existsSync(b), false, 'a throwing removal stranded the directories after it');
  fs.rmSync(a, { recursive: true, force: true });
});
