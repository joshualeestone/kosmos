# The Windows launcher

`Kosmos.exe` is the file a Windows user double-clicks. It is committed here as a
binary, next to the source it was built from and a script that proves the two
match.

## Why a binary is in the tree at all

The shipped entry point used to be `Kosmos.cmd`, and **a `.cmd` file cannot carry
an Authenticode signature** — measured, not assumed: `Get-AuthenticodeSignature`
on a `.cmd` returns `UnknownError`, because a batch file has nowhere to put one.

So the certificate we are buying would have signed nothing a user ever sees: the
only file they double-click was the one file in the package that is structurally
unsignable. A PE binary can be signed. The entry point had to become one before a
certificate bought anything.

`KosmosLauncher.cs` therefore does **exactly** what `Kosmos.cmd` did and nothing
more — start the browser-open helper, run the board in the foreground, propagate
its exit code, hold the window open on failure. A launcher that starts doing its
own thinking is a second place for Windows-only bugs to live, and the whole point
of this file is to remove a Windows-only problem.

It targets .NET Framework 4.x, which ships in-box on every Windows 10 and 11
machine: no runtime to install, and no bundled runtime to sign.

## Why it is committed rather than built during the release

The release lane runs on a Mac. Compiling this during a cut would make a Windows
machine a dependency of every release, and the Windows box is kept stopped. So the
binary is committed and `tools/build-kosmos-windows.sh` copies it in.

That trade is only acceptable because the binary's provenance is **checkable**. A
committed binary nobody can regenerate is an opaque blob; one anybody can
regenerate from the source beside it is not.

## Verifying it

On a Windows machine, from the repo root:

```
powershell -File tools/windows/verify-launcher.ps1
```

Exit 0 means the committed `Kosmos.exe` reproduces from the committed
`KosmosLauncher.cs`.

### Why the comparison is masked

**This binary is not byte-reproducible, and that is a property of the compiler,
not a defect.** The only C# compiler on a stock Windows box is the pre-Roslyn one
shipped with .NET Framework, which has no deterministic switch. Two builds of
identical source, seconds apart, differ — measured, in three fields:

| field | why it varies |
|---|---|
| PE COFF `TimeDateStamp` | wall-clock time of the build |
| optional header `CheckSum` | derived, so it follows the timestamp |
| MVID (16 bytes) | a fresh GUID minted per compile |

Everything else — all the code — is identical. So the check builds twice, lets
those two builds say which bytes this compiler varies, and compares the committed
binary against a fresh one everywhere else.

**The mask is derived on the spot, never hardcoded.** A hardcoded offset list
would be a second copy of a fact about a compiler we do not control: a compiler
update that moved or widened those fields would leave the list masking the wrong
bytes, which is a check that hides the very difference it exists to find. The
script also refuses outright if more than 64 bytes vary between two builds, since
at that point masking would be concealing rather than normalising.

Two details in that script were bugs worth recording, because both produced a
confident wrong answer:

- **Both rebuilds must be named `Kosmos.exe`.** The output file name becomes the
  assembly's module name and is written into the metadata, so building to
  `one.exe` shifts every heap offset after it. That reported ~2300 differing
  bytes for a binary that was in fact correct, and briefly convinced me the
  committed exe did not match its source.
- **The mask is widened to whole 32-bit fields.** Two builds seconds apart
  usually differ only in the *low byte* of each timestamp. The committed binary
  was built at an arbitrary earlier time, so its copy of that field can differ in
  bytes the two reference builds agreed on. If any byte of a 32-bit field varies,
  the field varies.

The check is sensitive: changing `DefaultPort` by one in the source makes it fail
with 2 differing bytes.

## Rebuilding it

If you change `KosmosLauncher.cs`, rebuild the binary **in the same commit**:

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe ^
  /nologo /target:exe /optimize+ /platform:anycpu ^
  /out:tools\windows\Kosmos.exe tools\windows\KosmosLauncher.cs
```

Those flags are the ones `verify-launcher.ps1` uses. If they change, they must
change in both places, and the binary must be rebuilt.

## The port

`DefaultPort` in the source is a **third copy** of the board's default port — the
board owns it, the build script reads it out of `server.js`, and this is the copy
nobody can see because it is compiled in. `tools/build-kosmos-windows.sh` compares
the two and refuses the build on a mismatch, rather than shipping a binary that
opens a browser on a dead port while the board sits there working.

`PORT` in the environment still overrides it at runtime, and a malformed value is
ignored rather than fatal: the board reads `PORT` itself and applies its own
default, so refusing to start here would turn a stray environment variable into
"Kosmos is broken" on a machine where the board would have come up fine.

## Signing

Signing is a **downstream release step**, not something this directory does. The
point of the `.exe` is that a signature becomes *possible*; applying one is a
separate action with its own certificate and its own timing. Unsigned-but-signable
is the current, intended state.

Until it is signed, Windows shows "Windows protected your PC" on first run, and
the package's `! READ ME FIRST` file is what walks a person past it.
