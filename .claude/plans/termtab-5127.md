# termtab-5127: point people at places that exist (#5127, #5128; the #5114 class)

Cards: kosmos#5127 (Terminal tab), kosmos#5128 (the "Settings: Add a provider" hint). Found in a sweep of main
1c05eb408 for copy naming a tab, button, menu or page that does not exist (Splinter 04:16). Day-one path.

## Finished looks like
No sentence a person can see names a "Terminal tab" (there is none: the agent's screen is a box under the AI Settings
pill on its page, "This agent's Terminal" on a Mac, "Live output" on Windows), and the greyed provider hint names the
section Add a provider is in ("Set up in Settings, AI Models").

## The thirteen sentences
- server.js: the agent-not-running message ("if it stays off, look under AI Settings on its page").
- engine/chat.js: ten refusals from answering a Codex hook question. They are shown in the question box ON the agent's
  page, so they say "...; look under AI Settings on this page".
- web/index.html: the greyed Gemini (Antigravity) and Meta (Muse) provider hints.

## The sweep, so the next person does not redo it
Read every quoted string (and, for #5114, the page markup) in web/index.html, server.js, engine/*.js, the Windows and
Mac CLIs for: Settings paths ("Settings, X", "Settings > X", "X tab in Settings"); "the X tab/section/page/view/
screen/menu"; a verb followed by a named control ("press X", "choose X"); and "X button/link/switch". Each name was
checked against what the page shows (the Settings nav, the top tabs, the agent page's pills, labels in the markup).
Real hits: #5114 (merged), #5127, #5128. Everything else named a real place, a macOS/Windows system setting, another
site, or was a comment.

## Rejected
- Saying what is there ("you can see its screen under AI Settings"), tried in iteration 2 for precision: with no
  session, or when Kosmos itself could not read the screen, that box shows nothing, so the sentence would promise what
  the page cannot show (iteration 3). The sentences point at the place only, which holds in every case, as #1663 ruled.
- Naming the box itself ("its Terminal"): it is called something else on Windows; the pill is the same on both.

## Weakest premise
That "under AI Settings" is enough to find it: the agent's screen is the third of four sections under that pill, and
the sentence cannot name what is in it without over-promising.

## Checks
- web.place-names-5127.test.js: quoted strings and the page markup's text; red on main (lists exactly the thirteen); an
  arm that the AI Settings pill still holds the agent's screen (red when the pill is renamed, measured); a control for
  each spelling and each comment kind it skips.
- Tests pinning the old words updated: server.offline-nextmove.test.js, web.agy-on-3568.test.js,
  web.muse-create-3939.test.js, and the browser check render-muse-signin-3939.js.
