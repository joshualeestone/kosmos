# filebrowser-6724: browse an agent's Files from another computer

Card: kosmos#6724 (Josh, #admin 2026-10-20 08:58). Viewing a board remotely, "Open in Finder" opens a window on the
far Mac. Asked: hide those actions when viewed remotely; an in-app, read-only browser for the agent's folder
(folders and files, size and date, preview of images, PDFs and text, download a file and a folder as a zip); the same
limits as the Files list (the agent's own folder, no paths outside it, no link escapes), with a test per escape.

## What exists (measured from the code, 2026-10-20)
- `GET /api/agent/:name/files` lists the agent's Files folder (`dmfiles.filesDir`), FLAT (`listFiles`, `maxDepth: 0`).
- preview, download and reveal-file go through `listedFileVerb` -> `filepreview.resolve` ->
  `projects.resolveListedFile(listed)`: shape gate, an lstat walk (no link, no hidden or skipped folder, depth),
  realpath inside the realpath'd folder, resolved path equal to the walked path, the read handle checked with
  `sameOpenedFile` (O_NOFOLLOW, O_NONBLOCK). Files itself being a link is refused by the route.
- Preview covers images and a PDF's first page; text is not previewed. Nothing in the repo writes a zip.
- The page knows it is remote by its own hostname (`kplusRemote()`); over Kosmos+ the Finder buttons stay on screen
  and say "That folder is on the computer Kosmos runs on..." when clicked.

## Decisions
1. **Which folder:** the agent's Files folder, the one its Files list already shows, now with its subfolders. NOT the
   agent's whole working folder (instructions, memory, worktrees). Rejected: the whole folder, because it holds the
   agent's instructions and working state, which the card does not ask to expose over the remote link.
   Weakest premise: that "the agent's folder" in the card means Files. If Josh wants more, widening the root is a
   small follow-up; narrowing one already exposed is not.
2. **Browsing:** `GET /api/agent/:name/files/browse?dir=<rel>` answers one level: `dirs` and `files`, the files named
   by their path relative to Files (the names preview, download and open already take). The folder is resolved by a
   new `projects.resolveListedDir`, the folder twin of `resolveListedFile`: the same shape gate, the same lstat walk
   (every segment a real folder, never a link, never a hidden or skipped one), realpath equal to the walked path and
   inside the folder. Depth cap `AGENT_BROWSE_DEPTH = 8` below Files. At most 1000 entries per folder (`truncated`).
3. **Preview and download reach subfolders:** the agent route's `maxDepth` goes from 0 to `AGENT_BROWSE_DEPTH`, so any
   file the browser shows can be previewed and downloaded, and nothing it does not show. The narrow-panel list stays
   flat (its own test still holds). The test that pinned "a file below the top level is refused" for the agent is
   changed on purpose, with this reason.
4. **Text preview:** `filepreview.preview` answers a text file (attachments' `kindOf` text extensions) with its first
   256 KiB as `text/plain; charset=utf-8`, from the same checked handle, under the same sandbox CSP and nosniff. A file
   with a NUL byte in that head is not text and is refused. `x-kosmos-preview-cut: 1` says it was cut. Shared with
   project lists (one preview module).
5. **Folder as zip:** `GET /api/agent/:name/files/download-folder?dir=<rel>` streams a zip of that folder (all of Files
   when `dir` is empty). The walk applies the browser's rules (no links, no hidden or skipped names, the depth cap).
   Every file is gated again at read time by `resolveListedFile(listed)` and its handle checked with
   `sameOpenedFile`. Entries are STORED (no compression), so the length is known before the first byte:
   `content-length` is sent, and a file whose size changed mid-download ends the connection rather than sending a
   wrong zip. Caps: 2000 files, 1 GiB in all (no ZIP64 needed). Over a cap is a refusal with the reason, before any
   byte. `?check=1` answers 204 or the refusal, like the file download. UTF-8 names (flag bit 11).
   Rejected: deflate (needs the compressed size up front, or data descriptors, which some unzippers mishandle for
   stored entries; agents' Files are mostly PDFs and images, which do not compress).
6. **Remote:** every button that opens a folder window on the board's computer carries `data-remote-hide`, and
   `html[data-kplus-remote]` (set at load when `kplusRemote()`) hides them. The handlers keep their sentence as a
   backstop. Buttons: `#d-files-finder`, `#docs-finder`, `#pjs-reveal`, `#pjs-chats-reveal`, `#tk-chats-reveal`,
   `#set-reveal`, `#upd-open-folder`.
7. **The Files screen becomes the browser:** a path line (Files / sub / ...), folders first, then files with size and
   date; a folder row opens it; a file row previews (image, PDF, text), else opens on the computer (local) or
   downloads (remote), as today. "Download folder" in the head downloads the folder being shown as a zip.
8. **Read-only.** No upload, rename or delete (upload is a separate card).

## Tests (a test per escape)
`server.filebrowser-6724.test.js`, against a sandboxed board like `server.file-download-5165.test.js`:
browse and zip each refuse `..`, `a/../..`, an absolute path, a backslash, an empty segment, a dot folder, a link to a
folder outside, a link to a folder inside, a skipped folder (`node_modules`), its other case on macOS, a file named as
a folder, past the depth cap, and a Files that is a link; a link inside a listed folder is not listed, previewed,
downloaded or zipped; cross-site reads are refused; the board token is required. The zip is read back with the
repo's own zip reader (`engine/win32zip.js`) and must hold exactly the listed files' bytes.
`web.filebrowser-6724.test.js`: each Finder button carries `data-remote-hide`, the CSS rule exists, the page sets
the attribute only when remote.
