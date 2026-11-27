package com.vpscontrol.widget.poc;

import android.app.Activity;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.graphics.Color;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.TextView;
import android.widget.Toast;

/** Offline proof of concept: no network, credentials, or production access. */
public final class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(32), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(16, 28, 43));
        TextView title = new TextView(this);
        title.setText("VPS Control — Demo");
        title.setTextSize(26);
        title.setTextColor(Color.WHITE);
        root.addView(title);
        TextView info = new TextView(this);
        info.setPadding(0, dp(16), 0, dp(16));
        info.setText("Offline mock data only.\n3 of 4 servers online\nCPU 24% · RAM 62%\nNo production connection.");
        info.setTextColor(Color.rgb(181,197,214));
        info.setTextSize(16);
        root.addView(info);
        Button pin = new Button(this);
        pin.setText("Add home-screen widget");
        pin.setOnClickListener(v -> {
            AppWidgetManager manager = AppWidgetManager.getInstance(this);
            if (manager.isRequestPinAppWidgetSupported()) {
                boolean requested = manager.requestPinAppWidget(new ComponentName(this, FleetWidget.class), null, null);
                if (!requested) showPickerHint();
            } else showPickerHint();
        });
        root.addView(pin, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void showPickerHint() { Toast.makeText(this, "Add VPS Control (Demo) using your launcher widget picker.", Toast.LENGTH_LONG).show(); }

    public static final class FleetWidget extends AppWidgetProvider {
        @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
            for (int id : ids) render(context, manager, id);
        }
        @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
            render(context, manager, id);
        }
        private static void render(Context context, AppWidgetManager manager, int id) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.fleet_widget);
            Intent open = new Intent(context, MainActivity.class);
            PendingIntent tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            views.setOnClickPendingIntent(R.id.root, tap);
            manager.updateAppWidget(id, views);
        }
    }
}
