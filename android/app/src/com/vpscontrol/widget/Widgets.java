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
 public void onDeleted(Context c,int[] ids){for(int id:ids){Store.putSetting(c,"widget."+id,"");WidgetStyle.clear(c,id);}}
 public static void updateAll(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);for(Class<?> type:TYPES)for(int id:m.getAppWidgetIds(new ComponentName(c,type)))update(c,m,id);}
 public static int[] installed(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);List<Integer> ids=new ArrayList<Integer>();for(Class<?> type:TYPES)for(int id:m.getAppWidgetIds(new ComponentName(c,type)))ids.add(id);Collections.sort(ids);int[] result=new int[ids.size()];for(int i=0;i<result.length;i++)result[i]=ids.get(i);return result;}
 static void update(Context c,AppWidgetManager m,int id){
  AppWidgetProviderInfo info=m.getAppWidgetInfo(id);if(info==null)return;
  boolean single=info.provider.getClassName().endsWith("$Single");
  Bundle o=m.getAppWidgetOptions(id);int w=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,140),h=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT,160);
  if(c.getResources().getConfiguration().orientation==2){w=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH,w);h=o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,h);}
  Snapshot snapshot=Store.snapshot(c);
  if(android.os.Build.VERSION.SDK_INT>=31){
   ArrayList<SizeF> offered=o.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
   Map<SizeF,RemoteViews> sizes=new LinkedHashMap<SizeF,RemoteViews>();
   if(offered!=null&&offered.size()<=4)for(SizeF size:offered)if(size.getWidth()>=60&&size.getHeight()>=60&&size.getWidth()<=1000&&size.getHeight()<=1000)sizes.put(size,render(c,id,single,(int)size.getWidth(),(int)size.getHeight(),snapshot));
   if(!sizes.isEmpty())m.updateAppWidget(id,new RemoteViews(sizes));else m.updateAppWidget(id,render(c,id,single,w,h,snapshot));
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
 public static int color(Context c,String state){return new Visuals(c).state(state);}
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
 public static RemoteViews render(Context c,int id,boolean single,int width,int height,Snapshot data){return render(c,id,single,width,height,data,WidgetStyle.load(c,id),selection(c,id,data));}
 public static RemoteViews render(Context c,int id,boolean single,int width,int height,Snapshot data,WidgetStyle style,List<Snapshot.Server> selected){
  RemoteViews v=new RemoteViews(c.getPackageName(),height<125?R.layout.widget_tiny:R.layout.widget);Visuals palette=style.palette(c);boolean compact=height<145,small=width<180;
  int pad=compact||small?10:18;
  v.setImageViewResource(R.id.backdrop,style.dark(c)?R.drawable.card_bg:R.drawable.card_light);v.setInt(R.id.backdrop,"setImageAlpha",style.alpha());
  v.setViewPadding(R.id.body,dp(c,pad),dp(c,compact?7:12),dp(c,pad),dp(c,compact?7:12));
  v.setTextColor(R.id.title,palette.muted);v.setTextColor(R.id.headline,palette.ink);v.setTextColor(R.id.stamp,palette.muted);v.setTextColor(R.id.summary,palette.green);
  v.setTextViewText(R.id.title,small?"VPS":"VPS CONTROL");v.setTextViewTextSize(R.id.headline,android.util.TypedValue.COMPLEX_UNIT_SP,height<125?16:compact||small?18:24);
  v.setTextViewTextSize(R.id.summary,android.util.TypedValue.COMPLEX_UNIT_SP,small?10:12);v.setTextViewTextSize(R.id.stamp,android.util.TypedValue.COMPLEX_UNIT_SP,small?10:11);
  v.setImageViewBitmap(R.id.refresh,Visuals.icon(c,"refresh",palette.accent));v.setImageViewBitmap(R.id.configure,Visuals.icon(c,"settings",palette.accent));v.setOnClickPendingIntent(R.id.configure,activity(c,id,true));v.setContentDescription(R.id.configure,Store.tr(c,"Tùy chỉnh widget","Customize widget"));
  v.setOnClickPendingIntent(R.id.root,activity(c,id,false));v.setOnClickPendingIntent(R.id.title,activity(c,id,true));
  Intent refresh=new Intent(c,Sync.RefreshReceiver.class).setData(android.net.Uri.parse("vpswidget://local/refresh"));v.setOnClickPendingIntent(R.id.refresh,PendingIntent.getBroadcast(c,0,refresh,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT));
  v.setContentDescription(R.id.refresh,Store.tr(c,"Cập nhật","Refresh"));v.setContentDescription(R.id.title,Store.tr(c,"Chọn VPS cho widget","Choose widget servers"));
  List<Snapshot.Server> servers=new ArrayList<Snapshot.Server>(selected);boolean connected=Store.session(c)!=null;
  String status=Store.error(c),stamp=time(c,data==null?0:data.generatedAt)+Store.tr(c," · Đã cập nhật"," · Updated");
  if(!status.isEmpty())stamp=time(c,Store.received(c))+Store.tr(c," · Lưu cũ, lỗi cập nhật"," · Cached, refresh error");
  else if(Sync.busy())stamp=Store.tr(c,"Đang cập nhật…","Refreshing…");
  boolean tiny=height<125;if(tiny){v.setOnClickPendingIntent(R.id.headline,activity(c,id,true));v.setContentDescription(R.id.headline,Store.tr(c,"Chọn VPS cho widget","Choose widget servers"));}v.setViewVisibility(R.id.summary,tiny?View.GONE:View.VISIBLE);
  Double[] focused=null;boolean fleet=false,empty=false;
  v.setViewVisibility(R.id.visual,View.VISIBLE);
  if(!connected||data==null||servers.isEmpty()){
   v.setTextViewText(R.id.headline,!connected?Store.tr(c,"Kết nối VPS","Connect VPS"):Store.tr(c,"Chưa có dữ liệu","No data yet"));
   v.setTextViewText(R.id.summary,!connected?Store.tr(c,"Chạm để ghép nối","Tap to pair"):Store.tr(c,"Chọn VPS hoặc cập nhật","Select servers or refresh"));
   v.setTextColor(R.id.summary,palette.muted);empty=true;
   if(!connected)stamp=Store.tr(c,"Chỉ đọc · Kết nối an toàn","Read only · Secure access");
  }else if(single||servers.size()==1){
   Snapshot.Server s=servers.get(0);String state=s.state(data);boolean online=state.equals("online");
   v.setTextViewText(R.id.headline,s.name);v.setTextViewText(R.id.summary,"● "+stateLabel(c,state));v.setTextColor(R.id.summary,palette.state(state));
   Double[] values=online?new Double[]{s.cpu,s.memory,s.disk}:new Double[]{null,null,null};
   focused=values;v.setContentDescription(R.id.visual,metrics(data,s));
   stamp=time(c,s.observed)+Store.tr(c," · Quan sát"," · Observed")+(!status.isEmpty()?Store.tr(c," · Lưu cũ"," · Cached"):Sync.busy()?Store.tr(c," · Đang cập nhật"," · Refreshing"):"");
   if(tiny){stamp=time(c,s.observed)+" · "+stateLabel(c,state)+(!status.isEmpty()?Store.tr(c," · Lưu cũ"," · Cached"):"");v.setTextColor(R.id.stamp,palette.state(state));}
  }else{
   int online=0,down=0,other=0;for(Snapshot.Server s:servers){String state=s.state(data);if(state.equals("online"))online++;else if(state.equals("offline"))down++;else other++;}
   v.setTextViewText(R.id.headline,online+" / "+servers.size()+Store.tr(c," trực tuyến"," online"));
   v.setTextViewText(R.id.summary,down+Store.tr(c," mất kết nối · "," unreachable · ")+other+Store.tr(c," cần kiểm tra"," to review"));v.setTextColor(R.id.summary,down>0?palette.red:other>0?palette.amber:palette.muted);
   fleet=true;StringBuilder description=new StringBuilder();for(Snapshot.Server s:servers)description.append(s.name).append(": ").append(stateLabel(c,s.state(data))).append(", ").append(metrics(data,s)).append(". ");v.setContentDescription(R.id.visual,description.toString());
  }
  v.setTextViewText(R.id.stamp,stamp);
  if(focused!=null||fleet||empty){
   // Measure the same native layout first: font scale and actual launcher bounds determine the chart area.
   View measured=v.apply(c,new android.widget.FrameLayout(c));measured.measure(View.MeasureSpec.makeMeasureSpec(dp(c,width),View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(dp(c,height),View.MeasureSpec.EXACTLY));measured.layout(0,0,measured.getMeasuredWidth(),measured.getMeasuredHeight());
   View visual=measured.findViewById(R.id.visual);float density=c.getResources().getDisplayMetrics().density;
   int bodyW=Math.max(1,Math.round((visual.getMeasuredWidth()-visual.getPaddingLeft()-visual.getPaddingRight())/density));int bodyH=Math.max(1,Math.round((visual.getMeasuredHeight()-visual.getPaddingTop()-visual.getPaddingBottom())/density));
   v.setImageViewBitmap(R.id.visual,focused!=null?Visuals.metrics(c,bodyW,bodyH,focused,style):fleet?Visuals.fleet(c,bodyW,bodyH,servers,data,style):Visuals.placeholder(c,bodyW,bodyH,style));
  }
  return v;
 }
 private static int dp(Context c,int value){return Math.round(value*c.getResources().getDisplayMetrics().density);}
 static PendingIntent browser(Context c,int code,String id){
  Store.Session s=Store.session(c);if(s==null)return activity(c,code,false);
  String path=id.equals("local")?"/":"/servers/"+android.net.Uri.encode(id);
  Intent open=new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(s.base+path));return PendingIntent.getActivity(c,code,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
 }
}
