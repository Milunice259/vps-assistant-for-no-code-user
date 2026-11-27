package com.vpscontrol.widget;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.graphics.Color;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import java.text.*;
import java.util.*;
import org.json.JSONArray;
public class Widgets extends AppWidgetProvider {
 public static final class Fleet extends Widgets {}
 public static final class Single extends Widgets {}
 public static final class Wide extends Widgets {}
 public static final class Large extends Widgets {}
 private static final Class<?>[] TYPES={Fleet.class,Single.class,Wide.class,Large.class};
 public void onUpdate(Context c,AppWidgetManager m,int[] ids){for(int id:ids)update(c,m,id);Sync.schedule(c);Sync.request(c,null);}
 public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options){update(c,m,id);}
 public void onDeleted(Context c,int[] ids){for(int id:ids)Store.putSetting(c,"widget."+id,"");}
 public static void updateAll(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);for(Class<?> type:TYPES)for(int id:m.getAppWidgetIds(new ComponentName(c,type)))update(c,m,id);}
 static void update(Context c,AppWidgetManager m,int id){
  AppWidgetProviderInfo info=m.getAppWidgetInfo(id);if(info==null)return;
  boolean single=info.provider.getClassName().endsWith("$Single");
  Bundle o=m.getAppWidgetOptions(id);int w=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,140),h=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,160);
  if(c.getResources().getConfiguration().orientation==2){w=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,w);h=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,h);}
  Snapshot snapshot=Store.snapshot(c);
  if(android.os.Build.VERSION.SDK_INT>=31){
   Map<SizeF,RemoteViews> sizes=new LinkedHashMap<SizeF,RemoteViews>();
   for(int[] size:new int[][]{{110,110},{160,160},{250,110},{250,180},{250,250},{350,350}})sizes.put(new SizeF(size[0],size[1]),render(c,id,single,size[0],size[1],snapshot));
   m.updateAppWidget(id,new RemoteViews(sizes));
  }else m.updateAppWidget(id,render(c,id,single,w,h,snapshot));
 }
 public static String time(Context c,long value){return value<=0?"—":DateFormat.getTimeInstance(DateFormat.SHORT,Store.vi(c)?Locale.forLanguageTag("vi-VN"):Locale.ENGLISH).format(new Date(value));}
 public static String stateLabel(Context c,String state){
  if(state.equals("online"))return Store.tr(c,"Có kết nối","Online");
  if(state.equals("offline"))return Store.tr(c,"Không truy cập được","Unreachable");
  if(state.equals("stale"))return Store.tr(c,"Dữ liệu cũ","Stale");
  if(state.equals("disabled"))return Store.tr(c,"Đã tắt giám sát","Disabled");
  return Store.tr(c,"Chưa xác định","Unknown");
 }
 public static int color(Context c,String state){if(!Store.dark(c))return state.equals("online")?0xFF087D62:state.equals("offline")?0xFFBD2942:0xFF965E00;return state.equals("online")?0xFF36D6AE:state.equals("offline")?0xFFFF8187:0xFFF2BD61;}
 public static String percent(Double value){return value==null?"—":String.format(Locale.ROOT,"%.0f%%",value);}
 public static String metrics(Snapshot data,Snapshot.Server s){boolean online=s.state(data).equals("online");return "CPU "+percent(online?s.cpu:null)+" · RAM "+percent(online?s.memory:null)+" · Disk "+percent(online?s.disk:null);}
 public static List<Snapshot.Server> selection(Context c,int id,Snapshot data){
  List<Snapshot.Server> result=new ArrayList<Snapshot.Server>();if(data==null)return result;
  String saved=Store.setting(c,"widget."+id,"");
  if(saved.isEmpty())return new ArrayList<Snapshot.Server>(data.servers);
  try{JSONArray a=new JSONArray(saved);for(int i=0;i<a.length();i++){Snapshot.Server s=data.find(a.getString(i));if(s!=null)result.add(s);}}catch(Exception ignored){}
  return result;
 }
 static PendingIntent activity(Context c,int id,boolean setup){Intent i=new Intent(c,setup?WidgetSetupActivity.class:MainActivity.class).setData(android.net.Uri.parse("vpswidget://local/"+id+(setup?"/setup":"/overview"))).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);return PendingIntent.getActivity(c,id+(setup?10000:0),i,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);}
 public static RemoteViews render(Context c,int id,boolean single,int width,int height,Snapshot data){
  boolean wide=!single&&width>=230&&height<230,compact=height<140;
  RemoteViews v=new RemoteViews(c.getPackageName(),wide?R.layout.widget_wide:R.layout.widget);boolean dark=Store.dark(c);int ink=dark?0xFFF1F6FB:0xFF142C40,muted=dark?0xFFA6B8CA:0xFF566A7D;
  v.setInt(R.id.root,"setBackgroundResource",dark?R.drawable.card_bg:R.drawable.card_light);
  for(int t:new int[]{R.id.title,R.id.stamp})v.setTextColor(t,muted);
  v.setTextColor(R.id.summary,ink);v.setTextColor(R.id.refresh,ink);
  v.setOnClickPendingIntent(R.id.root,activity(c,id,false));v.setOnClickPendingIntent(R.id.title,activity(c,id,true));
  Intent refresh=new Intent(c,Sync.RefreshReceiver.class).setData(android.net.Uri.parse("vpswidget://local/refresh"));v.setOnClickPendingIntent(R.id.refresh,PendingIntent.getBroadcast(c,0,refresh,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT));
  v.setInt(R.id.refresh,"setHeight",dp(c,compact?22:wide?28:36));v.setTextViewTextSize(R.id.refresh,android.util.TypedValue.COMPLEX_UNIT_SP,height<140?20:26);v.setInt(R.id.stamp,"setMaxLines",height<140?1:2);
  v.setContentDescription(R.id.refresh,Store.tr(c,"Cập nhật","Refresh"));
  v.setTextViewTextSize(R.id.headline,android.util.TypedValue.COMPLEX_UNIT_SP,compact?24:wide?28:32);v.setTextViewTextSize(R.id.summary,android.util.TypedValue.COMPLEX_UNIT_SP,compact?10:wide?10:12);v.setTextViewTextSize(R.id.stamp,android.util.TypedValue.COMPLEX_UNIT_SP,compact?9:10);v.setInt(R.id.summary,"setMaxLines",compact?1:wide?3:2);
  v.setViewPadding(R.id.root,dp(c,10),dp(c,height<140?4:10),dp(c,10),dp(c,height<140?4:10));
  v.setViewVisibility(R.id.rows,compact&&!wide?View.GONE:View.VISIBLE);
  v.removeAllViews(R.id.rows);if(!wide)v.setViewVisibility(R.id.bars,View.GONE);
  List<Snapshot.Server> servers=selection(c,id,data);boolean connected=Store.session(c)!=null;
  v.setTextViewText(R.id.title,compact?"VPS":"VPS CONTROL");
  String status=Store.error(c);String stamp=time(c,data==null?0:data.generatedAt)+Store.tr(c," · Quan sát"," · Observed");
  if(!status.isEmpty())stamp=time(c,Store.received(c))+(compact?Store.tr(c," · Lưu cũ"," · Cached"):Store.tr(c," · Lỗi cập nhật, lưu cũ"," · Refresh error, cached"));
  else if(Sync.busy())stamp=time(c,data==null?0:data.generatedAt)+Store.tr(c," · Đang cập nhật…"," · Refreshing…");
  if(!connected){v.setTextViewText(R.id.headline,Store.tr(c,"Kết nối","Connect"));v.setTextColor(R.id.headline,muted);v.setTextViewText(R.id.summary,Store.tr(c,"Mở ứng dụng để ghép nối","Open app to pair"));stamp=Store.tr(c,"Chỉ đọc · HTTPS","Read only · HTTPS");}
  else if(data==null){v.setTextViewText(R.id.headline,"—");v.setTextColor(R.id.headline,muted);v.setTextViewText(R.id.summary,Store.tr(c,"Chưa có dữ liệu","No data yet"));}
  else if(single){
   Snapshot.Server s=servers.isEmpty()?null:servers.get(0);
   if(s==null){v.setTextViewText(R.id.headline,"—");v.setTextViewText(R.id.summary,Store.tr(c,"Chạm tiêu đề để chọn VPS","Tap title to select VPS"));}
   else{String state=s.state(data);v.setTextViewText(R.id.title,s.name);v.setTextViewText(R.id.headline,stateLabel(c,state));v.setTextViewTextSize(R.id.headline,android.util.TypedValue.COMPLEX_UNIT_SP,compact?14:width<200?17:height>250?30:24);v.setTextColor(R.id.headline,color(c,state));v.setTextViewText(R.id.summary,"CPU "+percent(state.equals("online")?s.cpu:null)+" · RAM "+percent(state.equals("online")?s.memory:null)+"\nDisk "+percent(state.equals("online")?s.disk:null));if(height>=200&&state.equals("online")){v.setViewVisibility(R.id.bars,View.VISIBLE);int[] bars={R.id.cpu_bar,R.id.ram_bar,R.id.disk_bar};Double[] values={s.cpu,s.memory,s.disk};for(int i=0;i<bars.length;i++){v.setViewVisibility(bars[i],values[i]==null?View.GONE:View.VISIBLE);if(values[i]!=null)v.setProgressBar(bars[i],100,(int)Math.round(values[i]),false);}}stamp=time(c,s.observed)+Store.tr(c," · Quan sát"," · Observed")+(status.isEmpty()?"":Store.tr(c," · lỗi cập nhật"," · refresh error"));}
  }else{
   int online=0,offline=0,other=0;for(Snapshot.Server s:servers){String st=s.state(data);if(st.equals("online"))online++;else if(st.equals("offline"))offline++;else other++;}
   v.setTextViewText(R.id.headline,online+"/"+servers.size());v.setTextColor(R.id.headline,other+offline==0&&online>0?color(c,"online"):color(c,"unknown"));
   v.setTextViewText(R.id.summary,compact?offline+Store.tr(c," lỗi · "," down · ")+other+Store.tr(c," khác"," other"):wide?Store.tr(c,"Có kết nối\n","Online\n")+offline+Store.tr(c," lỗi · "," down · ")+other+Store.tr(c," khác"," other"):Store.tr(c,"Có kết nối","Online")+" · "+offline+Store.tr(c," lỗi · "," down · ")+other+Store.tr(c," khác"," other"));
   int rows=Policy.rows(width,height,false),show=Math.min(rows,servers.size());
   if(show<servers.size()&&rows>0)show=Math.max(1,show-1);
   for(int n=0;n<show;n++){
    Snapshot.Server s=servers.get(n);String state=s.state(data);RemoteViews row=new RemoteViews(c.getPackageName(),wide?R.layout.widget_row_compact:R.layout.widget_row);
    row.setTextViewText(R.id.row_name,s.name+" · "+stateLabel(c,state));row.setTextColor(R.id.row_name,color(c,state));row.setTextViewText(R.id.row_metrics,metrics(data,s));row.setTextColor(R.id.row_metrics,muted);
    row.setOnClickPendingIntent(R.id.row_root,browser(c,id*100+n,s.id));v.addView(R.id.rows,row);
   }
   if(show<servers.size()&&rows>0){RemoteViews row=new RemoteViews(c.getPackageName(),wide?R.layout.widget_row_compact:R.layout.widget_row);row.setTextViewText(R.id.row_name,"+"+(servers.size()-show)+Store.tr(c," VPS · mở ứng dụng"," servers · open app"));row.setTextColor(R.id.row_name,ink);row.setViewVisibility(R.id.row_metrics,View.GONE);v.addView(R.id.rows,row);}
  }
  v.setTextViewText(R.id.stamp,stamp);return v;
 }
 private static int dp(Context c,int value){return Math.round(value*c.getResources().getDisplayMetrics().density);}
 static PendingIntent browser(Context c,int code,String id){
  Store.Session s=Store.session(c);if(s==null)return activity(c,code,false);
  String path=id.equals("local")?"/":"/servers/"+android.net.Uri.encode(id);
  Intent open=new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(s.base+path));return PendingIntent.getActivity(c,code,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
 }
}
