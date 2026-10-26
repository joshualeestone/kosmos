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
- [ ] controls, focused guards, challenge-loop, PR
