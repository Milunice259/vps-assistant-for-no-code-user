package com.vpscontrol.widget;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
public final class Gallery extends Activity {
 public static View preview;
 public void onCreate(Bundle b){super.onCreate(b);ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);root.setPadding(18,45,18,30);root.setBackgroundColor(0xFFB8C9D9);root.setOrientation(1);if(preview!=null)root.addView(preview);scroll.addView(root);setContentView(scroll);}
}
