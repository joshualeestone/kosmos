# agy-signin-3998: Gemini "Sign in with your Google subscription" without a terminal

Card #3998 (Josh, 2026-09-26 11:27 to 11:34). On Mac 0.6.97 the sign-in opened a raw Terminal running agy: a "Select login method" menu, then a copy-paste code, then three setup screens (colour scheme, Terms & Data Use with an optional data-sharing checkbox, and "Do you trust /Users/joshua"). Josh got stuck at the code.

## What finished looks like
Pressing "Sign in with your Google subscription" in Kosmos opens only Google's page in the browser. Kosmos's own panel shows a box to paste the code Google shows, then finishes by itself: the setup screens are handled without the person, the optional data sharing is never ticked for them, agy never runs in (or trusts) the home folder, and the panel ends on the same gold connected box GPT and Grok use. No Terminal window and no "Check again".

## Scope split (decided)
- PR 1 (this plan): the hidden sign-in and the gold connected box.
- PR 2, same card: the Gemini subscription account row in Settings > AI Models (email/plan if agy exposes them, status dot, Sign in again, Remove). Separate so the sign-in, which is what blocks Josh, ships first and reviews faster.

## What agy offers (measured read-only, agy 1.2.11, 2026-09-26)
- No login subcommand, flag or environment switch (`agy --help`; binary strings). Its changelog adds pasting the code via /dev/tty in print mode and says truly headless runs fail fast. So the sign-in has to be driven through a terminal Kosmos controls.
- agy opens the browser itself ("Your browser should open automatically. If not: <url>"), so a hidden session still shows the person Google's page.
- Settings: `~/.gemini/antigravity-cli/settings.json` holds `trustedWorkspaces`; `jetski_state.pbtxt` records `completed_steps`. Not written by Kosmos (another program's state; a keystroke on a recognised screen is reversible and visible, a file edit is neither).

## Design
- `engine/agysignin.js`: one sign-in session at a time. agy runs inside a detached tmux session on its OWN socket (`-L kosmos-agy-signin`), so it never appears among agents, in a Kosmos-owned folder (never HOME). A 1 s loop reads the screen (`capture-pane -p`) and moves a small state machine; each step is recognised by the exact words on Josh's screenshots:
  - "Select login method" with "> 1. Google OAuth" selected: Enter.
  - "Your browser should open automatically": state `code`; the URL is kept so the panel can offer "Open Google's page again".
  - The person pastes the code in Kosmos: typed into agy literally, then Enter.
  - "Choose your color scheme": Enter (its default).
  - "Terms of Service & Data Use": the cursor starts on "Previous", so Kosmos moves to "[Done]" and checks the marker is on it before Enter. The optional data-sharing box is never ticked; the panel says so and links Google's terms and privacy policy (the person can opt in later in agy's settings).
  - "Accessing workspace ... Do you trust": only if the folder shown is Kosmos's own sign-in folder; then "Yes". Any other folder: stop, never trust it.
  - agy's ready screen, or `agystatus.check()` answering signed in: done; the tmux session is closed.
- Anything unrecognised for more than a few seconds: state `stuck`; the panel offers "Show the sign-in window", which attaches a Terminal to the hidden session so the person can finish by hand (Josh's last resort, item 3). Stop ends the session.
- Routes: `POST /api/antigravity/signin` (start), `GET .../signin` (state), `POST .../signin/code`, `POST .../signin/show`, `POST .../signin/stop`. The screen polls the state while the panel is open.
- Page: the Gemini subscription panel shows "Opening Google's sign-in in your browser", then the paste box (the #3942 code-box style), progress for the setup steps, and on success the gold connected box (#3731's pattern) instead of the plain "Ready." line.

## Testing
- A fake agy script that prints the same screens and reads keys, driven through a real tmux on a private socket, exercises the whole state machine end to end (including the terms cursor, the trust-folder refusal and the stuck fallback).
- Browser check for the panel states. Josh confirms on his Mac (his agy is signed in now, so the live run is his next sign-in or a fresh Mac).

## Weakest premise
That the screen wording on Josh's 11:27 to 11:33 screenshots is stable across agy updates. Mitigated by the stuck fallback: an unrecognised screen shows the window instead of hanging silently.

## Card items added 11:48 (Josh) and folded in at Splinter's 12:04 ask
- The key-based option in the create-agent and agent-detail provider menus reads "Google Gemini (API key)" beside "Google Gemini (Google subscription)". Settings' Add a provider keeps "Google Gemini": it asks key or subscription on the next step.
- The Gemini subscription account row in Settings > AI Models is now in this branch too (Splinter, 12:04: build it now rather than a second PR).

## The Gemini subscription account row (built in this branch)
- engine/agystatus.js remembers its last CONFIDENT answer (signed in, or not installed) at <store.ROOT>/agy-signin/last.json; "could not confirm" never overwrites it. A live check costs a prompt on the person's subscription, so the row never runs one per repaint.
- /api/accounts appends a row for it (provider google, authMode 'antigravity', dir null, the Google email from ~/.gemini/google_accounts.json "active" if present) while it is offered and last known signed in.
- The row: the email (or "Google subscription"), "Google subscription, through Antigravity on this computer", Signed in, Sign in again (Add a provider on Google Gemini straight to the hidden sign-in) and Remove (two presses; POST /api/antigravity/forget; Kosmos stops listing it and Antigravity stays signed in, said in its title, since agy has no sign-out command Kosmos can call).
- Not shown: the plan tier Josh saw in agy ("Antigravity Starter Quota"). Kosmos has no readable source for it yet; showing a guess would be worse than not showing it.

## Review round 2 (decided, 12:45 to 13:20)
- The subscription row is provider 'antigravity' (grouped under Gemini by providerName), and the page's acctProvider names any authMode 'antigravity' row 'antigravity' too. Rejected: keeping 'google' and filtering authMode at each key path (five sites today, and the next key path would not know to filter). Weakest premise: a consumer outside the page that lists /api/accounts by provider; the only one found is the agents' own instructions (engine/connections.js), updated.
- agy is asked whether it is signed in at most 3 times a sign-in (MAX_CHECKS), at once after the setup screens, after 8 s on any other unknown screen (so Sign in again on an agy already signed in finishes), and while stuck only when the screen changed and 8 s since the last ask. Stuck never flips back by itself.
- Each key once on the terms (Down only after the marker moved), a missing Done is shown (stuck), not ended.
- The code screen still showing 15 s after a code: back to the paste box with "did not take that code".
- Only a missing tmux session is agy exiting; a slow tmux is tried on the next tick.
- start() answers an id; code, show and stop must name it (409 otherwise), and a screen following a sign-in stops following when the id changes.
- The row shows the muted signed_in_unverified "Signed in" (a remembered answer), only while agy is installed; Remove arms like Disconnect (danger style, aria-label, blur disarms); its hover says it comes back on Kosmos's next check.
- The tmux server starts with -f /dev/null and the agy path is shell-quoted.
- Not done (nit N1): no browser check renders the Settings row itself; web.agy-row-3998.test.js executes the page's own key-path functions on it instead.

## Review rounds 3 and 4 (decided)
- Nothing throws out of the 1 s timer (the board has no uncaughtException handler): a key that did not go out is pressed again next tick; 5 in a row shows the window.
- A test process never reads or writes the real remembered sign-in (store.ROOT/agy-signin/last.json): only a file a test set with setLastFileForTests. The stray file earlier test runs wrote on this Mac was removed. "Not offered" is not remembered.
- No email on the row: ~/.gemini/google_accounts.json is the Gemini CLI's own sign-in, and Antigravity keeps no account file Kosmos can read. Weakest premise: a future agy may add one; then the row can name it.
- The code is typed only when the screen shows agy's code prompt right then (not on the state alone). The "did not take" retry waits 20 s.
- Once the window is shown, Kosmos presses nothing; it watches for agy exiting or its ready screen. The ready screen ("(… Quota) - Gemini") earns one confirmation even when the other asks are spent.
- The screen is the one whose words appear last on it, and the marker read is the last one; terms press Enter only on "[Done]".
- The tmux socket is named after this board's folder (two boards on one account never share a sign-in).
- Routes: a stale sign-in id is 409 on code, show and stop; an unknown sub-address is 404.
- Page: leaving while the start request is out stops the sign-in it began; the status line is rewritten only when its words change (a live region re-reads every write).
- Left: N6's cleanup nit (tests reset the module anyway).

## Review rounds 5 and 6 (decided)
- After Show, Kosmos types no code and presses no key on a screen it knows; `shown` is set before the window opens (an `open` that times out after Terminal came up must not leave Kosmos pressing keys). A screen it does not know is still asked about within the bounded asks, so a finish on an unfamiliar ready line is confirmed. The panel then says the window is open and offers no second one.
- The paste box is focused when it appears and again only when a code comes back refused, never on every poll (round 5's version pulled focus back every second: a keyboard trap).
- A refusal of what was pasted stays on screen until the person types again.
- Only the trust screen (the last setup screen) counts as settled for an immediate ask; between theme and terms an unknown redraw waits like any other.
- An answer that is not a state reads "Waiting for Kosmos to answer".
- Left, documented: the "did not take that code" retry trusts the code screen's words being the last on screen (real agy may print under its prompt; unmeasured, Josh's run will show); tmux calls are synchronous with a 5 s cap; a board restart mid-sign-in leaves the private session until the next start kills it.

## Review rounds 7 and 8 (decided)
- Surface-gate trailers name the check WITH ".js" (the gate matches the file name).
- A Down counts against the terms screen's moves only once it went out; a refused code is counted (status().refusals), so every refusal brings the cursor back.
- Nothing is asked of agy before it has drawn a screen Kosmos knows: a signed-out check can open a second Google page. An unknown first screen is shown instead; an already signed-in agy is its ready screen.
- Marker checks are anchored to the marked item ("> [Done]", "> 1. Google OAuth", "> Yes"); a screen that comes back more than 3 times is shown, not driven round.
- A row hidden with focus in it moves focus to Stop (or the step); the Settings browser check asserts focus stays inside the dialog.
- The tmux socket is named after the macOS account's home, not the Kosmos folder: one agy sign-in per account, so a switch between Kosmoses cannot orphan it. The remembered row stays per Kosmos (it is that Kosmos's last check); weakest premise: after a switch, the other Kosmos shows the row only once it has checked agy itself.
- An unconfirmed ready screen says the sign-in could not be confirmed. Kosmos's own refusal of a paste shows before Antigravity's older reason.
- agystatus.test.js sandboxes the data root before requiring anything; scripted engine tests use their own temp folders.

## Review rounds 9 and 10 (decided)
- Every check's promise chain ends in a .catch (nothing a callback throws escapes; the board has no process handler).
- agy is asked whether it is signed in only after the person's code went in (steps code-sent, theme, terms, trust) or when the person drives the shown window: a signed-out agy asked may open a Google page of its own. agy exiting before a code ends the sign-in as not finished, without asking.
- A window that failed to open (not a timeout) is said, and Show is offered again; Kosmos still presses nothing once Show was asked for.
- The row's hover says what is true of it: Kosmos does not recheck it by itself; Sign in again checks it. Weakest premise: a revoked Google sign-in shows as signed in until the next Sign in again (ageing the row is a possible follow-up).
- A blank redraw frame is not a new screen (no second key); a second Continue press while a code is out is ignored; tmux's path is looked up once per sign-in; tests use their own temp folders.
- Left: the session name is one per account (two boards signing in at once on one account could drive each other's session; the trust check fails closed).

## Review rounds 11 and 12 (decided)
- Sign in again waits for the availability read itself (up to 3 s), refuses where the subscription is not offered, and starts nothing if the dialog was closed or switched meanwhile.
- Only a different KNOWN screen is a new screen: a blank or half-drawn frame keeps the last known one, so a key is never sent twice (a second Enter on the terms could otherwise answer the trust question unchecked).
- A folder Kosmos did not choose is left to the person (stuck, window offered) instead of ending a sign-in Google may already have saved; still never trusted, never pressed. The folder is read without a box border, and "~" means the home folder.
- A code is typed after C-u, so a half-sent earlier try is cleared, not doubled.

## Review round 13 (decided)
- A test process is recognised two ways before the real remembered sign-in could be touched: execArgv's --test and the test runner's NODE_TEST_CONTEXT (bulletin runtime-self-detection-is-version-dependent).
- agy is taken as exited only after two missing-session readings in a row (one failed has-session can be a hiccup).
- The final .catch of an ask marks the sign-in stuck rather than leaving the state stale.

## Review round 14 (decided)
- Only a failure that proves a key never went out (a spawn error) re-arms it; a timeout (delivery unknown) does not, and the same-screen rule shows a screen that did not move.
- The trust folder read is the LAST "Accessing workspace:" on screen (whose Yes is marked), the newest-wins rule.
- An unknown screen is asked about only after a setup screen (theme, terms, trust) showed Google took the code; agy exiting after the code is still asked.
- The subscription row's "why" is also in visually hidden text (a title is mouse-only).

## Review round 15 (decided)
- The sign-in start route (and the GET state, /api/antigravity GET and /forget routes beside it) catch a synchronous throw and answer 500: the board has no process-level handler. The live-execution gate's test-process throw stays loud.
- A failure finding tmux (Kosmos's own work) is marked and read as "try again", never as agy exiting.

## Review round 16 (decided)
- An unknown screen is asked about only after the trust question (the last setup screen) was answered (narrows round 14): a yes after theme or terms would end the sign-in with the setup unfinished, and the next agent would stop on the terms. The ready screen, agy exiting after a code, and the shown window still end it.
- A terms Down marks the marker line before it is sent, so a Down that timed out is not sent again.
- Left: a torn first frame of the trust screen (question drawn, folder not yet) goes stuck and stays shown; it fails safe and agy prints the path first.

## Review round 17 (decided)
- "No proof file" is not a finding at this stage: the proof is written when the loop converges.
- One log line per sign-in end (state, reason, step) and when tmux keeps failing; never the code or the screen.
- The trust step is set only after its Enter went out, so no ask (and no done) with the trust question unanswered.
- The remembered sign-in lives in <ROOT>/agy-account/last.json, apart from the sign-in's throwaway workspace (<ROOT>/agy-signin), whose window script is removed when the sign-in ends.
- The dead 404 after the sign-in routes is gone; NOT_CONFIRMED sits with UNKNOWN.

## Review round 18 (decided)
- agy returning to its login menu after a code (refused, or any step after the code) starts the sign-in over, so the next code screen asks for a code again instead of sitting on "checking" for half an hour.
- A new start stops only a sign-in still running (no false "ended stopped" log line after a finished one).
- The route's catch for a throwing start() is tested by making start() itself throw (exactly 500).
- The paragraph around "Open Google's sign-in page again" hides with its link.

## Review round 19 (decided)
- agy exiting before the trust question now ends failed ("closed before its setup finished") without asking, the same gate as the unknown-screen ask (round 16): a yes there would have ended the sign-in done with the setup unfinished. Weakest premise: a person whose Google sign-in did save must press Sign in again; that is the safe side.
- Back at the menu, the step starts over too (step and code time cleared), so a stale trust step cannot make an exit at the menu read as after the setup (tested with the marker off Google OAuth, the case where no Enter re-sets it; fails with the reset removed).
- The revisit and terms-Down caps are named constants (MAX_VISITS, MAX_DOWNS).
- readyCheck's last-resort catch uses the ready screen's own reason (NOT_CONFIRMED).
- Sign in again's click catches a throw and says so in the step.

## Review round 20 (decided)
- A blank frame is never asked about, and after Show only the same unknown frame on two ticks in a row is (the person's keys make agy redraw; a yes on a passing frame mid-setup ended it done and closed their window). Rejected: also refusing asks while the last known screen is theme or terms; that would never confirm a sign-in the person finished faster than one tick per screen (round 6 test). Weakest premise: agy's redraws settle within a tick.
- agy's ready line drawn under theme, terms or trust before the trust step is that setup screen, not the end (a status footer). After trust, words left above the ready line still do not hold it up (round 4).
- The trust answer is pressed only on the measured label "Yes, I trust this folder"; a broader Yes falls through to stuck.
- onReady is called through a caught promise.
- Kept: the trailing return in the signin route. Every sub-address returns above it, so it is unreachable today, but it keeps a future fall-through from reaching the routes below (fail closed).

## Review round 21 (decided)
- render-settings-agy-3874's surface annotation names the new paste and page ids the check asserts on, so a later edit to them must touch this check (the #2518 precision gate). Not added: acct-success-box, shared by five provider checks and annotated by none; claiming it here would force unrelated cards through this check.
- tmux's stderr is piped, not inherited, so the speculative kill before each start is no longer a raw error line in the board's log.

## Review round 22 (decided)
- While Kosmos drives the setup (a step taken, window not shown), agy's ready line counts only on its own and steady: over any other known screen (the code screen still drawn under it) it is that screen, and a footer caught alone must be the same frame on two ticks in a row before agy is asked. A sign-in that starts on the ready screen (already signed in, no step yet) and the shown window are unaffected. Weakest premise: agy does not leave its footer alone on screen for a whole tick between two setup screens.

## Review round 23 (decided)
- One rule (underReady) for the screen under agy's ready line, used by the tick and by code()'s last look before typing: the code screen with the footer under it takes a pasted code, as the panel shows it waiting for one. After trust the rule gives nothing, so a code is still never typed on agy's own ready screen (tested).
- The hidden terminal's size is named (PANE_COLS, PANE_ROWS).
- Left: the page's 3 s availability wait and 1 s follow poll stay inline, as the page's other drivers write theirs.

## Review round 24 (decided; a rethink, not a patch)
- Rounds 20, 22 and 23 were built on a premise nobody has observed: that agy draws its ready line as a footer under a setup screen. Josh's screenshots show that line only on agy's ready screen. Round 22's "any known screen under it is that screen" made the code screen's leftover words (round 4's words-left-above case) read as the code screen, so a second code could be typed onto agy's ready prompt, and the retry said the first code was refused.
- Decided: only theme, terms or trust under the ready line (before trust) is that setup screen (round 20, the case where "done" would come early). The code screen or menu under it is the READY screen, in the tick and in code() alike, so code() never types there (reverses round 22 and round 23's acceptance).
- The one-tick steadiness before asking (round 22) compares the ready line itself, not the frame: a spinner or tip beside it no longer holds the sign-in for 30 minutes.
- In the shown window, a ready screen that could not be confirmed is asked again, STUCK_MS apart, at most MAX_CHECKS times in all (the first included), so "Kosmos notices when you are done" is true.
- Every failure at the tmux/open boundary is logged (start, the code send, the window script, open), never the code itself. The code and stop routes answer 500 with their own words on a throw.
- Scripted tests set the real tick interval out of the way (tickMs), so only their own ticks run.
- Weakest premise now: agy never draws its ready line alone for a whole tick between two setup screens (then a yes would end it before terms and trust); the steadiness tick guards the passing frame.

## Review round 25 (decided)
- Once the window is shown, the half-hour give-up counts from the last time its screen changed, so a person still working in it is never cut off; a shown window left unchanged for over half an hour still ends. Not shown, it counts from the start as before.
- Left: the first-run paste box and Show row have no browser check of their own. They are the same agySubDriver the Settings browser check drives end to end in a real browser (render-settings-agy-3874), and web.agy-on-3568.test.js covers the first-run markup; a first-run browser check is a follow-up, not this card.

## Review round 26 (decided)
- Leaving the step (closing the dialog, switching provider, cancelling first run) no longer stops a sign-in whose window the person has open; the engine ends it after half an hour with no change there, or two hours after Show.
- Terms: no key until the marker is drawn on one of the terms' own lines (a half-drawn frame sent a Down, and the full frame a second).
- A code still on agy's prompt is being checked: read as refused only after 90 s (an empty prompt still after 20 s), and code() never types over it. Weakest premise: agy clears its prompt when it refuses a code; if it leaves the code there, a refusal shows after 90 s instead of 20.
- A shown window ends two hours after Show however busy its screen is (a spinner counts as a change).
- One budget: repeat ready-screen asks spend MAX_CHECKS with unknown screens; the stated total is MAX_CHECKS + 2 (the first ready look and one on exit).

## After convergence: CI on the merge with main (decided)
- #3957's route check (added to main after the branch's validation) counts only exact path comparisons and forbids startsWith route families. The sign-in route is now four exact comparisons; an unknown sub-address falls through to the board's own 404. Rebased onto main; the diff changed, so validation and a review round run again before the proof is rewritten.

## Review round 28 (decided)
- Stop this sign-in stops it even with its window open (a driver stop(), used by both Stop buttons). Round 26's leave-it-running applies only to the passive ways out: closing the dialog, switching provider, cancelling first run.
- The code prompt is read on its own line and the next (where agy shows what is typed), not from anything drawn further down, so a hint under an empty prompt is not a held code.
- The tmux call and `open` timeouts are named (TMUX_CALL_MS, OPEN_MS); the engine tests remove every temp folder they make.
