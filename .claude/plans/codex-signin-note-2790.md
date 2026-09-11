# Plan: warn when a codex agent lands on an unverifiable ChatGPT sign-in (kosmos#2790)

## Problem

A prod user created 5 OpenAI/Codex agents, all bound to a ChatGPT SIGN-IN account
that Kosmos cannot live-check ("Signed in - not checked live", grey). They sit
Idle / "Not yet read" forever with no red, indistinguishable from a healthy-but-
quiet agent. Root cause (posted on #2790): `openaiaccounts.checkLive` returns
UNKNOWN for authMode !== 'apikey' (a sign-in hands an id_token, not a testable
bearer key), and the read-side probe (`codexauthprobe`) only reddens on a positive
checkLive NONE, which a sign-in never returns. So the failure is silent.

## Scope decision (full rationale on the #2790 card comment)

- REJECTED building a read-side "never-started detector" keyed on rollout absence:
  measured that codex writes its rollout at FIRST TASK, not at launch (session_meta
  timestamp == first task_started timestamp), so a healthy-but-never-tasked codex
  agent has no rollout and the detector would false-fire on it. That is the named
  false-red haunt and the exact decision reconcileReport already made (status.js
  ~5473). A sound signal needs delivery-linkage plus a reproduction of the dead
  sign-in state; deferred.
- REJECTED silently steering create/switch to the API key: a sign-in is often the
  cheaper intended path (a subscription), so a silent steer trades a silent failure
  for a silent bill, and violates create.js's anti-silent-wrong-account doctrine.
- BUILDING: make the unverifiability VISIBLE where the account is named, without
  changing which account binds.

## Change

`server.js`, the `POST /api/agent/:name/provider` (switch-provider) route: when the
landed account is a ChatGPT sign-in (`acct.authMode === 'chatgpt'`), append a
one-sentence note to the confirmation `because` in BOTH the ok (present tense) and
partial (future tense) branches: Kosmos cannot live-check an OpenAI sign-in so its
status stays unverified, and if it does not respond switch it to an API-key account,
which Kosmos can verify. Reuses the account-landing sentence the frontend already
renders (no new frontend surface, no browser-check gate). No behaviour change: no
account is moved.

## Tests (`server.switch-account-1373.test.js`)

Real over-the-wire route tests. Added a `seedChatgpt` fixture (auth.json with
auth_mode 'chatgpt' + an id_token whose payload carries an email) and three arms:
- OK branch, sign-in landing -> the note is present (guards the ok append site).
- OK branch, API-key control -> the note is ABSENT (gives the arm above meaning).
- PARTIAL branch, sign-in landing -> the note is present (guards the partial append
  site independently; a mutation deleting the note from one branch reds only that
  branch, verified).

## Deferred follow-ups (to file)

1. Create-path visibility: the fresh-agent create route surfaces no account today,
   so a codex agent created with no account pick binds the default home silently.
   Same note belongs there but needs a new frontend surface (browser-verified).
2. Badge actionability (card Q3): "Signed in - not checked live" should say what it
   means and what to do; frontend + browser verify.
3. A sound read-side never-started signal, gated on a reproduction of the dead
   sign-in pane/rollout state.
