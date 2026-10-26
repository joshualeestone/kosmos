# noticelines-7189: a room notice keeps its lines

Card: joshualeestone/kosmos#7189 (follow-up to #7153).

## Finished looks like
A notice written by a job (`kosmos notice`, POST /api/project/<id>/notice) keeps its line breaks in the store, the
web room draws them as breaks, and the phone shows them (SwiftUI Text already does). The room's text view, which
agents read, still shows the whole notice as ONE row under `[kosmos]`, so no line can read as a row by the person or
an agent.

## Why
The first real user (the 07:00 email digest, 10-26) arrived as one run-on line: the server joined every line.

## Design (decided)
- Server: `\r\n` and `\r` become `\n`; every other control or format character (U+2028/9 included) still becomes a
  space; each line has its whitespace runs collapsed and is trimmed; runs of blank lines shrink to one.
- Text view: a note row's text is flattened (`\s+` to one space), as a post's already is (#2239).
- Web: the note band escapes, then draws `\n` as `<br>` (as an external row does).
- Both CLIs' usage lines say the line breaks are kept and that agents see one line.

- Review 1: the forged-row test's "no own row" assertion matched the old double space, which the store now tidies,
  so it could not fail; it matches any whitespace now (measured: with the text-view flatten removed and the positive
  assertion disabled, it fails). The text view's flatten also takes U+0085 (`\s` does not), for notes and posts. The
  multi-line test pins a lone CR (a break), VT and FF (spaces).
- Not an issue (review 1 aside): the test board prints its update channel at boot, but its first update look is on
  an unref'd 60 s timer and the test board exits in seconds; the same for every server test.
- Noted for design, not built (review 1): the phone centres Kosmos lines, so a list shows centred there.

- Review 2: none new. Accepted: the Mac CLI turns a lone CR into a space while the server makes it a break (CRLF is
  the same either way; mapping CR to LF in the CLI would double every CRLF into a blank line). Deferred, predates this
  card: a raw VT or FF piped through the Mac CLI makes invalid JSON and is refused. Its gap note was already covered:
  the control-character test sends U+0085 and U+2028. Converged.

## Rejected
- Markdown in notices: rendering it would run other people's words (an email digest) through the rich renderer that
  draws links, a phishing surface; stripping it would mangle real underscores and asterisks in names. Left literal;
  a job can send plain text.
- Keeping storage one line and inventing a visible separator: the page and the phone can draw real lines safely,
  and the text view is the one surface that needs one line.

## Weakest premise
That the text view is the only place an agent reads note text. Searched: the room JSON (page, phone), the text view,
and the recommender's own `rec` notes; no pane delivery quotes a note.

## Checks
- server.roomnotice-7153.test.js: 6 pass (the forged-row test unchanged and passing; a new multi-line test).
- web.noticelines-7189.test.js: 3 pass (breaks drawn, escaped first, one-line note unchanged).
- Controls: both new tests against origin/main's server.js and web/index.html.

## Status
- [x] code + tests
- [x] controls, focused guards (1311 then 610 pass), challenge-loop (converged at 2)
- [ ] PR, merge on green, verify on main by content
