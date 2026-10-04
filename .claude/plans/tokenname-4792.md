# #4792: a sender token says WHICH agent, not only which key

Card: joshualeestone/kosmos#4792 (claimed:angel, night shift; follow-up named on #4763 after #4810 merged).
Branch tokenname-4792 off main.

## What finished looks like
Two agents whose names share a token key ("Mara" and "mara") each speak only as themselves wherever a pane row or
the token's own name decides: the roster resolve against pane rows, the paneless fallback, the token-only reads and
the outbox's keep-time sender. A stopped twin's token never resolves as a running PANE twin. Where the board itself
knows an agent only by its key (a paneless or never-run row), the key path holds, refused once two names hold
tokens under it (residual below).

## The change
- engine/sendertoken.js: `mint` records `name` (the exact name given) on each token. `resolve`: a named token
  matches a row with a tmux session by EXACT name, and a paneless row (status.js lists it with session null and the
  key as sessionName) by key only while one name holds tokens in that file; otherwise NO_MATCH, marked CLASH when two
  names do. `resolveName` returns `name` (null for older tokens) and `twins`. A name that does not key to its own
  file is read as no name.
- server.js `resolveAgentSender` paneless fallback: refuses when `twins`, and names the card by the token's own name.
- server.js `agentTokenOnlyCaller`: returns { name, byKey }; a named token is matched exactly, an older one by key
  unless `twins`.
- engine/outbox.js `resolveKeepSender`: the token's own name; an older token's key unless `twins`.

## Decisions
- Older tokens (minted before this) keep today's key behaviour, including #4763's refusal when two ROWS share the
  key. Refusing them would cut off every agent still holding one (remote agents are issued once). One named name
  plus an older token is the ordinary relaunch case and still reads; two names make the key ambiguous and the
  key-only paths refuse.
- `session`, not `paneless`, tells a paneless row: paneRoster() rows carry no `paneless` field (the fleet fixture
  refuses the read), and both producers carry `session`.
- WEAKEST PREMISE: that every mint site passes the same spelling the roster uses as sessionName. Checked: the
  supervisor strips the world suffix and -discord exactly as launchidentity.agentNameFromSession does for the
  roster; adopt, win32create and the remote token route pass the agent name. A mismatch would refuse that agent's
  token (fails closed, visible), never admit another.
- Residuals, disclosed:
  - An older token (no name) in a file where at most one name holds named tokens is matched by key as before: it
    resolves as whichever single pane row holds the key, which need not be that name (remote "Mara"'s older token
    resolves as pane "mara" when no "Mara" row runs). Older tokens age out as agents relaunch.
  - Token-only reads have no roster: while no second NAME holds a named token under the key, a named token reads
    every project that lists the key spelling, whoever that is (a running pane agent on older tokens, a stopped or
    never-run agent, a legacy agent with no token). The roster paths refuse the running-pane case; the reads cannot
    see it.
  - A row with no session (paneless remote, or created-never-run) is listed and stored by its KEY, and the board
    addresses and delivers to it by that key, so the card stays under the key. Such a row cannot tell remote "Kip"
    from a stopped Mac agent "kip" that holds no NAMED token (its run token is retired when it stops, and a twin
    holding only older tokens is just as invisible to the twin check): Kip's token would
    speak there as "kip". Renaming the card to the token's spelling was rejected: delivery and every key-keyed
    record would then miss for every remote agent whose name has capitals or punctuation. Closing it needs a
    paneless row that carries its own name (status.js), a separate change.
  - revoke(name) drops every name under the key, and retireLauncher(..., { untagged: true }) from one name's
    supervisor drops the other name's untagged tokens (adopt and win32 mints carry no launcher). Both predate this;
    names now make a per-name filter possible, a follow-up.
  - POST /api/agent-token's 409 sees only RUNNING pane rows (predates this).

## Tests
- engine/sendertoken.test.js: named twins each resolve to themselves (and resolveName says so); a stopped twin is
  refused and marked; a paneless row by key while one name, refused with two; an older token works and still gets
  #4763's refusal; a hand-edited name is ignored; #4763's log test moved to an older token.
- engine/outbox.test.js, server.agent-reads-4491.test.js, server.paneless-sender.test.js: each caller, with its
  older-token arm and control.
- Mutants, each caught: no name at mint (4 red); pane rows by key (2 red); token-only reads by key (1 red); outbox
  by key (1 red).
- Every test file that touches the token store: 99 files, 2161 pass, 0 fail, 15 skipped.

## Review
Round 1 (blind): no blocker, three should-fix. Taken: an older token is refused in resolve too once two names hold
tokens under its key (it resolved as the one running row); token-only reads admit the stored KEY while no twin
(the board stores a remote agent's membership by key, so remote "Kip" lost its own project's reads). Not taken as a
code change, stated as a residual above: the key-listed row speaking under the key (renaming the card breaks
delivery). Nits taken: named twins with only a key row are logged once; stale comments (server.js limitation note,
sameAgentName, sendertoken overclaim). Mutants for both fixes caught; the four touched files 99/99.
Round 2 (blind): no blocker, two should-fix, both taken. A named token whose key is held by a running PANE row of
another spelling is now marked CLASH in resolve, so the paneless fallback cannot admit it under that key (reproduced
by the reviewer, now a test with a no-row control). The clash logs no longer re-arm when one twin resolves (a named
success cleared the #4763 set): the #4792 log has its own set, cleared by nothing; tested over five alternations.
Nits taken: residual 1 restated precisely, plus the token-only residual; the fallback card is the KEY (as status.js
lists a paneless row), not the token's spelling, so delivery and records match.
Round 3 (blind): no blocker; CONVERGED on the code (14 mutants on copies, 13 caught). One should-fix in this plan
only, taken: residual 2 restated (a named token reads every project listing its key spelling while no second name
holds a named token) and residual 3's "no tokens" made "no NAMED token". Nits taken: the surviving mutant is the
paneless fallback's own twin check, now reached only if a second name is minted between resolve and resolveName
(resolve already marks every twin case), said in server.js and here; agentTokenOnlyCaller's comment points at the
key arm; the #4792 log line says what is refused; retireLauncher's untagged sweep added to the follow-ups.
