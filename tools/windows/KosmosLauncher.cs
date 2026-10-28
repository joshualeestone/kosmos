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
// WHAT IT DOES:
//   1. launch open-board.js (the #2007 authenticated-open helper) detached
//   2. run app/server.js, which hands the board to its logon task and exits
//   3. propagate its exit code
// Those three are exactly what Kosmos.cmd did, with the same arguments. The rest
// is how a Windows program presents itself (win32-launcher-native): it is a GUI
// app, so a double-click opens no console window, and a problem is a message
// box titled "Kosmos" instead of console text. `--console` keeps the console
// behaviour for support. It still does no thinking of its own about the board:
// a launcher that does is a second place for Windows-only bugs to live.
//
// AND IT DOES AN INSTALLER'S JOB (win32-installer-native), a deliberate reversal of
// "does nothing more than the .cmd did": the zip has no installer, so the launcher
// gives Kosmos a Start menu entry, an entry in Settings > Apps whose Uninstall runs
// `--uninstall`, and an offer to move out of Downloads. Only the Windows-shell half
// lives here (IShellLink, the registry, Known Folders, the questions). Everything
// that is already a fact in the engine -- the tasks, the data folders, what a build
// is made of, whether a board serves from this folder -- is asked of the engine's
// own helpers (app\engine\win32uninstall.js, win32relocate.js), so there is still
// one copy of each.
//
// It is a .NET Framework app because every Windows 10/11 machine ships the 4.x
// runtime -- no dependency to install, no bundled runtime to sign.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

// FileDescription (AssemblyTitle) is the name Task Manager, the taskbar and
// SmartScreen's "App:" line show. AssemblyCompany is deliberately absent: it has
// to match the subject of the code-signing certificate, which is not issued yet.
[assembly: AssemblyTitle("Kosmos")]
[assembly: AssemblyProduct("Kosmos")]
[assembly: AssemblyVersion(KosmosLauncher.LauncherVersion)]
[assembly: AssemblyFileVersion(KosmosLauncher.LauncherVersion)]
[assembly: AssemblyInformationalVersion(KosmosLauncher.LauncherProductVersion)]

class KosmosLauncher
{
    // The LAUNCHER's version, not the app's. This binary is committed and copied
    // into every zip unchanged (tools/windows/README.md), so an app version
    // stamped here would be wrong from the next release on. It moves only when
    // this file does. 1 was the #2086 console launcher; 2 is the GUI one; 3 does
    // an installer's job (win32-installer-native); 4 opens the board in its own
    // window (#1118); 5 installs itself without asking (#3286); 6 shows the waiting count on the
    // window's taskbar button (#3996); 7 replaces a board that holds its port but does not answer
    // (#4543); 8 asks whether this computer runs agents or connects to them (#4381, off on main); 8.1
    // updates and rolls back a computer that connects elsewhere, with no board (#4382).
    public const string LauncherVersion = "8.1.0.0";
    // Explorer's "Product version". Worded so nobody reads it as the Kosmos
    // version, which lives in manifest.json and on the board.
    public const string LauncherProductVersion = "launcher 8.1";

    // Kept in step with tools/build-kosmos-windows.sh, which reads the board's
    // default out of server.js and refuses the build if this disagrees. If it
    // ever drifts, the launcher opens a port nothing serves.
    const int DefaultPort = 16180;

    // Every message box this program shows carries this title, so the person
    // can tell which program is speaking.
    const string WindowTitle = "Kosmos";

    const string ConsoleFlag = "--console";

    // What Settings > Apps > Installed apps > Uninstall runs (see Uninstall).
    const string UninstallFlag = "--uninstall";

    // The engine helpers' word that the person confirmed: engine/win32uninstall.js and
    // win32relocate.js and win32update.js are dry runs without it. Passed only after the person confirmed
    // (the uninstall), or because opening Kosmos from a cleaned-up folder or a newer download is the
    // request (the install and the update, #3286).
    const string ConfirmedFlag = "--yes";
    const string UninstallHelperScript = "win32uninstall.js";
    const string RelocateHelperScript = "win32relocate.js";

    // When to start asking whether the board started here is serving from here,
    // counted from its own start: engine/win32handoff.js's
    // HANDOFF_CHECK_FOR_SERVING_AFTER_MS (the budget plus its floors), pinned
    // equal by tools.win-launcher-native.test.js. It is NOT a worst case: the
    // hand-off's schtasks calls and a slow first boot can both run past it. So
    // time alone never shows the box. From this mark the launcher polls for
    // positive proof that the board is serving from here -- it is LISTENING, or it
    // wrote its serve-here signal (ServeHereSignalEnvVar) -- both of which the board
    // reaches only once it has decided to serve here rather than hand off.
    const int CheckForServingAfterMs = 18000;

    // How often, from that mark, the launcher looks for the board's listener:
    // quick enough that the box follows the board within a moment, rare enough
    // that reading the TCP table costs nothing noticeable.
    const int ServingPollMs = 300;

    // #2983: the board's POSITIVE "I am serving from here" proof, for when the TCP
    // table cannot be read at all (every GetExtendedTcpTable read fails). The
    // launcher mints a unique path (ServeHereSignal), hands it to the board in this
    // environment variable, and the board writes the file the instant it decides to
    // serve here (engine/win32handoff.js, SERVE_HERE_SIGNAL_ENV, pinned equal by the
    // test). It replaced a time-derived fallback that fired a false box during a
    // slow-but-successful boot: the board runs ensureInstalled and its roster syncs
    // before the hand-off, well past any fixed time, so time could not tell a slow
    // success from a serve-here. This file cannot: it is written only on the
    // serve-here decision, never during a hand-off that goes on to succeed.
    const string ServeHereSignalEnvVar = "KOSMOS_SERVE_HERE_SIGNAL";

    // Shown once the board is listening from here: it did not move to its logon
    // task and is serving from this launcher, which has no window, so this box
    // is the person's handle on it.
    const string RunningHereMessage =
        "Kosmos couldn't move to the background, so it's running from here instead. Keep this box open while you use Kosmos. Click OK to stop Kosmos. To see why, run Kosmos.exe --console.";

    // The window class of every Windows message box, ours included.
    const string DialogWindowClass = "#32770";

    // How often the box is asked to close once the board has ended: short
    // enough that the box goes away with the board, not noticeably after.
    const int CloseBoxRetryMs = 100;

    // The most common Windows mistake: double-clicking Kosmos.exe inside the zip
    // in Explorer, which runs that one file from a temp folder with nothing
    // beside it. The words are Explorer's own ("Extract All...").
    const string InsideZipMessage =
        "Kosmos is still inside the zip file. Close this window, right-click the zip in your Downloads folder, choose Extract All..., then open the extracted folder and double-click Kosmos.exe.";

    const string PartialExtractAdvice =
        "Some of its files are missing, which usually means the zip was only partly extracted. Extract the whole zip again with Extract All..., keeping the folders together, then double-click Kosmos.exe in the extracted folder.";

    // True for a person at a visible desktop who did not ask for --console.
    // False for --console, and for any non-interactive context (a service, or a
    // task set to run whether or not the user is signed in): there, a message
    // box would wait forever on a desktop nobody can see, so text goes to stderr.
    // internal only so the probe a test compiles beside this file can play a person at a desktop.
    internal static bool showMessageBoxes;

    static string Here()
    {
        // The EXE's own directory, not the working directory: a user can launch
        // this from a shortcut, from Explorer, or from a shell sitting anywhere,
        // and %~dp0's equivalent has to be the binary's location in all three.
        return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    }

    // STA: the move dialog is Windows Forms and the Start menu shortcut is COM, and both
    // expect the thread a GUI program's Main runs on.
    [STAThread]
    static int Main(string[] args)
    {
        bool wantsConsole = Array.Exists(args, a => string.Equals(a, ConsoleFlag, StringComparison.OrdinalIgnoreCase));
        bool wantsUninstall = Array.Exists(args, a => string.Equals(a, UninstallFlag, StringComparison.OrdinalIgnoreCase));
        bool wantsWindow = Array.Exists(args, a => string.Equals(a, WindowFlag, StringComparison.OrdinalIgnoreCase));
        showMessageBoxes = !wantsConsole && Environment.UserInteractive;
        if (!showMessageBoxes) ConnectToAConsole();

        string here = Here();
        string node = Path.Combine(here, "runtime\\node.exe");
        string server = Path.Combine(here, "app\\server.js");
        string opener = Path.Combine(here, "open-board.js");
        string app = Path.Combine(here, "app");

        // --uninstall is its own errand, decided before anything else: it asks first, never
        // starts the board, never offers a move or refreshes the Start menu, and checks for
        // the two files it needs itself (Uninstall, RunEngineHelper).
        if (wantsUninstall) return Uninstall(here, node);

        // 🛑 NOTHING OF THE BOARD'S IS STARTED ABOVE THESE TWO CHECKS. The board's hand-off to its
        // logon task happens inside server.js, so a folder without the runtime
        // provably never reaches it -- which is what lets the tests run this exe.
        if (!File.Exists(node))
        {
            if (RunningFromInsideAZip(here)) return FailInsideZip();
            return Fail("the bundled runtime is missing (runtime\\node.exe).");
        }
        if (!File.Exists(server)) return Fail("the application is missing (app\\server.js).");

        int port = BoardPort();

        // #1118: `Kosmos.exe --window` is the board's own window, and nothing else. The launch below
        // starts it as a second process of this same exe, so closing the window ends only that
        // process: the board and the agents run under their own tasks, as they do on the Mac. It
        // never starts the board, offers a move or touches the Start menu.
        if (wantsWindow) return RunBoardWindow(here, node, opener, app, port);

        // win32-installer-native: a real build (manifest.json, see IsKosmosBuild) running from
        // Downloads, the Desktop, OneDrive or a temporary folder hands off to the Kosmos already
        // installed in its own folder, updates it, or installs itself there (#3286); then it points its Start menu
        // shortcut and its Settings > Apps entry at wherever it runs from (RunInstallerDuties). A
        // folder without the manifest -- a partial extract, or any test's scratch folder -- does
        // none of it, so it never touches the Start menu or the registry.
        int? endedByInstallerDuties = RunInstallerDuties(here, node, port);
        if (endedByInstallerDuties.HasValue) return endedByInstallerDuties.Value;

        // #4381: 🛑 THE MODE IS READ BEFORE ANYTHING OF THE BOARD'S STARTS. A computer that connects to
        // agents on another computer starts neither the board (server.js, below) nor open-board.js, and
        // does not replace a stuck board (which runs its task). Its window opens straight at Kosmos
        // Plus and makes sure this computer's board is stopped (BoardWindowForm, off its UI thread).
        // With the release switch off this is always Run, and nothing below changes.
        bool connects = LaunchComputerMode() == ComputerMode.Connect;

        // #4543: a board that holds its port but does not answer is replaced BEFORE anything below
        // hands off to it. Without this, server.js's hand-off finds the logon task already running
        // (IgnoreNew starts nothing), the window opens onto the same frozen board, and "close Kosmos
        // and open it again", the screen's own advice, changes nothing (measured on the Windows box,
        // the card has the run). Only for a person at the desktop: --console is a run somebody asked
        // to watch, not to have act on the board, and with nobody at the desktop nobody is waiting
        // on a window. A launch that sets PORT serves a port the logon task does not, so its task is
        // never touched (null); only a stuck Kosmos board on that port is.
        if (showMessageBoxes && !connects)
        {
            bool portIsTheTasks = string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PORT"));
            ReplaceBoardIfStuck(port, portIsTheTasks ? BoardTaskName : null, StuckAfterMs);
        }

        // The opener waits for the board itself and falls back to the plain url,
        // so it is safe to start BEFORE the server is listening -- that is the
        // #2031 design and the .cmd relied on it too.
        // #1118: a person at a desktop gets the board in Kosmos's own window (RunBoardWindow),
        // which uses the same opener to sign in and falls back to the browser when this PC
        // cannot host the window. With nobody at the desktop there is no window to show, so the
        // opener runs as it always did. Both wait on open-board.js: a folder without it (a
        // partial extract, or a test's scratch folder) starts neither.
        // #4381: a connect computer opens only the window (it loads Kosmos Plus, never the opener); with
        // nobody at the desktop it opens nothing at all.
        string browserProblem = null;
        if (File.Exists(opener) && (!connects || Environment.UserInteractive))
        {
            try
            {
                ProcessStartInfo o = Environment.UserInteractive
                    ? BoardWindowStartInfo(here)
                    : OpenerStartInfo(here, node, opener, app, port, false);
                Process.Start(o);
            }
            catch (Exception e)
            {
                // Not fatal: the board is what matters, and the user can reach it
                // by hand. Say so rather than dying with the board about to work.
                browserProblem = (Environment.UserInteractive ? "Kosmos could not open its window (" : "Kosmos could not open your browser (") + e.Message + ").";
                if (!showMessageBoxes)
                {
                    Console.Error.WriteLine(browserProblem);
                    Console.Error.WriteLine("Open http://127.0.0.1:" + port + " yourself.");
                }
            }
        }

        if (connects)
        {
            if (browserProblem != null && showMessageBoxes) ShowMessageBox(browserProblem, true);
            else if (!showMessageBoxes) Console.WriteLine(ConnectsElsewhereConsoleMessage);
            return browserProblem != null ? 1 : 0;
        }

        if (!showMessageBoxes)
        {
            Console.WriteLine("Starting Kosmos. It will open in a moment.");
            Console.WriteLine("If it does not, open http://127.0.0.1:" + port + " yourself.");
            Console.WriteLine();
        }

        ProcessStartInfo s = new ProcessStartInfo(node, "\"" + server + "\"");
        s.UseShellExecute = false;
        s.WorkingDirectory = here;
        // #2983: a unique path the board will create once it decides to serve from
        // here (see the serving loop). Fresh per launch, so it is never a stale
        // file from a past run, and gone by the time we look unless this board
        // wrote it. A missing temp path leaves the listener proof to stand alone.
        string serveHereSignal = ServeHereSignalPath();
        if (serveHereSignal != null) s.EnvironmentVariables[ServeHereSignalEnvVar] = serveHereSignal;
        // With --console the server shares this console, whose output IS the
        // status. Without it there is no console to share, so the server runs on
        // a hidden one -- as the opener does, and as the logon task's
        // `conhost --headless` board does. Its stdio is NOT redirected: a pipe
        // would change what the server sees, and WaitForExit would wait for every
        // grandchild holding the pipe open.
        s.CreateNoWindow = showMessageBoxes;

        Process p;
        try { p = Process.Start(s); }
        catch (Exception e) { return Fail("the runtime would not start (" + e.Message + ")."); }

        Stopwatch sinceServerStarted = Stopwatch.StartNew();

        if (browserProblem != null && showMessageBoxes)
        {
            ShowMessageBox(browserProblem + "\n\nOpen http://127.0.0.1:" + port + " in your browser yourself.", false);
        }

        // A board that hands off to its logon task exits 0. One that serves from
        // here does so on a console nobody can see, so the person gets a box to
        // keep it by (see KeepBoardUntilPersonStopsIt). Time alone cannot tell the
        // two apart, so the box waits for POSITIVE proof that this board is serving
        // here: it is LISTENING (which server.js reaches only after the hand-off
        // decided to serve here), or it wrote its serve-here signal
        // (ServeHereSignalPresent), which the same decision writes. The signal is
        // what carries a locked-down box where every TCP-table read fails; #2983
        // removed the old time-derived fallback, which fired a false box during a
        // slow-but-successful boot. With --console, or with nobody at the desktop,
        // the launcher just waits, as it always did.
        bool stoppedByPerson = false;
        if (showMessageBoxes)
        {
            int stillToWaitMs = CheckForServingAfterMs - (int)sinceServerStarted.ElapsedMilliseconds;
            if (!p.WaitForExit(Math.Max(0, stillToWaitMs)))
            {
                while (!p.WaitForExit(ServingPollMs))
                {
                    bool provablyServingHere = ListenerStateOf(p.Id) == ListenerAnswer.Listening || ServeHereSignalPresent(serveHereSignal);
                    if (provablyServingHere) { stoppedByPerson = KeepBoardUntilPersonStopsIt(p); break; }
                }
            }
        }

        p.WaitForExit();
        // #2983: the board owns the signal's content, the launcher its lifetime. The
        // board has ended, so nothing else reads it; leaving it would litter %TEMP%.
        if (serveHereSignal != null) { try { File.Delete(serveHereSignal); } catch { /* a leftover temp file is not worth failing over */ } }
        // #4381: a board serving from here that the person's Connect ended (the window's stop) did not
        // stop unexpectedly: measured on the Windows box, this box said it did, over Kosmos Plus sign-in.
        bool endedByConnect = p.ExitCode != 0 && LaunchComputerMode() == ComputerMode.Connect;
        if (p.ExitCode != 0 && !stoppedByPerson && !endedByConnect)
        {
            if (showMessageBoxes)
            {
                ShowMessageBox("Kosmos stopped unexpectedly (exit code " + p.ExitCode + ").\n\n"
                    + "Double-click Kosmos.exe to try again. To see why it stopped, open its folder in File Explorer (" + here + "), click the address bar, type cmd, press Enter, then run:\n\n"
                    + "start /wait Kosmos.exe " + ConsoleFlag, true);
            }
            else
            {
                Console.Error.WriteLine();
                Console.Error.WriteLine("Kosmos stopped. The lines above say why.");
                Hold();
            }
        }
        return p.ExitCode;
    }

    // The board's port: PORT when it is a usable number, the board's default otherwise. ONE
    // derivation, read by the browser opener, the move, and the uninstall's "is Kosmos still open"
    // check (engine/win32uninstall.js asks this port who answers before it changes anything).
    static int BoardPort()
    {
        int port = DefaultPort;
        string env = Environment.GetEnvironmentVariable("PORT");
        if (!string.IsNullOrEmpty(env))
        {
            int parsed;
            // ⚠️ A bad PORT is IGNORED, not fatal. The server reads PORT itself and
            // applies its own default; refusing to start here would turn a stray
            // environment variable into "Kosmos is broken" on a machine where the
            // server would have come up fine.
            if (int.TryParse(env, out parsed) && parsed > 0 && parsed < 65536) port = parsed;
        }
        return port;
    }

    static int Fail(string what)
    {
        if (showMessageBoxes)
        {
            ShowMessageBox("Kosmos could not start: " + what + "\n\n" + PartialExtractAdvice, true);
            return 1;
        }
        Console.Error.WriteLine();
        Console.Error.WriteLine("Kosmos could not start: " + what);
        Console.Error.WriteLine();
        Console.Error.WriteLine(PartialExtractAdvice);
        Hold();
        return 1;
    }

    static int FailInsideZip()
    {
        if (showMessageBoxes)
        {
            ShowMessageBox(InsideZipMessage, false);
            return 1;
        }
        Console.Error.WriteLine();
        Console.Error.WriteLine(InsideZipMessage);
        Hold();
        return 1;
    }

    // ---- where is this running from? ------------------------------------------

    // Explorer runs an exe double-clicked inside a zip from
    // %TEMP%\Temp1_<zip name>.zip\, and 7-Zip and WinRAR extract to %TEMP% too.
    // So: any path segment ending in .zip, or anywhere under a temp folder.
    // Only consulted once the runtime is known to be missing, so the worst a
    // false match can do is choose between two "extract it again" messages.
    static bool RunningFromInsideAZip(string exeDirectory)
    {
        string directory = FullPathOrNull(exeDirectory) ?? exeDirectory;
        foreach (string segment in directory.Split('\\', '/'))
        {
            if (segment.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) return true;
        }
        foreach (string temp in TempFolders())
        {
            if (IsSameOrInside(directory, temp)) return true;
        }
        return false;
    }

    static string[] TempFolders()
    {
        string[] candidates = {
            SafeTempPath(),
            Environment.GetEnvironmentVariable("TEMP"),
            Environment.GetEnvironmentVariable("TMP"),
        };
        string[] resolved = new string[candidates.Length];
        for (int i = 0; i < candidates.Length; i++) resolved[i] = FullPathOrNull(candidates[i]);
        return resolved;
    }

    static string SafeTempPath()
    {
        try { return Path.GetTempPath(); } catch { return null; }
    }

    static bool IsSameOrInside(string directory, string root)
    {
        if (string.IsNullOrEmpty(root)) return false;
        root = root.TrimEnd('\\', '/');
        // A temp folder set to a whole drive (TEMP=C:\) would claim every folder
        // on it, so a drive root never counts.
        if (root.Length == 0 || root.EndsWith(":")) return false;
        directory = directory.TrimEnd('\\', '/');
        return string.Equals(directory, root, StringComparison.OrdinalIgnoreCase)
            || directory.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    }

    // Raw TEMP and TMP values are compared in the same full-path form
    // Path.GetTempPath() returns. An 8.3 short name on either side (a profile
    // whose name is long or has a space) already matches: measured on .NET 4.8,
    // GetTempPath() returns the long form of a short TEMP, and the exe's
    // Assembly.Location is long even when it was launched by its short path.
    // tools.win-launcher-native runs both mixes.
    static string FullPathOrNull(string path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        try { return Path.GetFullPath(path); }
        catch { return null; /* a malformed value is not a folder to compare */ }
    }

    // ---- is the board serving from here? ------------------------------------

    // #2983: a unique path, in %TEMP%, the board is told to create once it decides
    // to serve here (ServeHereSignalEnvVar). A fresh GUID per launch, so it never
    // collides between installs and is never a stale file from a past run. Null when
    // there is no temp path to write in, and the listener proof stands alone.
    static string ServeHereSignalPath()
    {
        try { return Path.Combine(Path.GetTempPath(), "kosmos-serve-here-" + Guid.NewGuid().ToString("N") + ".signal"); }
        catch { return null; }
    }

    // #2983: has the board written its serve-here signal yet? Its presence is the
    // authoritative "serving here" proof the TCP table cannot give on a box where
    // every GetExtendedTcpTable read fails. Never throws: a check that crashed would
    // take the person's only handle on the board with it, and it is polled every
    // ServingPollMs. internal only so a probe compiled beside this file can call it.
    internal static bool ServeHereSignalPresent(string path)
    {
        if (string.IsNullOrEmpty(path)) return false;
        try { return File.Exists(path); }
        catch { return false; }
    }

    internal enum ListenerAnswer { Listening, NotListening, CouldNotRead }

    // Whether the process owns a TCP socket in LISTEN state, over IPv4 or IPv6,
    // or that the table could not be read. The board's only TCP listener is its
    // http server, which server.js starts only after deciding not to hand off
    // (named pipes, which agents use, are not in this table).
    // Never throws: a missing iphlpapi entry point, a buffer that cannot be
    // allocated, anything, is CouldNotRead, because a crash here would take the
    // person's only handle on the board with it. internal rather than private
    // only so that a probe compiled beside this file in a test's scratch folder
    // can call it.
    internal static ListenerAnswer ListenerStateOf(int processId)
    {
        try
        {
            ListenerAnswer overIPv4 = TcpListenerStateOf(processId, AF_INET, IPV4_ROW_BYTES, IPV4_ROW_OWNING_PID_OFFSET);
            if (overIPv4 == ListenerAnswer.Listening) return overIPv4;
            ListenerAnswer overIPv6 = TcpListenerStateOf(processId, AF_INET6, IPV6_ROW_BYTES, IPV6_ROW_OWNING_PID_OFFSET);
            if (overIPv6 == ListenerAnswer.Listening) return overIPv6;
            bool eitherUnreadable = overIPv4 == ListenerAnswer.CouldNotRead || overIPv6 == ListenerAnswer.CouldNotRead;
            return eitherUnreadable ? ListenerAnswer.CouldNotRead : ListenerAnswer.NotListening;
        }
        catch { return ListenerAnswer.CouldNotRead; }
    }

    static ListenerAnswer TcpListenerStateOf(int processId, int addressFamily, int rowBytes, int owningPidOffset)
    {
        bool found = false;
        bool read = EachListenerRow(addressFamily, rowBytes, row =>
        {
            if (Marshal.ReadInt32(row, owningPidOffset) == processId) { found = true; return false; }
            return true;
        });
        if (!read) return ListenerAnswer.CouldNotRead;
        return found ? ListenerAnswer.Listening : ListenerAnswer.NotListening;
    }

    // One read of the LISTEN table for one address family, handing `row` the start of each row
    // until it returns false. False when the table could not be read at all. Shared by
    // TcpListenerStateOf and ListenersOnPort (#4543), so there is one reading of the table, and of
    // its retry, however many questions are asked of it.
    static bool EachListenerRow(int addressFamily, int rowBytes, Func<IntPtr, bool> row)
    {
        int bufferBytes = 0;
        for (int attempt = 0; attempt < TCP_TABLE_READ_ATTEMPTS; attempt++)
        {
            IntPtr table = bufferBytes > 0 ? Marshal.AllocHGlobal(bufferBytes) : IntPtr.Zero;
            try
            {
                uint result = readTcpTable(table, ref bufferBytes, addressFamily);
                // Too small (or the first, sizing call): bufferBytes now holds the
                // size needed, and the table may grow again before the next read.
                if (result == ERROR_INSUFFICIENT_BUFFER) continue;
                if (result != NO_ERROR || table == IntPtr.Zero) return false;
                int rows = Marshal.ReadInt32(table);
                for (int i = 0; i < rows; i++)
                {
                    if (!row(IntPtr.Add(table, TCP_TABLE_ROWS_OFFSET + i * rowBytes))) break;
                }
                return true;
            }
            finally
            {
                if (table != IntPtr.Zero) Marshal.FreeHGlobal(table);
            }
        }
        return false;
    }

    const int AF_INET = 2;
    const int AF_INET6 = 23;
    // Only rows in LISTEN state, each with its owning process id.
    const int TCP_TABLE_OWNER_PID_LISTENER = 3;
    const uint NO_ERROR = 0;
    const uint ERROR_INSUFFICIENT_BUFFER = 122;
    // MIB_TCPTABLE_OWNER_PID and MIB_TCP6TABLE_OWNER_PID: a DWORD row count, then the rows.
    const int TCP_TABLE_ROWS_OFFSET = 4;
    // MIB_TCPROW_OWNER_PID: six DWORDs -- state, local address, local port,
    // remote address, remote port, owning pid.
    const int IPV4_ROW_BYTES = 24;
    const int IPV4_ROW_OWNING_PID_OFFSET = 20;
    // MIB_TCP6ROW_OWNER_PID: local address (16 bytes), local scope, local port,
    // remote address (16 bytes), remote scope, remote port, state, owning pid.
    const int IPV6_ROW_BYTES = 56;
    const int IPV6_ROW_OWNING_PID_OFFSET = 52;
    // Where each row keeps its local port (#4543): a DWORD holding the port in network byte
    // order in its first two bytes.
    const int IPV4_ROW_LOCAL_PORT_OFFSET = 8;
    const int IPV6_ROW_LOCAL_PORT_OFFSET = 20;
    // The table can grow between the sizing call and the read; a few tries cover it.
    const int TCP_TABLE_READ_ATTEMPTS = 5;

    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int bufferBytes, bool sorted, int addressFamily, int tableClass, uint reserved);

    // The one call that reads the table, as a replaceable delegate. The launcher
    // never replaces it; the listener probe a test compiles beside this file swaps
    // in a failing or throwing reader, to prove both come back as CouldNotRead.
    internal delegate uint TcpTableReader(IntPtr table, ref int bufferBytes, int addressFamily);
    internal static TcpTableReader readTcpTable = ReadTcpTableFromWindows;

    static uint ReadTcpTableFromWindows(IntPtr table, ref int bufferBytes, int addressFamily)
    {
        return GetExtendedTcpTable(table, ref bufferBytes, false, addressFamily, TCP_TABLE_OWNER_PID_LISTENER, 0);
    }

    // ---- a board that listens but does not answer (#4543) ---------------------

    // How long the board's /api/status gets to answer before a board holding the port counts as
    // stuck: 10 s. MEASURED on the Windows box 2026-09-29, unauthenticated as this ask is: a cold
    // boot of a throwaway board answered 25 to 45 ms after its port first accepted (6 runs; the port
    // accepted 220 to 393 ms after start), and its slowest answer over the next 5 s was 8 ms; the
    // live fleet's board, busy, answered 20 asks in at most 686 ms. The hand-off in server.js already
    // reads 2 s of silence as "nobody there". So 10 s is more than ten times the slowest answer seen,
    // a board that is slow but alive is left alone, and a person who reopened Kosmos because it
    // stalled waits seconds, not the minutes Josh's stall ran to on 09-26. The page itself cannot yet
    // say the board is stuck (its status poll has no timeout until the web half of the card lands),
    // so today this bound is what a person meets when they reopen Kosmos because it stalled.
    internal const int StuckAfterMs = 10000;

    // How long the ask may run before the person is shown a working window. A board that answers
    // does so in milliseconds, so the ordinary launch shows nothing; a stuck one shows the window
    // for the rest of the bound and the restart.
    const int QuietAskMs = 1500;

    // How long an ended board gets to let go of the port, first after `/End`, then after the
    // listener's process tree is ended. win32board.restart measured the port staying bound about a
    // second after `/End`; five leaves room for a slow box without the person waiting long.
    internal const int PortReleaseWaitMs = 5000;
    const int PortReleasePollMs = 200;

    // engine/win32board.js TASK_NAME, pinned equal by tools.win-launcher-stuck-board-4543.test.js.
    // The launcher never registers or changes the task; it only ends and re-runs it, the two things
    // the board's own restart does.
    internal const string BoardTaskName = "Kosmos\\board";

    // engine/win32board.js BOOT_NAME: the shim the logon task runs, beside the anchored node.exe.
    // Pinned equal by the same test.
    internal const string BoardBootFileName = "board-boot.js";

    // engine/win32anchor.js POINTER_NAME: the file beside the anchored node.exe that names the engine
    // the logon task runs. The real anchored runtime on the Windows box holds node.exe, board-boot.js,
    // engine-path and supervisor-boot.js (read 2026-09-29); a board is recognised by the first three.
    // Pinned equal by the same test.
    internal const string EnginePointerFileName = "engine-path";

    // One schtasks or taskkill call's limit, engine/win32board.js's order: a call that hangs must
    // not hold the launch for ever.
    const int SchtasksTimeoutMs = 20000;

    // After a refused connection, how long before asking again (see AskBoardWithin).
    const int ReaskAfterRefusalMs = 500;

    const string StuckBoardMessage =
        "Kosmos is not answering. If it stays stuck, Kosmos restarts it for you. This takes a few seconds.";

    internal enum BoardAnswer { Answered, NoAnswer, Refused, CouldNotAsk }

    // What ReplaceBoardIfStuck found and did. Only Replaced and StillHeld changed anything.
    internal enum StuckBoardOutcome { NothingListening, CouldNotReadListeners, Answered, CouldNotAsk, NotKosmos, Replaced, StillHeld }

    // One ask of /api/status. ANY answer counts, a refusal too: 401, 403 and 500 are a board that
    // is alive and speaking, and a board that is alive is not this code's to end. A request that ran
    // out of time with nothing back is NoAnswer: a frozen process's listening socket still accepts
    // the connection (the kernel does that), and then nothing comes. A refused connection is Refused
    // (see AskBoardWithin for when that can be a frozen board). A reset, anything else is
    // CouldNotAsk, which is never read as stuck. No token is sent: a refusal is already an answer.
    // ⚠️ ONLY 127.0.0.1 IS ASKED, never ::1 or KOSMOS_BIND_HOST. The board binds 127.0.0.1 unless told
    // otherwise, and the opener asks there too. A board bound elsewhere is refused here (or has no
    // listener on the port this reads), so it reads as CouldNotAsk or Refused-without-a-listener and
    // is left alone: the error is on the side of doing nothing.
    internal static BoardAnswer AskBoard(int port, int timeoutMs)
    {
        try
        {
            System.Net.HttpWebRequest request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://127.0.0.1:" + port + "/api/status");
            request.Proxy = null;   // loopback: never the system proxy
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.KeepAlive = false;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            using (request.GetResponse()) { return BoardAnswer.Answered; }
        }
        catch (System.Net.WebException e)
        {
            if (e.Response != null) { try { e.Response.Close(); } catch { /* the answer is what counted */ } return BoardAnswer.Answered; }
            if (e.Status == System.Net.WebExceptionStatus.Timeout) return BoardAnswer.NoAnswer;
            return e.Status == System.Net.WebExceptionStatus.ConnectFailure ? BoardAnswer.Refused : BoardAnswer.CouldNotAsk;
        }
        catch { return BoardAnswer.CouldNotAsk; }
    }

    // 🛑 A FROZEN BOARD CAN REFUSE, NOT ONLY TIME OUT, measured on the Windows box 2026-09-29: a
    // listener frozen with NtSuspendProcess took 232 of 600 connections into its backlog and Windows
    // refused the other 368; AskBoard then read Refused (after about 2 s, as .NET retries the SYN).
    // A board frozen for minutes, with a page polling it every 5 s, gets there. So a refusal is not
    // "nobody there" while the TCP table still shows the board listening. But a refusal is also
    // quick, so it is asked again until the bound is spent: only a board that gave no answer at all
    // for the WHOLE bound, refusing or timing out, is stuck. Any answer in that time is Answered; a
    // failure of another kind is CouldNotAsk. The caller still requires the port to be held, after
    // the wait, by Kosmos boards of this user before anything is ended.
    internal static BoardAnswer AskBoardWithin(int port, int boundMs)
    {
        Stopwatch asked = Stopwatch.StartNew();
        bool refused = false;
        while (true)
        {
            int left = boundMs - (int)asked.ElapsedMilliseconds;
            if (left <= 0) return refused ? BoardAnswer.Refused : BoardAnswer.NoAnswer;
            BoardAnswer answer = AskBoard(port, left);
            if (answer == BoardAnswer.Answered || answer == BoardAnswer.CouldNotAsk) return answer;
            if (answer == BoardAnswer.NoAnswer) return refused ? BoardAnswer.Refused : BoardAnswer.NoAnswer;
            refused = true;
            Thread.Sleep(Math.Max(0, Math.Min(ReaskAfterRefusalMs, boundMs - (int)asked.ElapsedMilliseconds)));
        }
    }

    // Every process listening on this TCP port, over IPv4 or IPv6, or null when neither table could
    // be read. Never throws, for ListenerStateOf's reason. The table is the whole machine's, every
    // user's: what is found here is only a candidate until IsKosmosBoard has looked at its owner.
    internal static List<int> ListenersOnPort(int port)
    {
        try
        {
            List<int> found = new List<int>();
            bool v4 = EachListenerRow(AF_INET, IPV4_ROW_BYTES, row => { NoteListener(row, IPV4_ROW_LOCAL_PORT_OFFSET, IPV4_ROW_OWNING_PID_OFFSET, port, found); return true; });
            bool v6 = EachListenerRow(AF_INET6, IPV6_ROW_BYTES, row => { NoteListener(row, IPV6_ROW_LOCAL_PORT_OFFSET, IPV6_ROW_OWNING_PID_OFFSET, port, found); return true; });
            return v4 || v6 ? found : null;
        }
        catch { return null; }
    }

    static void NoteListener(IntPtr row, int portOffset, int pidOffset, int port, List<int> found)
    {
        int rowPort = (Marshal.ReadByte(row, portOffset) << 8) | Marshal.ReadByte(row, portOffset + 1);
        if (rowPort != port) return;
        int pid = Marshal.ReadInt32(row, pidOffset);
        if (!found.Contains(pid)) found.Add(pid);
    }

    // 🛑 A PROCESS IS HELD OPEN FROM THE MOMENT IT IS JUDGED UNTIL IT IS ENDED. A process id is only a
    // number, and Windows gives an ended process's number to the next process that starts. A handle
    // held open keeps the number from being reused, so the process judged a stuck Kosmos board is
    // the one `taskkill` and TerminateProcess reach, however long `/End` and the waits take. The
    // access asked for is what the judging and the ending need, and no more.
    internal sealed class HeldProcess : IDisposable
    {
        internal readonly int Id;
        internal IntPtr Handle;
        HeldProcess(int id, IntPtr handle) { Id = id; Handle = handle; }

        // Null when the process cannot be opened (gone, or not ours to end): not a board to end.
        internal static HeldProcess Open(int processId)
        {
            IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE, false, processId);
            return handle == IntPtr.Zero ? null : new HeldProcess(processId, handle);
        }

        internal bool HasExited { get { return WaitForSingleObject(Handle, 0) == WAIT_OBJECT_0; } }

        public void Dispose()
        {
            if (Handle != IntPtr.Zero) { CloseHandle(Handle); Handle = IntPtr.Zero; }
        }
    }

    // Is this held process a Kosmos board of THIS user, in THIS session? Only such a board is ever
    // ended here. internal and replaceable only so a test's probe can stand in listeners of its own;
    // the launcher never replaces it.
    internal static Func<HeldProcess, bool> isKosmosBoardProcess = IsKosmosBoard;

    internal static bool IsKosmosBoard(HeldProcess process)
    {
        return process != null && IsKosmosBoardImage(ProcessImagePath(process.Handle)) && ownedByThisUser(process);
    }

    // A Kosmos board's executable: a node.exe that is either the logon task's (the anchored runtime,
    // with BoardBootFileName and EnginePointerFileName beside it) or a build's own (runtime\node.exe,
    // with app\server.js and manifest.json in the build folder above it, as this launcher starts it;
    // ManifestFileName is the same marker IsKosmosBuild reads).
    // Another program that happens to hold the port and not speak HTTP is somebody else's.
    internal static bool IsKosmosBoardImage(string image)
    {
        try
        {
            if (image == null || !string.Equals(Path.GetFileName(image), "node.exe", StringComparison.OrdinalIgnoreCase)) return false;
            string runtime = Path.GetDirectoryName(image);
            if (File.Exists(Path.Combine(runtime, BoardBootFileName)) && File.Exists(Path.Combine(runtime, EnginePointerFileName))) return true;
            string build = Path.GetDirectoryName(runtime);
            return build != null && File.Exists(Path.Combine(build, "app\\server.js")) && File.Exists(Path.Combine(build, ManifestFileName));
        }
        catch { return false; }
    }

    // 🛑 THE TCP TABLE IS THE WHOLE MACHINE'S. Run as an administrator, this launcher can open (and
    // taskkill /F can end) another user's node.exe, and another person's Kosmos board on a shared PC
    // is theirs, stuck or not. So the owner must be this process's own user (the token's SID) in
    // this process's own session; an owner that cannot be read is not ours. A seam, like
    // isKosmosBoardProcess, only so a test can play a second user it cannot create.
    internal static Func<HeldProcess, bool> ownedByThisUser = OwnedByThisUser;

    internal static bool OwnedByThisUser(HeldProcess process)
    {
        try
        {
            uint theirs, ours;
            if (!ProcessIdToSessionId((uint)process.Id, out theirs) || !ProcessIdToSessionId((uint)Process.GetCurrentProcess().Id, out ours)) return false;
            if (theirs != ours) return false;
            IntPtr token;
            if (!OpenProcessToken(process.Handle, TOKEN_QUERY, out token)) return false;
            try
            {
                using (System.Security.Principal.WindowsIdentity owner = new System.Security.Principal.WindowsIdentity(token))
                using (System.Security.Principal.WindowsIdentity me = System.Security.Principal.WindowsIdentity.GetCurrent())
                {
                    return owner.User != null && owner.User.Equals(me.User);
                }
            }
            finally { CloseHandle(token); }
        }
        catch { return false; }
    }

    const uint PROCESS_TERMINATE = 0x0001;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint SYNCHRONIZE = 0x00100000;
    const uint TOKEN_QUERY = 0x0008;
    const uint WAIT_OBJECT_0 = 0;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageNameW(IntPtr process, int flags, StringBuilder name, ref int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    // The held process's executable path, or null. PROCESS_QUERY_LIMITED_INFORMATION works on a
    // suspended process, which is exactly the one being asked about.
    static string ProcessImagePath(IntPtr process)
    {
        try
        {
            StringBuilder name = new StringBuilder(1024);
            int size = name.Capacity;
            return QueryFullProcessImageNameW(process, 0, name, ref size) ? name.ToString(0, size) : null;
        }
        catch { return null; }
    }

    // 🛑 #4543: THE BOARD IS RUNNING BUT NOT ANSWERING, AND REOPENING KOSMOS USED TO LEAVE IT SO.
    // The hand-off only knows "a board answers" and "nobody answers". A frozen board is neither: its
    // process still owns the port, the logon task is still running (so `/Run` starts nothing), and
    // the window opens onto it. So, before the hand-off: if the port is held and /api/status gives
    // no answer at all inside `stuckAfterMs` (AskBoardWithin), and every process holding it AFTER
    // that wait is a Kosmos board of this user, held open from then on (HeldProcess), the board is
    // replaced: `/End` the logon task (when this port is the task's, `taskName`), and if a listener
    // survives that, end its process tree, as KeepBoardUntilPersonStopsIt ends a board. Then `/Run`
    // the task, so the board comes back even if this launch goes no further; the hand-off then
    // finds it (or starts it) as on any launch. A board that answers inside the bound, however
    // slowly and whatever it answers, is left alone, and so is anything that is not a Kosmos board
    // of this user. Never throws: this runs before the person's board is started, and a crash here
    // would take the launch with it.
    internal static StuckBoardOutcome ReplaceBoardIfStuck(int port, string taskName, int stuckAfterMs)
    {
        try
        {
            List<int> before = ListenersOnPort(port);
            if (before == null) return StuckBoardOutcome.CouldNotReadListeners;
            if (before.Count == 0) return StuckBoardOutcome.NothingListening;

            // The ask runs on its own thread so a board that answers at once shows nothing, and one
            // that does not gets the working window for the rest of the bound, not a silent wait.
            BoardAnswer answer = BoardAnswer.CouldNotAsk;
            Thread asking = new Thread(() => { answer = AskBoardWithin(port, stuckAfterMs); });
            asking.IsBackground = true;
            asking.Start();
            StuckBoardOutcome outcome = StuckBoardOutcome.CouldNotAsk;
            Action decide = () =>
            {
                asking.Join();
                outcome = DecideAfterTheWait(port, taskName, answer);
            };
            if (asking.Join(QuietAskMs)) decide();
            else ShowWorkingWhile(StuckBoardMessage, decide);
            return outcome;
        }
        catch { return StuckBoardOutcome.CouldNotAsk; }
    }

    // Everything after the ask, which has already spent its bound. Only NoAnswer and Refused go on;
    // the listeners are read HERE, after the wait, not before it: a board can go, or another take
    // its place, while the ask ran.
    static StuckBoardOutcome DecideAfterTheWait(int port, string taskName, BoardAnswer answer)
    {
        if (answer == BoardAnswer.Answered) return StuckBoardOutcome.Answered;
        if (answer != BoardAnswer.NoAnswer && answer != BoardAnswer.Refused) return StuckBoardOutcome.CouldNotAsk;
        List<int> after = ListenersOnPort(port);
        if (after == null) return StuckBoardOutcome.CouldNotReadListeners;
        if (after.Count == 0) return StuckBoardOutcome.NothingListening;
        List<HeldProcess> held = new List<HeldProcess>();
        try
        {
            foreach (int pid in after)
            {
                HeldProcess process = HeldProcess.Open(pid);
                if (process == null) return StuckBoardOutcome.NotKosmos;
                held.Add(process);
            }
            // Read once more with every handle held: a number that was let go and given to another
            // process between the read and the open no longer names the listener, and is dropped.
            List<int> listening = ListenersOnPort(port);
            if (listening == null) return StuckBoardOutcome.CouldNotReadListeners;
            held.RemoveAll(p => { if (listening.Contains(p.Id)) return false; p.Dispose(); return true; });
            if (held.Count == 0) return StuckBoardOutcome.NothingListening;
            if (!held.TrueForAll(p => isKosmosBoardProcess(p))) return StuckBoardOutcome.NotKosmos;
            return ReplaceStuckBoard(port, taskName, held);
        }
        finally { foreach (HeldProcess p in held) p.Dispose(); }
    }

    static StuckBoardOutcome ReplaceStuckBoard(int port, string taskName, List<HeldProcess> stuck)
    {
        if (taskName != null)
        {
            RunSchtasks("/End /TN " + QuoteArgument(taskName));
            WaitForPortRelease(port, stuck);
        }
        // The board outlived `/End` (measured: a frozen task board does, as `/End` ends only its
        // conhost; or it is a board a launcher served), so it is ended the way the running-here box
        // ends one: its whole tree.
        List<HeldProcess> survivors = StillListening(port, stuck);
        if (survivors.Count > 0)
        {
            foreach (HeldProcess board in survivors) EndProcessTree(board);
            WaitForPortRelease(port, stuck);
        }
        bool released = StillListening(port, stuck).Count == 0;
        if (taskName != null) RunSchtasks("/Run /TN " + QuoteArgument(taskName));
        return released ? StuckBoardOutcome.Replaced : StuckBoardOutcome.StillHeld;
    }

    // Which of these held processes still listen on the port. An unreadable table counts them all as
    // still there: only a read that shows the port let go is proof.
    static List<HeldProcess> StillListening(int port, List<HeldProcess> processes)
    {
        List<int> now = ListenersOnPort(port);
        if (now == null) return new List<HeldProcess>(processes);
        return processes.FindAll(p => now.Contains(p.Id));
    }

    static void WaitForPortRelease(int port, List<HeldProcess> processes)
    {
        Stopwatch waited = Stopwatch.StartNew();
        while (StillListening(port, processes).Count > 0 && waited.ElapsedMilliseconds < PortReleaseWaitMs) Thread.Sleep(PortReleasePollMs);
    }

    // The board and everything still descended from it. Its handle is held (HeldProcess), so the id
    // `taskkill` is given is still this board's, and it is judged once more just before, on that same
    // handle. The fallback ends it through the handle, never by looking the number up again.
    static void EndProcessTree(HeldProcess board)
    {
        if (board.HasExited || !isKosmosBoardProcess(board)) return;
        try
        {
            ProcessStartInfo stop = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), "/PID " + board.Id + " /T /F");
            stop.UseShellExecute = false;
            stop.CreateNoWindow = true;
            using (Process taskkill = Process.Start(stop)) { taskkill.WaitForExit(SchtasksTimeoutMs); }
        }
        catch { /* fall through to ending the board itself */ }
        try { if (!board.HasExited) TerminateProcess(board.Handle, 1); }
        catch { /* it ended between the check and the end */ }
    }

    // schtasks inside SchtasksTimeoutMs, with no window. Its output is not redirected (a GUI launch
    // has no console for it to reach, and a pipe nobody reads could hold it open), and what it says
    // is not trusted either way: `/Run` reports success when IgnoreNew started nothing
    // (engine/win32board.js taskXml), so the port is what is checked.
    // Its exit code, or -1 when it did not run or did not finish in time (#4381 reads it for the
    // connect switch's /DISABLE; #4543's callers ignore it).
    static int RunSchtasks(string arguments)
    {
        try
        {
            ProcessStartInfo task = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "schtasks.exe"), arguments);
            task.UseShellExecute = false;
            task.CreateNoWindow = true;
            using (Process schtasks = Process.Start(task))
            {
                if (!schtasks.WaitForExit(SchtasksTimeoutMs)) { try { schtasks.Kill(); } catch { /* it ended */ } return -1; }
                return schtasks.ExitCode;
            }
        }
        catch { /* a task that cannot be ended or started leaves the port check to decide */ return -1; }
    }

    // ---- this computer runs agents, or connects to agents on another computer (#4356, #4381) ----
    //
    // The Windows half of Josh's first-run choice (#4356, option A). The Mac half is
    // native-app/main.swift (computerMode, connectLinkDecision, switchToConnect, runAgentsHere); the
    // page's half is web/index.html (frChoiceBridge, frChoiceWanted, frChoose), shared by both. One
    // word per computer and account, in %LOCALAPPDATA%\Kosmos\mode (ComputerModeFile):
    //   (no file)  never chosen: a fresh install (asked), or any install from before #4356, which
    //              behaves exactly as it always did;
    //   run        this computer runs agents;
    //   connect    the window opens Kosmos Plus sign-in, and this computer never starts its board;
    //   both       runs agents, as run does; first run ends at Kosmos Plus sign-in (the page does it);
    //   anything else, or a file that cannot be read: UNREADABLE. The window asks again; it never
    //   quietly picks one of the three.
    // Outside the Kosmos folder on purpose: the updater swaps that folder by renames of exactly its
    // ENTRIES (engine/win32update.js), and %LOCALAPPDATA%\Kosmos is where the window keeps its web
    // profile already, which the uninstall removes (engine/win32uninstall.js item 8), so a reinstall
    // asks again, as a fresh Mac does.

    /* 🚦 THE RELEASE SWITCH, the Windows twin of the Mac's kosmosFirstRunChoice (Liu Kang m2647). OFF,
       first run is exactly today's: the window never asks, never reads the mode file, never connects.
       One exception, on purpose (#5492, Mac parity): the #5169 navigation rules apply to a run computer
       too, so with the switch off they reach EVERY Windows computer, as the Mac applies #5169 with its
       switch off. Everything else below is unchanged while it is off. It stays off until a connect computer can update
       itself (#4382), whose Windows half turns it on; tools.windows-computer-mode-4381.test.js pins it
       off on main. `static readonly`, not const, only so the unreachable ON branches do not warn. */
    internal static readonly bool FirstRunChoice = false;

    internal enum ComputerMode { Unset, Run, Connect, Both, Unreadable }

    // engine/win32apply.js reads the same file before any update starts a board (COMPUTER_MODE_*),
    // pinned equal by the test.
    internal const string ComputerModeFolderName = "Kosmos";
    internal const string ComputerModeFileName = "mode";

    // Not const only so the probe a test compiles beside this file can point it at a scratch folder.
    internal static Func<string> computerModeFile = () =>
        Path.Combine(Path.Combine(LocalAppDataFolder(), ComputerModeFolderName), ComputerModeFileName);

    // The Mac's computerMode(fromFile:), byte for byte, and the same rows. null is "no file". Strict
    // UTF-8, then every trailing \n dropped and nothing else, so:
    //   - a \r\n ending (what Notepad writes) is UNREADABLE, as on the Mac. Decided on purpose: the
    //     person is asked again, which is safe, and the app and the engine never read one file two
    //     ways. Tolerating it would be the first place the two platforms disagree about the same bytes;
    //   - a byte order mark is UNREADABLE (strict decoding keeps it as U+FEFF, which is not a word).
    internal static ComputerMode ComputerModeFromBytes(byte[] data)
    {
        if (data == null) return ComputerMode.Unset;
        string text;
        try { text = new UTF8Encoding(false, true).GetString(data); }
        catch { return ComputerMode.Unreadable; }
        while (text.EndsWith("\n", StringComparison.Ordinal)) text = text.Substring(0, text.Length - 1);
        switch (text)
        {
            case "run": return ComputerMode.Run;
            case "connect": return ComputerMode.Connect;
            case "both": return ComputerMode.Both;
            default: return ComputerMode.Unreadable;
        }
    }

    // A missing file (or folder) is Unset; any other failure to read it is Unreadable, never Unset: a
    // choice that is there but cannot be read must not make a connect computer start its board.
    internal static ComputerMode ReadComputerMode(string file)
    {
        byte[] data;
        try { data = File.ReadAllBytes(file); }
        catch (FileNotFoundException) { return ComputerMode.Unset; }
        catch (DirectoryNotFoundException) { return ComputerMode.Unset; }
        catch { return ComputerMode.Unreadable; }
        return ComputerModeFromBytes(data);
    }

    // What this launch acts on. With the switch off, every computer runs agents, as before #4356, and
    // the file is not even read.
    internal static ComputerMode LaunchComputerMode()
    {
        if (!FirstRunChoice) return ComputerMode.Run;
        return ReadComputerMode(computerModeFile());
    }

    internal static string ModeWord(ComputerMode mode)
    {
        return mode.ToString().ToLowerInvariant();
    }

    // Only the three real choices are ever written, "word\n" as the Mac writes it, and atomically: a
    // temp file beside it, then one rename into place (File.Replace over a file already there,
    // File.Move when there is none), so a reader never sees half a word. Only Kosmos.exe writes it.
    // False when it could not be saved.
    internal static bool WriteComputerMode(ComputerMode mode, string file)
    {
        if (mode != ComputerMode.Run && mode != ComputerMode.Connect && mode != ComputerMode.Both) return false;
        string temp = null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllBytes(temp, Encoding.ASCII.GetBytes(ModeWord(mode) + "\n"));
            if (File.Exists(file)) File.Replace(temp, file, null);
            else File.Move(temp, file);
            temp = null;
            return true;
        }
        catch { return false; }
        finally { if (temp != null) { try { File.Delete(temp); } catch { /* a stray temp file is not worth failing over */ } } }
    }

    // The board address plus what the page must know (the Mac's withModeQuery): `unset` shows the first
    // screen before first run, `unreadable` shows it even after (web frChoiceWanted), and `both` ends
    // first run at Kosmos Plus sign-in (web frPlusLast). `run` adds nothing. The boot nonce and anything
    // else already on the address are kept: the board's ?boot= redirect keeps every other parameter
    // (engine/boardauth.js pathWithoutParam).
    internal static string WithModeQuery(string address, ComputerMode mode)
    {
        if (mode != ComputerMode.Unset && mode != ComputerMode.Unreadable && mode != ComputerMode.Both) return address;
        Uri uri;
        if (address == null || !Uri.TryCreate(address, UriKind.Absolute, out uri)) return address;
        UriBuilder b = new UriBuilder(uri);
        string query = b.Query.Length > 0 && b.Query[0] == '?' ? b.Query.Substring(1) : b.Query;
        b.Query = (query.Length > 0 ? query + "&" : "") + "mode=" + ModeWord(mode);
        return b.Uri.AbsoluteUri;
    }

    // A page's { kosmosMode: "<word>" } (web frChoiceBridge), as its string, or null when the message is
    // not a mode message. What the word means is PageChoseMode's to decide.
    internal static string ModeFromPageMessage(string json)
    {
        string raw = TaskbarBadge.JsonMember(json, PageModeMessageKey);
        if (raw == null || raw.Length < 2 || raw[0] != '"') return null;
        int end;
        string word = ReadJsonString(raw, 0, out end);
        return word != null && end == raw.Length - 1 ? word : null;
    }

    internal const string PageModeMessageKey = "kosmosMode";

    // #6512 (the Windows half of #6358): the page's { kosmosSignin: true } (web signedOutTellApp), sent when the
    // board no longer knows this window's session (a board restart or update ends every one). Only `true` is the
    // message; anything else is not.
    internal const string PageSigninMessageKey = "kosmosSignin";
    internal static bool IsSigninPageMessage(string json)
    {
        string raw = TaskbarBadge.JsonMember(json, PageSigninMessageKey);
        return raw != null && raw.Trim() == "true";
    }

    // #6512: PURE. What the window does with the page's "signed out", as the Mac's signInAgainDecision: sign in
    // again (SignInAgain, the same fresh ?boot= address a second double-click of Kosmos.exe loads); wait, inside the
    // once-a-minute limit, so a sign-in the board does not take never reloads the window in a loop; or give up, once,
    // after SignInAgainTries sign-ins in a row brought no board read. After giving up the window stays out of it
    // (Stay) until a board read works (the page's badge post), and the page's panel says to open Kosmos.exe again,
    // which still signs in. `lastMs` is null before the first try.
    // Two differences from the Mac, both deliberate. No `refused` input: the Mac reads a refusal from a kept
    // `?token=`, and this window signs in with a single-use `?boot=` nonce, whose refusal leaves nothing to read; the
    // three-try cap covers it, at up to about three minutes of tries. And no `haveToken` input: a board.token read
    // that fails (missing, or a sharing violation while the board writes it, likeliest right at a restart) is not a
    // give-up at once, as one unlucky read would then switch the sign-in off for good. Such a try finds no ?boot=
    // address (open-board.js names one only with the token) and counts toward the same cap.
    internal enum SignInAgainStep { SignIn, Wait, GiveUp, Stay }
    internal const long SignInAgainMinGapMs = 60000;
    internal const int SignInAgainTries = 3;
    internal static SignInAgainStep SignInAgainDecision(long nowMs, long? lastMs, bool gaveUp, int triesWithoutRead)
    {
        if (gaveUp) return SignInAgainStep.Stay;
        if (triesWithoutRead >= SignInAgainTries) return SignInAgainStep.GiveUp;
        if (lastMs == null || nowMs - lastMs.Value >= SignInAgainMinGapMs) return SignInAgainStep.SignIn;
        return SignInAgainStep.Wait;
    }

    // #6512: PURE. The address a sign-in the PAGE asked for loads, as the Mac's signInAgainPage: the page the person
    // was on, so a board restart does not throw them back to the front page. Only a page of this board
    // (IsBoardAddress) is kept, and only its path, query and fragment: the scheme, host and port stay open-board.js's
    // `fresh` address, so the session cookie lands on the host that minted the nonce. A `token`, `boot`, `signin` or
    // `mode` item already in the kept page is dropped (`mode` because WithModeQuery adds its own where the first
    // screen needs one, and on a computer that runs agents the page reads none). Names are compared decoded, as the
    // board's URLSearchParams reads them, and fresh's `boot` nonce goes FIRST, so it is the one the board reads. Only
    // the nonce is taken from fresh: open-board.js --print-url names `/?boot=<nonce>` and nothing else. With no
    // nonce in fresh, or no board page to keep, it is `fresh` unchanged.
    internal static string SignInAgainAddress(string fresh, string page, int port)
    {
        Uri freshUri;
        if (fresh == null || !Uri.TryCreate(fresh, UriKind.Absolute, out freshUri)) return fresh;
        string boot = null;
        foreach (string item in QueryItems(freshUri.Query))
        {
            if (item.StartsWith("boot=", StringComparison.Ordinal)) { boot = item; break; }
        }
        Uri pageUri;
        if (boot == null || page == null || !IsBoardAddress(page, port) || !Uri.TryCreate(page, UriKind.Absolute, out pageUri)
            || pageUri.UserInfo.Length > 0) return fresh;
        StringBuilder query = new StringBuilder(boot);
        foreach (string item in QueryItems(pageUri.Query))
        {
            int eq = item.IndexOf('=');
            string name = QueryName(eq < 0 ? item : item.Substring(0, eq));
            if (name == "token" || name == "boot" || name == "signin" || name == "mode") continue;
            query.Append('&').Append(item);
        }
        UriBuilder b = new UriBuilder(freshUri);
        b.Path = pageUri.AbsolutePath;
        b.Query = query.ToString();
        b.Fragment = pageUri.Fragment.TrimStart('#');
        return b.Uri.AbsoluteUri;
    }

    // A query item's name as URLSearchParams reads it: `+` is a space, and %XX is decoded.
    static string QueryName(string raw)
    {
        try { return Uri.UnescapeDataString(raw.Replace('+', ' ')); }
        catch { return raw; }
    }

    // The `name=value` items of a URI's query (`?` and empty items dropped), as written: nothing is unescaped.
    static string[] QueryItems(string query)
    {
        if (string.IsNullOrEmpty(query)) return new string[0];
        if (query[0] == '?') query = query.Substring(1);
        return query.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries);
    }

    // Where a connect computer's window goes: the same origin the phone apps and the Mac load (#2854).
    internal const string KosmosPlusSignIn = "https://login.kosmosplus.com/";

    internal enum ConnectLink { InApp, Browser, Block }

    // Kosmos Plus itself or one of the person's computers, over https: the plain host, no user part, no
    // port but 443, ASCII only. A computer is one label directly under kosmosplus.com, never deeper: 1
    // to 63 of a-z, 0-9 and "-", no "-" at either end, and no "xn--" (punycode lookalikes). A port of
    // the Mac's isKosmosPlusURL (itself the iOS rule), not shared code; the probe rows pin it.
    internal static bool IsKosmosPlusAddress(string address)
    {
        if (address == null) return false;
        foreach (char c in address) if (c > 127) return false;
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 || uri.Port != 443) return false;
        string host = uri.Host.ToLowerInvariant();
        string coordinator = new Uri(KosmosPlusSignIn).Host;
        if (host == coordinator) return true;
        string suffix = coordinator.Substring(coordinator.IndexOf('.'));
        if (!host.EndsWith(suffix, StringComparison.Ordinal)) return false;
        string label = host.Substring(0, host.Length - suffix.Length);
        if (label.Length < 1 || label.Length > 63 || label[0] == '-' || label[label.Length - 1] == '-' || label.StartsWith("xn--", StringComparison.Ordinal)) return false;
        foreach (char c in label)
        {
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
        }
        return true;
    }

    // #5483 (the Mac's isKosmosPlusSiteURL, #5169): the Kosmos Plus SITE, meaning the sign-in coordinator
    // or its apex, and NOT a computer's board (josh.kosmosplus.com). Only the site may hand off to a
    // foreign page by script (signin.html -> checkout.stripe.com); a board page that could would be #5169.
    internal static bool IsKosmosPlusSiteAddress(string address)
    {
        if (address == null) return false;
        foreach (char c in address) if (c > 127) return false;
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 || uri.Port != 443 || uri.Host.Length == 0) return false;
        string host = uri.Host.ToLowerInvariant();
        string coordinator = new Uri(KosmosPlusSignIn).Host;
        if (host == coordinator) return true;
        int dot = coordinator.IndexOf('.');
        return dot > 0 && host == coordinator.Substring(dot + 1);   // "login.kosmosplus.com" -> "kosmosplus.com"
    }

    // A connect computer's main-frame navigations, as the Mac's connectLinkDecision decides them: Kosmos
    // Plus and the person's computers in the window; any other https site in the person's browser, but
    // only from a click or from the Kosmos Plus SITE (#5483, the Mac's #5169: any other UNCLICKED
    // foreign nav, a redirect or a script, is refused, not opened); plain http, mail, phone and text
    // links only from a click, and then in the browser; about:blank for the page's own use; every
    // other scheme refused. So another site can never REPLACE the window's page with a fake Kosmos
    // screen, and this computer's stopped board is never loaded by a script.
    // #5492 (the Mac's #5169 `board:`): a run or both computer passes the port its own board serves, and
    // that board's pages stay in the window, clicked or not. A connect computer passes none (its board is
    // stopped), so for connect nothing changes.
    internal static ConnectLink ConnectLinkDecision(string address, bool clicked, bool fromKosmosPlusPage = false, int boardPort = 0)
    {
        Uri uri;
        if (address == null || !Uri.TryCreate(address, UriKind.Absolute, out uri)) return ConnectLink.Block;
        if (boardPort > 0 && IsBoardAddress(address, boardPort)) return ConnectLink.InApp;
        // An if chain, not a string switch: this compiler turns a switch of six or more strings into a
        // class named by a fresh GUID each build, which verify-launcher.ps1 would then have to mask.
        string scheme = uri.Scheme.ToLowerInvariant();
        if (scheme == "https")
        {
            if (IsKosmosPlusAddress(address)) return ConnectLink.InApp;
            if (uri.Host.Length == 0) return ConnectLink.Block;
            // #5483 (#5169): an UNCLICKED foreign nav is refused, EXCEPT from the Kosmos Plus SITE, which
            // hands off to checkout by script; without that, Buy and Billing silently do nothing.
            return (clicked || fromKosmosPlusPage) ? ConnectLink.Browser : ConnectLink.Block;
        }
        if (scheme == "http")
        {
            if (uri.Host.Length == 0) return ConnectLink.Block;
            return clicked ? ConnectLink.Browser : ConnectLink.Block;
        }
        if (scheme == "mailto" || scheme == "tel" || scheme == "sms") return clicked ? ConnectLink.Browser : ConnectLink.Block;
        if (scheme == "about") return address == "about:blank" ? ConnectLink.InApp : ConnectLink.Block;
        return ConnectLink.Block;
    }

    // ---- #7403 (Windows parity with the Mac's #7384): a download or link the window does not act on says why ----

    // The Mac's refusalShouldShow (#5167, 2026-10-27), rule for rule: a refusal is put on screen only when no other
    // Kosmos alert is up (`asking` is the Mac's Allow question; Windows has none, so the window passes false), not
    // within `windowMs` of the last alert's OK WHATEVER its sentence (two alternating sentences would otherwise put one
    // up straight after every OK, and a modal box blocks the window), and at most `perPage` of the SAME sentence on one
    // page (a page retrying on a timer). Every refusal is logged either way (BoardWindowForm.TellRefusal).
    internal static bool RefusalShouldShow(bool up, bool asking, long? lastAtMs, long nowMs, long windowMs, int shownThisPage, int perPage)
    {
        if (up || asking || shownThisPage >= perPage) return false;
        if (lastAtMs.HasValue && nowMs - lastAtMs.Value < windowMs) return false;
        return true;
    }

    internal const long RefusalRepeatMs = 10000;   // the Mac's refusalRepeatSeconds
    internal const int RefusalsPerPage = 2;        // the Mac's refusalsPerPage

    // The guard's state, apart from the window so the probe can drive it with its own clock: how many alerts are up,
    // when the last one was answered, and how many of each sentence were shown on the page of commit `page`.
    internal sealed class RefusalGate
    {
        int up;
        long? lastAtMs;
        int page = -1;
        readonly Dictionary<string, int> shown = new Dictionary<string, int>(StringComparer.Ordinal);
        internal int Up { get { return up; } }
        // Whether `sentence` goes on screen now, on the page of commit `pageCommit`. When it does, it is counted as up
        // until Answered: so a second refusal before the box has even opened waits too.
        internal bool Ask(string sentence, long nowMs, int pageCommit)
        {
            if (page != pageCommit) { page = pageCommit; shown.Clear(); }
            int n;
            shown.TryGetValue(sentence, out n);
            if (!RefusalShouldShow(up > 0, false, lastAtMs, nowMs, RefusalRepeatMs, n, RefusalsPerPage)) return false;
            shown[sentence] = n + 1;
            up++;
            return true;
        }
        // The box was answered (OK, or closed): the cool-down counts from here, as the Mac's counts from the OK.
        internal void Answered(long nowMs) { if (up > 0) up--; lastAtMs = nowMs; }
    }

    internal const string DidNotSaveFile = "Kosmos did not save that file: ";
    internal const string DidNotOpenLink = "Kosmos did not open that link: ";

    // COREWEBVIEW2_DOWNLOAD_STATE and COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON (WebView2.h 1.0.4191.47, lines 2524-2563).
    internal const int DownloadStateInterrupted = 1;
    internal const int DownloadInterruptUserCanceled = 26;
    internal const int DownloadInterruptUserShutdown = 27;
    internal const int DownloadInterruptUserPaused = 28;

    // What the window says about a download WebView2 reports INTERRUPTED with `reason`, or null for one the person
    // chose (they cancelled it in the Downloads panel, closed Kosmos, or paused it) and for NONE. The reasons a board
    // download can meet are said in plain words; any other is said too, generically: a download that did not save
    // never ends with nothing from Kosmos. An int chain, not a string switch (see ConnectLinkDecision).
    internal static string DownloadInterruptedSays(int reason)
    {
        if (reason == 0 || reason == DownloadInterruptUserCanceled || reason == DownloadInterruptUserShutdown || reason == DownloadInterruptUserPaused) return null;
        string why;
        if (reason == 1 || reason == 7) why = "Windows could not write it to your Downloads folder. Try again in a moment.";            // FILE_FAILED, FILE_TRANSIENT_ERROR
        else if (reason == 2) why = "Windows would not let it be written to your Downloads folder.";                                    // FILE_ACCESS_DENIED
        else if (reason == 3 || reason == 5) why = "there is not enough free space on this computer for it.";                             // FILE_NO_SPACE, FILE_TOO_LARGE
        else if (reason == 4) why = "its name is too long for Windows.";                                                                // FILE_NAME_TOO_LONG
        else if (reason == 6) why = "Windows security found that it might be harmful.";                                                  // FILE_MALICIOUS
        else if (reason == 8) why = "a setting on this computer blocks files like it.";                                                  // FILE_BLOCKED_BY_POLICY
        else if (reason == 9) why = "Windows could not check it for viruses.";                                                           // FILE_SECURITY_CHECK_FAILED
        else if (reason == 10 || reason == 11 || reason == 23 || reason == 24) why = "it arrived incomplete. Try again.";               // FILE_TOO_SHORT, FILE_HASH_MISMATCH, SERVER_UNEXPECTED_RESPONSE, SERVER_CONTENT_LENGTH_MISMATCH
        else if (reason == 12 || reason == 14) why = "the connection dropped before it finished. Check this computer's internet connection and try again.";   // NETWORK_FAILED, NETWORK_DISCONNECTED
        else if (reason == 13) why = "the connection took too long. Try again.";                                                         // NETWORK_TIMEOUT
        else if (reason == 15) why = "the computer it comes from stopped answering. Try again in a moment.";                            // NETWORK_SERVER_DOWN
        else if (reason == 19) why = "the file is not there. It may have been moved or removed.";                                        // SERVER_BAD_CONTENT (a 404: Chromium's "No file")
        else if (reason == 20) why = "the computer it comes from asked for a sign-in first.";                                            // SERVER_UNAUTHORIZED
        else if (reason == 21) why = "the connection to where it comes from could not be trusted.";                                      // SERVER_CERTIFICATE_PROBLEM
        else if (reason == 22) why = "the computer it comes from refused to send it.";                                                   // SERVER_FORBIDDEN
        else if (reason == 25) why = "it pointed somewhere Kosmos does not save from.";                                                  // SERVER_CROSS_ORIGIN_REDIRECT
        else if (reason == 16 || reason == 17 || reason == 18) why = "the computer it comes from could not send it. Try again in a moment.";   // NETWORK_INVALID_REQUEST, SERVER_FAILED, SERVER_NO_RANGE
        else if (reason == 29) why = "the part of Windows that saves downloads stopped unexpectedly. Try again.";                         // DOWNLOAD_PROCESS_CRASHED
        else why = "the download stopped before it finished.";
        return DidNotSaveFile + why;
    }

    // What the window says about a main-frame navigation it refused (ConnectLink.Block): the page tried to leave
    // without a click, or for something that is not a web page. Only the host is named (punycode, so a lookalike
    // cannot pass as a familiar name), never the page's own text, and never more than 80 characters of it.
    internal static string LinkBlockedSays(string address)
    {
        Uri uri;
        if (address == null || !Uri.TryCreate(address, UriKind.Absolute, out uri)) return DidNotOpenLink + "it is not an address Kosmos can open.";
        string scheme = uri.Scheme.ToLowerInvariant();
        if (scheme == "http" || scheme == "https")
        {
            string host = uri.IdnHost;
            if (string.IsNullOrEmpty(host)) return DidNotOpenLink + "it is not an address Kosmos can open.";
            if (host.Length > 80) host = host.Substring(0, 80) + "...";
            return DidNotOpenLink + "this page tried to go to " + host + " on its own. Kosmos opens another site only when you click a link to it.";
        }
        if (scheme == "mailto" || scheme == "tel" || scheme == "sms")
            return DidNotOpenLink + "this page tried to open a mail, phone or text link on its own. Kosmos opens those only when you click them.";
        return DidNotOpenLink + "Kosmos does not open that kind of link from its window.";
    }

    // #7403: the board answers a plain navigation to a download it refuses with 204 and no body (server.js
    // refuseDownload), which Chromium takes as nothing to show or save: the page stays and nothing is said.
    // ⚠️ MEASURED (#7403, WebView2 Runtime on the Windows box): WebView2 reports that navigation as failed with
    // WebErrorStatus CONNECTION_ABORTED (9) and an HttpStatusCode of 0, not 204: Chromium aborts a 204 navigation
    // before it has a response to report. So the status alone cannot find it. What does: a main-frame navigation to
    // one of the board's download routes (IsBoardDownloadAddress), on the board or a Kosmos Plus computer's board,
    // that failed with CONNECTION_ABORTED or 204, and started no download (the caller waits a moment to know that: a
    // download the board did send aborts its navigation the same way). The board's reason is not in the answer, so
    // the sentence names the usual ones.
    internal const int WebErrorConnectionAborted = 9;   // COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED (WebView2.h 2937)
    internal const string NoContentRefusal = DidNotSaveFile + "the board would not send it. It may have been moved or removed, or be too large to send.";
    internal static string NoContentNavigationSays(bool success, int webErrorStatus, int httpStatus, bool toBoard, string address)
    {
        if (success || !toBoard || !IsBoardDownloadAddress(address)) return null;
        return httpStatus == 204 || webErrorStatus == WebErrorConnectionAborted ? NoContentRefusal : null;
    }

    // Whether a download that started at `startedAtMs` came of a navigation that ended at `endedAtMs`: it started at
    // most two seconds before the end (the order of the two events is WebView2's) or within the wait after it. An
    // older download (a file saved a minute ago, refused now) does not hide the refusal.
    internal const long DownloadBeforeNavigationEndMs = 2000;
    internal const int DownloadSettleMs = 1500;   // how long the window waits after the navigation ends before it looks
    internal static bool DownloadCameOfNavigation(long startedAtMs, long endedAtMs, long settleMs)
    {
        return startedAtMs >= endedAtMs - DownloadBeforeNavigationEndMs && startedAtMs <= endedAtMs + settleMs;
    }

    // Review 1: ANY download that started in that window counts, whatever its address. Matching the address text
    // missed a download that DID save under another spelling of it (a redirect inside the route, another encoding)
    // and then said "the board would not send it" about a file that was saved. Erring this way can only leave a
    // refusal unsaid while some other download starts at the same moment, which the panel shows anyway.
    internal static bool AnyDownloadCameOfNavigation(IList<long> startedAtMs, long endedAtMs, long settleMs)
    {
        foreach (long started in startedAtMs) if (DownloadCameOfNavigation(started, endedAtMs, settleMs)) return true;
        return false;
    }

    // Review 1: the start times kept are only those a wait still running could ask about. A check asks, at the
    // latest, about starts from DownloadBeforeNavigationEndMs before an end at most DownloadSettleMs ago, so anything
    // older than both together is dropped whenever a download starts.
    internal const long DownloadStartsKeptMs = DownloadBeforeNavigationEndMs + DownloadSettleMs;
    internal static void PruneDownloadStarts(List<long> startedAtMs, long nowMs)
    {
        for (int i = startedAtMs.Count - 1; i >= 0; i--) if (startedAtMs[i] < nowMs - DownloadStartsKeptMs) startedAtMs.RemoveAt(i);
    }

    // Review 1: a refused-looking download navigation is said only once the board is known to have answered: the
    // window's quick check (CheckBoardBeforeReuse) proved it, or this board does not enforce sign-in (the window's
    // own rule for staying, MayNavigateSignedIn). Any other answer means the board may have died under the request,
    // and that goes to the window's existing not-confirmed check instead of a sentence blaming the file.
    internal static bool NoContentRefusalStands(ReuseCheck check)
    {
        return MayNavigateSignedIn(check);
    }

    // The board's download routes, every one of which refuses through refuseDownload (server.js): one agent file
    // (/api/agent/<name>/files/download), one agent folder as a zip (.../files/download-folder), one project file
    // (/api/project/<id>/file-download). Matched on the path alone; the query (?name=) is the board's to judge.
    internal static bool IsBoardDownloadAddress(string address)
    {
        Uri uri;
        if (address == null || !Uri.TryCreate(address, UriKind.Absolute, out uri)) return false;
        string[] parts = uri.AbsolutePath.Split('/');
        // "", "api", "agent", <name>, "files", "download" | "download-folder"  /  "", "api", "project", <id>, "file-download"
        if (parts.Length == 6 && parts[0].Length == 0 && parts[1] == "api" && parts[2] == "agent" && parts[3].Length > 0 && parts[4] == "files")
            return parts[5] == "download" || parts[5] == "download-folder";
        if (parts.Length == 5 && parts[0].Length == 0 && parts[1] == "api" && parts[2] == "project" && parts[3].Length > 0)
            return parts[4] == "file-download";
        return false;
    }

    // Every refusal is logged either way, as the Mac's logLine. The launcher keeps no log file, so
    // it goes to the debugger stream: DebugView, or any debugger attached to Kosmos.exe, reads it.
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern void OutputDebugStringW(string text);
    internal static void NoteRefusal(string text)
    {
        try { OutputDebugStringW("Kosmos #7403: " + text + "\n"); } catch { /* a note that cannot be written changes nothing */ }
    }

    // The board task this port is served by, or null: a launch that sets PORT serves a port the logon
    // task does not (#4543's rule, and engine/win32handoff.js overriddenBy's), so its task is never
    // disabled, enabled, ended or run from here. That is also what keeps a throwaway board on a spare
    // port away from the real Kosmos\board.
    internal static string BoardTaskForThisPort()
    {
        return string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PORT")) ? BoardTaskName : null;
    }

    // 🛑 CONNECT'S STEPS 2 AND 3, IN THIS ORDER (#4381): Windows has no board.stopped marker and no
    // `kosmos stop`, so the Mac's one command is two steps here.
    //   2. the board's logon task is switched off (`/Change /DISABLE`), so a sign-in does not bring the
    //      board back, and nothing else can `/Run` it either: a disabled task does not start. This is the
    //      Windows board.stopped. Only a task that exists is switched off; one that is not there has
    //      nothing to bring back. Then `/End`, so Task Scheduler stops counting it as running.
    //   3. every Kosmos board of this user still listening on the port is ended with its process tree
    //      (EndProcessTree, held open from the moment it is judged, as #4543 ends one).
    // True when both held: the task is off (or absent, or not this port's) and no board of ours holds
    // the port. False is said to the person (the window's ShowBoardStillRunning). Never throws. Idempotent,
    // so every launch of a connect computer runs it again (the Mac's stopBoardIfRunning).
    internal static bool StopBoardHere(int port, string taskName)
    {
        try
        {
            bool ok = true;
            if (taskName != null && RunSchtasks("/Query /TN " + QuoteArgument(taskName)) == 0)
            {
                if (RunSchtasks("/Change /TN " + QuoteArgument(taskName) + " /DISABLE") != 0) ok = false;
                RunSchtasks("/End /TN " + QuoteArgument(taskName));
            }
            return EndKosmosBoardsOnPort(port) && ok;
        }
        catch { return false; }
    }

    // Every listener on the port that is a Kosmos board of this user, ended with its tree; anything else
    // listening there is somebody else's and is left alone. True when none of ours holds the port after.
    internal static bool EndKosmosBoardsOnPort(int port)
    {
        List<int> listening = ListenersOnPort(port);
        if (listening == null) return false;
        if (listening.Count == 0) return true;
        List<HeldProcess> held = new List<HeldProcess>();
        try
        {
            foreach (int pid in listening)
            {
                HeldProcess process = HeldProcess.Open(pid);
                if (process != null) held.Add(process);
            }
            // Read again with the handles held, as DecideAfterTheWait does: a number let go and reused
            // between the read and the open no longer names a listener.
            List<int> again = ListenersOnPort(port);
            if (again == null) return false;
            held.RemoveAll(p => { if (again.Contains(p.Id) && isKosmosBoardProcess(p)) return false; p.Dispose(); return true; });
            if (held.Count == 0) return true;
            foreach (HeldProcess board in held) EndProcessTree(board);
            WaitForPortRelease(port, held);
            return StillListening(port, held).Count == 0;
        }
        finally { foreach (HeldProcess p in held) p.Dispose(); }
    }

    // "Run agents on this computer", step 3 (the way back from connect): the logon task is switched on
    // again, so the launch that follows hands the board to it as on any computer. A task the person
    // switched off is otherwise LEFT off by the board's own boot (win32board.ensureInstalled), and the
    // board would serve from the launcher instead.
    internal static void EnableBoardTask(string taskName)
    {
        if (taskName != null) RunSchtasks("/Change /TN " + QuoteArgument(taskName) + " /ENABLE");
    }

    // ---- presenting to a person ----------------------------------------------

    // In its own method, and never inlined, so the ordinary launch -- which
    // shows no box -- never loads Windows Forms at all.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void ShowMessageBox(string text, bool isError)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            // Visual styles make it a current Windows dialog, not a Windows 95 one.
            System.Windows.Forms.Application.EnableVisualStyles();
            System.Windows.Forms.MessageBox.Show(text, WindowTitle,
                System.Windows.Forms.MessageBoxButtons.OK,
                isError ? System.Windows.Forms.MessageBoxIcon.Error : System.Windows.Forms.MessageBoxIcon.Warning);
        }
        catch
        {
            // Windows Forms ships with every .NET 4 install, but a message that
            // never shows is how a real error becomes "it just didn't do
            // anything", so fall back to the plain user32 box.
            MessageBoxW(IntPtr.Zero, text, WindowTitle, isError ? MB_ICONERROR : MB_ICONWARNING);
        }
    }

    // Set once the running-here box has returned, so the thread closing it stops.
    // Read and written only under runningHereBoxLock.
    static bool boxIsClosed;
    static readonly object runningHereBoxLock = new object();

    // The board did not move to its logon task, so it is serving from this
    // launcher's hidden console. Nothing about that is visible or closable, so
    // this box is the person's handle on it: OK stops the board, and the box
    // closes by itself if the board ends first. True when the person stopped it.
    static bool KeepBoardUntilPersonStopsIt(Process server)
    {
        uint boxThread = GetCurrentThreadId();
        boxIsClosed = false;
        Thread closeBoxWhenBoardEnds = new Thread(() =>
        {
            server.WaitForExit();
            EnumWindowsProc closeDialogs = (window, unused) =>
            {
                StringBuilder className = new StringBuilder(64);
                GetClassName(window, className, className.Capacity);
                if (className.ToString() == DialogWindowClass) PostMessage(window, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return true;
            };
            // Retried until the box has returned: the board can end in the moment
            // before the box's window exists, and a WM_CLOSE then lands nowhere.
            // The check and the enumeration happen under the lock the main thread
            // takes to mark the box closed, so a box shown after this one (the
            // crash box) can never be sent a WM_CLOSE meant for this one.
            while (true)
            {
                lock (runningHereBoxLock)
                {
                    if (boxIsClosed) return;
                    EnumThreadWindows(boxThread, closeDialogs, IntPtr.Zero);
                }
                Thread.Sleep(CloseBoxRetryMs);
            }
        });
        closeBoxWhenBoardEnds.IsBackground = true;
        closeBoxWhenBoardEnds.Start();

        ShowMessageBox(RunningHereMessage, false);
        lock (runningHereBoxLock) { boxIsClosed = true; }
        if (server.HasExited) return false;
        StopServerAndEverythingItStarted(server);
        return true;
    }

    // taskkill /T ends the board and every process still descended from it (its
    // hidden console, anything it spawned). Agents are not among them: each runs
    // under its own Scheduled Task, as does the logon task's board. There is no
    // window to report a failed taskkill in, so it falls back to ending the
    // board process itself.
    static void StopServerAndEverythingItStarted(Process server)
    {
        try
        {
            ProcessStartInfo stop = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), "/PID " + server.Id + " /T /F");
            stop.UseShellExecute = false;
            stop.CreateNoWindow = true;
            using (Process taskkill = Process.Start(stop)) { taskkill.WaitForExit(); }
        }
        catch { /* fall through to ending the board itself */ }
        try { if (!server.HasExited) server.Kill(); }
        catch { /* it ended between the check and the kill */ }
    }

    const uint WM_CLOSE = 0x0010;

    delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    static extern bool EnumThreadWindows(uint threadId, EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, StringBuilder className, int capacity);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();

    const uint MB_ICONERROR = 0x10;
    const uint MB_ICONWARNING = 0x30;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    // A yes/no question, No by default: every question this launcher asks with it is about
    // removing something, and Enter on a default Yes would be the dangerous slip.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static bool AskYesNo(string question)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            return System.Windows.Forms.MessageBox.Show(question, WindowTitle,
                System.Windows.Forms.MessageBoxButtons.YesNo, System.Windows.Forms.MessageBoxIcon.Question,
                System.Windows.Forms.MessageBoxDefaultButton.Button2) == System.Windows.Forms.DialogResult.Yes;
        }
        catch
        {
            return MessageBoxW(IntPtr.Zero, question, WindowTitle, MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) == IDYES;
        }
    }

    // A finished piece of news, not a problem: the removal that worked.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void ShowNotice(string text)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            System.Windows.Forms.MessageBox.Show(text, WindowTitle,
                System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Information);
        }
        catch
        {
            MessageBoxW(IntPtr.Zero, text, WindowTitle, MB_ICONINFORMATION);
        }
    }

    // #3286: while Kosmos installs or updates itself (a copy of about 100 MB, or the updater stopping
    // and starting the board), the person who double-clicked would otherwise see nothing for many
    // seconds and double-click again. So a small window titled Kosmos says what is happening until the
    // work is done. It asks nothing and has no buttons: closing it does not stop the work, which must
    // never be cut off midway. With nobody at the desktop (--console, or no desktop at all) the work
    // simply runs.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void ShowWorkingWhile(string text, Action work)
    {
        if (!showMessageBoxes) { work(); return; }
        System.Windows.Forms.Form form = null;
        try
        {
            try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
            System.Windows.Forms.Application.EnableVisualStyles();
            form = new System.Windows.Forms.Form();
            form.Text = WindowTitle;
            form.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog;
            form.MaximizeBox = false;
            form.MinimizeBox = false;
            form.ControlBox = false;
            form.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            form.Font = System.Drawing.SystemFonts.MessageBoxFont;
            form.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            form.AutoSize = true;
            form.AutoSizeMode = System.Windows.Forms.AutoSizeMode.GrowAndShrink;
            try { form.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); }
            catch { /* the default window icon */ }
            System.Windows.Forms.Label label = new System.Windows.Forms.Label();
            label.AutoSize = true;
            label.MaximumSize = new System.Drawing.Size(420, 0);
            label.Text = text;
            label.Margin = new System.Windows.Forms.Padding(24);
            System.Windows.Forms.FlowLayoutPanel layout = new System.Windows.Forms.FlowLayoutPanel();
            layout.AutoSize = true;
            layout.Controls.Add(label);
            form.Controls.Add(layout);
        }
        catch { form = null; /* no window: the work still runs, in silence as before */ }
        if (form == null) { work(); return; }

        Exception failed = null;
        System.Windows.Forms.Form shown = form;
        Thread worker = new Thread(() =>
        {
            try { work(); }
            catch (Exception e) { failed = e; }
            finally
            {
                try { shown.BeginInvoke(new Action(() => { shown.Tag = "done"; shown.Close(); })); }
                catch { /* the window is already gone */ }
            }
        });
        worker.IsBackground = false;
        // Closing by hand is refused until the work is done (Alt+F4 included): the work goes on either
        // way, and a window that vanished while it did would look like the end.
        form.FormClosing += (sender, e) => { if (!"done".Equals(shown.Tag)) e.Cancel = true; };
        form.Shown += (sender, e) => worker.Start();
        System.Windows.Forms.Application.Run(form);
        worker.Join();
        if (failed != null) throw failed;
    }

    const uint MB_YESNOCANCEL = 0x03;
    const uint MB_YESNO = 0x04;
    const uint MB_ICONQUESTION = 0x20;
    const uint MB_ICONINFORMATION = 0x40;
    const uint MB_DEFBUTTON2 = 0x100;
    const int IDYES = 6;
    const int IDNO = 7;

    // ---- an installer's job, without an installer (win32-installer-native) ----

    // What Windows lists Kosmos as, in the Start menu and in Settings > Apps.
    const string DisplayName = "Kosmos";

    // Settings > Apps shows a Publisher, and it has to be the legal company name -- the same
    // name AssemblyCompany waits for. Josh gave it: Kosmos Agent Manager, Inc. Written only
    // when non-empty; a stale value is deleted while it is empty.
    internal const string PublisherLegalName = "Kosmos Agent Manager, Inc.";

    const string ManifestFileName = "manifest.json";
    const string ShortcutFileName = "Kosmos.lnk";
    const string ShortcutDescription = "Open Kosmos";
    const string UninstallKeyName = "Kosmos";

    // Where Windows keeps per-user uninstall entries: HKCU, so no admin prompt. Not const
    // only so the probe a test compiles beside this file can point it at
    // HKCU\Software\KosmosTest\<guid>; the launcher itself never changes it.
    internal static string uninstallKeyParent = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    // The per-user Start menu's Programs folder (%APPDATA%\Microsoft\Windows\Start Menu\Programs).
    // A seam for the same probe, which points it at a temp folder.
    internal static Func<string> startMenuProgramsFolder = () => Environment.GetFolderPath(Environment.SpecialFolder.Programs);

    // The build's folders whose size Settings > Apps shows, with this exe. Only these, never
    // the whole folder: a zip extracted straight into Downloads would otherwise be walked on
    // every launch. They are engine/win32update.js ENTRIES' folders, pinned equal by
    // tools.win-installer-native.test.js.
    static readonly string[] SizedFolders = { "app", "bin", "runtime" };

    // A real Kosmos build: its manifest.json names the product and the platform at its top
    // level. Only a real build is advertised in the Start menu and Settings > Apps, or
    // installed from.
    internal static bool IsKosmosBuild(string root)
    {
        try
        {
            string manifest = Path.Combine(root, ManifestFileName);
            if (!File.Exists(manifest)) return false;
            string text = File.ReadAllText(manifest, Encoding.UTF8);
            return TopLevelJsonString(text, "product") == "kosmos" && TopLevelJsonString(text, "platform") == "win32";
        }
        catch { return false; }
    }

    // The app version Settings > Apps shows: manifest.json's own top-level "version", never
    // the "version" of the "node" object beside it.
    internal static string AppVersionFromManifest(string manifestText)
    {
        return TopLevelJsonString(manifestText ?? "", "version");
    }

    // The string value of `key` at the top level of a JSON object, or null. A deliberately
    // small reader: .NET Framework has no JSON reader without an extra assembly reference,
    // which would change the build flags verify-launcher.ps1 pins, and manifest.json is the
    // build script's own nearly flat file.
    internal static string TopLevelJsonString(string json, string key)
    {
        int depth = 0;
        for (int i = 0; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '{' || c == '[') { depth++; continue; }
            if (c == '}' || c == ']') { depth--; continue; }
            if (c != '"') continue;
            int end;
            string token = ReadJsonString(json, i, out end);
            if (token == null) return null;
            i = end;
            if (depth != 1 || token != key) continue;
            int j = end + 1;
            while (j < json.Length && char.IsWhiteSpace(json[j])) j++;
            if (j >= json.Length || json[j] != ':') continue;
            j++;
            while (j < json.Length && char.IsWhiteSpace(json[j])) j++;
            if (j >= json.Length || json[j] != '"') return null;
            int valueEnd;
            return ReadJsonString(json, j, out valueEnd);
        }
        return null;
    }

    // One JSON string starting at the quote at `start`; `end` is its closing quote. Null when
    // it never closes.
    internal static string ReadJsonString(string json, int start, out int end)
    {
        StringBuilder value = new StringBuilder();
        for (int i = start + 1; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '"') { end = i; return value.ToString(); }
            if (c != '\\' || i + 1 >= json.Length) { value.Append(c); continue; }
            char escaped = json[++i];
            switch (escaped)
            {
                case 'n': value.Append('\n'); break;
                case 't': value.Append('\t'); break;
                case 'r': value.Append('\r'); break;
                case 'b': value.Append('\b'); break;
                case 'f': value.Append('\f'); break;
                case 'u':
                    if (i + 4 < json.Length) { value.Append((char)Convert.ToInt32(json.Substring(i + 1, 4), 16)); i += 4; }
                    break;
                default: value.Append(escaped); break;
            }
        }
        end = json.Length;
        return null;
    }

    // Every launch of a real build: point the Start menu shortcut and the Settings > Apps entry
    // at the folder Kosmos runs from now. Refreshing each time is what repairs both after
    // Kosmos is extracted to, or moved to, another folder.
    // No box on a problem: a person who opened Kosmos to use it is not interrupted about its
    // shortcut on every launch, and neither one affects Kosmos running. --console says it.
    static void RefreshWindowsRegistration(string root)
    {
        string exe = Assembly.GetExecutingAssembly().Location;
        string shortcutProblem = RefreshStartMenuShortcut(exe, root);
        string version = null;
        try { version = AppVersionFromManifest(File.ReadAllText(Path.Combine(root, ManifestFileName), Encoding.UTF8)); }
        catch { /* no version is written rather than a wrong one */ }
        string entryProblem = RegisterUninstallEntry(exe, root, version, BuildSizeInKilobytes(root, exe));
        if (showMessageBoxes) return;
        if (shortcutProblem != null) Console.Error.WriteLine("Kosmos could not update its Start menu shortcut: " + shortcutProblem);
        if (entryProblem != null) Console.Error.WriteLine("Kosmos could not update its entry in Settings > Apps: " + entryProblem);
    }

    internal static string StartMenuShortcutPath()
    {
        string programs = startMenuProgramsFolder();
        return string.IsNullOrEmpty(programs) ? null : Path.Combine(programs, ShortcutFileName);
    }

    // The Start menu shortcut, through IShellLink: in-process COM, so no PowerShell and no
    // WScript.Shell process. It points at this exe, starts in the Kosmos folder, and shows the
    // icon compiled into the exe. Null when it was written, or what went wrong.
    internal static string RefreshStartMenuShortcut(string exe, string workingDirectory)
    {
        string at = StartMenuShortcutPath();
        if (at == null) return "Windows did not say where the Start menu is";
        object link = null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(at));
            link = new ShellLinkObject();
            IShellLinkW shellLink = (IShellLinkW)link;
            shellLink.SetPath(exe);
            shellLink.SetWorkingDirectory(workingDirectory);
            shellLink.SetIconLocation(exe, 0);
            shellLink.SetDescription(ShortcutDescription);
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(at, true);
            return null;
        }
        catch (Exception e) { return e.Message; }
        finally
        {
            if (link != null) Marshal.FinalReleaseComObject(link);
        }
    }

    internal static string RemoveStartMenuShortcut()
    {
        string at = StartMenuShortcutPath();
        if (at == null) return "the Start menu shortcut, because Windows did not say where the Start menu is";
        try
        {
            if (File.Exists(at)) File.Delete(at);
            return null;
        }
        catch (Exception e) { return "the Start menu shortcut (" + at + "), which could not be deleted (" + e.Message + ")"; }
    }

    // The entry in Settings > Apps > Installed apps, per user, so no admin prompt. Its
    // Uninstall button runs this exe with --uninstall. Null when it was written, or what went
    // wrong.
    internal static string RegisterUninstallEntry(string exe, string root, string version, long sizeInKilobytes)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(uninstallKeyParent + "\\" + UninstallKeyName))
            {
                if (key == null) return "Windows would not open " + uninstallKeyParent + "\\" + UninstallKeyName;
                string uninstall = "\"" + exe + "\" " + UninstallFlag;
                key.SetValue("DisplayName", DisplayName, RegistryValueKind.String);
                // Windows' own shape: the quoted exe and the icon's index, so a path with spaces
                // or a comma is still read as one path.
                key.SetValue("DisplayIcon", "\"" + exe + "\",0", RegistryValueKind.String);
                if (!string.IsNullOrEmpty(version)) key.SetValue("DisplayVersion", version, RegistryValueKind.String);
                else key.DeleteValue("DisplayVersion", false);
                key.SetValue("InstallLocation", root, RegistryValueKind.String);
                key.SetValue("UninstallString", uninstall, RegistryValueKind.String);
                key.SetValue("QuietUninstallString", uninstall, RegistryValueKind.String);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                if (sizeInKilobytes > 0) key.SetValue("EstimatedSize", (int)Math.Min(sizeInKilobytes, int.MaxValue), RegistryValueKind.DWord);
                else key.DeleteValue("EstimatedSize", false);
                if (PublisherLegalName.Length > 0) key.SetValue("Publisher", PublisherLegalName, RegistryValueKind.String);
                else key.DeleteValue("Publisher", false);
                return null;
            }
        }
        catch (Exception e) { return e.Message; }
    }

    internal static string RemoveUninstallEntry()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(uninstallKeyParent + "\\" + UninstallKeyName, false);
            return null;
        }
        catch (Exception e) { return "the Kosmos entry in Settings > Apps, which could not be removed (" + e.Message + ")"; }
    }

    // What Settings > Apps shows as the size: the build's own folders and this exe. An
    // estimate, and never an error: a folder that cannot be read adds nothing.
    internal static long BuildSizeInKilobytes(string root, string exe)
    {
        long bytes = 0;
        try { bytes += new FileInfo(exe).Length; } catch { /* no size for the exe */ }
        foreach (string name in SizedFolders)
        {
            Stack<DirectoryInfo> pending = new Stack<DirectoryInfo>();
            pending.Push(new DirectoryInfo(Path.Combine(root, name)));
            while (pending.Count > 0)
            {
                DirectoryInfo dir = pending.Pop();
                try
                {
                    foreach (FileInfo f in dir.GetFiles()) bytes += f.Length;
                    foreach (DirectoryInfo d in dir.GetDirectories())
                    {
                        if ((d.Attributes & FileAttributes.ReparsePoint) == 0) pending.Push(d);
                    }
                }
                catch { /* unreadable or missing: it adds nothing to an estimate */ }
            }
        }
        return (bytes + 1023) / 1024;
    }

    // IShellLinkW and the ShellLink coclass (shobjidl.h), in the order the vtable declares them.
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLinkObject { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int capacity, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int capacity);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int capacity);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int showCommand);
        void SetShowCmd(int showCommand);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int capacity, out int iconIndex);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string relativePath, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }

    // ---- --uninstall (W-27a) --------------------------------------------------

    const string RemoveQuestion = "Remove Kosmos from this PC? Your agents will stop.";
    // Says what goes and what stays: engine/win32uninstall.js keeps every Kosmos's projects and
    // agents' working folders on a yes (round 1, finding 1).
    const string RemoveChatsQuestion = "Also delete your agents' chats and settings? Your projects and your agents' working folders are kept either way.";
    const string CannotDeleteOwnFolder = "Kosmos can't delete the folder it is running from, so that last step is yours.";
    const string UninstallNeedsAPersonMessage =
        "Kosmos is removed only when you confirm it, and there is nobody here to ask. Remove Kosmos from Settings > Apps > Installed apps, or run Kosmos.exe --uninstall without --console.";
    // --uninstall had nobody to confirm it, so it did nothing.
    const int UninstallNotConfirmedExitCode = 2;

    // Kosmos.exe --uninstall: what Settings > Apps > Installed apps > Uninstall runs.
    // 🛑 THE CONFIRM COMES BEFORE ANY ACTION, and without a person there is no confirm, so
    // nothing happens at all -- QuietUninstallString asks too, because a destructive act never
    // runs unconfirmed. The removing is the engine's (engine/win32uninstall.js); this asks,
    // takes away the two things this file made (the shortcut and the Apps entry), and says
    // what happened. It never schedules deleting its own folder.
    internal static int Uninstall(string here, string node)
    {
        if (!showMessageBoxes)
        {
            Console.Error.WriteLine(UninstallNeedsAPersonMessage);
            return UninstallNotConfirmedExitCode;
        }
        if (!askYesNo(RemoveQuestion)) return 0;
        bool alsoDeleteChats = askYesNo(RemoveChatsQuestion);

        // #1118: an open Kosmos window would be left showing a board that is gone, and it holds
        // its web profile open inside %LOCALAPPDATA%\Kosmos, which the removal deletes. So it is
        // closed first, and only after the person said yes.
        closeBoardWindow(BoardPort());

        List<string> leftBehind = new List<string>();
        List<string> notes = new List<string>();
        string problem;
        string[] report = runEngineHelper(node, here, UninstallHelperScript,
            "--uninstall" + (alsoDeleteChats ? " --delete-data" : "") + " --root " + QuoteArgument(here) + " --port " + BoardPort(), NoHelperTimeout, out problem);
        if (report == null)
        {
            leftBehind.Add("Kosmos's startup jobs in Task Scheduler and its folders in AppData, because the removal could not run (" + problem + ")");
        }
        else
        {
            foreach (string line in report)
            {
                if (line.StartsWith("LEFT ", StringComparison.Ordinal)) leftBehind.Add(line.Substring("LEFT ".Length));
                else if (line.StartsWith("NOTE ", StringComparison.Ordinal)) notes.Add(line.Substring("NOTE ".Length));
            }
        }

        // The Start menu entry, the Apps entry and this launcher's own memory are how a person finds
        // Kosmos and removes it again, so they go only once nothing else was left behind (round 1,
        // finding 9). The Apps entry goes last, so a shortcut that would not go still leaves the
        // way to try again.
        if (leftBehind.Count == 0)
        {
            string shortcutProblem = RemoveStartMenuShortcut();
            if (shortcutProblem != null) leftBehind.Add(shortcutProblem);
            string memoryProblem = ForgetKeptPlaces();
            if (memoryProblem != null) leftBehind.Add(memoryProblem);
        }
        if (leftBehind.Count == 0)
        {
            string entryProblem = RemoveUninstallEntry();
            if (entryProblem != null) leftBehind.Add(entryProblem);
        }
        else
        {
            notes.Add("Kosmos is still in the Start menu and in Settings > Apps > Installed apps, so you can remove it again from there.");
        }

        string said = notes.Count > 0 ? "\n\n" + string.Join("\n", notes.ToArray()) : "";
        if (leftBehind.Count == 0)
        {
            tellPerson("Kosmos is removed. You can now delete the folder " + here + ".\n\n" + CannotDeleteOwnFolder + said, false);
            return 0;
        }
        tellPerson("Kosmos could not remove everything. These were left behind:\n\n- " + string.Join("\n- ", leftBehind.ToArray()) + said, true);
        return 1;
    }

    // The folder list an older launcher wrote when a person chose to keep Kosmos where it was (before #3286). The engine's removal deletes %LOCALAPPDATA%\Kosmos, which
    // holds it, only when that is the plain folder; this file is the launcher's own, so it goes here.
    internal static string ForgetKeptPlaces()
    {
        string file = keptPlacesFile();
        try
        {
            if (File.Exists(file)) File.Delete(file);
            return null;
        }
        catch (Exception e) { return "the list of folders you chose to keep Kosmos in (" + file + "), which could not be deleted (" + e.Message + ")"; }
    }

    // ---- the launcher's acts, as seams ------------------------------------------

    // Everything the installer duties DO to the world -- run an engine helper, start another
    // Kosmos.exe, ask a person, tell a person, refresh the Start menu and the Apps entry -- is one
    // of these fields. The launcher never replaces them; the probe tools.win-installer-native.test.js
    // compiles beside this file does, so the decisions run in a test without a process, a box or
    // the real registry.
    internal delegate string[] EngineHelperRunner(string node, string here, string script, string arguments, int timeoutMs, out string problem);

    // The uninstall and the move wait for their helper however long it takes (see RunEngineHelper).
    const int NoHelperTimeout = 0;

    // Round 3, finding 5: how long the installed-copy compare may take before the launcher carries on
    // without it. It reads two manifests and a folder listing (measured 66-88 ms), so 10 s is only a
    // safety net for a node that hangs; the fallback is "no installed copy", the behaviour before the
    // compare existed. Not const only so the probe a test compiles beside this file can shorten it.
    internal static int compareTimeoutMs = 10000;
    internal static EngineHelperRunner runEngineHelper = RunEngineHelper;
    internal static Func<string, string, string> startLauncher = StartLauncherAt;
    internal static Func<string, bool> askYesNo = AskYesNo;
    internal static Action<string, Action> showWorkingWhile = ShowWorkingWhile;
    internal static Action<string, bool> tellPerson = TellPerson;
    internal static Action<string> refreshWindowsRegistration = RefreshWindowsRegistration;
    internal static Action<int> closeBoardWindow = CloseBoardWindow;

    // A message for the person: a box at a desktop, stderr otherwise (never a box nobody can see).
    static void TellPerson(string text, bool isError)
    {
        if (!showMessageBoxes)
        {
            Console.Error.WriteLine(text);
            return;
        }
        if (isError) ShowMessageBox(text, true);
        else ShowNotice(text);
    }

    // Starts another Kosmos.exe (the installed copy, or the one just moved) in its own folder. Null
    // when it started, or what went wrong.
    static string StartLauncherAt(string exe, string folder)
    {
        try
        {
            ProcessStartInfo other = new ProcessStartInfo(exe);
            other.UseShellExecute = false;
            other.WorkingDirectory = folder;
            using (Process.Start(other)) { }
            return null;
        }
        catch (Exception e) { return e.Message; }
    }

    // Runs one of the engine's own helpers with this folder's node and returns the lines it
    // reported, or null with `problem` saying why. The helper writes its outcome to a file,
    // one tagged sentence per line, so nothing is redirected (the board-start rule in Main)
    // and it runs with no window. ConfirmedFlag is what arms it, and every caller runs this
    // only after the person answered.
    // timeoutMs 0 waits as long as the helper takes: the uninstall and the move are never abandoned
    // midway, because a delete or a copy cut off leaves half a folder. Only a helper that merely reads
    // (the installed-copy compare) is given a limit, and is ended when it passes it.
    static string[] RunEngineHelper(string node, string here, string script, string arguments, int timeoutMs, out string problem)
    {
        problem = null;
        string helper = Path.Combine(here, "app\\engine\\" + script);
        if (!File.Exists(node)) { problem = "the bundled runtime is missing (runtime\\node.exe)"; return null; }
        if (!File.Exists(helper)) { problem = "a Kosmos file is missing (app\\engine\\" + script + ")"; return null; }
        string report = Path.Combine(Path.GetTempPath(), "kosmos-" + Guid.NewGuid().ToString("N") + ".txt");
        try
        {
            ProcessStartInfo h = new ProcessStartInfo(node,
                QuoteArgument(helper) + " " + arguments + " --report " + QuoteArgument(report) + " " + ConfirmedFlag);
            h.UseShellExecute = false;
            h.CreateNoWindow = true;
            h.WorkingDirectory = here;
            using (Process helperRun = Process.Start(h))
            {
                if (timeoutMs <= 0)
                {
                    helperRun.WaitForExit();
                }
                else if (!helperRun.WaitForExit(timeoutMs))
                {
                    try { helperRun.Kill(); } catch { /* it ended between the wait and the kill */ }
                    problem = "it did not finish within " + timeoutMs + "ms, so it was stopped";
                    return null;
                }
            }
            if (!File.Exists(report)) { problem = "it finished without saying what it did"; return null; }
            return File.ReadAllLines(report, Encoding.UTF8);
        }
        catch (Exception e) { problem = e.Message; return null; }
        finally
        {
            try { File.Delete(report); } catch { /* a temp file, and its answer is already read */ }
        }
    }

    // One command-line argument, quoted. A trailing backslash is doubled so it cannot escape
    // the closing quote (a quoted C:\ would otherwise read as C:").
    internal static string QuoteArgument(string value)
    {
        return "\"" + (value.EndsWith("\\") ? value + "\\" : value) + "\"";
    }

    // ---- moving out of a folder that gets cleaned up (W-06) -------------------

    internal static readonly Guid FOLDERID_Downloads = new Guid("374DE290-123F-4565-9164-39C4925E467B");
    internal static readonly Guid FOLDERID_Desktop = new Guid("B4BFCC3A-DB2C-424C-B029-7FE99A87C641");
    internal static readonly Guid FOLDERID_UserProgramFiles = new Guid("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB");

    // The folders that get cleaned up, synced or redirected, each resolved when asked. The
    // Known Folder API is what finds a Desktop or Downloads that OneDrive redirected (this
    // box's Desktop is C:\Users\joshu\OneDrive\Desktop). Replaceable only by the probe a test
    // compiles beside this file.
    internal static Func<string> downloadsFolder = () => KnownFolderPath(FOLDERID_Downloads);
    internal static Func<string> desktopFolder = () => KnownFolderPath(FOLDERID_Desktop);
    internal static Func<string, string> environmentVariable = Environment.GetEnvironmentVariable;
    internal static Func<string[]> temporaryFolders = TempFolders;
    // Where Kosmos moves to: the per-user programs folder VS Code, Discord and Slack install
    // into. It is also the one install location the updater's in-place swap can count on.
    internal static Func<string> userProgramsFolder = () =>
        KnownFolderPath(FOLDERID_UserProgramFiles)
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
    // Where launchers before #3286 remembered, per folder, a person's choice to keep Kosmos where it was: one
    // full path per line, in <LOCALAPPDATA>\Kosmos\launcher. Nothing reads or writes it now (Kosmos installs itself
    // without asking); it is named only so the uninstall removes a copy an older launcher left.
    // That is engine/win32anchor.js's folder by the same rule it uses without overrides: the
    // LOCALAPPDATA variable, else the account's own Local AppData. The launcher does not ask node on
    // every launch (a process per double-click), so the two differ only when the environment carries
    // AGENT_WORKFORCE_DATA or AGENT_WORKFORCE_HOME (a developer's or a test's sandbox, never a
    // person's). The uninstall deletes this file itself (ForgetKeptPlaces), so the difference can
    // never leave it behind.
    internal static Func<string> keptPlacesFile = () =>
        Path.Combine(LocalAppDataFolder(), "Kosmos\\launcher\\kept-here.txt");

    static string LocalAppDataFolder()
    {
        string fromEnvironment = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        return string.IsNullOrEmpty(fromEnvironment) ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) : fromEnvironment;
    }

    static readonly string[] OneDriveVariables = { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" };
    const string InstallFolderName = "Kosmos";
    const string KeepsWorkingHere = "Kosmos keeps working from here.";
    const string UpdateHelperScript = "win32update.js";
    // engine/win32relocate.js reportText's tag for a copy that is in place but that Kosmos could not be set
    // to start from (#3286 review, finding 5).
    const string UnanchoredTag = "UNANCHORED ";

    // #3286: what the working window says while Kosmos installs or updates itself.
    const string InstallingMessage = "Installing Kosmos on this computer. This takes a moment.";
    const string UpdatingMessage = "Updating the Kosmos installed on this computer. Your agents keep their work; Kosmos restarts in a moment.";

    // #3286: a same-version build from another commit, with that version installed: it runs from here.
    internal static string SameVersionNote(string version, string target)
    {
        return "Another copy of Kosmos " + version + " is already installed in " + target + ", so this one runs from here.";
    }

    // The version a Kosmos folder's manifest.json names, or null.
    static string ManifestVersionOf(string folder)
    {
        try { return AppVersionFromManifest(File.ReadAllText(Path.Combine(folder, ManifestFileName), Encoding.UTF8)); }
        catch { return null; }
    }

    // #3286: the plain note, never a question, when Kosmos cannot install itself and runs where it is.
    internal static string CouldNotInstallNote(string place, string target, string because)
    {
        return "Kosmos could not install itself in " + target + ", so it is running from " + place + " for now. " + because
            + "\n\nIf that folder is cleaned up, Kosmos stops working. Kosmos tries again the next time you open it from here.";
    }

    // Which cleaned-up or synced place this folder is in, as the note names it, or null.
    // Most specific first: a Desktop inside OneDrive is "your Desktop".
    internal static string TemporaryPlaceOf(string folder)
    {
        string directory = FullPathOrNull(folder) ?? folder;
        string profile = environmentVariable("USERPROFILE");
        if (IsSameOrInside(directory, FullPathOrNull(downloadsFolder()))
            || (!string.IsNullOrEmpty(profile) && IsSameOrInside(directory, FullPathOrNull(profile.TrimEnd('\\', '/') + "\\Downloads"))))
        {
            return "your Downloads folder";
        }
        if (IsSameOrInside(directory, FullPathOrNull(desktopFolder()))) return "your Desktop";
        foreach (string name in OneDriveVariables)
        {
            if (IsSameOrInside(directory, FullPathOrNull(environmentVariable(name)))) return "your OneDrive folder";
        }
        foreach (string temp in temporaryFolders())
        {
            if (IsSameOrInside(directory, temp)) return "a temporary folder";
        }
        return null;
    }

    // The Known Folder API: the folder Windows itself uses, wherever it was redirected.
    // KF_FLAG_DONT_VERIFY answers for a folder that does not exist yet. Null when Windows has
    // no answer.
    internal static string KnownFolderPath(Guid folder)
    {
        IntPtr found = IntPtr.Zero;
        try
        {
            if (SHGetKnownFolderPath(folder, KF_FLAG_DONT_VERIFY, IntPtr.Zero, out found) != 0) return null;
            return Marshal.PtrToStringUni(found);
        }
        catch { return null; }
        finally
        {
            if (found != IntPtr.Zero) Marshal.FreeCoTaskMem(found);
        }
    }

    const uint KF_FLAG_DONT_VERIFY = 0x00004000;

    [DllImport("shell32.dll")]
    static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid folder, uint flags, IntPtr token, out IntPtr path);

    internal static string MoveTarget()
    {
        string programs = userProgramsFolder();
        return string.IsNullOrEmpty(programs) ? null : FullPathOrNull(Path.Combine(programs, InstallFolderName));
    }

    // Everything this launcher does as an installer before it starts anything (see Main). Returns
    // the exit code this launch ends with, or null to carry on launching from here. Only a real
    // build: a folder without the manifest does none of it.
    //
    // #3286: KOSMOS INSTALLS ITSELF, LIKE WINDOWS SOFTWARE DOES, AND ASKS NOTHING. Josh on a clean
    // laptop: a question about moving out of Downloads is not what installing software looks like.
    // The per-user programs folder (%LOCALAPPDATA%\Programs\Kosmos, MoveTarget) is where Chrome, VS Code
    // and Slack put a per-user install, and it needs no administrator. So:
    //   - a copy running from a folder that gets cleaned up (Downloads, the Desktop, OneDrive, a
    //     temporary or zip-extract folder), with no Kosmos installed, installs itself there
    //     (InstallFromTemporaryPlace) and starts the installed copy;
    //   - a NEWER copy, from anywhere, with Kosmos installed, updates the installed copy through the
    //     in-app updater's own swap (UpdateInstalledCopy) and starts it, so there is only ever one;
    //   - the same build or an older one hands off to the installed copy (CompareWithInstalledCopy);
    //   - the installed copy itself does what it always did;
    //   - a copy somebody put somewhere deliberate (not a cleaned-up place), with nothing installed, runs
    //     where it is, as before.
    // When the install or the update cannot happen, a plain note says why and Kosmos runs from here.
    // Every launch of whichever copy runs then points the Start menu entry and the Settings > Apps entry
    // at it (RefreshWindowsRegistration), as before.
    internal static int? RunInstallerDuties(string here, string node, int port)
    {
        if (!IsKosmosBuild(here)) return null;
        // #3286 review, finding 2: ONE install or update at a time. A double-click while "Installing" or
        // "Updating" is up used to race the first: two moves into one folder (rmdir ENOTEMPTY), or "an update
        // is starting now", then a fall back to Downloads, and whichever wrote the engine pointer last won.
        // So every launch of a real build takes this lock for its installer duties, and a second launch
        // WAITS for the first rather than racing it. It then decides afresh, and normally hands off to the
        // copy the first one just installed, whose one window comes forward. Waiting, not exiting, is also
        // what the installed copy needs: the first launch starts it a moment before it lets go.
        using (Mutex installing = new Mutex(false, installLockName))
        {
            bool held = false;
            try
            {
                try { held = installing.WaitOne(InstallLockWaitMs); }
                catch (AbandonedMutexException) { held = true; /* a launch that ended mid-install: ours now */ }
                // A lock held for longer than any install or update takes: carry on as before this lock
                // existed, rather than leaving the person with nothing.
                return RunInstallerDutiesUnderLock(here, node, port);
            }
            finally { if (held) { try { installing.ReleaseMutex(); } catch { /* already let go */ } } }
        }
    }

    // Per signed-in session (Local\), so another person on this PC installs their own Kosmos unhindered.
    // Not const only so the probe a test compiles beside this file can use its own.
    internal static string installLockName = "Local\\Kosmos.InstallOrUpdate";
    // Beyond the updater's own ten-minute wait for a swap (CLI_WAIT_MS), plus the copy.
    const int InstallLockWaitMs = 15 * 60 * 1000;

    static int? RunInstallerDutiesUnderLock(string here, string node, int port)
    {
        PlaceOutcome installed = CompareWithInstalledCopy(here, node);
        if (installed == PlaceOutcome.StartedInstalledCopy) return 0;
        if (installed == PlaceOutcome.InstalledCopyWouldNotStart) return 1;
        if (installed == PlaceOutcome.NewerThanInstalledCopy)
        {
            PlaceOutcome updated = UpdateInstalledCopy(here, node, port);
            if (updated == PlaceOutcome.StartedInstalledCopy) return 0;
            if (updated == PlaceOutcome.InstalledCopyWouldNotStart) return 1;
        }
        else if (InstallFromTemporaryPlace(here, node, port) == PlaceOutcome.StartedInstalledCopy)
        {
            return 0;
        }
        refreshWindowsRegistration(here);
        return null;
    }

    // #3286: a newer Kosmos (a newer zip the person extracted and ran) updates the installed copy instead
    // of becoming a second install. The updater does it exactly as it installs a download
    // (engine/win32update.js --apply --from): the newer build is staged beside the installed one, the
    // board is stopped, the installed build is kept as .kosmos-update\previous-<version>, the new one is
    // swapped in, the board is started and must answer as the new build, and anything that goes wrong
    // puts the old build back. It runs with THIS copy's node and engine, the newer ones; the swap itself
    // is done by the installed copy's own helper, as every in-app update is.
    // When the updater refuses (the installed Kosmos is not the one Kosmos starts from, its board is not
    // running from its logon task, an update is already under way), the move installs over the installed
    // copy if it is idle (below); failing that, a note says so and this newer copy runs from here, which is
    // what happened before #3286.
    internal static PlaceOutcome UpdateInstalledCopy(string here, string node, int port)
    {
        string target = MoveTarget();
        string full = FullPathOrNull(here) ?? here;
        if (target == null) return PlaceOutcome.NewerThanInstalledCopy;
        string problem = null;
        string[] report = null;
        showWorkingWhile(UpdatingMessage, () =>
        {
            report = runEngineHelper(node, here, UpdateHelperScript,
                "--apply --root " + QuoteArgument(target) + " --from " + QuoteArgument(full) + " --port " + port + " --wait", NoHelperTimeout, out problem);
        });
        string outcome = report != null && report.Length > 0 ? report[0] : null;
        if (outcome != null && outcome.StartsWith("UPDATED ", StringComparison.Ordinal))
        {
            string startProblem = startLauncher(Path.Combine(target, "Kosmos.exe"), target);
            if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
            tellPerson("Kosmos is updated in " + target + ", but it would not start from there (" + startProblem + "). Double-click Kosmos.exe in that folder.", true);
            return PlaceOutcome.InstalledCopyWouldNotStart;
        }
        string because = outcome != null && outcome.StartsWith("REFUSED ", StringComparison.Ordinal)
            ? outcome.Substring("REFUSED ".Length)
            : "the update did not say what happened" + (problem != null ? " (" + problem + ")" : "");

        // The updater swaps only the copy Kosmos starts from. When the installed copy is NOT that copy (the
        // engine pointer names a download that ran before), it is an idle older leftover, and waiting for the
        // updater would leave this person running from Downloads for good. So the move installs over it
        // (--replace-older), keeping it whole as .kosmos-update\previous-<version> where the updater keeps the
        // build an update replaced, and ends a board serving from here first, as the first install does. The
        // move refuses on its own when the installed copy is the one Kosmos starts from, so this never
        // replaces a running install behind the updater's back.
        // 🔑 NEVER A LOOP: when both refuse, this copy runs from here, which is what happened before #3286 and
        // is stable (the installed copy hands off only to a NEWER pointed copy, and this is it). Running here
        // points Kosmos at this copy, so the next launch of this download finds the installed copy idle and
        // replaces it.
        string replaceProblem = null;
        string[] replaced = null;
        showWorkingWhile(InstallingMessage, () =>
        {
            replaced = runEngineHelper(node, here, RelocateHelperScript,
                "--move --from " + QuoteArgument(full) + " --to " + QuoteArgument(target) + " --port " + port + " --end-board --replace-older", NoHelperTimeout, out replaceProblem);
        });
        string replacedOutcome = replaced != null && replaced.Length > 0 ? replaced[0] : null;
        // #3286 review, finding 2: SAME is success too. An update that DID swap the new build in, but whose
        // report came back REFUSED (the ten-minute wait ran out, or the status record lagged), meets this
        // build already installed, and the move answers SAME. Reading that as a failure would have run this
        // copy from Downloads and pointed Kosmos back there, undoing the update.
        if (replacedOutcome != null && (replacedOutcome.StartsWith("MOVED ", StringComparison.Ordinal) || replacedOutcome.StartsWith("SAME ", StringComparison.Ordinal)))
        {
            string startProblem = startLauncher(Path.Combine(target, "Kosmos.exe"), target);
            if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
            // Finding 1: the move may have ENDED the board (--end-board) and pointed Kosmos at the installed
            // copy. Exiting here would leave no board until the next sign-in, so this copy carries on as the
            // first install does when the installed copy will not start: it starts the board from here, which
            // points Kosmos back at this folder until the installed copy can start.
            tellPerson("Kosmos is updated in " + target + ", but it would not start from there (" + startProblem + "). This copy runs Kosmos from here for now, and tries again the next time you open it.", true);
            return PlaceOutcome.NewerThanInstalledCopy;
        }
        if (replacedOutcome != null && replacedOutcome.StartsWith(UnanchoredTag, StringComparison.Ordinal)) because = replacedOutcome.Substring(UnanchoredTag.Length);
        // The compare says NEWER for a same-version rebuild too (another commit, no order), and neither the
        // updater nor the move takes one (never a downgrade). Calling that copy "newer" would be untrue.
        string mineVersion = ManifestVersionOf(full);
        if (mineVersion != null && mineVersion == ManifestVersionOf(target))
        {
            tellPerson(SameVersionNote(mineVersion, target), false);
            return PlaceOutcome.NewerThanInstalledCopy;
        }
        tellPerson("This Kosmos is newer than the one installed in " + target + ", but it could not update it (" + because + "). This newer Kosmos runs from here for now, and tries again the next time you open it.", false);
        return PlaceOutcome.NewerThanInstalledCopy;
    }

    internal enum PlaceOutcome { NoInstalledCopy, NotATemporaryPlace, StartedInstalledCopy, InstalledCopyWouldNotStart, NewerThanInstalledCopy, StaysHere }

    // Round 1 finding 4, round 2 finding 4. From ANY folder outside the per-user one (MoveTarget), not
    // only a temporary place. Only a copy carrying this launcher (launcher 3.0) or later asks at all: a
    // copy from an older published zip (launcher 2.0) has no such check and still takes the pointer
    // when it is started.
    // When that folder holds a Kosmos.exe, engine/win32relocate.js compare decides which copy runs,
    // from its one build verdict (the verdict relocate reads too):
    //   HANDOFF (the same build, an installed build that is newer, or anything unreadable) -> start
    //   the installed Kosmos and end here. This copy re-points nothing: no shortcut, no Apps entry, no
    //   engine pointer. A stale copy is exactly what re-pointed everything.
    //   NEWER (this copy is newer, or the same version rebuilt from another commit) -> #3286: update the
    //   installed copy from this one (UpdateInstalledCopy, engine/win32apply.js's swap), so there is one install.
    //   NONE (no complete Kosmos there), or a compare that could not run -> carry on as before.
    internal static PlaceOutcome CompareWithInstalledCopy(string here, string node)
    {
        string target = MoveTarget();
        string full = FullPathOrNull(here) ?? here;
        if (target == null) return PlaceOutcome.NoInstalledCopy;
        // This copy IS the per-user install (or inside it): checked before the overlap below, which the
        // same folder also matches.
        if (IsSameOrInside(full, target)) return CompareWithPointedCopy(full, node);
        if (IsSameOrInside(target, full)) return PlaceOutcome.NoInstalledCopy;
        // The launcher is the only file this cheap look needs; the engine decides the rest.
        if (!File.Exists(Path.Combine(target, "Kosmos.exe"))) return PlaceOutcome.NoInstalledCopy;
        string compareProblem;
        string[] compared = runEngineHelper(node, here, RelocateHelperScript,
            "--compare --from " + QuoteArgument(full) + " --to " + QuoteArgument(target), compareTimeoutMs, out compareProblem);
        string verdict = compared != null && compared.Length > 0 ? compared[0] : null;
        if (verdict != null && verdict.StartsWith("NEWER ", StringComparison.Ordinal)) return PlaceOutcome.NewerThanInstalledCopy;
        if (verdict != null && verdict.StartsWith("HANDOFF ", StringComparison.Ordinal))
        {
            string startProblem = startLauncher(Path.Combine(target, "Kosmos.exe"), target);
            if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
            tellPerson("Kosmos is installed in " + target + ", but it would not start from there (" + startProblem + "). Double-click Kosmos.exe in that folder.", true);
            return PlaceOutcome.InstalledCopyWouldNotStart;
        }
        return PlaceOutcome.NoInstalledCopy;
    }

    // Round 3, finding 6: this copy IS the per-user install. Starting it must never move the engine
    // pointer back to an older build (Josh: never downgrade), so engine/win32relocate.js
    // compareWithPointer compares it with the copy the pointer names, with the same build verdict:
    //   HANDOFF (that copy is complete and newer, or the same version from another commit) -> start it
    //   and re-point nothing;
    //   anything else (no pointer, the pointer names this copy, that copy is missing, incomplete,
    //   unreadable or not newer, or the compare did not answer in time) -> run here and re-point, as
    //   before. It never hands off to itself or to a copy that is not there.
    internal static PlaceOutcome CompareWithPointedCopy(string full, string node)
    {
        string compareProblem;
        string[] compared = runEngineHelper(node, full, RelocateHelperScript,
            "--compare --from " + QuoteArgument(full) + " --pointer", compareTimeoutMs, out compareProblem);
        string verdict = compared != null && compared.Length > 0 ? compared[0] : null;
        if (verdict == null || !verdict.StartsWith("HANDOFF ", StringComparison.Ordinal)) return PlaceOutcome.NoInstalledCopy;
        string pointed = FullPathOrNull(verdict.Substring("HANDOFF ".Length).Trim());
        if (pointed == null || IsSameOrInside(pointed, full) || IsSameOrInside(full, pointed)) return PlaceOutcome.NoInstalledCopy;
        if (!File.Exists(Path.Combine(pointed, "Kosmos.exe"))) return PlaceOutcome.NoInstalledCopy;
        string startProblem = startLauncher(Path.Combine(pointed, "Kosmos.exe"), pointed);
        if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
        tellPerson("Kosmos is newer in " + pointed + ", but it would not start from there (" + startProblem + "). Double-click Kosmos.exe in that folder.", true);
        return PlaceOutcome.InstalledCopyWouldNotStart;
    }

    // #3286 (was W-06's move question): a copy running from a folder that gets
    // cleaned up, with no Kosmos installed, installs itself into the per-user programs folder without
    // asking, then starts the installed copy, which opens the board.
    // The copying is engine/win32relocate.js's move, unchanged in what it copies and refuses (only the
    // build's own entries; never over a different or incomplete Kosmos; staged beside the target and
    // renamed into place; the pointer anchored to the new folder). --end-board is new: a board serving
    // from THIS folder (anyone who ran Kosmos from Downloads before this build) is ended first, when its
    // logon task started it, so it can come back from the new folder instead of blocking the install
    // forever. The folder installed from is left exactly as it was: agents running now keep reading from
    // it until they restart, and nothing is ever deleted.
    // A refusal is a plain note, never a question, and Kosmos runs from here; it tries again next time.
    internal static PlaceOutcome InstallFromTemporaryPlace(string here, string node, int port)
    {
        string place = TemporaryPlaceOf(here);
        if (place == null) return PlaceOutcome.NotATemporaryPlace;
        string target = MoveTarget();
        string full = FullPathOrNull(here) ?? here;
        if (target == null || IsSameOrInside(full, target) || IsSameOrInside(target, full)) return PlaceOutcome.NotATemporaryPlace;

        string problem = null;
        string[] report = null;
        showWorkingWhile(InstallingMessage, () =>
        {
            report = runEngineHelper(node, here, RelocateHelperScript,
                "--move --from " + QuoteArgument(full) + " --to " + QuoteArgument(target) + " --port " + port + " --end-board", NoHelperTimeout, out problem);
        });
        string outcome = report != null && report.Length > 0 ? report[0] : null;
        if (outcome != null && (outcome.StartsWith("MOVED ", StringComparison.Ordinal) || outcome.StartsWith("SAME ", StringComparison.Ordinal)))
        {
            string startProblem = startLauncher(Path.Combine(target, "Kosmos.exe"), target);
            if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
            tellPerson("Kosmos is installed in " + target + " now, but it would not start from there (" + startProblem + "). " + KeepsWorkingHere, true);
            return PlaceOutcome.StaysHere;
        }
        // Finding 5: a copy that could not be set to start from its new home (the engine pointer was not
        // written) is not installed: Kosmos would go on starting from here at every sign-in. So it is the
        // plain note and a run from here, and the next launch tries again (it then finds the copy in place
        // and only sets the pointer).
        string because = outcome != null && outcome.StartsWith("REFUSED ", StringComparison.Ordinal)
            ? outcome.Substring("REFUSED ".Length)
            : outcome != null && outcome.StartsWith(UnanchoredTag, StringComparison.Ordinal)
                ? outcome.Substring(UnanchoredTag.Length)
                : "The copy did not say what happened" + (problem != null ? " (" + problem + ")" : "") + ".";
        tellPerson(CouldNotInstallNote(place, target, because), false);
        return PlaceOutcome.StaysHere;
    }
    // ---- the board's own window (#1118) ---------------------------------------
    //
    // A double-click used to open the board in the default browser, as a tab beside the person's
    // other tabs. The Mac app is a window of its own hosting the system web view
    // (native-app/main.swift, a WKWebView); this is the same thing on Windows, hosting the system's
    // Microsoft Edge WebView2 Runtime. The board is the same local web page either way.
    //
    // 🔑 HOW IT REACHES WEBVIEW2, AND WHY THIS WAY. Through WebView2's own COM interfaces, declared at
    // the bottom of this file in the order Microsoft's header (WebView2.h, in the
    // Microsoft.Web.WebView2 NuGet package) gives them. The alternative, Microsoft's managed wrapper
    // DLLs, would need compile-time references: the build flags that verify-launcher.ps1, the README
    // and tools.win-launcher-native.test.js pin would change, and every probe a test compiles beside
    // this file would need the DLLs too. Declared here, the source still builds with nothing but the
    // in-box compiler. What remains is Microsoft's small native loader, WebView2Loader.dll, which the
    // build ships in runtime\ (a folder the updater and the move already carry whole), and which
    // finds the WebView2 Runtime installed on this PC. The Runtime itself is never shipped: it is part
    // of Windows 11 and kept up to date by Windows.
    // ⚠️ The weak spot of declaring them by hand: a slot out of order is not a compile error, it is a
    // call into the wrong method. Only the interfaces and slots used here are declared, each list is
    // written out to the last slot used, and the order was checked against WebView2.h 1.0.4191.47.
    //
    // 🛑 THE WINDOW IS ITS OWN PROCESS (`Kosmos.exe --window`), started by the launch in Main. The
    // launcher goes on to start the board and exits once it has handed off, exactly as before;
    // closing the window ends only the window. The board and the agents run under their own
    // scheduled tasks and never notice, as on the Mac, where closing the window only hides it.
    //
    // SIGNING IN is open-board.js's job (#2007), as it is for the browser: it waits for the board,
    // mints a single-use boot nonce with the board token and names the address to open. With
    // --print-url it hands that address to this process over a private pipe instead of to a
    // browser, so neither the token nor the nonce reaches a command line or a console. The board
    // answers the nonce with a session cookie, which the window's own web profile keeps
    // (%LOCALAPPDATA%\Kosmos\WebView2), so a reload stays signed in until the board restarts (#6358).
    //
    // WHEN THIS PC CANNOT HOST THE WINDOW (no WebView2 Runtime, a missing loader, or the Runtime
    // refusing to start), it falls back to what a double-click did before: the opener opens the
    // board in the default browser, and a box says why.

    const string WindowFlag = "--window";

    // open-board.js's word for "tell me the address, open nothing" (tools/kosmos-open-board.js).
    const string PrintUrlFlag = "--print-url";

    // Where the build puts Microsoft's loader (tools/build-kosmos-windows.sh). Loaded by full path,
    // never searched for, so no other copy on the PATH can stand in for it.
    const string WebView2LoaderRelativePath = "runtime\\WebView2Loader.dll";

    // How long the window waits for the board before it opens the plain address. A first run
    // installs and hands off before the board listens, which #2983 measured at up to ~72 s; the
    // browser opener's own 20 s default was set for an already-installed board. The window shows
    // "Starting Kosmos" meanwhile, so waiting longer costs a person nothing.
    const int BoardWindowWaitMs = 120000;

    const string NoWindowMessage =
        "Kosmos opened in your web browser this time, because this PC can't show Kosmos in its own window. It needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and is a free download from Microsoft for Windows 10 (search for \"WebView2 Runtime\"). Your agents are running either way.";

    // Anything else that kept the window from opening: a partly extracted folder, or a Runtime that
    // is installed but would not start. The reason follows it.
    const string WindowWouldNotOpenMessage =
        "Kosmos opened in your web browser this time, because its own window would not open. Your agents are running either way.";

    const string WindowStoppedMessage =
        "Kosmos's window stopped working, so it has closed. Your agents are still running. Double-click Kosmos.exe, or choose Kosmos in the Start menu, to open it again.";

    internal const string StartingPage =
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Kosmos</title><style>"
        + "html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;"
        + "font:15px 'Segoe UI',sans-serif;color:#555;background:#fafafa}"
        + "@media (prefers-color-scheme:dark){body{color:#bbb;background:#1e1e1e}}"
        + "</style></head><body>Starting Kosmos...</body></html>";

    // One window per board, so the names carry the port: a second double-click brings this
    // window forward instead of opening another, and a test using another port never reaches it.
    static string BoardWindowName(int port) { return "Kosmos.BoardWindow." + port; }

    // How the launcher starts the window: this same exe, in its own folder, with the environment
    // it was given (so BoardPort() answers the same there).
    static ProcessStartInfo BoardWindowStartInfo(string here)
    {
        ProcessStartInfo w = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, WindowFlag);
        w.UseShellExecute = false;
        w.WorkingDirectory = here;
        return w;
    }

    // The #2007 opener, with the arguments Kosmos.cmd gave it. printUrlOnly asks it for the
    // address instead of a browser; the address then comes back on its standard output, which
    // only this process reads.
    static ProcessStartInfo OpenerStartInfo(string here, string node, string opener, string app, int port, bool printUrlOnly)
    {
        ProcessStartInfo o = new ProcessStartInfo(node,
            "\"" + opener + "\" --port " + port + " --app \"" + app + "\""
            + (printUrlOnly ? " " + PrintUrlFlag + " --timeout-ms " + BoardWindowWaitMs : ""));
        o.UseShellExecute = false;
        o.CreateNoWindow = true;
        o.WorkingDirectory = here;
        if (printUrlOnly)
        {
            o.RedirectStandardOutput = true;
            o.StandardOutputEncoding = Encoding.UTF8;
        }
        return o;
    }

    // Kosmos.exe --window. Returns when the window closes.
    static int RunBoardWindow(string here, string node, string opener, string app, int port)
    {
        // 🛑 WHAT HAPPENS AFTER THE WINDOW, HAPPENS AFTER THE LOCK (review of #3285). A box shown
        // while the single-instance lock is held leaves a person with no window: a double-click
        // before they press OK finds the lock taken, asks a window that is already gone to come
        // forward, and exits. So the window's run decides what to say, lets go of the lock, and only
        // then says it or opens the browser.
        string fallbackProblem = null;
        bool noRuntime = false;
        bool stoppedWorking = false;
        string relaunch = null;
        bool firstWindow;
        using (Mutex onlyWindow = new Mutex(true, "Local\\" + BoardWindowName(port), out firstWindow))
        {
            if (!firstWindow)
            {
                // Like the Mac app's single-instance guard (#2124): the window already open comes
                // forward, signs in again (BoardWindowForm.SignInAgain), and this copy goes. This
                // process was started by a double-click, so it may hand the foreground on.
                try { AllowSetForegroundWindow(ASFW_ANY); } catch { /* it then flashes in the taskbar instead */ }
                PostMessage(HWND_BROADCAST, RegisterWindowMessage(BoardWindowName(port) + ".Show"), IntPtr.Zero, IntPtr.Zero);
                return 0;
            }
            try
            {
                IntPtr loader = LoadWebView2Loader(Path.Combine(here, WebView2LoaderRelativePath), out fallbackProblem, out noRuntime);
                if (loader != IntPtr.Zero)
                {
                    BoardWindowForm form = ShowBoardWindow(here, node, opener, app, port, loader);
                    fallbackProblem = form.RuntimeProblem;
                    stoppedWorking = form.StoppedWorking;
                    relaunch = form.RelaunchAfterClose;
                }
            }
            finally { onlyWindow.ReleaseMutex(); }
        }

        if (fallbackProblem != null) return OpenInBrowserInstead(here, node, opener, app, port, fallbackProblem, noRuntime);
        if (stoppedWorking) ShowMessageBox(WindowStoppedMessage, true);
        // #4382: the window closed to open the Kosmos.exe an update (or a rollback) on this connect computer just
        // put in the Kosmos folder; this process runs the copy that was moved aside. After the lock, so the new
        // window can take it. Kosmos.exe reads the mode itself, so a connect computer starts no board here.
        if (relaunch != null)
        {
            string relaunchProblem = StartLauncherAt(Path.Combine(here, "Kosmos.exe"), here);
            if (relaunchProblem != null) ShowMessageBox(RelaunchFailedMessage(here, relaunchProblem, relaunch == "rollback"), true);
        }
        return 0;
    }

    // The window itself, from its first address to its close.
    static BoardWindowForm ShowBoardWindow(string here, string node, string opener, string app, int port, IntPtr loader)
    {
        try { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
        catch { try { SetProcessDPIAware(); } catch { /* blurry is better than nothing */ } }
        System.Windows.Forms.Application.EnableVisualStyles();
        // Every address the window loads comes from the same --print-url answer: the first one, and
        // a fresh one each time Kosmos.exe is opened again (SignInAgain).
        // #4381: the window reads this computer's mode itself, once, before anything loads; with the
        // release switch off it is always Run.
        ComputerMode mode = LaunchComputerMode();
        BoardWindowForm form = new BoardWindowForm(port, loader, WebView2UserDataFolder(),
            () => ResolveBoardAddress(here, node, opener, app, port), mode, here);
        // The handle first: a board that is already up answers in a moment, and BeginInvoke on a
        // form with no handle yet throws, which would drop the address on the floor.
        IntPtr formExists = form.Handle;
        // A connect computer asks open-board.js nothing: it waits for a board that is never started.
        if (mode != ComputerMode.Connect) form.ResolveBoardAddressInBackground();
        System.Windows.Forms.Application.Run(form);
        return form;
    }

    // The address to open, from open-board.js --print-url: the board's own address, with a boot
    // nonce on an enforcing board. Anything else it prints, or a failure to run it, is the plain
    // address, which is what the browser path falls back to as well.
    // #1765: except when the opener refused (it exits OpenerRefusedExit and names no address: on an enforcing
    // board, nothing showed it is this account's board), or named no address in any other way while a board token
    // is on disk. Then NotConfirmed, and the window loads nothing: its own web profile holds the board's sign-in
    // cookie, which goes to whatever answers at 127.0.0.1.
    internal static string ResolveBoardAddress(string here, string node, string opener, string app, int port)
    {
        string plain = "http://127.0.0.1:" + port;
        try
        {
            using (Process p = Process.Start(OpenerStartInfo(here, node, opener, app, port, true)))
            {
                string said = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                string named = AddressNamed(said, port);
                if (named != null) return named;
                if (p.ExitCode == OpenerRefusedExit) return NotConfirmed;
            }
        }
        catch { /* the plain address, below, or NotConfirmed */ }
        // #1765: no address named, however the opener ended. On an enforcing board (its token on disk) nothing has
        // shown it is this account's board, so the window loads nothing rather than the plain address.
        return TaskbarBadge.BoardTokenOnDisk() ? NotConfirmed : plain;
    }

    // #1765: open-board.js's exit code when it refused to open anything (tools/kosmos-open-board.js sets
    // process.exitCode = OPENER_REFUSED_EXIT on those paths only; a code node itself never uses, so a crash is not
    // read as a refusal), and the answer that stands for it here.
    internal const int OpenerRefusedExit = 10;
    // How long the browser fallback waits for the opener: its default 20 s board wait, its 7.5 s check and its 15 s
    // mint (tools/kosmos-open-board.js), and some room.
    const int OpenerBrowserWaitCapMs = 60000;
    internal const string NotConfirmed = "";

    // The board's own address (plain, or with a path such as ?boot=) on a line of what the opener printed, or null.
    internal static string AddressNamed(string said, int port)
    {
        string plain = "http://127.0.0.1:" + port;
        foreach (string line in (said ?? "").Split('\n'))
        {
            string candidate = line.Trim();
            if (candidate == plain || candidate.StartsWith(plain + "/", StringComparison.Ordinal)) return candidate;
        }
        return null;
    }

    // #6882: one sentence for every way the window ends up here: the opener found nothing that proved it is this
    // account's board, it proved but the sign-in could not be made (#6464), board.token is there but cannot be read
    // (#6464), or the window checked again before reusing its sign-in and the check failed (CheckBoardBeforeReuse).
    // "Could not confirm it was reaching" read as only the first of those; "could not sign you in" is true of all.
    // #6985: these three say "open Kosmos from the Start menu", as the zip's READ ME does since #6984, and never
    // "Kosmos.exe", which after the install reads as the extracted folder, which the READ ME never sends them back to once Kosmos is in the Start menu. Start menu
    // alone, with no "Kosmos.exe" fallback: only the window and its browser fallback show them, and only Main starts
    // the window (BoardWindowStartInfo), after a real build's installer duties (IsKosmosBuild) have pointed the Start
    // menu shortcut at the copy that runs (RefreshWindowsRegistration), so the shortcut is there whenever one of these
    // is on screen. A folder that is not a real build writes no shortcut, but no person runs one.
    internal const string NotConfirmedPage =
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Kosmos</title><style>"
        + "html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;text-align:center;"
        + "font:15px 'Segoe UI',sans-serif;color:#555;background:#fafafa;padding:0 2em}"
        + "@media (prefers-color-scheme:dark){body{color:#bbb;background:#1e1e1e}}"
        + "</style></head><body>Kosmos could not sign you in to your own Kosmos, so this window is not showing it.<br>"
        + "If Kosmos is starting or restarting, open Kosmos from the Start menu again in a minute.</body></html>";

    const string BrowserUnknownMessage =
        "Kosmos took too long to confirm it was reaching your own Kosmos. If no Kosmos page opened in your browser, open Kosmos from the Start menu again in a minute.";

    // #6882: the browser fallback's twin of NotConfirmedPage, for the same three opener outcomes.
    const string BrowserNotConfirmedMessage =
        "Kosmos could not sign you in to your own Kosmos, so it did not open your browser. If Kosmos is starting or restarting, open Kosmos from the Start menu again in a minute.";


    // ---- #6882: the window proves the board again before it reuses its sign-in ----------------------------
    //
    // The window's web profile keeps the board's sign-in cookie, scoped to 127.0.0.1 and NOT to the port, so every
    // later request to the board's address carries it to whatever answers there then. The opener proves the board
    // once, when the window first resolves the address (#1765). These say whether the window may go on using that
    // sign-in at each later point, from a fresh check (CheckBoardBeforeReuse) made right before it:
    //   - a navigation the window starts itself (a crashed page's reload, F5 and the other reload keys, the retry of a
    //     board load that failed): MayNavigateSignedIn on a full check BEFORE it starts (CheckNavigationAgain); a
    //     sign-in load is proved by the opener just before it;
    //   - any navigation to the board (those, the page's own reload, a link, Back and Forward): NavigationDecision on
    //     a quick check in OnNavigationStarting, then MayNavigateSignedIn on a full check when the quick one could not
    //     tell. WebView2 has already sent the request by then (measured), so this decides what is SHOWN, not what is
    //     sent (see OnNavigationStarting);
    //   - "open Kosmos from the Start menu again", or the page's own sign-in, when the opener names no signed-in address, which
    //     leaves the open page talking to whatever answers: MayKeepPageOpen;
    //   - the page's own polling, which the window cannot stop per request: WatchShowsNotConfirmed, on the badge's
    //     10 s timer. Not before each request, after: the most a squatter gets is a few ticks of polls (the session
    //     cookie in them is already dead: a board restart ends every session, #6449, and a squatter can only take
    //     the port once the board has let go of it).
    // Whenever the answer is no, the window shows NotConfirmedPage and loads nothing more until Kosmos is opened
    // again (from the Start menu), or, after a check of its own, until RecoverBoard signs it back in once the board proves again.
    internal enum ReuseCheck { Proved, NotEnforcing, NoListener, NoAnswer, NotProven, TokenUnreadable }

    // The quick check, on the window's own thread (OnNavigationStarting has no deferral, so the navigation waits on
    // it): a board on loopback answers in milliseconds, so this only bounds how long a stalled listener can freeze
    // the window. Whatever it cannot settle goes to the full check, off that thread. That includes nothing listening:
    // .NET on Windows takes about 2 s to report a refused loopback connection (measured, ConnectFailure after
    // 2026-2037 ms), so here it reads as no answer, and the full check, with time to see the refusal, decides it.
    internal const int ReuseQuickCheckMs = 1500;
    // The full check, off the window's thread: the opener's own budget for its proof (tools/kosmos-open-board.js
    // PROOF_TIMEOUT_MS), so a board busy enough to pass the opener's check is never refused by this one.
    internal const int ReuseProofTimeoutMs = 7500;
    // The watch's patience with a listener that takes the check and never answers: about 30 s of the badge timer.
    // A board that busy for that long serves the page nothing either; a squatter that stalls only the check, to
    // look busy, is caught after it.
    internal const int WatchNoAnswersLimit = 3;
    // How many times in a row the window signs itself back in after a check of its own failed (RecoverBoard), until a
    // board read works (the page's badge post): a board that proves to the window but not to the opener never loops.
    internal const int AutoRecoveriesLimit = 3;

    // A fresh read of board.token and a fresh proof, every time. Never throws.
    internal static ReuseCheck CheckBoardBeforeReuse(int port, int timeoutMs)
    {
        try
        {
            string token;
            TaskbarBadge.TokenOnDisk onDisk = TaskbarBadge.ReadBoardTokenState(out token);
            if (onDisk == TaskbarBadge.TokenOnDisk.None) return ReuseCheck.NotEnforcing;
            if (onDisk != TaskbarBadge.TokenOnDisk.Read) return ReuseCheck.TokenUnreadable;
            switch (BoardProof.Check(port, token, timeoutMs))
            {
                case BoardProof.Answer.Proves: return ReuseCheck.Proved;
                case BoardProof.Answer.NoListener: return ReuseCheck.NoListener;
                case BoardProof.Answer.NotProven: return ReuseCheck.NotProven;
                default: return ReuseCheck.NoAnswer;
            }
        }
        catch { return ReuseCheck.NoAnswer; }
    }

    // How long the full check waits for a board that is not there yet: the opener's own wait for the board
    // (tools/kosmos-open-board.js --timeout-ms default), so a board restarting under a reload is waited for as long
    // as a double-click would wait for it. And how long between looks while it waits.
    internal const int ReuseWaitForBoardMs = 20000;
    const int ReuseLookAgainMs = 500;

    // #6882: the full check. Nothing listening, or a board.token that cannot be read right now (antivirus holding it
    // for a moment), is looked at again until `waitMs` has passed, since waiting sends nothing anywhere; any other
    // answer is final at once. Returns the last answer. Off the window's thread only: it can take `waitMs` and more.
    internal static ReuseCheck CheckBoardPatiently(int port, int timeoutMs, int waitMs)
    {
        Stopwatch waited = Stopwatch.StartNew();
        while (true)
        {
            ReuseCheck check = CheckBoardBeforeReuse(port, timeoutMs);
            if (check != ReuseCheck.NoListener && check != ReuseCheck.TokenUnreadable) return check;
            if (waited.ElapsedMilliseconds + ReuseLookAgainMs >= waitMs) return check;
            Thread.Sleep(ReuseLookAgainMs);
        }
    }

    // #6882: the keys that reload the page in WebView2: F5 and Ctrl+F5, Ctrl+R and Ctrl+Shift+R, and a keyboard's own
    // Refresh key. The window takes these itself (OnAcceleratorKeyPressed) and reloads only after the board proves.
    internal const uint VirtualKeyF5 = 0x74;
    internal const uint VirtualKeyR = 0x52;
    internal const uint VirtualKeyBrowserRefresh = 0xA8;

    // Ctrl+R only with Alt up: AltGr reaches Windows as Ctrl+Alt, and AltGr+R types a character on some layouts.
    internal static bool IsReloadKey(uint virtualKey, bool control, bool alt)
    {
        return virtualKey == VirtualKeyF5 || virtualKey == VirtualKeyBrowserRefresh || (control && !alt && virtualKey == VirtualKeyR);
    }

    // #6882: a board load that failed because nothing answered it (WebView2.h COREWEBVIEW2_WEB_ERROR_STATUS values:
    // unreachable 6, timeout 7, connection reset 10, disconnected 11, cannot connect 12): what a board restarting
    // looks like, and so worth one more try once it proves. Not an aborted load (9, which is also how a navigation
    // that became a download ends), nor any other failure.
    internal static bool CouldNotReachBoard(int webErrorStatus)
    {
        return webErrorStatus == 6 || webErrorStatus == 7 || webErrorStatus == 10 || webErrorStatus == 11 || webErrorStatus == 12;
    }

    // #6882: two addresses of the same document: equal once their fragments are set aside.
    internal static bool SameDocument(string a, string b)
    {
        if (a == null || b == null) return false;
        int ha = a.IndexOf('#'), hb = b.IndexOf('#');
        return string.Equals(ha < 0 ? a : a.Substring(0, ha), hb < 0 ? b : b.Substring(0, hb), StringComparison.Ordinal);
    }

    // #6882: a sign-in load, carrying a single-use ?boot= code (only the window navigates to one; the page never does).
    internal static bool IsSignInLoad(string uri)
    {
        return uri != null && (uri.Contains("?boot=") || uri.Contains("&boot="));
    }

    // What a navigation to the board does after the quick check: go, be refused at once (a listener answered and
    // did not prove), or wait, cancelled, for the full check (nothing listening yet, no answer in time, or a
    // board.token that antivirus may be holding for a moment).
    internal enum NavigationStep { Go, Refuse, CheckAgain }

    internal static NavigationStep NavigationDecision(ReuseCheck quick)
    {
        if (MayNavigateSignedIn(quick)) return NavigationStep.Go;
        return quick == ReuseCheck.NotProven ? NavigationStep.Refuse : NavigationStep.CheckAgain;
    }

    // A navigation carries the cookie in its own request, so only a board that proved (or one that enforces nothing
    // and so issued no sign-in) may have it. After the full check (CheckBoardPatiently has already waited out a
    // board restarting), nothing listening is refused too: the window's own page says what to do.
    internal static bool MayNavigateSignedIn(ReuseCheck check)
    {
        return check == ReuseCheck.Proved || check == ReuseCheck.NotEnforcing;
    }

    // The opener named no signed-in address, so the page on screen stays only if this check allows it.
    //   - When the page itself asked for the sign-in (#6512, nobody at the keyboard asked for anything), only a
    //     listener that answered without proving ends it, as the watch: a board restarting or busy, or board.token
    //     held for a moment, must not throw a working window off its board, and the paced sign-in tries again.
    //   - When the person opened Kosmos again, it stays only for this account's board or for nothing listening
    //     (a board restarting has let go of the port); no answer in time, or a token that cannot be read, shows why,
    //     and opening Kosmos from the Start menu again in a minute starts over.
    internal static bool MayKeepPageOpen(ReuseCheck check, bool pageAsked)
    {
        if (pageAsked) return check != ReuseCheck.NotProven;
        return check == ReuseCheck.Proved || check == ReuseCheck.NotEnforcing || check == ReuseCheck.NoListener;
    }

    // The timer acts on a listener that ANSWERED and did not prove, at once, and on one that took the check and gave
    // no answer WatchNoAnswersLimit times in a row (`noAnswersBefore` is how many came just before this one). A single
    // slow answer is what a busy board looks like, and an unreadable token what antivirus holding the file for a
    // moment looks like; on a 10 s timer either would throw a working window off its board.
    internal static bool WatchShowsNotConfirmed(ReuseCheck check, int noAnswersBefore)
    {
        if (check == ReuseCheck.NotProven) return true;
        return check == ReuseCheck.NoAnswer && noAnswersBefore + 1 >= WatchNoAnswersLimit;
    }

    // What a double-click did before the window existed: the opener opens the board in the
    // default browser. Then the box that says why, because a browser tab where a window was
    // expected would otherwise look like a fault.
    static int OpenInBrowserInstead(string here, string node, string opener, string app, int port, string why, bool noRuntime)
    {
        string opened = null;
        bool refused = false;
        bool unknown = false;   // the opener ran past its cap: it may have opened the browser, or not
        // #1765: wait for the opener, so a refusal (nothing opened) is said as one, not as "opened in your browser".
        try
        {
            using (Process p = Process.Start(OpenerStartInfo(here, node, opener, app, port, false)))
            {
                // Bounded: past the opener's own worst case (its wait, check and mint), the outcome is told as unknown.
                if (!p.WaitForExit(OpenerBrowserWaitCapMs)) { try { p.Kill(); } catch { /* it ended meanwhile */ } unknown = true; }
                // As the window reads it (ResolveBoardAddress): the refusal code, or any failure while a token is on disk.
                else refused = p.ExitCode == OpenerRefusedExit || (p.ExitCode != 0 && TaskbarBadge.BoardTokenOnDisk());
            }
        }
        catch (Exception e) { opened = e.Message; }
        string detail = "\n\n(" + why + ")";
        if (opened != null)
        {
            ShowMessageBox("Kosmos could not open your browser (" + opened + ").\n\nOpen http://127.0.0.1:" + port + " in your browser yourself." + detail, true);
            return 1;
        }
        if (refused || unknown)
        {
            ShowMessageBox((unknown ? BrowserUnknownMessage : BrowserNotConfirmedMessage) + detail, true);
            return 1;
        }
        ShowMessageBox((noRuntime ? NoWindowMessage : WindowWouldNotOpenMessage) + detail, false);
        return 0;
    }

    // The loader, loaded by full path, and whether it finds a WebView2 Runtime on this PC. Zero
    // with `problem` saying why when this PC cannot host the window; noRuntime when the reason is
    // that the Runtime itself is not there, which is the one a person can fix by installing it.
    static IntPtr LoadWebView2Loader(string path, out string problem, out bool noRuntime)
    {
        problem = null;
        noRuntime = false;
        if (!File.Exists(path)) { problem = "a Kosmos file is missing: " + WebView2LoaderRelativePath; return IntPtr.Zero; }
        IntPtr module = LoadLibraryW(path);
        if (module == IntPtr.Zero) { problem = WebView2LoaderRelativePath + " would not load (error " + Marshal.GetLastWin32Error() + ")"; return IntPtr.Zero; }
        try
        {
            IntPtr at = GetProcAddress(module, "GetAvailableCoreWebView2BrowserVersionString");
            if (at == IntPtr.Zero) { problem = WebView2LoaderRelativePath + " is not the WebView2 loader"; return IntPtr.Zero; }
            GetAvailableBrowserVersion versionOf = (GetAvailableBrowserVersion)Marshal.GetDelegateForFunctionPointer(at, typeof(GetAvailableBrowserVersion));
            IntPtr version;
            int hr = versionOf(null, out version);
            string found = version == IntPtr.Zero ? null : Marshal.PtrToStringUni(version);
            if (version != IntPtr.Zero) Marshal.FreeCoTaskMem(version);
            if (hr != 0 || string.IsNullOrEmpty(found)) { noRuntime = true; problem = "the Microsoft Edge WebView2 Runtime is not installed (0x" + hr.ToString("X8") + ")"; return IntPtr.Zero; }
            return module;
        }
        catch (Exception e) { problem = "the WebView2 loader failed (" + e.Message + ")"; return IntPtr.Zero; }
    }

    // The window's own web profile, beside the launcher's other per-user state in
    // %LOCALAPPDATA%\Kosmos (keptPlacesFile), which the uninstall removes. Never the default: that
    // is a folder next to Kosmos.exe, inside the build, where the updater would swap it away.
    static string WebView2UserDataFolder()
    {
        return Path.Combine(LocalAppDataFolder(), "Kosmos\\WebView2");
    }

    // The uninstall's ask to an open window: close, and let go of the web profile it holds. Waits
    // a little for it, because the removal that follows deletes that profile.
    static void CloseBoardWindow(int port)
    {
        try
        {
            PostMessage(HWND_BROADCAST, RegisterWindowMessage(BoardWindowName(port) + ".Close"), IntPtr.Zero, IntPtr.Zero);
            using (Mutex onlyWindow = new Mutex(false, "Local\\" + BoardWindowName(port)))
            {
                bool gone;
                try { gone = onlyWindow.WaitOne(CloseWindowWaitMs); }
                catch (AbandonedMutexException) { gone = true; }
                if (gone) onlyWindow.ReleaseMutex();
            }
        }
        catch { /* nothing open, or it would not say: the removal names what it could not delete */ }
    }

    // The window closes in well under a second; this only bounds a window that is not answering.
    const int CloseWindowWaitMs = 10000;

    // Web links leave for the person's own browser, as they do from the Mac app (#1416). Only
    // http and https: a page asked for this, and ShellExecute would act on any scheme, file:
    // included.
    internal static bool IsWebAddress(string address)
    {
        Uri uri;
        return Uri.TryCreate(address, UriKind.Absolute, out uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    // The pages the window makes itself: the "Starting Kosmos" page (NavigateToString) and blank.
    // A box titled Kosmos, for the window (BoardWindowForm), which is another class.
    internal static void ShowWindowMessage(string text, bool isError)
    {
        ShowMessageBox(text, isError);
    }

    // ---- the words of the first-run choice (#4381), the Mac's (main.swift) where Windows has them too ----

    const string ConnectsElsewhereConsoleMessage =
        "This computer connects to Kosmos on another computer, so Kosmos does not start here. Open Kosmos from the Start menu to sign in to Kosmos Plus.";

    internal const string BoardStillRunningMessage =
        "Kosmos could not stop running in the background on this computer. You can connect to your other computer anyway. Kosmos tries again the next time it opens.";

    internal const string StillStoppingMessage = "Kosmos is still stopping the board on this computer. Try again in a moment.";

    internal const string KosmosPlusUnreachableMessage =
        "Kosmos could not reach Kosmos Plus (login.kosmosplus.com). Check this computer's internet connection, then press F5 to try again.";

    // The system menu's item (right-click the title bar, or Alt+Space), shown only on a connect computer.
    internal const string RunAgentsMenuText = "Run agents on this computer";

    // ---- #4382: a connect computer updates, and rolls back, with no board ----
    //
    // The board is what looks for updates, and a connect computer has stopped its board on purpose
    // (#4381). So its window asks app\engine\win32connectupdate.js, with this folder's node, at launch
    // (once its stop of the board is done), once a day while it is open, and when the person picks
    // Update or Roll back in the system menu. That file runs the board's own look, consent, updater and
    // rollback, and leaves the board stopped; this file only shows what it said and carries the choice.

    internal const string ConnectUpdateScript = "win32connectupdate.js";
    // A day between looks, and an hour after a look that could not reach the release host.
    internal const int UpdateLookEveryMs = 24 * 60 * 60 * 1000;
    internal const int UpdateLookRetryMs = 60 * 60 * 1000;
    // How long the window waits on its own look before it stops waiting (LookForUpdate; nothing is killed),
    // so an engine run that hangs cannot hold "Run agents" for good: above the engine's own limits for a look
    // that installs (a 15-minute download, then a 10-minute wait for the helper's outcome). A run the person
    // asked for (Update, Roll back) is waited for as long as it takes, as the move and the uninstall are.
    internal const int UpdateLookTimeoutMs = 40 * 60 * 1000;

    internal const string StillUpdatingMessage = "Kosmos is still updating on this computer. Try again in a moment.";

    internal enum ConnectUpdateKind { Unknown, Current, Newer, Updated, RolledBack, Failed, Board, Refused, Pending }

    internal sealed class ConnectUpdateAnswer
    {
        internal ConnectUpdateKind Kind;
        internal string Version;          // the version the answer is about (current, newer, updated, rolled back, failed), or null
        internal string Value;            // the reason, in the words the engine used (failed, refused, unknown), or null
        internal string RollbackVersion;  // the kept build a rollback restores, or null
    }

    // `expect`: for a rollback or an install the person picked, the version they agreed to (the engine does
    // not restore another kept build, and offers a newer release instead of installing it unseen). Only a
    // version of the board's shape is passed, so nothing else reaches the command line.
    internal static string ConnectUpdateArguments(string action, int port, string expect)
    {
        return "--" + action + " --port " + port + ((action == "rollback" || action == "install") && IsReleaseVersion(expect) ? " --expect " + expect : "");
    }

    // The board's own shape of a version, a.b.c with digits only. Anything else is not a version.
    internal static bool IsReleaseVersion(string v)
    {
        if (string.IsNullOrEmpty(v)) return false;
        string[] parts = v.Split('.');
        if (parts.Length != 3) return false;
        foreach (string p in parts)
        {
            if (p.Length == 0) return false;
            foreach (char ch in p) if (ch < '0' || ch > '9') return false;
        }
        return true;
    }

    // PURE: what the engine said, from the lines of its report (win32connectupdate.js reportLines). The
    // FIRST non-empty line is the answer; a version-bearing answer whose version is not of the board's
    // shape is Unknown, never Current, so a garbled answer can neither hide an update nor offer one. A
    // `failed` answer leads with the version it was for when it has one. A later `rollback <v>` line is
    // the rollback offer.
    internal static ConnectUpdateAnswer ReadConnectUpdateReport(string[] lines)
    {
        ConnectUpdateAnswer answer = new ConnectUpdateAnswer();
        answer.Kind = ConnectUpdateKind.Unknown;
        if (lines == null) return answer;
        bool first = true;
        foreach (string raw in lines)
        {
            string line = (raw ?? "").Trim();
            if (line.Length == 0) continue;
            int space = line.IndexOf(' ');
            string word = space < 0 ? line : line.Substring(0, space);
            string rest = space < 0 ? "" : line.Substring(space + 1).Trim();
            if (first)
            {
                first = false;
                // An if chain, not a switch: this compiler turns a switch on seven or more strings into a
                // class named by a fresh GUID each build, which verify-launcher.ps1 would then have to mask.
                ConnectUpdateKind versioned = word == "current" ? ConnectUpdateKind.Current
                    : word == "newer" ? ConnectUpdateKind.Newer
                    : word == "updated" ? ConnectUpdateKind.Updated
                    : word == "rolledback" ? ConnectUpdateKind.RolledBack
                    : ConnectUpdateKind.Unknown;
                if (versioned != ConnectUpdateKind.Unknown)
                {
                    if (IsReleaseVersion(rest)) { answer.Kind = versioned; answer.Version = rest; }
                }
                else if (word == "board") { if (rest.Length == 0) answer.Kind = ConnectUpdateKind.Board; }
                else if (word == "failed")
                {
                    answer.Kind = ConnectUpdateKind.Failed;
                    int gap = rest.IndexOf(' ');
                    string lead = gap < 0 ? rest : rest.Substring(0, gap);
                    if (IsReleaseVersion(lead)) { answer.Version = lead; answer.Value = gap < 0 ? "" : rest.Substring(gap + 1).Trim(); }
                    else answer.Value = rest;
                }
                else if (word == "refused") { answer.Kind = ConnectUpdateKind.Refused; answer.Value = rest; }
                else if (word == "pending") { answer.Kind = ConnectUpdateKind.Pending; answer.Value = rest; }
                else if (word == "unknown") { answer.Value = rest; }
                continue;
            }
            if (word == "rollback" && IsReleaseVersion(rest)) answer.RollbackVersion = rest;
        }
        return answer;
    }

    // What the connect window knows about updates, and what it should show. Main-thread only, in the window.
    internal sealed class ConnectUpdateState
    {
        internal string Offer;       // a newer version offered, not installed by itself (the engine's `newer`), or null
        internal string Installed;   // a version an unasked look installed, waiting for the person's Restart, or null
        internal string Rollback;    // the kept build a rollback restores, or null
        internal string Dismissed;   // the version whose bar the person put away with Not now
        // An update or rollback not seen to finish (the engine's `pending`): it may finish after all, and then
        // this window runs from the copy it moved aside, so nothing more is started until Kosmos opens again.
        internal bool Unsettled;
        internal string BarNote;     // what the bar says, or null for no bar
        internal string BarButton;   // "Update", "Restart" or null; Not now is always on a bar
        internal string Message;     // a box to show once, or null
        internal string Relaunch;    // "update" or "rollback": close and open the Kosmos.exe now in the folder; null: stay
        internal int NextLookMs = UpdateLookEveryMs;

        // The same knowledge, with the one-shot parts (a box, a relaunch) cleared.
        internal ConnectUpdateState Carried()
        {
            ConnectUpdateState s = new ConnectUpdateState();
            s.Offer = Offer; s.Installed = Installed; s.Rollback = Rollback; s.Dismissed = Dismissed; s.Unsettled = Unsettled;
            s.BarNote = BarNote; s.BarButton = BarButton; s.NextLookMs = NextLookMs;
            return s;
        }
    }

    // PURE: the bar for what is on offer: an installed update waiting for a restart, else a newer version,
    // else nothing. A version the person put away with Not now stays only in the menu.
    internal static void ShowOfferBar(ConnectUpdateState s)
    {
        s.BarNote = null;
        s.BarButton = null;
        if (s.Installed != null)
        {
            if (s.Dismissed != s.Installed) { s.BarNote = UpdateInstalledNote(s.Installed); s.BarButton = "Restart"; }
        }
        else if (s.Offer != null && s.Dismissed != s.Offer) { s.BarNote = UpdateOfferNote(s.Offer); s.BarButton = "Update"; }
    }

    // PURE: the window's state after one run of the engine. `action` is "look" (the window's own look),
    // "install" (the person picked Update) or "rollback" (the person picked Roll back and said yes).
    //   newer: offered; an installed update still waiting for its Restart is kept;
    //   updated: the person asked, so close and open the new Kosmos.exe; unasked, never a restart, only an offer;
    //   rolled back: close and open the Kosmos.exe now in the folder;
    //   failed: said, and the version it was for stays on offer, so Update can try again (an automatic
    //     install that failed never had an offer before this);
    //   could not look, or a board / a refusal: said only when the person asked; otherwise what was known stays.
    internal static ConnectUpdateState AfterConnectUpdate(ConnectUpdateState before, ConnectUpdateAnswer answer, string action)
    {
        ConnectUpdateState s = (before ?? new ConnectUpdateState()).Carried();
        bool asked = action != "look";
        // An answer that could not look keeps what was known; any other answer says what can be rolled back to now.
        if (answer.Kind != ConnectUpdateKind.Unknown || answer.RollbackVersion != null) s.Rollback = answer.RollbackVersion;
        // A look that could not look, or was refused (another update's lock, a resumer still running), is tried
        // again within the hour rather than tomorrow.
        s.NextLookMs = (answer.Kind == ConnectUpdateKind.Unknown || answer.Kind == ConnectUpdateKind.Refused) && !asked ? UpdateLookRetryMs : UpdateLookEveryMs;
        if (answer.Kind == ConnectUpdateKind.Newer)
        {
            s.Offer = answer.Version;
            ShowOfferBar(s);
        }
        else if (answer.Kind == ConnectUpdateKind.Updated)
        {
            s.Offer = null;
            if (asked) s.Relaunch = "update";
            else s.Installed = answer.Version;
            ShowOfferBar(s);
        }
        else if (answer.Kind == ConnectUpdateKind.RolledBack)
        {
            s.Offer = null;
            s.Installed = null;
            s.Relaunch = "rollback";
            ShowOfferBar(s);
        }
        else if (answer.Kind == ConnectUpdateKind.Failed)
        {
            if (action == "rollback")
            {
                s.Message = RollbackFailedMessage(answer.Value);
                ShowOfferBar(s);
            }
            else
            {
                // A failure that names its version can be tried again; one that does not (an update not seen
                // to finish, which may still finish) offers no retry.
                if (s.Installed == null && answer.Version != null) s.Offer = answer.Version;
                bool canRetry = answer.Version != null && s.Offer != null;
                s.BarNote = UpdateFailedNote(answer.Value, canRetry);
                s.BarButton = canRetry ? "Update" : null;
                // The window's own look failing again on a version the person put away stays in the menu only.
                if (!asked && s.Offer != null && s.Dismissed == s.Offer) { s.BarNote = null; s.BarButton = null; }
            }
        }
        else if (answer.Kind == ConnectUpdateKind.Pending)
        {
            // Said whoever started it, with no button: a second update's cleanup could delete the copy this
            // window may now run from, so the way on is to open Kosmos again.
            s.Unsettled = true;
            s.BarNote = UpdatePendingNote(answer.Value);
            s.BarButton = null;
        }
        else if (answer.Kind == ConnectUpdateKind.Unknown)
        {
            if (asked) { s.BarNote = UpdateUnreachableNote; s.BarButton = null; }
            else ShowOfferBar(s);
        }
        else if (answer.Kind == ConnectUpdateKind.Board || answer.Kind == ConnectUpdateKind.Refused)
        {
            if (asked) { s.BarNote = UpdateNotStartedNote(answer.Value); s.BarButton = null; }
            else ShowOfferBar(s);
        }
        else
        {
            // Current: nothing newer. An installed update still waits for its Restart. Asked, it is said.
            s.Offer = null;
            ShowOfferBar(s);
            if (asked && s.BarNote == null) s.BarNote = UpToDateNote;
        }
        return s;
    }

    // PURE: Not now on the bar. A bar that offers something (it has a button) puts that version away (the
    // menu keeps it); a note with no button only goes away, and the offer under it is not dismissed.
    internal static ConnectUpdateState AfterNotNow(ConnectUpdateState before)
    {
        ConnectUpdateState s = before.Carried();
        if (s.BarButton != null) s.Dismissed = s.Installed ?? s.Offer;
        s.BarNote = null;
        s.BarButton = null;
        return s;
    }

    // PURE: is the window's own look due? Not while an update it installed waits for the person's Restart,
    // nor after one not seen to finish (Unsettled): this window runs, or may run, from the copy that update
    // moved aside, and a second update's cleanup deletes the older kept builds, that copy among them.
    internal static bool UpdateLookIsDue(ConnectUpdateState s)
    {
        return s == null || (s.Installed == null && !s.Unsettled);
    }

    // PURE: what picking Update does: "busy" while a run is in flight, "restart" when an update waits for
    // its Restart, "install" when a newer version is on offer, null when there is nothing to do.
    internal static string UpdatePickedAction(ConnectUpdateState s, bool runInFlight)
    {
        if (runInFlight) return "busy";
        if (s != null && s.Unsettled) return null;
        if (s != null && s.Installed != null) return "restart";
        if (s != null && s.Offer != null) return "install";
        return null;
    }

    // An update or rollback on its way, read from what the updater leaves on disk: the prepare lock in the
    // Kosmos folder (the download), or an update journal not yet finished (the swap). Either counts only
    // while it is young, so one a crash left behind does not hold "Run agents" for good; the board's start
    // finishes or undoes such an update (the logon shim's recovery).
    // Longer than UpdateLookTimeoutMs: once the window gives up on a look that hangs, these files are all that
    // hold Run agents, so they must still count as fresh for as long as the engine run can still be going.
    internal const int UpdateOnDiskFreshMs = 45 * 60 * 1000;

    // PURE: the rule above, from what was read. Null times are files that are not there.
    internal static bool UpdateUnderWayOnDisk(DateTime? lockWrittenUtc, string journalText, DateTime? journalWrittenUtc, DateTime nowUtc)
    {
        TimeSpan fresh = TimeSpan.FromMilliseconds(UpdateOnDiskFreshMs);
        if (lockWrittenUtc.HasValue && nowUtc - lockWrittenUtc.Value < fresh) return true;
        if (journalText == null || !journalWrittenUtc.HasValue || nowUtc - journalWrittenUtc.Value >= fresh) return false;
        return !System.Text.RegularExpressions.Regex.IsMatch(journalText, "\"finished\"\\s*:\\s*true");
    }

    // The update journal's folder: the engine's anchor (engine/win32anchor.js anchorDir), the data folder's
    // Kosmos\runtime when AGENT_WORKFORCE_DATA is set, else %LOCALAPPDATA%\Kosmos\runtime. anchorDir's other
    // branch (AGENT_WORKFORCE_HOME, a developer's sandbox) is left out on purpose: no installed Kosmos.exe
    // runs with it, and missing it only means this guard looks in the wrong folder there. Nor is its world
    // marker read (worlds.preWorldEnv): a world's AGENT_WORKFORCE_DATA is set in a board's own process, not
    // in the environment a person's double-click gives Kosmos.exe. Either miss fails open, to the board's
    // start, whose logon shim finishes or undoes an unfinished update.
    internal static string UpdateJournalPath()
    {
        string data = Environment.GetEnvironmentVariable("AGENT_WORKFORCE_DATA");
        string anchor = !string.IsNullOrEmpty(data) ? Path.Combine(Path.Combine(data, "Kosmos"), "runtime") : Path.Combine(Path.Combine(LocalAppDataFolder(), "Kosmos"), "runtime");
        return Path.Combine(anchor, "update-journal.json");
    }

    // The rule above, on this computer's files.
    internal static bool UpdateUnderWayHere(string here)
    {
        try
        {
            string lockFile = Path.Combine(Path.Combine(here, ".kosmos-update"), "prepare.lock");
            DateTime? lockWritten = File.Exists(lockFile) ? (DateTime?)File.GetLastWriteTimeUtc(lockFile) : null;
            string journal = UpdateJournalPath();
            string text = null;
            DateTime? journalWritten = null;
            if (File.Exists(journal)) { journalWritten = File.GetLastWriteTimeUtc(journal); text = File.ReadAllText(journal); }
            return UpdateUnderWayOnDisk(lockWritten, text, journalWritten, DateTime.UtcNow);
        }
        catch { return false; }
    }

    // The system menu's items and the bar's words.
    internal static string UpdateMenuText(string version) { return "Update Kosmos to " + version; }
    internal static string RestartMenuText(string version) { return "Restart Kosmos to use " + version; }
    internal static string RollbackMenuText(string version) { return "Roll back Kosmos to " + version; }
    // Worded for every `newer` answer, not only "updates are off": the engine also offers rather than installs
    // a version held after a roll back, a newer release that appeared after the person picked Update, and
    // one whose automatic install could not be started (Update then says why).
    internal static string UpdateOfferNote(string version)
    {
        return "Kosmos " + version + " is ready. Press Update to install it.";
    }
    internal static string UpdateInstalledNote(string version)
    {
        return "Kosmos " + version + " is installed. Restart Kosmos to start using it.";
    }
    internal const string UpdatingNote = "Updating Kosmos. It opens again when the update is installed.";
    internal const string RollingBackNote = "Rolling Kosmos back. It opens again when that is done.";
    internal static string RollbackQuestion(string version)
    {
        return "Roll Kosmos on this computer back to " + version + "?\n\nThis puts back the version the last update replaced. Kosmos will then offer the newer version again rather than install it by itself. Your agents on the other computer are not affected.";
    }
    internal static string UpdateFailedNote(string why, bool canRetry)
    {
        return "Kosmos could not update" + (string.IsNullOrEmpty(why) ? "" : " (" + why + ")") + (canRetry ? ". Press Update to try again." : ".");
    }
    internal static string RollbackFailedMessage(string why)
    {
        return "The roll back did not finish" + (string.IsNullOrEmpty(why) ? "." : ": " + why + ".");
    }
    internal const string UpToDateNote = "Kosmos is up to date.";
    internal const string UpdateUnreachableNote = "Kosmos could not check for updates. Check this computer's internet connection, then try again.";
    // The engine's reason says what to do when it has one (pick Roll back again, download a version), so the
    // generic "try again" is only added when there is none.
    internal static string UpdateNotStartedNote(string why)
    {
        return "Kosmos could not start that right now" + (string.IsNullOrEmpty(why) ? ". Try again in a few minutes." : " (" + why + ").");
    }
    internal static string UpdatePendingNote(string why)
    {
        return "Kosmos has not finished" + (string.IsNullOrEmpty(why) ? "" : " (" + why + ")") + ". Close Kosmos and open it again in a few minutes to see which version it is on.";
    }
    internal static string RelaunchFailedMessage(string folder, string problem, bool rolledBack)
    {
        return "Kosmos is " + (rolledBack ? "rolled back" : "updated") + ", but it would not open again (" + problem + "). Double-click Kosmos.exe in " + folder + ".";
    }

    internal static string ChoiceNotSavedMessage(string folder)
    {
        return "Kosmos could not save your choice on this computer, so it may ask you again, or carry on as if this computer runs agents. Check that you can make changes in " + folder + ".";
    }

    internal static string ConnectNotSavedMessage(string folder)
    {
        return "Kosmos could not save your choice on this computer, so it will ask again. Check that you can make changes in " + folder + ".";
    }

    internal static string RunAgentsNotSavedMessage(string folder)
    {
        return "Kosmos could not save that change on this computer, so it still connects to agents on another computer. Check that you can make changes in " + folder + ", then try again.";
    }

    internal static bool IsWindowOwnPage(string address)
    {
        return address != null && (address.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || address.StartsWith("data:", StringComparison.OrdinalIgnoreCase));
    }

    // The board's own pages: this port on loopback. Everything else is somebody else's site.
    internal static bool IsBoardAddress(string address, int port)
    {
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || uri.Scheme != Uri.UriSchemeHttp || uri.Port != port) return false;
        string host = uri.Host.ToLowerInvariant();
        return host == "127.0.0.1" || host == "localhost" || host == "[::1]";
    }

    internal static void OpenInPersonsBrowser(string address)
    {
        OpenInPersonsBrowser(address, false);
    }

    // #4381: `decidedByConnectRules` is a connect computer's window handing over a link its rules already
    // sent to the browser (ConnectLinkDecision): a clicked mail, phone or text link then opens in the
    // person's own app for it, as on the Mac. Every other caller is held to web links.
    internal static void OpenInPersonsBrowser(string address, bool decidedByConnectRules)
    {
        if (decidedByConnectRules && ConnectLinkDecision(address, true) != ConnectLink.Browser) return;
        if (!decidedByConnectRules && !IsWebAddress(address))
        {
            string scheme;
            Uri uri;
            scheme = Uri.TryCreate(address ?? "", UriKind.Absolute, out uri) ? uri.Scheme : null;
            // The refusal speaks (#1416, Baron's review): a click that silently does nothing is the
            // very bug the link handling exists to fix.
            ShowMessageBox(string.IsNullOrEmpty(address)
                ? "A link on this page had no address behind it, so there was nothing to open."
                : "Kosmos only opens web links, and this one is " + (scheme == null ? "not a web address" : "a " + scheme + " link") + ", so it was not opened.\n\n" + address, false);
            return;
        }
        try
        {
            ProcessStartInfo open = new ProcessStartInfo(address);
            open.UseShellExecute = true;
            using (Process.Start(open)) { }
        }
        catch (Exception e)
        {
            ShowMessageBox("Kosmos could not open your browser (" + e.Message + ").\n\n" + address, true);
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int GetAvailableBrowserVersion([MarshalAs(UnmanagedType.LPWStr)] string browserExecutableFolder, out IntPtr version);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    internal delegate int CreateEnvironment(
        [MarshalAs(UnmanagedType.LPWStr)] string browserExecutableFolder,
        [MarshalAs(UnmanagedType.LPWStr)] string userDataFolder,
        IntPtr environmentOptions,
        ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler handler);

    static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
    const int ASFW_ANY = -1;
    static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern uint RegisterWindowMessage(string name);

    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);

    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr window);

    // #6882: whether Ctrl is down with a key the window hears (OnAcceleratorKeyPressed).
    [DllImport("user32.dll")]
    internal static extern short GetKeyState(int virtualKey);
    internal const int VirtualKeyControl = 0x11;
    internal const int VirtualKeyAlt = 0x12;

    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryW(string path);

    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    internal static extern IntPtr GetProcAddress(IntPtr module, string name);

    // ---- the console, for --console and non-interactive runs -----------------

    // A GUI-subsystem exe starts with no console. For --console it takes the one
    // it was started from (cmd, PowerShell) or, from a double-click or a
    // shortcut, a window of its own -- which is what the console launcher always
    // had. The server started later shares it, as before.
    // ⚠️ Standard handles a caller redirected (a script capturing the output) are
    // put back after attaching, so the output still goes where the caller asked.
    static void ConnectToAConsole()
    {
        IntPtr stdout = GetStdHandle(STD_OUTPUT_HANDLE);
        IntPtr stderr = GetStdHandle(STD_ERROR_HANDLE);
        IntPtr stdin = GetStdHandle(STD_INPUT_HANDLE);
        bool outRedirected = IsRedirected(stdout), errRedirected = IsRedirected(stderr), inRedirected = IsRedirected(stdin);

        if (!AttachConsole(ATTACH_PARENT_PROCESS))
        {
            // Never give a non-interactive run a console of its own: nobody can
            // see it, and Hold() would wait on it for a key nobody can press.
            if (!Environment.UserInteractive) return;
            // Nor a caller that captured both outputs: every line goes to them,
            // so a new window would stay empty and Hold() would wait on it.
            if (outRedirected && errRedirected) return;
            AllocConsole();
        }
        if (outRedirected) SetStdHandle(STD_OUTPUT_HANDLE, stdout);
        if (errRedirected) SetStdHandle(STD_ERROR_HANDLE, stderr);
        if (inRedirected) SetStdHandle(STD_INPUT_HANDLE, stdin);
    }

    // Redirected means a real handle that is not a console: a file, a pipe, or
    // the NUL device (which a type check would call a character device and miss).
    static bool IsRedirected(IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE) return false;
        uint mode;
        return !GetConsoleMode(handle, out mode);
    }

    // ⚠️ ONLY when a console would vanish and take the message with it. A user
    // who opened --console from a shortcut got their own window, so an unheld
    // failure prints into a window that closes instantly -- which is how a real
    // error becomes "it just didn't do anything". A user who ran it from an
    // existing shell keeps their scrollback, so holding there is a nuisance
    // instead of a rescue.
    static void Hold()
    {
        if (!Environment.UserInteractive || !ConsoleWasOurs()) return;
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

    const int STD_INPUT_HANDLE = -10;
    const int STD_OUTPUT_HANDLE = -11;
    const int STD_ERROR_HANDLE = -12;
    const uint ATTACH_PARENT_PROCESS = 0xFFFFFFFF;
    static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int GetConsoleProcessList(uint[] processList, int processCount);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AllocConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetStdHandle(int which, IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetConsoleMode(IntPtr handle, out uint mode);
}

// ---- the board's own window (#1118): the form ---------------------------------
//
// A plain Windows Forms window with WebView2 filling it. Every WebView2 callback arrives on this
// window's thread (WebView2 requires an STA thread pumping messages, which Application.Run is), and
// every one is wrapped so that a fault in it cannot take the window down with a crash dialog.
class BoardWindowForm : System.Windows.Forms.Form
{
    readonly int port;
    readonly IntPtr loader;
    readonly string userDataFolder;
    readonly uint showMessage;
    readonly uint closeMessage;
    ICoreWebView2Controller controller;
    ICoreWebView2 webView;
    string boardAddress;
    bool navigatedToBoard;
    // The --print-url answer, asked again each time Kosmos.exe is opened while this window is up.
    readonly Func<string> resolveBoardAddress;
    bool signingInAgain;
    // #6512: the page's "signed out" (PageSaysSignedOut): when the window last signed itself in again, on this
    // window's own clock; whether it gave up; and how many of its sign-ins in a row brought no board read.
    readonly Stopwatch windowClock = Stopwatch.StartNew();
    long? lastSignInAgainAt;
    bool signInAgainGaveUp;
    int signInsWithoutRead;
    // #1765: the opener refused to name an address (KosmosLauncher.NotConfirmed), so the window shows why and loads nothing.
    // #6882: also set when a check before reusing the sign-in failed (ShowNotConfirmed).
    bool boardNotConfirmed;
    // #6882: the board navigations OnNavigationStarting let through, until each completes, so a failed one is known
    // as the board's (OnNavigationCompleted), and a redirect within one that was checked is not checked again.
    readonly Dictionary<ulong, string> boardNavs = new Dictionary<ulong, string>();
    // #7403: the guard over "Kosmos did not save that file" and "Kosmos did not open that link" (TellRefusal), and the
    // main-frame commits it counts pages by (OnContentLoading), as the Mac's pageCommits.
    readonly KosmosLauncher.RefusalGate refusals = new KosmosLauncher.RefusalGate();
    int pageCommits;
    // #7403: when (windowClock) each recent download started, any address, so a board download navigation that became
    // a download is not said as a refusal (SayUnlessADownloadStarted). Pruned as each one is added.
    readonly List<long> downloadStarts = new List<long>();
    // #6882: which visit to the board this is. Moved on whenever the window starts or stops showing a board
    // (NavigateToBoard, ShowNotConfirmed, RunAgentsHere, SwitchToConnect), so a check that answers after the window
    // moved on is dropped rather than acted on against the next visit.
    int boardVisit;
    // #6882: the timer's check (WatchBoard) is out, and how many in a row before it got no answer.
    bool watchInFlight;
    int watchNoAnswers;
    // #6882: a board navigation the quick check could not settle waits here, cancelled, for the full check
    // (CheckNavigationAgain); a newer board navigation that goes replaces it.
    string navigationWaiting;
    int navigationWaitingVisit;
    bool navigationCheckInFlight;
    string navigationApproved;
    // #6882: the window is about to load a sign-in address the opener proved and minted a moment ago (NavigateToBoard,
    // SignInAgain). WebView2 has already sent a navigation's request when NavigationStarting is raised (measured),
    // and the board spends a ?boot= code on its first use, so a sign-in load held there for the full check and then
    // replayed would arrive with a spent code and land signed out. It goes, once.
    bool signInLoadApproved;
    // #6882: the visit on which a failed board load was last retried, so a load that keeps failing is retried once
    // (until a board load works again).
    int failedLoadRetriedVisit = -1;
    // #6882: Kosmos.exe was opened again while a sign-in was under way and the window was showing why it is not
    // showing the board: that sign-in, when it ends, starts over instead (SignInAgain).
    bool startOverWanted;
    // #6882: the window is showing why because a check it made itself failed (ShowNotConfirmed), not because the
    // opener refused: it looks again on the badge timer and signs itself in again once the board proves
    // (RecoverBoard), at most AutoRecoveriesLimit times until a board read works.
    bool recheckRefused;
    bool recoveryInFlight;
    int autoRecoveries;

    // Set when this PC could not host the window after all: RunBoardWindow then opens the browser.
    internal string RuntimeProblem;
    // Set when WebView2's browser process ended under an open window: RunBoardWindow says so.
    internal bool StoppedWorking;

    // #3996: the waiting count on this window's taskbar button (TaskbarBadge, below).
    readonly uint taskbarButtonCreatedMessage;
    bool taskbarButtonReady;
    TaskbarBadge.ITaskbarList3 taskbar;
    System.Windows.Forms.Timer badgeTimer;
    // When the page last handed over its count; not running until it first does.
    readonly Stopwatch pageSaidWaiting = new Stopwatch();
    bool badgeReadInFlight;
    int badgeMisses;
    // Every answer, from the page or the board, is numbered when it is ASKED, and one asked earlier
    // never replaces one asked later (a slow board read that lands after a fresher page post).
    int badgeAsked;
    int badgeShownAsked;
    int? badgeWanted;
    int? badgeOnTaskbar;
    bool badgeEverApplied;

    // #4381: this computer's mode, read once at launch (KosmosLauncher.LaunchComputerMode) and changed
    // only by the first screen (PageChoseMode) or the system menu (RunAgentsHere). Main-thread only.
    KosmosLauncher.ComputerMode mode;
    // The Kosmos folder, for "Run agents on this computer", which opens Kosmos.exe from it again.
    readonly string here;
    // The logon task this port is served by, or null when this launch set PORT (BoardTaskForThisPort).
    readonly string boardTask;
    // How many connect stops of ours are running (the switch, and a connect launch's). "Run agents on
    // this computer" refuses until all of them finish, or its start would race a stop that could win.
    // A count, not a flag, as on the Mac: two stops can overlap.
    int stopsInFlight;
    // The navigation to Kosmos Plus sign-in this window started, until it completes: only its failure
    // is the "could not reach Kosmos Plus" box, never a page the person moved on to.
    bool connectLoadPending;
    // The last sign-in load failed: opening Kosmos again (SignInAgain) loads sign-in afresh.
    bool connectLoadFailed;
    // #5483: the connect rules REFUSED a navigation of that first load (an unclicked redirect off Kosmos
    // Plus, e.g. a captive portal). WebView2 reports it as a cancel, which is not a failure, so without this
    // the window would sit blank with no box and no way to retry.
    bool connectLoadRefused;
    // #5483: which navigation is that first load (WebView2 keeps one NavigationId across its redirects), so
    // a refusal or a completion of some OTHER navigation while it is pending is never taken for it.
    ulong connectLoadNavId;
    bool connectLoadNavKnown;
    // #5483: the page the window last COMMITTED in a connect window, as the Mac's committedPageURL: set when
    // a new document commits (ContentLoading, before its scripts run), to the address its in-window
    // navigation was allowed for; null before the first, on an error page, after a mode switch or a crashed
    // page. Only the Kosmos Plus SITE may send the window to another site by script (its checkout hand-off).
    string committedPage;
    readonly Dictionary<ulong, string> connectInWindow = new Dictionary<ulong, string>();
    // What the system menu shows now, as one string, so it is rebuilt only when that changes (null: nothing of ours).
    string systemMenuShown;
    // The system menu's ids. WM_SYSCOMMAND keeps its low four bits for Windows, so all of them end in 0.
    internal const int RunAgentsMenuId = 0x4380;
    const int RunAgentsSeparatorId = 0x4390;
    internal const int UpdateMenuId = 0x43A0;
    internal const int RollbackMenuId = 0x43B0;

    // #4382: the connect computer's update looks (KosmosLauncher.ConnectUpdateScript). Main-thread only.
    System.Windows.Forms.Timer updateTimer;
    bool updateLookInFlight;
    // An install a given-up look finished, or left unseen (pending), while another run was in flight: recorded
    // when that run is done, so no later look starts a second update under this window.
    KosmosLauncher.ConnectUpdateAnswer lateInstall;
    // What the window knows (the offer, an installed update waiting for Restart, the rollback) and shows;
    // every change goes through KosmosLauncher.AfterConnectUpdate / AfterNotNow, which are pure.
    KosmosLauncher.ConnectUpdateState updateState = new KosmosLauncher.ConnectUpdateState();
    // The slim bar over the page that says so (the Mac's update bar, Liu Kang's ruling on #4382: drawn by
    // the window, never put into the page, which on a connect computer is the other computer's).
    System.Windows.Forms.Panel updateBar;
    System.Windows.Forms.Label updateBarLabel;
    System.Windows.Forms.Button updateBarButton;
    System.Windows.Forms.Button updateBarNotNow;
    // Set when this window closes to open the updated (or rolled back) Kosmos.exe: RunBoardWindow starts
    // it. "update" or "rollback", null to stay closed.
    internal string RelaunchAfterClose;

    internal BoardWindowForm(int port, IntPtr loader, string userDataFolder, Func<string> resolveBoardAddress, KosmosLauncher.ComputerMode mode, string here)
    {
        this.mode = mode;
        this.here = here;
        boardTask = KosmosLauncher.BoardTaskForThisPort();
        this.port = port;
        this.resolveBoardAddress = resolveBoardAddress;
        this.loader = loader;
        this.userDataFolder = userDataFolder;
        string name = "Kosmos.BoardWindow." + port;
        showMessage = KosmosLauncher.RegisterWindowMessage(name + ".Show");
        closeMessage = KosmosLauncher.RegisterWindowMessage(name + ".Close");
        // Explorer's word that this window's taskbar button exists (again, after Explorer restarts):
        // an overlay set before it is lost, so the badge is (re)applied on it.
        taskbarButtonCreatedMessage = KosmosLauncher.RegisterWindowMessage("TaskbarButtonCreated");

        Text = "Kosmos";
        try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); }
        catch { /* the default window icon */ }
        BackColor = System.Drawing.Color.FromArgb(250, 250, 250);
        // Most of the screen, centred on the one the person is using, as the Mac window opens.
        System.Drawing.Rectangle area = System.Windows.Forms.Screen.FromPoint(System.Windows.Forms.Cursor.Position).WorkingArea;
        int width = Math.Max(Math.Min(area.Width, 800), area.Width * 4 / 5);
        int height = Math.Max(Math.Min(area.Height, 600), area.Height * 17 / 20);
        StartPosition = System.Windows.Forms.FormStartPosition.Manual;
        Bounds = new System.Drawing.Rectangle(area.Left + (area.Width - width) / 2, area.Top + (area.Height - height) / 2, width, height);
        MinimumSize = new System.Drawing.Size(Math.Min(area.Width, 640), Math.Min(area.Height, 480));
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        // #4381: a connect computer has no board here, so no badge; and every launch of one makes sure
        // the board is stopped (the Mac's stopBoardIfRunning), off this thread, while sign-in loads.
        if (mode != KosmosLauncher.ComputerMode.Connect) StartBadge();
        else StopBoardInBackground(false);
        UpdateRunAgentsItem();
        try
        {
            IntPtr at = KosmosLauncher.GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
            if (at == IntPtr.Zero) { CouldNotHost("the WebView2 loader has no CreateCoreWebView2EnvironmentWithOptions"); return; }
            KosmosLauncher.CreateEnvironment create = (KosmosLauncher.CreateEnvironment)Marshal.GetDelegateForFunctionPointer(at, typeof(KosmosLauncher.CreateEnvironment));
            try { Directory.CreateDirectory(userDataFolder); } catch { /* WebView2 then says why it cannot use it */ }
            int hr = create(null, userDataFolder, IntPtr.Zero, new EnvironmentCreated(this));
            if (hr != 0) CouldNotHost("WebView2 would not start (0x" + hr.ToString("X8") + ")");
        }
        catch (Exception x) { CouldNotHost("WebView2 would not start (" + x.Message + ")"); }
    }

    internal void EnvironmentReady(int hr, ICoreWebView2Environment environment)
    {
        if (hr != 0 || environment == null) { CouldNotHost("WebView2 would not start (0x" + hr.ToString("X8") + ")"); return; }
        environment.CreateCoreWebView2Controller(Handle, new ControllerCreated(this));
    }

    internal void ControllerReady(int hr, ICoreWebView2Controller created)
    {
        if (hr != 0 || created == null) { CouldNotHost("WebView2 would not open a view (0x" + hr.ToString("X8") + ")"); return; }
        if (IsDisposed) { created.Close(); return; }
        controller = created;
        controller.get_CoreWebView2(out webView);
        ICoreWebView2Settings settings;
        webView.get_Settings(out settings);
        // No link preview in the corner: this is an app window, not a browser.
        settings.put_IsStatusBarEnabled(0);
        long token;
        webView.add_NavigationStarting(new NavigationStarting(this), out token);
        webView.add_NewWindowRequested(new NewWindowRequested(this), out token);
        webView.add_ProcessFailed(new ProcessFailed(this), out token);
        webView.add_WebMessageReceived(new WebMessageReceived(this), out token);
        webView.add_NavigationCompleted(new NavigationCompleted(this), out token);
        webView.add_ContentLoading(new ContentLoading(this), out token);
        // #7403: a download that ends without saving says why. ICoreWebView2_4 is in every Runtime since 1.0.902; on an
        // older one the window works as before, without the sentence.
        // Never fatal: a failure here must not stop the board loading below.
        try
        {
            ICoreWebView2_4 webView4 = webView as ICoreWebView2_4;
            if (webView4 != null) webView4.add_DownloadStarting(new DownloadStarting(this), out token);
        }
        catch { /* downloads keep WebView2's defaults, unsaid */ }
        controller.add_AcceleratorKeyPressed(new AcceleratorKeyPressed(this), out token);   // #6882
        FitViewToWindow();
        controller.MoveFocus(0);
        if (mode == KosmosLauncher.ComputerMode.Connect) LoadConnect();
        else if (boardAddress != null) NavigateToBoard();
        else if (boardNotConfirmed) webView.NavigateToString(KosmosLauncher.NotConfirmedPage);
        else webView.NavigateToString(KosmosLauncher.StartingPage);
    }

    // open-board.js --print-url, off this thread; the answer comes back through BoardAddressResolved.
    internal void ResolveBoardAddressInBackground()
    {
        Thread resolve = new Thread(() =>
        {
            string resolved = null;
            try { resolved = resolveBoardAddress(); } catch { /* the plain address, below */ }
            if (resolved == null) resolved = TaskbarBadge.BoardTokenOnDisk() ? KosmosLauncher.NotConfirmed : "http://127.0.0.1:" + port;   // #1765, as ResolveBoardAddress
            try { BeginInvoke(new Action(() => BoardAddressResolved(resolved))); }
            catch { /* the window closed before the board answered */ }
        });
        resolve.IsBackground = true;
        resolve.Start();
    }

    // The address open-board.js named, once it has; whichever of it and the view is ready last navigates.
    // #4381: with what the page must know about this computer's choice (WithModeQuery). A connect
    // computer never loads its board, whatever arrives.
    internal void BoardAddressResolved(string address)
    {
        if (mode == KosmosLauncher.ComputerMode.Connect) return;
        if (address == KosmosLauncher.NotConfirmed)
        {
            boardNotConfirmed = true;
            if (webView != null) webView.NavigateToString(KosmosLauncher.NotConfirmedPage);
            return;
        }
        boardAddress = KosmosLauncher.WithModeQuery(address, mode);
        if (webView != null) NavigateToBoard();
    }

    // #4381: Kosmos Plus sign-in, the one page a connect computer opens by itself.
    void LoadConnect()
    {
        if (webView == null) return;
        connectLoadPending = true;
        connectLoadRefused = false;
        connectLoadNavKnown = false;
        committedPage = null;
        connectInWindow.Clear();
        webView.Navigate(KosmosLauncher.KosmosPlusSignIn);
    }

    // Opening Kosmos again (from the Start menu, as the zip's READ ME says) is how a person signs back in, so it has
    // to work on an open window too, as the Mac app's Reload does (loadBoard mints a fresh signed-in
    // address every time). A window that came up signed out -- the opener gave up on a slow first
    // run, the nonce could not be minted, or the cookie is for another Kosmos -- is otherwise stuck:
    // F5 reloads the same unsigned page. So the window asks open-board.js for a fresh address, off
    // this thread, and loads it. Only a signed-in (?boot=) answer is loaded: the plain address would
    // only throw away what the page shows and sign nobody in. The nonce travels as it did the first
    // time, over the private pipe, never a command line.
    // ⚠️ Accepted cost, for a double-click: the page reloads to the board's front page, so text typed and
    // not yet sent is lost. That is what the Mac's Reload does too, and the person asked for Kosmos again.
    // #6512: `keepPage`, for a sign-in the page asked for (PageSaysSignedOut), is the page to come back to
    // (KosmosLauncher.SignInAgainAddress); a double-click passes none and lands on the front page, as before. The
    // not-confirmed branch below starts over and keeps no page; a page-asked sign-in never reaches it, as that
    // window shows a NavigateToString page, which is not a board address and so is never heard.
    internal void SignInAgain(string keepPage = null)
    {
        // #4381: a connect computer has no board to sign in to; opening Kosmos again only brings this
        // window forward (and goes back to sign-in if its last load failed, as the Mac's Reload does).
        // Nothing here ever starts the board.
        if (mode == KosmosLauncher.ComputerMode.Connect) { if (connectLoadFailed) LoadConnect(); return; }
        // #6882: a window showing why it is not showing the board while a sign-in is still under way (the opener can
        // take 20 s): that sign-in starts over when it ends, rather than this double-click being dropped.
        if (boardNotConfirmed && signingInAgain) { startOverWanted = true; return; }
        // #1765: a window showing that the board could not be confirmed asks again, from the start.
        if (boardNotConfirmed && !signingInAgain && resolveBoardAddress != null)
        {
            boardNotConfirmed = false;
            startOverWanted = false;
            recheckRefused = false;
            if (webView != null) webView.NavigateToString(KosmosLauncher.StartingPage);
            ResolveBoardAddressInBackground();
            return;
        }
        if (!navigatedToBoard || signingInAgain || resolveBoardAddress == null) return;
        signingInAgain = true;
        int visit = boardVisit;
        Thread resolve = new Thread(() =>
        {
            string fresh = null;
            try { fresh = resolveBoardAddress(); } catch { /* nothing to load */ }
            // #6882: no signed-in address (the opener refused, or ended with none) navigates nothing, but the page
            // already open keeps talking to whatever answers on the port, with this window's sign-in. So the board is
            // checked here, off the window's thread, and the page stays only if MayKeepPageOpen says so (more
            // patiently when the page asked, keepPage, than for a double-click). A signed-in answer needs no check
            // here: its own navigation is checked (OnNavigationStarting).
            KosmosLauncher.ReuseCheck check = KosmosLauncher.ReuseCheck.Proved;
            if (fresh == null || !fresh.Contains("?boot=")) check = KosmosLauncher.CheckBoardBeforeReuse(port, KosmosLauncher.ReuseProofTimeoutMs);
            try
            {
                BeginInvoke(new Action(() =>
                {
                    signingInAgain = false;
                    if (mode == KosmosLauncher.ComputerMode.Connect) return;
                    // #6882: the window showed why it is not showing the board while this ran, or moved on to another
                    // visit. A sign-in that came back signed in is still wanted, the person's or the page's: it is
                    // loaded as a fresh visit, on the page it keeps, once the board proves again (CheckNavigationAgain).
                    // Otherwise a double-click that came meanwhile starts over now.
                    if (boardNotConfirmed || visit != boardVisit)
                    {
                        if (boardNotConfirmed && fresh != null && fresh.Contains("?boot=") && webView != null)
                        {
                            boardNotConfirmed = false;
                            startOverWanted = false;
                            recheckRefused = false;
                            navigatedToBoard = false;
                            boardAddress = KosmosLauncher.WithModeQuery(KosmosLauncher.SignInAgainAddress(fresh, keepPage, port), mode);
                            // The opener's proof may be older than the failed check: prove again, then load (its code
                            // is not spent yet, as nothing has loaded it).
                            navigatedToBoard = true;
                            boardVisit++;
                            watchNoAnswers = 0;
                            CheckNavigationAgain(boardAddress);
                        }
                        else if (startOverWanted && boardNotConfirmed) { startOverWanted = false; SignInAgain(); }
                        return;
                    }
                    // #6882: the opener proved the board for this sign-in a moment ago (signInLoadApproved).
                    if (fresh != null && fresh.Contains("?boot=")) signInLoadApproved = true;
                    if (fresh != null && fresh.Contains("?boot=") && webView != null) webView.Navigate(KosmosLauncher.WithModeQuery(KosmosLauncher.SignInAgainAddress(fresh, keepPage, port), mode));
                    else if (!KosmosLauncher.MayKeepPageOpen(check, keepPage != null)) ShowNotConfirmed();
                }));
            }
            catch { /* the window closed meanwhile */ }
        });
        resolve.IsBackground = true;
        resolve.Start();
    }

    // #6512: the page says the board no longer knows this window's session (a board restart ends every one), so
    // the window signs itself in again the way a second double-click of Kosmos.exe does (SignInAgain: a fresh
    // ?boot= address from open-board.js, which checks the board before it uses the token, #1765), as the Mac app
    // answers kosmosSignin, and back on `page`, the board page that said so (SignInAgainAddress). Paced and capped by
    // SignInAgainDecision, so a sign-in that does not take never reloads the window in a loop. The reload is the
    // double-click's accepted cost, here with nobody asking: text typed and not sent is lost, as on the Mac, and a
    // signed-out page could not have sent it anyway. Giving up changes
    // nothing on screen: the page's Windows signed-out panel already says to open Kosmos.exe again, which still signs
    // in (the launcher keeps no log to note it in). A connect computer has no board here to sign in to.
    void PageSaysSignedOut(string page)
    {
        if (mode == KosmosLauncher.ComputerMode.Connect || !navigatedToBoard || signingInAgain) return;
        long now = windowClock.ElapsedMilliseconds;
        switch (KosmosLauncher.SignInAgainDecision(now, lastSignInAgainAt, signInAgainGaveUp, signInsWithoutRead))
        {
            case KosmosLauncher.SignInAgainStep.SignIn:
                // Counted before SignInAgain runs, on purpose: a try that cannot navigate (no ?boot= address, no
                // opener) is a fruitless sign-in too, and the cap is what stops it being tried for ever.
                lastSignInAgainAt = now;
                signInsWithoutRead++;
                SignInAgain(page);
                return;
            case KosmosLauncher.SignInAgainStep.GiveUp:
                signInAgainGaveUp = true;
                return;
            default:
                return;
        }
    }

    void NavigateToBoard()
    {
        if (navigatedToBoard) return;
        navigatedToBoard = true;
        boardVisit++;   // #6882
        watchNoAnswers = 0;
        signInLoadApproved = true;   // #6882: the opener proved the board for this address a moment ago
        webView.Navigate(boardAddress);
    }

    // #6882: a check before reusing the sign-in failed. The window shows why (NotConfirmedPage, as when the opener
    // refuses) and forgets the board's address, so nothing reloads it; opening Kosmos again from the Start menu starts over from the
    // opener (SignInAgain's not-confirmed branch), which proves the board before it signs in.
    void ShowNotConfirmed()
    {
        if (mode == KosmosLauncher.ComputerMode.Connect || boardNotConfirmed || webView == null) return;
        boardNotConfirmed = true;
        navigatedToBoard = false;
        boardAddress = null;
        committedPage = null;
        navigationWaiting = null;
        navigationApproved = null;
        signInLoadApproved = false;
        recheckRefused = true;
        boardVisit++;
        webView.NavigateToString(KosmosLauncher.NotConfirmedPage);
    }

    // #6882: a window a check of its own took off its board (a board stalled past the watch's patience, or gone past
    // the full check's wait, or a squatter that has since left) comes back by itself once the board proves again, as
    // a double-click would bring it back: SignInAgain's start-over, where the opener proves the board before it signs
    // in. On the badge timer; capped, so a board that proves here but not to the opener never loops.
    void RecoverBoard()
    {
        if (mode == KosmosLauncher.ComputerMode.Connect || !boardNotConfirmed || !recheckRefused || recoveryInFlight || signingInAgain
            || autoRecoveries >= KosmosLauncher.AutoRecoveriesLimit) return;
        recoveryInFlight = true;
        int boardPort = port;
        int visit = boardVisit;
        ThreadPool.QueueUserWorkItem(unused =>
        {
            KosmosLauncher.ReuseCheck check = KosmosLauncher.CheckBoardBeforeReuse(boardPort, KosmosLauncher.ReuseProofTimeoutMs);
            try
            {
                BeginInvoke(new Action(() =>
                {
                    recoveryInFlight = false;
                    if (visit != boardVisit || !boardNotConfirmed || !recheckRefused || signingInAgain || !KosmosLauncher.MayNavigateSignedIn(check)) return;
                    autoRecoveries++;
                    SignInAgain();
                }));
            }
            catch { /* the window closed meanwhile */ }
        });
    }

    // #6882: the full check (CheckBoardPatiently: a board restarting is waited for), off this thread, then
    // ShowNotConfirmed unless `mayStay` allows what it found. Only on the visit it was asked for: an answer that lands
    // after the window moved on (it already shows why, it is starting over, or it signed in again) changes nothing.
    void CheckThenShowNotConfirmed(Func<KosmosLauncher.ReuseCheck, bool> mayStay)
    {
        int boardPort = port;
        int visit = boardVisit;
        ThreadPool.QueueUserWorkItem(unused =>
        {
            KosmosLauncher.ReuseCheck check = KosmosLauncher.CheckBoardPatiently(boardPort, KosmosLauncher.ReuseProofTimeoutMs, KosmosLauncher.ReuseWaitForBoardMs);
            try { BeginInvoke(new Action(() => { if (visit == boardVisit && navigatedToBoard && !mayStay(check)) ShowNotConfirmed(); })); }
            catch { /* the window closed meanwhile */ }
        });
    }

    // #6882: a board navigation the quick check could not settle (OnNavigationStarting cancelled it), or a reload the
    // window is about to start (OnProcessFailed, OnAcceleratorKeyPressed): the full check
    // (CheckBoardPatiently: a board restarting is waited for), off this thread, then the navigation goes after all
    // (marked approved, so it is not held a second time) or the window shows why. One full check at a time; a later
    // navigation that has to wait replaces the one waiting, and one that came on a later visit than the check out
    // now is checked again for itself when that check ends, never dropped.
    // ⚠️ Accepted cost: the navigation that goes is a plain Navigate to the same address, not what was cancelled. A
    // reload becomes a load of the same page (the same document, a history entry more), and Back or Forward to a board
    // page becomes a load of it. No board navigation carries a request body (the page's one form, its ask box,
    // cancels its own submit), so nothing is lost from one.
    void CheckNavigationAgain(string uri)
    {
        navigationWaiting = uri;
        navigationWaitingVisit = boardVisit;
        if (navigationCheckInFlight) return;
        navigationCheckInFlight = true;
        int boardPort = port;
        int visit = boardVisit;
        ThreadPool.QueueUserWorkItem(unused =>
        {
            KosmosLauncher.ReuseCheck check = KosmosLauncher.CheckBoardPatiently(boardPort, KosmosLauncher.ReuseProofTimeoutMs, KosmosLauncher.ReuseWaitForBoardMs);
            try
            {
                BeginInvoke(new Action(() =>
                {
                    navigationCheckInFlight = false;
                    string waiting = navigationWaiting;
                    if (waiting == null || navigationWaitingVisit != boardVisit || mode == KosmosLauncher.ComputerMode.Connect || webView == null) { navigationWaiting = null; return; }
                    // The navigation waiting now came on a later visit than this check was made for: check for it.
                    if (visit != boardVisit) { CheckNavigationAgain(waiting); return; }
                    navigationWaiting = null;
                    if (!KosmosLauncher.MayNavigateSignedIn(check)) { ShowNotConfirmed(); return; }
                    // The page on screen (a reload, whatever its fragment says now): Reload, since a Navigate to the
                    // document on screen is taken as a move within the page and loads nothing (the page's sign-out sets
                    // /#signed-out and reloads). What loads is the address on screen, so that is the approved one: its
                    // NavigationStarting names it, and nothing is left approved for a later navigation. A sign-in load
                    // is approved as one too (signInLoadApproved), whatever form WebView2 gives its address.
                    string onScreen = null;
                    try { webView.get_Source(out onScreen); } catch { /* not known: Navigate, below */ }
                    signInLoadApproved = KosmosLauncher.IsSignInLoad(waiting);
                    if (KosmosLauncher.SameDocument(onScreen, waiting)) { navigationApproved = onScreen; webView.Reload(); }
                    else { navigationApproved = waiting; webView.Navigate(waiting); }
                }));
            }
            catch { /* the window closed meanwhile */ }
        });
    }

    // #6882: the page polls the board itself, every 5 s, with this window's sign-in, and the window cannot stop those
    // requests one by one. So on the badge's timer the window checks the board is still the one that proved, and
    // stops showing it once a listener answers there without proving, or keeps taking the check without answering
    // (WatchShowsNotConfirmed). One check at a time, and only for the visit it was asked on.
    void WatchBoard()
    {
        if (mode == KosmosLauncher.ComputerMode.Connect || !navigatedToBoard || boardNotConfirmed || watchInFlight) return;
        watchInFlight = true;
        int boardPort = port;
        int visit = boardVisit;
        ThreadPool.QueueUserWorkItem(unused =>
        {
            KosmosLauncher.ReuseCheck check = KosmosLauncher.CheckBoardBeforeReuse(boardPort, KosmosLauncher.ReuseProofTimeoutMs);
            try
            {
                BeginInvoke(new Action(() =>
                {
                    watchInFlight = false;
                    if (visit != boardVisit) return;
                    bool show = KosmosLauncher.WatchShowsNotConfirmed(check, watchNoAnswers);
                    watchNoAnswers = check == KosmosLauncher.ReuseCheck.NoAnswer ? watchNoAnswers + 1 : 0;
                    // Only a board page polls the board: a Kosmos Plus page opened in this window (#5492) is left alone.
                    if (show && BoardPageOnScreen() != null) ShowNotConfirmed();
                }));
            }
            catch { /* the window closed meanwhile */ }
        });
    }

    // Before anything was shown, a failure means this PC cannot host the window: close, and
    // RunBoardWindow opens the browser instead.
    void CouldNotHost(string problem)
    {
        if (controller != null) return;
        RuntimeProblem = problem;
        BeginInvoke(new Action(Close));
    }

    // A computer that has chosen a mode decides every main-frame navigation by ConnectLinkDecision, as the
    // Mac does (#4381 for connect; #5492, the Mac's #5169, for run and both): this window has no address
    // bar and no Back button, so another site may never replace its page. A clicked link to another site
    // opens in the person's browser; an unclicked one (a redirect or a script) is refused. A run or both
    // computer's own board stays, and so does the about:/data: page NavigateToString shows while the board
    // starts. A computer that has not chosen (or whose choice cannot be read) keeps the older rule below:
    // its board and the window's own pages stay, anything else goes to the browser, and a scheme that is not
    // a web link is refused with the same box as a new-window link (review of #3285).
    internal void OnNavigationStarting(ICoreWebView2NavigationStartingEventArgs args)
    {
        string uri;
        args.get_Uri(out uri);
        // #6882: every board navigation is held here until a check says its page may be SHOWN (a link, the page's own
        // reload, Back and Forward, and the rest). Not checked again here: a sign-in load the opener has just proved
        // (signInLoadApproved), its redirect, and a navigation CheckNavigationAgain has just proved (navigationApproved).
        // Cancelled first, so a fault in what follows cannot let it go.
        // ⚠️ MEASURED (#6882 live rig, WebView2 Runtime on this box): WebView2 has already sent a navigation's request
        // when this event is raised: for a navigation the page starts (its own reload, a link), for a Reload, and for
        // this window's own Navigate alike (a squatter saw the request before this check reached it, or before it was
        // answered). Cancelling here stops the answer from being SHOWN in the window, never the request from leaving.
        // So a navigation the window starts itself is proved BEFORE it starts: a crashed page's reload and the reload
        // keys through CheckNavigationAgain, a sign-in load by the opener just before (signInLoadApproved). Those the
        // page or WebView2 starts (a link, the page's own reload, the right-click menu's Reload, Back and Forward) can
        // only be held here. What such a request carries is a board session, and a squatter can only take the port
        // once the board has stopped, which ends every session (#6449): the cookie it gets is already dead. The page
        // shown under the Kosmos title is what this guards.
        if (mode != KosmosLauncher.ComputerMode.Connect && KosmosLauncher.IsBoardAddress(uri, port))
        {
            ulong boardNav;
            args.get_NavigationId(out boardNav);
            int boardRedirect;
            args.get_IsRedirected(out boardRedirect);
            args.put_Cancel(1);
            // Only while the window is on a visit to its board (NavigateToBoard sets that before it navigates). Showing
            // why, or starting over, no board page loads by any other way: Back or Forward to one still in the history
            // would show a board that nothing then watches, outside every check below.
            if (boardNotConfirmed || !navigatedToBoard) return;
            // Not checked again: a redirect within a board navigation this let through a moment ago (a sign-in's ?boot=
            // load, answered by the board), and the navigation a full check just proved (CheckNavigationAgain).
            bool checkedAlready = (boardRedirect != 0 && boardNavs.ContainsKey(boardNav)) || (navigationApproved != null && navigationApproved == uri)
                || (signInLoadApproved && KosmosLauncher.IsSignInLoad(uri));
            navigationApproved = null;
            signInLoadApproved = false;
            KosmosLauncher.NavigationStep step = checkedAlready ? KosmosLauncher.NavigationStep.Go
                : KosmosLauncher.NavigationDecision(KosmosLauncher.CheckBoardBeforeReuse(port, KosmosLauncher.ReuseQuickCheckMs));
            if (step == KosmosLauncher.NavigationStep.Refuse) { BeginInvoke(new Action(ShowNotConfirmed)); return; }
            if (step == KosmosLauncher.NavigationStep.CheckAgain) { string waiting = uri; BeginInvoke(new Action(() => CheckNavigationAgain(waiting))); return; }
            args.put_Cancel(0);
            navigationWaiting = null;   // a newer board navigation went: the one waiting is replaced by it
            boardNavs[boardNav] = uri;
        }
        // #5492: the page NavigateToString shows while the board starts stays in the window (the Mac has no such page).
        bool runsBoard = mode == KosmosLauncher.ComputerMode.Run || mode == KosmosLauncher.ComputerMode.Both;
        if (runsBoard && KosmosLauncher.IsWindowOwnPage(uri)) return;
        if (mode == KosmosLauncher.ComputerMode.Connect || runsBoard)
        {
            int userInitiated;
            args.get_IsUserInitiated(out userInitiated);
            int redirected;
            args.get_IsRedirected(out redirected);
            ulong navId;
            args.get_NavigationId(out navId);
            // The first load is the navigation to the sign-in address itself (not a redirect), not merely the
            // first to start: a script on the page being left can start one a moment earlier.
            if (!runsBoard && connectLoadPending && !connectLoadNavKnown && redirected == 0 && string.Equals(uri.TrimEnd('/'), KosmosLauncher.KosmosPlusSignIn.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
            { connectLoadNavId = navId; connectLoadNavKnown = true; }
            // #5483, as the Mac: a redirect is never a click (WebKit calls it .other, however the navigation
            // began; WebView2 counts its own Navigate as user-initiated), and only a committed Kosmos Plus
            // SITE page may send the window to another site by script.
            KosmosLauncher.ConnectLink decided = KosmosLauncher.ConnectLinkDecision(uri, userInitiated != 0 && redirected == 0, KosmosLauncher.IsKosmosPlusSiteAddress(committedPage), runsBoard ? port : 0);
            if (decided == KosmosLauncher.ConnectLink.InApp) { connectInWindow[navId] = uri; if (!KosmosLauncher.IsBoardAddress(uri, port)) navigationWaiting = null; return; }   // #6882: a page the person moved on to replaces a board navigation waiting for its check
            if (decided == KosmosLauncher.ConnectLink.Block && connectLoadPending && connectLoadNavKnown && navId == connectLoadNavId) connectLoadRefused = true;
            bool refusedFirstLoad = connectLoadPending && connectLoadNavKnown && navId == connectLoadNavId;
            args.put_Cancel(1);
            if (decided == KosmosLauncher.ConnectLink.Browser) BeginInvoke(new Action(() => KosmosLauncher.OpenInPersonsBrowser(uri, true)));
            // #7403: a refused navigation says why (guarded: TellRefusal). Not a connect computer's refused first load:
            // that one already says Kosmos Plus could not be reached (OnNavigationCompleted), and two boxes for one load is one too many.
            else if (decided == KosmosLauncher.ConnectLink.Block && !refusedFirstLoad) TellRefusal(KosmosLauncher.LinkBlockedSays(uri));
            return;
        }
        if (KosmosLauncher.IsBoardAddress(uri, port) || KosmosLauncher.IsWindowOwnPage(uri)) return;
        args.put_Cancel(1);
        BeginInvoke(new Action(() => KosmosLauncher.OpenInPersonsBrowser(uri)));
    }

    // target="_blank" and window.open: never a second WebView2 window; the person's browser, as
    // the Mac app does (#1416). Every such link the board has today is another site. One of the
    // board's own pages stays in this window instead, because the browser is not signed in to the
    // board and would show the #2007 403.
    internal void OnNewWindowRequested(ICoreWebView2NewWindowRequestedEventArgs args)
    {
        string uri;
        args.get_Uri(out uri);
        args.put_Handled(1);
        // #4381: on a connect computer, Kosmos Plus and the person's computers open in this window, as
        // a same-window link would; anything else is decided as a click (the Mac does the same).
        if (mode == KosmosLauncher.ComputerMode.Connect)
        {
            KosmosLauncher.ConnectLink decided = KosmosLauncher.ConnectLinkDecision(uri, true);
            if (decided == KosmosLauncher.ConnectLink.InApp) BeginInvoke(new Action(() => webView.Navigate(uri)));
            else if (decided == KosmosLauncher.ConnectLink.Browser) BeginInvoke(new Action(() => KosmosLauncher.OpenInPersonsBrowser(uri, true)));
            else TellRefusal(KosmosLauncher.LinkBlockedSays(uri));   // #7403: a refused new-window link says why too
            return;
        }
        if (KosmosLauncher.IsBoardAddress(uri, port)) BeginInvoke(new Action(() => webView.Navigate(uri)));
        else BeginInvoke(new Action(() => KosmosLauncher.OpenInPersonsBrowser(uri)));
    }

    // #7403 (the Mac's tellDownloadFailed with refusal: true): a download or link the window did not act on is said in
    // one plain box, modal to this window, from the window's own thread on the next turn (the caller answers WebView2
    // first). Logged every time; shown only under the guard (RefusalGate): never over another of these boxes, not
    // within ten seconds of the last one's OK, and at most twice per sentence per page. So a page that repeats a
    // refusal cannot pile boxes up or keep one on screen.
    internal void TellRefusal(string sentence)
    {
        if (sentence == null) return;
        KosmosLauncher.NoteRefusal(sentence);
        if (IsDisposed || !refusals.Ask(sentence, windowClock.ElapsedMilliseconds, pageCommits)) return;
        try
        {
            BeginInvoke(new Action(() =>
            {
                try
                {
                    if (!IsDisposed)
                        System.Windows.Forms.MessageBox.Show(this, sentence, "Kosmos",
                            System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Warning);
                }
                catch { /* the note above still says it */ }
                finally { refusals.Answered(windowClock.ElapsedMilliseconds); }
            }));
        }
        catch { refusals.Answered(windowClock.ElapsedMilliseconds); }   // never left counted as up: that would silence every later one
    }

    // #7403: a download is starting. It goes exactly as before (WebView2's own Downloads panel, saved to Downloads):
    // nothing here cancels, redirects or handles it. Its end is watched, so one that stops for a reason the person
    // did not choose says why.
    internal void OnDownloadStarting(ICoreWebView2DownloadStartingEventArgs args)
    {
        ICoreWebView2DownloadOperation download;
        args.get_DownloadOperation(out download);
        if (download == null) return;
        long now = windowClock.ElapsedMilliseconds;
        KosmosLauncher.PruneDownloadStarts(downloadStarts, now);
        downloadStarts.Add(now);
        // WebView2 holds the handler (it AddRefs the COM wrapper) for as long as the download can still raise it.
        long token;
        download.add_StateChanged(new DownloadStateChanged(this), out token);
    }

    // A navigation to a board download route that failed the way a refusal does (NoContentNavigationSays) is said only
    // if no download started around it (a download the board did send aborts its navigation the same way, and its
    // DownloadStarting comes after: measured, 16 ms), and only once the board is known to have answered (review 1:
    // a board that died under the request is the not-confirmed check's business, not a sentence about the file).
    // `checkBoard` is false for a Kosmos Plus computer's board, which this computer's port says nothing about.
    internal void SayUnlessADownloadStarted(string address, string sentence, bool checkBoard)
    {
        long endedAt = windowClock.ElapsedMilliseconds;
        int visit = boardVisit;
        System.Windows.Forms.Timer settle = new System.Windows.Forms.Timer();
        settle.Interval = KosmosLauncher.DownloadSettleMs;
        settle.Tick += (s, e) =>
        {
            settle.Stop();
            settle.Dispose();
            if (IsDisposed) return;
            if (KosmosLauncher.AnyDownloadCameOfNavigation(downloadStarts, endedAt, KosmosLauncher.DownloadSettleMs))
            {
                KosmosLauncher.NoteRefusal("a board download navigation became a download: " + address);
                return;
            }
            if (!checkBoard) { TellRefusal(sentence); return; }
            int boardPort = port;
            ThreadPool.QueueUserWorkItem(unused =>
            {
                KosmosLauncher.ReuseCheck check = KosmosLauncher.CheckBoardBeforeReuse(boardPort, KosmosLauncher.ReuseQuickCheckMs);
                try
                {
                    BeginInvoke(new Action(() =>
                    {
                        if (visit != boardVisit) return;   // the window moved on to another visit meanwhile
                        if (KosmosLauncher.NoContentRefusalStands(check)) TellRefusal(sentence);
                        else
                        {
                            KosmosLauncher.NoteRefusal("a board download navigation failed and the board did not prove (" + check + "): " + address);
                            CheckThenShowNotConfirmed(KosmosLauncher.MayNavigateSignedIn);
                        }
                    }));
                }
                catch { /* the window closed meanwhile */ }
            });
        };
        settle.Start();
    }

    internal void OnDownloadStateChanged(ICoreWebView2DownloadOperation download)
    {
        int state;
        download.get_State(out state);
        // IN_PROGRESS is a resume. A pause arrives as INTERRUPTED with USER_PAUSED (said nothing, below); the handler
        // stays registered, so a paused download that later fails or completes is still seen.
        if (state == 0) return;
        if (state != KosmosLauncher.DownloadStateInterrupted) return;   // COMPLETED: saved
        int reason;
        download.get_InterruptReason(out reason);
        string address = null;
        try { download.get_Uri(out address); } catch { address = null; }
        string says = KosmosLauncher.DownloadInterruptedSays(reason);
        if (says == null) { KosmosLauncher.NoteRefusal("a download the person stopped (reason " + reason + "): " + address); return; }
        KosmosLauncher.NoteRefusal("download interrupted (reason " + reason + "): " + address);
        TellRefusal(says);
    }

    // #5483: a new document committed. It is the page the next navigation leaves, as the Mac sets
    // committedPageURL at didCommit: before the page's own scripts run, so a site page's checkout hand-off
    // from its load handler is judged as coming from the site, and a board page's as coming from a board.
    // An error page, or a document no in-window navigation was allowed for, is not the site.
    internal void OnContentLoading(ICoreWebView2ContentLoadingEventArgs args)
    {
        pageCommits++;   // #7403: a new page, so each refusal sentence may be shown again on it (RefusalGate)
        // #5492: run and both too, so a Kosmos Plus page opened in their window can hand off to checkout.
        if (mode != KosmosLauncher.ComputerMode.Connect && mode != KosmosLauncher.ComputerMode.Run && mode != KosmosLauncher.ComputerMode.Both) return;
        ulong navId;
        args.get_NavigationId(out navId);
        int isErrorPage;
        args.get_IsErrorPage(out isErrorPage);
        string inWindow;
        committedPage = isErrorPage == 0 && connectInWindow.TryGetValue(navId, out inWindow) ? inWindow : null;
    }

    // #4381: a connect computer's sign-in that did not load says so, in a box titled Kosmos (WebView2's own
    // error page stays behind it, so the window is never blank). Only the load this window started
    // (LoadConnect): a page the person moved on to is that page's business. A load cancelled for another reason
    // (say, replaced by a newer navigation) is not Kosmos Plus failing to answer. But a first
    // load the rules REFUSED (#5483: an unclicked redirect off Kosmos Plus, e.g. a captive portal) is: it
    // never reached Kosmos Plus, so the box shows and Reopen (SignInAgain) loads it again.
    internal void OnNavigationCompleted(ICoreWebView2NavigationCompletedEventArgs args)
    {
        ulong navId;
        args.get_NavigationId(out navId);
        int success;
        args.get_IsSuccess(out success);
        // #6882: a board load that failed (the board restarted, or something else holds the port) leaves WebView2's
        // error page, whose retry is a navigation and is checked (OnNavigationStarting). The window checks now too, off
        // this thread, and shows why instead of the error page when the board does not prove. A load that was cancelled
        // (by the check above, the link rules, or a newer navigation) did not fail.
        string failedLoad;
        bool boardNav = boardNavs.TryGetValue(navId, out failedLoad);
        boardNavs.Remove(navId);
        // #7403: a board's 204 to a plain navigation is its refusal of a download (the board's refuseDownload). Said once
        // it is clear no download came of it, and not taken for a board that could not be reached (it answered).
        if (success == 0)
        {
            string inWindowAddress;
            bool inWindow = connectInWindow.TryGetValue(navId, out inWindowAddress);
            string address = boardNav ? failedLoad : inWindowAddress;
            bool toBoard = boardNav || (inWindow && KosmosLauncher.IsKosmosPlusAddress(inWindowAddress));
            int webError;
            args.get_WebErrorStatus(out webError);
            int httpStatus = 0;
            try
            {
                ICoreWebView2NavigationCompletedEventArgs2 args2 = args as ICoreWebView2NavigationCompletedEventArgs2;
                if (args2 != null) args2.get_HttpStatusCode(out httpStatus);
            }
            catch { httpStatus = 0; }
            string refused = KosmosLauncher.NoContentNavigationSays(false, webError, httpStatus, toBoard, address);
            if (refused != null)
            {
                // Decided by SayUnlessADownloadStarted: a refusal, a download, or (the board did not prove) the same
                // not-confirmed check the failed-load handling below would make for this error. So not handled twice.
                SayUnlessADownloadStarted(address, refused, boardNav);
                boardNav = false;
            }
        }
        // A board load that worked ends a run of failures: the next failure is retried again (once).
        if (boardNav && success != 0) failedLoadRetriedVisit = -1;
        if (boardNav && success == 0)
        {
            int failure;
            args.get_WebErrorStatus(out failure);
            if (failure != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED)
            {
                // Once per visit, the load is tried again after the board proves (CheckNavigationAgain: it waits out a
                // board restarting, then loads, or shows why). A load that fails again is only checked: it shows why if
                // the board does not prove, and otherwise stays on WebView2's error page, whose retry is checked too.
                if (failedLoadRetriedVisit != boardVisit && navigatedToBoard && !boardNotConfirmed && !KosmosLauncher.IsSignInLoad(failedLoad)
                    && KosmosLauncher.CouldNotReachBoard(failure))
                {
                    failedLoadRetriedVisit = boardVisit;
                    string again = failedLoad;
                    BeginInvoke(new Action(() => CheckNavigationAgain(again)));
                }
                else CheckThenShowNotConfirmed(KosmosLauncher.MayNavigateSignedIn);
            }
        }
        // #5492: run and both record their in-window pages too (OnNavigationStarting), so they forget them here;
        // the first-load check below is connect's alone (connectLoadPending is never set on run or both).
        if (mode != KosmosLauncher.ComputerMode.Connect && mode != KosmosLauncher.ComputerMode.Run && mode != KosmosLauncher.ComputerMode.Both) return;
        connectInWindow.Remove(navId);
        // Settled by the first load's own completion; if its start was never recognised (an address in another
        // form), by the first completion, as before #5483, so a load that really failed still says so.
        if (!connectLoadPending || (connectLoadNavKnown && navId != connectLoadNavId)) return;
        connectLoadPending = false;
        int status;
        args.get_WebErrorStatus(out status);
        connectLoadFailed = (success == 0 && status != COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED) || connectLoadRefused;
        if (connectLoadFailed) BeginInvoke(new Action(() => KosmosLauncher.ShowWindowMessage(KosmosLauncher.KosmosPlusUnreachableMessage, true)));
    }

    const int COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED = 14;

    const int COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED = 0;
    const int COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED = 1;
    const int COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE = 2;

    // A page that crashed or hung is loaded again. A browser process that ended leaves nothing to
    // load it in, so the window closes and says so, rather than sitting blank.
    // #6882: a board page's reload waits for the board to prove first (CheckNavigationAgain: the full check, then the
    // Reload, or NotConfirmedPage). Its request carries the sign-in, and the window starts it, so the window can and
    // does check before it, not only before it is shown (OnNavigationStarting). Any other page reloads as before.
    internal void OnProcessFailed(ICoreWebView2ProcessFailedEventArgs args)
    {
        int kind;
        args.get_ProcessFailedKind(out kind);
        if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED)
        {
            StoppedWorking = true;
            BeginInvoke(new Action(Close));
            return;
        }
        if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE)
        {
            committedPage = null;   // #5483: no page is committed until the reload commits one (the Mac clears it on terminate)
            string onScreen = BoardPageOnScreen();
            if (onScreen != null) { BeginInvoke(new Action(() => CheckNavigationAgain(onScreen))); return; }
            BeginInvoke(new Action(() => { try { webView.Reload(); } catch { /* F5 is still there */ } }));
        }
    }

    // #6882: the address on screen when it is this window's board page (on a computer that runs its board), else null.
    string BoardPageOnScreen()
    {
        if (mode == KosmosLauncher.ComputerMode.Connect || !navigatedToBoard || boardNotConfirmed || webView == null) return null;
        string onScreen = null;
        try { webView.get_Source(out onScreen); } catch { return null; }
        return KosmosLauncher.IsBoardAddress(onScreen, port) ? onScreen : null;
    }

    const int COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN = 0;
    const int COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN = 2;

    // #6882: F5, Ctrl+R and the rest of KosmosLauncher.IsReloadKey, on a board page: the window takes the key from
    // WebView2 and reloads only after the board proves (CheckNavigationAgain), as a crashed page's reload does. A
    // held key's repeats are taken too, so they reload nothing, and start no second check (one runs at a time).
    // Anywhere else (a Kosmos Plus page, the window's own pages) the key does what WebView2 does with it.
    internal void OnAcceleratorKeyPressed(ICoreWebView2AcceleratorKeyPressedEventArgs args)
    {
        int kind;
        args.get_KeyEventKind(out kind);
        if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) return;
        uint key;
        args.get_VirtualKey(out key);
        bool control = (KosmosLauncher.GetKeyState(KosmosLauncher.VirtualKeyControl) & 0x8000) != 0;
        bool alt = (KosmosLauncher.GetKeyState(KosmosLauncher.VirtualKeyAlt) & 0x8000) != 0;
        if (!KosmosLauncher.IsReloadKey(key, control, alt)) return;
        string onScreen = BoardPageOnScreen();
        if (onScreen == null) return;
        args.put_Handled(1);
        CheckNavigationAgain(onScreen);
    }

    void FitViewToWindow()
    {
        if (controller == null) return;
        try
        {
            bool minimized = WindowState == System.Windows.Forms.FormWindowState.Minimized;
            controller.put_IsVisible(minimized ? 0 : 1);
            if (minimized) return;
            System.Drawing.Rectangle client = ClientRectangle;
            RECT bounds;
            // #4382: the page starts below the update bar while it shows, so the bar never covers the page.
            int barHeight = updateBar != null && updateBar.Visible ? updateBar.Height : 0;
            bounds.left = client.Left; bounds.top = client.Top + barHeight; bounds.right = client.Right; bounds.bottom = client.Bottom;
            controller.put_Bounds(bounds);
        }
        catch { /* a view that is going away */ }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        FitViewToWindow();
    }

    protected override void OnMove(EventArgs e)
    {
        base.OnMove(e);
        if (controller != null) { try { controller.NotifyParentWindowPositionChanged(); } catch { /* a view that is going away */ } }
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        if (controller != null) { try { controller.MoveFocus(0); } catch { /* a view that is going away */ } }
    }

    protected override void WndProc(ref System.Windows.Forms.Message m)
    {
        if (m.Msg != 0 && (uint)m.Msg == showMessage)
        {
            if (WindowState == System.Windows.Forms.FormWindowState.Minimized) WindowState = System.Windows.Forms.FormWindowState.Normal;
            Activate();
            KosmosLauncher.SetForegroundWindow(Handle);
            SignInAgain();
            return;
        }
        if (m.Msg != 0 && (uint)m.Msg == closeMessage) { Close(); return; }
        if (m.Msg == WM_SYSCOMMAND && ((long)m.WParam & 0xFFF0) == RunAgentsMenuId) { RunAgentsHere(); return; }
        if (m.Msg == WM_SYSCOMMAND && ((long)m.WParam & 0xFFF0) == UpdateMenuId) { UpdatePicked(); return; }
        if (m.Msg == WM_SYSCOMMAND && ((long)m.WParam & 0xFFF0) == RollbackMenuId) { RollbackPicked(); return; }
        if (m.Msg != 0 && (uint)m.Msg == taskbarButtonCreatedMessage)
        {
            taskbarButtonReady = true;
            badgeEverApplied = false;   // a new button carries no overlay, whatever the last one had
            ApplyBadge();
        }
        base.WndProc(ref m);
    }

    // ---- #3996: the waiting count on the taskbar button ----------------------------------------
    //
    // TWO SOURCES, ONE NUMBER, as the Mac app's Dock badge (native-app/main.swift startDockBadge).
    // The board works the number out (engine/status.js waitingTotal, served as counts.waiting on
    // /api/status); this only shows it. While the page is polling the board (every 5 s) it hands
    // this window its counts.waiting through chrome.webview.postMessage (OnWebMessage), so the
    // window asks nothing extra of the board's heaviest route. When the page has said nothing for
    // PageSilentMs (the window minimised, which hides the page and lets Chromium slow its timers,
    // or the page reloading or not loaded yet), the window's own PollEveryMs timer reads
    // /api/status itself, with the board token, so the badge keeps up while minimised.
    void StartBadge()
    {
        if (badgeTimer != null) return;
        badgeTimer = new System.Windows.Forms.Timer();
        badgeTimer.Interval = TaskbarBadge.PollEveryMs;
        badgeTimer.Tick += (sender, args) => { RefreshBadge(); WatchBoard(); RecoverBoard(); };   // #6882: the page's polling, and coming back
        badgeTimer.Start();
        RefreshBadge();
    }

    void RefreshBadge()
    {
        // The page is saying it: PageSilentMs sits above the page's 5 s poll and below this 10 s tick.
        if (pageSaidWaiting.IsRunning && pageSaidWaiting.ElapsedMilliseconds < TaskbarBadge.PageSilentMs) return;
        if (badgeReadInFlight) return;
        badgeReadInFlight = true;
        int asked = ++badgeAsked;
        int boardPort = port;
        ThreadPool.QueueUserWorkItem(unused =>
        {
            int? waiting;
            bool answered = TaskbarBadge.ReadBoard(boardPort, out waiting);
            try { BeginInvoke(new Action(() => BoardAnswered(answered, waiting, asked))); }
            catch { /* the window closed meanwhile */ }
        });
    }

    void BoardAnswered(bool answered, int? waiting, int asked)
    {
        badgeReadInFlight = false;
        // #4381: a read that was asked before the switch to connect lands on no badge.
        if (mode == KosmosLauncher.ComputerMode.Connect) return;
        if (answered) badgeMisses = 0; else badgeMisses++;
        // One slow answer on a busy board is not a board that is gone: the badge clears only after
        // MissesBeforeClear misses in a row (about 30 s), and until then the number stands.
        if (answered || badgeMisses >= TaskbarBadge.MissesBeforeClear) ShowBadge(answered ? waiting : null, asked);
    }

    // The page's own count, handed over after every board poll that worked. Only the board's own
    // page (this port on loopback) is heard, and WebView2 raises this for the top-level document only.
    internal void OnWebMessage(ICoreWebView2WebMessageReceivedEventArgs args)
    {
        string source;
        args.get_Source(out source);
        if (!KosmosLauncher.IsBoardAddress(source, port)) return;
        string json;
        args.get_WebMessageAsJson(out json);
        // #4381: the first screen's { kosmosMode }, from the board's own page only (above).
        string chosen = KosmosLauncher.ModeFromPageMessage(json);
        if (chosen != null) { PageChoseMode(chosen); return; }
        // A connect computer shows no badge, whatever a board page still on screen says.
        if (mode == KosmosLauncher.ComputerMode.Connect) return;
        // #6512: the page's { kosmosSignin: true }: this window is signed out (PageSaysSignedOut).
        if (KosmosLauncher.IsSigninPageMessage(json)) { PageSaysSignedOut(source); return; }
        int? waiting;
        if (!TaskbarBadge.ReadsAsPageMessage(json, out waiting)) return;
        pageSaidWaiting.Restart();
        // A post is a board read that worked, so the window's miss count starts again, and so does
        // its sign-in count (#6512): the last sign-in took, or the window never needed one.
        badgeMisses = 0;
        signInAgainGaveUp = false;
        signInsWithoutRead = 0;
        autoRecoveries = 0;   // #6882: and so does the window's own coming back (RecoverBoard)
        ShowBadge(waiting, ++badgeAsked);
    }

    void ShowBadge(int? waiting, int asked)
    {
        if (asked < badgeShownAsked) return;
        badgeShownAsked = asked;
        badgeWanted = waiting;
        ApplyBadge();
    }

    // Sets the overlay once the taskbar button exists, and only when the count changed. The icon is
    // drawn for this count and destroyed straight after: the taskbar keeps its own copy.
    void ApplyBadge()
    {
        if (!taskbarButtonReady || IsDisposed) return;
        int? count = TaskbarBadge.Shown(badgeWanted);
        if (badgeEverApplied && count == badgeOnTaskbar) return;
        IntPtr icon = IntPtr.Zero;
        try
        {
            if (taskbar == null)
            {
                taskbar = (TaskbarBadge.ITaskbarList3)new TaskbarBadge.TaskbarListObject();
                taskbar.HrInit();
            }
            string label = TaskbarBadge.Label(count);
            if (label != null) icon = TaskbarBadge.DrawIcon(label, TaskbarBadge.IconSize());
            taskbar.SetOverlayIcon(Handle, icon, TaskbarBadge.Description(count));
            badgeOnTaskbar = count;
            badgeEverApplied = true;
        }
        catch { /* no taskbar to badge (Explorer not running): its next TaskbarButtonCreated tries again */ }
        finally { if (icon != IntPtr.Zero) TaskbarBadge.DestroyIcon(icon); }
    }

    // ---- #4381: this computer's choice, the connect switch, and the way back --------------------------

    // The first screen's button (web frChoose). 🛑 HEARD ONLY WHILE THE WINDOW IS ASKING (unset or
    // unreadable), and only from the board's own page (OnWebMessage checks the source first): once a
    // choice is saved no page can change it, and a Kosmos Plus page never can. Boxes are shown after
    // this returns (BeginInvoke), never inside WebView2's callback.
    void PageChoseMode(string choice)
    {
        if (mode != KosmosLauncher.ComputerMode.Unset && mode != KosmosLauncher.ComputerMode.Unreadable) return;
        string file = KosmosLauncher.computerModeFile();
        string folder = Path.GetDirectoryName(file);
        switch (choice)
        {
            case "run":
            case "both":
                // First run carries on either way; a choice that could not be saved is said, and with no
                // file the computer counts as run once its first run is done (the page asks only then).
                KosmosLauncher.ComputerMode chosen = choice == "run" ? KosmosLauncher.ComputerMode.Run : KosmosLauncher.ComputerMode.Both;
                if (!KosmosLauncher.WriteComputerMode(chosen, file)) Say(KosmosLauncher.ChoiceNotSavedMessage(folder), true);
                mode = chosen;
                return;
            case "connect":
                if (!KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Connect, file))
                {
                    // Nothing changed: the board keeps running and the page asks again.
                    Say(KosmosLauncher.ConnectNotSavedMessage(folder), true);
                    if (webView != null) webView.Navigate(KosmosLauncher.WithModeQuery("http://127.0.0.1:" + port, mode));
                    return;
                }
                SwitchToConnect();
                return;
            default:
                return;
        }
    }

    void Say(string text, bool isError)
    {
        BeginInvoke(new Action(() => KosmosLauncher.ShowWindowMessage(text, isError)));
    }

    // 🛑 CONNECT, IN THE SPEC'S ORDER (#4381 section 3): 1. the board's work in this window stops (the
    // badge timer, and its overlay is cleared), and the system menu gains the way back; 2 and 3,
    // off this thread: the logon task is switched off, then the board is ended with its tree
    // (KosmosLauncher.StopBoardHere); 4. then this window loads Kosmos Plus sign-in. A stop that failed
    // is said, and sign-in loads anyway.
    void SwitchToConnect()
    {
        mode = KosmosLauncher.ComputerMode.Connect;
        boardVisit++;   // #6882: a check still out for the board changes nothing on a connect computer
        navigationWaiting = null;
        // #5483: the board page still on screen is not the Kosmos Plus site (the Mac clears it here too).
        committedPage = null;
        connectInWindow.Clear();
        StopBadge();
        UpdateRunAgentsItem();
        StopBoardInBackground(true);
    }

    void StopBadge()
    {
        if (badgeTimer != null) { badgeTimer.Stop(); badgeTimer.Dispose(); badgeTimer = null; }
        pageSaidWaiting.Reset();
        badgeWanted = null;
        ApplyBadge();
    }

    // Counted in stopsInFlight from the moment it is asked for until its outcome is back on this thread.
    // Not a background thread: closing the window must not cut a stop off between its steps.
    void StopBoardInBackground(bool thenSignIn)
    {
        stopsInFlight++;
        int boardPort = port;
        string task = boardTask;
        Thread stop = new Thread(() =>
        {
            bool stopped = KosmosLauncher.StopBoardHere(boardPort, task);
            try
            {
                BeginInvoke(new Action(() =>
                {
                    stopsInFlight--;
                    if (thenSignIn && mode == KosmosLauncher.ComputerMode.Connect) LoadConnect();
                    if (!stopped) KosmosLauncher.ShowWindowMessage(KosmosLauncher.BoardStillRunningMessage, true);
                    // #4382: with the stop done, a connect computer looks for an update now and once a day, as the
                    // Mac chains its look after stopBoardIfRunning. The look itself refuses while a board answers.
                    // Only after a stop that held: a stop that did not hold may have left the board's logon task
                    // switched on, and the engine's connect precondition (win32update B0) stands in for the board-task
                    // rule, so nothing else would keep that task from starting a board under a swap. The person is
                    // told (BoardStillRunningMessage), and the next launch stops the board and looks again.
                    if (stopped && mode == KosmosLauncher.ComputerMode.Connect) StartUpdateLooks();
                }));
            }
            catch { /* the window closed meanwhile; the next launch stops it again */ }
        });
        stop.IsBackground = false;
        stop.Start();
    }

    // The system menu's "Run agents on this computer", shown only on a connect computer. It cannot live in
    // the page's Settings, because on a connect computer the page on screen is the OTHER computer's
    // (#4356, Liu Kang m2442), and this window has no menu bar or tray icon.
    //   1. refused while a connect stop is still running, said;
    //   2. `run` is written; a write that fails is said and changes nothing;
    //   3. the logon task is switched on again, and Kosmos.exe is opened from this folder, which starts
    //      the board exactly as a double-click does (the hand-off to the task);
    //   4. this window loads the board with no ?mode=: first run was never done here, so the wizard
    //      opens, as on a fresh computer;
    //   5. the badge starts again.
    void RunAgentsHere()
    {
        if (mode != KosmosLauncher.ComputerMode.Connect) return;
        // #4382: an update or rollback swaps the Kosmos folder; a board started under it would race the swap.
        // Before the stopsInFlight check, which a run of this window's also counts in: the order picks the words.
        if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }
        // And one this window no longer sees: a window closed mid-install lets go of the one-window lock, so the
        // window opened after it would not know. The updater's own files say (UpdateUnderWayHere).
        if (KosmosLauncher.UpdateUnderWayHere(here)) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }
        if (stopsInFlight > 0) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillStoppingMessage, false); return; }
        string file = KosmosLauncher.computerModeFile();
        if (!KosmosLauncher.WriteComputerMode(KosmosLauncher.ComputerMode.Run, file))
        {
            KosmosLauncher.ShowWindowMessage(KosmosLauncher.RunAgentsNotSavedMessage(Path.GetDirectoryName(file)), true);
            return;
        }
        mode = KosmosLauncher.ComputerMode.Run;
        // #4382: the board this starts keeps the computer updated from here on.
        StopUpdateLooks();
        UpdateRunAgentsItem();
        committedPage = null;
        connectInWindow.Clear();
        connectLoadPending = false;
        connectLoadFailed = false;
        navigatedToBoard = false;
        boardAddress = null;
        boardNotConfirmed = false;
        recheckRefused = false;
        boardVisit++;   // #6882: a check still out for the board before the switch changes nothing
        navigationWaiting = null;
        if (webView != null) webView.NavigateToString(KosmosLauncher.StartingPage);
        string task = boardTask;
        string exe = Assembly.GetExecutingAssembly().Location;
        string folder = here;
        Thread start = new Thread(() =>
        {
            KosmosLauncher.EnableBoardTask(task);
            string problem = KosmosLauncher.startLauncher(exe, folder);
            try
            {
                BeginInvoke(new Action(() =>
                {
                    if (problem != null) KosmosLauncher.ShowWindowMessage("Kosmos could not start on this computer (" + problem + "). Double-click Kosmos.exe to try again.", true);
                    StartBadge();
                    ResolveBoardAddressInBackground();
                }));
            }
            catch { /* the window closed meanwhile */ }
        });
        start.IsBackground = false;
        start.Start();
    }

    // Shown only while the mode is connect. Hidden by giving the window its default system menu back.
    // #4382: on a connect computer the same menu also offers the update ("Update Kosmos to X", or "Restart
    // Kosmos to use X" once one is installed) and the rollback ("Roll back Kosmos to X"), each only while
    // there is one, because the page, where a board computer has both buttons, is the other computer's.
    // Rebuilt from the default menu whenever what it should show changes.
    void UpdateRunAgentsItem()
    {
        bool want = mode == KosmosLauncher.ComputerMode.Connect;
        string updateText = !want || updateState.Unsettled ? null
            : updateState.Installed != null ? KosmosLauncher.RestartMenuText(updateState.Installed)
            : updateState.Offer != null ? KosmosLauncher.UpdateMenuText(updateState.Offer)
            : null;
        // Not while an installed update waits for its Restart: the kept build is then the copy this window runs from.
        string rollbackText = want && updateState.Rollback != null && updateState.Installed == null && !updateState.Unsettled ? KosmosLauncher.RollbackMenuText(updateState.Rollback) : null;
        string shape = want ? "run|" + (updateText ?? "") + "|" + (rollbackText ?? "") : null;
        if (shape == systemMenuShown || !IsHandleCreated) return;
        try
        {
            if (systemMenuShown != null) GetSystemMenu(Handle, true);
            if (want)
            {
                IntPtr menu = GetSystemMenu(Handle, false);
                if (menu == IntPtr.Zero) return;
                AppendMenuW(menu, MF_SEPARATOR, UIntPtr.Zero, null);
                AppendMenuW(menu, MF_STRING, new UIntPtr((uint)RunAgentsMenuId), KosmosLauncher.RunAgentsMenuText);
                if (updateText != null) AppendMenuW(menu, MF_STRING, new UIntPtr((uint)UpdateMenuId), updateText);
                if (rollbackText != null) AppendMenuW(menu, MF_STRING, new UIntPtr((uint)RollbackMenuId), rollbackText);
            }
            else
            {
                GetSystemMenu(Handle, true);
            }
            systemMenuShown = shape;
        }
        catch { /* no system menu to change: the next change tries again */ }
    }

    // ---- #4382: a connect computer updates, and rolls back, with no board ----------------------
    //
    // As the Mac app's startUpdateLooks/lookForUpdate (native-app/main.swift). What each answer does is
    // decided by KosmosLauncher.AfterConnectUpdate, which is pure and tested on its own; this part runs
    // the engine, applies the state it returns, and draws it:
    //   at launch, once the connect stop is done, and every UpdateLookEveryMs while the window is open:
    //     a look, which installs only when updates are on here (the board's own rule, maybeAutoInstall),
    //     and none while an update this window installed waits for its Restart (UpdateLookIsDue);
    //   Update (the bar or the menu) installs the offer, or restarts into an installed update;
    //   Roll back (the menu, asked first) restores the kept build.
    // Each run is counted in stopsInFlight, so "Run agents on this computer" cannot start a board under
    // an install; the engine starts no board itself on a connect computer.
    void StartUpdateLooks()
    {
        if (mode != KosmosLauncher.ComputerMode.Connect) return;
        if (updateTimer == null)
        {
            updateTimer = new System.Windows.Forms.Timer();
            updateTimer.Interval = KosmosLauncher.UpdateLookEveryMs;
            updateTimer.Tick += (sender, args) => { if (KosmosLauncher.UpdateLookIsDue(updateState)) LookForUpdate("look"); };
            updateTimer.Start();
        }
        if (KosmosLauncher.UpdateLookIsDue(updateState)) LookForUpdate("look");
    }

    void StopUpdateLooks()
    {
        if (updateTimer != null) { updateTimer.Stop(); updateTimer.Dispose(); updateTimer = null; }
        updateState = new KosmosLauncher.ConnectUpdateState();
        ShowUpdateBar(null, null);
    }

    // "look", "install" (the person picked Update) or "rollback" (the person picked Roll back and said yes).
    void LookForUpdate(string action)
    {
        if (mode != KosmosLauncher.ComputerMode.Connect) return;
        if (updateLookInFlight) return;
        updateLookInFlight = true;
        stopsInFlight++;
        if (action == "install") ShowUpdateBar(KosmosLauncher.UpdatingNote, null);
        else if (action == "rollback") ShowUpdateBar(KosmosLauncher.RollingBackNote, null);
        int boardPort = port;
        string folder = here;
        string expect = action == "rollback" ? updateState.Rollback : action == "install" ? updateState.Offer : null;
        // The window's own look is given up on after UpdateLookTimeoutMs: this window stops WAITING (its flags
        // are let go, so Run agents is no longer held by them), but nothing is killed, because a kill could land
        // while the engine holds the prepare lock or has written a journal. The engine run finishes or fails on
        // its own, and while its lock or journal is fresh Run agents is still held by UpdateUnderWayHere.
        bool[] finished = new bool[1];
        bool[] gaveUp = new bool[1];
        Thread[] lookThread = new Thread[1];
        System.Windows.Forms.Timer giveUp = null;
        if (action == "look")
        {
            giveUp = new System.Windows.Forms.Timer();
            giveUp.Interval = KosmosLauncher.UpdateLookTimeoutMs;
            giveUp.Tick += (sender, args) =>
            {
                giveUp.Stop();
                giveUp.Dispose();
                if (finished[0]) return;
                gaveUp[0] = true;
                updateLookInFlight = false;
                stopsInFlight--;
                // No longer waited for, so it no longer keeps Kosmos.exe open once the window closes: the engine
                // run is its own process and finishes or fails on its own either way.
                try { if (lookThread[0] != null) lookThread[0].IsBackground = true; } catch (ThreadStateException) { /* it ended meanwhile */ }
            };
            giveUp.Start();
        }
        Thread look = new Thread(() =>
        {
            string problem = null;
            string[] lines = null;
            try
            {
                lines = KosmosLauncher.runEngineHelper(Path.Combine(folder, "runtime\\node.exe"), folder, KosmosLauncher.ConnectUpdateScript,
                    KosmosLauncher.ConnectUpdateArguments(action, boardPort, expect), 0, out problem);
            }
            catch (Exception e) { problem = e.Message; }
            KosmosLauncher.ConnectUpdateAnswer answer = KosmosLauncher.ReadConnectUpdateReport(lines);
            if (answer.Kind == KosmosLauncher.ConnectUpdateKind.Unknown && answer.Value == null && problem != null) answer.Value = problem;
            try
            {
                BeginInvoke(new Action(() =>
                {
                    finished[0] = true;
                    if (giveUp != null && !gaveUp[0]) { giveUp.Stop(); giveUp.Dispose(); }
                    // Its flags were let go already. An install it did, or may have done (pending), is still recorded,
                    // so no further look runs while this window runs, or may run, from the copy that install moved aside.
                    // If another run is in flight, it is recorded once that run is done (lateInstall).
                    if (gaveUp[0])
                    {
                        if (answer.Kind != KosmosLauncher.ConnectUpdateKind.Updated && answer.Kind != KosmosLauncher.ConnectUpdateKind.Pending) return;
                        if (updateLookInFlight) lateInstall = answer;
                        else UpdateLookDone(answer, action);
                        return;
                    }
                    updateLookInFlight = false;
                    stopsInFlight--;
                    UpdateLookDone(answer, action);
                    if (lateInstall != null)
                    {
                        KosmosLauncher.ConnectUpdateAnswer late = lateInstall;
                        lateInstall = null;
                        if (RelaunchAfterClose == null && !IsDisposed) UpdateLookDone(late, "look");
                    }
                }));
            }
            catch { /* the window closed meanwhile; the next launch looks again */ }
        });
        // Not a background thread: closing the window must not cut an install off between its steps.
        look.IsBackground = false;
        lookThread[0] = look;
        look.Start();
    }

    void UpdateLookDone(KosmosLauncher.ConnectUpdateAnswer answer, string action)
    {
        if (mode != KosmosLauncher.ComputerMode.Connect) { StopUpdateLooks(); UpdateRunAgentsItem(); return; }
        updateState = KosmosLauncher.AfterConnectUpdate(updateState, answer, action);
        if (updateTimer != null && updateTimer.Interval != updateState.NextLookMs) updateTimer.Interval = updateState.NextLookMs;
        if (updateState.Relaunch != null) { RelaunchAfterClose = updateState.Relaunch; Close(); return; }
        ShowUpdateBar(updateState.BarNote, updateState.BarButton);
        UpdateRunAgentsItem();
        if (updateState.Message != null) KosmosLauncher.ShowWindowMessage(updateState.Message, true);
    }

    // The system menu's Update item, and the bar's button.
    void UpdatePicked()
    {
        if (mode != KosmosLauncher.ComputerMode.Connect) return;
        string next = KosmosLauncher.UpdatePickedAction(updateState, updateLookInFlight);
        if (next == "busy") { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }
        if (next == "restart") { RelaunchAfterClose = "update"; Close(); return; }
        if (next == "install") LookForUpdate("install");
    }

    // The system menu's Roll back item: asked first, because it replaces the Kosmos folder's build.
    void RollbackPicked()
    {
        if (mode != KosmosLauncher.ComputerMode.Connect || updateState.Rollback == null || updateState.Installed != null || updateState.Unsettled) return;
        if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }
        if (!KosmosLauncher.askYesNo(KosmosLauncher.RollbackQuestion(updateState.Rollback))) return;
        // The daily look can start while the question is open (a WinForms timer ticks inside the box's loop).
        if (updateLookInFlight) { KosmosLauncher.ShowWindowMessage(KosmosLauncher.StillUpdatingMessage, false); return; }
        LookForUpdate("rollback");
    }

    // The slim bar over the page: `note`, one button when given (Update or Restart), and always Not now, so
    // a note can be put away. null hides it. The page is moved below it (FitViewToWindow), never covered.
    void ShowUpdateBar(string note, string button)
    {
        if (note == null)
        {
            if (updateBar != null && updateBar.Visible) { updateBar.Visible = false; FitViewToWindow(); }
            return;
        }
        if (updateBar == null)
        {
            updateBar = new System.Windows.Forms.Panel();
            updateBar.Dock = System.Windows.Forms.DockStyle.Top;
            updateBar.Height = (int)Math.Ceiling(Font.GetHeight() * 2.6);
            updateBar.BackColor = System.Drawing.Color.FromArgb(255, 244, 214);
            updateBar.Padding = new System.Windows.Forms.Padding(8, 4, 8, 4);
            updateBarNotNow = new System.Windows.Forms.Button();
            updateBarNotNow.Text = "Not now";
            updateBarNotNow.AutoSize = true;
            updateBarNotNow.Dock = System.Windows.Forms.DockStyle.Right;
            updateBarNotNow.Click += (sender, args) =>
            {
                updateState = KosmosLauncher.AfterNotNow(updateState);
                ShowUpdateBar(null, null);
            };
            updateBarButton = new System.Windows.Forms.Button();
            updateBarButton.AutoSize = true;
            updateBarButton.Dock = System.Windows.Forms.DockStyle.Right;
            updateBarButton.Click += (sender, args) => UpdatePicked();
            updateBarLabel = new System.Windows.Forms.Label();
            updateBarLabel.Dock = System.Windows.Forms.DockStyle.Fill;
            updateBarLabel.AutoEllipsis = true;
            updateBarLabel.TextAlign = System.Drawing.ContentAlignment.MiddleLeft;
            // Docking runs from the last control added to the first: Not now at the right edge, the button
            // left of it, and the words filling what is left.
            updateBar.Controls.Add(updateBarLabel);
            updateBar.Controls.Add(updateBarButton);
            updateBar.Controls.Add(updateBarNotNow);
            Controls.Add(updateBar);
        }
        updateBarLabel.Text = note;
        updateBarButton.Text = button ?? "";
        updateBarButton.Visible = button != null;
        // Not now while a run is under way (updating, rolling back) would only hide that it is: no button then.
        updateBarNotNow.Visible = !updateLookInFlight;
        updateBar.Visible = true;
        updateBar.BringToFront();
        FitViewToWindow();
    }

    const int WM_SYSCOMMAND = 0x0112;
    const uint MF_STRING = 0x0;
    const uint MF_SEPARATOR = 0x800;

    [DllImport("user32.dll")]
    static extern IntPtr GetSystemMenu(IntPtr window, bool revert);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool AppendMenuW(IntPtr menu, uint flags, UIntPtr id, string text);

    protected override void OnFormClosed(System.Windows.Forms.FormClosedEventArgs e)
    {
        if (badgeTimer != null) { badgeTimer.Stop(); badgeTimer.Dispose(); badgeTimer = null; }
        if (updateTimer != null) { updateTimer.Stop(); updateTimer.Dispose(); updateTimer = null; }
        if (controller != null) { try { controller.Close(); } catch { /* already gone */ } controller = null; }
        base.OnFormClosed(e);
    }
}

// The completion handlers and event handlers WebView2 calls back on. Each forwards to the form and
// answers S_OK whatever happens: an exception escaping into WebView2 would end the process.
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class EnvironmentCreated : ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler
{
    readonly BoardWindowForm form;
    internal EnvironmentCreated(BoardWindowForm form) { this.form = form; }
    public int Invoke(int errorCode, ICoreWebView2Environment environment)
    {
        try { form.EnvironmentReady(errorCode, environment); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class ControllerCreated : ICoreWebView2CreateCoreWebView2ControllerCompletedHandler
{
    readonly BoardWindowForm form;
    internal ControllerCreated(BoardWindowForm form) { this.form = form; }
    public int Invoke(int errorCode, ICoreWebView2Controller controller)
    {
        try { form.ControllerReady(errorCode, controller); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class NavigationStarting : ICoreWebView2NavigationStartingEventHandler
{
    readonly BoardWindowForm form;
    internal NavigationStarting(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2NavigationStartingEventArgs args)
    {
        try { form.OnNavigationStarting(args); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class NewWindowRequested : ICoreWebView2NewWindowRequestedEventHandler
{
    readonly BoardWindowForm form;
    internal NewWindowRequested(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2NewWindowRequestedEventArgs args)
    {
        try { form.OnNewWindowRequested(args); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class AcceleratorKeyPressed : ICoreWebView2AcceleratorKeyPressedEventHandler
{
    readonly BoardWindowForm form;
    internal AcceleratorKeyPressed(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2Controller sender, ICoreWebView2AcceleratorKeyPressedEventArgs args)
    {
        try { form.OnAcceleratorKeyPressed(args); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class ProcessFailed : ICoreWebView2ProcessFailedEventHandler
{
    readonly BoardWindowForm form;
    internal ProcessFailed(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2ProcessFailedEventArgs args)
    {
        try { form.OnProcessFailed(args); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class WebMessageReceived : ICoreWebView2WebMessageReceivedEventHandler
{
    readonly BoardWindowForm form;
    internal WebMessageReceived(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2WebMessageReceivedEventArgs args)
    {
        try { form.OnWebMessage(args); } catch { /* see above */ }
        return 0;
    }
}

// #5483: which page a connect window has committed (BoardWindowForm.OnContentLoading).
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class ContentLoading : ICoreWebView2ContentLoadingEventHandler
{
    readonly BoardWindowForm form;
    internal ContentLoading(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2ContentLoadingEventArgs args)
    {
        try { form.OnContentLoading(args); } catch { /* see above */ }
        return 0;
    }
}

// #4381: whether a connect computer's sign-in loaded (BoardWindowForm.OnNavigationCompleted).
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class NavigationCompleted : ICoreWebView2NavigationCompletedEventHandler
{
    readonly BoardWindowForm form;
    internal NavigationCompleted(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2NavigationCompletedEventArgs args)
    {
        try { form.OnNavigationCompleted(args); } catch { /* see above */ }
        return 0;
    }
}

// #7403: a download is starting (BoardWindowForm.OnDownloadStarting), and how each one ends (OnDownloadStateChanged).
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class DownloadStarting : ICoreWebView2DownloadStartingEventHandler
{
    readonly BoardWindowForm form;
    internal DownloadStarting(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2 sender, ICoreWebView2DownloadStartingEventArgs args)
    {
        try { form.OnDownloadStarting(args); } catch { /* see above */ }
        return 0;
    }
}

[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class DownloadStateChanged : ICoreWebView2StateChangedEventHandler
{
    readonly BoardWindowForm form;
    internal DownloadStateChanged(BoardWindowForm form) { this.form = form; }
    public int Invoke(ICoreWebView2DownloadOperation sender, object args)
    {
        try { form.OnDownloadStateChanged(sender); } catch { /* see above */ }
        return 0;
    }
}

// #1765: before this process sends the board token, the listener on the board port shows it already holds that
// token. Every account on a Windows computer uses the same port, so whatever answers there is not always this
// account's board. The exchange is engine/boardproof.js's, byte for byte (tools.win-launcher-board-proof-1765.test.js
// checks this against it): GET /api/board-proof?n=<32 hex nonce>&k=<16 hex key id>, answered with
// {"proof": HMAC-SHA256(token, "kosmos-board-proof\0" + "127.0.0.1" + "\0" + port + "\0" + nonce)} in hex, which is
// checked here with our own copy of the token. The request carries no token, only the key id (a hash prefix).
static class BoardProof
{
    internal const string ProofPath = "/api/board-proof";
    internal const string KeyIdTag = "kosmos-board-proof-key\0";
    internal const string ProofTag = "kosmos-board-proof\0";
    internal const string ClientAddress = "127.0.0.1";
    internal const int NonceBytes = 16;
    internal const int KeyIdHex = 16;
    internal const int ProofHex = 64;
    internal const int AnswerMaxBytes = 4096;

    static string Hex(byte[] bytes)
    {
        StringBuilder s = new StringBuilder(bytes.Length * 2);
        foreach (byte b in bytes) s.Append(b.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
        return s.ToString();
    }

    internal static string KeyId(string token)
    {
        using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create())
            return Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(KeyIdTag + token))).Substring(0, KeyIdHex);
    }

    internal static string Proof(string token, string nonce, int port)
    {
        using (System.Security.Cryptography.HMACSHA256 mac = new System.Security.Cryptography.HMACSHA256(Encoding.UTF8.GetBytes(token)))
            return Hex(mac.ComputeHash(Encoding.UTF8.GetBytes(ProofTag + ClientAddress + "\0" + port.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\0" + nonce)));
    }

    // A fresh random nonce for every check, so an answer recorded for one check cannot serve another.
    internal static string NewNonce()
    {
        byte[] bytes = new byte[NonceBytes];
        using (System.Security.Cryptography.RandomNumberGenerator rng = System.Security.Cryptography.RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        return Hex(bytes);
    }

    static bool IsLowerHex(string s, int length)
    {
        if (s == null || s.Length != length) return false;
        foreach (char c in s) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        return true;
    }

    // Whether `answer` is the proof for this token, nonce and port. Compared in constant time.
    internal static bool ProofMatches(string token, string nonce, string answer, int port)
    {
        if (string.IsNullOrEmpty(token) || !IsLowerHex(answer, ProofHex)) return false;
        string want = Proof(token, nonce, port);
        int diff = 0;
        for (int i = 0; i < ProofHex; i++) diff |= want[i] ^ answer[i];
        return diff == 0;
    }

    // The "proof" string in the board's answer, or null.
    internal static string ProofIn(string body)
    {
        string raw = TaskbarBadge.JsonMember(body, "proof");
        if (raw == null || raw.Length != ProofHex + 2 || raw[0] != '"' || raw[raw.Length - 1] != '"') return null;
        return raw.Substring(1, ProofHex);
    }

    // Does the listener at 127.0.0.1:port hold `token`? False for no answer, a refusal, a timeout, an answer that
    // is not a 200, longer than AnswerMaxBytes, or not the proof. One deadline covers the whole exchange: the
    // request is aborted when it passes. Never throws.
    internal static bool Holds(int port, string token, int timeoutMs)
    {
        return Check(port, token, timeoutMs) == Answer.Proves;
    }

    // #6882: how a check came out, for the board window, which treats "nothing is listening" differently from "a
    // listener answered and did not prove" (KosmosLauncher.MayNavigateSignedIn and its siblings). Holds is
    // Check == Proves, so every other caller reads it exactly as before.
    //   Proves      the proof, for this token, nonce and port.
    //   NoListener  the connection was refused: nothing listens on the port, so nothing can be sent anywhere.
    //   NoAnswer    a listener took the connection and gave no answer in time (or cut it): a hung board, or a
    //               squatter that holds connections open. Nothing shows which.
    //   NotProven   a listener answered, and it was not the proof: a squatter, another account's board, a redirect.
    internal enum Answer { Proves, NoListener, NoAnswer, NotProven }

    internal static Answer Check(int port, string token, int timeoutMs)
    {
        if (string.IsNullOrEmpty(token) || timeoutMs <= 0) return Answer.NoAnswer;
        string nonce = NewNonce();
        System.Net.HttpWebRequest request = null;
        try
        {
            request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://" + ClientAddress + ":" + port.ToString(System.Globalization.CultureInfo.InvariantCulture) + ProofPath + "?n=" + nonce + "&k=" + KeyId(token));
            request.Proxy = null;   // loopback: never the system proxy
            request.AllowAutoRedirect = false;   // a listener cannot send the check somewhere else
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.KeepAlive = false;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            System.Net.HttpWebRequest aborting = request;
            using (new System.Threading.Timer(_ => { try { aborting.Abort(); } catch { /* already done */ } }, null, timeoutMs, Timeout.Infinite))
            using (System.Net.HttpWebResponse response = (System.Net.HttpWebResponse)request.GetResponse())
            {
                if ((int)response.StatusCode != 200) return Answer.NotProven;
                byte[] buffer = new byte[AnswerMaxBytes + 1];
                int got = 0;
                using (Stream stream = response.GetResponseStream())
                {
                    int n;
                    while (got < buffer.Length && (n = stream.Read(buffer, got, buffer.Length - got)) > 0) got += n;
                }
                if (got > AnswerMaxBytes) return Answer.NotProven;
                return ProofMatches(token, nonce, ProofIn(Encoding.UTF8.GetString(buffer, 0, got)), port) ? Answer.Proves : Answer.NotProven;
            }
        }
        catch (System.Net.WebException e)
        {
            // A status the listener sent (a 404 from another account's board, a 403) is an answer that did not prove.
            if (e.Response != null) { try { e.Response.Close(); } catch { /* the answer was not a proof */ } return Answer.NotProven; }
            // Refused: nothing listens there. Anything else (the deadline's abort, a timeout, a cut connection) is no answer.
            return e.Status == System.Net.WebExceptionStatus.ConnectFailure ? Answer.NoListener : Answer.NoAnswer;
        }
        catch { return Answer.NoAnswer; }
    }
}

// ---- #3996: the waiting count on the taskbar button, the Windows twin of the Mac Dock badge ----
//
// The number is the board's, never worked out here: counts.waiting on /api/status (engine/status.js
// waitingTotal: agents that need the person + unread direct messages + unread project messages).
// Null (Settings > Computer > App icon switched off, #4025, or a board older than #3996), zero, or
// anything that is not a whole number clears the badge. The badge itself is ITaskbarList3's overlay
// icon on the window's taskbar button: a red circle with the count in white, 1 to 9, then "9+"
// (the overlay is a small icon, so a longer number would not read). It exists only while the
// window does, which is where the taskbar button is.
//
// Everything here but ReadBoard, DrawIcon and the COM is pure, so tools.win-taskbar-badge-3996.test.js
// compiles a probe beside this file and drives it.
static class TaskbarBadge
{
    // As the Mac app: the page polls every 5 s, the window's own read runs every 10 s but only after
    // 8 s of page silence, and three misses in a row (about 30 s) clear a number that stood.
    internal const int PollEveryMs = 10000;
    internal const int PageSilentMs = 8000;
    internal const int MissesBeforeClear = 3;
    const int ReadTimeoutMs = 8000;

    // engine/boardauth.js's TOKEN_FILE and HEADER_NAME, and store.js's APP (the data folder's leaf).
    internal const string BoardTokenFileName = "board.token";
    internal const string BoardTokenHeader = "x-kosmos-board-token";
    internal const string StoreLeaf = "Kosmos";

    // The page's message: { kosmosBadge: <counts.waiting> } (web/index.html tick()).
    internal const string PageMessageKey = "kosmosBadge";

    // The count to show: a whole number of at least 1, or null for no badge.
    internal static int? Shown(int? count) { return count.HasValue && count.Value >= 1 ? count : null; }

    internal static string Label(int? count)
    {
        int? shown = Shown(count);
        if (shown == null) return null;
        return shown.Value > 9 ? "9+" : shown.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    // What a screen reader says for the taskbar button's badge. An empty description with no icon
    // clears it.
    internal static string Description(int? count)
    {
        int? shown = Shown(count);
        if (shown == null) return "";
        return shown.Value == 1 ? "1 thing waiting for you" : shown.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) + " things waiting for you";
    }

    // A JSON value read as the count: a whole number of at least 1. null, 0, a fraction, a
    // negative, true, a string: no badge, as the Mac app's badgeLabel(fromCount:).
    internal static int? CountFromJsonValue(string raw)
    {
        if (raw == null) return null;
        double d;
        if (!double.TryParse(raw.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d)) return null;
        if (double.IsNaN(d) || double.IsInfinity(d) || d < 1 || d != Math.Floor(d)) return null;
        return d > int.MaxValue ? int.MaxValue : (int)d;
    }

    // Whether a body is the board's status at all (one whole JSON object carrying a `counts`
    // object), and its count. A 200 cut off mid-body does not read, so it is a miss, not an answer;
    // a status with no count (an older board, or the switch off) is an answer, and clears the badge.
    internal static bool ReadsAsStatus(string body, out int? waiting)
    {
        waiting = null;
        string counts = JsonMember(body, "counts");
        if (counts == null || !counts.StartsWith("{", StringComparison.Ordinal)) return false;
        waiting = CountFromJsonValue(JsonMember(counts, "waiting"));
        return true;
    }

    // Whether a page message is the badge's, and its count.
    internal static bool ReadsAsPageMessage(string json, out int? waiting)
    {
        waiting = null;
        string raw = JsonMember(json, PageMessageKey);
        if (raw == null) return false;
        waiting = CountFromJsonValue(raw);
        return true;
    }

    // The raw text of `key`'s value in ONE whole JSON object (nested values skipped), or null when
    // the key is absent or the text is not a single object that closes where it ends. A small
    // reader for the same reason as TopLevelJsonString: no JSON reader in .NET Framework without a
    // reference the pinned build flags do not carry.
    internal static string JsonMember(string json, string key)
    {
        if (json == null) return null;
        string text = json.Trim();
        if (text.Length < 2 || text[0] != '{' || text[text.Length - 1] != '}') return null;
        int depth = 0;
        int valueStart = -1;
        string value = null;
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (c == '"')
            {
                int end;
                string s = KosmosLauncher.ReadJsonString(text, i, out end);
                if (s == null) return null;
                if (depth == 1 && valueStart < 0 && s == key)
                {
                    int j = end + 1;
                    while (j < text.Length && char.IsWhiteSpace(text[j])) j++;
                    if (j < text.Length && text[j] == ':')
                    {
                        j++;
                        while (j < text.Length && char.IsWhiteSpace(text[j])) j++;
                        valueStart = j;
                        i = j - 1;
                        continue;
                    }
                }
                i = end;
                continue;
            }
            if (c == '{' || c == '[') { depth++; continue; }
            if (c == '}' || c == ']')
            {
                depth--;
                if (depth < 0) return null;
                if (depth == 0)
                {
                    if (i != text.Length - 1) return null;
                    if (valueStart >= 0 && value == null) value = text.Substring(valueStart, i - valueStart).Trim();
                }
                continue;
            }
            if (c == ',' && depth == 1 && valueStart >= 0 && value == null) value = text.Substring(valueStart, i - valueStart).Trim();
        }
        return depth == 0 && value != null && value.Length > 0 ? value : null;
    }

    // The board's data folder, where it keeps board.token: engine/store.js dataRootFor's win32 branch,
    // re-derived because this process cannot require the node module (as the Mac app's
    // boardTokenValue does). AGENT_WORKFORCE_DATA wins, then AGENT_WORKFORCE_HOME, then APPDATA.
    // tools.win-taskbar-badge-3996.test.js compares it with dataRootFor itself.
    internal static string BoardDataRoot(Func<string, string> environment, string profile)
    {
        string data = environment("AGENT_WORKFORCE_DATA");
        if (!string.IsNullOrEmpty(data)) return Path.Combine(data, StoreLeaf);
        string home = environment("AGENT_WORKFORCE_HOME");
        if (!string.IsNullOrEmpty(home)) return Path.Combine(Path.Combine(Path.Combine(home, "AppData"), "Roaming"), StoreLeaf);
        string appData = environment("APPDATA");
        if (string.IsNullOrEmpty(appData)) appData = Path.Combine(Path.Combine(profile ?? "", "AppData"), "Roaming");
        return Path.Combine(appData, StoreLeaf);
    }

    // The board token, or null when the board does not enforce one (it writes the file only then).
    // Read on every poll, never kept: it never leaves this process except in the request header.
    internal static string ReadBoardToken()
    {
        string token;
        return ReadBoardTokenState(out token) == TokenOnDisk.Read ? token : null;
    }

    // #6882: the same read, saying WHY there is no token, as tools/kosmos-open-board.js readBoardToken does since
    // #6464: no file (or an empty one) is a board that enforces nothing; a file that is there but cannot be read
    // (EACCES, EBUSY while antivirus holds it, a folder in its place) is an enforcing board this process cannot
    // prove right now: the board window's ReuseCheck.TokenUnreadable (KosmosLauncher.CheckBoardBeforeReuse).
    internal enum TokenOnDisk { None, Unreadable, Read }

    // #6882: whether the board enforces a token: board.token is there, readable or not. The window's fallbacks read it
    // so (ResolveBoardAddress, its background caller, the browser fallback), as tools/kosmos-open-board.js does since
    // #6464: a token that cannot be read proves nothing, so nothing is opened.
    internal static bool BoardTokenOnDisk()
    {
        string token;
        return ReadBoardTokenState(out token) != TokenOnDisk.None;
    }

    internal static TokenOnDisk ReadBoardTokenState(out string token)
    {
        token = null;
        try
        {
            string root = BoardDataRoot(Environment.GetEnvironmentVariable, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
            string read = File.ReadAllText(Path.Combine(root, BoardTokenFileName), Encoding.UTF8).Trim();
            if (read.Length == 0) return TokenOnDisk.None;
            token = read;
            return TokenOnDisk.Read;
        }
        catch (FileNotFoundException) { return TokenOnDisk.None; }
        catch (DirectoryNotFoundException) { return TokenOnDisk.None; }
        catch { return TokenOnDisk.Unreadable; }
    }

    // One read of /api/status. True when the board answered with its status (then `waiting` is its
    // count); false for no answer, a refusal, or a body that does not read as the status.
    internal static bool ReadBoard(int port, out int? waiting)
    {
        waiting = null;
        try
        {
            System.Net.HttpWebRequest request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create("http://127.0.0.1:" + port + "/api/status");
            request.Proxy = null;   // loopback: never the system proxy
            request.Timeout = ReadTimeoutMs;
            request.ReadWriteTimeout = ReadTimeoutMs;
            request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            string token = ReadBoardToken();
            // #1765: the token goes only to a listener that proves it already holds it (BoardProof, above), checked on
            // every poll on purpose: the window outlives board restarts, and another listener can hold the port. Not
            // proven is a miss, like no answer: nothing is sent.
            // The check takes at most half the read's bound, and the read gets what is left, so a poll still ends
            // within ReadTimeoutMs.
            Stopwatch checking = Stopwatch.StartNew();
            if (token != null && !BoardProof.Holds(port, token, ReadTimeoutMs / 2)) return false;
            int left = ReadTimeoutMs - (int)checking.ElapsedMilliseconds;
            if (left <= 0) return false;
            request.Timeout = left;
            request.ReadWriteTimeout = left;
            if (token != null) request.Headers[BoardTokenHeader] = token;
            string body;
            using (System.Net.HttpWebResponse response = (System.Net.HttpWebResponse)request.GetResponse())
            {
                if ((int)response.StatusCode != 200) return false;
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) body = reader.ReadToEnd();
            }
            return ReadsAsStatus(body, out waiting);
        }
        catch { return false; }
    }

    // The overlay's size: the system's small icon size (16 at 100%, 24 at 150%), which is what the
    // taskbar draws an overlay at.
    internal static int IconSize()
    {
        int size = GetSystemMetrics(SM_CXSMICON);
        return size >= 16 ? size : 16;
    }

    // A red circle with the label in white, centred on its drawn shape (not the font's line box), as
    // an HICON the caller destroys (DestroyIcon).
    internal static IntPtr DrawIcon(string label, int size)
    {
        using (System.Drawing.Bitmap bitmap = new System.Drawing.Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
        {
            using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(bitmap))
            using (System.Drawing.SolidBrush red = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(255, 214, 40, 40)))
            using (System.Drawing.Drawing2D.GraphicsPath text = new System.Drawing.Drawing2D.GraphicsPath())
            using (System.Drawing.FontFamily family = new System.Drawing.FontFamily("Segoe UI"))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(System.Drawing.Color.Transparent);
                g.FillEllipse(red, 0f, 0f, size - 0.5f, size - 0.5f);
                float em = size * (label.Length > 1 ? 0.62f : 0.8f);
                text.AddString(label, family, (int)System.Drawing.FontStyle.Bold, em, System.Drawing.PointF.Empty, System.Drawing.StringFormat.GenericTypographic);
                System.Drawing.RectangleF drawn = text.GetBounds();
                using (System.Drawing.Drawing2D.Matrix centre = new System.Drawing.Drawing2D.Matrix())
                {
                    centre.Translate(size / 2f - (drawn.Left + drawn.Width / 2f), size / 2f - (drawn.Top + drawn.Height / 2f));
                    text.Transform(centre);
                }
                g.FillPath(System.Drawing.Brushes.White, text);
            }
            return bitmap.GetHicon();
        }
    }

    const int SM_CXSMICON = 49;

    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool DestroyIcon(IntPtr icon);

    // CLSID_TaskbarList and ITaskbarList3 (shobjidl_core.h), in the order the vtable declares them:
    // ITaskbarList's five, ITaskbarList2's one, then ITaskbarList3's up to SetOverlayIcon. As with
    // WebView2 below, a slot out of order calls the wrong method; the test pins this list.
    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
    internal class TaskbarListObject { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf")]
    internal interface ITaskbarList3
    {
        void HrInit();
        void _unused_AddTab();
        void _unused_DeleteTab();
        void _unused_ActivateTab();
        void _unused_SetActiveAlt();
        void _unused_MarkFullscreenWindow();
        void _unused_SetProgressValue();
        void _unused_SetProgressState();
        void _unused_RegisterTab();
        void _unused_UnregisterTab();
        void _unused_SetTabOrder();
        void _unused_SetTabActive();
        void _unused_ThumbBarAddButtons();
        void _unused_ThumbBarUpdateButtons();
        void _unused_ThumbBarSetImageList();
        void SetOverlayIcon(IntPtr window, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
    }
}

// ---- WebView2's COM interfaces, as WebView2.h (SDK 1.0.4191.47) orders them -----
//
// 🛑 THE ORDER IS THE CONTRACT. COM calls a method by its slot in the interface's table, not by
// name, so each list below runs in the header's order, from the first method to the last one this
// file calls, with an _unused placeholder holding every slot in between. Reordering, removing or
// inserting a line calls a different method. An interface WebView2 has published never changes
// (new methods go on new interfaces), so the order cannot drift under a newer Runtime.

[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int left; public int top; public int right; public int bottom; }

[ComImport, Guid("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler
{
    [PreserveSig] int Invoke(int errorCode, ICoreWebView2Environment createdEnvironment);
}

[ComImport, Guid("6c4819f3-c9b7-4260-8127-c9f5bde7f68c"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2CreateCoreWebView2ControllerCompletedHandler
{
    [PreserveSig] int Invoke(int errorCode, ICoreWebView2Controller createdController);
}

[ComImport, Guid("9adbe429-f36d-432b-9ddc-f8881fbd76e3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NavigationStartingEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2NavigationStartingEventArgs args);
}

[ComImport, Guid("d4c185fe-c81c-4989-97af-2d3fa7ab5651"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NewWindowRequestedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2NewWindowRequestedEventArgs args);
}

[ComImport, Guid("d33a35bf-1c49-4f98-93ab-006e0533fe1c"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NavigationCompletedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2NavigationCompletedEventArgs args);
}

// #5483: a new document has committed (the Mac's didCommit), before its scripts run.
[ComImport, Guid("364471e7-f2be-4910-bdba-d72077d51c4b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2ContentLoadingEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2ContentLoadingEventArgs args);
}

[ComImport, Guid("0c8a1275-9b6b-4901-87ad-70df25bafa6e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2ContentLoadingEventArgs
{
    void get_IsErrorPage(out int isErrorPage);
    void get_NavigationId(out ulong navigationId);
}

[ComImport, Guid("79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2ProcessFailedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2ProcessFailedEventArgs args);
}

// #6882: a reload key (BoardWindowForm.OnAcceleratorKeyPressed). WebView2.h 1.0.4191.47.
[ComImport, Guid("b29c7e28-fa79-41a8-8e44-65811c76dcb2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2AcceleratorKeyPressedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2Controller sender, ICoreWebView2AcceleratorKeyPressedEventArgs args);
}

[ComImport, Guid("9f760f8a-fb79-42be-9990-7b56900fa9c7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2AcceleratorKeyPressedEventArgs
{
    void get_KeyEventKind(out int keyEventKind);
    void get_VirtualKey(out uint virtualKey);
    void get_KeyEventLParam(out int lParam);
    void _unused_get_PhysicalKeyStatus();
    void get_Handled(out int handled);
    void put_Handled(int handled);
}

[ComImport, Guid("57213f19-00e6-49fa-8e07-898ea01ecbd2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2WebMessageReceivedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2WebMessageReceivedEventArgs args);
}

[ComImport, Guid("b96d755e-0319-4e92-a296-23436f46a1fc"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2Environment
{
    void CreateCoreWebView2Controller(IntPtr parentWindow, ICoreWebView2CreateCoreWebView2ControllerCompletedHandler handler);
}

[ComImport, Guid("4d00c0d1-9434-4eb6-8078-8697a560334f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2Controller
{
    void get_IsVisible(out int isVisible);
    void put_IsVisible(int isVisible);
    void get_Bounds(out RECT bounds);
    void put_Bounds(RECT bounds);
    void _unused_get_ZoomFactor();
    void _unused_put_ZoomFactor();
    void _unused_add_ZoomFactorChanged();
    void _unused_remove_ZoomFactorChanged();
    void _unused_SetBoundsAndZoomFactor();
    void MoveFocus(int reason);
    void _unused_add_MoveFocusRequested();
    void _unused_remove_MoveFocusRequested();
    void _unused_add_GotFocus();
    void _unused_remove_GotFocus();
    void _unused_add_LostFocus();
    void _unused_remove_LostFocus();
    void add_AcceleratorKeyPressed(ICoreWebView2AcceleratorKeyPressedEventHandler eventHandler, out long token);   // #6882
    void _unused_remove_AcceleratorKeyPressed();
    void _unused_get_ParentWindow();
    void _unused_put_ParentWindow();
    void NotifyParentWindowPositionChanged();
    void Close();
    void get_CoreWebView2(out ICoreWebView2 coreWebView2);
}

[ComImport, Guid("76eceacb-0462-4d94-ac83-423a6793775e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2
{
    void get_Settings(out ICoreWebView2Settings settings);
    void get_Source([MarshalAs(UnmanagedType.LPWStr)] out string uri);   // #6882: CheckNavigationAgain
    void Navigate([MarshalAs(UnmanagedType.LPWStr)] string uri);
    void NavigateToString([MarshalAs(UnmanagedType.LPWStr)] string htmlContent);
    void add_NavigationStarting(ICoreWebView2NavigationStartingEventHandler eventHandler, out long token);
    void _unused_remove_NavigationStarting();
    void add_ContentLoading(ICoreWebView2ContentLoadingEventHandler eventHandler, out long token);
    void _unused_remove_ContentLoading();
    void _unused_add_SourceChanged();
    void _unused_remove_SourceChanged();
    void _unused_add_HistoryChanged();
    void _unused_remove_HistoryChanged();
    void add_NavigationCompleted(ICoreWebView2NavigationCompletedEventHandler eventHandler, out long token);
    void _unused_remove_NavigationCompleted();
    void _unused_add_FrameNavigationStarting();
    void _unused_remove_FrameNavigationStarting();
    void _unused_add_FrameNavigationCompleted();
    void _unused_remove_FrameNavigationCompleted();
    void _unused_add_ScriptDialogOpening();
    void _unused_remove_ScriptDialogOpening();
    void _unused_add_PermissionRequested();
    void _unused_remove_PermissionRequested();
    void add_ProcessFailed(ICoreWebView2ProcessFailedEventHandler eventHandler, out long token);
    void _unused_remove_ProcessFailed();
    void _unused_AddScriptToExecuteOnDocumentCreated();
    void _unused_RemoveScriptToExecuteOnDocumentCreated();
    void _unused_ExecuteScript();
    void _unused_CapturePreview();
    void Reload();
    void _unused_PostWebMessageAsJson();
    void _unused_PostWebMessageAsString();
    void add_WebMessageReceived(ICoreWebView2WebMessageReceivedEventHandler eventHandler, out long token);
    void _unused_remove_WebMessageReceived();
    void _unused_CallDevToolsProtocolMethod();
    void _unused_get_BrowserProcessId();
    void _unused_get_CanGoBack();
    void _unused_get_CanGoForward();
    void _unused_GoBack();
    void _unused_GoForward();
    void _unused_GetDevToolsProtocolEventReceiver();
    void _unused_Stop();
    void add_NewWindowRequested(ICoreWebView2NewWindowRequestedEventHandler eventHandler, out long token);
}

[ComImport, Guid("e562e4f0-d7fa-43ac-8d71-c05150499f00"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2Settings
{
    void _unused_get_IsScriptEnabled();
    void _unused_put_IsScriptEnabled();
    void _unused_get_IsWebMessageEnabled();
    void _unused_put_IsWebMessageEnabled();
    void _unused_get_AreDefaultScriptDialogsEnabled();
    void _unused_put_AreDefaultScriptDialogsEnabled();
    void _unused_get_IsStatusBarEnabled();
    void put_IsStatusBarEnabled(int isStatusBarEnabled);
}

[ComImport, Guid("5b495469-e119-438a-9b18-7604f25f2e49"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NavigationStartingEventArgs
{
    void get_Uri([MarshalAs(UnmanagedType.LPWStr)] out string uri);
    void get_IsUserInitiated(out int isUserInitiated);
    void get_IsRedirected(out int isRedirected);
    void _unused_get_RequestHeaders();
    void _unused_get_Cancel();
    void put_Cancel(int cancel);
    void get_NavigationId(out ulong navigationId);
}

[ComImport, Guid("34acb11c-fc37-4418-9132-f9c21d1eafb9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NewWindowRequestedEventArgs
{
    void get_Uri([MarshalAs(UnmanagedType.LPWStr)] out string uri);
    void _unused_put_NewWindow();
    void _unused_get_NewWindow();
    void put_Handled(int handled);
}

[ComImport, Guid("30d68b7d-20d9-4752-a9ca-ec8448fbb5c1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NavigationCompletedEventArgs
{
    void get_IsSuccess(out int isSuccess);
    void get_WebErrorStatus(out int webErrorStatus);
    void get_NavigationId(out ulong navigationId);
}

[ComImport, Guid("8155a9a4-1474-4a86-8cae-151b0fa6b8ca"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2ProcessFailedEventArgs
{
    void get_ProcessFailedKind(out int processFailedKind);
}

[ComImport, Guid("0f99a40c-e962-4207-9e92-e3d542eff849"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2WebMessageReceivedEventArgs
{
    void get_Source([MarshalAs(UnmanagedType.LPWStr)] out string source);
    void get_WebMessageAsJson([MarshalAs(UnmanagedType.LPWStr)] out string webMessageAsJson);
}

// ---- #7403: downloads, and a navigation's HTTP status. WebView2.h 1.0.4191.47, line ranges given per interface. ----
//
// ICoreWebView2_4 derives from _3, _2 and ICoreWebView2. A C# [ComImport] interface cannot inherit another's slots,
// so this one restates every slot of all four, in the header's order: ICoreWebView2's 58 (lines 3019-3218), _2's 7
// (5318-5345), _3's 5 (6130-6150), then _4's own (6891-6909) up to add_DownloadStarting, the one this file calls.
// tools.win-launcher-download-say-7403.test.js counts them. Reached by a cast of the window's ICoreWebView2 (a
// QueryInterface), never assumed.
[ComImport, Guid("20d02d59-6df2-42dc-bd06-f98a694b1302"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2_4
{
    // ICoreWebView2 (WebView2.h 3019-3218)
    void _unused_get_Settings();
    void _unused_get_Source();
    void _unused_Navigate();
    void _unused_NavigateToString();
    void _unused_add_NavigationStarting();
    void _unused_remove_NavigationStarting();
    void _unused_add_ContentLoading();
    void _unused_remove_ContentLoading();
    void _unused_add_SourceChanged();
    void _unused_remove_SourceChanged();
    void _unused_add_HistoryChanged();
    void _unused_remove_HistoryChanged();
    void _unused_add_NavigationCompleted();
    void _unused_remove_NavigationCompleted();
    void _unused_add_FrameNavigationStarting();
    void _unused_remove_FrameNavigationStarting();
    void _unused_add_FrameNavigationCompleted();
    void _unused_remove_FrameNavigationCompleted();
    void _unused_add_ScriptDialogOpening();
    void _unused_remove_ScriptDialogOpening();
    void _unused_add_PermissionRequested();
    void _unused_remove_PermissionRequested();
    void _unused_add_ProcessFailed();
    void _unused_remove_ProcessFailed();
    void _unused_AddScriptToExecuteOnDocumentCreated();
    void _unused_RemoveScriptToExecuteOnDocumentCreated();
    void _unused_ExecuteScript();
    void _unused_CapturePreview();
    void _unused_Reload();
    void _unused_PostWebMessageAsJson();
    void _unused_PostWebMessageAsString();
    void _unused_add_WebMessageReceived();
    void _unused_remove_WebMessageReceived();
    void _unused_CallDevToolsProtocolMethod();
    void _unused_get_BrowserProcessId();
    void _unused_get_CanGoBack();
    void _unused_get_CanGoForward();
    void _unused_GoBack();
    void _unused_GoForward();
    void _unused_GetDevToolsProtocolEventReceiver();
    void _unused_Stop();
    void _unused_add_NewWindowRequested();
    void _unused_remove_NewWindowRequested();
    void _unused_add_DocumentTitleChanged();
    void _unused_remove_DocumentTitleChanged();
    void _unused_get_DocumentTitle();
    void _unused_AddHostObjectToScript();
    void _unused_RemoveHostObjectFromScript();
    void _unused_OpenDevToolsWindow();
    void _unused_add_ContainsFullScreenElementChanged();
    void _unused_remove_ContainsFullScreenElementChanged();
    void _unused_get_ContainsFullScreenElement();
    void _unused_add_WebResourceRequested();
    void _unused_remove_WebResourceRequested();
    void _unused_AddWebResourceRequestedFilter();
    void _unused_RemoveWebResourceRequestedFilter();
    void _unused_add_WindowCloseRequested();
    void _unused_remove_WindowCloseRequested();
    // ICoreWebView2_2 (WebView2.h 5318-5345)
    void _unused_add_WebResourceResponseReceived();
    void _unused_remove_WebResourceResponseReceived();
    void _unused_NavigateWithWebResourceRequest();
    void _unused_add_DOMContentLoaded();
    void _unused_remove_DOMContentLoaded();
    void _unused_get_CookieManager();
    void _unused_get_Environment();
    // ICoreWebView2_3 (WebView2.h 6130-6150)
    void _unused_TrySuspend();
    void _unused_Resume();
    void _unused_get_IsSuspended();
    void _unused_SetVirtualHostNameToFolderMapping();
    void _unused_ClearVirtualHostNameToFolderMapping();
    // ICoreWebView2_4 (WebView2.h 6891-6909)
    void _unused_add_FrameCreated();
    void _unused_remove_FrameCreated();
    void add_DownloadStarting(ICoreWebView2DownloadStartingEventHandler eventHandler, out long token);
}

// WebView2.h 7599-7607.
[ComImport, Guid("efedc989-c396-41ca-83f7-07f845a55724"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2DownloadStartingEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2DownloadStartingEventArgs args);
}

// WebView2.h 43885-43913. Only the operation is read: the download is never cancelled, handled or redirected here.
[ComImport, Guid("e99bbe21-43e9-4544-a732-282764eafa60"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2DownloadStartingEventArgs
{
    void get_DownloadOperation(out ICoreWebView2DownloadOperation downloadOperation);
}

// WebView2.h 43345-43406, up to get_InterruptReason.
[ComImport, Guid("3d6b6cf2-afe1-44c7-a995-c65117714336"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2DownloadOperation
{
    void _unused_add_BytesReceivedChanged();
    void _unused_remove_BytesReceivedChanged();
    void _unused_add_EstimatedEndTimeChanged();
    void _unused_remove_EstimatedEndTimeChanged();
    void add_StateChanged(ICoreWebView2StateChangedEventHandler eventHandler, out long token);
    void _unused_remove_StateChanged();
    void get_Uri([MarshalAs(UnmanagedType.LPWStr)] out string uri);
    void _unused_get_ContentDisposition();
    void _unused_get_MimeType();
    void _unused_get_TotalBytesToReceive();
    void _unused_get_BytesReceived();
    void _unused_get_EstimatedEndTime();
    void _unused_get_ResultFilePath();
    void get_State(out int downloadState);
    void get_InterruptReason(out int interruptReason);
}

// WebView2.h 43799-43807. The args are a plain IUnknown (nothing to read).
[ComImport, Guid("81336594-7ede-4ba9-bf71-acf0a95b58dd"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2StateChangedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2DownloadOperation sender, [MarshalAs(UnmanagedType.IUnknown)] object args);
}

// WebView2.h 54722-54729: ICoreWebView2NavigationCompletedEventArgs's three (54616-54629, as declared above), then
// get_HttpStatusCode. Reached by a cast of the args, never assumed.
[ComImport, Guid("fdf8b738-ee1e-4db2-a329-8d7d7b74d792"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NavigationCompletedEventArgs2
{
    void get_IsSuccess(out int isSuccess);
    void get_WebErrorStatus(out int webErrorStatus);
    void get_NavigationId(out ulong navigationId);
    void get_HttpStatusCode(out int httpStatusCode);
}
