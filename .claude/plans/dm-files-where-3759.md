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

## Measured (real agent runs, `claude -p` in a sandboxed agent folder holding this block, 2026-09-25 ~14:40 CDT, on the wording committed with "review round 18"; the control row is main's wording, run at ~14:05)
One run per case, each in a fresh sandbox: a check of the wording, not a rate. "Doctrine" is whether the
agent's file also carried the real doctrine block (engine/defaults.js block(), as a new agent has): rows
without it are the without-doctrine layout, where every cross-reference in this block is conditional.
"Where it said" quotes the sentences of the reply that tell the person where the file went.

| Case | Projects the agent is on | Doctrine | Saved to | Where it said |
|---|---|---|---|---|
| "a short packing list for a weekend camping trip as a file" | Henderson lease | no | `workers/writer/Files/weekend-camping-packing-list.md` | I saved your packing list as **weekend-camping-packing-list.md** under Files on my page in Kosmos. |
| "For the Henderson lease, a one-paragraph summary ... as a file" | Henderson lease | no | `projects/Henderson lease/Renewal Notice Summary.md` | I saved **Renewal Notice Summary.md** in the Henderson lease project folder. It's a one-paragraph summary of what a renewal notice should cover: The project folder had no copy of the lease, so this is a general outline and not based on the Henderson lease's actual wording. |
| "draft a short email to my landlord asking about renewing, as a file" | Henderson lease | no | `workers/writer/Files/Lease renewal email to landlord.md` | I saved it as "Lease renewal email to landlord.md" under Files on my page in Kosmos. Is this for the Henderson lease? If so, I'll move it to that project. |
| same landlord email | Henderson lease, Maple Street lease | no | `workers/writer/Files/Lease renewal email to landlord.md` | I drafted the email and saved it as **"Lease renewal email to landlord"** under Files on my page in Kosmos. Is this for the Henderson lease or the Maple Street lease? Tell me and I'll move it into that project. |
| same landlord email | none | no | `workers/writer/Files/lease-renewal-email.md` | I drafted the email and saved it as **lease-renewal-email.md**, under Files on my page in Kosmos. |
| "For the Oak Avenue lease, a one-paragraph summary ... as a file" (a project it is not on) | Henderson lease | no | `workers/writer/Files/Oak Avenue lease - renewal notice summary.md` | I saved the summary as **"Oak Avenue lease - renewal notice summary.md"** under Files on my page in Kosmos. I'm not on an Oak Avenue lease project. My only project is the Henderson lease, so I couldn't put it in a project folder. |
| "time for your four-hourly running summary" (the role's running-record section added) | Henderson lease | no | `workers/writer/summaries/2026-09-25-14.md` | I've written the summary to `summaries/2026-09-25-14.md` in my folder. There was nothing to report: I've had no tasks yet, I haven't made any files, and the Henderson lease project folder is empty. |
| "...a packing list, put it in my outbox folder at <path>" (a place the person names) | Henderson lease | no | `outbox/weekend-camping-packing-list.md` | I saved your packing list as **weekend-camping-packing-list.md** in your outbox folder. |
| the packing list | Henderson lease | yes | `workers/writer/Files/Camping Packing List.docx` | It's a Word document called **Camping Packing List.docx**, and you'll find it under Files on my page in Kosmos. |
| the landlord email | Henderson lease | yes | `projects/Henderson lease/Lease renewal email.docx` | Josh, I've drafted it as a Word document called **Lease renewal email.docx** and saved it in the Henderson lease project folder. Could you let me know the terms you'd offer for a renewal, including the rent, the length of the term, and any changes to the lease? Best regards, Josh Stone [phone number |
| the landlord email | Henderson lease, Maple Street lease | yes | `workers/writer/Files/Lease renewal email.docx` | Josh, your renewal email is ready as a Word document, **Lease renewal email.docx**, under Files on my page in Kosmos. Is this for the Henderson lease or the Maple Street lease? Tell me which and I'll move it into that project and fill in the address. |
| CONTROL, main's old wording: same landlord email | Henderson lease | no | `workers/writer/Files/lease-renewal-email.md` | I drafted the email and saved it as `lease-renewal-email.md` in your Files folder |

With the doctrine present and one project, the landlord email went into that project and the agent said
so (the doctrine's "work you do for a project goes in that project's folder" pulls a related file toward
the only project); without the doctrine it saved in Files and asked. Both say where the file went, and
Josh's card allows either ("put the file in that project ... if that is what makes sense contextually").
This is the plan's weakest premise, measured: "unmistakably that project's work" is read more loosely
when the doctrine is also present. With two projects, it saved in Files and asked in both layouts.

What the change measurably does, honestly: main's old wording already put a named project's file in the
project (an earlier control) and, in the control above, already saved the one-project landlord email in
Files and offered to move it. The differences are that the person is now told where to look in their own
terms ("under Files on my page in Kosmos", not "your Files folder"), an unclear case asks which project
outright (rows 3, 4, 6), a project it is not on is named as such (row 6), and a running summary is kept
out of Files (row 7). The block also states the rules outright where main left them to the agent.
