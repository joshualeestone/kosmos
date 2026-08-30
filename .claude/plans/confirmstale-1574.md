# #1574: the 281MB confirm is decided by the server, in the call that would download

**Branch:** `confirmstale-1574` · **Card:** kosmos#1574, which I filed myself during #1556's
review loop.

## The defect

```
web/index.html   if (!confirmed && frClaudeInstallNeeded()) { open confirm; return; }
                 reads FR.connect.willInstall
FR               refreshed ONLY at page boot and on "Check again"
```

On a board left open whose launcher is removed or broken **after** boot, the snapshot still
says no install is needed, the confirm is skipped, and ~281MB begins unannounced. The
server-side TTL does not bound this: it bounds how long the SERVER serves a stale verdict,
while the page holds its own copy for as long as it has been sitting there.

## The mechanism I only found while fixing it

`frConnectStart` set `FR_CONN_CONFIRMED = true` **on the skip path as well**:

```js
if (!confirmed && frClaudeInstallNeeded()) { open confirm; return; }
FR_CONN_CONFIRMED = true;      // <- reached when the gate was SKIPPED
```

⇒ **The page did not merely fail to ask; it then recorded that somebody had confirmed.** A
flag named for a human action was being set by a code path where no human acted. Harmless
while the snapshot is right, and precisely the defect when it is stale.

## The decision

The card offered two fixes and rejected the client-side re-read itself: it narrows the window
and cannot close it, because the same race exists between that read and the download starting.

**Closed server-side, inside `connect.start()`**, which computes a live `haveBinary` probe and
hands it to `runFlow`. The check and the act are now the same decision, so there is no window
at all. It refuses **before claiming a driver**, so a refusal leaves no flow to cancel and the
record stays idle.

## The trade I made, stated so it can be overturned

I built the **default-refuse** version first: any caller reaching the install path without
`installConfirmed` is refused. It is the stronger contract, and it **broke eleven tests across
four files**, every one a test that deliberately drives the install path.

I chose **opt-in at the engine, always-on at the route** instead. `/api/connect/start` is the
only route that reaches `start()`, and it always passes `requireInstallConfirm: true`, so the
browser - the one place a person can be surprised by a download - is fully covered either way.
The eleven tests are untouched.

⚠️ **Weakest premise, named:** this rests on `/api/connect/start` being the only caller that
can reach the install path. Measured today; not guaranteed tomorrow.
**What would change my mind:** a second such caller. At that point the default should flip and
those eleven tests should declare their intent, which is honest work rather than accommodation.

📌 **What is NOT optional either way is the atomicity.** Wherever the default sits, the
decision happens in the same call that would start the download. That is the part the card
asked for and the part a client-side fix cannot provide.

## Both entry points

`/api/connect/start` has two: the first-run screen and the accounts "add" button. The second
already re-read `/api/first-run` immediately before deciding, which narrows the window; it is
still check-then-act and is now closed by the same server refusal. Both send what a **person**
did, and both reopen their own confirm when the server refuses.

## Not done

The download remains visible and cancellable, which the card cites as mitigation. I did not
touch the confirm's wording or the hardcoded 281MB figure; the size constant's hazard is
documented where it lives and is not this card.
