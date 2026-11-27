package com.vpscontrol.widget;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;
/** Public GitHub feed + owner-signed APK. Independent from VPS credentials and sync. */
public final class Updates {
 public static final String CHANGED="com.vpscontrol.widget.UPDATES";
 private static final ExecutorService WORK=Executors.newSingleThreadExecutor();
 public static volatile String phase="idle",issue="";
 public static volatile Candidate candidate;
 public static volatile int progress;
 private static boolean initialized,checking,permissionReturn;
 private static volatile boolean cancel;
 private static long generation;
 private static File ready;
 private static String etag="",cached="";
 public static final class Candidate {
  public final long code,size;public final int min;public final String name,pkg,url,sha,notes;
  public Candidate(JSONObject o)throws Exception{
   code=integer(o,"versionCode");size=integer(o,"size");long minimum=integer(o,"minSdk");if(minimum<29||minimum>100)throw new Exception("format");min=(int)minimum;name=string(o,"versionName",32);pkg=string(o,"packageName",128);url=string(o,"url",512);sha=string(o,"sha256",64);notes=string(o,"notes",1200);
   if(code<=0||code>2100000000||size<=0||size>UpdatePolicy.MAX_APK||min<29||min>100||!UpdatePolicy.version(name)||!UpdatePolicy.digest(sha)||!UpdatePolicy.artifact(url)||!url.endsWith("/VPS-Control-Widget-"+name+".apk")||!url.contains("/android-v"+name+"/"))throw new Exception("format");
  }
 }
 private static long integer(JSONObject o,String key)throws Exception{Object v=o.get(key);if(!(v instanceof Integer||v instanceof Long))throw new Exception("format");return ((Number)v).longValue();}
 private static String string(JSONObject o,String key,int max)throws Exception{Object v=o.get(key);if(!(v instanceof String)||((String)v).length()>max||((String)v).indexOf('\u0000')>=0)throw new Exception("format");return (String)v;}
 public static Candidate catalog(String value)throws Exception{JSONObject o=new JSONObject(value);if(integer(o,"schema")!=1||!o.has("release"))throw new Exception("format");return o.isNull("release")?null:new Candidate(o.getJSONObject("release"));}
 private static SharedPreferences prefs(Context c){return c.getSharedPreferences("updates",0);}
 public static long version(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).getLongVersionCode();}catch(Exception e){return 0;}}
 public static String versionName(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionName;}catch(Exception e){return "—";}}
 public static boolean busy(){return phase.equals("downloading")||phase.equals("verifying")||phase.equals("installing")||phase.equals("confirm");}
 private static void changed(Context c){c.sendBroadcast(new Intent(CHANGED).setPackage(c.getPackageName()));}
 private static void state(Context c,String next,String error){phase=next;issue=error;changed(c);}
 private static File directory(Context c){return new File(c.getCacheDir(),"apk-update");}
 static void files(Context c){File d=directory(c);File[] entries=d.listFiles();if(entries!=null)for(File f:entries)if(f.isFile())f.delete();}
 public static synchronized void init(Context c){if(initialized)return;initialized=true;files(c);ready=null;int id=prefs(c).getInt("session",-1);if(id>=0){PackageInstaller installer=c.getPackageManager().getPackageInstaller();PackageInstaller.SessionInfo info=installer.getSessionInfo(id);if(info!=null&&System.currentTimeMillis()-prefs(c).getLong("started",0)<3600000){phase="installing";}else{abandon(c,id);prefs(c).edit().remove("session").remove("nonce").apply();}}}
 public static void replaced(Context c){synchronized(Updates.class){cancel=true;generation++;ready=null;candidate=null;files(c);int id=prefs(c).getInt("session",-1);abandon(c,id);prefs(c).edit().clear().apply();phase="idle";issue="";}}
 public static void check(Context context){
  final Context c=context.getApplicationContext();init(c);final long current;
  synchronized(Updates.class){if(checking||busy()||phase.equals("permission")||phase.equals("ready"))return;checking=true;current=generation;}
  state(c,"checking","");WORK.execute(new Runnable(){public void run(){Candidate found=null;String next="current",error="";try{
   String value=feed(etag);if(value==null){if(cached.isEmpty())throw new Exception("format");value=cached;}else cached=value;
   found=catalog(value);if(found==null)next="unpublished";else if(!found.pkg.equals(c.getPackageName())){found=null;next="channel";}else if(found.code<=version(c)){found=null;next="current";}else if(found.min>Build.VERSION.SDK_INT){found=null;next="unsupported";}else next="available";
  }catch(Exception e){next="error";error=e.getMessage()==null?"network":e.getMessage();}
  synchronized(Updates.class){checking=false;if(current!=generation)return;candidate=found;state(c,next,error);}
  }});
 }
 static String feed(String tag)throws Exception{
  HttpsURLConnection connection=open(UpdatePolicy.FEED,"application/json");if(!tag.isEmpty())connection.setRequestProperty("If-None-Match",tag);
  try{int status=connection.getResponseCode();if(status==304)return null;if(status==404)return "{\"schema\":1,\"release\":null}";if(status==403||status==429)throw new Exception("rate");if(status!=200)throw new Exception("network");String body=new String(read(connection,UpdatePolicy.MAX_FEED,15000),"UTF-8");catalog(body);String e=connection.getHeaderField("ETag");etag=e!=null&&e.length()<=256?e:"";return body;}finally{connection.disconnect();}
 }
 private static HttpsURLConnection open(String value,String accept)throws Exception{HttpsURLConnection c=(HttpsURLConnection)new URL(value).openConnection(Proxy.NO_PROXY);c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setUseCaches(false);c.setRequestProperty("Accept",accept);c.setRequestProperty("User-Agent","VPS-Control-Android");c.setRequestProperty("Cookie","");return c;}
 private static byte[] read(HttpsURLConnection c,int max,int millis)throws Exception{if(c.getContentLengthLong()>max)throw new Exception("format");ByteArrayOutputStream out=new ByteArrayOutputStream();long end=SystemClock.elapsedRealtime()+millis;try(InputStream in=c.getInputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>max||SystemClock.elapsedRealtime()>end)throw new Exception("format");out.write(b,0,n);}}return out.toByteArray();}
 public static void download(Context context){final Context c=context.getApplicationContext();final Candidate item;final long current;synchronized(Updates.class){if(busy()||checking||candidate==null)return;item=candidate;generation++;current=generation;cancel=false;progress=0;}state(c,"downloading","");WORK.execute(new Runnable(){public void run(){try{
   File dir=directory(c);if(!dir.isDirectory()&&!dir.mkdirs())throw new Exception("storage");files(c);File part=new File(dir,"download.part");fetch(c,item,part);if(cancel)throw new Exception("cancel");state(c,"verifying","");verify(c,item,part);File target=new File(dir,"verified.apk");if(!part.renameTo(target))throw new Exception("storage");synchronized(Updates.class){if(current!=generation||cancel)throw new Exception("cancel");ready=target;}state(c,"ready","");
  }catch(Exception e){synchronized(Updates.class){if(current!=generation)return;ready=null;files(c);state(c,"error",kind(e));}}
  }});}
 static void fetch(Context c,Candidate item,File file)throws Exception{
  String url=item.url;long end=SystemClock.elapsedRealtime()+60000;int hops=0;while(true){if(cancel)throw new Exception("cancel");HttpsURLConnection conn=open(url,"application/vnd.android.package-archive");try{int status=conn.getResponseCode();if(status>=300&&status<400){String location=conn.getHeaderField("Location");if(++hops>3||location==null||!UpdatePolicy.redirect(location))throw new Exception("redirect");url=location;continue;}if(status!=200)throw new Exception(status==403||status==429?"rate":"network");if(conn.getContentLengthLong()>UpdatePolicy.MAX_APK||(conn.getContentLengthLong()>=0&&conn.getContentLengthLong()!=item.size))throw new Exception("integrity");long total=0;try(InputStream in=conn.getInputStream();FileOutputStream out=new FileOutputStream(file)){byte[] bytes=new byte[8192];int n,last=-1;while((n=in.read(bytes))!=-1){if(cancel||SystemClock.elapsedRealtime()>end)throw new Exception(cancel?"cancel":"network");total+=n;if(total>item.size||total>UpdatePolicy.MAX_APK)throw new Exception("integrity");out.write(bytes,0,n);int percent=(int)(total*100/item.size);if(percent/5!=last){last=percent/5;progress=percent;changed(c);}}out.getFD().sync();}if(total!=item.size)throw new Exception("integrity");return;}finally{conn.disconnect();}}
 }
 static String digest(File file)throws Exception{MessageDigest md=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)md.update(b,0,n);}StringBuilder out=new StringBuilder();for(byte v:md.digest())out.append(String.format(Locale.ROOT,"%02x",v&255));return out.toString();}
 static void verify(Context c,Candidate item,File file)throws Exception{
  if(file.length()!=item.size||!digest(file).equals(item.sha))throw new Exception("integrity");PackageManager pm=c.getPackageManager();PackageInfo archive=pm.getPackageArchiveInfo(file.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES|PackageManager.GET_SIGNATURES),installed=pm.getPackageInfo(c.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
  if(archive==null||archive.applicationInfo==null||!c.getPackageName().equals(item.pkg)||!item.pkg.equals(archive.packageName)||archive.getLongVersionCode()!=item.code||!item.name.equals(archive.versionName)||item.code<=installed.getLongVersionCode()||archive.applicationInfo.minSdkVersion!=item.min||item.min>Build.VERSION.SDK_INT)throw new Exception("package");
  if(archive.signingInfo==null||installed.signingInfo==null)throw new Exception("signature");android.content.pm.Signature[] a=archive.signingInfo.getApkContentsSigners(),b=installed.signingInfo.getApkContentsSigners();if(a.length!=1||b.length!=1||!MessageDigest.isEqual(a[0].toByteArray(),b[0].toByteArray()))throw new Exception("signature");
 }
 public static void cancel(Context c){synchronized(Updates.class){cancel=true;generation++;ready=null;files(c);candidate=null;state(c,"idle","");}}
 public static void resume(Activity a){init(a);if(phase.equals("ready"))install(a);else if(phase.equals("permission")&&permissionReturn){permissionReturn=false;if(a.getPackageManager().canRequestPackageInstalls())install(a);}}
 public static void install(final Activity activity){final Context c=activity.getApplicationContext();if(!phase.equals("ready")&&!phase.equals("permission"))return;
  if(!c.getPackageManager().canRequestPackageInstalls()){phase="permission";changed(c);permissionReturn=true;try{activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+c.getPackageName())));}catch(ActivityNotFoundException e){permissionReturn=false;state(c,"error","permission");files(c);}return;}
  final File file=ready;final Candidate item=candidate;if(file==null||item==null){state(c,"error","integrity");files(c);return;}state(c,"installing","");WORK.execute(new Runnable(){public void run(){int id=-1;try{verify(c,item,file);PackageInstaller installer=c.getPackageManager().getPackageInstaller();PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);params.setAppPackageName(c.getPackageName());params.setSize(file.length());if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);id=installer.createSession(params);String nonce=UUID.randomUUID().toString();prefs(c).edit().putInt("session",id).putString("nonce",nonce).putLong("started",System.currentTimeMillis()).commit();
   try(PackageInstaller.Session session=installer.openSession(id)){
    try(InputStream in=new FileInputStream(file);OutputStream out=session.openWrite("base.apk",0,file.length())){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);session.fsync(out);}
    Intent callback=new Intent(c,InstallActivity.class).setData(Uri.parse("vpsupdate://install/"+nonce));int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0);ActivityOptions options=ActivityOptions.makeBasic();if(Build.VERSION.SDK_INT>=35)options.setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);PendingIntent result=PendingIntent.getActivity(c,id,callback,flags,options.toBundle());session.commit(result.getIntentSender());
   }
   files(c);ready=null;
  }catch(Exception e){android.util.Log.e("VPSUpdate","Installer failure",e);abandon(c,id);prefs(c).edit().remove("session").remove("nonce").apply();files(c);ready=null;state(c,"error",kind(e));}
  }});
 }
 private static void abandon(Context c,int id){if(id<0)return;try{c.getPackageManager().getPackageInstaller().abandonSession(id);}catch(Exception ignored){}}
 private static String kind(Exception e){String m=e.getMessage();return m!=null&&Arrays.asList("network","rate","format","integrity","package","signature","storage","redirect","cancel","permission").contains(m)?m:"network";}
 public static final class InstallActivity extends Activity {
  public void onCreate(Bundle b){super.onCreate(b);Intent received=getIntent();int id=received.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);String nonce=prefs(this).getString("nonce","");if(id<0||id!=prefs(this).getInt("session",-2)||nonce.isEmpty()||received.getData()==null||!received.getData().toString().equals("vpsupdate://install/"+nonce)){finish();return;}
   int status=received.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
   if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){Intent confirm=received.getParcelableExtra(Intent.EXTRA_INTENT);if(confirm!=null){state(this,"confirm","");try{startActivity(confirm);}catch(Exception e){abandon(this,id);files(this);prefs(this).edit().remove("session").remove("nonce").apply();state(this,"error","permission");}}}
   else{files(this);ready=null;abandon(this,id);prefs(this).edit().remove("session").remove("nonce").apply();state(this,status==PackageInstaller.STATUS_SUCCESS?"current":"error",status==PackageInstaller.STATUS_SUCCESS?"":status==PackageInstaller.STATUS_FAILURE_ABORTED?"cancel":"install");}finish();
  }
 }
 public static String message(Context c){String p=phase;if(p.equals("idle"))return Store.tr(c,"Tự kiểm tra phiên bản mới mỗi khi mở ứng dụng.","Checks for a new version whenever you open the app.");if(p.equals("checking"))return Store.tr(c,"Đang kiểm tra trên GitHub…","Checking GitHub…");if(p.equals("available")&&candidate!=null)return Store.tr(c,"Có phiên bản ","Version available: ")+candidate.name;if(p.equals("downloading"))return Store.tr(c,"Đang tải bản cập nhật… ","Downloading update… ")+progress+"%";if(p.equals("verifying"))return Store.tr(c,"Đang kiểm tra bản cập nhật…","Verifying update…");if(p.equals("ready"))return Store.tr(c,"Sẵn sàng cài đặt","Ready to install");if(p.equals("permission"))return Store.tr(c,"Cho phép VPS Control cài bản cập nhật trong Cài đặt Android.","Allow VPS Control to install updates in Android Settings.");if(p.equals("installing")||p.equals("confirm"))return Store.tr(c,"Xác nhận cập nhật trong cửa sổ Android.","Confirm the update in the Android window.");if(p.equals("unpublished"))return Store.tr(c,"Chưa có bản cập nhật được phát hành.","No update has been published yet.");if(p.equals("channel"))return Store.tr(c,"Bản này thuộc kênh thử nghiệm. Chuyển sang bản chính thức để cập nhật lâu dài.","This is a preview build. Install the stable edition for ongoing updates.");if(p.equals("unsupported"))return Store.tr(c,"Bản mới cần Android mới hơn.","The new version needs a newer Android release.");if(p.equals("error")){if(issue.equals("cancel"))return Store.tr(c,"Đã hủy cập nhật. File tải tạm đã được dọn.","Update cancelled. Temporary download removed.");if(issue.equals("signature")||issue.equals("integrity")||issue.equals("package"))return Store.tr(c,"Bản tải không hợp lệ hoặc khác khóa ký. Đã xóa file; bản đang dùng vẫn được giữ.","Download invalid or signed by a different key. File removed; current app retained.");return Store.tr(c,"Chưa cập nhật được. Anh có thể thử lại; app vẫn hoạt động bình thường.","Could not update. You can retry; the app remains available.");}return Store.tr(c,"Anh đang dùng phiên bản mới nhất.","You have the latest version.");}
}
