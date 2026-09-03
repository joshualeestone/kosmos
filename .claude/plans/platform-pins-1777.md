# kosmos#1777: make the platform-sensitive fixes COMPOSE into coverage

## The card, and what was already done
#1777 filed a PATTERN, not a bug: this fleet develops/verifies on macOS, ships to
Windows (false green), and gates CI on Linux (false red). Three instances (#1732
delimiter split, #1761 O_NOFOLLOW-undefined, #1776 invisible symlink guard) shared
one signature. The card's core complaint: "the fixes do not compose into coverage.
After all three, the next platform-sensitive call is exactly as unguarded as the
first."

Scope ruling (Splinter, 2026-09-02; Josh can override), recorded on the card:
- Item 1 (name the platform-sensitive surface): buildable by anyone. IN.
- Item 2 (source-pin platform-conditional call sites): IN, the composable/verifiable part.
- Item 3 (Windows behavioural arms): OUT for beta (zero Windows machines; unverifiable here).
- Item 4 (awk/sed dialect false-red): OUT while dev boxes have only BSD awk.

## What I measured before building (the card is a snapshot)
Much of item 1/2 already existed:
- `docs/windows-source-coupling-1732.md` already names the class.
- `engine/windows-coupling-audit-1732.test.js` is a COMPOSING ratchet: it scans every
  `engine/*.js` + `bin/*.js` + top-level `*.js` for three families (path-delimiter-literal,
  fs-root-literal, env-home), reds on any UNCLASSIFIED family match (a NEW coupling) and on
  a STALE inventory row, and carries positive pins for the two fixed sites.
- `discover.js`'s `path.delimiter` split (a SECOND delimiter call site, the card's shape) is
  ALREADY guarded: I measured that reverting it to `split(':')` reds the ratchet. So it needs
  NO one-off pin -- a co-located pin would be the "pin one at a time" anti-pattern the card names.

The genuine gap: the fs.constants vanishing-flag class (#1761/#1776) was pinned ONE-AT-A-TIME
(securewrite.test.js, sendertoken.test.js) and is NOT one of the ratchet's families -- so it
does NOT compose, which is exactly the card's complaint.

## What I built (item 2, the composable part)
- New ratchet family `fs-const-platform-flag`: an `fs.constants` open flag undefined on win32
  (O_NOFOLLOW/O_SYMLINK/O_NONBLOCK/... -- ONLY the win32-undefined members; the always-defined
  ones are not matched, to stay low-noise). `X | undefined === X`, so such a flag silently
  vanishes on the platform we ship to.
- Inventory rows for the 4 current code sites, each with an honest disposition:
  - securewrite.js O_NOFOLLOW -> guarded-vanish (THE EXEMPLAR: captured `(NOFOLLOW || 0)` and the
    protection is a platform-independent hand check pinned in securewrite.test.js).
  - instructions.js O_NOFOLLOW -> macos-covers-removal (its removal reds a macOS behaviour arm;
    win32 hardening is item 3, deferred).
  - instructions.js + workerfile.js O_NONBLOCK -> benign-nonblock (fifo-avoidance, not a guard).
- A #1776 positive pin: securewrite ORs O_NOFOLLOW undefined-safe as `(NOFOLLOW || 0)`.
- discover.js: a behavioural multi-root scan test (genuine coverage the ratchet does not give)
  plus a note documenting why NO one-off source pin is added (the ratchet already reds it).
- Grew `docs/windows-source-coupling-1732.md`'s corpus + family list to match.

## Verification
- All four ratchet arms perturbation-proven red-capable (measured, each restored):
  EXCEED (synthetic `fs.constants.O_SYMLINK` -> red), STALE (removed instructions O_NOFOLLOW ->
  red), #1776 pin (dropped `(NOFOLLOW || 0)` -> red), delimiter-at-discover (`split(':')` -> red).
- 162 platform-relevant tests green; full suite running.
- Test-only change; NO product source modified.

## The weakest premise (name it)
The win32-undefined member list in the family regex is enumerated by hand from Node's docs, not
probed on a real win32 node. If a member I listed is actually DEFINED on win32 (or one I omitted
is undefined), the family is slightly wrong at the edge. Mitigation: the four members that matter
(O_NOFOLLOW, O_NONBLOCK, and the corpus) are certain; the rest are forward-looking and a wrong
entry only changes whether a hypothetical FUTURE flag reds, never any current behaviour. Nothing
in the current tree depends on the speculative members.
