# filesparity-7842: Files keeps its list through the same answers as the Profile

Card: kosmos#7842 (split from #7840's last review round).

## Call
One rule in BoardLogic, `Board.answerStands(status)`: only a 200, 404 or 410 says what a thing is now and replaces a
value already shown. Everything else (no answer, 401/403, 5xx, 408, 429, any other 4xx) keeps what is shown and is
said only when nothing is. The Profile (AgentInfoLogic.notTheValue) and Files (filesKeepsShown on the Files screen,
FilesSectionState.forNow plus filesSectionAfter on the agent page) both use it.

## Rejected
- A new FilesRead case: FilesRead is matched in many views; the Files screen has the status, so a status rule is enough.
- Keeping "any 4xx with words replaces": a 400 or 409 is about the request, not the agent's instructions or files.

## Weakest premise
That no board route answers a 4xx other than 404/410 to mean "this is gone now". Checked the routes the phone reads
here (instructions, skills, files) only by reading their handlers' status lines, not every route.

## Not changed
A 200 the phone cannot read with no words: the Profile keeps (profileCannotRead), the Files screen replaces with
filesCannotRead. Predates this card; noted on it.

## Verified
agentinfo 117/117, files 82/82, settings 42/42, run.sh 1871/1871, simulator build SUCCEEDED. Perturbations on a
scratchpad copy: old 4xx rule fails 2 + 4 checks; dropping the forNow keep fails 8.
