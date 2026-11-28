package com.vpscontrol.widget;
import android.app.job.*;
import android.os.*;
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
 private static final int JOB=27101, STALE_JOB=27102;
 public static synchronized boolean busy(){return running;}
 public static void request(final Context context,Runnable done){
  final Context c=context.getApplicationContext();
  synchronized(Sync.class){
   if(done!=null)callbacks.add(done);
   if(running)return;
   if(lastAttempt>0&&android.os.SystemClock.elapsedRealtime()-lastAttempt<10000){complete(c);return;}
   running=true;lastAttempt=android.os.SystemClock.elapsedRealtime();
  }
  changed(c);
  EXECUTOR.execute(new Runnable(){public void run(){
   long generation;
   try{
    Store.Session session;
    synchronized(Store.LOCK){session=Store.session(c);generation=Store.generation();}
    if(session==null)return;
    try{Snapshot data=new Snapshot(Api.call(session.base,"/api/mobile/v1/snapshot",session.token,null));Store.snapshot(c,data,generation);scheduleStale(c,data);}
    catch(Exception e){String kind=e instanceof Api.Failure?((Api.Failure)e).kind:e instanceof javax.net.ssl.SSLException?"tls":"network";
     synchronized(Store.LOCK){if(Store.generation()==generation){if(kind.equals("auth"))Store.clear(c,"auth");else Store.error(c,kind,generation);}}
    }
   }finally{complete(c);}
  }});
 }
 private static void complete(Context c){List<Runnable> tasks;synchronized(Sync.class){running=false;tasks=new ArrayList<Runnable>(callbacks);callbacks.clear();}schedule(c);Widgets.updateAll(c);changed(c);for(Runnable r:tasks)r.run();}
 public static void changed(Context c){c.sendBroadcast(new Intent(CHANGED).setPackage(c.getPackageName()));}
 public static void schedule(Context c){
  JobScheduler scheduler=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
  if(Store.session(c)==null){scheduler.cancel(JOB);scheduler.cancel(STALE_JOB);FastSync.cancel(c);return;}
  int minutes=FastSync.minutes(c);FastSync.schedule(c);
  JobInfo current=scheduler.getPendingJob(JOB);long interval=RefreshPolicy.periodic(minutes);
  if(current==null||current.getIntervalMillis()!=interval)scheduler.schedule(new JobInfo.Builder(JOB,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(interval).setPersisted(true).build());

 }
 private static void scheduleStale(Context c,Snapshot data){
  long next=Long.MAX_VALUE,now=System.currentTimeMillis();
  for(Snapshot.Server server:data.servers){String state=server.displayState(data);long deadline=server.observed+(state.equals("online")?Policy.staleAfter(data.interval):state.equals("cached")?86400000L:0)-now+1000;if((state.equals("online")||state.equals("cached"))&&deadline>0)next=Math.min(next,deadline);}
  JobScheduler scheduler=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);scheduler.cancel(STALE_JOB);
  if(next!=Long.MAX_VALUE)scheduler.schedule(new JobInfo.Builder(STALE_JOB,new ComponentName(c,RefreshJob.class)).setMinimumLatency(next).build());
 }
 public static final class RefreshJob extends JobService {
  private final AtomicBoolean active=new AtomicBoolean();
  public boolean onStartJob(final JobParameters parameters){if(parameters.getJobId()==STALE_JOB){Widgets.updateAll(this);final Context c=getApplicationContext();new Handler(Looper.getMainLooper()).post(new Runnable(){public void run(){Snapshot data=Store.snapshot(c);if(data!=null)scheduleStale(c,data);}});return false;}active.set(true);request(this,new Runnable(){public void run(){if(active.getAndSet(false))jobFinished(parameters,false);}});return true;}
  public boolean onStopJob(JobParameters parameters){active.set(false);return true;}
 }
 private static abstract class BoundedReceiver extends BroadcastReceiver {
  final void receive(Context c){final PendingResult pending=goAsync();final AtomicBoolean finished=new AtomicBoolean();final Handler handler=new Handler(Looper.getMainLooper());final Runnable done=new Runnable(){public void run(){if(finished.compareAndSet(false,true)){handler.removeCallbacks(this);pending.finish();}}};handler.postDelayed(done,9000);try{request(c,done);}catch(RuntimeException e){done.run();throw e;}}
 }
 public static final class RefreshReceiver extends BoundedReceiver {public void onReceive(Context c,Intent i){receive(c);}}
 public static final class AlarmReceiver extends BoundedReceiver {public void onReceive(Context c,Intent i){FastSync.fired(c);if(Store.session(c)!=null&&RefreshPolicy.fast(FastSync.minutes(c))&&FastSync.access(c)&&Widgets.installed(c).length>0)receive(c);}}
 public static final class BootReceiver extends BoundedReceiver {
  public void onReceive(Context c,Intent i){if(Intent.ACTION_MY_PACKAGE_REPLACED.equals(i.getAction()))Updates.replaced(c);FastSync.cancel(c);schedule(c);Widgets.updateAll(c);if(Store.session(c)!=null)receive(c);}
 }
}
