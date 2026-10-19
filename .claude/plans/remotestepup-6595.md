# remotestepup-6595: a remote session needs a fresh second-factor sign-in for keys, updates and new agents

Card: kosmos#6595 (security hardening R01a). Splinter's ruling 09:44 CDT 2026-10-19: remote sessions never Allow
another device (Renet's half, remotemark-6595, which this branch builds on); key entry, update and unsandboxed-agent
creation need a fresh authenticator code. This is the step-up half.

## What changes
- `server.js`: one gate, right after `remoteWriteGuard`, before any route reads its body.
  `remoteStepUpRefusal(req, pathname, now)` refuses 403 `{code: "remote_step_up", error}` when the route is gated,
  the request is remote (`isRemoteRequest`, Renet's) and the session is not fresh.
- Fresh = `x-kosmos-session-second` is exactly `1` AND `x-kosmos-session-iat` is a plain decimal within the last
  10 minutes (a minute of clock drift ahead allowed). The Kosmos+ gate writes both, over any client value, only for a
  sign-in session minted from a token after kosmos-relay sessioniat-6595; every other session sends neither.
  Missing or malformed is NOT fresh.
- Gated: updating and anything that downloads and runs software (`/api/update`, `/api/update/rollback`,
  `PUT /api/autoupdate`, `/api/connect/start`, `/api/antigravity/install`, `/api/muse/install`,
  `/api/runners/<id>/install`); a key, a token or a
  sign-in that leaves a credential here (`/api/accounts/openai`, `.../{claude,gemini,grok}/apikey`, `.../qwen`,
  `/api/cloudflare/token`, `/api/svc/<service>/token`, the OpenAI and Grok subscription starts, Antigravity and Muse
  sign-in, GitHub, GitHub device and Vercel starts); making an agent (`/api/agents`, `/api/team`,
  `/api/connect-agent`, `/api/worlds`, `/api/worlds/import`, and bringing one back, `/api/agent/<name>/restore`).

## Decided (reversible; each is one line in REMOTE_STEP_UP_EXACT)
- **"Unsandboxed agent" is every agent.** Every Kosmos agent runs with an unsandboxed shell; there is no sandboxed
  create option to exempt. So every create route is gated.
- **Installing counts as update.** `/api/connect/start`, Antigravity's and Muse's installs download and run a
  provider's software, the class the update route's own comment names (review iteration 1).
- **A sign-in counts as key entry.** It leaves a credential on this computer as surely as a pasted key does, so each
  sign-in START is gated; the steps after a start (a code, stop, agree) follow it and are not.
- **A whole new Kosmos counts as making agents.** `POST /api/worlds` can copy agents in and starts them at once, so
  the route is gated whole, not only when its body asks for imports (the gate runs before any body is read).
- **Writing an agent's launchd job counts as making one** (`/api/register`, review iteration 3).
- **Resetting the second factor is gated.** From a stolen session it would let the thief enrol their own factor and
  then pass this step-up; at the computer it needs nothing more. Someone without their authenticator resets it at the
  computer.
- **`PUT /api/autoupdate` is gated whole,** off as well as on: the gate reads no body, and one more prompt to switch
  it off costs little.
- **A gated path is gated for POST, PUT and PATCH** (review iteration 6), so a later handler that accepts another
  writing method on it is covered. DELETE takes away and is not.
- **`/api/remote/setup-start` is not gated:** it is this computer's own Kosmos+ enrolment (remotemark-6595's list).
- **The tests never send a request a broken gate would let act** (review iteration 6, after 13:10): over HTTP only
  key routes with an unreadable body, which answer 400 either way; every other route is tested on the function.
- **Federation is gated where it lets something in** (review iteration 9): joining another Kosmos's project (a room
  outsiders post into and agents act on), inviting one, and sharing this project's own code. Verifying an invite,
  removing and withdrawing are not.
- **`/api/machine/start-at-sign-in` is not gated:** it writes the board's own login job, which restarts only code
  already on disk (the engine-restart reason).
- **Joining a company or family is gated** (`/api/org/enroll`, review iteration 7): it applies that org's policy here
  and starts reporting this computer's activity to it. Previewing a code and leaving are not.
- **Making a project webhook is gated:** it mints a secret address an outside party can post tasks to, for as long as
  it lives. Renaming or deleting one is not.
- **Codex hook trust is not gated:** every agent already runs an unsandboxed shell.
- **Not gated, decided (review iteration 4):** `/api/accounts/share` (moves where a Claude account's history lives; no
  credential or software enters) and `/api/engine/restart` (restarts onto code already on disk, only when stale).
- **The gate is a list, not a default.** A future route of this kind is open until someone adds it; the two source
  scans narrow that to routes whose paths name none of their words. Rejected: gating every POST from a remote session,
  which would ask for a fresh sign-in to send a chat message.
- **Skills are not gated.** A skill is text agents read, and a remote session can already tell any agent anything in
  chat, so gating skills would add a prompt and no protection (review iteration 2).
- **Taking things away is not gated:** forgetting a token, signing a provider out (DELETE), checking for an update.
- **A local request is never asked:** the person is at the computer.
- **The refusal says what to do** (sign out on the page and on the sign-in site, sign in again with the email code
  and authenticator code, retry within 10 minutes; see the next section). The page shows the `error` it is given;
  no page change in this branch.

## The fresh sign-in must really be fresh (Renet, 12:54)
The gate's sign-in ends in a handoff that keeps the SOURCE sign-in site session's issue time. So signing out of
Kosmos+ on the page alone loops: the gate signs straight back in from the sign-in site's year-long session, with its
old time, and the board keeps refusing. The refusal therefore says to sign out on the page AND on the Kosmos+ sign-in
site, then sign in with the email code and authenticator code. Follow-up for kosmos-relay (owner PigeonPete, card by
2026-10-21): the gate asks the coordinator for a fresh handoff (refuse a source session older than the step-up),
so one sign-out is enough. Not tested end to end here: the gate and the coordinator are in kosmos-relay.

## Weakest premise
That the gate's two headers can only come from the gate. Per Renet, the tunnel drops client copies on every path and
writes them only after verifying a token session. If a remote path existed that did not go through the tunnel and
set none of the forwarding headers, it would read as local and never be asked (Renet's stated limit, same here).

## Not covered
- 🛑 MERGE ORDER, and it is the protection (review iteration 3; an earlier version of this line had it backwards).
  A tunnel older than sessioniat-6595 passes client headers through, so behind it a remote browser can send both
  headers itself and pass the gate. The board cannot tell the tunnel's age. What protects it: the tunnel rides in the
  same bundle (an update swaps app/ whole), and a cut refuses a tunnel behind relay main
  (tools/lib/connector-currency.sh, unless KOSMOS_ALLOW_STALE_TUNNEL=1). So this branch merges only after
  sessioniat-6595 is on relay main, and never into a cut that sets the stale-tunnel override. The PR is opened with
  a do-not-merge label naming that dependency. A runtime check (the board asks its bundled tunnel whether it
  strips the headers, and trusts them only if so) would make it mechanical; it is proposed for #6616 (R01b). Before then, the gate is
  forgeable, which is no worse than today (no gate at all). Recorded on #6595.
- A sign-in session stored before sessioniat-6595 sends no headers, so those people are asked once and their next
  sign-in carries both (Renet's contract).
- A remote session can still ask an agent here to do these things; an agent's own request arrives without
  forwarding headers. Renet's plan names the same residual.
- A board clock more than a minute BEHIND the gate's reads every fresh sign-in as from the future and refuses it; the
  refusal said to sign in again, which cannot help; since review iteration 8 it answers its own code,
  `remote_step_up_clock`, saying to set this computer's clock. Accepted: the window is the
  tolerance a clock stepped back deserves, and both run on this computer, so they share one clock in practice.
- `POST /api/accounts/qwen/local/download` and `/model` (a model download, and the model choice, through Ollama,
  which the person installed themselves) are not gated: they run no new installer. `POST /api/github-device/app`
  stores a client id that is public by design. Named here so the boundary is explicit.

## Tests
`server.remotestepup-6595.test.js`, including two guards. Literal routes: every POST/PUT route whose path looks
like a key, token, sign-in, install, update or create is gated or exempt with a written reason, and every gated route
exists (dropping one gated route turns it red, naming it). Regex routes, which the literal scan cannot see: every one
whose pattern names a token, install, sign-in, import, restore or skill is decided, gated ones matching a sample path
(deleting one decision turns it red, naming it), and each sample path must match the server's own pattern too.
Two shapes neither scan sees: a route whose path names none of the scans' words, and a route written as a group
(`(pathname === 'a' || pathname === 'b') && ...`, or one block that checks the method inside, as the Antigravity,
Muse and org routes are). Those are covered only by being listed by hand. Neither guard can see a route whose path names none of those words.
The rest: every gated route refused remotely without headers, with second=0, with a
stale time and with a malformed time, reaching nothing (the gate runs before the body is read); CONTROL: a fresh
remote session and a local request pass on key routes (which then answer 400 for an unreadable body); update and
agent creation pass arms tested on the function only, never run; the window's edges and malformed values.
Mutations, run by hand on the current file (iteration 6), now safe to run because no test sends a request a broken
gate would let act: gate call removed, the 5 HTTP refusal tests red; freshness always true, the 3 function-level
refusal and freshness tests red. (At 13:10, on the earlier file, removing the gate let one test start a real GitHub
sign-in; killed, nothing installed. That is why the tests changed.) The route guards' own controls (drop a gated
route, drop a decision) were run too.
