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
What "at launch" means. The bar takes the remembered value, then one launch round of reads per Mac host (every 2 s
for 20 s from the load): a "1" ends it at once, a "0" is applied and the round reads on to its end (it can be last
session's flag), and later loads on the same host start no new round (review 10 W2). A return to the front reads
at 6, 12 and 18 s, each applied. So the bar can change on screen once per launch, once per return and on a switch
of Mac in the page. If Tasks is showing when it leaves, the bar goes to Today and presses Today. Rejected: holding
removals while Tasks is selected (review 11 W4): it would show a tab the Mac does not have. What would change this:
per-Mac memory, or a person reporting the jump.

The bar follows the page (review 9 W1): when the address moves between sections (previous and new address
compared, replaceState included), the bar lights that section, held while a press runs or waits on a loading page,
never on the sign-in page, and it never presses. A Tasks section the bar does not offer (a project's View all
below the Tasks threshold) lights Projects and the page is left there (review 13 blocker: pressing it away made
that list unreachable). In the board's wide layout (a large iPhone in landscape) Settings opens in place and the
address keeps its earlier section, so the address cannot see that move; accepted, since the bar still names a
section the board can show.

## Validation
LogicTests (464): AppTabs order and the Tasks gate, keep() and barTab(), board names, the door script and its
answers (true only is opened; absent waits only on the sign-in host), the kapptabs and flag scripts run in
JavaScriptCore, PressTracker (presses, serials, running/pending, opened and refused answers, lock), the read rounds
(launch per host, return) and follow(). Mutants red for each guard named in the commits.
Simulator build (queued-heavy): compiles ContentView, which LogicTests cannot.

NOT checkable here, so named for the device check (Baron's TestFlight run, #6838 frames):
- whether a press on the tab already selected reaches the binding's setter on iOS 16 (review 6, review 14 W1). If
  it does not, "press Today to go back to the board's home" needs another tab first; the fix then is a UIKit
  reselect hook.
- Tasks entering the bar while Settings is selected and leaving while Tasks is selected (UIKit tracks the selection
  by position; review 5 W3).
- the first press of a signed-in launch landing on its section, through the sign-in hand-off, with the bar held
  and not flickering (reviews 5, 10, 13).
- BoardWeb's wiring: KVO on the address, barHeld with a real isLoading, the order of an answer and an address
  change (review 14 W3).
- the board's first layout in a host that starts at zero size or is hidden (review 6, N5).
- the door itself: the board side is window.kosmosAppTab in #6854 (parts a and c); the app's tests use a stub, so
  a rename there would not show here. Check after #6854 is on main.
