# Plan: #3759, where an agent saves a file the person asks for (context-aware)

## Finished looks like
Every agent's instructions say: a file asked for in a direct conversation goes in the agent's own Files
folder (the list on its page); a file for one of its projects (named, or plainly that project's work) goes
in that project's folder even when asked for in the direct conversation, and the agent says in one line
where it put it; when unclear, it asks in one line or saves it in Files and says so. Existing agents get
the new words in their instructions file at the next board start, and a running agent
reads them at its own next start.

## Why
Josh, 0.6.94 test, 2026-09-25 11:07 in #admin: agents should store files where the person asked in a direct
conversation, and be context-aware enough to put a project's file in that project instead.

## Change
- engine/dmfiles.js also says the Files folder is inside the agent's own folder, so the doctrine's "your
  own folder" and this block's "Files folder" name one place for a file made for the person (round 7).
- web/index.html: the agent page's empty Files list says a project's file shows in the project, not
  here (it said every Direct Message file shows up here, no longer true).
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
- When the project is unclear: save in Files, say so and ask which project in the same line. Rejected:
  asking first (round 1's choice) because a turn ends when the agent asks, so nothing tells it the
  person never answered and the file may never be made (round 8); and saving silently. This keeps the
  doctrine's "one short question, not a licence to guess" (no project folder is guessed; Files is the
  stated default) and Josh's "ask or say where it went" (both, in one line). Measured: the two-project
  run above.
- The trigger covers a file the agent makes in a direct conversation as well as one asked for, as the
  #3614 block did, so an unprompted file is still told the exact path.
- An agent on no projects is told every direct-conversation file goes in Files (review round 4), and a
  test pins that the section name matches the heading the projects block writes.
- The project rule names the "Your projects" section by name, never by position: for an agent that had
  projects before #3614, the board appended this block after that section, so "below" would be wrong
  (review round 3).
- Running agents read the new words on their next start (they read instructions at start). The board
  rewrites every agent's block at its own start (an installed Kosmos restarts its board on update;
  a board run from a checkout, as on the fleet Mac, waits for its next restart), and the PR says so for
  the release notes, which are generated from what lands.

## Measured (real agent runs, `claude -p` in a sandboxed agent folder holding this block, 2026-09-25 ~13:10 CDT, on the FINAL wording of commit "review round 8")
One run per case, so a check of the wording, not a rate. Each case has its own fresh sandbox.

| Case | Projects the agent is on | Saved to | First line of its reply |
|---|---|---|---|
| "a short packing list for a weekend camping trip as a file" | Henderson lease | `workers/writer/Files/weekend-camping-packing-list.md` | I saved the list as `weekend-camping-packing-list.md` in your Files folder. It's a checklist with five sections: shelter and sleep, kitchen, clothing, essentials, and personal/comfort items. |
| "For the Henderson lease, a one-paragraph summary ... as a file" | Henderson lease | `projects/Henderson lease/renewal-notice-summary.md` | I saved it to the Henderson lease project folder as `renewal-notice-summary.md`. |
| "draft a short email to my landlord asking about renewing, as a file" | Henderson lease | `projects/Henderson lease/lease-renewal-email-draft.md` | I saved the draft as `lease-renewal-email-draft.md` in the Henderson lease project folder. |
| same landlord email | Henderson lease, Maple Street lease | `workers/writer/Files/lease-renewal-email.md` | I drafted the email and saved it as `lease-renewal-email.md` in my Files folder. Is it for the Henderson lease or the Maple Street lease? Tell me which and I'll move it into that project. |
| same landlord email | none | `workers/writer/Files/lease-renewal-email.md` | I drafted the email and saved it as `lease-renewal-email.md` in your Files folder. |

With one plausible project the agent files it there and says so (the "plainly part of that project's
work" branch); with two it saves in Files and asks which one in the same line; with none it goes in Files.
Control, main's old wording, with the Henderson ask (an earlier run): also saved in the project, so the
old words handled a clearly named project once; this adds the rule stated outright, the say-which-project
line, and the unclear case.
