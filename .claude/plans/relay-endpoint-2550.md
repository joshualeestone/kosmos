# relay-endpoint-2550 - flip DEFAULT_RELAY to relay.kosmosplus.com

Card: kosmos#2550. Migrate the compiled relay tunnel endpoint from
`relay.plus.installkosmos.com:8443` to `relay.kosmosplus.com:8443`, for naming
consistency with the coordinator (already on `login.kosmosplus.com`).

## Change
- `engine/remote.js:104` `DEFAULT_RELAY` -> `relay.kosmosplus.com:8443`.
- `engine/remote.js:~43` doc comment updated to the new default + a migration note.
- `engine/remote.test.js:383` (connector command-args match) and `:510` (constant
  assert) updated to the new name.

## Why it is safe
The relay serves a SAN cert covering BOTH names (reissued + verified live
2026-09-24 under #2550: both `relay.plus.installkosmos.com` and
`relay.kosmosplus.com` complete a TLS handshake with system roots, Verify return
code 0). The old name stays alive indefinitely (still CN + SAN on the cert AND
still resolves), so installed clients that dial the old name keep working. This
is the ordered flip's step 4: the cert (steps 1-3) is already in place, so the
constant flip cannot strand a Mac dialing the new name.

## Sequencing
- Prerequisite (coordinator constant flip, #1565) is already done: the test at
  remote.test.js:511 already pins `DEFAULT_COORDINATOR = https://login.kosmosplus.com`.
- This rides the next app cut; installed Macs on the old name are unaffected.

## Scope
Isolated: swept the whole repo (excluding node_modules) for `relay.plus.installkosmos`;
the only remaining reference is the intentional migration note in remote.js. No
docs/other tests reference the old relay name. remote.test.js passes 39/39.
