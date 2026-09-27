package io.kosmos.app;

import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;

import androidx.browser.customtabs.CustomTabsCallback;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.QualityEnforcer;

import java.util.concurrent.atomic.AtomicBoolean;

/** Launches the TWA and replaces browser network errors with a Kosmos screen. */
public final class KosmosLauncherActivity extends LauncherActivity {
    private final AtomicBoolean errorShown = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
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
