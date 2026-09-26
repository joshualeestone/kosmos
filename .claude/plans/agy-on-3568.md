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
4. Create and switch offer "Gemini (Google subscription)" (value 'antigravity'), enabled only when agy
   is installed and signed in, the same gating Gemini's key option has.
5. The Gemini row's subscription step: KEYED_SUB_START.google checks agy, and either says it is ready,
   or links Google's installer, or opens agy's sign-in and re-checks.
6. Copy: engine/connections.js and the Gemini row say key or Google subscription.

## Decided
- A separate choice, not Gemini's option switching runner by connection (rejected: one option meaning
  two programs, which the board cannot then name).
- Weakest premise: that a signed-out agy started in a Kosmos-opened Terminal completes its sign-in in
  the browser without Kosmos typing into it. Not measured: the only agy here is Josh's, signed in, and
  it will not be signed out. Measure on the second Mac Mini before the release notes advertise it.

## Not in this card
- Reading what an Antigravity agent is doing (status) and its auth-failed copy: #3568's PR 2.
- Windows: agy is refused there today.
