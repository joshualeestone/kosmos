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

## Step 2b/2c (done): the handshake and sealed messages, in the seat (engine/fedseats.js)
- **On connect** the seat keeps the shared room id and binds it into every seal. A member holding no key yet sends key-hello.
- **Owner:**
  - It checks a hello against the project's live invite halves, or against a peer it has already pinned (a resend after a reconnect).
  - It pins the member and spends the half.
  - It creates the room key at epoch 0 on the first member and shares the same key with later ones.
  - A hello that matches nothing is ignored silently.
- **Member:** it opens the share, pins the owner key and stores the room key, and the room says it is sealed.
- **Posts:** a sealed room seals every post. A member without the key keeps posts on this computer and says so. An unreadable seal record keeps posts local, because we cannot tell whether the room is sealed.
- **Inbound:**
  - Sealed payloads are opened.
  - An unsealed payload in a sealed room is refused, so there is no downgrade.
  - A seal that cannot be opened is refused.
  - Each refusal gets one note per seat run. Key frames are never rows.
- **Legacy:** a room with no seal state (made before sealing, or joined with a code from an older owner) behaves exactly as before.
- **Tests (engine/fedseats.test.js):**
  - Owner: shares with the half-holder, a stranger gets nothing, the half is spent, a reconnect gets the same key, and posts leave sealed.
  - Member: hello, holding posts, pinning, sealed out and in, downgrade and unopenable refused.
  - Legacy: unchanged.
- **Controls, each failing by name:** no sealing on post; no downgrade refusal; the owner answering any hello.

## Step 2d (done): a revoked member is rotated out
- The hello names the member's edge under its MAC, and the owner pins the key and edge together.
- On each ensureAll pass (the same single edges request), when the coordinator reports a pinned member's edge as not active, the room moves to epoch+1. The new key goes, sealed, only to the remaining pinned members, and the revoked one is unpinned.
- The rotate is re-sent on every connect, so a member that missed it catches up; a member ignores an epoch it already holds and takes a rotate only from the pinned owner.
- **Decided:** an edge the coordinator does not list is NOT taken as revoked, because a partial answer must not lock a member out.
- **Tests:** rotate-out (the rest open the next key, the revoked member opens nothing, posts move to the new epoch, a reconnect re-sends); an absent edge is not revoked; a member takes a rotate only from the pinned owner. The edge is covered by the MAC.
- **Controls, each failing by name:** the revoked member kept; an absent edge treated as revoked; no re-send on connect.

## Step 2e (done): no stale keys; an unsealed room says so
- Deleting a project forgets its room keys, and creating one clears any left on its id (the #3851 shape, for keys).
- A join with a code from an older owner (no second half) posts a room note: "This shared room is not sealed end to end ...".
- Tests and controls fail by name.

## Open questions for review
- The relay still sees who posts when and how much (metadata). Only content is sealed; this is stated in the card's v1 limits.
- invite: the board makes `s`, stores it beside the invite, and shows `<code>.<s>`.
- join: the board splits the code, verifies with the first half only, and keeps `s`.
- seat: on connect the member posts key-hello. The owner checks it, pins the key, and replies key-share. The member opens it and pins the owner.
- federateOut seals. The inbound path opens, and refuses unsealed payloads once the room is sealed. The room says "waiting for the owner's Mac" until the member holds a key.
- revoke: rotate to every remaining member.

## Not claimed in v1 (on the card)
- No forward secrecy.
- A member could forge another member's `from`.
- One seat per member account.
