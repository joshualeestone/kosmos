# Plan: #3568, turn on Gemini on a Google subscription (the Antigravity runner)

Josh, 2026-09-25 20:57: "We don't need googles permission". Splinter: turn it on and remove the caveat.

## Finished looks like
A person with Google's Antigravity (agy) installed and signed in on their Mac can pick
"Gemini (Google subscription)" when creating an agent or switching one, and the agent runs on agy. The
board names it correctly everywhere a runner is named (never "Claude", never Claude models, never a
Claude sign-in banner or login warning for it). The Gemini row's "Sign in with Subscription" works: it
says whether agy is installed and signed in, points to Google's installer when it is not, and opens
agy's own sign-in. The copy people and agents read says Gemini runs on an API key or a Google
subscription, only now that it is true.

## Measured before building (main at dd683ee78)
- There is no Google-permission caveat in the copy. Gemini reads "API key" because the subscription
  path was never wired: KEYED_SUB_START.google is null, and nothing in the UI can choose 'antigravity'.
- The engine already handles 'antigravity' (create, chat, status, runners, register, accountproblem,
  server runnerDisplayName). antigravityEnabled() gates only setting an agent up (4 callers).
- 11 display sites fall through to Claude for an antigravity agent (web/index.html modelLine, the
  model picker, acctMoveWorld, providerOf, provName, PROVIDER_MARK_KEY, account qualifier; server.js
  someAgentNeedsClaude, accountForAgent, acctNoun; engine/observed.js) plus runningas.js,
  computeLoginAdvisories and the whoami article ("a Antigravity").
- agy has no login command: it signs in inside its own window. Kosmos does not install agy; it looks
  for ~/.local/bin/agy. Signed in, `agy -p` answers in about 2s; signed out it fails after about 60s.

## Change, in order
1. Engine: antigravityEnabled() on by default (AGENT_WORKFORCE_ANTIGRAVITY=0 turns it off).
2. A read-only agy status: installed (runners.resolve) and signed in (a bounded one-line prompt, run
   only when asked, never on a poll), for the Gemini row and the provider lists.
3. Every display site above learns 'antigravity' (label "Gemini (Google subscription)" where a person
   picks, "Antigravity" where the board names the program).
4. Create and switch offer "Gemini (Google subscription)" (value 'antigravity'), enabled when agy is
   installed (signing in happens in the agent's own window on its first start), sorted beside Gemini.
5. The Gemini row's subscription step: KEYED_SUB_START.google checks agy, and either says it is ready,
   or links Google's installer, or opens agy's sign-in and re-checks.
6. Copy: engine/connections.js and the Gemini row say key or Google subscription.

## Decided
- A separate choice, not Gemini's option switching runner by connection (rejected: one option meaning
  two programs, which the board cannot then name).
- Weakest premise: that a signed-out agy started in a Kosmos-opened Terminal completes its sign-in in
  the browser without Kosmos typing into it. Not measured: the only agy here is Josh's, signed in, and
  it will not be signed out. Measure on the second Mac Mini before the release notes advertise it.

- Settings' Add a provider still offers Gemini by key only (rejected here: a second driver and screen
  in this branch). The create/switch option works once agy is installed, since agy opens Google's
  sign-in on the agent's first start; its off hint says "Needs Google's Antigravity" and the agents'
  guide says how it is installed. The Settings button is #3874.
- Kosmos installs agy itself with Google's own installer, on the person's press (POST
  /api/antigravity/install: the fixed https URL, saved to a temp file and run by bash, not piped).
  Rejected: showing the command to paste into Terminal, which Josh's #996 rule forbids (a person is
  never told to open a Terminal; web.terminal-hatch-996 guards it). Kosmos already installs every
  other provider's terminal agent behind a Confirm press.

- Review round 1: opening Antigravity for sign-in is its own press ("Open Antigravity to sign in"),
  never a side effect of a check (each check costs a prompt, each open is a window). The check has a
  hard cap of its own and kills agy with SIGKILL, so a hung agy cannot wedge later checks. Gemini's
  Connect shows the choice before downloading the Gemini CLI, which only the key path needs. Claude
  login warnings leave out agents on other programs (engine/status.js computeLoginAdvisories).
- Weakest premise, narrowed: Google documents that agy started without a saved session opens the
  browser to sign in, so opening it in Terminal is the documented path; what `agy -p` does signed out
  (it may also open a browser) is still unmeasured here.

- Review round 3: offered only where it can run and is switched on (GET /api/antigravity says
  enabled/supported; install, open and check refuse otherwise; the Gemini row goes straight to the key
  path), so Windows and AGENT_WORKFORCE_ANTIGRAVITY=0 never see a path create would refuse. Ready
  marks the Gemini row connected and offers Next. The installer runs with its input closed, and a
  sandboxed board refuses to install into the real home. The switch dialog says to sign in on the
  Gemini row first rather than promising a window the agent's pane would open unseen. The whoami
  sentence names "Gemini (Google subscription)" with the program it runs on.

- Review round 4: one page predicate, vendorPicksModel (key-based providers and antigravity), at every
  "no Claude model, no Claude account" site, because patching sites one by one missed three (the saved
  create pick, the create recovery, the switch pre-refusal). The Gemini choice says "Download complete."
  only after a download. engine/observed.js, listed in "Measured" above, has no runner branching at
  all: that listing was wrong, and nothing there needed a change.

- Review round 5: the create form says to sign in first when Gemini by subscription is picked and not
  confirmed; every "set it up" points at the real path (Settings, Show the guided setup, then Connect on
  Gemini); the first-run row reads "subscription or API key today"; the page stops re-asking where it is
  not offered; the one runner list is create.isNonClaudeRunner; person-facing engine words say Gemini
  (its models) and Google (its sign-in), while "Antigravity" stays where the board names the program.
- Deliberate exception, stated: Google's installer script runs without a checksum. Kosmos pins and
  verifies the runners it packages itself; Google publishes only this script (fetched over https from
  its fixed URL, saved then run). Its failure says it did not finish, never that nothing changed.
- Still unmeasured, and to measure on the second Mac Mini before release notes advertise it: what a
  signed-out agy does under `-p` (the check) and on a cold Terminal start (whether it opens the browser
  with no keypress). The only agy here is Josh's, signed in; it will not be signed out to find out.

- Review round 6: agyAsk returned nothing on the path that fetches, so the Gemini row's "offered?" wait
  was a no-op; it returns the read now, tested with a held fetch. Left as it was, with the reason: a
  Gemini or Grok pane not yet tagged with its runner can still be read as Claude in the login-warning
  filter. That predates this card, and Gemini's CLI runs as `node`, so its pane cannot be told apart
  by its command without a separate detection design.

- Review round 7: an Antigravity agent's own page says there is no account to move it to; signed in
  only on agy's whole answer "ok"; a dropped install request reads as maybe-still-installing; the
  runner also turns off with false/off/no; the page treats Windows as not offered by its own platform
  tag, and a Gemini CLI download already running goes on to the key step (render-keyed-install-3713).
  Left: the install holds one request open for its length (no job + poll); a drop now says "may still
  be installing", and Check again finds out.

- Review rounds 8-9: the saved create pick awaits the installed read and yields to a fresh choice; the
  installer gets a minimal environment; Ready marks the row connected and offers Next without the
  accounts read; the Gemini row names the subscription only where offered; "Download complete." only
  after a download; whoami says an Antigravity agent signs in with Google.
- Review round 10: converged. Accepted residual: if the accounts read fails at the moment sign-in
  finishes, the green "is ready" summary line under the row waits for the next repaint (Ready text, the
  Connected button and Next already show). runnerDisplayName's antigravity arm is unreached by whoami
  (it names the program for other callers) and is left.

## Not in this card
- Reading what an Antigravity agent is doing (status) and its auth-failed copy: #3568's PR 2.
- Windows: agy is refused there today.
- Surface gate (#2518) also named render-unread-edge-3743 and render-agentdm-3414 (token 'msg', a variable name here): both run and pass unchanged (23:48).
