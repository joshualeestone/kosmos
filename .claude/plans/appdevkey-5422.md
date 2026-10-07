# appdevkey-5422: the Kosmos app signs in with this computer's device key (kosmos#5422, step 2, app half)

kosmos-relay#297 gives the tunnel `signin start|verify --device-key <file>` and `signin device-id --device-key <file>`,
and makes the page on a computer's own address sign in with a `k1.` id. This branch makes the app match.

## Changes (engine/remote.js)
1. DEVICE_ID accepts exactly `k1.` + 32 base64url as well as the older opaque shape. Without it a keyed browser's
   request is dropped from the Mac's pending list and allow/deny refuse it (the tunnel and coordinator accept it).
   Exactly that shape: a dot never lets `../x` through.
2. Sign-in device arguments, asked of the tunnel on every start, and on every verify whose key file exists (a verify
   with the key file gone never asks, since the ask would make a key) (`signin device-id --device-key
   <state dir>/signin-device.key`), with no memo (a Forget removes the key file; a passing failure must not stick).
   A `k1.` answer: `--device-key`. Exit 2 with clap's unknown-subcommand words ( measured on two older builds: "unrecognized
   subcommand 'device-id'"): the opaque `--device-id`, as before. Anything else refuses the sign-in in words: a
   fallback would sign in as another device, and a `k1.` id is never sent without its key. The key file is
   deterministic, so a start and its verify name one device, across a restart too.
3. remote.json: `device_id` is the id of the last start or verify the coordinator took (either kind of id is recorded only then; a freshly minted opaque id is kept among the past ids meanwhile, so a restart reuses it; the exception: with no valid id in use at all, a fresh install or a hand-edited id, the minted one is the id in use at once); the
   ids before it are kept, newest first and never trimmed, in `past_device_ids`. The pending list hides all of them (#4610: this computer's earlier rows stay pending at the
   coordinator). An older tunnel after a key uses the kept opaque id, never the key id without its proof.
4. The device key survives clearing an unfinished earlier sign-in (the folder is emptied around it; the key file is never moved or rewritten), and Forget waits for a
   device-key ask in flight (it may be making the key in the folder Forget empties).
5. Start and verify take the cancel epoch before anything is awaited and check it, and busy(), after the device
   arguments come back.

## Order with kosmos-relay#297
This merges first; #297 is held until it does (comment on #297).

## Known limits
- Migration: a computer that updates signs in as a new device (its key's id) and is allowed once, as the design accepted.
- A tunnel replaced between a start and its verify (older to newer, or back) names another device on the verify,
  which the coordinator refuses; the person asks for a new code.
- A remote.json repair (an unreadable file) puts back the id and past ids this PROCESS last used; a repair in a
  process that never signed in has none to put back.
- A verify never makes a key: with the key file gone it says start again (a Forget between start and verify).

## Tests (engine/remote.test.js unless named; names carry kosmos#5422)
- devkey tunnel: start and verify pass the same key file in the state dir and no id; remote.json moves the ids.
- older tunnel (exit 2 + clap's words): opaque id, no key file; an exit 2 without the words refuses.
- after a key, an older tunnel uses the kept opaque id, and moves the id in use only once a start is taken.
- a key that cannot be opened refuses in words (control: an older tunnel signs in).
- a new key keeps the older key id; a start the coordinator does not take leaves the id; a verify it takes records it.
- damaged remote.json: the repair keeps the key id and the ids before; key gone still says start again.
- verify with the key file gone sends nothing; a cancel during the ask sends no start.
- Forget waits for the ask and for a keyed start (bounded; a start that never returns cannot hold it).
- the folder is owner-only from the first ask; the key survives clearing an unfinished sign-in (same content, same file).
- the pending list and server.test.js's allowed list hide every own id; allow accepts exactly the k1 shape.
- remote-unreadable-4308.test.js and server.test.js fakes act as older tunnels for device-id.
