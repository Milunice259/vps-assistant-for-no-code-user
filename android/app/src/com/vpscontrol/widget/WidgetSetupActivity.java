package com.vpscontrol.widget;
import android.app.*;
import android.appwidget.*;
import android.os.Bundle;
import android.content.*;
import android.content.res.ColorStateList;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.JSONArray;
public final class WidgetSetupActivity extends Activity {
 private int widget;
 private Visuals colors;
 private int dp(int n){return Visuals.dp(this,n);}
 private TextView label(String text,int size,int color){TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(color);t.setPadding(0,dp(6),0,dp(6));return t;}
 public void onCreate(Bundle state){super.onCreate(state);setResult(RESULT_CANCELED);widget=getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
  AppWidgetProviderInfo info=AppWidgetManager.getInstance(this).getAppWidgetInfo(widget);if(info==null||!getPackageName().equals(info.provider.getPackageName())){finish();return;}
  colors=new Visuals(this);getWindow().setStatusBarColor(colors.bg);getWindow().setNavigationBarColor(colors.bg);getWindow().getDecorView().setSystemUiVisibility(Store.dark(this)?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  final LinearLayout root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(colors.bg);root.setPadding(dp(24),dp(24),dp(24),dp(20));root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener(){public WindowInsets onApplyWindowInsets(View v,WindowInsets i){v.setPadding(dp(24)+i.getSystemWindowInsetLeft(),dp(24)+i.getSystemWindowInsetTop(),dp(24)+i.getSystemWindowInsetRight(),dp(20)+i.getSystemWindowInsetBottom());return i;}});root.addView(label("VPS CONTROL",11,colors.accent));TextView title=label(Store.tr(this,"Widget của anh","Your widget"),28,colors.ink);title.setTypeface(android.graphics.Typeface.create("sans-serif-medium",0));root.addView(title);
  final boolean single=info.provider.getClassName().endsWith("$Single");final Snapshot snapshot=Store.snapshot(this);
  root.addView(label(Store.tr(this,"Chọn máy chủ muốn hiển thị. Một VPS sẽ có đồng hồ tài nguyên riêng.","Choose the servers to display. A single server gets a focused resource view."),14,colors.muted));
  ScrollView scroll=new ScrollView(this);final LinearLayout list=new LinearLayout(this);list.setOrientation(1);list.setPadding(0,dp(20),0,dp(20));scroll.addView(list);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  if(snapshot==null||snapshot.servers.isEmpty()){list.addView(label(Store.tr(this,"Ghép nối và cập nhật trong ứng dụng trước, sau đó chạm tiêu đề widget để chọn VPS.","Pair and refresh in the app first, then tap the widget title to select servers."),16,colors.muted));action(root,Store.tr(this,"Mở ứng dụng","Open app"),new View.OnClickListener(){public void onClick(View v){save("");startActivity(new Intent(WidgetSetupActivity.this,MainActivity.class));}});action(root,Store.tr(this,"Để sau","Later"),new View.OnClickListener(){public void onClick(View v){save("");}});setContentView(root);root.requestApplyInsets();return;}
  final boolean[] checked=new boolean[snapshot.servers.size()];List<Snapshot.Server> selected=Widgets.selection(this,widget,snapshot);int first=0;
  for(int i=0;i<checked.length;i++)for(Snapshot.Server s:selected)if(s.id.equals(snapshot.servers.get(i).id))checked[i]=true;
  if(single){for(int i=0;i<checked.length;i++)if(checked[i]){first=i;break;}Arrays.fill(checked,false);checked[first]=true;}
  final CompoundButton[] options=new CompoundButton[checked.length];
  for(int i=0;i<checked.length;i++){final int index=i;CompoundButton item=single?new RadioButton(this):new CheckBox(this);options[i]=item;item.setText(snapshot.servers.get(i).name);item.setTextSize(16);item.setTextColor(colors.ink);item.setButtonTintList(ColorStateList.valueOf(colors.accent));item.setChecked(checked[i]);item.setPadding(dp(12),dp(14),dp(12),dp(14));item.setBackground(Visuals.shape(colors.surface,dp(16)));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(10);list.addView(item,lp);item.setOnClickListener(new View.OnClickListener(){public void onClick(View v){if(single){Arrays.fill(checked,false);checked[index]=true;for(int n=0;n<options.length;n++)options[n].setChecked(n==index);}else checked[index]=((CompoundButton)v).isChecked();}});}
  action(root,Store.tr(this,"Lưu widget","Save widget"),new View.OnClickListener(){public void onClick(View v){JSONArray ids=new JSONArray();for(int i=0;i<checked.length;i++)if(checked[i])ids.put(snapshot.servers.get(i).id);if(ids.length()==0){Toast.makeText(WidgetSetupActivity.this,Store.tr(WidgetSetupActivity.this,"Chọn ít nhất một VPS.","Select at least one server."),Toast.LENGTH_SHORT).show();return;}save(ids.toString());}});action(root,Store.tr(this,"Hủy","Cancel"),new View.OnClickListener(){public void onClick(View v){finish();}});setContentView(root);root.requestApplyInsets();
 }
 private void action(LinearLayout root,String value,View.OnClickListener listener){TextView t=label(value,16,colors.accent);t.setGravity(Gravity.CENTER);t.setMinHeight(dp(52));t.setBackground(Visuals.shape(colors.inset,dp(16)));t.setOnClickListener(listener);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(10);root.addView(t,lp);}
 private void save(String selection){Store.putSetting(this,"widget."+widget,selection);Widgets.update(this,AppWidgetManager.getInstance(this),widget);Sync.schedule(this);setResult(RESULT_OK,new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widget));finish();}
}
