# #3073 part 4: served_verify_asset_ok is HEAD-first (large-artifact served-verify)

**Branch:** `served-verify-head-3073` · **Card:** kosmos#3073 part 4 (deferred to Baron, the
release/deploy pipeline owner, by the #3098 deploy-guard PR).

## The problem

`served_verify_asset_ok` (`tools/lib/served-verify.sh`) checks that an asset is SERVED with a 200
and a non-html content-type (the #1667 "html page wearing a success code" guard). It did this with
`curl -sSL -o /dev/null`, which discards the body but still TRANSFERS it. deploy-site.sh calls it on
the multi-hundred-MB Windows zip (`deploy-site.sh:457`), so every deploy pulled that whole zip over
the wire just to read a status line and a content-type.

Crucially, this function does NOT verify bytes. The Windows zip's byte integrity is verified
separately and locally, against its committed manifest/.sha256 (`deploy-site.sh:207-218`), never by
downloading the served body. So asset_ok only needs STATUS + CONTENT-TYPE, both of which are in a
HEAD response's headers.

## The change

Make `served_verify_asset_ok` HEAD-first:
- Issue a `curl -sSLI` HEAD probe. If it returns an UNAMBIGUOUS success -- a 200 with a non-empty,
  non-html content-type -- return 0 without ever transferring the body.
- On ANY other outcome (non-200, empty/absent content-type, an html page wearing a 200, a 405/501
  where the server does not implement HEAD, or a transport error) fall through to the EXISTING GET
  path, unchanged. The GET path keeps sole ownership of the detailed failure messages and the
  redirect note.

**Never-worse:** every failure/ambiguous case degrades to exactly today's full-GET behavior. The
only new fast path is the clean-success case, which is precisely the case where the old code would
also have returned 0 -- now without the transfer.

## Why it does not weaken anything

- Byte integrity is checked locally against the manifest/.sha256, not here. A HEAD carries the same
  status and content-type a GET would, so the #1667 protection (reject a 200 carrying text/html) is
  preserved -- an html page wearing a 200 on HEAD falls through to the GET path, which emits the
  #1667 message and refuses.
- The extra HEAD is a header-only round-trip and does not invoke a GET handler, so a stateful
  server's GET-keyed behavior is unperturbed. The frozen `test-served-verify.sh` (do_GET-only mock)
  stays green precisely because a HEAD to it returns 501 and falls through to GET -- verified by
  running it.

## Tests

New, ISOLATED file `tools/test-served-verify-head-3073.sh` (wired into `test:shell` in the same
commit), with its own HEAD-aware mock that logs the request method the server actually saw:
- Fast path: a HEAD 200 + application/zip returns 0, and NO GET reaches the asset (the body is not
  transferred) -- the whole point, asserted by request-method logging, with a control proving the
  GET route would have served a real body.
- #1667 preserved: a 200 carrying text/html on HEAD still refuses (rc 1) and falls through to GET.
- Fallback (405 HEAD unsupported): falls through to GET and passes on the 200 zip.
- Fallback (200 HEAD with no content-type): an empty content-type is ambiguous, so it falls through
  to GET rather than being trusted.

The frozen `tools/test-served-verify.sh` is deliberately left UNTOUCHED (its handler-extraction
meta-guards and formatting-frozen fixtures must not be perturbed); it stays green under this change.

## Weakest premise

The real residual is an assumption, not the speedup: **that HEAD and GET agree** for a given URL --
same status, same content-type. There is exactly one input class where HEAD-first is weaker than the
old full GET: a server that answers a HEAD with `200` + a non-empty, non-html content-type while its
GET would refuse (a non-200, or a `text/html` body). The old code always issued the GET (body
discarded via `-o /dev/null`) and would have caught that; the fast path trusts the HEAD and returns 0.

Why this is bounded, and a WARNING rather than a hole:
- The URLs checked here are static, CDN-served release artifacts (the Windows zip, its .sha256, the
  pointers, /setup). For those, a compliant CDN returns the same status + content-type on HEAD as on
  GET (RFC 9110 requires it), so the divergence is not expected.
- Byte integrity is NOT checked here anyway -- it is verified locally against the manifest/.sha256 --
  so a HEAD/GET disagreement could at worst let a wrong-status or html-bodied response pass this
  presence check, never ship unverified bytes.
- The realistic #1667 shape is expected to be preserved: an SSO/login wall is believed to return
  `text/html` or an empty content-type on **both** HEAD and GET (not measured against a real SSO
  wall on HEAD), so it should fall through to the GET path and be refused there.

The performance win (skipping the body transfer) is separately CDN-dependent: if a CDN omits the
content-type on HEAD, or 405/501s it, the fallback fires and behavior is exactly today's -- correct,
just not faster for that asset. So the speedup degrades safely; the correctness residual is the
HEAD/GET-agreement assumption above, bounded as described.
