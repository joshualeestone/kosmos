'use strict';
// ===========================================================================
// #1469 - the guard's OWN proof, run on every suite.
//
// A guard whose green you cannot trust is worse than no guard (this fleet's
// rule, and the reason #1430 removed two earlier guards rather than ship them).
// So the guard is proven BY PLANTING, not by reading: each trap is constructed
// in a temp copy of the loosened files and the guard must go RED on it, while
// the untouched control stays GREEN. If the guard ever stops catching a trap,
// THIS test goes red - so the guard's coverage cannot silently rot.
//
// Every arm below is one of the eight measured false-negatives #1430 recorded,
// plus the two floors and the control.
// ===========================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { checkBraceAnchors, EXPECTED } = require('./web.brace-anchor-guard-1469.lib.js');
const FILES = Object.keys(EXPECTED);

// exact pins, read verbatim from the guard's own table (never transcribed)
const pin867 = EXPECTED['web.consolidated-867.test.js'][0].pin;                    // regex literal, tail ;/,
const pin980 = EXPECTED['web.consolidated-980.test.js'][0].pin;                    // new RegExp string, tail ;'),
const pcRow  = EXPECTED['web.project-rows.test.js'].find((p) => p.count === 2).pin; // .pc-t dup, count 2, tail ;/m,

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'braceguard-'));
  for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(d, f));
  return d;
}
// Apply a perturbation and REFUSE a no-op (a mutation that never applied would
// let an arm pass while proving nothing - the exact trap that hid a false
// negative the first time this harness ran).
function edit(dir, file, from, to) {
  const p = path.join(dir, file);
  const s = fs.readFileSync(p, 'utf8');
  assert.ok(s.includes(from), `planting setup: target not found in ${file}`);
  assert.notStrictEqual(from, to, `planting setup: perturbation is a no-op in ${file}`);
  const out = s.split(from).join(to);
  assert.notStrictEqual(out, s, `planting setup: file unchanged in ${file}`);
  fs.writeFileSync(p, out);
}
// re-anchor a loosened regex-literal pin (…;/[flags],) by inserting a brace
const reanchorLit = (pin, brace) => {
  const out = pin.replace(/;\/([a-z]*)(,|\);)$/, `; ${brace}/$1$2`);
  assert.notStrictEqual(out, pin, 'reanchorLit did not change the pin');
  return out;
};
// re-anchor a new RegExp-string pin (…;'),) by inserting an escaped \\} before the quote
const reanchorStr = (pin) => {
  const out = pin.replace(/;'\),?$/, (m) => m.replace(";'", "; \\\\}'"));
  assert.notStrictEqual(out, pin, 'reanchorStr did not change the pin');
  return out;
};

function expectRed(name, mutate) {
  const dir = freshDir();
  try {
    mutate(dir);
    const failures = checkBraceAnchors(dir);
    assert.ok(failures.length > 0,
      `${name}: guard stayed GREEN on a planted defect - it is blind to this spelling.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function expectGreen(name, mutate) {
  const dir = freshDir();
  try {
    mutate(dir);
    const failures = checkBraceAnchors(dir);
    assert.deepStrictEqual(failures, [],
      `${name}: guard went RED with no re-anchor present - a false positive.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('#1469 self-proof: the untouched control stays GREEN', () => {
  expectGreen('control', () => {});
});

test('#1469 self-proof: escaped re-anchor  ; \\}  -> RED', () => {
  expectRed('escaped', (d) => edit(d, 'web.consolidated-867.test.js', pin867, reanchorLit(pin867, '\\}')));
});

test('#1469 self-proof: UNESCAPED re-anchor  ; }  (the v2 blocker) -> RED', () => {
  expectRed('unescaped', (d) => edit(d, 'web.consolidated-867.test.js', pin867, reanchorLit(pin867, '}')));
});

test('#1469 self-proof: ;\\s*\\}  re-anchor (v1 trap b) -> RED', () => {
  expectRed('semi-star', (d) =>
    edit(d, 'web.consolidated-867.test.js', pin867, pin867.replace(/;\/(,|\);)$/, ';\\s*\\}/$1')));
});

test('#1469 self-proof: no-trailing-semicolon re-anchor (v1 trap c) -> RED', () => {
  expectRed('no-semicolon', (d) =>
    edit(d, 'web.consolidated-867.test.js', pin867, pin867.replace(/0;\/(,|\);)$/, '0 \\}/$1')));
});

test('#1469 self-proof: new RegExp string re-anchor -> RED', () => {
  expectRed('regexp-string', (d) => edit(d, 'web.consolidated-980.test.js', pin980, reanchorStr(pin980)));
});

test('#1469 self-proof: assertion split across two source lines + re-anchor -> RED', () => {
  // The multi-line trap that sank v2's per-line scanner: a new RegExp(...) whose
  // parts wrap onto a second source line. The guard reads the whole file as one
  // string, so the wrapped-and-re-anchored form no longer matches the single-line
  // pin -> RED. (A pure rewrap with no re-anchor would also red the pin; that is
  // the guard's safe-direction false positive, not a miss.)
  expectRed('multi-line', (d) =>
    edit(d, 'web.consolidated-980.test.js', pin980,
      reanchorStr(pin980).replace("new RegExp(cons + '", "new RegExp(cons\n    + '")));
});

test('#1469 self-proof: compensating drift (re-anchor one, loosen a keep) -> RED', () => {
  expectRed('compensating-drift', (d) => {
    // re-anchor a pinned (loosened) assertion...
    edit(d, 'web.consolidated-867.test.js', pin867, reanchorLit(pin867, '\\}'));
    // ...AND loosen an untracked KEEP in the same file (drop its brace). Both edits
    // go through edit(), which refuses a no-op - so this genuinely exercises the swap
    // a bare per-file count would be blind to. Per-assertion counts still red the
    // re-anchored pin (got 0, want 1) regardless of the compensating loosening.
    edit(d, 'web.consolidated-867.test.js',
      '#alist::-webkit-scrollbar \\{ display: none; \\}',
      '#alist::-webkit-scrollbar \\{ display: none;');
  });
});

test('#1469 self-proof: /*-in-string does NOT blind the guard (immunity) -> RED', () => {
  expectRed('comment-swallow', (d) => {
    const p = path.join(d, 'web.consolidated-867.test.js');
    fs.writeFileSync(p, "const NOISE = '/* not a real comment */';\n" + fs.readFileSync(p, 'utf8'));
    edit(d, 'web.consolidated-867.test.js', pin867, reanchorLit(pin867, '\\}'));
  });
});

test('#1469 self-proof: /*-in-string with no re-anchor stays GREEN (no false positive)', () => {
  expectGreen('comment-swallow-benign', (d) => {
    const p = path.join(d, 'web.consolidated-867.test.js');
    fs.writeFileSync(p, "const NOISE = '/* not a real comment */';\n" + fs.readFileSync(p, 'utf8'));
  });
});

test('#1469 self-proof: a file going blind trips the per-file floor -> RED', () => {
  expectRed('file-blind', (d) =>
    fs.writeFileSync(path.join(d, 'web.consolidated-avatar-crop.test.js'), '// emptied\n'));
});

test('#1469 self-proof: re-anchoring ONE of two byte-identical .pc-t copies -> RED (count 2->1)', () => {
  expectRed('duplicate-aware', (d) => {
    const p = path.join(d, 'web.project-rows.test.js');
    const s = fs.readFileSync(p, 'utf8');
    const i = s.indexOf(pcRow);
    fs.writeFileSync(p, s.slice(0, i) + reanchorLit(pcRow, '\\}') + s.slice(i + pcRow.length));
  });
});
