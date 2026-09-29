# selfroom-4649: another computer of the same account joins a project's shared room (kosmos#4649)

## Why
Weekend goal #4647: all four of Josh's computers on one Kosmos, run from his laptop. #4649 milestone 3 turns on
the built-but-hidden federation. A person's OWN other computer must be able to sit in a project's shared room
without an outside invite: an account cannot redeem its own invite (the coordinator refuses `SelfJoin`), and
it needs none.

## The pieces this rests on (other branches)
- Coordinator (kosmos-relay #213, ownroom-4649): `POST /v1/mac/federation/own-room-ticket {project_ref}` mints
  a seat in `derive_room(caller's own account, project_ref)`, the same room invited guests reach by edge.
- Mac connector (kosmos-relay fedseat-4649, Baron): `fed-room --own-project <ref>`, mac-request allowlisted.
  Until it ships, an old connector exits 2 and the board says the connector is too old.

## This branch (app only)
1. **engine** (`engine/federation.js`, `engine/fedseats.js`): a `self` link role. A self link seats
   `fed-room --own-project <ref>` (remote.fedSeatArgs). An owner marked `selfShared` sits in its own room even
   with no guest, so its other computers have it to talk to; a never-shared owner still waits for a guest.
2. **own code**: `federation.ownCode/parseOwnCode`, `kosmos-own:` + base64url `{v, ref, name}`. It carries no
   secret: an own-room ticket is only ever minted for the caller's OWN account, so the code pasted on someone
   else's computer opens their own empty room, never this one.
3. **join**: an own code verifies and joins with no coordinator call, records a self link and a room note.
   Already here = 409 `already_joined` ("This project is already on this computer.").
4. **route**: `POST /api/federation/own-code {project}`: screen-only (403 to a process), 404 for a project not
   here, 409 for a guest project. Returns `{code}` and marks the owner selfShared.
5. **UI**: "Your other computers" in an existing project's settings, below Webhooks, behind the same
   `data-fed-ui` gate as the invite panel; calls own-code, shows the code with Copy. The join side needs no
   UI change. Browser check `docs/browser-checks/render-owncode-4649.js`.

## Decided, not missed
- **Own-computer rows still read External** in a shared room. The board cannot tell your computer from a
  guest: same room, and the relay delivers sender-written bytes. Labelling from a sender claim would let a
  guest impersonate your computer. Filed as #4657 (relay-stamped same-account bit).
- **Own-only rooms are never sealed.** Sealing for same-account computers after an outside invite seals a room
  (a human-checked Allow with a match code) is #4658; it does not block the weekend. Until then the own-code
  route REFUSES (409 `sealed`) a project that has handed out a sealing invite: a computer joined by own code
  has no seal state, so in a sealed room it could neither read nor post (review iteration 1).
- **"Add your other computer" still shows on a project joined from someone else.** The page is not told a
  project's share role; pressing it gets a 409 that says why in one sentence. Deferred, not missed.

## Done means
Unit tests (fedseats, federation-owncode, server.federation-3311, web.api-routes-3957), the browser check in
chromium and webkit, the full validation, a converged challenge loop; then the live 4-computer run (#4647).
