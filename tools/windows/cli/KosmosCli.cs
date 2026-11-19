// kosmos.exe: the Windows agent's `kosmos` command for callers that are NOT a shell
// with its own shim (kosmos#8770). Shipped as <zip>\bin\kosmos.exe beside kosmos.ps1
// (PowerShell) and the extensionless kosmos (Git Bash), by tools/build-kosmos-windows.sh.
//
// WHO RUNS THIS ONE (measured on the Windows box, all three files in one folder):
// Windows PowerShell 5.1 and pwsh 7 still resolve a bare `kosmos` to kosmos.ps1, and
// Git Bash to the extensionless shim. cmd.exe, a scheduled task, and node's
// child_process spawn('kosmos', args) WITHOUT a shell resolve to this exe. Before it,
// all of those failed with "'kosmos' is not recognized", and a script that read that
// failure as an empty answer took "no agents" for the truth.
//
// WHY AN EXE AND NOT A .cmd: cmd re-parses %* inside a batch file, so a caller that
// escaped correctly for ONE parse (`kosmos msg x a^&calc`) has the caret eaten by its
// own parse and the batch line then runs `calc` (the "BatBadBut" class; node refuses
// to spawn a .cmd without a shell for this reason). A .cmd was shipped once and
// removed for exactly this. This program is started by CreateProcess with the
// caller's argv; the CLR splits it by the Windows rules every launcher writes for.
//
// WHAT IT DOES, and nothing more: the words go to kosmos-cli.js as JSON in a private
// temp file named by --kosmos-argv-file, exactly as kosmos.ps1 sends them, so no
// second command line ever carries them (a message may hold quotes, &, %, newlines).
// node runs with this process's own stdin, stdout and stderr, so piped input and
// captured output both work, and the CLI's exit code comes back unchanged (0, 1, 2,
// 3 for "maybe"). A failure here is exit 1 with a sentence on stderr.
//
// COMMITTED, NOT BUILT DURING THE CUT, and signed, like Kosmos.exe: see
// tools/windows/README.md ("The kosmos command for other launchers").
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class KosmosCli
{
    static int Main(string[] args)
    {
        string argvFile = null;
        try
        {
            string bin = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.GetFullPath(Path.Combine(bin, @"..\runtime\node.exe"));
            string cli = Path.Combine(bin, "kosmos-cli.js");
            if (!File.Exists(node)) return Fail("the runtime is missing (" + node + ")");
            if (!File.Exists(cli)) return Fail("the command is missing (" + cli + ")");

            argvFile = Path.Combine(Path.GetTempPath(), "kosmos-argv-" + Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(argvFile, JsonArray(args), new UTF8Encoding(false));

            var psi = new ProcessStartInfo
            {
                FileName = node,
                // Two paths only, each quoted; a Windows path cannot contain a quote, and
                // neither ends in a backslash, so this line needs no further escaping.
                Arguments = "\"" + cli + "\" --kosmos-argv-file \"" + argvFile + "\"",
                UseShellExecute = false,
            };
            using (var p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception e)
        {
            return Fail(e.Message);
        }
        finally
        {
            // kosmos-cli.js deletes the file as soon as it has read it; this is the backstop.
            if (argvFile != null) { try { File.Delete(argvFile); } catch { } }
        }
    }

    static int Fail(string why)
    {
        Console.Error.WriteLine("kosmos could not run: " + why);
        return 1;
    }

    // A JSON array of strings. Every character JSON requires escaped is escaped; the
    // rest go as UTF-8 text, which the file is written in.
    static string JsonArray(string[] words)
    {
        var sb = new StringBuilder("[");
        for (int i = 0; i < words.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append('"');
            foreach (char c in words[i] ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
        return sb.Append(']').ToString();
    }
}
