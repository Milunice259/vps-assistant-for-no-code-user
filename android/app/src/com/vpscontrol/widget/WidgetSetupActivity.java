package com.vpscontrol.widget;
import android.app.*;
import android.appwidget.*;
import android.os.Bundle;
import android.content.*;
import android.widget.*;
import java.util.*;
import org.json.JSONArray;
public final class WidgetSetupActivity extends Activity {
 private int widget;
 public void onCreate(Bundle state){super.onCreate(state);setResult(RESULT_CANCELED);widget=getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
  AppWidgetProviderInfo info=AppWidgetManager.getInstance(this).getAppWidgetInfo(widget);
  if(info==null||!getPackageName().equals(info.provider.getPackageName())){finish();return;}
  final boolean single=info.provider.getClassName().endsWith("$Single");final Snapshot snapshot=Store.snapshot(this);
  if(snapshot==null||snapshot.servers.isEmpty()){new AlertDialog.Builder(this).setMessage(Store.tr(this,"Ghép nối và cập nhật trong ứng dụng trước, sau đó chạm tiêu đề widget để chọn VPS.","Pair and refresh in the app first, then tap the widget title to select servers.")).setPositiveButton(Store.tr(this,"Mở ứng dụng","Open app"),new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int w){save("");startActivity(new Intent(WidgetSetupActivity.this,MainActivity.class));}}).setNegativeButton(Store.tr(this,"Để sau","Later"),new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int w){save("");}}).setOnCancelListener(new DialogInterface.OnCancelListener(){public void onCancel(DialogInterface d){finish();}}).show();return;}
  final String[] labels=new String[snapshot.servers.size()];final boolean[] checked=new boolean[labels.length];List<Snapshot.Server> selected=Widgets.selection(this,widget,snapshot);
  for(int i=0;i<labels.length;i++){labels[i]=snapshot.servers.get(i).name;for(Snapshot.Server s:selected)if(s.id.equals(snapshot.servers.get(i).id))checked[i]=true;}
  AlertDialog.Builder dialog=new AlertDialog.Builder(this).setTitle(Store.tr(this,"Chọn VPS cho widget","Select widget servers"));
  if(single){int current=0;for(int i=0;i<checked.length;i++)if(checked[i]){current=i;break;}for(int i=0;i<checked.length;i++)checked[i]=i==current;
   dialog.setSingleChoiceItems(labels,current,new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int n){Arrays.fill(checked,false);checked[n]=true;}});
  }else dialog.setMultiChoiceItems(labels,checked,new DialogInterface.OnMultiChoiceClickListener(){public void onClick(DialogInterface d,int n,boolean value){checked[n]=value;}});
  dialog.setPositiveButton(Store.tr(this,"Lưu","Save"),null).setNegativeButton(Store.tr(this,"Hủy","Cancel"),new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int w){finish();}}).setOnCancelListener(new DialogInterface.OnCancelListener(){public void onCancel(DialogInterface d){finish();}});
  final AlertDialog shown=dialog.create();shown.setOnShowListener(new DialogInterface.OnShowListener(){public void onShow(DialogInterface d){shown.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new android.view.View.OnClickListener(){public void onClick(android.view.View v){JSONArray ids=new JSONArray();for(int i=0;i<checked.length;i++)if(checked[i])ids.put(snapshot.servers.get(i).id);if(ids.length()==0){Toast.makeText(WidgetSetupActivity.this,Store.tr(WidgetSetupActivity.this,"Chọn ít nhất một VPS.","Select at least one server."),Toast.LENGTH_SHORT).show();return;}save(ids.toString());}});}});shown.show();
 }
 private void save(String selection){Store.putSetting(this,"widget."+widget,selection);Widgets.update(this,AppWidgetManager.getInstance(this),widget);Sync.schedule(this);setResult(RESULT_OK,new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widget));finish();}
}
