package com.vpscontrol.widget;
import android.app.*;
import android.content.*;
import android.os.*;
import android.provider.Settings;
/** One optional non-wakeup alarm shared by every widget; no continuous service. */
public final class FastSync {
 private static final int REQUEST=27103;
 private FastSync(){}
 public static int minutes(Context c){return RefreshPolicy.minutes(Store.setting(c,"interval","15"));}
 public static boolean access(Context c){return Build.VERSION.SDK_INT<31||((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();}
 private static PendingIntent intent(Context c,boolean create){return PendingIntent.getBroadcast(c,REQUEST,new Intent(c,Sync.AlarmReceiver.class).setAction("com.vpscontrol.widget.AUTO_REFRESH").setData(android.net.Uri.parse("vpswidget://local/auto-refresh")),PendingIntent.FLAG_IMMUTABLE|(create?PendingIntent.FLAG_UPDATE_CURRENT:PendingIntent.FLAG_NO_CREATE));}
 public static long due(Context c){try{return Long.parseLong(Store.setting(c,"fast.due","0"));}catch(Exception e){return 0;}}
 public static synchronized void cancel(Context c){PendingIntent p=intent(c,false);if(p!=null){((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).cancel(p);p.cancel();}Store.putSetting(c,"fast.due","0");Store.putSetting(c,"fast.mode","");}
 public static synchronized void schedule(Context c){int minutes=minutes(c);if(!RefreshPolicy.fast(minutes)||Store.session(c)==null||Widgets.installed(c).length==0||!access(c)){cancel(c);return;}long now=SystemClock.elapsedRealtime(),interval=minutes*60000L,at=due(c);if(String.valueOf(minutes).equals(Store.setting(c,"fast.mode",""))&&at>now&&at<=now+interval+1000&&intent(c,false)!=null)return;try{at=now+interval;((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).setExact(AlarmManager.ELAPSED_REALTIME,at,intent(c,true));Store.putSetting(c,"fast.mode",String.valueOf(minutes));Store.putSetting(c,"fast.due",String.valueOf(at));}catch(SecurityException e){cancel(c);}}
 public static void fired(Context c){Store.putSetting(c,"fast.due","0");schedule(c);}
 public static void requestAccess(Context c){if(Build.VERSION.SDK_INT<31)return;try{c.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,android.net.Uri.parse("package:"+c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(ActivityNotFoundException e){c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}}
}
