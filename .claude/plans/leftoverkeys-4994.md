# #4994: deleting an agent's leftover retires its community account

## Finished looks like
A new agent created under a name freed by "delete leftover" (or freed any other way) registers with the community as
itself. The deleted agent's public posts and comments can still be deleted and read for take-downs, as the account that
made them, and nothing the deleted agent wrote but never sent goes out under either account.

## Call
Retire, not drop. `communitysend.requestRetire(name)` runs synchronously in the board process, from the delete (once the
folder and the job are gone) and from every agent create (next to the #1131 token revoke; a name with no history makes
it a no-op). (Create reaches it only when no folder, job or session of the name is left: it refuses a folder alone or a job alone.)

It writes a request file under `communitysend/retire/`, then marks every post and service comment of the
name the board received up to now `notSent` in the board's store (`communitystore.markAgentNotSent`; published, held or
quarantined). The send layer never sends a marked item, whichever service or ON period it reads later and whenever a
held one is released.

The start of every keys.json section (`exclusive`) applies pending requests: the store mark again until it has landed
once (`marked`), then, in every service folder, the key entry moves to `retired:<name>:<at>` (a name never holds a
colon) and the records of the name follow it. A record that may be on the service (attempted, has a remote id, sent,
deleted, unconfirmed) always follows; one that never left follows only when its item is one the store holds from
before the delete (`receivedAt <= at`), and is marked `not_sent` / `agent_deleted` if it was still pending. A key made,
or a record whose item was received, after the delete is the new agent's and never moves, so a request applied again
later (after a restart) does not retire the new agent's account. (A key's time is when its registration was asked for,
so one that answered after the delete is still the deleted agent's. A record sent after the delete stays with the new
agent only once a newer key exists; before that it was the deleted agent's send, on the network at the delete.) Each folder is applied on its own and recorded in the request (`done`;
failures in `stuck`), and none counts as done before the store mark has landed. Until the current service's folder is done, the name acts as nobody there (ensureRegistered,
agentCallSteps, and a check again after a registration's network wait), willSend (and postWaits for a post) ignores the deleted agent's key and
says "later" (never "no", which the route makes permanent) once a try there has failed, and an unreadable retire folder
or request holds every name.

sendPost and sendComment never send a record that follows a retired account; an attempted one is left to
settleUnconfirmed, which settles one the service never got to not_sent, and leaves a name being retired alone until its
record has moved. A retired account receives industry clears
only, and the install-group pass (#4922) treats a name being retired as removed (cleared if grouped, never sent); with
the retire list unreadable it sends nothing and clears nothing for a live agent, as with an unreadable removed list. The owner's list labels a deleted agent's rows "<name> (deleted agent)" (`agentDeleted`), never by the new
agent's display name, and reads not_sent posts as "Not sent. It stayed on this computer." (the comment wording). The
delete's confirmation lists the community account (any service's, or when the keys cannot be read) and stops promising
everything comes back from the Trash; its
failure sentences say the account is not retired yet and that making a new agent with the name retires it first. With
no account but community posts the sender could still send (held, or published in the current ON period with no
record of going out), it says those are never sent, even if the folder comes back from the Trash. The
held list says a deleted agent's held item is never sent if released (render-community-held-4525.js pins it).

## Rejected
- Drop the entry (the card's suggestion): the owner's later deletes of the old agent's public posts would find no key,
  and a 404 under a NEW account reads as "deleted". Retiring keeps them reachable.
- Rewrite keys.json directly from the delete: the sweep loads keys.json, awaits the network and saves its copy, so the
  rewrite would be lost under it. Hence a request file applied inside the lock.
- "Never send" as per-service records: they missed later services, an unreadable state.json and held posts released
  later. The mark lives in the store instead.
- `withheld` for the deleted agent's unsent items: the page reads it as "Deleted before it was sent", a delete the owner
  never made.

## Weakest premise
That nothing else keyed by the agent name has to move with the account. One does: the board's moderation trust
(trust.json), so a new agent inherits the deleted one's standing. Filed as #5000 (Baron has it). The replies-seen marks
(communityread) are also keyed by name; harmless today, because the replies list matches records by name and a retired
record no longer matches. The read, follow and mine paths go through communitysend's records.

## Deferred, each with why
- A request stuck on a stale service's unreadable folder has no age cap. Once the current folder is done it is retried
  at most every 15 minutes, logged once. While that folder stays unreadable every create adds one more such request
  (each create files one), so they accumulate until it is repaired. It holds the name only if the board is pointed
  back at that service, where the agent is told why. A second request for the same name can leave a second retired
  copy of the same key (harmless: clears go to that account twice).
- If the delete cannot write the request file, it reports PARTIAL and a retry is refused once the files are gone. The
  next create under the name requests it again, so the gap closes there.
- A corrupt store file is set aside by the board's loader and then reads as missing, so a copy restored from it later is
  not marked. Holding the name until a restore that may never come could hold it for ever.
- While a retirement is stuck on the current folder, `--replies` for the new agent can list the old agent's sent posts
  (communityread matches records by name). Needs the stuck state; not gated.
- Issuing a remote-agent token (POST /api/agent-token) does not retire anything. That route cannot tell a new remote
  agent from the same one issued a token again after all its tokens were revoked, and retiring cannot be undone. So a
  name freed by hand and then used for a remote agent still posts as the old account; a create or a delete closes it.
- A request that cannot be parsed holds every name, as an unreadable retire folder does, and only the log and the
  agent's own refusal say so; the owner's page does not. One applied everywhere whose
  file cannot be removed is treated as finished in memory (a restart re-applies it, which changes nothing).
- A new industry pick skips retired accounts, so a deleted agent's public profile keeps the previous industry until the
  owner clears it; the shut-out count in the industry hint can include retired accounts.
- Retired accounts stay in keys.json, and the take-down read polls each one with sent posts every 30 minutes.
- A pending record whose post has left the store (discarded) is neither moved nor marked; nothing sends from records
  without a store row. In a stale service's folder, applied while the post store could not be read, pending records stay
  under the bare name; the store mark is what keeps their posts home.
- A create under a name that a remote (token) agent holds retires that agent's community account, as the #1131 token
  revoke in the same step already ends its tokens: create treats a name with no folder, job or session as free.
- After a restart, a request applied again moves a new agent's record that is `attempted` with no `sentAt` and whose
  post has left the store. Needs an unremovable request file, a restart and a discarded post.
- The held-list sentence keys on the row's `notSent` flag, which only the retirement sets on a held row today.
- A `registering` mark with no key is moved like a key; no key exists to use either way. A retired record still
  `attempted` whose account has no key, or whose post has left the store, stays unconfirmed: nothing can settle it.
- The delete asks no typed name for the community account, though it cannot be undone: the confirmation lists it and
  says it does not come back, and typing is kept for files nothing can bring back.
- Every create now requests a retirement, so a create can be refused when the data folder cannot be written, as the
  sender-token revoke already is.
- The old account keeps its public name on the service, so a new agent with the same display name joins under a suffixed
  name (the confirmation says the public name may change).

## Tests
engine/communityretire-4994.test.js (33, a fake service that only lets a post's own agent delete it),
engine/delete-leftover.test.js (+13, including two create cases), web.community-agent-deleted-4994.test.js (2). Each
guard was removed once and a named test went red: the apply in `exclusive`, the pending guard, the not_sent marking,
the time bound, the send-time guard, the owner-list label, the store mark, the record bound, the attempted wait, the
confirmation line, the re-mark on apply, the hold until marked, the unreadable-folder hold, the create request, and the
folder-and-job gate. The chmod-based tests skip as root.
