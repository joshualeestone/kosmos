# npwords-8837: New Project tidies a plain refusal; one step-up sentence (kosmos#8837)

## Finished means
The iPhone New Project sheet shows a board refusal as a sentence (a capital, one full stop), as New Agent and New Team
do, and the step-up sentence exists once.

## What changed
- BoardRoom.swift: NewProject.sentence (moved from NewTeam), used for plain refusals; NewProject.stepUpWords is the literal.
- NewAgentLogic.swift: NewTeam.sentence and NewAgent.stepUpWords point at NewProject's.
- LogicTests room: a lower-case and a padded refusal tidied; an already-tidy one unchanged (control); one sentence.

## Rejected
- Calling NewTeam from BoardRoom.swift: three runners (newtask, files, taskpage) compile BoardRoom.swift alone (review 1).

## Weakest premise
The shared tidy function's own edge cases (a refusal ending in a quotation or colon) now reach New Project too; they
already reached New Agent and New Team, and no board refusal reads that way today.

## Verify
All 13 ios/LogicTests runners pass (room 907/907, main 2181/2181); simulator build clean.
