# allowedon-4794: the device list says which computer allowed a device (kosmos#4794 app half, piece 2)

## What
Part C (#4794, Kitty's tunnel side) lets a phone allowed on one of the person's computers reach the others. The
device list on each computer then holds devices it did not allow itself. Contract agreed with Kitty on the card
(comment 5927239968, accepted in her reply): `kosmos-tunnel devices list` gains `allowed_on`, the NAME of the
computer that allowed the device, or null when this computer allowed it.

- engine/remote.js devicesList passes `allowed_on` through: a non-blank string trimmed and cut to 60 (like a device
  name), else null. A tunnel without part C sends nothing, which reads as null.
- web/index.html paintDevices prefixes the meta line with "allowed on <name> · " when it is set. A device this
  computer allowed reads exactly as before.

## Not in this branch
- Piece 1 (Allow disabled while a computer's SAS code is still "") edits the connect sheet, which is in #4805
  (unmerged). It follows #4805.
- The joining computer's screen (#4773 app half): waits for the relay PR in the bundled binary (decided on #4773).
- The Remove confirmation's copy under part C (removing here removes everywhere) is Mona's, and only true once part C
  lands.

## Proof
- engine/remote.test.js: allowed_on carries a name; null, a number and a blank all read null; a long name is cut to
  60; the plain list (no field) reads null. CONTROL run: without the engine line the #4794 test fails.
- render-plus-panel-3829.js (gated): a device stubbed with allowed_on "windowsbox" reads "allowed on windowsbox · let
  in ..."; one with allowed_on null and one with no field do not. Run: 112 PASS, 0 FAIL. CONTROL run with the page
  line removed: exactly the five #4794 arms FAIL.

## Weakest premise
That the name the tunnel sends is safe to show as text. It is escaped (askEsc) and cut to 60; it comes from the peers
file the person's own pairing wrote, not from the server.
