# Plan: #3759, where an agent saves a file the person asks for (context-aware)

## Finished looks like
Every agent's instructions say: a file made or asked for in a direct conversation goes in the agent's own
Files folder (the list on its page) and it says where; a file for one of its projects (named, or
unmistakably that project's work) goes in that project's folder even when it came up in the direct
conversation, and the agent says which project and the file's name; when unclear, it saves in Files and
asks which project in the same line. Existing agents get the new words in their instructions file at
the next board start, and a running agent reads them at its own next start.

## Why
Josh, 0.6.94 test, 2026-09-25 11:07 in #admin: agents should store files where the person asked in a direct
conversation, and be context-aware enough to put a project's file in that project instead.

## Change
- engine/dmfiles.js also says the Files folder is inside the agent's own folder, so the doctrine's "your
  own folder" and this block's "Files folder" name one place for a file made for the person (round 7).
- engine/dmfiles.js blockBody: the rewritten block (both destinations, say where it went, and when
  unclear save in Files and ask which project in the same line).
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
  run in the table below.
- The trigger covers a file the agent makes in a direct conversation as well as one asked for, as the
  #3614 block did, so an unprompted file is still told the exact path.
- An agent on no projects is told every direct-conversation file goes in Files (review round 4), and a
  test pins that the section name matches the heading the projects block writes.
- A project is chosen only when the person names it or the file is unmistakably that project's work,
  not only the same kind of thing (round 10): with one project, a merely related file is unclear, not
  assumed. Weakest premise: that the agent can tell the two apart; the say-where line and the move
  offer are the net when it cannot.
- The page half was dropped on rebase: #3757 replaced the agent page's Files section (hidden when empty),
  so the empty-list sentence this branch had corrected no longer exists on main.
- The project rule names the "Your projects" section by name, never by position: for an agent that had
  projects before #3614, the board appended this block after that section, so "below" would be wrong
  (review round 3).
- Running agents read the new words on their next start (they read instructions at start). The board
  rewrites every agent's block at its own start (an installed Kosmos restarts its board on update;
  a board run from a checkout, as on the fleet Mac, waits for its next restart), and the PR says so for
  the release notes, which are generated from what lands.

## Measured (real agent runs, `claude -p` in a sandboxed agent folder holding this block, 2026-09-25 ~13:30 CDT, on the wording committed with "review round 10")
One run per case, each in a fresh sandbox: a check of the wording, not a rate.

| Case | Projects the agent is on | Saved to | First line of its reply |
|---|---|---|---|
| "a short packing list for a weekend camping trip as a file" | Henderson lease | `workers/writer/Files/weekend-camping-packing-list.md` | I saved the packing list as `weekend-camping-packing-list.md` in your Files folder. It's a checklist in five groups: shelter and sleep, kitchen, clothing, essentials, and nice-to-haves. |
| "For the Henderson lease, a one-paragraph summary ... as a file" | Henderson lease | `projects/Henderson lease/renewal-notice-summary.md` | I saved it in the Henderson lease project folder as `renewal-notice-summary.md`. |
| "draft a short email to my landlord asking about renewing, as a file" | Henderson lease | `workers/writer/Files/lease-renewal-email.md` | I saved the draft as `lease-renewal-email.md` in my Files folder. Does it belong to the Henderson lease project? If so, I'll move it there. |
| same landlord email | Henderson lease, Maple Street lease | `workers/writer/Files/lease-renewal-email.md` | I drafted the email and saved it as `lease-renewal-email.md` in my Files folder. Does it belong to the Henderson lease or the Maple Street lease? Tell me which and I'll move it into that project's folder. |
| same landlord email | none | `workers/writer/Files/lease-renewal-email.md` | I saved the draft as `lease-renewal-email.md` in your Files folder. |

Row 3 changed with round 10: under "plainly part of that project's work" the agent filed the landlord email
straight into its only project; under "unmistakably that project's work, not only the same kind of thing"
it saves it in Files and asks whether it belongs to Henderson. A named project still goes to the project
(row 2). Control, main's old wording, with the Henderson ask (an earlier run): also saved in the project.
