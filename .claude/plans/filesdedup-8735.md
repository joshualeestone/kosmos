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
