'use strict';
/**
 * EVERY "HAVE WE ASKED THIS YET" FILE THE APP WRITES MUST BE REMOVED BY UNINSTALL.
 *
 * 🛑 THIS EXISTS BECAUSE PROSE DESCRIBING A SET DOES NOT MAKE OPERATIONS OVER THAT
 * SET COMPLETE. `install/setup.sh` named three such files and `engine/discover.js`
 * called them "one family". Then `found-agents-declined.json` shipped (#1531) and
 * joined neither list, so an uninstall did not reset declines.
 *
 * ⇒ THE FAILURE THAT PRODUCES IS THE WORST SHAPE THERE IS: somebody says "this isn't
 * an agent", uninstalls to start over, reinstalls, and the folder is STILL hidden
 * with nothing on screen explaining why. A working build looks broken, and the
 * person's own attempt to reset is what makes it look that way.
 *
 * ⭐ THE SET IS DERIVED FROM THE CODE, NOT RESTATED HERE. It reads the paths
 * `discover.js` builds under `store.ROOT`, so a fifth one is covered the moment
 * somebody adds it, without anybody remembering this file exists. A list maintained
 * by hand would have exactly the gap it is written to prevent.
 *
 * 📌 SINCE #1443 THAT IS NO LONGER ONLY `*_FILE` CONSTANTS, and this docblock said
 * so for a while after it stopped being true. Those constants became lazy resolvers
 * (`const dismissFile = () => path.join(store.ROOT, ...)`) precisely because
 * capturing the getter at require time refroze the root. The derivation below now
 * matches BOTH shapes; describing only the frozen one would send a reader looking
 * for code that no longer exists.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DISCOVER = fs.readFileSync(path.join(__dirname, 'engine', 'discover.js'), 'utf8');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

/** The uninstall's rm line, joined, including its continuation. */
function rmLine() {
  return SETUP.split('\n')
    .filter((l) => /rm -f "\$_support\//.test(l) || /^\s+"\$_support\/[a-z-]+\.json"/.test(l))
    .join(' ');
}

/**
 * Every path `discover.js` defines under `store.ROOT`, in BOTH shapes: the frozen
 * `NAME_FILE = path.join(store.ROOT, '<basename>')` and the lazy
 * `const nameFile = () => path.join(store.ROOT, '<basename>')` that #1443 replaced
 * it with. Matching only the first would have quietly emptied this set.
 *
 * ⚠️ THIS IS A SUBSET OF THE FAMILY AND SAYING SO MATTERS. `first-run.json` and
 * `seen-version.json` are written elsewhere, so this covers two of the four. It is
 * the half that keeps growing, which is where the gap appeared, but a reader should
 * not take a green here as "the whole family is covered".
 */
function rememberedFiles() {
  const out = [];
  /* ⚠️ WIDENED FOR #1443. These were module-level consts naming a path built from
     `store.ROOT`. Capturing that getter at require time re-froze the root, so a
     late sandbox seam was ignored and the module read the operator's real data;
     they are now lazy `const dismissFile = () => path.join(store.ROOT, ...)`.

     This derivation matched only the frozen shape, so after the conversion it
     found ZERO and the floor below caught it. That floor is the reason this was a
     red test rather than a silently vacuous one, which is what it was written
     against. Both shapes are accepted so the guard survives the next change in
     either direction. */
  const re = /const\s+([A-Za-z_]+(?:[Ff]ile|FILE))\s*=\s*(?:\(\)\s*=>\s*)?path\.join\(store\.ROOT,\s*'([^']+)'\)/g;
  let m;
  while ((m = re.exec(DISCOVER)) !== null) out.push({ constant: m[1], basename: m[2] });
  return out;
}

test('#1531: the derivation finds the files it is supposed to find', () => {
  /* CONTROL FIRST, and it is not decoration: if the regex stopped matching, every
     assertion below would pass by iterating an empty list, which is the exact
     vacuous-guard shape this file is written against. */
  const found = rememberedFiles();
  assert.ok(found.length >= 2,
    `only ${found.length} remembered-answer files found in discover.js; the derivation is broken `
    + 'and the assertion below would pass over an empty list');
  const names = found.map((f) => f.basename);
  assert.ok(names.includes('found-agents-dismissed.json'), `dismissed file missing: ${names}`);
  assert.ok(names.includes('found-agents-declined.json'), `declined file missing: ${names}`);
});

test("#1531: uninstall removes every one of them", () => {
  const missing = rememberedFiles().filter((f) => !SETUP.includes(f.basename));
  assert.deepEqual(missing.map((f) => f.basename), [],
    'these files are written by discover.js and are NOT removed by install/setup.sh, so an '
    + 'uninstall leaves the app remembering an answer a reinstall should have forgotten:\n  '
    + missing.map((f) => `${f.basename} (${f.constant})`).join('\n  '));
});

test('#1531: they are removed by the uninstall, not merely mentioned somewhere', () => {
  /* `SETUP.includes` above would be satisfied by a basename appearing in a COMMENT,
     which is precisely the "mentioned but not operated on" failure this guards. So
     this arm reads the rm line itself. */
  const rm = rmLine();
  assert.ok(rm.length > 0, 'could not find the uninstall rm line at all');
  for (const f of rememberedFiles()) {
    assert.ok(rm.includes(f.basename),
      `${f.basename} appears in setup.sh but NOT in the rm line, so it is documented and not deleted`);
  }
});

test('#1531: the comment’s count matches what the rm line actually deletes', () => {
  /* The count is in the comment so a missing member is visible to a reader who is not
     looking for one. A count that has DRIFTED is worse than no count, because it reads
     as a checked fact.

     ⚠️ IT COUNTS THE RM LINE, NOT `rememberedFiles()`, and my first version got this
     wrong. Only TWO of the four are discover.js constants; `first-run.json` and
     `seen-version.json` come from elsewhere. Comparing a 2 against a comment that says
     FOUR compared two different sets and failed for a reason that was about my test
     rather than about the code. */
  const rm = rmLine();
  const n = (rm.match(/\$_support\/[a-z-]+\.json/g) || []).length;
  const words = { 2: 'Two', 3: 'Three', 4: 'FOUR', 5: 'Five', 6: 'Six' };
  assert.ok(words[n], `no word for ${n} files; extend this map`);
  assert.ok(SETUP.includes(`${words[n]} tiny files`),
    `the uninstall deletes ${n} remembered-answer files but the comment above it does not `
    + `say "${words[n]} tiny files". Change the word when you add one.`);
});

test('#1531: the derivation accepts BOTH shapes, which the comment used to only claim', () => {
  /* The paragraph above asserted "both shapes are accepted" and that was untrue:
     `[Ff]ile` cannot match the all-caps `DISMISS_FILE`. A claim about a guard's
     reach is worth nothing until somebody constructs the case it forbids. */
  /* 🛑 THE FILE'S OWN REGEX, LIFTED OUT OF THE SOURCE, NOT A COPY. My first
     version of this arm inlined its own widened pattern and passed while the
     derivation above still carried the narrow one, so it proved a property of the
     test rather than of the guard. Each side testing its own copy is exactly the
     shape that let the original false claim stand. */
  const SELF = fs.readFileSync(__filename, 'utf8');
  const m = SELF.match(/const re = (\/const[^\n]*\/g);/);
  assert.ok(m, 'could not lift the derivation regex out of this file');
  // eslint-disable-next-line no-new-func
  const RE = () => new Function('return ' + m[1])();
  const frozen = "const DISMISS_FILE = path.join(store.ROOT, 'found-agents-dismissed.json');";
  const lazy = "const dismissFile = () => path.join(store.ROOT, 'found-agents-dismissed.json');";
  assert.ok(RE().test(frozen), 'the FROZEN shape is not matched, so a revert would empty this list');
  assert.ok(RE().test(lazy), 'the LAZY shape is not matched, so today it finds nothing');
  assert.ok(!RE().test("const X = elsewhere('a.json');"),
    'CONTROL: it matches something unrelated, so matching proves nothing');
});
