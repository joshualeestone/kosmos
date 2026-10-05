# hookcase-5351: the webhook shape test's uppercase-id probe can no longer be the real link

Finished means: server.webhooks-1307.test.js's "uppercase id" probe always differs from the real id, so the test cannot
send the genuine link and read its correct 201 as a hole. Seen on PR #5339 CI (run 37367759355): id 2834148935575025,
all digits, unchanged by toUpperCase(); odds (10/16)^16, about 1 run in 1,850.

Change: when the id has no a-f letter, the probe puts an uppercase hex letter in it ('A' + the rest); otherwise it is
the id uppercased, as before. An assertion pins that the probe differs from the real id.
Control (node -e on the failing id): old probe == real id (true); new probe A834148935575025 differs and fails the
server's HOOK_CALL_RE id shape [0-9a-f]{16}, so it still tests "an uppercase hex id is refused". The file passes 39/39.
Weakest premise: none of substance; the server is untouched.
