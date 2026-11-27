package com.vpscontrol.widget;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.os.*;
import java.io.*;
import java.net.*;
import java.util.*;
import org.json.*;
import javax.net.ssl.HttpsURLConnection;
/** Separate fixture APK drives real platform archive verification and PackageInstaller. */
public final class UpdateSmoke extends Instrumentation {
 private Context c;private Bundle args;private int checks;private static byte[] body;private static int status=200,requests;private static String location,seenAuth,seenCookie;
 public void onCreate(Bundle b){super.onCreate(b);args=b;start();}
 private void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
 public void onStart(){Bundle out=new Bundle();try{c=getTargetContext();String mode=args.getString("mode","checks");if(mode.equals("after"))after();else if(mode.equals("cancel"))cancelled();else {URL.setURLStreamHandlerFactory(new URLStreamHandlerFactory(){public URLStreamHandler createURLStreamHandler(String p){return p.equals("https")?new URLStreamHandler(){protected URLConnection openConnection(URL u){return new Fake(u);}protected URLConnection openConnection(URL u,Proxy p){return new Fake(u);}}:null;}});if(mode.equals("stage"))stage();else checks();}out.putString("stream","PASS: updater "+mode+" ("+checks+" assertions)\n");finish(Activity.RESULT_OK,out);}catch(Throwable t){out.putString("stream","FAIL: "+android.util.Log.getStackTraceString(t));finish(Activity.RESULT_CANCELED,out);}}
 private File asset(String name)throws Exception{File f=new File(c.getCacheDir(),"fixture-"+name+".apk");try(InputStream in=getContext().getAssets().open(name+".apk");OutputStream out=new FileOutputStream(f)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}return f;}
 private JSONObject info(File f,long code,String name)throws Exception{return new JSONObject().put("versionCode",code).put("versionName",name).put("packageName",c.getPackageName()).put("size",f.length()).put("sha256",Updates.digest(f)).put("minSdk",29).put("url","https://github.com/"+UpdatePolicy.REPO+"/releases/download/android-v"+name+"/VPS-Control-Widget-"+name+".apk").put("notes","Native update fixture");}
 private byte[] bytes(File f)throws Exception{try(InputStream in=new FileInputStream(f);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
 private void reject(Updates.Candidate candidate,File file,String kind)throws Exception{try{Updates.verify(c,candidate,file);throw new AssertionError("accepted "+kind);}catch(AssertionError e){throw e;}catch(Exception e){check(kind.equals(e.getMessage()),"Reject "+kind+": "+e.getMessage());}}
 private void checks()throws Exception{
  Updates.init(c);File higher=asset("upgrade");JSONObject meta=info(higher,10101,"1.1.1");Updates.Candidate candidate=new Updates.Candidate(meta);Updates.verify(c,candidate,higher);check(candidate.code>Updates.version(c),"Signed higher version accepted");
  File old=asset("older");reject(new Updates.Candidate(info(old,10099,"1.0.9")),old,"package");File wrongPackage=asset("package");reject(new Updates.Candidate(info(wrongPackage,10101,"1.1.1")),wrongPackage,"package");File signer=asset("signer");reject(new Updates.Candidate(info(signer,10101,"1.1.1")),signer,"signature");
  JSONObject hash=new JSONObject(meta.toString()).put("sha256",String.join("",Collections.nCopies(64,"0")));reject(new Updates.Candidate(hash),higher,"integrity");
  reject(new Updates.Candidate(new JSONObject(meta.toString()).put("versionCode",10102)),higher,"package");
  for(JSONObject invalid:new JSONObject[]{new JSONObject(meta.toString()).put("size",500001),new JSONObject(meta.toString()).put("size","100"),new JSONObject(meta.toString()).put("minSdk",0),new JSONObject(meta.toString()).put("minSdk",4294967325L),new JSONObject(meta.toString()).put("url","http://evil.invalid/app.apk"),new JSONObject(meta.toString()).put("notes",String.join("",Collections.nCopies(1201,"a")))}){try{new Updates.Candidate(invalid);throw new AssertionError("invalid feed accepted");}catch(AssertionError e){throw e;}catch(Exception expected){checks++;}}
  check(Updates.catalog("{\"schema\":1,\"release\":null}")==null,"Unpublished feed distinguished");
  body=("{\"schema\":1,\"release\":"+meta+"}").getBytes("UTF-8");status=200;String feed=Updates.feed("");check(Updates.catalog(feed).code==10101,"Bounded public manifest read");check(seenAuth==null&&(seenCookie==null||seenCookie.isEmpty()),"No VPS bearer/cookie sent to GitHub");
  body=new byte[UpdatePolicy.MAX_FEED+1];try{Updates.feed("");throw new AssertionError("oversize feed");}catch(AssertionError e){throw e;}catch(Exception expected){checks++;}
  status=404;check(Updates.catalog(Updates.feed(""))==null,"Missing release is not current-version claim");status=429;try{Updates.feed("");throw new AssertionError("rate");}catch(AssertionError e){throw e;}catch(Exception e){check(e.getMessage().equals("rate"),"Rate failure");}
  status=200;body=bytes(higher);File downloaded=new File(c.getCacheDir(),"download-test.apk");Updates.fetch(c,candidate,downloaded);Updates.verify(c,candidate,downloaded);check(downloaded.length()==higher.length(),"Download verified against signed archive");check(seenAuth==null,"Download never sends VPS credential");downloaded.delete();
  status=302;location="https://evil.invalid/stolen.apk";int before=requests;try{Updates.fetch(c,candidate,downloaded);throw new AssertionError("redirect");}catch(AssertionError e){throw e;}catch(Exception e){check(e.getMessage().equals("redirect")&&requests-before==1,"Untrusted redirect denied without request");}
  location="https://release-assets.githubusercontent.com/test";before=requests;try{Updates.fetch(c,candidate,downloaded);throw new AssertionError("loop");}catch(AssertionError e){throw e;}catch(Exception e){check(e.getMessage().equals("redirect")&&requests-before==4,"Redirect loop bounded");}
  status=200;body=new byte[(int)candidate.size+1];try{Updates.fetch(c,candidate,downloaded);throw new AssertionError("oversize APK");}catch(AssertionError e){throw e;}catch(Exception e){check(e.getMessage().equals("integrity"),"Oversize APK denied");}downloaded.delete();
  File dir=new File(c.getCacheDir(),"apk-update");dir.mkdirs();new File(dir,"stale.part").createNewFile();Updates.files(c);check(dir.list().length==0,"Only temporary updater directory cleaned");
  higher.delete();old.delete();wrongPackage.delete();signer.delete();
 }
 private void stage()throws Exception{
  Store.clear(c,"");Store.saveSession(c,"https://fixture.example.com","mv1_"+String.join("",Collections.nCopies(43,"a")),System.currentTimeMillis()+3600000);Store.putSetting(c,"widget.42","[\"retained\"]");Store.putSetting(c,"theme","dark");long now=System.currentTimeMillis();JSONObject snap=new JSONObject().put("version",1).put("generatedAt",now).put("worker",new JSONObject().put("enabled",true).put("online",true).put("intervalSeconds",60)).put("servers",new JSONArray().put(new JSONObject().put("id","retained").put("name","Retained fixture").put("state","online").put("observedAt",now).put("cpuPercent",24).put("memoryPercent",40).put("diskPercent",52)));Store.snapshot(c,new Snapshot(snap.toString()),Store.generation());
  File f=asset("upgrade");Updates.candidate=new Updates.Candidate(info(f,10101,"1.1.1"));body=bytes(f);status=200;Updates.phase="available";
  Updates.phase="installing";final Activity a=startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Updates.phase="available";Updates.download(c);
  long end=System.currentTimeMillis()+20000;while(!Updates.phase.equals("confirm")&&System.currentTimeMillis()<end){if(Updates.phase.equals("ready"))runOnMainSync(new Runnable(){public void run(){Updates.resume(a);}});if(Updates.phase.equals("error"))throw new Exception("update stage "+Updates.issue);Thread.sleep(50);}
  check(Updates.phase.equals("confirm"),"Real PackageInstaller confirmation requested");check(c.getPackageManager().getPackageInstaller().getMySessions().size()==1,"Exactly one owned install session");f.delete();
 }
 private void cancelled()throws Exception{check(Updates.version(c)==10100,"Cancelled install leaves original version");check(Store.session(c)!=null,"Cancelled install retains pairing");File dir=new File(c.getCacheDir(),"apk-update");check(dir.list()==null||dir.list().length==0,"Cancelled install removes download");check(c.getPackageManager().getPackageInstaller().getMySessions().isEmpty(),"Cancelled install session cleaned");}
 private void after()throws Exception{check(Updates.version(c)==10101,"Actual version upgraded");check(Store.session(c)!=null&&Store.session(c).base.equals("https://fixture.example.com"),"Keystore pairing retained through upgrade");check(Store.setting(c,"widget.42","").equals("[\"retained\"]"),"Widget choice retained");check(Store.setting(c,"theme","").equals("dark"),"Theme retained");check(Store.snapshot(c)!=null&&Store.snapshot(c).find("retained")!=null&&Store.snapshot(c).find("retained").cpu==24,"Cached observations retained");Updates.init(c);Thread.sleep(500);File d=new File(c.getCacheDir(),"apk-update");check(d.list()==null||d.list().length==0,"Downloaded APK removed after replacement");check(c.getPackageManager().getPackageInstaller().getMySessions().isEmpty(),"No leftover install sessions");}
 public static final class Fake extends HttpsURLConnection {
  Fake(URL u){super(u);}public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public String getCipherSuite(){return "TEST";}public java.security.cert.Certificate[] getLocalCertificates(){return null;}public java.security.cert.Certificate[] getServerCertificates(){return new java.security.cert.Certificate[0];}
  public int getResponseCode(){requests++;seenAuth=getRequestProperty("Authorization");seenCookie=getRequestProperty("Cookie");return status;}public long getContentLengthLong(){return -1;}public String getHeaderField(String s){return s.equals("Location")?location:null;}public InputStream getInputStream(){return new ByteArrayInputStream(body);}
 }
}
