import com.vpscontrol.widget.Policy;
public class PolicyTest {
 static int n;
 static void check(boolean condition){n++;if(!condition)throw new AssertionError("check "+n);}
 public static void main(String[] args)throws Exception{
  check(Policy.origin("https://PANEL.example.com/").equals("https://panel.example.com"));
  for(String s:new String[]{"http://panel.example.com","https://user:secret@panel.example.com","https://panel.example.com/path","https://panel.example.com/?token=x","https://panel.example.com/#secret"," https://panel.example.com","https://panel.example.com\\@evil.invalid","https://panel.example.com:0","javascript:alert(1)"}){boolean denied=false;try{Policy.origin(s);}catch(Exception e){denied=true;}check(denied);}
  check(Policy.code("mp1_"+"a".repeat(32)));check(!Policy.code("mp1_123"));check(Policy.token("mv1_"+"a".repeat(43)));
  check(Policy.state("online",1000,2000,60,true,3000).equals("online"));
  check(Policy.state("online",1000,2000,60,true,200000).equals("stale"));
  check(Policy.state("online",1000,2000,60,false,3000).equals("stale"));
  check(Policy.state("online",0,2000,60,true,3000).equals("unknown"));
  check(Policy.state("disabled",1000,2000,60,true,3000).equals("disabled"));
  check(Policy.rows(110,110,false)==0);check(Policy.rows(280,320,false)>0);check(Policy.rows(280,320,true)==0);check(Policy.rows(1000,2000,false)<=8);
  System.out.println("Policy JVM tests: PASS ("+n+" assertions)");
 }
}
