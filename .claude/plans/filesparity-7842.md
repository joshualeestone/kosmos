# filesparity-7842: Files keeps its list through the same answers as the Profile

Card: kosmos#7842 (split from #7840's last review round).

## Call
One rule in BoardLogic, `Board.answerStands(status)`: only a 200, 404 or 409 says what a thing is now and replaces a
value already shown. Everything else (no answer, 401/403, 5xx, 408, 429, any other 4xx) keeps what is shown and is
said only when nothing is. The Profile (AgentInfoLogic.notTheValue) and Files (filesKeepsShown on the Files screen,
FilesSectionState.forNow plus filesSectionAfter on the agent page) both use it.

## Rejected
- A new FilesRead case: FilesRead is matched in many views; the Files screen has the status, so a status rule is enough.
- Keeping "any 4xx with words replaces": a 400 or 409 is about the request, not the agent's instructions or files.

## Weakest premise
That nothing the phone reads uses a status outside 200/404/409 to mean "this is what it is now". Read in server.js:
instructions GET answers 200, 404, 500; skills GET 200, 400 (an unreadable name), 404; files (flat) 200, 400, 404;
files browse (what the Files screen reads, review 1) 200, 404, 403 (a cross-site read, which the phone does not
make), and 409 when Files is a link, a file, or cannot be read: those 409s say what the folder is now, so 409 stands.
No route sends 410, so it is not in the rule (review 1).

## Not changed
A 200 the phone cannot read with no words: the Profile keeps (profileCannotRead), the Files screen replaces with
filesCannotRead. Predates this card; noted on it.

## Verified
agentinfo 117/117, files 82/82, settings 42/42, run.sh 1871/1871, simulator build SUCCEEDED. Perturbations on a
scratchpad copy (before review 1): old 4xx rule fails 2 + 4 checks; dropping the forNow keep fails 8.
