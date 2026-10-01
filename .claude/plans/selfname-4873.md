# selfname-4873: agents stop starting their messages with their own name, and the board hides it if they do

Card: joshualeestone/kosmos#4873. Josh, #admin, 2026-10-01 07:31: "Dario, Sam, and Demis almost always print their own
name at the beginning of their statement ... is there a way to have agents not write their own name in their response
every time?" (screenshot: "Dario: Anthropic, ..." under a header that already says Dario).

## Change
1. Instructions: engine/defaults.js gets a NEW section, `### Your name is already on your message`: Kosmos shows your
   name above every message you post in a room and every reply to the person, so never start a message with your own
   name. DOCTRINE_VERSION 20 -> 21 with a log entry and a pinned fingerprint. NEW HEADING so existing agents are
   re-offered it (missingFrom matches by heading), as #4631 and #4475 did.
2. Display: web/index.html pjDropSelfName(words, names) drops ONE leading prefix: one of the sender's own names (display
   name and machine name), then a colon (may be tight) or a dash (needs a space before it), with optional bold around the
   name. Longest name first. A message that is only the name is left whole. Wired into pjRoomBody (agent posts only, not
   the person's) and dmRow's agent row (with the row's own label, shownFrom).

## Decided, not missed
- A dash needs a space before it so "Dario-style answers" and "dario-claude did it" are not cut (the test found the
  hyphen bug: "Dario" matched the start of "dario-claude").
- The person's own posts and rows are not touched: the card is about agents, and a person writing "Josh: ..." is rare.
- Rejected: changing the stored text (the record keeps what the agent wrote; only the drawing changes).

## Weakest premise
That the room's header name and the name the agent writes are the same string (display name or machine name). An agent
writing a nickname ("D: ...") keeps it. And an agent named with an ordinary word ("Update", "Note") loses that word
at the start of a message; the stored text is unchanged and the header still shows the name, so it costs a label.

## Tests
- engine/defaults.test.js: the section by content, its own heading, offered to an agent missing it; fingerprint v21.
- web.selfname-4873.test.js: the shapes dropped and the controls kept (another name, mid-text, bare name, longer word,
  hyphenated word, regex characters), and the wiring of both renderers. Mutations: removing the room call reds it;
  letting a tight dash count reds the hyphen control.
- The tests that lift dmRow / pjRoomBody (agent-answers, links-everywhere, mention-live, quoteb, rename-4421): 92/92 with
  the new test and defaults.

## Review rounds
- Round 1 (opus): FIXED BLOCKER: the room's quotes (#460) slice the stored text by offset, and the drop happened before
  them, so every quote was off by the prefix. Now each quote moves back by the dropped length, and a quote starting
  inside the prefix leaves the post as written; two tests in web.quoteb.test.js, and drawing without the shift reds one.
  FIXED W: leading blank lines after the drop ("**Dario:**\n\nhello"); the em dash as a separator (written as an escape,
  so the file holds none); the room tries the header's own name (pjNameOf, which also names a former member) first.
  NOTED (corrected in round 5): an external post (kind 'external') is drawn by pjRoomRow's own early branch as plain
  text and never reaches pjRoomBody, so nothing is dropped from it.
- Round 2 (sonnet): FIXED W: a dash separator needs a space on both sides, so "Dario -- hello" and "Dario -5 degrees"
  are left whole (controls added). FIXED W: only blank lines are removed after the drop, so an indented first line keeps
  its indent. DEFERRED W: the Ask Kosmos guide panel (.asp-m) is Kosmos's own assistant drawn as plain text, not a named
  agent in a room or a DM, so it is out of this card's scope. Left NITs: pjMentionKeys built twice per post; the wiring
  pins are source-text pins; "above every message" also covers grouped posts (the header above them).
- Round 3 (opus): FIXED W: the reply surfaces (the room's and the DM's reply header, the composer's Replying-to strip,
  the screen-reader line) read the raw text and said "Dario: Dario: ..."; pjReplyGist(m, who) now drops it with the
  name it sits beside, every caller passes it, and a test pins that no one-argument call is left. FIXED W: the card's
  control is now run through the room renderer (pjRoomRow) and the reply gist in web.quoteb.test.js, a person's post
  included. Left NITs: an agent named with an ordinary word ("Update") loses that word at the start of a message
  (the header still shows it); single-star emphasis is not handled; pjMentionKeys built twice.
- Round 4 (sonnet): FIXED W: the room's call is guarded like the DM row's and the reply gist's, so a test that lifts the
  room renderer without the helper does not throw. FIXED W: a tight colon does not count when a slash or a digit follows
  ("Dario://host", "Dario:30 minutes" are kept). FIXED NIT: a name followed only by spaces is kept whole. 135/135 across
  the new tests and the renderers' lifted tests.
- Round 5 (opus): FIXED W: the blank-line cleanup after the drop takes Windows line endings too (\r\n), with a test.
  Left NITs: a bare bold name with no separator ("**Dario**\n\nhello") is kept (conservative); pjMentionKeys twice; the
  source pins' fixed window.
- Round 6 (sonnet): its one W (the ordinary-word name) repeats round 3's noted case; now named in the weakest premise. Converged.
- Full validation on Mortals (236943820): 13,745 tests, 1 failed: engine/create.test.js's boot-file size canary (a pm
  boot file under MAX_BYTES / 6). Measured: main passes it; this branch's new section (about 280 bytes) took it to 43,938
  bytes of text against a 43,690 line. As on 2026-09-26 (/ 8 to / 6), the line is raised to / 5 with the measurement
  written beside it; still about 6x under the real 262,144 cap. 214/214 create tests.
