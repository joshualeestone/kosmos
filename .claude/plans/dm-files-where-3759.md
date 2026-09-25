# Plan: #3759, where an agent saves a file the person asks for (context-aware)

## Finished looks like
Every agent's instructions say: a file asked for in a direct conversation goes in the agent's own Files
folder (the list on its page); a file for one of its projects (named, or plainly that project's work) goes
in that project's folder even when asked for in the direct conversation, and the agent says in one line
where it put it; when unclear, it asks in one line or saves it in Files and says so. Existing agents get
the new words at the next board start.

## Why
Josh, 0.6.94 test, 2026-09-25 11:07 in #admin: agents should store files where the person asked in a direct
conversation, and be context-aware enough to put a project's file in that project instead.

## Change
- engine/dmfiles.js blockBody: the rewritten block (both destinations, the say-which-project line, ask
  first when unsure).
- engine/dmfiles.test.js: the #3614 test follows the new first sentence; a new #3759 test pins both
  destinations, the say-where line and the unsure rule.

## Decided
- No DOCTRINE_VERSION bump. The files block is its own managed block (kosmos:dmfiles markers), rewritten
  for every agent by dmfiles.syncEveryone at each board start (server.dmfiles-refresh-3614.test.js), so the
  new words reach existing agents at the next start by themselves. A doctrine bump governs the separate
  defaults block and would re-offer its sections to every agent for no change of theirs. Rejected: also
  re-syncing live on release; the boot sweep is the existing path and a release restarts the board.
  Weakest premise: that the card's "version bump" meant "make sure existing agents get it" rather than
  the doctrine number specifically.
- Ask first when unsure; save in Files and say so only when nobody is there to answer. The doctrine's
  "Where the files you make go" says an unclear folder is "one short question for them, not a licence
  to guess" (defaults.js, pinned by defaults.test.js), and the same instructions file carries both, so
  this block must not offer save-and-say as an equal choice (review round 1). Josh's "ask or say where
  it went" still holds: the fallback is saying where it went.
- The trigger covers a file the agent makes in a direct conversation as well as one asked for, as the
  #3614 block did, so an unprompted file is still told the exact path.
- Running agents read the new words on their next start (they read instructions at start). The board
  rewrites every agent's block at its own start (an update restarts the board), and the PR says so for
  the release notes, which are generated from what lands.

## Measured (real agent runs, `claude -p` in a sandboxed agent folder holding this block and one project, 2026-09-25 12:25 CDT, final wording)
One run per case, so a check of the wording, not a rate. The agent's first reply line and the file it wrote:

| Asked | Saved to | First line of its reply |
|---|---|---|
| "a short packing list for a weekend camping trip as a file" | `workers/writer/Files/weekend-camping-packing-list.md` | I saved your packing list as `weekend-camping-packing-list.md` in your Files folder. It's there because it isn't part of the Henderson lease project, and you can open it from my page in Kosmos. |
| "For the Henderson lease, ... a one-paragraph summary ... as a file" | `projects/henderson-lease/renewal-notice-summary.md` | I saved it in the Henderson lease project folder as `renewal-notice-summary.md`. |
| "draft a short email to my landlord asking about renewing, as a file" (no project named) | `projects/henderson-lease/renewal-inquiry-email.md` | I saved it in the Henderson lease project as `renewal-inquiry-email.md`. |
| same landlord email, with TWO lease projects (Henderson, Maple Street) | nothing saved | Is this for the Henderson lease or the Maple Street lease? I'll save the draft in that project's folder. If it's for neither, I'll put it in your Files folder. |

The ask-first rule fires when the project is genuinely unclear; with one plausible project the agent
files it there and says so (row 3), which is the "plainly part of that project's work" branch.

Control, main's old wording with the Henderson ask (earlier run): also saved in the project. So the old
words already handled a clearly named project once; what this adds is the rule stated outright, the
say-which-project line, and the ask-first rule for an unclear case.
