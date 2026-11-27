package com.vpscontrol.widget;
import android.app.job.*;
import android.content.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
public final class Sync {
 public static final String CHANGED="com.vpscontrol.widget.CHANGED";
 public static final ExecutorService EXECUTOR=Executors.newSingleThreadExecutor();
 private static final List<Runnable> callbacks=new ArrayList<Runnable>();
 private static boolean running;
 private static long lastAttempt;
 private static final int JOB=27101;
 public static synchronized boolean busy(){return running;}
 public static void request(final Context context,Runnable done){
  final Context c=context.getApplicationContext();
  synchronized(Sync.class){
   if(done!=null)callbacks.add(done);
   if(running)return;
   if(android.os.SystemClock.elapsedRealtime()-lastAttempt<10000){complete(c);return;}
   running=true;lastAttempt=android.os.SystemClock.elapsedRealtime();
  }
  changed(c);
  EXECUTOR.execute(new Runnable(){public void run(){
   long generation;
   try{
    Store.Session session;
    synchronized(Store.LOCK){session=Store.session(c);generation=Store.generation();}
    if(session==null)return;
    try{Snapshot data=new Snapshot(Api.call(session.base,"/api/mobile/v1/snapshot",session.token,null));Store.snapshot(c,data,generation);}
    catch(Exception e){String kind=e instanceof Api.Failure?((Api.Failure)e).kind:e instanceof javax.net.ssl.SSLException?"tls":"network";
     synchronized(Store.LOCK){if(Store.generation()==generation){if(kind.equals("auth"))Store.clear(c,"auth");else Store.error(c,kind,generation);}}
    }
   }finally{complete(c);}
  }});
 }
 private static void complete(Context c){List<Runnable> tasks;synchronized(Sync.class){running=false;tasks=new ArrayList<Runnable>(callbacks);callbacks.clear();}Widgets.updateAll(c);changed(c);for(Runnable r:tasks)r.run();}
 public static void changed(Context c){c.sendBroadcast(new Intent(CHANGED).setPackage(c.getPackageName()));}
 public static void schedule(Context c){
  JobScheduler scheduler=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
  if(Store.session(c)==null){scheduler.cancel(JOB);return;}
  long minutes;try{minutes=Long.parseLong(Store.setting(c,"interval","15"));}catch(Exception e){minutes=15;}
  if(minutes!=15&&minutes!=30&&minutes!=60)minutes=15;
  JobInfo current=scheduler.getPendingJob(JOB);long interval=minutes*60000L;
  if(current!=null&&current.getIntervalMillis()==interval)return;
  scheduler.schedule(new JobInfo.Builder(JOB,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(interval).setPersisted(true).build());
 }
 public static final class RefreshJob extends JobService {
  private final AtomicBoolean active=new AtomicBoolean();
  public boolean onStartJob(final JobParameters parameters){active.set(true);request(this,new Runnable(){public void run(){if(active.getAndSet(false))jobFinished(parameters,false);}});return true;}
  public boolean onStopJob(JobParameters parameters){active.set(false);return true;}
 }
 public static final class RefreshReceiver extends BroadcastReceiver {
  public void onReceive(Context c,Intent i){final PendingResult pending=goAsync();request(c,new Runnable(){public void run(){pending.finish();}});}
 }
 public static final class BootReceiver extends BroadcastReceiver {
  public void onReceive(Context c,Intent i){schedule(c);Widgets.updateAll(c);}
 }
}
