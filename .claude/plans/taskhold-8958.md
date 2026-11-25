# taskhold-8958: Put on hold and Take off hold on the iPhone's task page (kosmos#8958 slice B2)

## Goal
Slice B2 of kosmos#8958 (plan on the card, comment 7127094136): the board's tk-hold button, natively. Stacked on B1
(taskacts-8958); rebased onto main once B1 merges.

## Change
- TaskPageLogic:
  - taskHoldRequest (POST .../hold {onHold}) and the board's words (holdTitle, and the refusal and check lines).
  - holdNextLine: the unhold route's `next`. Where the board shows Choose who (the route's closing " To choose who,
    assign it now.", or a free part beside one somebody is on: its looseBesideHeld), the ask is cut and
    " To choose who, open this task on your computer's board." said instead: the phone has no part picker yet.
  - holdNextSig, the board's tkHoldNextSig: open, held or closed; who is on each open part; the project's pause and
    its members' session names. Narrower than the board's: a member with no session name, and the roster's order,
    do not count.
  - holdAnswerTask: the route's `task`, read as a task page, for the signature.
  - The hold hints that said "on your computer's board" say "here", as the board's do.
- TaskPageModel.toggleHold, as the board's click:
  - Putting on hold reads the task fresh first, with its own read (the board's tkHoldFresh), never the shared tick
    read, which a newer tick can overtake. Nothing is sent if the task is already on hold (said so, page re-read),
    gone, or could not be read.
  - Taking off posts at once.
  - Then the page and activity are read. The next sentence is said only when the answer carries a `task` whose
    signature matches the page now shown (the board's tkHoldSayNext), and is recorded with that signature: a later
    read that differs, or the task going, takes it down.
  - A refusal from the Mac is marked holdRefused and drawn as Mark as done's refusal is.
  - Each press starts clean: holdSay, its signature and holdRefused are cleared.
  - Put on hold and Mark as done each send nothing while the other is out.
- TaskPageView: the button under the hold hint on an open task, 44 pt, off and dimmed while either press is out
  (Mark as done too); the hold line, in the refusal colour when it is a refusal, announced to VoiceOver.
- server.ios-routes-6838.test.js: the hold route declared.

## Rejected
- The hold form (Wait for, Until, Why, Save): large, and its "Choose who" needs the part picker. It stays on the board's
  page, through the info button.
- Reusing the shared numbered read for the check before a hold (review 1): a tick overtaking it left the check on the
  task as it was before the press.
- Recording the next line against the phone's own read after the post (review 2): it could never notice a hand-out that
  landed in between.

## Tests (ios/LogicTests/run-taskpage.sh)
- The request and body both ways; the words; holdNextLine with the ask, a free part beside a held one, and a control;
  an ask-only next; holdNextSig changing for a re-hold, a pause, another agent, and a nameless member.
- The model: pre-read then post; already held sends nothing; Take off posts at once and says next; a refusal (and its
  colour); a stale press; a tick read overtaking the check; two presses; Mark as done during a hold and a hold during
  Mark as done; a closed task; gone and unreadable checks; sign-out mid-press; the line staying for a same read and
  going for a re-hold or the task going; the answer's task differing, the read after failing, and no task in the
  answer (with a control); each press starting clean.
- Every guard above was removed once and its check went red.
- TaskPageActionsUITests checks Put on hold is on the sample's open task.

## Weakest premise
The phone says where to choose who but cannot choose. The person who unholds a task that waits for a person still has
to go to the computer's board; the info button is one tap away, but it is not labelled for this.
