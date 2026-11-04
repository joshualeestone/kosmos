# seadmin-7892: the admin key screen's groundwork (kosmos#7892)

Built on main after #7902 merged (be6003d4a5); only this card's commits were carried over.
#7892 lists what #7116's round 8 left for the admin screen slice. This branch takes them in order of what can be
measured without a person at the screen.

## Done here so far

1. **WARNING 1, decoded text shown raw.** `prepare()` now returns `shown` (every decoded string, escaped) and
   `unusual`. Escaped as `\u{XXXX}` and marked: control, format (bidi, zero-width, BOM, soft hyphen), line/paragraph
   separators, private-use and unassigned code points, and every space but U+0020. A backslash is doubled so plain
   letters cannot imitate an escape. Mixed scripts (Latin with Cyrillic, say) are kept but marked; Japanese's Han,
   Hiragana and Katakana together count as one. `decoded` stays raw: what is signed is the bytes.

2. **Signing off the event loop.** `runHelper` is async (execFile, stdin written then closed); `createKey`,
   `publicKey` and `sign` return promises. Measured with a stand-in that sleeps 400 ms: the event loop keeps ticking.
3. **Helper errors as fixed sentences.** `HELPER_SAYS` lists every refusal `kosmos-se` writes (a test holds it to
   `native-se/main.swift` both ways); anything else is "the admin key helper failed", a missing helper is "not
   installed". No path, argv or stderr reaches a caller.

5. **The prompt names the action.** `kosmos-se sign` sets an LAContext `localizedReason` chosen from the signed
   message's own tag (`SIGN_REASONS`), never from an argument; a test holds the table to `SIGNED`. The prompt itself
   is not seen: that needs a presence key and a person (gate 6).

## Next, in order

4. WARNING 2: the screen's wording around the prompt must not promise approving means signed. Needs the screen.
6. Gate needing a person: a presence key made from inside the app. Park needs-operator when it is the only one left.

## Review round 1 (opus)

- BLOCKER: invisible marks and letters (variation selectors, the combining grapheme joiner, Hangul fillers) passed raw.
  Fixed: `\p{Default_Ignorable_Code_Point}` is escaped too; test rows for U+FE0F, U+034F, U+3164 in a Hangul name.
- WARNING: NFC vs NFD look the same. Fixed: text not in NFC marks `unusual`; test with a composed control.
- WARNING: a name wholly in one script can imitate another (all-Cyrillic for Latin). Not fixable by escaping;
  stated in the doc comment so the screen never reads `unusual: false` as "cannot be a look-alike".
- Fixed NITs: EACCES has its own sentence; scripts compiled once; Latin with Han pinned as marked; the doc-comment
  line the earlier edit broke. Kept: the maxBuffer check, which on Node 26 is redundant (measured: `killed` unset)
  but keeps an overflow from reading as a timeout elsewhere. Not taken: choosing the prompt reason before `load` in
  kosmos-se; the context is a reference read at signing, and only gate 6 can show the prompt either way.

## Review round 2 (sonnet)

- WARNING: blank-looking characters (U+2800, U+FFFC, U+FFFD) passed. Fixed: escaped, with test rows.
- WARNING: fullwidth and other compatibility look-alikes passed. Fixed: text that changes under NFKC is marked.
- WARNING: stacked combining marks. Fixed: three or more in a row mark the text; the test uses an NFC-stable stack
  (x with three accents) so only this rule can catch it, and Devanagari's two marks are the control.
- NITs fixed: arrays in a decoded value stay arrays in `shown` (no decoder returns one yet, so no test exercises it);
  the maxBuffer comment names the Node version it was measured on. Kept: the plan's numbering; the kosmos-se reason
  order (gate 6).

## Review round 3 (opus)

- WARNING: leading, trailing and doubled ASCII spaces passed. Fixed: written as \u{0020} and marked; one space between
  words is the control.
- WARNING: Common-script letters (the Japanese long-vowel mark, the Arabic tatweel) made ordinary names read as
  mixed. Fixed: Common and Inherited letters count as no script; tests for a katakana company name and a tatweel.
- NITs fixed: the header points screens at `shown`; a synchronous execFile throw (NUL in a path) is the generic
  sentence, tested; no stdin after a failed spawn is guarded; lone surrogates are escaped; the unused exports
  `shownText` and `helperSentence` are gone; the comment says `unusual` means "look closer", not "suspicious".

## Review round 4 (sonnet)

- WARNING: the refusal list claimed every <why>, but the usage line is a variable. Fixed: the comment says every
  literal <why>; a test now fails on any fail() whose argument is not a literal, a literal ternary or `usage`
  (mutant: fail(why) turns it red).
- WARNING: the comment said pointed Hebrew is marked; measured false. Fixed by deleting the claim: the comment names
  only Latin with Han, which a test pins.
- WARNING: the prompt reason was set after the key was bound. Fixed: kosmos-se sign reads the message and sets the
  reason before load. Still unmeasured: only gate 6 shows the prompt.
- NITs fixed: comment wrapped; the arrays note; a cancelled Touch ID reads as "refused to sign" (noted for the
  screen); dash and slash look-alikes named as not marked.

## Review round 5 (opus)

- WARNING: marks NFC leaves alone could hide or fake a letter (overlay U+0338 on "o" draws like "ø"; an enclosing
  circle; a mark with no letter under it). Fixed: an enclosing mark, an overlay U+0334 to U+0338, or a mark at the
  start or after a space marks the text; four NFC-stable rows, each with an NFC control.
- WARNING: with sign async, two signatures could be in flight and two prompts up at once, each naming only the kind
  of action. Fixed: sign queues, one at a time; tested with a slow stand-in (start/end never interleave) and a failed
  sign that must not stall the next. Mutants: no queue, and a queue that keeps a rejection, both red.
- NITs fixed: the prompt wording in main.swift is marked expected, not seen; the comment names two unlisted scripts
  and says \p{Cs} cannot arrive through prepare. Not taken: ENOENT from a missing shebang interpreter (the helper
  is a compiled binary); the misleading refusal for a tag with no reason (a test keeps the table complete).

## Review round 6 (sonnet)

- WARNING: the cancel prompt said "admins" for a reviewer-enrolment cancel too (one tag, two kinds). Fixed: it names
  both; a test requires both words.
- WARNING: other overlay marks (U+20D2, U+20D3, U+20D8 to U+20DA and kin) passed. Fixed: added, with rows.
- NITs fixed: a mark after any non-letter, non-mark marks the text (not only after a space); the header says the
  generation and reviewer flags are read from `decoded`. Not taken: the `args` regex in the reason test (the table
  lookup is the real guarantee).

## Weakest premise

That the script list in `scriptOf` covers the mixed-script look-alikes that matter, and, larger, that the screen shows the fingerprint wherever one exists, since one-script look-alikes are not marked. A letter from a script not on the list
counts as "other", so Latin plus an unlisted script still marks; two unlisted scripts together do not.
