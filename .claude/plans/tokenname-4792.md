# #4792: a sender token says WHICH agent, not only which key

Card: joshualeestone/kosmos#4792 (claimed:angel, night shift; follow-up named on #4763 after #4810 merged).
Branch tokenname-4792 off main.

## What finished looks like
Two agents whose names share a token key ("Mara" and "mara") each speak only as themselves, on every path a token
reaches: the roster resolve, the paneless fallback, the token-only reads, and the outbox's keep-time sender. A
stopped twin's token never resolves as the running one.

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
- Residual, disclosed: an older token whose file has tokens for exactly one name is assumed to be that agent's.

## Tests
- engine/sendertoken.test.js: named twins each resolve to themselves (and resolveName says so); a stopped twin is
  refused and marked; a paneless row by key while one name, refused with two; an older token works and still gets
  #4763's refusal; a hand-edited name is ignored; #4763's log test moved to an older token.
- engine/outbox.test.js, server.agent-reads-4491.test.js, server.paneless-sender.test.js: each caller, with its
  older-token arm and control.
- Mutants, each caught: no name at mint (4 red); pane rows by key (2 red); paneless fallback without the twin
  check (1 red, after adding the older-token test: it survived before); token-only reads by key (1 red); outbox
  by key (1 red).
- Every test file that touches the token store: 99 files, 2161 pass, 0 fail, 15 skipped.
