# Fix #2323: removing an agent must revoke its sender token

## The finding (from the #1762 Windows-agent security audit)
Removing a remote/token agent did not revoke its sender token, and a remote
Windows agent's process cannot be stopped by removal, so a "removed" agent that
kept beating kept authenticating via resolveAgentSender's paneless arm (token +
liveness) and kept reporting as itself. Removal's promise ("stopped, stops coming
back") was not kept for the remote/token surface.

## The fix (root-cause, minimal)
`engine/remove.js` `recordRemoval` now calls `sendertoken.revoke(clean)` (after the
DRY_RUN guard, before the UNREADABLE record-write check). recordRemoval is the ONE
point every removal-commit path reaches: recordAndSay's partial paths and the
full-success path both call it; the "nothing changed" abort does not, so a no-op
removal correctly does not revoke. A revoked token's file is gone, so
sendertoken.resolveName fails and the paneless arm can no longer resolve the
removed agent -- this alone closes the finding.

sendertoken's own header mandates this: "A caller that recreates or deletes an
agent MUST call revoke()." create.js (recreate) and delete-leftover.js (delete)
already did; REMOVE was the missed lifecycle event.

Keyed on `clean` (the canonical name removeInner acts on), the same name the token
is minted under, so sendertoken's safeKey resolves to the same file. The end-to-end
test (mint under the name -> remove -> assert resolveName now fails) is what proves
the key matches; safeKey/cleanName/slugFor diverge on capital/space names (#740),
so key reasoning alone is not trusted.

## Deliberately NOT done: the paneless-arm removed-check (defense in depth)
resolveAgentSender's paneless arm could also exclude the removed set. Deferred: it
adds a removedAgents() file read on the report/reply auth HOT PATH plus auth-core
risk, for a case the revoke already closes. Documented as optional hardening on
#2323. If added later, the correct form is
`removedAgents().some(r => store.safeKey(r.name) === byName.key)`, failing OPEN on
an unreadable removed-list.

## Reversibility
Restore does not need to un-revoke: a local agent re-mints a fresh token when it
relaunches; a remote one is re-issued a token by the operator (the correct meaning
of restoring a removed remote agent). Test covers this (restore + fresh mint
resolves; the pre-removal token stays dead).

## Tests
engine/remove.test.js, two #2323 tests end-to-end (real mode): revoke-on-remove,
and restore-after-revoke. Both pass (61/0). Best-effort revoke (swallowed) so a
revoke fault never blocks a removal, mirroring the module's posture.
