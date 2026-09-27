package io.kosmos.app;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsServiceConnection;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.QualityEnforcer;
import com.google.androidbrowserhelper.trusted.TwaProviderPicker;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Launches the TWA and replaces browser network errors with a Kosmos screen.
 *
 * It also puts a fresh HandoffNonce in the fragment of the sign-in page's launch URL (#2854).
 * The nonce is per launch, not per user, so nothing personal is built into the app.
 *
 * A launch URL that already has a fragment is left alone; the page then holds no nonce and opens
 * addresses the ordinary way. A launch URL for any other host or scheme is replaced by the sign-in page,
 * because this activity is exported and must not open another address without the nonce.
 */
public final class KosmosLauncherActivity extends LauncherActivity {

    static final String PREFS = "kosmos";
    static final String PREF_NONCE = "handoffNonce";
    private static final String TAG = "KosmosLauncherActivity";

    private final AtomicBoolean errorShown = new AtomicBoolean(false);
    private CustomTabsServiceConnection warmConnection;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        warmBrowser(savedInstanceState != null);
        super.onCreate(savedInstanceState);
        if (!hasInternetNetwork()) {
            showLoadError();
        }
    }

    @Override
    protected boolean shouldLaunchImmediately() {
        return hasInternetNetwork();
    }

    @Override
    protected CustomTabsCallback getCustomTabsCallback() {
        return new QualityEnforcer() {
            @Override
            public void onNavigationEvent(int navigationEvent, Bundle extras) {
                super.onNavigationEvent(navigationEvent, extras);
                if (navigationEvent == CustomTabsCallback.NAVIGATION_FAILED) {
                    runOnUiThread(KosmosLauncherActivity.this::showLoadError);
                }
            }
        };
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri given = super.getLaunchingUrl();
        String hostName = getString(R.string.hostName);
        Uri url;
        if (given != null && AddressChoice.isSignInUrl(given.getScheme(), given.getHost(), hostName)) {
            // Rebuilt from the configured host, not the caller's string, so Chrome's parser
            // cannot read a different host out of it than android.net.Uri did.
            url = new Uri.Builder().scheme("https").encodedAuthority(hostName)
                    .encodedPath(given.getEncodedPath()).encodedQuery(given.getEncodedQuery())
                    .encodedFragment(given.getEncodedFragment()).build();
        } else {
            if (given != null) Log.w(TAG, "launch URL for another host or scheme replaced by the sign-in page");
            url = Uri.parse(getString(R.string.launchUrl));
        }
        if (url.getFragment() != null) return url;
        String nonce = HandoffNonce.fresh();
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_NONCE, nonce).commit();
        return url.buildUpon().encodedFragment(HandoffNonce.FRAGMENT_KEY + "=" + nonce).build();
    }

    @Override
    protected void onDestroy() {
        if (warmConnection != null) {
            try {
                unbindService(warmConnection);
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "the browser warmup connection was not registered", e);
            }
            warmConnection = null;
        }
        super.onDestroy();
    }

    /**
     * #4109: binds to the browser and warms it up first thing, before LauncherActivity's own launch
     * binds. Skipped when the activity is being recreated, since LauncherActivity then finishes
     * without launching. No mayLaunchUrl: see android/README.md, Browser warmup.
     */
    private void warmBrowser(boolean restored) {
        TwaProviderPicker.Action action = TwaProviderPicker.pickProvider(getPackageManager());
        if (!shouldWarm(restored, hasInternetNetwork(), action.provider, action.launchMode)) return;
        CustomTabsServiceConnection connection = new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(android.content.ComponentName name, CustomTabsClient client) {
                client.warmup(0);
            }

            @Override
            public void onServiceDisconnected(android.content.ComponentName name) {
            }
        };
        try {
            // Kept even when the bind returns false: Android still wants unbindService for it.
            CustomTabsClient.bindCustomTabsService(this, action.provider, connection);
            warmConnection = connection;
        } catch (RuntimeException e) {
            Log.w(TAG, "could not warm the browser; launching without it", e);
        }
    }

    static boolean shouldWarm(boolean restored, boolean online, String provider, int launchMode) {
        return !restored && online && provider != null
                && launchMode != TwaProviderPicker.LaunchMode.BROWSER;
    }

    private boolean hasInternetNetwork() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void showLoadError() {
        if (!errorShown.compareAndSet(false, true) || isFinishing()) return;
        startActivity(new Intent(this, LoadErrorActivity.class));
    }
}
