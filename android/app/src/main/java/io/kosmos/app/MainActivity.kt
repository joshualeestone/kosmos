package io.kosmos.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.kosmos.app.shell.BoardSessionScripts
import io.kosmos.app.shell.BoardWebViewClient
import io.kosmos.app.shell.ShellLoad
import io.kosmos.app.signin.KeystoreSessionStore
import io.kosmos.app.sweep.SweepDots

/**
 * kosmos#8046 slice 1 (hybrid shell): the native entry point. Mirrors iOS ContentView's minimal board host: one
 * WebView, mounted full screen, carrying the app's session into the page at document-start (BoardSessionScripts),
 * with the SweepDots loader over it until the first page settles and a native load-error fallback on failure. The
 * tab chrome, the first native screen (Agents) and the upgrade check layer on top of this in following increments.
 *
 * Compile-verified only; its behaviour (does the native app launch, does the board open signed-in, does the
 * document-start hand-over beat the page's restore()) is device-verified through the signed debug APK handed to Josh.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    BoardApp()
                }
            }
        }
    }
}

@Composable
fun BoardApp() {
    val context = LocalContext.current
    val coordinatorOrigin = remember { "https://" + context.getString(R.string.hostName) }
    val boardUrl = remember { context.getString(R.string.launchUrl) }
    val session = remember { runCatching { KeystoreSessionStore(context).load() }.getOrNull() }

    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<ShellLoad.LoadFailure?>(null) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    androidx.compose.foundation.layout.Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    webView = this
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true // the board keeps its session in localStorage (kosmos#7042)
                    webViewClient = BoardWebViewClient(
                        context = ctx,
                        coordinatorOrigin = coordinatorOrigin,
                        isOnline = { isOnline(ctx) },
                        onLoadFailure = { f, _ -> failure = f; loading = false },
                        onMainFrameFinished = { loading = false },
                    )
                    // Arm the document-start session hand-over BEFORE the first load, so it runs before restore().
                    BoardSessionScripts(this, coordinatorOrigin).apply(session)
                    loadUrl(boardUrl)
                }
            },
        )

        if (loading && failure == null) {
            AndroidView(modifier = Modifier.align(Alignment.Center), factory = { ctx -> SweepDots(ctx) })
        }

        failure?.let { f ->
            BoardErrorPane(
                failure = f,
                onRetry = {
                    failure = null
                    loading = true
                    webView?.reload()
                },
            )
        }
    }
}

/** A minimal native load-error page; the fuller ShellLoad-driven page (retry/back/other-computer) is a later increment. */
@Composable
private fun BoardErrorPane(failure: ShellLoad.LoadFailure, onRetry: () -> Unit) {
    val context = LocalContext.current
    val title = if (failure == ShellLoad.LoadFailure.MAC_UNREACHABLE) ShellLoad.macUnreachableTitle(null)
    else context.getString(R.string.loadErrorTitle)
    val message = if (failure == ShellLoad.LoadFailure.MAC_UNREACHABLE) ShellLoad.macUnreachableMessage(null)
    else context.getString(R.string.loadErrorMessage)

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Text(text = title, style = MaterialTheme.typography.titleLarge)
        Text(text = message, style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onRetry) { Text(context.getString(R.string.loadErrorRetry)) }
    }
}

private fun isOnline(context: Context): Boolean {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
    val network = cm.activeNetwork ?: return false
    val caps = cm.getNetworkCapabilities(network) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
}
