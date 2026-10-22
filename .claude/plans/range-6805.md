# #6805: attachment downloads can resume (Range)

## Finished looks like
A download of `GET /api/attachment/<id>` that is cut part way can pick up where it stopped: the board answers
one byte range with 206 and the matching `Content-Range`, from the same open file and the same measured size
the whole-file answer uses, and a resume can never join the end of one file onto the start of another.

## Decisions
- **Ranges only on the download route**, opted in by an `etag` the route passes to `sendFileStream`. The image
  preview is not ranged: its file is drawn by this computer and can be drawn again, so the same address is
  not guaranteed to be the same bytes. Rejected: ranging every caller (would need a validator for previews).
- **ETag is the attachment id**, strong (`"<id>"`). A stored attachment never changes after it is stored
  (card, "Not asked"), so the id names the bytes. No Last-Modified.
- **If-Range**: present and not exactly our ETag means the Range is ignored and the whole file is sent (200).
  A date in If-Range never matches (we send no Last-Modified), so it also gets the whole file. That is what
  keeps a resume from splicing two files.
- **Parsing (RFC 9110 14.1.2)**, `bytes=` only, case-insensitive unit:
  - `a-b`, `a-`, `-n`; digits only, optional whitespace around the spec.
  - Not that shape (another unit, `b < a`, junk, empty): the header is ignored, 200 whole.
  - More than one range (a comma): ignored, 200 whole (card: no multipart).
  - `a >= size`, or `-0`, or any range of an empty file: 416 with `Content-Range: bytes */size`.
  - `b >= size` is clamped to `size - 1`; `-n` with `n > size` is the whole file, as a 206.
  - Numbers past `Number.MAX_SAFE_INTEGER` are read as unsatisfiable when they are a start, clamped when an end.
- **GET only.** HEAD answers as today (200, full length) plus `Accept-Ranges` and `ETag`.
- Every download answer carries `Accept-Ranges: bytes` and the `ETag`, so a client knows it may resume.
- The short-read and grew-meanwhile guards measure against the range's length, not the file's.

## Tunnel (asked by the card)
kosmos-relay `crates/tunnel/src/proxy.rs` `Gate::forward` (origin/main 0b93a6ab1) copies every request header
except hop-by-hop ones, Host, the board token and the session headers, and on the answer removes only hop-by-hop
headers and the board's credentials. `Range`, `If-Range`, `Content-Range`, `Accept-Ranges` and `ETag` are none of
those. The public relay does not terminate TLS (README), so it cannot see headers. Status: READ FROM SOURCE, not
measured through a live tunnel.

## Not covered here
- iOS Safari resuming on a real phone: needs a phone and a cut connection; recorded on the card for a person or
  the next TestFlight round.

## Tests (server.attachment-range-6805.test.js)
206 for `a-b`, `a-`, `-n` byte-identical to the slice; clamp; 416 shapes; multi-range and junk give 200 whole;
If-Range match gives 206, mismatch and a date give 200; HEAD unchanged plus headers; preview not ranged;
a cut ranged download releases its descriptor; a ranged read of a file that grew sends only the range.
