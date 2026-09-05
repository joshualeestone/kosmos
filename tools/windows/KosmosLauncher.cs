// Kosmos.exe -- the Windows launcher, as a SIGNABLE binary.
//
// WHY THIS EXISTS. The shipped entry point is Kosmos.cmd, and a .cmd file
// CANNOT carry an Authenticode signature -- measured, not assumed:
// Get-AuthenticodeSignature on a .cmd returns UnknownError, because batch files
// have nowhere to put one. So the certificate Josh is buying would have had
// nothing to sign: the only file a user double-clicks is the one file in the
// package that is structurally unsignable. A PE binary can be signed, so the
// entry point has to become one before a certificate buys anything.
//
// WHAT IT DOES, deliberately nothing more: exactly what Kosmos.cmd did.
//   1. launch open-board.js (the #2007 authenticated-open helper) detached
//   2. run app/server.js in the foreground, sharing this console
//   3. propagate its exit code, and hold the window open on failure
// It adds no behaviour. A launcher that starts doing its own thinking is a
// second place for Windows-only bugs to live, and the whole point of this file
// is to REMOVE a Windows-only problem.
//
// It is a .NET Framework console app because every Windows 10/11 machine ships
// the 4.x runtime -- no dependency to install, no bundled runtime to sign.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class KosmosLauncher
{
    // Kept in step with tools/build-kosmos-windows.sh, which prints the same
    // number into the .cmd and the READ ME. One default, two files, and this is
    // the third -- if it ever drifts, the launcher opens a port nothing serves.
    const int DefaultPort = 16180;

    static string Here()
    {
        // The EXE's own directory, not the working directory: a user can launch
        // this from a shortcut, from Explorer, or from a shell sitting anywhere,
        // and %~dp0's equivalent has to be the binary's location in all three.
        return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    }

    static int Fail(string what)
    {
        Console.Error.WriteLine();
        Console.Error.WriteLine("Kosmos could not start: " + what);
        Console.Error.WriteLine();
        Console.Error.WriteLine("This usually means the folder was only partly unpacked.");
        Console.Error.WriteLine("Unpack the whole zip again, keeping the folders together,");
        Console.Error.WriteLine("and run Kosmos again from the unpacked folder.");
        Hold();
        return 1;
    }

    // âš ï¸ ONLY when a console would vanish and take the message with it. A user
    // who double-clicked gets their own window, so an unheld failure prints into
    // a window that closes instantly -- which is how a real error becomes "it
    // just didn't do anything". A user who ran it from an existing shell keeps
    // their scrollback, so holding there is a nuisance instead of a rescue.
    static void Hold()
    {
        if (!ConsoleWasOurs()) return;
        Console.Error.WriteLine("Press any key to close this window.");
        try { Console.ReadKey(true); } catch { /* no keyboard: never block a service or a pipe */ }
    }

    static bool ConsoleWasOurs()
    {
        // A console this process created has exactly one attached process: us.
        // Inherited consoles (cmd, PowerShell, Windows Terminal) have at least two.
        uint[] procs = new uint[4];
        int n = GetConsoleProcessList(procs, procs.Length);
        return n == 1;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    static extern int GetConsoleProcessList(uint[] processList, int processCount);

    static int Main(string[] args)
    {
        string here = Here();
        string node = Path.Combine(here, "runtime\\node.exe");
        string server = Path.Combine(here, "app\\server.js");
        string opener = Path.Combine(here, "open-board.js");
        string app = Path.Combine(here, "app");

        if (!File.Exists(node)) return Fail("the bundled runtime is missing (runtime\\node.exe).");
        if (!File.Exists(server)) return Fail("the application is missing (app\\server.js).");

        int port = DefaultPort;
        string env = Environment.GetEnvironmentVariable("PORT");
        if (!string.IsNullOrEmpty(env))
        {
            int parsed;
            // âš ï¸ A bad PORT is IGNORED, not fatal. The server reads PORT itself and
            // applies its own default; refusing to start here would turn a stray
            // environment variable into "Kosmos is broken" on a machine where the
            // server would have come up fine.
            if (int.TryParse(env, out parsed) && parsed > 0 && parsed < 65536) port = parsed;
        }

        // The opener waits for the board itself and falls back to the plain url,
        // so it is safe to start BEFORE the server is listening -- that is the
        // #2031 design and the .cmd relied on it too.
        if (File.Exists(opener))
        {
            try
            {
                ProcessStartInfo o = new ProcessStartInfo(node,
                    "\"" + opener + "\" --port " + port + " --app \"" + app + "\"");
                o.UseShellExecute = false;
                o.CreateNoWindow = true;
                o.WorkingDirectory = here;
                Process.Start(o);
            }
            catch (Exception e)
            {
                // Not fatal: the board is what matters, and the user can reach it
                // by hand. Say so rather than dying with the board about to work.
                Console.Error.WriteLine("Kosmos could not open your browser (" + e.Message + ").");
                Console.Error.WriteLine("Open http://127.0.0.1:" + port + " yourself.");
            }
        }

        Console.WriteLine("Starting Kosmos. A browser will open in a moment.");
        Console.WriteLine("If it does not, open http://127.0.0.1:" + port + " yourself.");
        Console.WriteLine();

        ProcessStartInfo s = new ProcessStartInfo(node, "\"" + server + "\"");
        s.UseShellExecute = false;   // share this console: the server's own output IS the status
        s.WorkingDirectory = here;

        Process p;
        try { p = Process.Start(s); }
        catch (Exception e) { return Fail("the runtime would not start (" + e.Message + ")."); }

        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            Console.Error.WriteLine();
            Console.Error.WriteLine("Kosmos stopped. The lines above say why.");
            Hold();
        }
        return p.ExitCode;
    }
}
