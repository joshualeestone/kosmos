# #1732: allow-list the PATHEXT ;-split in runners.js (unblocks a red main)

## The problem

`origin/main` is RED. `engine/win32-separator-guard.test.js` (the #1732
Windows-coupling audit) fails deterministically: it scans `engine/` for hardcoded
`;`/`:` `.split`/`.join` separators and refuses any that are neither a
`path.delimiter` fix nor on its reviewed ALLOW list. PR #2183 (win32 path gates,
merged ~05:30 CDT) added one at `engine/runners.js:225`:

```
const exts = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
  .split(';').map((e) => e.trim()).filter(Boolean);
```

It was never added to the audit's ALLOW list, so main's tip fails the full node
suite, and every PR's CI (and any full-suite validation) reds on it.

## Why the literal `;` is correct (not a `path.delimiter` bug)

`PATHEXT` is a Windows-only environment variable listing executable extensions,
and it is ALWAYS `;`-separated on Windows regardless of the host OS the code runs
on. `path.delimiter` is `:` on POSIX - using it here would be wrong (this code
reasons about win32 executable resolution, guarded by `path.win32.extname`
directly above). So this is a genuine "reviewed non-path use", the same category
as the existing MIME / cookie / hex / filename entries in ALLOW.

## The change

One entry appended to the `ALLOW` array in `engine/win32-separator-guard.test.js`:

```
{ file: 'runners.js', snippet: ".split(';').map((e) => e.trim())", count: 1,
  why: 'PATHEXT is a Windows executable-extension list ... always ;-separated ... NOT path.delimiter ... (#2183)' }
```

The snippet appears exactly once in `runners.js` (verified), and the count is
load-bearing (the sibling "each allow entry matches EXACTLY its declared count"
test enforces it - too high blesses a new hit silently, too low is a dead entry).
Both #1732 assertions pass after the change (4/4).

## Scope note

This is not the author of #2183's lane, and normally the author classifies their
own coupling. But main being red blocks every PR fleet-wide, the fix is the exact
mechanical ALLOW-list addition the audit's own error message prescribes, and
classifying PATHEXT as `;`-separated is a documented Windows fact rather than a
win32-internals judgment. Surfaced on the relevant cards; fixed forward rather
than left red.

## Weakest premise

That the `runners.js:225` `;`-split is genuinely non-`path.delimiter`. It is:
PATHEXT is Windows-specific and always `;`-separated; the enclosing function
reasons about win32 paths explicitly. If PATHEXT were ever a `path.delimiter`
case it would break on POSIX, but it is not a filesystem PATH - it is an
extension list, so the literal is correct on every host.
