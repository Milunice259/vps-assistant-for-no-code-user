import com.vpscontrol.widget.RefreshPolicy;
import com.vpscontrol.widget.Policy;
public final class RefreshPolicyTest {
 private static int n;private static void check(boolean b){n++;if(!b)throw new AssertionError("check "+n);}
 public static void main(String[] args){
  for(int m:new int[]{1,3,5,15,30,60}){check(RefreshPolicy.minutes(""+m)==m);check(RefreshPolicy.periodic(m)>=900000);check(RefreshPolicy.fast(m)==(m<15));}
  for(String s:new String[]{null,"", "0","-1","2"," 1","1.0","99999999999999"})check(RefreshPolicy.minutes(s)==15);
  long now=100000000L,old=now-1200000;
  check(Policy.cached("online",old,old+1000,60,true,now));
  for(String s:new String[]{"offline","unknown","stale","disabled"})check(!Policy.cached(s,old,old+1000,60,true,now));
  check(!Policy.cached("online",now-1000,now,60,true,now));
  check(!Policy.cached("online",0,now,60,true,now));
  check(!Policy.cached("online",now-86400001,now,60,true,now));
  check(Policy.cached("online",now-86400000,now,60,true,now));
  check(!Policy.cached("online",now+1000,now,60,true,now));
  check(!Policy.cached("online",old,now+60001,60,true,now));
  check(!Policy.cached("online",now+1000,now+1000,60,false,now));
  System.out.println("Refresh policy tests: PASS ("+n+" assertions)");
 }
}
