# golive-facts-718: the go-live checklist catches up with Android merges

Card: #718. Source: Sonya (m504), each fact re-checked before writing.

## Finished means
docs/phone-push-go-live.md states what is now true:
- kosmos #3644 merged 2026-09-24T22:20Z (checked with gh);
- Liu Kang kept `io.kosmos.app`, which Josh can still override before the first upload (Sonya
  relaying Liu Kang; `android/app/build.gradle` on main reads `applicationId "io.kosmos.app"`);
- kosmos-relay #109 merged 2026-09-24T22:03Z and adds `coordinator/src/assetlinks.rs`, but
  production is still build 2226c9d and `https://login.kosmosplus.com/.well-known/assetlinks.json`
  answers 404 (measured);
- the route serves the upload key only, from the code constant `CERT_SHA256_FINGERPRINTS`, so the
  Play key needs a relay PR plus a deploy.

## Decision
A separate PR from bundle-guard-718 (#3653), which had already converged; folding these edits into
it would have reopened its review. The two touch different steps of the same file.

## Weakest part
The applicationId decision is relayed (Liu Kang through Sonya), not read from a ruling on the card.
