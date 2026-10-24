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
- `web/index.html`: one fixed ask (`#stepup-ask`) with the server's sentence, a form that POSTs to `/_kosmos/signin?fresh=1`
  and Not now. Shown by the page's one fetch wrapper (#6192), which now reads a 403's clone as JSON (it drained it
  as bytes before) and passes it to `showStepUpAsk`, so every page's refused request reaches it with no edit at any
  call site. The page that made the request still shows the refusal its own way.

## Decided
- **The button's address is fixed in the markup**, never read from a reply: a reply can only say whether to show it.
- **A form POST, not a link** (Renet's contract, 18:07): the gate's `/_kosmos/signin?fresh=1` is POST only (like
  /_kosmos/logout, with the same cross-site guard; GET is 405), ends the gate session and answers 303 to the sign-in
  site, which only a navigation follows.
- **Only the refused request, getting through later, hides it** (review iterations 8 and 9). The ask remembers the
  refused method and path; when that same write succeeds from this board, the fresh sign-in took. Iteration 8's first
  version hid it on ANY successful write, on the false premise that every write is gated: only a listed few are, and a
  chat message or the streak ping passes a stale session too. A read, another write, or another origin leaves it.
- **The keyboard reaches the ask over first run** (found while testing review iteration 11): first run traps focus
  (Tab wraps in it; a focusin backstop pulls focus back to its heading), so the ask was mouse-only there. It is now
  the last stop in that Tab cycle, and the backstop leaves focus inside it.
- Not now sends focus back into a first-run screen when one is up (the page is inert under it; review iteration
  11), else to the K mark, as the board's other notices do (rebootFocusAway).
- **Above the phone's home indicator**: its foot is 24 px plus the safe-area inset.
- **Only this board's own replies raise it** (review iteration 7): the page also reads other computers' boards,
  credentialed and cross-origin, and their refusal must not raise an ask that links to this board's gate.
- **Shown only when the connector says it serves the path.** An older connector would answer 404; the board then
  shows today's sentence and no button.
- **One ask for the whole page**, through the wrapper, rather than a button in each of the many places that show a
  refusal (the board has hundreds of fetch call sites and no shared API helper).
- `fresh-signin` alone vouches for nothing: without `session-headers` the connector refusal still wins.
- **The button only for a request the gate forwarded** (review iteration 3): it carries an x-kosmos-session header.
  A proxy the person put in front of the board never serves /_kosmos/signin; a gate session from before
  sessioniat-6595 sends neither header too, and gets the fallback sentence, which still works.
- **The sentence keeps the two-place sign-out as its fallback** (review iteration 1): the capability is the BINARY's,
  so a tunnel still running from before an update may not serve the path (part 6 reads the running tunnel), and the
  ask can be closed while the asking page still shows the sentence.
- **Above the first-run covers, pressable there** (z 80; exempt from the inert first run and its choice screen put on
  the page), and **hidden under the restart, update and account-switch screens** (the board is going away; those
  make the page inert, so an ask over them could be seen and not pressed).
- **Nothing else draws above it at the foot** (measured 2026-10-19, review iteration 6): the page's full-cover layers
  stop at z 70 (first-run choice, boot cover); the one layer above 80 is #voice-who (z 10000), a strip pinned to the
  TOP of the screen; the page opens no dialog with showModal (0 uses), so nothing reaches the top layer.
- **Every 403 is read as JSON** to find the one that asks: the board's refusals are small JSON bodies, and a body that
  is not JSON is caught (tested). Accepted as a cost, not a hazard (review iterations 4 and 6).
- **Shown first, words written after**, so a screen reader announces every refusal, the same sentence included; the
  alert is the sentence alone (role on the words, not the box with its two buttons; review iteration 5).
- Decided, not done (review iteration 5 NIT): pressing Sign in again leaves the page, so a key being typed in the asking dialog is typed again after ("then try again" says so).
- **Measured at phone width** (review iteration 4): at 390 px it spans the screen inside a 16 px gutter (it was 195 px
  wide with left: 50%). It can cover a dialog's foot there; Not now clears it.

## Weakest premise
That `fresh-signin` is printed only by a tunnel that serves the path (Renet's contract). The board cannot check it.

## Not covered
- End to end with Renet's gate: it is in kosmos-relay, unmerged; the capabilities verb lands with sessioniat-6595.
- Part (6), the running tunnel reporting its own capabilities rather than the binary's: still open on #6616.

## Tests
server.stepupbutton-6616.test.js: the refusal with and without fresh-signin (CONTROL: today's sentence, no flag);
fresh-signin alone, the clock refusal and a fresh session; the page's showStepUpAsk shown only for remote_step_up with
signInAgain === true and a string sentence, the words written after the ask is shown; the form's fixed address and
nothing rewriting it; the wrapper sends a 403 (and not a 500) to the ask, and a 403 that is not JSON leaves no
unhandled rejection; no button without a gate session header. Mutations: the server never choosing the new refusal,
the page ignoring the flag, the wrapper not reading 403s, the gate-header test removed, the words written before
showing, the rejection handler removed; each turned one test red.
Browser check docs/browser-checks/render-stepupask-6616.js, on the $B8 board: control (no flag, no ask), shown, the
reply's sentence, the form's fixed address, on top over the first-run cover (opened by the check with the page's own frOpen
when the $B8 runner has completed first run; control: removing frOpen's exemption turns it red on a B8-style board), hidden under each of the three going-away screens
(control: the CSS rule removed turns that arm red), Not now. Updated render-firstrun-choice-4356 C1 (the ask is the one
non-inert child, and hidden there). render-layer-gutter-4494 (13/13) and render-restart-screen-4343 (78/78) re-run green.
