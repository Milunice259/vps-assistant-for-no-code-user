package com.vpscontrol.widget;
import org.json.*;
import java.util.*;
public final class Snapshot {
 public final long generatedAt;
 public final int interval;
 public final boolean worker;
 public final List<Server> servers=new ArrayList<Server>();
 public final String raw;
 public static final class Server {
  public String id,name,state;
  public long observed;
  public Double cpu,memory,disk;
  public Integer stopped,failed,certificates;
  public Boolean backup;
  public String state(Snapshot snapshot) {return Policy.state(state,observed,snapshot.generatedAt,snapshot.interval,snapshot.worker,System.currentTimeMillis());}
  public boolean cached(Snapshot snapshot){return Policy.cached(state,observed,snapshot.generatedAt,snapshot.interval,snapshot.worker,System.currentTimeMillis());}
  public String displayState(Snapshot snapshot){return cached(snapshot)?"cached":state(snapshot);}
  public Double[] values(Snapshot snapshot){String display=displayState(snapshot);boolean available=display.equals("online")||display.equals("cached");return available?new Double[]{cpu,memory,disk}:new Double[]{null,null,null};}
 }
 public Snapshot(String text) throws Exception {
  if(text==null||text.length()>131072)throw new Exception("snapshot");
  JSONObject o=new JSONObject(text);
  if(o.getInt("version")!=1)throw new Exception("version");
  generatedAt=o.getLong("generatedAt");
  if(generatedAt<=0||generatedAt>System.currentTimeMillis()+60000)throw new Exception("time");
  JSONObject w=o.getJSONObject("worker");interval=w.getInt("intervalSeconds");
  if(interval<30||interval>3600)throw new Exception("interval");
  worker=w.getBoolean("enabled")&&w.getBoolean("online");
  JSONArray a=o.getJSONArray("servers");if(a.length()>100)throw new Exception("fleet");
  Set<String> ids=new HashSet<String>();
  for(int i=0;i<a.length();i++){
   JSONObject r=a.getJSONObject(i);Server s=new Server();
   s.id=r.getString("id");s.name=r.getString("name");s.state=r.getString("state");
   if(!s.id.matches("[A-Za-z0-9_-]{1,128}")||!ids.add(s.id)||s.name.length()>256||!s.state.matches("online|offline|unknown|stale|disabled"))throw new Exception("server");
   s.observed=r.isNull("observedAt")?0:r.getLong("observedAt");
   if(s.observed<0||s.observed>generatedAt)throw new Exception("observation");
   s.cpu=metric(r,"cpuPercent");s.memory=metric(r,"memoryPercent");s.disk=metric(r,"diskPercent");
   s.stopped=count(r,"stoppedContainers");s.failed=count(r,"failedServices");s.certificates=count(r,"expiringCertificates");s.backup=r.isNull("backupStale")?null:r.getBoolean("backupStale");
   servers.add(s);
  }
  raw=text;
 }
 private static Double metric(JSONObject o,String key)throws Exception {if(o.isNull(key))return null;double d=o.getDouble(key);if(Double.isNaN(d)||Double.isInfinite(d)||d<0||d>100)throw new Exception("metric");return d;}
 private static Integer count(JSONObject o,String key)throws Exception {if(o.isNull(key))return null;int n=o.getInt(key);if(n<0)throw new Exception("count");return n;}
 public Server find(String id){for(Server s:servers)if(s.id.equals(id))return s;return null;}
}
