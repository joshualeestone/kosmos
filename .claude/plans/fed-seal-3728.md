# fed-seal-3728: federated room messages sealed end to end

Card: kosmos#3728. The design is the card's 10:31 comment (2026-09-25); this plan tracks the build.

## Step 1 (done): the crypto layer, engine/fedseal.js
Pure functions plus this board's X25519 key file (fed-seal-key.json, mode 600, never silently replaced). The pieces:
- helloFrame and checkHello
- shareFrame and openShare
- rotateFrame and openRotate
- seal, open and isSealed

Everything uses node's built-in X25519, HKDF-SHA256 and ChaCha20-Poly1305. Every open or check returns null on any failure and never throws.

Tests (engine/fedseal.test.js):
- The handshake; seal and open round trip.
- Refusal of: a wrong key, a wrong room, a wrong epoch, a tampered byte, key swaps without `s` in both directions, a share opened by another member, a revoked member reading the next epoch, a rotate from an unpinned key, and malformed frames.
- The key file is made once, at mode 600, and never replaced.
- Controls: without the hello MAC, a forged hello is pinned; without the share MAC, a forged share is accepted. Both fail by name.

## Step 2a (done): where s lives
- engine/fedseal.js has a rooms file, fed-seal-rooms.json. It is mode 600 and a damaged file is never overwritten. It holds pending[project_ref] (the owner's invite halves, spent once, lapsing with the code's 7 days) and rooms[projectId].
- invite: the board makes `s`, keeps it for the project and returns `<code>.<s>`. An invite whose half cannot be kept is refused.
- verify: the pasted code is split at its last '.'. Only the coordinator's half is sent, and `s` is held for the join, never returned to the page.
- join: a code with a half makes a sealed member room ({ role: member, s, no key yet }). A code without one joins unsealed, as before.
- Tests: invite keeps the half; verify sends only the first half and never returns `s`; join through the board lands the member room; the store's TTL, spending, splitting, mode 600 and damage refusal. Control: sending the whole pasted code fails both verify tests by name.

## Step 2b onward (next): the wiring
- invite: the board makes `s`, stores it beside the invite, and shows `<code>.<s>`.
- join: the board splits the code, verifies with the first half only, and keeps `s`.
- seat: on connect the member posts key-hello. The owner checks it, pins the key, and replies key-share. The member opens it and pins the owner.
- federateOut seals. The inbound path opens, and refuses unsealed payloads once the room is sealed. The room says "waiting for the owner's Mac" until the member holds a key.
- revoke: rotate to every remaining member.

## Not claimed in v1 (on the card)
- No forward secrecy.
- A member could forge another member's `from`.
- One seat per member account.
