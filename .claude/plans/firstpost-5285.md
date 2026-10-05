# firstpost-5285: an owner's post right after someone joins is held, not dropped (kosmos#5285)

Built on main + #5253 (local merge) because both touch engine/fedseats.js; it is cherry-picked onto main once
#5253 merges (a stacked branch breaks under a squash merge).

## Cause
sendPost refused an owner's post while the seat was 'waiting' with no key ("nobody outside has joined"), and the
seat only noticed a join on the next ensureAll pass (60 s). A post in that gap was lost.

## Change (engine/fedseats.js)
- Owner, seat 'waiting', no key: hold the post (#5192's bounded outbox, marked joinWait). Never refused at once.
- scheduleJoinCheck: ask now, or when the last check's 10 s window ends (one timer per seat); a check already
  out asks again when it ends, for posts held after it asked. At most one check per seat per 10 s.
- The check uses the Mac's shared edges request (sharedEdges, #5193) with notBefore = the hold time, so an older
  answer (another project's) is never reused. An ensure that returned without asking answers nothing.
- Only an answer ASKED at or after a post was held may release it ("nobody outside has joined"); the 60 s pass
  releases only on an answer it asked for itself.
- A connect clears joinWait (someone joined): a post re-held for the key waits as any held post (key, hour).
- A key present (someone was in before) keeps the immediate "nobody else is in now" (#5194).
- stop() clears the timer (tidiness; the timer's callback already refuses a stopped or replaced seat).

## Tests (engine/fedseats.test.js), each red without its guard (mutants, scratch copy)
gap post held and sent on connect; nobody joined says so after one check; inside the window a post waits and a
member who joined meanwhile gets it; two quick posts share one check; a check that cannot ask keeps the post until
a pass settles it; sealed room: the post waits for the member's key and leaves only sealed; only posts held
before a check are released by it; another project's answer is not reused; a re-held post is not released after
the edge is refused; a follow-up check for a post held while one was out; a stopped seat's check never runs.
Reasoned, not measured: the pass's own "did not ask" guard (the race cannot be staged here).
