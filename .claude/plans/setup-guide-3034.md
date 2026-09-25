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
   **Hands-off is a SWITCH, not a settled rule** (`roles.SETUP_HANDS_OFF`, true for now): Josh said "I love it" (18:02) about
   Mona's mock, which shows the guide acting; Splinter's call is hands-on approved in direction, built once the bubble can
   really act. Until then the switch stays on, because nothing can act yet. The test pins only that the switch alone decides
   whether the line is there.
   The label that renders with the name is "Josh's AI, Kosmos setup guide"; the opening line says "this is Josh's AI".
2. **No summary files for `setup`** (`roles.NO_SUMMARY`): it answers questions and has no queue to summarise.
3. **Seed as Josh, not the user** (`engine/setup-assistant.js`): `GUIDE_NAME = 'Josh'`, `GUIDE_TAG = "Josh's AI"`,
   and the picture from `web/icons/setup-guide-avatar.<png|jpg|jpeg|gif|webp>` (ships as .jpg; initials if absent;
   store.saveAvatar sniffs the bytes). A saved user name is no longer needed. The first-run auto-create stays OFF
   (`FIRSTRUN_AUTOCREATE_ENABLED = false`) until Josh says to switch it on.
4. **Page context** (`engine/pagecontext.js`, `POST /api/setup-guide/page`): the bubble posts
   `{ screen, agent?, project?, tab? }`; the server writes `roles.PAGE_FILE` (`kosmos-page.md`) beside the SEEDED
   guide's instructions only.

5. **The bubble's switch** (Josh, 18:02: close-forever on the first X, and a Settings switch to bring it back; Splinter
   assigned the storage to this branch): `/api/settings` carries `setupAssistant: { on, asked }`, default
   `{ on: true, asked: false }`. `on` is the Settings switch ("Don't show this again" writes false); `asked` records that
   the first-X choice was offered. A patch sets either key and keeps the other; non-booleans are a 400. Kept on the board,
   not in page storage, for the tips switch's reason (#3574): page storage can come back empty.

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
- **Only the seeded guide's folder is written**, whatever agent the body names: the name the seed recorded
  (`setupAssistant.guideName()`) AND the marker file the seed dropped in that folder (`isGuideFolder`). A guide that
  was deleted and a new agent given the same name gets nothing (409). A renamed guide also gets 409, which is honest.
- **Name collision:** if "Josh" is taken (Josh running his own build), the seed falls back to "Josh AI" once; any other
  refusal is not retried.
- **Name "Josh".** The 09-14 note and the 09-24 ruling both point at his name and face; the first version read
  "give it my avatar" as the user's. If Josh wants a different name it is one constant.

## Weakest premises
- That the bubble reports the screen when it opens and on every navigation. The file is therefore normally written
  BEFORE the person types, so the guide asks only when it is missing or more than ten minutes old (round 1 caught an
  "older than their message" rule that would have asked every turn). A report lags only if the bubble misses a move.
- The picture is Josh's public GitHub headshot (400x400 JPEG), chosen by Splinter at 17:36 as the default; Josh can
  swap it by replacing `web/icons/setup-guide-avatar.jpg`. A missing or unreadable file falls back to the initial.
- `SCREENS` is my vocabulary; the web app has no single screen registry. Mona's bubble maps its views onto these
  keys, and a new screen is one line.

## Not in this branch
- The bubble itself (Mona), the "Josh's AI" tag drawn under the name in the bubble (Mona, from `GUIDE_TAG`), and
  switching the first-run auto-create on (Josh).

## Verification
- `engine/roles.test.js`: the rhythm test exempts exactly `setup` (RED with the exemption removed); a #3034 test pins the
  builder voice, the AI disclosure, the page file and the ten-minute freshness rule, the ring words, that the old "cannot see
  their screen" line is gone, that the hands-off line follows `SETUP_HANDS_OFF` alone, and that `GUIDE_TAG` has one copy.
- `engine/pagecontext.test.js` (6): vocabulary, refusals incl. `__proto__`/`toString`, names AND the tab under the
  not-instructions line, injection (newline, U+2028, backtick, quote, a real marker), bounds by code point, write beside the
  instructions, no folder created. Mutations RED.
- `engine.setup-assistant-3034.test.js` (every root sandboxed, and the marker test asserts it resolves inside the sandbox): seeds
  as Josh; "Josh AI" only on a taken name; the marker; the shipped picture passes the byte sniff; the user's picture is never
  used; guideName; the `setupAssistant` setting's defaults, validation and merge.
- `server.setup-guide-page-3034.test.js` (7, real server as a child): 404 with no guide; writes only the guide's folder; 400s
  change nothing; 409 for a missing folder; 409 for a same-name agent without the marker; 404 for a REMOVED guide and 409 for an
  unreadable removed list, with a restore control; `/api/settings` round trip keeping other settings. Mutations RED.
- Not a listing concern: `kosmos-page.md` and `.kosmos-setup-guide` sit beside the agent's instructions, not in its `Files/`
  folder (#3614), which is what the agent-page Files list shows.
