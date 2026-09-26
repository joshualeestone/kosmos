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
