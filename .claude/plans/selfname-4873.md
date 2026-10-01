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
writing a nickname ("D: ...") keeps it.

## Tests
- engine/defaults.test.js: the section by content, its own heading, offered to an agent missing it; fingerprint v21.
- web.selfname-4873.test.js: eight shapes dropped, nine controls kept (another name, mid-text, bare name, longer word,
  hyphenated word, regex characters), and the wiring of both renderers. Mutations: removing the room call reds it;
  letting a tight dash count reds the hyphen control.
- The tests that lift dmRow / pjRoomBody (agent-answers, links-everywhere, mention-live, quoteb, rename-4421): 92/92 with
  the new test and defaults.
