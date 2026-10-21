# iostabs-6846: the iPhone app's native tab bar (#6846, part b)

Stacked on nativeagents-6838 (#6845, slice 1). Part a (#6848) gave the board `window.kosmosAppTab(name)`; part c
(#6854) hides the board's own navigation when the page's root has class `kapptabs`.

## Finished looks like
The app's bar has Today, Agents, Projects, Tasks, Settings (sun.max, person.2, folder, checklist, gearshape), Tasks only
once the Mac's status says `tasksTab`. Agents is the native list. The other four show ONE web view (never one per tab):
pressing one of them asks the board, without a reload, to open its section (Today = the board's home, `agents`). The
board inside the app shows no tab strip of its own, because the app marks every page it loads with `kapptabs`.

## Steps
1. ShellLogic.swift (`AppTabs`, tested on a Mac): the tab list in order, which tabs show for a tasksTab value, each tab's
   board name, the JS that calls the door (`typeof window.kosmosAppTab === 'function' && window.kosmosAppTab('<name>')`),
   the reading of its answer (opened only on a real `true`; false, nil, a non-Bool or an error is "not opened"), and
   the document-start script that adds `kapptabs` once `document.documentElement` exists (the part c harness showed an
   init script can run before <html> exists).
2. Tasks source: the board page's own flag (localStorage `kosmos.tasksTab`, written by tskTabGate from every status
   poll, per Mac), read through the web view. NOT the native client: it polls only while Agents is on screen
   (AgentsView start/stop), so a person living in the web tabs would never see Tasks arrive.
3. ContentView: one `BoardWeb` holder (a StateObject) owns the one WKWebView and its coordinator; each of the four web
   tabs hosts a container view, and the selected one adopts the web view (reparenting), so switching never reloads
   and sign-in carries. A press on a web tab runs the door through evaluateJavaScript; "not opened" leaves the page as
   it is and logs (no reload: the page may be the sign-in page or an older board).
4. Tasks in the bar: applied only at launch and on return to the front (Mona Lisa, #6846). "Launch" is the remembered
   value (UserDefaults) plus the first page read of the launch that answers (the sign-in page does not), so a first
   launch on an earned Mac can grow the bar once in its first seconds; after that only a return from the background
   changes it. If Tasks is selected and leaves the bar (another Mac), the app goes to Today.
   A press before the page can take it (web view not made, or loading) waits and runs when the page finishes.
5. Agent taps (Agents list, notifications) go to Today, as Board did. Not signed in opens on Today (sign-in is there).
   The store-shots build opens on Today.

## Decisions
- Reparenting rather than a web view layered under a TabView with clear pages: TabView page backgrounds and hit-testing
  are not ours to rely on; one container per tab and a moved WKWebView is deterministic.
- On lock (biometric gate, off by default) the holder drops its web view, as the old view's teardown did, so an unlock
  starts clean.
- No Today badge in this part (the card calls it optional; needsYou is already in the client).

## Weakest premise
What "at launch" means. The bar takes the remembered value, then the first page read of the launch that answers, in
either direction. Usually that is the first seconds, but after a late sign-in it can be minutes in, so the bar can
change on screen once per launch (review 1, N3). If Tasks is showing when it leaves, the app goes to Today and presses
Today, so the board follows. Rejected: holding the first read to the next return, which leaves an earned Tasks out of
the bar for a first launch's whole session. What would change this: per-Mac memory, or a person reporting the jump.

## Validation
LogicTests: AppTabs order and the Tasks gate, keep(), board names, door JS text, answer reading (true only), the
kapptabs script text, the page flag reading ("1"/"0" only). The kapptabs and localStorage scripts run in a real JS engine
(JavaScriptCore on the Mac) where they can, not only as text. Mutants: a tasks gate that always
shows; an answer reader that takes non-nil as opened. Simulator build (queued-heavy). Real-device check is Baron's
TestFlight run (#6838 frames).
