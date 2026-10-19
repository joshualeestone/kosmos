# stepupbutton-6616: one Sign in again button for a remote step-up refusal (R01b, part 4)

Card: kosmos#6616 (security hardening R01b). Stacked on remotestepup-6595 (R01a), which refuses a stale remote session
before keys, updates and new agents with code `remote_step_up` and a sentence telling the person to sign out in two
places. Part (3), in kosmos-relay gatefresh-6616 (Renet), makes the gate serve `/_kosmos/signin?fresh=1`: it ends
the gate's session and sends the person to the sign-in site for a FRESH sign-in (parts 1 and 2, kosmos-relay
freshhandoff-6616). That connector then lists `fresh-signin` in `kosmos-tunnel capabilities` (agreed with Renet
16:10 CDT 2026-10-19).

## What changes
- `server.js`: `remoteStepUpRefusal` returns `REMOTE_STEP_UP_SIGNIN` (same code, `signInAgain: true`, a sentence
  that says "Press Sign in again") instead of `REMOTE_STEP_UP` when the connector lists both `session-headers` and
  `fresh-signin`. The clock and connector refusals are unchanged and never carry the flag.
- `web/index.html`: one fixed ask (`#stepup-ask`) with the server's sentence, a link to `/_kosmos/signin?fresh=1`
  and Not now. Shown by the page's one fetch wrapper (#6192), which now reads a 403's clone as JSON (it drained it
  as bytes before) and passes it to `showStepUpAsk`, so every page's refused request reaches it with no edit at any
  call site. The page that made the request still shows the refusal its own way.

## Decided
- **The button's address is fixed in the markup**, never read from a reply: a reply can only say whether to show it.
- **Shown only when the connector says it serves the path.** An older connector would answer 404; the board then
  shows today's sentence and no button.
- **One ask for the whole page**, through the wrapper, rather than a button in each of the many places that show a
  refusal (the board has hundreds of fetch call sites and no shared API helper).
- `fresh-signin` alone vouches for nothing: without `session-headers` the connector refusal still wins.

## Weakest premise
That `fresh-signin` is printed only by a tunnel that serves the path (Renet's contract). The board cannot check it.

## Not covered
- End to end with Renet's gate: it is in kosmos-relay, unmerged; the capabilities verb lands with sessioniat-6595.
- Part (6), the running tunnel reporting its own capabilities rather than the binary's: still open on #6616.

## Tests
server.stepupbutton-6616.test.js: the refusal with and without fresh-signin (CONTROL: today's sentence, no flag);
fresh-signin alone, the clock refusal and a fresh session; the page's showStepUpAsk shown only for remote_step_up with
signInAgain === true and a string sentence; the link's fixed address and nothing rewriting it; the wrapper sends a
403 (and not a 500) to the ask. Mutations: the server never choosing the new refusal, the page ignoring the flag, the
wrapper not reading 403s; each turned one test red.
