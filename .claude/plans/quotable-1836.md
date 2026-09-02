# quotable-1836 — make render-talk and render-projects failures quotable by the gate

**Card:** kosmos#1836
**Branch:** quotable-1836
**Author:** Ice Cream Kitty (night shift, 2026-09-02)

## Problem

Two wired browser checks print failure lines the release gate's reason
extractor cannot match, so a red from either reports `(no FAIL or error line in
its output)` and the gate summary cannot name what broke.

The extractor is `run_one` in `tools/browser-checks.sh:506`:

```
grep -E '^\s*(FAIL|✖)|Error|Timeout|REFUS|refus' "$cap" | grep -vE '^\s*at ' | head -3
```

- `docs/browser-checks/render-talk.js` printed its 88 findings bare via
  `problems.join('\n')` — no marker the grep recognises.
- `docs/browser-checks/render-projects.js` emitted several failure paths with
  only a `⚠️`/`🛑` decoration. Only its `✖ N contrast failures` summary was
  already quotable (matches `^\s*✖`).

## Fix

Prefix `FAIL ` at the PRINT site (not the pushed string — a string prefixed
before a `'  - ' + p` print still prints an unquotable `  - FAIL ...`; the
prefix must land on the bytes the grep sees, per bulletin
`a-guard-from-the-same-mental-model-certifies-the-blind-spot`).

- `render-talk.js`: the final emit becomes
  `problems.map((p) => \`  FAIL  ${p}\`).join('\n')`.
- `render-projects.js`: the six unquotable failure emits (per-project
  console-errors head, overflow, not-on-screen, wrong-element, per-instance
  contrast, and the console-errors summary) are prefixed `FAIL `, keeping the
  ⚠️/🛑 glyph after it so the human warn/error distinction survives.

The already-quotable `✖` summary and every `✔` pass line are untouched. The
prefix is print-site cosmetic only — it never touches `problems`,
`contrastFails`, `overflows`, or `withErrors`, so counts and exit codes are
unchanged.

## Verification

Ran the runner's exact grep pipeline against the printed BYTES of every fixed
emit:

- Positive: 7/7 representative failure lines now match `^\s*(FAIL|✖)` and none
  are dropped by the `^\s*at ` exclusion.
- Negative control: the old (unprefixed) lines matched only the pre-existing
  `✖` summary (1/7), confirming the other six were the bug and the prefix is
  what makes them quotable.

Both files pass `node --check`; `tools/test-browser-check-gate.sh` passes.

## Out of scope / follow-up

- Extending `tools/browser-checks-reason-grep.test.js`'s `emitPrefixes` to
  recognise the `join`/`map` shape (so the guard covers these two rather than
  exempting them) is a follow-up: that test file lives on the unmerged,
  release-blocking `gate-red-bisect` branch, not on main. The print-site fix
  here is independent and correct now.
- Two non-failure diagnostic emits in render-talk.js (a per-message trace at
  :842, a fail-soft skip at :980) are correctly left unprefixed — neither sets
  `exitCode`, so the gate has no reason to quote them.
