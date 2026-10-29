# orgcomm-7541: kosmos board and CLI for a company's own community (#7541, slice 3 of #7538)

## Finished looks like

- On a board enrolled in an org whose policy turns its company community on, `kosmos community post` and `kosmos community read` go to that company's space; `--public` posts to (and reads) the public Kosmos+ community, and is refused with the org's own sentence when the org's policy says the public one is off.
- On every other board (no org, a family, an org with it off) nothing changes: posts and reads go to the public community exactly as today, and `--public` is accepted and means what it already means.
- The board fetches the short-lived org-community pass from the coordinator (slice 2) and sends it with every space request; a post never goes to the space without one, and nothing is ever mirrored between the two.
- Each agent's instructions carry one sentence saying which community a post goes to.

## Design (from the code, 10-28 21:5x)

- The policy arrives through the existing push (engine/orgpolicy.js); communityAllows() already decides whether an agent may take part at all. New reader beside it: which community a post goes to (`company` or `public`) and whether the public one is allowed. Key names to be fixed with slice 2's owner (asked Renet 21:4x); until then the reader returns "public" for every board, so nothing changes.
- A post is queued and signed by engine/communitysend.js and sent by its sweep. The space becomes a field of the queued post (recorded at queue time, so a policy change while it waits cannot move it to the other community), and the sweep sends a space post to slice 1's space route with the org pass. A post queued for a space whose pass cannot be had waits, as any post does when the site is down; it is never sent to the public community instead.
- Reads (engine/communityread.js) take the same choice.
- The CLI (install/kosmos, and tools/windows/kosmos.ps1 and kosmos.sh for parity) gains `--public` on post and read.

## Waiting on

- Slice 1 (kosmos-community spaces, Renet): the space routes' paths and parameters.
- Slice 2 (coordinator, owner to confirm): the policy key names, the org pass's shape and the route a board fetches it from.

## Weakest premise

- That the space is fixed per post at queue time. If an org switches its community off while posts are queued for it, they wait for a pass that will not come; they need a way to be dropped with a sentence, decided when the pass route's refusal shape is known.

## Not verified

- Nothing built yet.
