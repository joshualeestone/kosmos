# #3939 slice 3c-4: Meta Muse on the first-run guided setup (behind the flag)

Branch muse-firstrun-3939, off origin/main 26345dc11 (3c-3b, #4380). Angel, 2026-09-28. Drafted while
3c-3b validated; the measurements below were made then, on the 3c-3b tree, which is now main.

## Finished looks like
With AGENT_WORKFORCE_MUSE=1 on a Mac, the first-run provider list's Meta row (today a static
"Llama / Meta, Coming soon", web/index.html ~13385) is live: a Connect button that takes the person
through Meta's sign-in, and once Muse is installed and signed in it shows the gold "connected" box like
Gemini and Grok. Everywhere the flag is off the row is byte-for-byte today's.

## Shape to decide (read before building)
- Where the sign-in runs. Two options:
  A. Inline in first-run, like Gemini's subscription path (fr-gemini-confirm / fr-gemini-pick).
     Rejected for now: it would be a second copy of 3b's device-code step (code boxes, expiry retry,
     stop-by-id), and 3b took many review rounds to get those guards right.
  B. Connect opens Add a provider already on Meta (3b's tested flow), and first-run repaints from
     /api/muse when that dialog closes. RECOMMENDED. To measure first: can openAcctAdd open over
     #firstrun (z-order, focus trap, Escape closing the wrong layer)? If it cannot, A is back on.
- Row words when live: keep "Llama" + "Meta"? Muse is Meta's app, Llama the model family. The Create
  and Add a provider menus say "Meta / Llama"; the row should say the same thing they do.
- The row's live/off state must use the same read as the create form (museCreateAsk / MUSE_CREATE),
  not a third copy of the /api/muse gate.

## Tests (planned)
- node: the row stays today's markup with the flag off (a CONTROL on the exact string).
- browser check (extend render-muse-signin-3939.js): flag off row unchanged; flag on shows Connect;
  signed in shows the connected box; Connect lands on Meta's step in Add a provider; closing it
  repaints the row.

## Measured 09:4x (read only)
- No code path opens Add a provider from inside first-run today: openAcctAdd's only callers are the
  Settings rows (acctGeminiSignInAgain at ~26592, and the Add button). The Gemini subscription sign-in
  on first-run runs INLINE (fr-gemini-*). So B has no precedent and A has one. Before choosing, boot a
  sandbox page and open the dialog over #firstrun (z-order, focus, Escape). If B breaks any of the
  three, take A and share 3b's device-code painter rather than copy it.

## Measured 09:5x (headless page, scratchpad/fr-over.js, nothing edited)
frOpen() then openAcctAdd(): #acct-add-modal is a direct body child, so frOpen's
`body > *:not(#firstrun)` inert covers it (inert true before AND after opening), and a hit-test at the
modal's position lands on #firstrun. B as-is gives a dead dialog underneath first-run.
DECIDED: A, inline on the first-run Meta row, sharing 3b's device-code painter (factor it to take its
container) rather than copying it. Rejected: un-inerting the modal from first-run (two modal layers,
two focus traps, two Escape handlers fighting). What would change my mind: 3b's painter being too tied
to #acct-add-* ids to factor without a rewrite; then B with first-run closed first (frClose, then
openAcctAdd, then reopen first-run on close) is the fallback.

## Read 09:5x: the painter CAN take a container
ACCT_MUSE (web/index.html ~26431) is an IIFE whose every element lookup is `el(x) =
getElementById('acct-muse-' + x)`. Plan: `museSigninFlow(prefix)` returns the same object; ACCT_MUSE =
museSigninFlow('acct-muse-'), FR_MUSE = museSigninFlow('fr-muse-') over first-run markup with the same
suffixes (go, retry, cancel, say, code, open, open-row, retry-row, cancel-row). The listeners at
~26561-26566 move into the factory. Only one flow can be live at a time (first-run inerts the dialog),
and the engine's sign-in is stopped by id, so frClose must stop FR_MUSE's sign-in the way closeAcctAdd
stops ACCT_MUSE's (check closeAcctAdd for the call).
Surface gate: renaming ACCT_MUSE's internals will flag render-muse-signin-3939 (update it) and maybe
others sharing tokens; run the gate early.

## Read 10:3x: the rest of the coupling
- ACCT_MUSE's API is { start, retry, leave, reset, active }. Its one tie to the dialog beyond the id
  prefix is watch()'s done branch calling paintAccounts(). Factory signature:
  museSigninFlow(prefix, { onDone }); ACCT_MUSE passes paintAccounts, FR_MUSE passes the first-run row
  repaint (and museCreateAsk(), so the Create form sees the sign-in too).
- Teardown: acctMuseShow(false) -> ACCT_MUSE.leave() (stop by id). frClose must call FR_MUSE.leave()
  beside frKeyedHideAll(), or closing first-run mid sign-in leaves the engine's sign-in running.
- Markup to mirror (~12176): intro line, go, open-row (+ link), code, retry-row, cancel-row, say
  (role=status). First-run versions get the fr-muse- prefix inside the Meta row's expandable panel,
  shaped like fr-gemini-confirm.
- The watch poll uses setInterval: render-muse-signin-3939's harness captures only intervals whose
  source mentions /api/muse/signin, which a factory keeps true (same function body).
- Row live state: the Meta row goes live only when MUSE_CREATE.on (the same read as the create form).
  Flag off: markup byte-identical to today (node test pins the exact row string).

## Weakest premise (now)
That the first-run row can host the code boxes and Meta's link without breaking first-run's layout at
phone width. Measure with a shot at 390px once built.
That Add a provider can open over first-run without breaking first-run's own focus and Escape
handling. It is the first thing to measure.

## Status
- 2026-09-28 12:0x: plan committed.
- 13:5x: built. museSigninFlow(prefix, { onDone }) (refactor alone first, the Add a provider check unchanged and
  passing); the Meta row keeps today's markup (class="llm off", the Coming soon pill in place: two tests pin
  them) and gains a hidden Connect plus a hidden fr-muse- panel; frPaintMeta on step 5; frClose stops the
  sign-in. The model step's slice tripwire moved 49000 -> 54000 with its measurement (49755; create-model
  115234 away). Browser check: switched off unchanged; switched on Connect; the panel opens with focus; one
  start; closing first run stops it by id (removing that line reds it); Muse Code missing said; signed in
  Connected with the gold box.
- Weakest premise measured: at 390px wide the page does not scroll sideways (scrollWidth 390), the panel is
  278px inside it, and the code boxes wrap to two lines and stay readable (scratchpad shots, light and dark;
  first run draws light in both themes, like its other rows).
- Decided: Connect stays pressable while a sign-in runs (pressing it again only re-opens the open panel).
- Not in this slice: switching Muse on from first run (the switch is the marker file, #4400).
