package com.vpscontrol.widget;
import android.content.*;
import android.security.keystore.*;
import android.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import org.json.JSONObject;
/** All state transitions share this lock; an old response cannot restore a disconnected session. */
public final class Store {
 public static final Object LOCK=new Object();
 private static long generation;
 private static SharedPreferences prefs(Context c){return c.getSharedPreferences("device",Context.MODE_PRIVATE);}
 private static String alias(Context c){return c.getPackageName()+".session";}
 private static javax.crypto.SecretKey key(Context c)throws Exception {
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
  if(!ks.containsAlias(alias(c))){
   KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
   gen.init(new KeyGenParameterSpec.Builder(alias(c),KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());gen.generateKey();
  }
  return (javax.crypto.SecretKey)ks.getKey(alias(c),null);
 }
 public static final class Session {public String base,token;public long expiry;}
 public static Session session(Context c){synchronized(LOCK){
  String payload=prefs(c).getString("secret",null);if(payload==null)return null;
  try{
   String[] p=payload.split(":");if(p.length!=2)throw new Exception();
   Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(c),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));cipher.updateAAD(c.getPackageName().getBytes("UTF-8"));
   JSONObject o=new JSONObject(new String(cipher.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),"UTF-8"));
   Session s=new Session();s.base=Policy.origin(o.getString("base"));s.token=o.getString("token");s.expiry=o.getLong("expiry");
   if(!Policy.token(s.token)||s.expiry<=System.currentTimeMillis())throw new Exception();return s;
  }catch(Exception e){clear(c,"auth");return null;}
 }}
 public static void saveSession(Context c,String base,String token,long expiry)throws Exception {synchronized(LOCK){
  if(!Policy.token(token)||expiry<=System.currentTimeMillis())throw new Exception("credential");
  JSONObject o=new JSONObject();o.put("base",Policy.origin(base));o.put("token",token);o.put("expiry",expiry);
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(c));cipher.updateAAD(c.getPackageName().getBytes("UTF-8"));
  String encrypted=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(o.toString().getBytes("UTF-8")),Base64.NO_WRAP);
  generation++;if(!prefs(c).edit().putString("secret",encrypted).remove("snapshot").putString("error","").commit())throw new Exception("storage");
 }}
 public static void clear(Context c,String reason){synchronized(LOCK){generation++;prefs(c).edit().remove("secret").remove("snapshot").remove("received").putString("error",reason).commit();try{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);ks.deleteEntry(alias(c));}catch(Exception ignored){}}}
 public static long generation(){synchronized(LOCK){return generation;}}
 public static Snapshot snapshot(Context c){synchronized(LOCK){try{return new Snapshot(prefs(c).getString("snapshot",null));}catch(Exception e){return null;}}}
 public static void snapshot(Context c,Snapshot data,long expected){synchronized(LOCK){if(generation!=expected)return;prefs(c).edit().putString("snapshot",data.raw).putLong("received",System.currentTimeMillis()).putString("error","").commit();}}
 public static long received(Context c){return prefs(c).getLong("received",0);}
 public static String error(Context c){return prefs(c).getString("error","");}
 public static void error(Context c,String error,long expected){synchronized(LOCK){if(generation==expected)prefs(c).edit().putString("error",error).commit();}}
 public static String setting(Context c,String name,String fallback){return prefs(c).getString(name,fallback);}
 public static void putSetting(Context c,String name,String value){prefs(c).edit().putString(name,value).apply();}
 public static boolean saveWidget(Context c,int id,String selection,String style){synchronized(LOCK){return prefs(c).edit().putString("widget."+id,selection).putString("widget.style."+id,style).commit();}}
 public static boolean vi(Context c){String l=setting(c,"language","system");return l.equals("vi")||l.equals("system")&&c.getResources().getConfiguration().getLocales().get(0).getLanguage().equals("vi");}
 public static boolean dark(Context c){String t=setting(c,"theme","system");return t.equals("dark")||t.equals("system")&&(c.getResources().getConfiguration().uiMode&48)==32;}
 public static String tr(Context c,String vi,String en){return vi(c)?vi:en;}
}
