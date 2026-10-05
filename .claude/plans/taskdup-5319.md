# #5319: `kosmos task add` names open tasks with similar text

## The defect (0.7.22, a real install)
engine/tasks.js has no check of new task text against open tasks. In one session the same ask was added as #1 and #11,
and another as #26, #27 and #29.

## The change
- engine/tasks.js `similarOpen(p, sentence, beforeNumber, {parent})`: a pure function of the project record. Since review 3 it
  names up to three OPEN, OLDER tasks with the SAME text (see "Review round 3"), never the task itself or its parent.
- server.js POST /api/project/:id/tasks: the task is ADDED as asked. The answer carries `note`, for example
  "Note: an open task with similar text already exists: #1 (Verify Theo AI and Enzo Health). If this is the same ask,
  close the new one: kosmos task close <project> <n>".
- Both CLIs print the note under the "added" sentence: install/kosmos lifts it with sed; tools/windows/kosmos-cli.js
  prints r.json.note.

## Decided
- **Similar means:** lowercase words, with punctuation and a few filler words dropped. A match is any of:
  - the same words;
  - a word overlap (Jaccard) of 0.6 or more, with two or more words on each side;
  - every word of the shorter (three or more words) appears in the other.
- **Add, then warn.** The card's "add anyway?" is a prompt. Agents run the CLI non-interactively and cannot answer one,
  so the task is added and the answer says how to close it if it is a duplicate. No silent dedup, as the card says:
  two asks can look alike and be different, and only the adder knows.
- **Rejected:** refusing without a flag (`--anyway`). It would break every agent and script that adds tasks today,
  for a guess.
- **Rejected:** merging into the existing task. That is the silent dedup the card rules out.
- **The note** holds no double quote or backslash, so the macOS CLI's sed can lift it. The look-alikes' sentences are
  cut to 60 characters, with those characters taken out.
- **Out of scope:** the project page also adds tasks through this route. It ignores the new field; showing the
  look-alikes on screen would be its own card.

**Weakest premise:** the word-overlap thresholds are judged on the report's two real cases and a handful of near
misses ("Fix the signup bug" vs "Fix the login bug" is NOT similar). A real duplicate phrased with different words
("look into Worlds" vs "deep dive: Worlds") is missed, which is the old behaviour. A false match costs one line of
advice.

**What would change my mind:** a report of notes on unrelated tasks. The fix then is to raise the 0.6 threshold.

## Tests
- server.task-similar-5319.test.js:
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
