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
- engine/dmfiles.js also says the Files folder is inside the agent's own folder and only for files made
  for the person (round 7, narrowed in round 12: a role agent's running summaries, written "inside your
  own folder" by roles.js, stay where they are and never fill the person's Files list).
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
- A project the person names but the agent is not on: saved in Files, and the agent says it is not on
  that project and that it can move once added (round 18; asking "which project" there had no useful
  answer). A place the person names, or an existing file being changed, is followed as they say (round 18).
- A project is chosen only when the person names it or the file is unmistakably that project's work,
  not only the same kind of thing (round 10): with one project, a merely related file is unclear, not
  assumed. Weakest premise: that the agent can tell the two apart; the say-where line and the move
  offer are the net when it cannot.
- The page half was dropped on rebase: #3757 replaced the agent page's Files section (hidden when empty),
  so the empty-list sentence this branch had corrected no longer exists on main.
- Where inside a project's folder a file goes is left to the doctrine ("the obvious spot inside it"),
  not overridden here. Round 15 briefly said "directly in it, not in a subfolder" so the project's Files
  list shows it; round 16 found that sent a design note to the top of a repository with a docs/ folder
  only because the request came in a direct conversation. Rejected: two placement rules for one folder.
- The project rule names the "Your projects" section by name, never by position: for an agent that had
  projects before #3614, the board appended this block after that section, so "below" would be wrong
  (review round 3).
- Running agents read the new words on their next start (they read instructions at start). The board
  rewrites every agent's block at its own start (an installed Kosmos restarts its board on update;
  a board run from a checkout, as on the fleet Mac, waits for its next restart), and the PR says so for
  the release notes, which are generated from what lands.

## Measured (real agent runs, 2026-09-25 ~15:35 CDT, on the wording committed with "review round 22")
Each case is one `claude -p --setting-sources project,local` run in a fresh sandboxed agent folder. That
flag matters: without it `claude -p` also loads this Mac's own global instructions and memory, and an
earlier set of runs did (round 20 caught it: a sandbox agent signed an email with the operator's name). A
probe confirmed the difference: asked who it works for, the default run answered with the operator's
name, the isolated run answered "unknown". All runs below are isolated, and none of their replies names
the operator. Earlier, non-isolated runs are superseded and not recorded here.

One run per case: a check of the wording, not a rate. "Doctrine" is whether the agent's file also carried
the real doctrine block (engine/defaults.js block(), as a new agent has). "Wording" is this branch's block
or main's (the control). The quotes are copied from each run's output (kept in the session scratchpad, not
the repo), trimmed to the sentences about where the file went.

| Case | Projects the agent is on | Doctrine | Wording | Saved to | Where it said |
|---|---|---|---|---|---|
| "a short packing list for a weekend camping trip as a file" | Henderson lease | no | new | `workers/writer/Files/Weekend Camping Packing List.md` | I saved "Weekend Camping Packing List" under Files on my page in Kosmos. |
| "For the Henderson lease, a one-paragraph summary ... as a file" | Henderson lease | no | new | `projects/Henderson lease/Renewal notice summary.md` | I wrote the one-paragraph summary and saved it in the Henderson lease project as **Renewal notice summary.md**. It covers: It's general guidance, not based on the Henderson lease itself, because the project folder was empty. |
| "draft a short email to my landlord asking about renewing, as a file" | Henderson lease | no | new | `workers/writer/Files/Lease renewal email.md` | I saved it as "Lease renewal email" under Files on my page in Kosmos. Is this for the Henderson lease project? |
| same landlord email | Henderson lease, Maple Street lease | no | new | `workers/writer/Files/Lease renewal email.md` | I saved the email as "Lease renewal email.md" under Files on my page in Kosmos. Is it for the Henderson lease or the Maple Street lease? Tell me which and I'll move it into that project. |
| same landlord email | none | no | new | `workers/writer/Files/Lease-renewal-email.md` | I drafted the email and saved it as **Lease-renewal-email.md**, under Files on my page in Kosmos. |
| "For the Oak Avenue lease, a one-paragraph summary ... as a file" (a project it is not on) | Henderson lease | no | new | `workers/writer/Files/Oak Avenue lease - renewal notice summary.md` | I've written the summary and saved it as **"Oak Avenue lease - renewal notice summary.md"** under Files on my page in Kosmos. I'm not on an Oak Avenue lease project; my only project is the Henderson lease. Once I'm added to that project, the file can move there. |
| "For the Oak Avenue lease, a one-paragraph summary ... as a file" (a project it is not on) | none | no | new | `workers/writer/Files/Oak Avenue Lease - Renewal Notice Summary.md` | I wrote the summary and saved it as **"Oak Avenue Lease - Renewal Notice Summary.md"** under Files on my page in Kosmos. I'm not on an Oak Avenue lease project, so it went there. Once I'm added to that project, I can move it over. |
| "time for your four-hourly running summary" (the role's running-record section added) | Henderson lease | no | new | `workers/writer/summaries/2026-09-25-15.md` | I wrote the summary to `summaries/2026-09-25-15.md`. |
| "...a packing list, put it in my outbox folder at <path>" (a place the person names) | Henderson lease | no | new | `outbox/weekend-camping-packing-list.md` | I saved your packing list as **weekend-camping-packing-list.md** in your outbox folder. |
| same outbox ask | none | no | new | `outbox/weekend-camping-packing-list.md` | I saved the packing list as **weekend-camping-packing-list.md** in your outbox folder. |
| "Fix the typos in the lease renewal email you made me." (an existing file in Files, about Henderson Street) | Henderson lease | no | new | `workers/writer/Files/lease-renewal-email.md, edited in place; nothing copied or moved` | The file is still lease-renewal-email.md under Files on my page in Kosmos. |
| the packing list | Henderson lease | yes | new | `workers/writer/Files/Weekend Camping Packing List.txt` | Your packing list is saved as **Weekend Camping Packing List.txt**, under Files on my page in Kosmos. |
| the landlord email | Henderson lease | yes | new | `workers/writer/Files/Lease renewal email.rtf` | It's saved as **Lease renewal email** under Files on my page in Kosmos. Does this belong to the **Henderson lease** project? If it does, I'll move it into that project's folder. |
| the landlord email | Henderson lease, Maple Street lease | yes | new | `workers/writer/Files/Lease renewal email.txt` | It's saved as **Lease renewal email.txt** under Files on my page in Kosmos. Could you let me know whether you are open to a renewal, and if so, what terms you have in mind, including the rent and the length of the new term? Best regards, [Your name] [Phone number] **One question:** is this for the Henderson lease or th |
| CONTROL: the landlord email | Henderson lease | no | main | `workers/writer/Files/Lease renewal email to landlord.md` | I drafted a short email and saved it in your Files folder as **Lease renewal email to landlord.md**. I looked in the Henderson lease project folder for those details, but it's empty. |
| CONTROL: the landlord email | Henderson lease | yes | main | `workers/writer/Files/Lease renewal email.txt` | I've drafted the email and saved it in your Files folder as **Lease renewal email.txt**. Your Henderson lease project folder is empty, so I couldn't find those details there. |

Across the three isolated sets (round 20, round 21 and round 22 wording; one run a case each):
- The cases below held in every set: Files by default; a named project to the project; two plausible
  projects saved in Files with the question asked; no projects to Files; a named place and an existing
  file respected; a running summary kept out of Files.
- A project it is not on, while on another project: said plainly in this set and the round 21 set
  once each; in one set the agent read "the Oak Avenue lease" as a subject that might belong to its
  only project and asked "which project does it belong to?" instead. Both saved in Files and said so.
  With no projects it said so plainly every time.
- The doctrine plus one project, the landlord email: this wording sent it to Files and asked in two of
  three sets and into the project in one; main's old wording sent it into the project in two of three and
  to Files in one. So the doctrine's "work you do for a project goes in that project's folder" pulls
  toward the only project, this block pulls back, and a single run can go either way. Every run said
  where the file went, and Josh's card allows either ("put the file in that project ... if that is what
  makes sense contextually"). This is the plan's weakest premise, measured.

What the change measurably adds over main: the person is told where to look in their own terms ("under
Files on my page in Kosmos", not "your Files folder"), an unclear case asks which project outright, a
project it is not on is usually named as such, a named place or an existing file is followed, and the
rules are stated outright where main left them to the agent.
