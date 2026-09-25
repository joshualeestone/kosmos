# #3837 F: the Kosmos+ remote bar (Josh 2026-09-25 17:21-17:22)

Josh, verbatim: "as a remote viewer on the windows, I feel like we need some way to logout, alsmot like a kosmos+ bar
across the top that lets you know you are logged in remotely and can log out", then "ya, maybe it just has a tiny
KOSMOS+ logo on the left, and a Log Out on the far right with a blue background".

## Finished looks like
Through a Kosmos+ address, a thin Kosmos+ navy bar at the very top: the real Kosmos+ mark, tiny, on the left; a blue
"Log out" on the far right. On the Mac itself, nothing. Log out ends this browser's session (the tunnel's
POST /_kosmos/logout, kosmos-relay gate-plus-3833) and shows the sign-in page; a refusal says so.

## How
- Remote is "the page's own address is not loopback": the board listens on loopback only and its Host guard refuses
  anything else unless opted in, so any other address means the tunnel. (Asked Ice Cream Kitty whether she would
  rather give the board a marker header in #3838; the hostname needs nothing from her.)
- The bar is the sticky header's first row, so it stays with it and moves nothing else; the consolidated layout makes
  body a fixed-row grid, which a new top-level element would break.
- The mark is the board's own Kosmos+ dots (plusMarkData, the Plus page's wordmark), drawn once, static, 14px high.
  No new image asset.
- Colours are the gate's own (Kosmos+ navy #17233d, line #2a3f6b, the plus-btn blue), never gold (09-16 ruling).

## Decided
- No "Connected remotely to..." words: Josh made them optional, and the bar reads as Kosmos+ by its look.
- Log out goes to "/" after the tunnel answers ok, which is the tunnel's sign-in page once the session is gone.
- Log out ends THIS BROWSER'S access to this Mac (the tunnel session), not the person's Kosmos+ sign-in. The device
  stays allowed, and if login.kosmosplus.com still holds its own session (localStorage there, another origin this page
  cannot touch), signing in again is one click. A full sign-out of Kosmos+ is the web page's own "Sign out". Rejected
  for this card: a coordinator ?signout handoff (Ice Cream Kitty's server, a deploy); proposed to her as a follow-up.
- Review round 1: the bar's side margins are read from the header's own padding (kplusBarFit), since the tab layout
  sets the right one from the scrollbar gutter; log out clears this browser's cached board page (sw.js); a 404/405
  (an older tunnel, or an owner's own proxy) says log out is not available rather than "try again";
  AbortController, not AbortSignal.timeout (Safari before 16); the region is "Kosmos+ remote session".

## Weakest premise
P7 (edge to edge on the board and the talk view) passes, but this Mac's headless run shows no gutter mismatch either
way, so it is a guard of the outcome, not a reproduction of the review's Windows case.

Ships only with a tunnel that has /_kosmos/logout (kosmos-relay gate-plus-3833). A board on this change behind an
older tunnel would forward the POST to the board, which refuses it, so the bar says "Could not log out just now":
wrong but safe. The two ship together in the next Mac app build.

## Verification
render-plus-bar-3837: P1 (no bar on loopback, the control) to P6, 11 pass.
