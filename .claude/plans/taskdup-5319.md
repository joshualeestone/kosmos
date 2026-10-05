# #5319: `kosmos task add` names open tasks with similar text

## The defect (0.7.22, a real install)
engine/tasks.js has no check of new task text against open tasks. In one session the same ask was added as #1 and #11,
and another as #26, #27 and #29.

## The change (as it stands after review round 7)
- engine/tasks.js `sameTextOpen(p, sentence, beforeNumber, {parent, detail, who})` names up to three tasks, oldest
  first. A task is named only if all of these hold:
  - it is OPEN;
  - it is numbered BELOW the new one;
  - it is not the new task's parent;
  - it is under the SAME parent (top-level with top-level);
  - its sentence and its detail are the SAME text: only case, runs of whitespace and NFC are set aside, and every other
    character counts;
  - it is given to the same people.
- server.js POST /api/project/:id/tasks: the task is ADDED as asked. The answer carries `note`, for example "Note: an
  open task with the same text already exists: #1 (Verify Theo AI and Enzo Health). If this is the same ask, close the
  new one: kosmos task close <project> <n>".
- Both CLIs print the note under the "added" sentence: install/kosmos lifts it with sed; tools/windows/kosmos-cli.js
  prints r.json.note.

## Decided
- **Add, then warn.** The card's "add anyway?" is a prompt, and agents cannot answer one. No silent dedup, as the card
  says.
- **Rejected:** refusing without an --anyway flag (it would break every agent and script that adds tasks). Merging into
  the existing task (the silent dedup the card rules out).
- **The SAME text, not similar text.** Reviews 1 to 7 showed every looser rule matching different asks. Each is now a
  test that must not match:
  - another person or verb;
  - a negation;
  - swapped order;
  - a sign or symbol;
  - a superscript;
  - another parent;
  - another detail or assignee.

  The note makes an agent close the NEW task, so a false match costs a real task. A miss costs only today's behaviour.
  Both real cases in the report were exact copies.
- **The note** holds no double quote, backslash, control character or direction override (the macOS CLI lifts it with
  sed; a terminal can act on controls). Project ids are [a-z0-9_-] (idFor).
- **Out of scope:** the project page ignores the new field.

**Weakest premise:** that real duplicates are literal copies. A duplicate in other words, or with other punctuation,
is missed.

**What would change my mind:** a report of a missed duplicate that was not a copy. Then a stricter fuzzy rule could be
proposed against the false-match rows the tests already hold.

## Tests
- server.task-same-text-5319.test.js:
  - pure rows (the report's cases, near misses, closed tasks, self, the cap of three);
  - the real route with a real project record: the task is added and stored, the note names #1 with the close
    command; control: an unrelated task gets no note; quotes and backslashes are stripped from the note;
  - the macOS CLI's own sed line on a real answer, including a task sentence that spells "note":"; control: no note,
    nothing printed;
  - the Windows CLI's main() with and without a note.
  - Control: with the server's note removed, the route test goes red.
- 259 related and audit files: 5806 tests, 0 fail.

## Review round 1 (opus)
- [W] FIXED: two close-together adds could both be told to close themselves (each named the other). Only OPEN tasks
  numbered BELOW the new one are named now, so the newest copy is the one told to close. Test: #40 and #41 at once.
- [W] FIXED: false matches that would close a real task. "Release 0.7.23" matched "Release 0.7.22" (the version split
  into words), "Fix this" matched "Fix it" (one shared word), and "Enable dark mode" matched "Do not enable dark mode on
  login". Now a dotted or dashed number is one word; numbers on both sides must agree; the same-words rule needs two or
  more words; the inside rule allows at most two extra words. Test rows for all three.
- [N] FIXED: closest first (exact copies before loose matches), then the oldest.
- [N] FIXED: a subtask never names its own parent.
- [N] FIXED: the note also strips C1 controls and direction overrides from the look-alikes' sentences.
- [N] not changed: the macOS test runs the CLI's own sed line, not the whole command (the repo's pattern).

## Review round 2 (sonnet)
- [W] FIXED: a word with a digit in it (v2, Q3, p1) was not a number, so "Add v2 login page" matched "Add v3 login
  page"; and four-word tasks one word apart ("Fix login bug in app" vs "Fix signup bug in app") met the 0.6 overlap.
  Now any word with a digit is a number for the numbers rule, and the overlap bar is 0.75 (the inside rule still
  catches a task with one or two words more). Test rows.
- [N] FIXED: the very same text always matches, whatever its length or script (a one-word task; Chinese or Thai with
  no spaces), comparing every word, filler included, so "Fix this" is still not "Fix it". Combining marks (\p{M})
  stay inside a word.
- [N] FIXED: numbers are compared in order: "Move 1 to 2" is not "Move 2 to 1".

## Review round 3 (opus): CUT TO THE SAME TEXT
Round 3 still found false matches after rounds 1 and 2 tuned the fuzzy rules:
- long tasks one word apart ("Email Alice ..." / "Email Bob ...", "approve" / "reject");
- a negation inside the two-extra-word allowance ("Do not enable dark mode on login" / "Enable dark mode on login");
- swapped order (Dallas to Austin / Austin to Dallas);
- extra name words.
This is the pattern Baron named on #5263: each round tunes the rules and the next finds their new edge.

**Decided: match only the SAME TEXT.** Case, punctuation, spacing and Unicode form (NFKC) are set aside; numbers and
word order are kept.
- Both real cases in the 0.7.22 report were exact copies.
- The note makes an agent close the NEW task, so a false match costs a real task. A miss costs only today's behaviour.
- Every false-match class from rounds 1 to 3 is now a test row that must NOT match.

**Trade-off:** a near-duplicate in other words ("deep dive worlds again") is not named. That is today's behaviour.

**The note now says "the same text".** Round 1's rules are kept: only older tasks, never the parent, and at most three
(now oldest first). Round 3's NFKC point is taken. Its warnings and nits on the fuzzy rules no longer apply.

**Test gap closed:** the route test's look-alike now has a double quote and a backslash in its stored text. Control:
with the strip removed, the row goes red.

## Review round 4 (sonnet)
- [W] FIXED by narrowing further: dropping punctuation and symbols made opposite asks equal ("-5" / "5", "x > 5" /
  "x < 5", a check mark / a cross, "C++" / "C", "$5" / "EUR 5"). The comparison now sets aside ONLY case, runs of
  whitespace and Unicode form (NFKC); every other character counts. The report's duplicates were literal copies, so
  they still match. "Deep dive: Worlds" vs "Deep dive - Worlds" is now a miss (today's behaviour). Test rows for each pair.
- [N] not changed: a zero-width character between letters makes a miss (harmless under the asymmetry), and shown()
  leaves line separators and zero-width characters in the note (mostly harmless on a terminal; bidi and C0/C1 controls,
  the ones that matter, are stripped).

## Review round 5 (opus)
- [W] FIXED: NFKC folded meaning away (x² and x2, ① and 1, Ⅳ and iv): the same class as review 4. Now NFC, which only
  joins one character written two ways (é composed or decomposed). Full-width letters are now a miss. Test rows for
  the superscript and the circled number.
- [N] FIXED: the names say what it does: sameTextOpen (was similarOpen), this test file renamed, no "look-alike" left.
- [N] FIXED (comment): the close command in the note needs no stripping, because idFor makes project ids of [a-z0-9_-].

## Review round 6 (sonnet)
- [W] FIXED: generic subtask text under two parents ("Write tests" under #3 and under #7) compared equal, so the
  note would close a real task. Now only tasks under the SAME parent are compared (top-level with top-level). The
  report's duplicates were top-level. Tests: another parent and top-level give no note; a sibling is named.
- [N] FIXED: U+061C (a bidi mark) is stripped from the note too. My own round-1 edit had written that character class
  as raw invisible characters in server.js; it is now ASCII \u escapes, and the diff carries no invisible characters.
- [N] not changed: toLowerCase is not a symmetric fold for Greek final sigma; that is only a miss.

## Review round 7 (opus)
- [W] FIXED: the same sentence for another target ("Review the PR" for PR 12 / PR 15; for alice / for bob) is another
  ask, so the detail and the people it is given to must match too. Test rows.
- [W] FIXED: a route test now adds a subtask through the real route. Under another parent there is no note; under the
  same parent the sibling is named. Control: with the parent dropped from the server's call, it goes red.
- [N] FIXED: the plan's "change" and "decided" sections describe the rule as it stands.
- [N] not changed: a hand-edited parent pointing at a missing task is read as stored (only a miss).
