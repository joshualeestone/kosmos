# appdevkey-5422: the Kosmos app signs in with this computer's device key (kosmos#5422, step 2, app half)

kosmos-relay#297 gives the tunnel `signin start|verify --device-key <file>` and `signin device-id --device-key <file>`,
and makes the page on a computer's own address sign in with a `k1.` id. This branch makes the app match.

## Changes (engine/remote.js)
1. DEVICE_ID accepts exactly `k1.` + 32 base64url as well as the older opaque shape. Without it a keyed browser's
   request is dropped from the Mac's pending list and allow/deny refuse it (the tunnel and coordinator accept it).
   Exactly that shape: a dot never lets `../x` through.
2. Sign-in device arguments, asked of the tunnel on EVERY start and verify (`signin device-id --device-key
   <state dir>/signin-device.key`), with no memo (a Forget removes the key file; a passing failure must not stick).
   A `k1.` answer: `--device-key`. Exit 2 with clap's unknown-subcommand words ( measured on two older builds: "unrecognized
   subcommand 'device-id'"): the opaque `--device-id`, as before. Anything else refuses the sign-in in words: a
   fallback would sign in as another device, and a `k1.` id is never sent without its key. The key file is
   deterministic, so a start and its verify name one device, across a restart too.
3. remote.json: `device_id` is the id of the last start the coordinator took (a key's id is recorded only then); the
   ids before it are kept, newest first and never trimmed, in `past_device_ids`. The pending list hides all of them (#4610: this computer's earlier rows stay pending at the
   coordinator). An older tunnel after a key uses the kept opaque id, never the key id without its proof.
4. Start and verify take the cancel epoch before anything is awaited and check it, and busy(), after the device
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

## Tests (engine/remote.test.js, names carry kosmos#5422)
- a key that cannot be opened refuses in words, sends no start (control: an older tunnel signs in).
- a new key keeps the older key id among this computer's own; a cancel while start asks the tunnel sends no start.
- devkey tunnel: start and verify pass the same key file in the state dir, no id; asked once; remote.json moves ids.
- older tunnel: opaque id, no key file, stored id unchanged.
- after a key, an older tunnel uses the kept opaque id (control: none kept, one is made, key id stays).
- allow accepts a k1 id and refuses near misses and `../evil`.
