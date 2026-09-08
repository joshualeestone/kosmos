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
// The arms below are the eight measured false-negatives #1430 recorded, the
// control, and both floors: the per-file floor (a file gone blind) and the
// global-total floor (the whole table emptied - the one case the per-assertion
// checks cannot see, proven here in isolation by passing an empty table).
// ===========================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { checkBraceAnchors, EXPECTED, EXPECTED_TOTAL } = require('./web.brace-anchor-guard-1469.lib.js');
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
    // ...AND, in the same file, loosen a KEEP (drop its brace) as the compensating
    // half of a class-count swap: a guard that counted the brace-anchor CLASS would
    // see +1 (re-anchored pin) and -1 (loosened keep) net to zero and stay blind -
    // the original v1 trap. This guard reds anyway, because it checks the specific
    // pinned assertion's exact source, not a class total (got 0, want 1). Both edits
    // go through edit(), which refuses a no-op. (The per-assertion-vs-count-2 case is
    // proven separately by the duplicate-aware arm.)
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

// The two floors, each proven IN ISOLATION against untouched files by handing
// the checker a gutted table - so a bug that broke only a floor (not the
// per-assertion checks) would still be caught here.

test('#1469 self-proof: an emptied table trips the global-total floor ALONE -> RED', () => {
  const dir = freshDir();
  try {
    // Files untouched; the TABLE is empty. No per-assertion check and no per-file
    // check runs, so only the global-total floor can red. This is the "sweep read
    // nothing" case the per-assertion checks structurally cannot see.
    const failures = checkBraceAnchors(dir, {}, EXPECTED_TOTAL);
    assert.deepStrictEqual(failures, [{ kind: 'total-mismatch', want: EXPECTED_TOTAL, got: 0 }],
      'emptied table did not red via the global-total floor alone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#1469 self-proof: a file dropped from the table trips the per-file floor ALONE -> RED', () => {
  const dir = freshDir();
  try {
    // Files untouched; ONE file's pin list is emptied and the total is adjusted so
    // the global floor stays satisfied. Then only that file's per-file floor fires.
    const file = 'web.consolidated-867.test.js';
    const dropped = EXPECTED[file].reduce((a, p) => a + p.count, 0); // 2
    const expected = { ...EXPECTED, [file]: [] };
    const failures = checkBraceAnchors(dir, expected, EXPECTED_TOTAL - dropped);
    assert.deepStrictEqual(failures, [{ file, kind: 'file-blind' }],
      'a file with no pins did not red via the per-file floor alone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
