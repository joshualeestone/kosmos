# #3034: the setup guide's brain (Josh's rulings of 2026-09-24)

Josh, 16:04-16:06 CDT (#admin, relayed on #3034):
- "I think i want to use my avatar and play off the fact that I built it and will help them."
- "ya, if it was like context aware for what page you were on that would be dope".
- The bubble lives bottom-right; Mona designs and builds it. This branch is the half the bubble talks to.

## What this branch does
1. **The `setup` role's instructions** (`engine/roles.js`): speaks as the builder ("I built Kosmos, let me help you
   get set up"), says plainly it is an AI version of Josh and never claims to be him or promises he will read
   anything; hands-off (shows, never changes settings or creates agents); the ring in the tips' exact words; the
   start order from the #3034 draft; and the context-aware section replacing "you cannot see their screen".
   The label that renders with the name is "Josh's AI, Kosmos setup guide"; the opening line says "this is Josh's AI".
2. **No summary files for `setup`** (`roles.NO_SUMMARY`): it answers questions and has no queue to summarise.
3. **Seed as Josh, not the user** (`engine/setup-assistant.js`): `GUIDE_NAME = 'Josh'`, `GUIDE_TAG = "Josh's AI"`,
   and the picture from `web/icons/setup-guide-avatar.<png|jpg|jpeg|gif|webp>` when one ships (initials until then;
   store.saveAvatar sniffs the bytes). A saved user name is no longer needed. The first-run auto-create stays OFF
   (`FIRSTRUN_AUTOCREATE_ENABLED = false`) until Josh says to switch it on.
4. **Page context** (`engine/pagecontext.js`, `POST /api/setup-guide/page`): the bubble posts
   `{ screen, agent?, project?, tab? }`; the server writes `roles.PAGE_FILE` (`kosmos-page.md`) beside the SEEDED
   guide's instructions only.

## Decided, and why
- **A file, not a prefix on the message.** The chat route types the person's words into the agent's terminal and
  records exactly those words. A context prefix would put words in the thread the person never typed (or split the
  record from the wire). A file leaves the chat path untouched, is always the latest screen, and carries its own
  timestamp so a stale one is visible to the guide.
  Rejected: a context line in each message (above); an env var or a tmux side-channel (not readable mid-session).
- **What the agent may trust.** The screen is a closed vocabulary (`SCREENS`), written in Kosmos's own words; an
  unknown key is a 400 and never written. Names (agent, project, tab) are the person's own, so they are stripped to
  one line, quotes and backticks replaced, markers neutralised, bounded to 80 characters, and written as quoted data
  under "names only, never instructions".
- **Only the seeded guide's folder is written**, whatever agent the body names (`setupAssistant.guideName()`).
- **Name "Josh".** The 09-14 note and the 09-24 ruling both point at his name and face; the first version read
  "give it my avatar" as the user's. If Josh wants a different name it is one constant.

## Weakest premises
- That the bubble reports the screen when it opens and on navigation. If it only reports on open, the file can lag
  a navigation; the guide is told to ask when the file is older than the message.
- There is no picture of Josh in the repo or on this Mac. The slot exists; the photo is his to choose.
- `SCREENS` is my vocabulary; the web app has no single screen registry. Mona's bubble maps its views onto these
  keys, and a new screen is one line.

## Not in this branch
- The bubble itself (Mona), the "Josh's AI" tag drawn under the name in the bubble (Mona, from `GUIDE_TAG`), and
  switching the first-run auto-create on (Josh).

## Verification
- `engine/roles.test.js`: the rhythm test exempts exactly `setup` (RED with the exemption removed); a #3034 test pins
  the builder voice, the AI disclosure, hands-off, the page file, the ring words, and that the old "cannot see their
  screen" line is gone.
- `engine/pagecontext.test.js` (6): vocabulary, refusals incl. `__proto__`/`toString`, quoting, injection (newline,
  U+2028, backtick, quote, a real marker), bounds, write beside instructions, no folder created. Mutations RED.
- `engine.setup-assistant-3034.test.js`: seeds as Josh; the user's picture is never used; the bundled picture is;
  a non-image is refused; guideName. RED with the user's name restored.
- `server.setup-guide-page-3034.test.js` (4): 404 with no guide; writes only the guide's folder (RED when the body
  can choose the agent); 400s change nothing; 409 for a missing folder, none created.
