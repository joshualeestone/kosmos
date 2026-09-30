# connverbs-4678: the connector-verbs timing arms wait on their condition (#4678)

Plan as posted on the card (issuecomment-5902779896), with Liu Kang's conditions (m3843).

Done means: no arm of tools/test-connector-verbs.sh can fail because the box was slow to run a stand-in, and none can
pass when the library is broken; a stand-in that really hangs every time still goes red.

Weakest premise: not reproduced here (10/10 green, load 7-8 and nice -n 20). The reported failures (an instant stand-in
reaching the 20 s bound) read as the box not running the process at all. The fix does not depend on the cause.

- Reason arms and probe-direct arms: ONE rerun, only when the whole outcome is the timeout sentence, printed (RETRY) and
  counted; every arm names its own reason, so two timeouts fail.
- Hang arm: returned before the stand-in's own sleep (took < 30 s, sleep 300), not "under 10 s of wall clock".
- Child-hang arms: judged only once the stand-in recorded its child; one rerun on a timeout with no child; never
  recorded twice is "could not tell", a failure.
- Stand-ins that hang while a test-made marker exists prove the rerun path on any box, each asserting exactly one rerun.
