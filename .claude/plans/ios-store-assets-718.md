# ios-store-assets-718: iOS App Store listing assets (files only, no upload)

Card: kosmos #718 (Liu Kang m1052, step 2).

## Finished looks like
- ios/store/README.md opens with the "Josh must decide" list: account deletion (#3868) still a
  blocker, Approve/Deny (#3870) being hidden, the privacy page (#3869) resolved and removed as a
  blocker; the privacy label makes no claim that account deletion exists.
- listing.md and privacy-label.md agree with the live privacy page (read 2026-09-26).
- Screenshots at the one size an iPhone-only app needs (6.9-inch, 1320x2868, no alpha), light
  and dark, from clean seeded data: no error banners, a real needs-you question, a seeded
  conversation, a project room with posts. check-listing.sh ends VERDICT: PASS.
- Nothing uploaded to App Store Connect.

## Approach
- docs/browser-checks/mobile-shots.js (the sanctioned screenshot tool, with its leak guard) gains
  `--data store` (a tidy four-agent fleet on the same claims, so every screen's `go` works),
  `--scale device`, and an `appstore` size (440x956 @3x) outside the default sweep. The screens
  take their DM and needs-you agents from the data set (sample: ada and cleo, as before).
  The one default change is the room-posts path below, so the browser-checks slice and both leak
  arms were re-run against the changed tool (see Validation).
- The store fleet is Cleo (project manager, asks the question), Dana (writer), Eli (researcher),
  Farah (bookkeeper, idle). The board lists agents alphabetically by id (engine/status.js), so the
  asker's id sorts first and her card leads the home shot (Liu Kang m1064).
- The store set makes the sandbox look like a Mac that is set up: launch plists and worker
  folders with CLAUDE.md per agent, delivered DMs read up front (the chat screen marks them read
  mid-run, which made light and dark disagree), projects made as the screen makes them (so the
  room has no "Made by an agent or another program" line), a project description (so no
  brief-pending note), and Cleo's question tied to the project (so no "No project" tile). The one thing that
  cannot be made real is a Claude account (the leak guard forbids one), so in the page only the
  /api/status answer's `connection` is patched to connected; every other field is the board's.
- Found and fixed on the way: the harness wrote room posts to DATA/messages.jsonl, but the board
  reads store.ROOT (DATA/<app>), so no screenshot from this tool ever showed room posts.
- ios/store/shoot.sh is the one command: runs the tool in WebKit, flattens alpha, files
  screenshots/<theme>/NN-name.png. The agents-list screen was dropped: its list rows show
  "Not yet read" usage meters and truncated model names, which read as broken to a buyer.

## Validation
- shoot.sh: VERDICT: PASS (8 shots, 0 overflow, 0 errors), run behind the fleet heavy gate
  (two clear reads 60s apart, re-checked every 10s during the run).
- Same gated run, against the changed tool: the tools/browser-checks.sh mobile-shots slice
  (home, nav-menu, agents-list, settings-accounts, --strict) exits 0 with 8 shots, 0 overflow;
  the account and page leak arms each exit 3 with their own guard's message.
- check-listing.sh: VERDICT: PASS (field lengths, https URLs, no em dash, 1320x2868 no alpha).
- Every shot inspected by eye (contact sheet sent to Liu Kang).

## Weakest part
- WebKit is not the iPhone app; the shots show the board's content, not a phone.
- The connection patch is the one place the pictures show something the sandbox itself does not
  say. It shows what a set-up Mac shows, and README.md says so plainly.
- The "you" avatar in the chat is the board's plain circle, since the sandbox has no picture.
- Home shows a red "1 Issue" tile for Cleo's question; that is how the board counts a
  needs-you today.
