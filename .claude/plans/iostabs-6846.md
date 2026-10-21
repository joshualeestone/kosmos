# iostabs-6846: the iPhone app's native tab bar (#6846, part b)

Stacked on nativeagents-6838 (#6845, slice 1). Part a (#6848) gave the board `window.kosmosAppTab(name)`; part c
(#6854) hides the board's own navigation when the page's root has class `kapptabs`.

## Finished looks like
The app's bar has Today, Agents, Projects, Tasks, Settings (sun.max, person.2, folder, checklist, gearshape), Tasks only
once the Mac's status says `tasksTab`. Agents is the native list. The other four show ONE web view (never one per tab):
pressing one of them asks the board, without a reload, to open its section (Today = the board's home, `agents`). The
board inside the app shows no tab strip of its own, because the app marks every page it loads with `kapptabs`.

## Steps
1. ShellLogic.swift (`AppTabs` and `PressTracker`, tested on a Mac): the tab list in order with titles and symbols
   (the bar is built from it), which tabs show for a tasksTab value, each tab's board name, the JS that calls the door
   and answers opened / refused / absent (a door that throws is refused), what each answer does (afterAnswer), the
   press and Tasks-read bookkeeping (PressTracker: which press an answer belongs to, what waits for a load, which
   read round runs, what a lock resets), and the document-start script that adds `kapptabs` once `document.documentElement` exists (the part c harness showed an
   init script can run before <html> exists).
2. Tasks source: the board page's own flag (localStorage `kosmos.tasksTab`, written by tskTabGate from every status
   poll, per Mac), read through the web view. NOT the native client: it polls only while Agents is on screen
   (AgentsView start/stop), so a person living in the web tabs would never see Tasks arrive.
3. ContentView: one `BoardWeb` holder (a StateObject) owns the one WKWebView and its coordinator; each of the four web
   tabs hosts a container view, and the selected one adopts the web view (reparenting), so switching never reloads
   and sign-in carries. A press on a web tab runs the door through evaluateJavaScript and does what PressTracker says
   (never a reload: the page may be the sign-in page or an older board).
4. Tasks in the bar: applied only at launch and on return to the front (Mona Lisa, #6846). "Launch" is the remembered
   value (UserDefaults) plus the first page read of the launch that answers (the sign-in page does not). The board
   writes its flag only when its first status poll answers, after the page has loaded, so the app reads again every
   2 s for 20 s after a load until a read answers (review 3). A relaunch's first read is the board's stored value
   from last time. After that only a return from the background changes it. If Tasks is selected and leaves the bar (another Mac), the app goes to Today.
   A press before the page can take it (web view not made, or loading) waits and runs when the page finishes. The
   tracker must see the press before BoardWeb looks for a web view (review 5 BLOCKER: the other order dropped the first
   press of every signed-in launch, which opens on Agents, so no web view exists yet).
   A press on the selected tab, where SwiftUI reports one, presses again: back to the section's top (iOS convention).
5. Agent taps (Agents list, notifications) go to Today, as Board did. Not signed in opens on Today (sign-in is there).
   The store-shots build lights the tab its address belongs to (a project room under Projects).

## Decisions
- Reparenting rather than a web view layered under a TabView with clear pages: TabView page backgrounds and hit-testing
  are not ours to rely on; one container per tab and a moved WKWebView is deterministic.
- On lock (biometric gate, off by default) the holder drops its web view, as the old view's teardown did, so an unlock
  starts clean.
- A Mac whose board predates the door answers absent to every press, so the press waits at every load and the bar
  can name a section the page is not on. Accepted for Macs not yet updated: the door ships with this release.
- A store-shots build opened on a ?tab=tasks address lights Today until a read lands, since a fresh simulator has no
  remembered flag (review 8). No current store shot uses Tasks; one that does needs the flag seeded first.
- No Today badge in this part (the card calls it optional; needsYou is already in the client).
- A refusal puts the bar on the tab of the section in the page's address (review 4: not the bar's previous tab, which
  can have moved without the page), so never on Agents (review 3 BLOCKER: from Agents every web tab would be refused
  in turn while the box refusing them sits out of sight). AppTabs.afterAnswer, tested.
  Every press and every drop take a serial, so a late answer to an older press cannot end or move a newer one; a
  door that throws counts as refused.
- The press answers three ways (review 2): opened; absent (no door: the sign-in page, an older board, or an error
  mid-navigation), which waits for the next load; refused (the door said no because a box or a full-screen step is
  up, the backdrops .rm-back/.fr-back/.frc-back, NOT a chat: review 2 read rm-back as a chat's back button, it is the
  modal backdrop), which ends the press and moves the bar as above. Rejected: keeping a refused press pending, which fired later on an unrelated reload,
  and loading ?tab= over the box, which would throw away the box the person had not answered.

## Weakest premise
What "at launch" means. The bar takes the remembered value, then the first page read of the launch that answers, in
either direction. Usually that is the first seconds, but after a late sign-in it can be minutes in, so the bar can
change on screen once per launch (review 1, N3). If Tasks is showing when it leaves, the app goes to Today and presses
Today, so the board follows. Rejected: holding the first read to the next return, which leaves an earned Tasks out of
the bar for a first launch's whole session. What would change this: per-Mac memory, or a person reporting the jump.

Also: in the board's wide layout (a large iPhone in landscape) Settings opens in place and the address keeps the
section it was on, so a refusal there puts the bar on that section instead of Settings (review 5, N3). Accepted: a
refusal needs a box up, and the bar still names a section the board can show.

## Validation
LogicTests: AppTabs order and the Tasks gate, keep(), board names, door JS text, answer reading (true only), the
kapptabs script text, the page flag reading ("1"/"0" only). The kapptabs and localStorage scripts run in a real JS engine
(JavaScriptCore on the Mac) where they can, not only as text. Mutants: a tasks gate that always
shows; an answer reader that takes non-nil as opened. Simulator build (queued-heavy). NOT checkable here, so named for the device check: Tasks entering the bar while
Settings is selected and leaving while Tasks is selected (UIKit's tab bar tracks the selection by position; review 5
W3), the first press of a signed-in launch landing on its section, whether a press on the selected tab is reported
(review 6), and the board's first layout in a host that starts at zero size or is hidden (review 6, N5).
Return reads: at 6, 12 and 18 s after a return, each applied, since the first can predate the board's next poll
(review 6 W1); a launch round ends at its first answer. The page state a press sees (none / loading / ready) is
decided in PressTracker, so its rule (a press with no web view waits) is tested; BoardWeb's call order (it must ask
the tracker before it looks for a web view) is NOT, and is checked on a device (review 7 W2). Real-device check is Baron's
TestFlight run (#6838 frames).
