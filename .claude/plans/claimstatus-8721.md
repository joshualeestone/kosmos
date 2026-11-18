# claimstatus-8721: a read-only way to check who holds a post (kosmos#8721)

## Finished looks like
`kosmos claim <project> <post> --status` on both CLIs says who holds the post (the agent and how long ago), that it is
yours, or that nobody holds it, and changes nothing: no claim taken, none given back, no reaction row written. It is
refused exactly as a claim is for an agent not on the project or a post that is not there. `--status` with `--release`
is a usage error. The usage line on both CLIs says plainly that plain claim TAKES the post.

## Calls
- One more `claim` mode, 'status', in engine/messages.js react(): answered after the same room and post checks as a
  claim and before anything is written. Rejected: a separate GET route, which would need its own token and membership
  checks and could drift from the claim's; one function keeps the two answers about the same post the same.
- A status check that times out exits 1 and says nothing was claimed (a read changes nothing, so it is not a
  "may have happened" 3).
- The agent instructions (engine/defaults.js) are NOT changed. Adding a --status line there changes the doctrine
  block, which needs a version bump that banners every agent, and the card asked only for the command and its help.
  Recommend it for the next doctrine change; noted on the card.
- Weakest premise: agents learn --status only from the usage line; an agent that never reads the help keeps using
  plain claim to check. The note on the card says how to close that.

## Status
- [x] engine: claim 'status' in react(), engine/roomclaim-status-8721.test.js
- [x] both CLIs: --status, usage line; tests in cli.claim-6946 and tools.windows-kosmos-cli-claim-6946
