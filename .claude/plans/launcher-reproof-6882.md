# launcher-reproof-6882: the Windows board window proves the board again before it reuses its sign-in

Card: #6882 (#6464 ask 3).

**Posture:** production

## Change
- tools/windows/KosmosLauncher.cs
  - `BoardProof.Check` says how a proof came out (Proves, NoListener, NoAnswer, NotProven); `Holds` is `Check == Proves`,
    so every other caller is unchanged. `TaskbarBadge.ReadBoardTokenState` tells no token from an unreadable one
    (as tools/kosmos-open-board.js since #6464); `BoardTokenOnDisk` makes an unreadable board.token an enforcing
    board in the window's three fallbacks too.
  - `CheckBoardBeforeReuse` (a fresh token read and a fresh proof) and `CheckBoardPatiently` (waits out nothing
    listening or an unreadable token up to the opener's 20 s board wait), with pure rules: `NavigationDecision`,
    `MayNavigateSignedIn`, `MayKeepPageOpen` (more patient when the page asked, #6512), `WatchShowsNotConfirmed`
    (a non-proving answer at once, 3 no-answers in a row), `IsReloadKey`, `CouldNotReachBoard`, `IsSignInLoad`,
    `SameDocument`.
  - The window:
    - navigations it starts itself are proved BEFORE they start (`CheckNavigationAgain`): a crashed page's reload
      (`OnProcessFailed`), F5 / Ctrl+F5 / Ctrl+R / Refresh (`OnAcceleratorKeyPressed`, new COM), a failed board load's
      one retry when nothing answered it, a sign-in that came back after a failed check;
    - ordinary sign-in loads are proved by the opener a moment before and are approved past the quick check
      (`signInLoadApproved`), since a ?boot= code is single-use;
    - every board navigation is held in `OnNavigationStarting` until a check says its page may be shown (quick check
      on the window's thread, 1.5 s; else the full check off it, then the navigation is re-issued); refused outright
      while the window is not on a board visit (Back to a board page under NotConfirmedPage);
    - `SignInAgain` with no ?boot= answer checks before leaving the open page talking to the port;
    - `WatchBoard` on the badge's 10 s timer covers the page's own polling;
    - `RecoverBoard` signs the window back in by itself once the board proves again (capped at 3 until a board read);
    - `boardVisit` drops answers that land after the window moved on.
  - Wording: NotConfirmedPage and BrowserNotConfirmedMessage say "Kosmos could not sign you in to your own Kosmos",
    true of the opener's refusal, a failed mint (#6464), an unreadable token (#6464) and a failed re-check.
- tools/windows/Kosmos.exe rebuilt from the source with the README's csc flags and signed with this box's signing
  wrapper (Kosmos Agent Manager, Inc.); verify-launcher.ps1 OK.

## What was measured, and what it changed (the weakest premise, found wrong)
The first design held every board navigation in NavigationStarting and assumed WebView2 waits for that handler before
the request leaves. The live rig showed it does not: for a page-started navigation, a Reload, and the window's own
Navigate, the request reached the listener before (or at the same millisecond as) the window's check. Cancelling there
stops the page being SHOWN, not the request leaving. So:
- the reloads the window starts itself now prove before they start;
- the NavigationStarting check is documented as a guard on what is shown;
- sign-in loads are no longer held and replayed (a replay carries a spent ?boot= code: measured live, round 4's build
  never signed in against a board slower than 1.5 s; the final build does).
Accepted, documented: a navigation the page or WebView2 starts (a link, the page's own reload, right-click Reload, Back,
Forward) sends its request before any check. What it carries is a board session; a squatter can only take the port
once the board has stopped, which ends every session (#6449), so the cookie is already dead. The page shown under
the Kosmos title is what the check guards, and the live rig shows it is never shown.

## Decisions
- Quick check on the window's thread (1.5 s), full check off it with the opener's own budgets (7.5 s proof, 20 s
  board wait). Rejected: a synchronous 3 s check refusing on no answer (review round 1: a busy board would lock the
  person out). Would change if WebView2 gave NavigationStarting a deferral.
- Nothing listening is refused for a navigation only after the full check has waited it out; a page-asked sign-in and
  the watch are patient with no answer, a double-click is not. Weakest part: the 3-no-answer watch is a heuristic; a
  board stalled 30 s is taken off screen (and RecoverBoard brings it back once it proves).
- F5 and friends are taken from WebView2 and replayed as a Reload after the proof. Ctrl+R needs Alt up (AltGr+R types
  a character). Back/Forward keys are not taken: the board's history is mostly same-document.
- Not done here: WebResourceRequested-based per-request gating (would hold every request, including the page's fetch
  polling, before it leaves). It needs a larger COM surface and a per-request cost; follow-up.

## Verified on the Windows box
- Signature Valid, signer Kosmos Agent Manager, Inc.; verify-launcher.ps1 OK on the committed pair.
- Tests (schtasks-blocking preload): tools.win-launcher-reproof-6882.test.js, every arm run red with its fix reverted
  (58 single reverts across nine mutation runs, each caught by at least one test); against origin/main's launcher 8 of its source tests fail and the
  probe does not compile.
- tools/windows-tests.js (every win32/windows test file, preload on) on the branch and on a clean origin/main worktree:
  the same 5 non-passing entries on both (setupsettings.fsync-5434 red on this box, and 4 e2e files ALL_SKIP_OK calls
  stale because this box has agy and codex installed); branch 193 files passing, main 192 (the new file).
- Live rig (a stand-in board on port 16299 speaking the real proof, nonce and ?boot= protocol, that turns into a squatter
  on the same port; the built zip's Kosmos.exe --window in its own LOCALAPPDATA, WebView2 profile and data folder;
  never port 16180 or the installed copy), new build vs origin/main's exe:
  - crashed page, squatter: new sends nothing to the squatter and shows NotConfirmedPage; main reloads onto the
    squatter with the session and shows the squatter's page under the Kosmos title.
  - crashed page, healthy board: new proves, then reloads onto the board.
  - page-started link / reload, squatter: both send the request (measured, accepted); new shows NotConfirmedPage,
    main shows the squatter's page.
  - page polling, squatter: new stops the page within one watch tick (0 polls 15 to 30 s after), main kept polling the
    squatter with the session (7 polls 15 to 30 s after). Board back: new signs itself in again, main never does.
  - board slower than the quick check: the final build signs in normally.
- F5 live: injected key input cannot reach a window on this box (no foreground window on the desktop; posted key
  messages bypass WebView2's accelerator path, measured with an instrumented build). F5 is covered by source tests,
  the header-checked COM declarations and the IsReloadKey probe; the healthy-board crash reload shows the
  prove-then-Reload path works live.

## Deferred
- A same-window navigation to 127.0.0.1 on ANOTHER port carries the live session cookie before the link rules cancel
  it (pre-existing; SameSite ignores ports). Follow-up: strip the cookie for other loopback ports
  (WebResourceRequested) or never render such links.
- Per-request gating of the page's own fetches and navigations (WebResourceRequested).

## Review rounds (fresh blind reviewers)
1. 5 findings (busy board locked out by a sync refusal, page-asked sign-in too strict, late answers, dropped
   double-click, watch evasion by stalling): all fixed.
2. 5 findings (deferred navigation dropped across visits, restart treated as final, token held by antivirus,
   re-issued Navigate semantics, double-click sign-in thrown away): 4 fixed, 1 documented.
3. 3 findings (page-asked sign-in after a failed check dropped, fragment reload no-op, no self recovery): all fixed.
4. Live rig then showed WebView2 sends requests before NavigationStarting; crash reload and reload keys reworked.
   2 findings (Back to a board under NotConfirmedPage, AltGr+R): fixed.
5. 3 findings (context-menu reload claim, spent ?boot= code replayed, failed load stuck on error page): 2 fixed,
   1 documented (comments corrected).
6. 3 findings plus 1 pre-existing gap (retry once per life, stale comments, watch over a Kosmos Plus page): fixed;
   the gap deferred.
7. 3 comment findings: fixed.
8. 4 findings (unreadable token in fallbacks, waiting navigation over a Kosmos Plus page, late sign-in unproved,
   download retried): all fixed.
9. 2 findings (fragment compare, replayed sign-in approval): fixed.
10. NOTHING ACTIONABLE.
