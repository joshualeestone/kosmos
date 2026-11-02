# sealworker-7746: the backup manifest is sealed off the board's main thread (kosmos#7746 item 1, last part)

Finished means: at the top plan, sealing a manifest no longer freezes the board for seconds; the sealed bytes open to exactly what an in-process seal opens to; and a worker that cannot run never means no seal.

Measured (477,000 chunks, a 117 MiB manifest, a 10 ms timer, the in-process seal as the control on the same runs): in-process 1.6 to 1.8 s in one block; sealOffThread 1.8 to 1.9 s in total with a longest stall of 225 to 232 ms (the JSON.stringify left on the main thread). Opened, the two seals deep-equal each other and the original manifest.

Decided:
- The worker gets the manifest as one JSON string, not the object: handing the object costs a 464 ms synchronous structured clone (measured on #7746) before the worker starts. The worker parses it and calls the same sealManifest.
- A worker that cannot start, or ends without answering, seals in process (as before this change). A seal error in the worker rejects with the seal's own message, as a throw here would.
- One worker per seal, ended once it answers (once a run).
Tests, each red without its part: the worker's seal opens to the in-process one (red when the worker seals under another context); a missing worker file still seals (red without the fallback); a refused manifest gives the same message.
Weakest premise: that JSON.stringify and JSON.parse carry the manifest unchanged. They do for every value canonicalJson accepts (plain objects, strings, safe integers, arrays), and the snapshot builds only those. A value outside that set would be changed by the round trip instead of refused, but the snapshot cannot produce one.
