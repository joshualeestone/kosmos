# pushdoc-3764: phone-push-go-live.md matches the live coordinator (kosmos#3764)

Docs only: docs/phone-push-go-live.md. Every change rests on a measurement taken on 2026-09-25:
- the live build is 59b0962 (/v1/meta); kosmos-relay #103, #104 and #109 are ancestors, and so is 2226c9d;
- https://login.kosmosplus.com/.well-known/assetlinks.json answers 200 with no redirect, as application/json,
  with the upload key only;
- the env template on kosmos-relay main sets no KOSMOS_PUSH, and its APNs lines are commented out. It has
  20 live assignments, and the 15:17 deploy that made 59b0962 live measured the box env identical, 20 of 20 (kosmos#3763).
  So production sends web push for real and refuses app registrations. Steps 2 and 3 are not done.
Changes: "Where things stand today", step 3's status, step 5's asset-links item, and the provenance line.
