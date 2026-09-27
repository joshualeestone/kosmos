package io.kosmos.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Native recovery screen shown when the TWA cannot load. */
public final class LoadErrorActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_load_error);
        findViewById(R.id.retry).setOnClickListener(view -> retry());
    }

    private void retry() {
        Intent intent = new Intent(this, KosmosLauncherActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
    }
}
