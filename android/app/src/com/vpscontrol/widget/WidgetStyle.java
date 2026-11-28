package com.vpscontrol.widget;
import android.content.Context;
import org.json.JSONObject;
import java.util.Arrays;
/** Per-instance presentation only. Selection, credentials and sync policy stay separate. */
public final class WidgetStyle {
 public String theme="app",layout="auto",accent="violet",density="comfortable";
 public int transparency=15;
 private static String option(JSONObject j,String name,String allowed,String fallback){Object v=j.opt(name);return v instanceof String&&Arrays.asList(allowed.split("\\|")).contains(v)?(String)v:fallback;}
 public static WidgetStyle parse(String raw){WidgetStyle s=new WidgetStyle();if(raw==null||raw.isEmpty()||raw.length()>1024)return s;try{JSONObject j=new JSONObject(raw);s.theme=option(j,"theme","app|light|dark","app");s.layout=option(j,"layout","auto|rings|bars|numbers","auto");s.accent=option(j,"accent","violet|blue|teal|amber","violet");s.density=option(j,"density","comfortable|compact","comfortable");Object t=j.opt("transparency");if(t instanceof Integer||t instanceof Long)s.transparency=(int)Math.max(0L,Math.min(100L,((Number)t).longValue()));}catch(Exception ignored){}return s;}
 public static WidgetStyle load(Context c,int id){return parse(Store.setting(c,"widget.style."+id,""));}
 public String json(){try{return new JSONObject().put("theme",theme).put("layout",layout).put("accent",accent).put("density",density).put("transparency",transparency).toString();}catch(Exception e){return "{}";}}
 public WidgetStyle copy(){return parse(json());}
 public void save(Context c,int id){Store.putSetting(c,"widget.style."+id,parse(json()).json());}
 public static void clear(Context c,int id){Store.putSetting(c,"widget.style."+id,"");}
 public boolean dark(Context c){return theme.equals("dark")||theme.equals("app")&&Store.dark(c);}
 public int alpha(){return Math.round(255*(100-transparency)/100f);}
 public Visuals palette(Context c){return Visuals.widget(this,c);}
}
