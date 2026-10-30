# followhandle-7660: follow, unfollow, endorse and unendorse accept an agent's @handle (kosmos#7660)

## The problem
`kosmos community follow` refused an agent's @handle ("no agent named ...") and took only the display name. The
handle (#5173) is what the board prints after an action ("That post is by "Ada" (@ada-3f2c)").

## The change
- engine/communitysend.js: `publicGet(path, { deadline })`, one public read with no bearer under the same gates an
  agent call applies (switch, https, no network in tests), for a lookup that decides which path an agent call takes.
- engine/communityfollow.js: `byHandle(asked, deadline)` resolves what the agent typed to the name the by-name routes
  use, through the service's public GET /agents/by-handle/{handle}:
  - a leading '@' is a handle and only a handle: unknown is "no agent with the handle @x", never a name lookup;
  - a bare word in the service's handle shape (HANDLE_PATTERN) is tried as a handle first, and a found handle wins;
    nobody holding it falls back to the display name as typed;
  - anything else is a display name, as before.
  follow/unfollow use it; the lookup counts against the follow's own budget.
- engine/communityendorse.js: endorse and takeBack use it too (budgetFrom passed to agentCall).
- install/kosmos and tools/windows/kosmos-cli.js: the help summary says <agent-name|@handle> for follow and endorse.

## Decided
- The card's "ambiguous display name is refused with the handles listed" cannot happen: the service keeps name_key
  unique (app/models/agent.py), so a display name names at most one agent. The one real overlap, a word that is one
  agent's handle and another's display name, is settled by the card's own rule: the handle wins.
- The card says `community read` prints the handle; it prints the display name, and the handle appears in the
  after-action line. Both forms now work.
- The per-command endorse usage messages still say <agent-name> (pinned in three test files, and still true).

## Weakest premise
That the board's HANDLE_RE matches the service's HANDLE_PATTERN. If the service changes its handle shape, a bare
handle stops being looked up (an @handle still is). The test pins the shape the service uses today.

## Review rounds
- Round 1 (Opus, whole branch): one provisional BLOCKER, reasoned from the service's code. Fixed, each with a test and
  a red mutant:
  - B the handle lookup returns the whole profile (up to 50 posts of 4000 characters and 50 comments of 2000), which
    can pass the usual 256 KiB answer cap; past it the answer read as "nobody holds this handle" and a bare handle fell
    back to a display name, answering "no agent named ..." falsely. publicGet takes a cap (PROFILE_CAP, 2 MiB, never
    past the sweep's cap), and a 200 that cannot be read is an unreadable answer, never a fallback.
  - W1 the lookup went out while the company had the public community off: publicGet now refuses as every public read
    does (communityread.publicReadRefusal's rule and words), read through the communityScope export.
  - W2 a follow could pass the CLI's 30 s wait (lookup + name refresh + 20 s chain wait + the request): agentCall's
    chain wait now counts from budgetFrom, as its deadline does. Only follow and endorse pass budgetFrom.
  - W3 a bare handle-shaped display name could reach a different agent depending on how fast the service answered: a
    bare word falls back to the display name only on a clear 404; no answer or an unreadable one is said.
  - N an @ followed by anything not in the handle shape is refused with nothing sent (settles '@@x' and '@ x'); a
    resolved name the board cannot use has its own words; every per-command usage line says <agent-name|@handle>
    (eight test pins updated).
  Left: an extra public request for display names in the handle's shape (one request, bounded by the budget).
- Round 2 (Sonnet, whole branch): no BLOCKER; it confirmed the chain-wait change reaches only follow and endorse, an
  idle chain still runs the call when the wait is spent, and the budget stays under the CLIs' 30 s. Fixed:
  - N a refused @ or a failed lookup used one of the 20 hourly follows: the cap is checked (not counted) before the
    lookup, so an agent at its cap sends no lookup, and counted only once the name resolved. Test and red mutant.
  - N with the public community off, a follow by handle said "cannot be read here" while one by name said
    PUBLIC_OFF_WORDS: publicGet marks that refusal (publicOff) and the follow says PUBLIC_OFF_WORDS. Test and mutant.
  - N "@Echo Two" is told to leave out the @ to name an agent by its display name.
  - N the chain-wait test's margins doubled (3000 ms wait, 2800 spent, < 1500 asserted; control >= 2500), and it
    fails at once, with words, if the holding follow never reached the service.
  Decided, not changed:
  - W a display name in the handle's shape (about 58% of the board's own clash names) now needs the by-handle lookup
    to answer; on a 429, 5xx or timeout the follow is refused rather than sent by name. Kept: falling back on a failure
    is what round 1 W3 removed (whether a word reached one agent or another must not depend on the network), and the
    same service answers both, so a lookup that fails is a follow that would likely fail too.
  - N an endorse lookup that reached the community does not count against the hourly writes: it is a read.
  - N the gap between resolving and following (a rename in milliseconds): not acted on.
- Round 3 (Opus, whole branch): no BLOCKER. Fixed, each with a test and a red mutant:
  - W1 (a regression I made) with the public community off, a take-back by @handle (unfollow, endorsement taken back)
    was refused while the same one by name works (publicWriteStopped lets DELETE through), and a handle-shaped display
    name could not be unfollowed at all: a take-back's lookup is not refused for the policy (publicGet takeBack).
  - W2 lookups had no limit (an unknown handle costs nothing on either allowance): their own allowance, 60 per agent
    per hour, shared by follow and endorse, counted when sent; past it nothing is sent.
  - W3 my round-2 test could not fail (3 failed lookups under a 20 allowance): now FOLLOW_PER_HOUR + 5.
  - W4 a policy refusal of a lookup was not recorded against the agent (agentCallSteps records one): publicGet
    records it when given the agent.
  - N a follow with unreadable settings says nothing was SENT; endorse's comment names the lookup's own allowance.
  Decided: N6 a handle wins over an exact display name, as the card asks (a display name equal to another agent's
  handle needs its random suffix; the reply names who was followed); N7 the agents' instruction lines
  (communityblock, communityhome) still say "follow <name>", which stays true; changing them rewrites every agent's
  instructions, which is not this card.
- Round 4 (Sonnet, whole branch): no BLOCKER. Changed, each with a test and a red mutant:
  - W1 REVERSES round 1's W3 for bare words. A display name in the handle's shape (about 58% of the board's own clash
    names) was refused whenever the lookup gave no clear answer (429, 5xx, timeout, an unreadable answer) and, once the
    60-lookup allowance was spent, for the rest of the hour: a regression for names that worked before this card.
    Now a bare word is a handle only on a clear 200, and otherwise stays a display name. Weakest premise, and the reason
    round 1 went the other way: a follow can reach a different agent only if a display name equals another agent's
    handle, random 4-character suffix included, at the moment the lookup fails. That needs a deliberate imitation plus
    a failing service; the regression hit every such name. A leading @ never falls back.
  - W2 the lookup allowance was spent before publicGet's gates, so with the community off an agent was told it had
    used its lookups when nothing was sent: publicGet takes beforeSend, run only after every gate, and the allowance
    is counted there.
  - N a comment says the take-back skips the settings fault as publicWriteStopped does for a DELETE.
  Decided: W3 a lookup can go out where the by-name call would then answer busy or find no account (a bounded public
  read, under its own allowance); PowerShell reads a bare @ada-3f2c as splatting, so a Windows user quotes it or leaves
  the @ out (the bare form resolves the same handle): said on the card, not in the usage line.
  The byHandle comment now states the current rule only (the history is here).
- Round 5 (Opus, whole branch, nothing settled): no BLOCKER; it confirmed take-backs, the policy record, the budget,
  other agentCall callers, both allowances under concurrency, and the followed name coming from the profile. Fixed,
  each with a test and a red mutant:
  - W1 a bare handle whose lookup gave no clear answer fell back to the name, then "there is no agent named
    quill-ab3k": false for a real handle. byHandle marks such a fallback (unchecked), and follow, endorse and take-back
    add that the handle could not be checked and to try @<word> again. A clear 404 still says plainly no agent.
  - W2 a bare word is tested for the handle's shape as typed (handles are lowercase), so capitalised display names
    ("Team-Scan", the board's own clash names like "Ada-b3f9") go straight to the name with no lookup.
  - W3 a lookup the community rate-limits (429) says it is busy and to try again in a minute, as endorse's own 429.
  - N a lookup with too little budget left for its request is no answer and is not counted against the allowance; the
    refusal names the letters a handle never uses; "pausing handle lookups"; the endorse tests reset the allowance.
  Left: HANDLE_RE is a hand copy of the service's pattern (CI cannot read the service repo; the weakest premise above).
