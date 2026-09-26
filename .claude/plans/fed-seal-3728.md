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
- **Legacy:** a room with no seal state (made before sealing, or joined with a code from an older owner) behaves exactly as before, UNTIL its owner makes a sealing invite for the project. From then the owner refuses that member's plaintext, and the member cannot open sealed messages. Both rooms name the recovery: remove that person, then send them a new code. A member cannot redeem a second code while its first edge is active (the coordinator answers AlreadyJoined), which is why the removal comes first (round 3).
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

## Stated limits (v1)
- The relay still sees metadata: who posts, when and how much. Only content is sealed.
- A relay that suppresses every newer-epoch frame to one member can keep that member on the old key. A member that sees a message from any epoch ahead of its own holds its posts for up to 3 minutes, armed at most once per epoch it holds (rounds 5 to 7): forged envelopes, however many, pause a member for at most 3 minutes per rotation it has taken.

## Round 1 review (opus, crypto-focused): 2 BLOCKERs, 3 WARNINGs, 4 NITs, all taken
- [BLOCKER] an owner's room was unsealed until the first hello, so a relay that drops hellos kept the owner posting and showing plaintext. FIXED: a project is sealed for good from its first sealing invite (`sealedRefs`). The owner holds posts ("no member's computer has joined with its key yet") and refuses plaintext inbound. Control fails by name.
- [BLOCKER] a member chose its own edge in the hello, so it could name a fake edge (or a colleague's) and survive revocation. FIXED with a coordinator change (kosmos-relay#163): the invite answers with `invite_id`. The board keeps `{ s, code, invite }`, and a hello that checks against an invite is pinned to the edge the COORDINATOR lists as redeemed from that invite. Nothing in the hello names an edge now; a pinned edge never changes; one key per invite. An invite with no `invite_id` (an older coordinator) is not made sealable at all. Control (edge taken from the member) fails by name.
- [WARNING] a hello processed while a rotation awaited the coordinator was erased by the rotation's stale write. FIXED: hellos and rotations run one at a time per project (sealStep), and the rotation re-reads state after its await. Control (neither) fails by name.
- [WARNING] replays: an old sealed message could be replayed, and old epochs opened forever, so a revoked member could keep posting under the old key. FIXED: every seal carries { id, at }. A message seen before, over an hour old or more than 5 minutes in the future is not shown. The previous epoch opens only for 10 minutes after a rotation. Controls fail by name. Seen ids are per seat run; a replay across a board restart inside the hour is the residual (stated).
- [WARNING] the room id binding comes from the coordinator. ADDRESSED: the hello and share MACs also bind the coordinator's code half, which both boards hold. Messages keep the room id as AAD; the room key is per room and random, so a coordinator that reused a room id still could not make one room's messages open in another.
- [NIT] a fixed .tmp name could keep a wider mode. FIXED: a unique O_EXCL temp at 600, chmod, fsync, then rename. Test.
- [NIT] random 96-bit nonces under one key. STATED in the module (about 2^32 messages per epoch, far past the inbound budget).
- [NIT] one pair key for share and rotate. FIXED: separate HKDF info per purpose. Test: a share's ciphertext presented as a rotate does not open.
- [NIT] no test for the owner-side downgrade. ADDED (see the first BLOCKER).
- Also: a member still waiting for a key says hello again on each ensureAll pass (a dropped hello is not a lost room). Control fails by name.

## Round 2 review (sonnet): 2 WARNINGs, both taken
- [WARNING] a member offline at a rotation stayed on the old key: only the OWNER's reconnect re-sent it, and a member holding any key does not say hello again. FIXED: on each ensureAll pass the owner re-sends the current epoch to its pinned members; members ignore an epoch they hold. Test (owner seat stays up, a pass re-sends); control fails by name.
- [WARNING] freshness is judged against each Mac's clock, unstated, and a skewed clock refused genuine messages with a note blaming nothing. FIXED: a time refusal has its own note ("...check the date and time on this computer and on the other one"), distinct from a second copy ("arrived a second time"); the clock assumption is stated in engine/fedseal.js. Control (no clock hint) fails by name.
- The reviewer also checked and found sound: the coordinator lying about invite_id to edge gains nothing (it cannot forge a hello without s); sealStep runs fn once (then(fn, fn) fires one handler) and a hung call is bounded by macRequest's own timeout; a sealed owner with every member revoked still posts (sealed, unread); no plaintext path or unguarded throw in the message pipeline.

## Round 3 review (opus): 2 WARNINGs, both taken
- [WARNING] an owner with no key yet fell back to plaintext when federation.json could not be read (safeLink turns the throw into null, read as "not sealed"). FIXED: the seal decisions read the link through sealLink, which keeps "cannot read" as undefined, and isSealedRoom answers "cannot tell" (nothing sent, nothing shown). Test with a damaged federation.json; control (the rule removed) fails by name.
- [WARNING] mixed rooms: a member who joined unsealed is cut off once the owner makes a sealing invite, with no word on recovery (a second code is refused while the first edge is active). FIXED as a stated behaviour: the owner's "arrived unsealed" note and the member's new "sealed this shared room since this computer joined" note both name the recovery (remove, then a new code). The plan's Legacy line now says so. Test.

## Round 4 review (sonnet): 1 BLOCKER, taken
- [BLOCKER] a member catching up on a rotation set rotatedAt to its own catch-up time, so the old epoch's 10-minute grace reopened on every late member's reconnect, for the room's whole life, letting a revoked member keep posting under the old key into that window. FIXED: the owner seals WHEN it rotated into the key-rotate payload (key plus an 8-byte time, under the pair-rotate AEAD). The member starts the grace from that time, capped at its own now, so a member catching up days later opens no old-epoch message at all. Test (a rotate from two days ago, then an old-key post at catch-up time: not shown, the current one is); control (catch-up time again) fails by name.

## Round 5 review (opus): 1 WARNING, 2 NITs, all taken
- [WARNING] a member that missed a rotation kept sealing under the old key, readable by the revoked member, with no signal. FIXED: a member that sees a sealed message from a newer epoch than its own marks itself behind, holds its posts ("behind on this shared room's key ... waiting for the owner's computer") and notes it, until the owner's re-send (each pass) arrives. A relay suppressing every newer-epoch frame is now a stated limit. Test and control.
- [NIT] openRotate's doc omitted rotatedAt. FIXED.
- [NIT] the plan quoted copy the code does not use, and an "open questions" section asked nothing. FIXED: the quote, and the section is now "Stated limits (v1)".
- Checked sound by the reviewer: a replayed older rotate is ignored; the owner's rotatedAt persists across restarts; a rotatedAt of 0 means no grace (fails closed); skew in either direction cannot extend the window.

## Round 6 review (sonnet): 1 BLOCKER, taken
- [BLOCKER] round 5's hold read the envelope's epoch before it opened (unauthenticated), so one forged envelope with a huge epoch silenced a member's posting for good (until a board restart). FIXED: only an envelope exactly one epoch ahead counts (rotations advance by one), the hold lasts at most BEHIND_HOLD_MS (3 minutes, about two re-send passes), and a reconnect clears it. Tests: a forged huge epoch holds nothing; a forged next epoch holds for at most 3 minutes; the genuine catch-up test still passes. Control fails by name.

## Round 7 review (opus, whole flow): 2 WARNINGs, both taken
- [WARNING] the round-6 hold re-armed on every forged next-epoch envelope, so a member (or the relay) sending one every ~3 minutes silenced others indefinitely; and the connector's `connected` after each ticket renewal cleared a genuine hold. FIXED: the hold arms at most once per epoch the member holds (s.behindArmedAt), and is no longer cleared on connect. Test: repeated forged envelopes at the same own epoch pause posting once, for at most 3 minutes. Control (re-arm allowed) fails by name.
- [WARNING] ahead-by-exactly-one missed a member two rotations behind, which then kept posting under a key the revoked members hold. FIXED: any epoch ahead counts (safe now that the hold is bounded once per own epoch). Test: a genuine two-rotations-behind member holds its posts. Control (+1 only) fails by name.
- Checked sound: edges are only active or revoked; a hello racing a delete re-reads; a resent hello is answered only from its own invite; every ownerHello throw lands in sealStep's catch.
