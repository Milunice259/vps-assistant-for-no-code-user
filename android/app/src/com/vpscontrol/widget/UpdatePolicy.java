package com.vpscontrol.widget;
import java.net.URI;
/** No credentials or arbitrary hosts are accepted by the update transport. */
public final class UpdatePolicy {
 public static final int MAX_APK=500000,MAX_FEED=32768;
 public static final String REPO="Milunice259/vps-assistant-for-no-code-user";
 public static final String FEED="https://raw.githubusercontent.com/"+REPO+"/main/android/releases/stable.json";
 public static boolean artifact(String value){try{URI u=new URI(value);return safe(u)&&"github.com".equals(u.getHost())&&u.getRawQuery()==null&&u.getRawFragment()==null&&u.getRawPath().matches("/"+REPO+"/releases/download/android-v[0-9]+\\.[0-9]+\\.[0-9]+/VPS-Control-Widget-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk");}catch(Exception e){return false;}}
 public static boolean redirect(String value){try{URI u=new URI(value);String h=u.getHost();return safe(u)&&u.getRawFragment()==null&&("release-assets.githubusercontent.com".equals(h)||"objects.githubusercontent.com".equals(h));}catch(Exception e){return false;}}
 private static boolean safe(URI u){return "https".equals(u.getScheme())&&u.getHost()!=null&&u.getRawUserInfo()==null&&(u.getPort()==-1||u.getPort()==443);}
 public static boolean digest(String s){return s!=null&&s.matches("[a-f0-9]{64}");}
 public static boolean version(String s){return s!=null&&s.length()<=32&&s.matches("[0-9]+\\.[0-9]+\\.[0-9]+");}
}
