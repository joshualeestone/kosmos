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
    // window (#1118); 5 installs itself without asking (#3286).
    public const string LauncherVersion = "5.0.0.0";
    // Explorer's "Product version". Worded so nobody reads it as the Kosmos
    // version, which lives in manifest.json and on the board.
    public const string LauncherProductVersion = "launcher 5.0";

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

        // The opener waits for the board itself and falls back to the plain url,
        // so it is safe to start BEFORE the server is listening -- that is the
        // #2031 design and the .cmd relied on it too.
        // #1118: a person at a desktop gets the board in Kosmos's own window (RunBoardWindow),
        // which uses the same opener to sign in and falls back to the browser when this PC
        // cannot host the window. With nobody at the desktop there is no window to show, so the
        // opener runs as it always did. Both wait on open-board.js: a folder without it (a
        // partial extract, or a test's scratch folder) starts neither.
        string browserProblem = null;
        if (File.Exists(opener))
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
        if (p.ExitCode != 0 && !stoppedByPerson)
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
                if (result != NO_ERROR || table == IntPtr.Zero) return ListenerAnswer.CouldNotRead;
                int rows = Marshal.ReadInt32(table);
                for (int row = 0; row < rows; row++)
                {
                    if (Marshal.ReadInt32(table, TCP_TABLE_ROWS_OFFSET + row * rowBytes + owningPidOffset) == processId) return ListenerAnswer.Listening;
                }
                return ListenerAnswer.NotListening;
            }
            finally
            {
                if (table != IntPtr.Zero) Marshal.FreeHGlobal(table);
            }
        }
        return ListenerAnswer.CouldNotRead;
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

    // 🛑 EMPTY UNTIL JOSH NAMES IT. Settings > Apps shows a Publisher, and it has to be the
    // legal company name on the code-signing certificate -- the same name AssemblyCompany
    // waits for. A guessed name would contradict the signature once it lands. Written only
    // when non-empty; a stale value is deleted while it is empty.
    internal const string PublisherLegalName = "";

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
    static string ReadJsonString(string json, int start, out int end)
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
    // answers the nonce with its persistent cookie, which the window's own web profile keeps
    // (%LOCALAPPDATA%\Kosmos\WebView2), so a reload stays signed in.
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
                }
            }
            finally { onlyWindow.ReleaseMutex(); }
        }

        if (fallbackProblem != null) return OpenInBrowserInstead(here, node, opener, app, port, fallbackProblem, noRuntime);
        if (stoppedWorking) ShowMessageBox(WindowStoppedMessage, true);
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
        BoardWindowForm form = new BoardWindowForm(port, loader, WebView2UserDataFolder(),
            () => ResolveBoardAddress(here, node, opener, app, port));
        // The handle first: a board that is already up answers in a moment, and BeginInvoke on a
        // form with no handle yet throws, which would drop the address on the floor.
        IntPtr formExists = form.Handle;
        Thread resolve = new Thread(() =>
        {
            string resolved = ResolveBoardAddress(here, node, opener, app, port);
            try { form.BeginInvoke(new Action(() => form.BoardAddressResolved(resolved))); }
            catch { /* the window closed before the board answered */ }
        });
        resolve.IsBackground = true;
        resolve.Start();
        System.Windows.Forms.Application.Run(form);
        return form;
    }

    // The address to open, from open-board.js --print-url: the board's own address, with a boot
    // nonce on an enforcing board. Anything else it prints, or a failure to run it, is the plain
    // address, which is what the browser path falls back to as well.
    static string ResolveBoardAddress(string here, string node, string opener, string app, int port)
    {
        string plain = "http://127.0.0.1:" + port;
        try
        {
            using (Process p = Process.Start(OpenerStartInfo(here, node, opener, app, port, true)))
            {
                string said = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                foreach (string line in said.Split('\n'))
                {
                    string candidate = line.Trim();
                    if (candidate == plain || candidate.StartsWith(plain + "/", StringComparison.Ordinal)) return candidate;
                }
            }
        }
        catch { /* the plain address, below */ }
        return plain;
    }

    // What a double-click did before the window existed: the opener opens the board in the
    // default browser. Then the box that says why, because a browser tab where a window was
    // expected would otherwise look like a fault.
    static int OpenInBrowserInstead(string here, string node, string opener, string app, int port, string why, bool noRuntime)
    {
        string opened = null;
        try { using (Process.Start(OpenerStartInfo(here, node, opener, app, port, false))) { } }
        catch (Exception e) { opened = e.Message; }
        string detail = "\n\n(" + why + ")";
        if (opened != null)
        {
            ShowMessageBox("Kosmos could not open your browser (" + opened + ").\n\nOpen http://127.0.0.1:" + port + " in your browser yourself." + detail, true);
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
        if (!IsWebAddress(address))
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

    // Set when this PC could not host the window after all: RunBoardWindow then opens the browser.
    internal string RuntimeProblem;
    // Set when WebView2's browser process ended under an open window: RunBoardWindow says so.
    internal bool StoppedWorking;

    internal BoardWindowForm(int port, IntPtr loader, string userDataFolder, Func<string> resolveBoardAddress)
    {
        this.port = port;
        this.resolveBoardAddress = resolveBoardAddress;
        this.loader = loader;
        this.userDataFolder = userDataFolder;
        string name = "Kosmos.BoardWindow." + port;
        showMessage = KosmosLauncher.RegisterWindowMessage(name + ".Show");
        closeMessage = KosmosLauncher.RegisterWindowMessage(name + ".Close");

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
        FitViewToWindow();
        controller.MoveFocus(0);
        if (boardAddress != null) NavigateToBoard();
        else webView.NavigateToString(KosmosLauncher.StartingPage);
    }

    // The address open-board.js named, once it has; whichever of it and the view is ready last navigates.
    internal void BoardAddressResolved(string address)
    {
        boardAddress = address;
        if (webView != null) NavigateToBoard();
    }

    // Opening Kosmos.exe again is how a person signs back in (the zip's READ ME says so), so it has
    // to work on an open window too, as the Mac app's Reload does (loadBoard mints a fresh signed-in
    // address every time). A window that came up signed out -- the opener gave up on a slow first
    // run, the nonce could not be minted, or the cookie is for another Kosmos -- is otherwise stuck:
    // F5 reloads the same unsigned page. So the window asks open-board.js for a fresh address, off
    // this thread, and loads it. Only a signed-in (?boot=) answer is loaded: the plain address would
    // only throw away what the page shows and sign nobody in. The nonce travels as it did the first
    // time, over the private pipe, never a command line.
    // ⚠️ Accepted cost: the page reloads to the board's front page, so text typed and not yet sent
    // is lost. That is what the Mac's Reload does too, and the person asked for Kosmos again.
    internal void SignInAgain()
    {
        if (!navigatedToBoard || signingInAgain || resolveBoardAddress == null) return;
        signingInAgain = true;
        Thread resolve = new Thread(() =>
        {
            string fresh = null;
            try { fresh = resolveBoardAddress(); } catch { /* nothing to load */ }
            try
            {
                BeginInvoke(new Action(() =>
                {
                    signingInAgain = false;
                    if (fresh != null && fresh.Contains("?boot=") && webView != null) webView.Navigate(fresh);
                }));
            }
            catch { /* the window closed meanwhile */ }
        });
        resolve.IsBackground = true;
        resolve.Start();
    }

    void NavigateToBoard()
    {
        if (navigatedToBoard) return;
        navigatedToBoard = true;
        webView.Navigate(boardAddress);
    }

    // Before anything was shown, a failure means this PC cannot host the window: close, and
    // RunBoardWindow opens the browser instead.
    void CouldNotHost(string problem)
    {
        if (controller != null) return;
        RuntimeProblem = problem;
        BeginInvoke(new Action(Close));
    }

    // A navigation of the whole window away from the board (a plain link to another site) goes to
    // the person's browser instead: this window has no address bar and no Back button to return by.
    // Any other scheme (mailto:, ms-settings:, search-ms:, file:) is refused with the same box as a
    // new-window link (review of #3285): left alone it reaches WebView2's own "open this app?"
    // prompt. The window's own pages stay: the board, and the about:/data: page NavigateToString
    // shows while the board starts.
    internal void OnNavigationStarting(ICoreWebView2NavigationStartingEventArgs args)
    {
        string uri;
        args.get_Uri(out uri);
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
        if (KosmosLauncher.IsBoardAddress(uri, port)) BeginInvoke(new Action(() => webView.Navigate(uri)));
        else BeginInvoke(new Action(() => KosmosLauncher.OpenInPersonsBrowser(uri)));
    }

    const int COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED = 0;
    const int COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED = 1;
    const int COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE = 2;

    // A page that crashed or hung is loaded again. A browser process that ended leaves nothing to
    // load it in, so the window closes and says so, rather than sitting blank.
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
            BeginInvoke(new Action(() => { try { webView.Reload(); } catch { /* F5 is still there */ } }));
        }
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
            bounds.left = client.Left; bounds.top = client.Top; bounds.right = client.Right; bounds.bottom = client.Bottom;
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
        base.WndProc(ref m);
    }

    protected override void OnFormClosed(System.Windows.Forms.FormClosedEventArgs e)
    {
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

[ComImport, Guid("79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2ProcessFailedEventHandler
{
    [PreserveSig] int Invoke(ICoreWebView2 sender, ICoreWebView2ProcessFailedEventArgs args);
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
    void _unused_add_AcceleratorKeyPressed();
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
    void _unused_get_Source();
    void Navigate([MarshalAs(UnmanagedType.LPWStr)] string uri);
    void NavigateToString([MarshalAs(UnmanagedType.LPWStr)] string htmlContent);
    void add_NavigationStarting(ICoreWebView2NavigationStartingEventHandler eventHandler, out long token);
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
    void add_ProcessFailed(ICoreWebView2ProcessFailedEventHandler eventHandler, out long token);
    void _unused_remove_ProcessFailed();
    void _unused_AddScriptToExecuteOnDocumentCreated();
    void _unused_RemoveScriptToExecuteOnDocumentCreated();
    void _unused_ExecuteScript();
    void _unused_CapturePreview();
    void Reload();
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
    void _unused_get_IsUserInitiated();
    void _unused_get_IsRedirected();
    void _unused_get_RequestHeaders();
    void _unused_get_Cancel();
    void put_Cancel(int cancel);
}

[ComImport, Guid("34acb11c-fc37-4418-9132-f9c21d1eafb9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2NewWindowRequestedEventArgs
{
    void get_Uri([MarshalAs(UnmanagedType.LPWStr)] out string uri);
    void _unused_put_NewWindow();
    void _unused_get_NewWindow();
    void put_Handled(int handled);
}

[ComImport, Guid("8155a9a4-1474-4a86-8cae-151b0fa6b8ca"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICoreWebView2ProcessFailedEventArgs
{
    void get_ProcessFailedKind(out int processFailedKind);
}
