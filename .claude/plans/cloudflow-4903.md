# kosmos#4903 S5: the browser flow on a Kosmos cloud machine (branch cloudflow-4903)

Owner: Baron Draxum. Design: Mona Lisa. Card: kosmos#4903 (S5 in Ice Cream Kitty's owner table).

## What S5 is
A person with no Mac signs up, pays, gets a cloud machine, opens it in a browser through Kosmos+ (S4, PigeonPete), and
uses an agent. S5 is the part in the browser: "your machine is starting", enrolling a second factor (a fresh signup's
session has second=false and the hosted gate refuses it), Claude Code sign-in on the box, and a first agent.

## This branch (first pass): the Claude Code sign-in on the box
- engine/cloudmachine.js: a board is a cloud machine only on Linux and only when the installer's latch, an empty
  regular file `hosted` in the tunnel's state dir (remote.stateDir(), the dir every kosmos-tunnel run gets as
  --state-dir), is there. One source of truth (PigeonPete's correction 2 on the card), never KOSMOS_CLOUD=1. Words and
  flow only, never admission (the tunnel's gate decides who opens the board). Never throws.
- server.js stamps it beside the platform; the page reads it (onCloudMachine, "1" only).
- First run: "Sign in to Claude", the link as the primary button; the code step says where the code comes from.
- Settings: the Claude flow shows the link (https only, while a sign-in is under way), from its own updater.
- The stuck card offers no shell or Terminal hatch on a cloud machine.
- Mac and PC screens unchanged (a control in every test).

## Decisions
- Board-side "cloud machine" reads the latch, not an environment variable: one fact, written once by the installer,
  read by both the tunnel and the board. Rejected: threading KOSMOS_CLOUD into the board's systemd unit (a second copy
  that can disagree). Weakest premise: S3's installer writes the latch at `<data root>/remote/hosted` (or
  $AGENT_WORKFORCE_TUNNEL_STATE/hosted); posted on the card for Kitty.
- Settings' missing link on the Mac (it relies on a browser opening locally, with no fallback link) is NOT changed
  here: it is a Mac screen change and needs its own design pass. Recorded as a follow-up.

## Review 1 (2026-10-26 19:5x)
- BLOCKER FIXED: the Settings link was painted after acctFlowPaint's repeat check, so a link the engine adds to an
  unchanged phase a tick later (engine/connect.js does this on purpose) never appeared, and a changed link kept the
  stale one. Now its own updater (acctClaudePaintUrl), run before the check, in place (the code field is not rebuilt).
  Test: same phase without then with a link, a changed link, the typed code kept, hidden after the sign-in ends.
- WARNING FIXED: the stuck card told a cloud-machine person to use a shell over SSH; on a cloud machine no hatch is
  offered (Linux server control keeps #5449's).
- WARNING FIXED: no test ran the page's real onCloudMachine (every page test stubbed it), so a reader that took the
  unstamped marker for "1" would have changed the Mac screens and passed. Now tested against "1", "0", the unstamped
  marker, "", no meta and no document; both mutants the reviewer named go red.
- NIT 1 FIXED: before Claude prints the link the wording said "open the page below" with nothing below; it now says
  the link appears in a moment.
- NIT 2 OPEN, TO MEASURE ON A REAL BOX: the cloud code-step line says Claude then shows a code to paste (the Mac line
  is conditional, #977). With the copy-the-code link a headless Claude Code prints, a code should always appear;
  confirm on a real headless Linux sign-in before the switch-on of Kosmos Cloud.
- NIT 3 ACCEPTED: the board reads the latch per page request while the tunnel reads it once at start; they can only
  disagree if the latch is removed while the tunnel runs, and the board's answer only changes words.

## Next in S5
1. Design shots for Mona Lisa: a cloud-machine sandbox in docs/browser-checks/mobile-shots.js and these screens.
2. "Your machine is starting" and the second-factor step: both before the board is reachable, so relay-side;
   propose placement beside PigeonPete's S4 admit on the card before building.
3. The real-box measurement (NIT 2 and the card's three questions), on a test machine torn down after.

## Review 2 (2026-10-26 20:0x): no blockers
- WARNING FIXED: engine/remote.js clearStateDir (Remove this computer, and a fresh sign-in after an unfinished one)
  emptied the tunnel's state dir, latch included, and nothing writes the latch again: the box would stop being a
  cloud machine for good. The latch is now kept like the trust files. Keeping it admits nobody (the gate also needs
  the coordinator's signed claim, which a removal ends). Test with an identity-cleared control; mutant red.
  RAISED ON THE CARD: the tunnel's own registration may also clear its state dir (Rust, PigeonPete's side).
- WARNING ANSWERED: render-conn-url.js is NOT_WIRED (tools.browser-checks-wired.test.js: "never run"), so neither a
  local run nor CI covers it; my first commit's "left to the PR's browser-checks job" was wrong for it. The page
  tests drive frConnPaintUrl through frPaintConnect instead. render-accounts-openai.js runs served (this branch).
- NIT FIXED: the code step's cloud wording no longer points at a link before it is printed.
- NIT FIXED: while Claude is finishing (signin-completing), a cloud machine offers no link on either surface (it is
  the primary button there; a second press would start a second sign-in). The Mac keeps its fallback.
- NIT FIXED: the Settings updater fails closed when frConnActive is missing.
- NIT RECORDED: engine/connect.js still has one stuck detail saying "use Terminal" (it predates this branch); a
  cloud-machine person may read it on the stuck card. Follow-up.

## Review 3 (2026-10-26 20:1x): no blockers
- WARNING FIXED: review 2's "no link while finishing" held on first run for one paint only: the page repaints every
  second, and the repeat path called frConnPaintUrl(st.url) unchecked (the engine keeps the url in the completing
  state). The link to show is now decided once at the top of frPaintConnect (shownUrl) and used by all three paths.
  Test paints the completing state twice; the old code reds on the second.
- NIT FIXED: the comments said a second press "would start a second sign-in"; reopening the same link does not
  (Claude Code waits on the one sign-in). The true reason: the screen says it is finishing, so the link is no longer
  the next step.
- CHECKED: no other board path deletes the latch (clearStateDir's two callers only; everything else removes named
  files). A rejected code during finishing returns to signin-awaiting-code with the link, so the link comes back.
- ASSUMPTION RAISED ON THE CARD (Kitty, coordinator side): keeping the latch on Remove is safe only if the coordinator
  signs `hosted` for a computer id registered by a cloud token (`setup cloud`), never for an account. Otherwise a
  removed box signed in the ordinary way would be admitted with no Allow. Needs a coordinator-side test.
- FOLLOW-UP CARD: Remove on a cloud machine locks the person out of their board entirely (it is reached only through
  the relay); offering it there at all, or warning first, needs its own decision.

## Review 4 (2026-10-26 20:1x): CONVERGED, no blockers, no warnings
- NIT TAKEN: frPaintConnect read the cloud fact in five places; it is now read once (`cloud`, beside `shownUrl`).
- NIT TAKEN: a comment at PAGE_PLATFORM_MARKER points to its sibling inside stampServedPlatform (a test lifts it).
- Confirmed: every link-painting path uses the one decided value, and no Mac or PC path paints anything different
  from origin/main (checked spot by spot).
