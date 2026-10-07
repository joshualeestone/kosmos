# appdevkey-5422: the Kosmos app signs in with this computer's device key (kosmos#5422, step 2, app half)

kosmos-relay#297 gives the tunnel `signin start|verify --device-key <file>` and `signin device-id --device-key <file>`,
and makes the page on a computer's own address sign in with a `k1.` id. This branch makes the app match.

## Changes (engine/remote.js)
1. DEVICE_ID accepts exactly `k1.` + 32 base64url as well as the older opaque shape. Without it a keyed browser's
   request is dropped from the Mac's pending list and allow/deny refuse it (the tunnel and coordinator accept it).
   Exactly that shape: a dot never lets `../x` through.
2. Sign-in device arguments: ask the tunnel once per process (`signin device-id --device-key
   <state dir>/signin-device.key`). A `k1.` answer: start and verify pass `--device-key`. Anything else (an older
   tunnel refuses the verb): the opaque `--device-id`, as before. The release bundles whichever tunnel is in dist and
   nothing pins the pair, so the app must work with both.
3. remote.json: `device_id` becomes the key's id; the opaque id moves to `legacy_device_id`. The pending list hides
   both (#4610: this computer's old sign-in row stays pending at the coordinator and must not ask to be allowed).
   A fallback after a key uses the opaque id, never the key id without its proof.
4. signinVerify takes its cancel epoch before anything is awaited (the probe made the arguments async).

## Order with kosmos-relay#297
This merges first; #297 is held until it does (comment on #297).

## Known limits
- Migration: a computer that updates signs in as a new device (its key's id) and is allowed once, as the design accepted.
- A probe that fails for another reason on a new tunnel (a corrupt key file) falls back to the opaque id for that
  process, silently. Its self-allow (allowSelfQuietly) then targets the key id, not the session's id.

## Tests (engine/remote.test.js)
- devkey tunnel: start and verify pass the same key file in the state dir, no id; asked once; remote.json moves ids.
- older tunnel: opaque id, no key file, stored id unchanged.
- after a key, an older tunnel uses the kept opaque id (control: none kept, one is made, key id stays).
- allow accepts a k1 id and refuses near misses and `../evil`.
