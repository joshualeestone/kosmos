# filesdedup-8735: #8735 slice 3, item 2 (the files guidance)

Proposed rule by rule on kosmos#8735 (comment 7026156209) before building.

## Change
`engine/dmfiles.js` ("Where to save files you make for the person"): four sentences cut, each a repeat or commentary:
1. "Save files directly in it, not in subfolders: the page lists only what sits at the top of the folder." Repeats
   "Directly inside that folder: not in your own folder above it, and not in a subfolder."
2. "Keeping what you make in a direct conversation in one place means they always know where to find it: Kosmos lists
   what is in it on your page, where they can open it." A reason; "Only files there appear on your page" states the fact.
3. "That is not guessing: your Files folder is where it goes by default." Commentary.
4. "If your instructions also say to ask one short question rather than guess, this is how that applies to a file made
   for the person in a direct conversation: save here and ask." Commentary (round 15 of the original review); the rule
   it describes stays, next to it: save to Files, ask which project in the same line, "Never wait with the file unsaved."

Kept word for word: Josh's #3965 (a file, never an artifact or link), #4420 (directly in that exact folder; never say
"under Files" unless saved there), #3759 (a project's work goes in the project; unsure: save to Files and ask).
Not touched: the working rules' "Where the files you make go" (`engine/defaults.js`, changed by slice 2, #8774) and the
top-of-file pointer (it reaches agents holding the old working-rules sentence, #4420).

## Tests
`engine/dmfiles.test.js`: the three assertions on cut sentences now pin the one kept statement of each fact.
Perturbed: each kept statement removed -> red (3 of 3), restored -> green.

## Measured
pm brief 51,610 -> 51,098 (512 characters). The size ratchet is not lowered here, so this does not conflict with slice
2's ceiling line; the next slice lowers it.

Weakest premise: the cut commentary sentences change no agent's behaviour. What would change my mind: an agent leaving a
file unsaved while it asks which project.

## Review 1 (Opus)
- No BLOCKER. Cuts 1 to 3 judged genuine repeats or commentary from the source and the history (cut 1 was added for
  #3614's "Nothing here yet" failure before #4420's sentence covered the same failure).
- WARNING, MEASURED: cut 4 changed wording that #3759 had measured with real runs. Re-measured, both arms, one case
  (the landlord email, an agent on two projects, the full working rules, a brief made by createAgent): 2 runs on this
  branch's wording, 2 on main's. All 4 saved the file directly in Files first, said "under Files on your page in
  Kosmos", and asked which project it belongs to, offering to move it. No difference between the arms.
  - Two measurement traps found on the way, both recorded so nobody trusts such a run: `claude -p` (2.1.329) does not
    read a CLAUDE.md under /private/tmp at all (a marker probe answered NONE for a 68-character file); and
    `--setting-sources project,local` no longer keeps the operator's global ~/.claude/CLAUDE.md out (#3759 relied on
    it). The 5 runs made under /private/tmp are void. The 4 valid runs had the global file loaded in BOTH arms; it says
    nothing about where an agent saves a person's files.
- NIT fixed: the code comment that named the cut sentence now names the kept one.
- NIT kept: the subfolder assertion may duplicate one in the #4420 test file (harmless).

## Review 2 (Sonnet)
- No BLOCKER, no WARNING; converged. NIT kept: no doesNotMatch guards the cut sentences against coming back (that pins
  prose, not behaviour; the kept statements are pinned and perturbed).
