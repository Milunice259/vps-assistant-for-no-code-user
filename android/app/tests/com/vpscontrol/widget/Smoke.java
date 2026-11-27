package com.vpscontrol.widget;
import android.app.*;
import android.app.job.*;
import android.appwidget.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import android.graphics.Bitmap;
import org.json.*;
import java.util.*;
import java.net.*;
import javax.net.ssl.*;
import java.io.*;
public final class Smoke extends Instrumentation {
 private Context c;
 private int checks;
 private static int status=200;
 private static String response="{}",authorization,method;
 private static boolean redirects;
 private static ByteArrayOutputStream posted;
 private void check(boolean condition,String message){checks++;if(!condition)throw new AssertionError(message);}
 public void onCreate(Bundle args){super.onCreate(args);start();}
 public void onStart(){Bundle result=new Bundle();try{c=getTargetContext();runTests();result.putString("stream","PASS: "+checks+" assertions; Keystore, bounded HTTPS, auth erasure, cache, scheduler and widget RemoteViews\n");finish(Activity.RESULT_OK,result);}catch(Throwable e){result.putString("stream","FAIL: "+e.getClass().getSimpleName()+" "+e.getMessage()+"\n"+android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
 private String fixture(long now)throws Exception{
  JSONObject root=new JSONObject();root.put("version",1);root.put("generatedAt",now);root.put("worker",new JSONObject().put("enabled",true).put("online",true).put("intervalSeconds",60));JSONArray servers=new JSONArray();
  String[] states={"online","offline","unknown","stale","disabled","online","online","online","online"};
  for(int i=0;i<states.length;i++)servers.put(new JSONObject().put("id","server"+i).put("name",i==0?"GOVA · Main VPS":"Server "+(i+1)).put("state",states[i]).put("observedAt",now-30000).put("cpuPercent",24).put("memoryPercent",62).put("diskPercent",45).put("stoppedContainers",1).put("failedServices",0).put("expiringCertificates",JSONObject.NULL).put("backupStale",JSONObject.NULL));root.put("servers",servers);return root.toString();
 }
 private void runTests()throws Exception{
  Store.clear(c,"");String token="mv1_"+String.join("",Collections.nCopies(43,"a"));
  Store.saveSession(c,"https://panel.example.com",token,System.currentTimeMillis()+3600000);check(Store.session(c).token.equals(token),"Keystore decrypt roundtrip");
  String prefs=c.getSharedPreferences("device",0).getAll().toString();check(!prefs.contains(token)&&!prefs.contains("https://panel.example.com"),"No plaintext credentials in preferences");
  long generation=Store.generation();Snapshot data=new Snapshot(fixture(System.currentTimeMillis()));Store.snapshot(c,data,generation);check(Store.snapshot(c).servers.size()==9,"Cache roundtrip");
  Store.clear(c,"");Store.snapshot(c,data,generation);check(Store.snapshot(c)==null,"Old in-flight response cannot restore erased cache");
  Store.saveSession(c,"https://panel.example.com",token,System.currentTimeMillis()+3600000);Store.snapshot(c,data,Store.generation());
  c.getSharedPreferences("device",0).edit().putString("secret","corrupt").commit();check(Store.session(c)==null&&Store.snapshot(c)==null,"Corrupt encrypted token fails closed and clears cache");
  Store.saveSession(c,"https://panel.example.com",token,System.currentTimeMillis()+3600000);Store.snapshot(c,data,Store.generation());
  Sync.schedule(c);JobInfo job=((JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).getPendingJob(27101);check(job!=null&&job.getIntervalMillis()==900000&&job.isPersisted(),"15 minute persisted JobScheduler");
  Store.putSetting(c,"interval","60");Sync.schedule(c);check(((JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).getPendingJob(27101).getIntervalMillis()==3600000,"Interval change");Store.putSetting(c,"interval","15");
  URL.setURLStreamHandlerFactory(new URLStreamHandlerFactory(){public URLStreamHandler createURLStreamHandler(String protocol){return protocol.equals("https")?new URLStreamHandler(){protected URLConnection openConnection(URL u){return new Fake(u);}protected URLConnection openConnection(URL u,Proxy p){return new Fake(u);}}:null;}});
  response=data.raw;status=200;check(new Snapshot(Api.call("https://panel.example.com","/api/mobile/v1/snapshot",token,null)).servers.size()==9,"Native snapshot contract");check(token.equals(authorization.substring(7))&&!redirects&&"GET".equals(method),"Bearer and redirect boundary");
  response="{}";Api.pair("https://panel.example.com","mp1_"+String.join("",Collections.nCopies(32,"a")));check(authorization==null&&"POST".equals(method)&&posted.toString("UTF-8").contains("mp1_"),"Pair exchange has no bearer");
  status=302;try{Api.call("https://panel.example.com","/api/mobile/v1/snapshot",token,null);throw new AssertionError("redirect followed");}catch(Api.Failure e){check(e.kind.equals("redirect"),"No redirect credential forwarding");}
  status=200;response=String.join("",Collections.nCopies(131073,"x"));try{Api.call("https://panel.example.com","/api/mobile/v1/snapshot",token,null);throw new AssertionError("unbounded body");}catch(Api.Failure e){check(e.kind.equals("format"),"Response byte bound");}
  try{new Snapshot(new JSONObject(data.raw).put("version",2).toString());throw new AssertionError("unknown version accepted");}catch(AssertionError e){throw e;}catch(Exception expected){checks++;}
  try{new Snapshot(new JSONObject(data.raw).put("generatedAt",System.currentTimeMillis()+120000).toString());throw new AssertionError("future time");}catch(AssertionError e){throw e;}catch(Exception expected){checks++;}
  status=200;response=data.raw;
  for(String language:new String[]{"vi","en"})for(String theme:new String[]{"dark","light"}){
   Store.putSetting(c,"language",language);Store.putSetting(c,"theme",theme);
   final Snapshot snapshot=data;
   for(final int[] size:new int[][]{{110,110},{160,160},{280,180},{280,320},{350,440}}){
    for(final boolean single:new boolean[]{false,true})runOnMainSync(new Runnable(){public void run(){RemoteViews rv=Widgets.render(c,42,single,size[0],size[1],snapshot);View view=rv.apply(c,new FrameLayout(c));int w=(int)(size[0]*c.getResources().getDisplayMetrics().density),h=(int)(size[1]*c.getResources().getDisplayMetrics().density);view.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(h,View.MeasureSpec.EXACTLY));view.layout(0,0,w,h);check(view.findViewById(R.id.headline)!=null,"RemoteViews inflation");TextView stamp=(TextView)view.findViewById(R.id.stamp);check(stamp.getBottom()<=h-view.getPaddingBottom(),"Timestamp fits "+size[0]+"x"+size[1]);}});
   }
  }
  Store.putSetting(c,"language","vi");Store.putSetting(c,"theme","dark");Store.snapshot(c,data,Store.generation());
  final LinearLayout[] gallery=new LinearLayout[1];runOnMainSync(new Runnable(){public void run(){LinearLayout list=new LinearLayout(c);list.setOrientation(1);for(int[] size:new int[][]{{170,170},{440,210},{440,340}}){View v=Widgets.render(c,42,false,size[0],size[1],Store.snapshot(c)).apply(c,list);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams((int)(size[0]*c.getResources().getDisplayMetrics().density),(int)(size[1]*c.getResources().getDisplayMetrics().density));p.bottomMargin=12;list.addView(v,p);}Gallery.preview=list;gallery[0]=list;}});
  Activity galleryActivity=startActivitySync(new Intent().setComponent(new ComponentName("com.vpscontrol.widget.tests","com.vpscontrol.widget.Gallery")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));waitForIdleSync();capture("widgets-vi-dark.png");runOnMainSync(new Runnable(){public void run(){galleryActivity.finish();}});
  Activity main=startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));waitForIdleSync();capture("overview-vi-dark.png");runOnMainSync(new Runnable(){public void run(){main.finish();}});
  // Actual lifecycle: rejected credentials remove both session and all cached metrics.
  Thread.sleep(10500);status=401;response="{}";final java.util.concurrent.CountDownLatch latch=new java.util.concurrent.CountDownLatch(1);Sync.request(c,new Runnable(){public void run(){latch.countDown();}});check(latch.await(20,java.util.concurrent.TimeUnit.SECONDS),"Sync completion");check(Store.session(c)==null&&Store.snapshot(c)==null,"401 clears token and snapshot");
  Sync.schedule(c);check(((JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE)).getPendingJob(27101)==null,"Disconnect cancels job");
 }
 private void capture(String name)throws Exception {Thread.sleep(500);Bitmap bitmap=getUiAutomation().takeScreenshot();check(bitmap!=null,"Screenshot");File dir=new File(c.getExternalFilesDir(null),"qa");dir.mkdirs();try(FileOutputStream out=new FileOutputStream(new File(dir,name))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}
 public static final class Fake extends HttpsURLConnection {
  Fake(URL url){super(url);posted=new ByteArrayOutputStream();}
  public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
  public String getCipherSuite(){return "TLS_TEST";}public java.security.cert.Certificate[] getLocalCertificates(){return null;}public java.security.cert.Certificate[] getServerCertificates(){return new java.security.cert.Certificate[0];}
  public int getResponseCode(){authorization=getRequestProperty("Authorization");method=getRequestMethod();redirects=getInstanceFollowRedirects();return status;}
  public String getContentType(){return "application/json";}public long getContentLengthLong(){return -1;}
  public InputStream getInputStream()throws IOException{return new ByteArrayInputStream(response.getBytes("UTF-8"));}
  public OutputStream getOutputStream(){return posted;}
 }
}
