package com.vpscontrol.widget;
import java.net.*;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import org.json.JSONObject;
/** Platform TLS trust/hostname checks, no cookies, redirects, WebView or third-party client. */
public final class Api {
 public static final class Failure extends Exception {public final String kind;public Failure(String kind){this.kind=kind;}}
 public static String call(String base,String path,String token,String body)throws Exception {
  URL url=new URL(Policy.origin(base)+path);
  HttpsURLConnection c=(HttpsURLConnection)url.openConnection(Proxy.NO_PROXY);
  try{
   c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Cache-Control","no-store");
   if(token!=null)c.setRequestProperty("Authorization","Bearer "+token);
   if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");byte[] bytes=body.getBytes("UTF-8");c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
   int status=c.getResponseCode();
   if(status==401||status==403)throw new Failure("auth");
   if(status==429)throw new Failure("rate");
   if(status>=300&&status<400)throw new Failure("redirect");
   if(status!=200)throw new Failure(status==404?"unavailable":"server");
   String type=c.getContentType();if(type==null||!type.toLowerCase(java.util.Locale.ROOT).startsWith("application/json"))throw new Failure("format");
   if(c.getContentLengthLong()>131072)throw new Failure("format");
   ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[4096];long deadline=System.nanoTime()+15000000000L;
   try(InputStream in=c.getInputStream()){int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>131072||System.nanoTime()>deadline)throw new Failure("format");bytes.write(buffer,0,n);}}
   return new String(bytes.toByteArray(),"UTF-8");
  }finally{c.disconnect();}
 }
 public static JSONObject pair(String base,String code)throws Exception {
  if(!Policy.code(code))throw new Failure("code");JSONObject body=new JSONObject();body.put("code",code);return new JSONObject(call(base,"/api/mobile/v1/pair",null,body.toString()));
 }
}
