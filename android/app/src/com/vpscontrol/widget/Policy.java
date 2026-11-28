package com.vpscontrol.widget;
import java.net.URI;
/** Pure validation and freshness rules, also exercised on the JVM. */
public final class Policy {
 private Policy() {}
 public static String origin(String text) throws Exception {
  if(text==null||text.length()>256||!text.equals(text.trim())||text.indexOf('\\')>=0) throw new Exception("url");
  URI u=new URI(text);
  if(!"https".equalsIgnoreCase(u.getScheme())||u.getHost()==null||u.getHost().isEmpty()||u.getRawUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||!(u.getRawPath()==null||u.getRawPath().isEmpty()||"/".equals(u.getRawPath()))||u.getPort()==0||u.getPort()>65535||u.getPort()<-1) throw new Exception("url");
  return new URI("https",null,u.getHost().toLowerCase(java.util.Locale.ROOT),u.getPort(),null,null,null).toASCIIString();
 }
 public static boolean code(String s) {return s!=null&&s.matches("mp1_[A-Za-z0-9_-]{32}");}
 public static boolean token(String s) {return s!=null&&s.matches("mv1_[A-Za-z0-9_-]{43}");}
 public static long staleAfter(int interval) {return Math.max(180000L,(interval+125L)*1000L);}
 public static String state(String state,long observed,long generated,int interval,boolean worker,long now) {
  if("disabled".equals(state))return "disabled";
  if(observed<=0||observed>generated)return "unknown";
  if(!worker||now<generated-60000||now-observed>staleAfter(interval)) return "stale";
  return state;
 }
 public static boolean cached(String raw,long observed,long generated,int interval,boolean worker,long now){return "online".equals(raw)&&observed>0&&observed<=generated&&observed<=now&&now>=generated-60000&&now-observed<=86400000L&&state(raw,observed,generated,interval,worker,now).equals("stale");}
 public static int rows(int width,int height,boolean single) {return single||width<230?0:Math.min(8,Math.max(0,height<230?(height-55)/34:(height-132)/46));}
}
