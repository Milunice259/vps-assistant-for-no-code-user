package com.vpscontrol.widget;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import java.text.DateFormat;
import java.time.Instant;
import java.util.*;
import org.json.JSONObject;
public final class MainActivity extends Activity {
 private LinearLayout root,content;
 private int tab=0,ink,muted,bg,surface;
 private boolean pairing,registered;
 private EditText origin,code;
 private final BroadcastReceiver updates=new BroadcastReceiver(){public void onReceive(Context c,Intent i){if(tab==0||tab==1&&Store.session(c)!=null)render();}};
 public void onCreate(Bundle state){super.onCreate(state);if(state!=null)tab=state.getInt("tab",0);render();Sync.schedule(this);}
 public void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putInt("tab",tab);}
 public void onResume(){super.onResume();IntentFilter filter=new IntentFilter(Sync.CHANGED);if(android.os.Build.VERSION.SDK_INT>=33)registerReceiver(updates,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(updates,filter);registered=true;render();Sync.schedule(this);if(Store.session(this)!=null)Sync.request(this,null);}
 public void onPause(){if(registered){unregisterReceiver(updates);registered=false;}super.onPause();}
 private String tr(String vi,String en){return Store.tr(this,vi,en);}
 private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 private TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setPadding(0,dp(5),0,dp(5));return t;}
 private GradientDrawable shape(int color){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(18));return d;}
 private LinearLayout card(){LinearLayout c=new LinearLayout(this);c.setOrientation(1);c.setPadding(dp(16),dp(12),dp(16),dp(12));c.setBackground(shape(surface));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(12);content.addView(c,lp);return c;}
 private Button button(LinearLayout parent,String label,View.OnClickListener listener){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextColor(ink);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Store.dark(this)?0xFF29465D:0xFFDCE8F1));b.setMinHeight(dp(48));b.setOnClickListener(listener);parent.addView(b,new LinearLayout.LayoutParams(-1,-2));return b;}
 private void render(){
  boolean dark=Store.dark(this);ink=dark?0xFFF1F6FB:0xFF142C40;muted=dark?0xFFA6B8CA:0xFF566A7D;bg=dark?0xFF091724:0xFFEAF1F7;surface=dark?0xFF142B3D:Color.WHITE;
  if(tab==1)getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
  root=new LinearLayout(this);root.setOrientation(1);root.setBackgroundColor(bg);
  root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener(){public WindowInsets onApplyWindowInsets(View v,WindowInsets i){v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;}});
  getWindow().setNavigationBarColor(bg);getWindow().setStatusBarColor(bg);getWindow().getDecorView().setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  LinearLayout header=new LinearLayout(this);header.setOrientation(1);header.setPadding(dp(22),dp(14),dp(22),dp(10));TextView title=text("VPS CONTROL",24,ink);title.setTypeface(null,Typeface.BOLD);header.addView(title);header.addView(text(tr("Giám sát VPS · Chỉ đọc","VPS monitoring · Read only"),13,muted));root.addView(header);
  ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);content=new LinearLayout(this);content.setOrientation(1);content.setPadding(dp(18),dp(8),dp(18),dp(12));scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  if(tab==0)overview();else if(tab==1)connection();else settings();
  LinearLayout nav=new LinearLayout(this);String[] labels={tr("Tổng quan","Overview"),tr("Kết nối","Connect"),tr("Cài đặt","Settings")};
  for(int i=0;i<3;i++){final int target=i;Button b=new Button(this);b.setText(labels[i]);b.setAllCaps(false);b.setTextSize(12);b.setTextColor(i==tab?(dark?0xFF36D6AE:0xFF087D62):muted);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(surface));b.setOnClickListener(new View.OnClickListener(){public void onClick(View v){if(!pairing){tab=target;render();}}});nav.addView(b,new LinearLayout.LayoutParams(0,dp(56),1));}root.addView(nav);
  setContentView(root);root.requestApplyInsets();
 }
 private void overview(){
  Store.Session session=Store.session(this);Snapshot data=Store.snapshot(this);
  LinearLayout hero=card();
  if(session==null){hero.addView(text(tr("Kết nối điện thoại của anh","Connect your phone"),22,ink));hero.addView(text(Store.error(this).equals("auth")?tr("Quyền truy cập đã hết hạn hoặc bị thu hồi. Ghép nối lại để tiếp tục.","Access expired or was revoked. Pair again to continue."):tr("Tạo mã tại VPS Control → Settings → Mobile Devices, sau đó nhập ở mục Kết nối.","Generate a code in VPS Control → Settings → Mobile Devices, then enter it in Connect."),15,muted));button(hero,tr("Ghép nối thiết bị","Pair device"),new View.OnClickListener(){public void onClick(View v){tab=1;render();}});return;}
  int online=0,down=0,other=0;if(data!=null)for(Snapshot.Server s:data.servers){String state=s.state(data);if(state.equals("online"))online++;else if(state.equals("offline"))down++;else other++;}
  hero.addView(text(online+" / "+(data==null?"—":data.servers.size()),38,ink));hero.addView(text(tr("VPS có kết nối","Servers online"),16,muted));hero.addView(text(down+tr(" không truy cập · "," unreachable · ")+other+tr(" cũ / chưa rõ / đã tắt"," stale / unknown / disabled"),13,muted));
  hero.addView(text(tr("Lần nhận dữ liệu: ","Last received: ")+date(Store.received(this)),13,muted));
  if(data!=null&&!data.worker)hero.addView(text(tr("Bộ giám sát không hoạt động. Dữ liệu có thể đã cũ.","Monitoring worker is unavailable. Data may be stale."),14,0xFFD39428));
  String error=Store.error(this);if(!error.isEmpty())hero.addView(text(errorMessage(error),14,0xFFD39428));
  Button refresh=button(hero,Sync.busy()?tr("Đang cập nhật…","Refreshing…"):tr("Cập nhật dữ liệu","Refresh"),new View.OnClickListener(){public void onClick(View v){Sync.request(MainActivity.this,null);}});refresh.setEnabled(!Sync.busy());
  if(data==null)hero.addView(text(tr("Chưa nhận được dữ liệu. Kiểm tra kết nối và Mobile API trên máy chủ.","No snapshot received. Check your connection and the server Mobile API."),14,muted));
  if(data!=null&&data.servers.isEmpty())hero.addView(text(tr("Không có VPS trong phạm vi được cấp.","No servers in the granted scope."),14,muted));
  if(data!=null)for(final Snapshot.Server s:data.servers){
   String state=s.state(data);LinearLayout row=card();row.addView(text(s.name,20,ink));row.addView(text(Widgets.stateLabel(this,state),14,Widgets.color(this,state)));row.addView(text(Widgets.metrics(data,s),16,ink));row.addView(text(tr("Quan sát: ","Observed: ")+date(s.observed),12,muted));
   if(state.equals("online")){bars(row,s);row.addView(text(tr("Container dừng: ","Stopped containers: ")+count(s.stopped)+tr(" · Dịch vụ lỗi: "," · Failed services: ")+count(s.failed),13,muted));row.addView(text(tr("SSL sắp hết hạn: ","Expiring SSL: ")+count(s.certificates)+tr(" · Backup cũ: "," · Stale backup: ")+(s.backup==null?"—":s.backup?tr("Có","Yes"):tr("Không","No")),13,muted));}
   button(row,tr("Mở VPS trên trình duyệt","Open server in browser"),new View.OnClickListener(){public void onClick(View v){open(s.id.equals("local")?"/":"/servers/"+android.net.Uri.encode(s.id));}});
  }
  button(content,tr("Thêm widget","Add widget"),new View.OnClickListener(){public void onClick(View v){pickWidget();}});
  content.addView(text(tr("Số liệu lưu cũ luôn kèm giờ quan sát. “Không truy cập” là kết quả từ bộ giám sát, không khẳng định VPS đã tắt nguồn.","Cached data includes observation times. Unreachable means the monitor could not reach the host; it does not prove a powered-off server."),12,muted));
 }
 private void bars(LinearLayout parent,Snapshot.Server s){Double[] values={s.cpu,s.memory,s.disk};String[] names={"CPU","RAM","Disk"};int[] colors={0xFF36D6AE,0xFF56A8ED,0xFFF2BD61};for(int i=0;i<values.length;i++){if(values[i]==null)continue;LinearLayout line=new LinearLayout(this);line.setGravity(Gravity.CENTER_VERTICAL);TextView label=text(names[i],12,muted);line.addView(label,new LinearLayout.LayoutParams(dp(40),dp(26)));ProgressBar bar=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);bar.setMax(100);bar.setProgress((int)Math.round(values[i]));bar.setProgressTintList(android.content.res.ColorStateList.valueOf(colors[i]));line.addView(bar,new LinearLayout.LayoutParams(0,dp(12),1));parent.addView(line);}}
 private String count(Integer n){return n==null?"—":String.valueOf(n);}
 private String date(long n){return n<=0?"—":DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT,Store.vi(this)?Locale.forLanguageTag("vi-VN"):Locale.ENGLISH).format(new Date(n));}
 private void connection(){
  LinearLayout c=card();Store.Session session=Store.session(this);
  if(session!=null){c.addView(text(tr("Đã ghép nối","Paired"),22,ink));c.addView(text(session.base,15,muted));c.addView(text(tr("Hạn truy cập: ","Access expires: ")+date(session.expiry),13,muted));button(c,tr("Quản lý thiết bị trên web","Manage devices on web"),new View.OnClickListener(){public void onClick(View v){open("/settings");}});button(c,tr("Ngắt kết nối điện thoại","Disconnect phone"),new View.OnClickListener(){public void onClick(View v){new AlertDialog.Builder(MainActivity.this).setMessage(tr("Xóa token và dữ liệu lưu trên điện thoại? Anh có thể thu hồi thiết bị trong Settings trên web.","Erase the phone token and cache? You can also revoke the device in web Settings.")).setNegativeButton(tr("Hủy","Cancel"),null).setPositiveButton(tr("Ngắt kết nối","Disconnect"),new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int w){Store.clear(MainActivity.this,"");Sync.schedule(MainActivity.this);Widgets.updateAll(MainActivity.this);tab=1;render();}}).show();}});return;}
  c.addView(text(tr("Ghép nối thiết bị","Pair device"),22,ink));c.addView(text(tr("1. Mở Settings → Mobile Devices trên web.\n2. Chọn VPS được phép xem và tạo mã.\n3. Nhập địa chỉ HTTPS và dán mã trong 5 phút.","1. Open Settings → Mobile Devices on web.\n2. Select allowed servers and generate a code.\n3. Enter the HTTPS address and paste the code within 5 minutes."),15,muted));
  c.addView(text(tr("Địa chỉ VPS Control","VPS Control address"),14,ink));origin=input("https://panel.example.com",false);c.addView(origin);
  c.addView(text(tr("Mã ghép nối một lần","One-time pairing code"),14,ink));code=input("mp1_…",true);c.addView(code);
  final Button pair=button(c,pairing?tr("Đang ghép nối…","Pairing…"):tr("Kết nối","Connect"),new View.OnClickListener(){public void onClick(View v){pair();}});pair.setEnabled(!pairing);origin.setEnabled(!pairing);code.setEnabled(!pairing);
  c.addView(text(tr("Không nhập mật khẩu chủ tài khoản hoặc khóa SSH. Điện thoại chỉ được đọc dữ liệu giám sát.","Do not enter your owner password or SSH keys. This phone receives read-only monitoring access."),13,muted));
 }
 private EditText input(String hint,boolean secret){EditText field=new EditText(this);field.setTextColor(ink);field.setHintTextColor(muted);field.setHint(hint);field.setSingleLine(true);field.setTextSize(15);field.setInputType(secret?android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD:android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);field.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(secret?64:256)});return field;}
 private void pair(){
  if(pairing)return;final String base,oneTime=code.getText().toString().trim();
  try{base=Policy.origin(origin.getText().toString().trim());if(!Policy.code(oneTime))throw new Exception();}catch(Exception e){toast(tr("Nhập địa chỉ HTTPS gốc và mã mp1_ đầy đủ.","Enter the root HTTPS address and complete mp1_ code."));return;}
  final long generation=Store.generation();pairing=true;code.setText("");render();
  Sync.EXECUTOR.execute(new Runnable(){public void run(){String issue="";try{
   JSONObject result=Api.pair(base,oneTime);long expiry=Instant.parse(result.getString("expiresAt")).toEpochMilli();
   synchronized(Store.LOCK){if(Store.generation()!=generation)return;Store.saveSession(MainActivity.this,base,result.getString("token"),expiry);}
  }catch(Exception e){issue=errorMessage(e instanceof Api.Failure?((Api.Failure)e).kind:e instanceof javax.net.ssl.SSLException?"tls":"network");}
  final String message=issue;runOnUiThread(new Runnable(){public void run(){pairing=false;if(isFinishing()||isDestroyed())return;if(message.isEmpty()){tab=0;Sync.schedule(MainActivity.this);Sync.request(MainActivity.this,null);}else toast(message);render();}});
  }});
 }
 private void settings(){
  LinearLayout c=card();c.addView(text(tr("Tùy chỉnh","Preferences"),22,ink));
  choice(c,tr("Ngôn ngữ","Language"),"language",new String[]{"system","vi","en"},new String[]{tr("Theo hệ thống","System"),"Tiếng Việt","English"});
  choice(c,tr("Giao diện","Theme"),"theme",new String[]{"system","light","dark"},new String[]{tr("Theo hệ thống","System"),tr("Sáng","Light"),tr("Tối","Dark")});
  choice(c,tr("Chu kỳ cập nhật","Refresh interval"),"interval",new String[]{"15","30","60"},new String[]{tr("15 phút","15 minutes"),tr("30 phút","30 minutes"),tr("60 phút","60 minutes")});
  c.addView(text(tr("Android có thể trì hoãn cập nhật khi tiết kiệm pin, Doze hoặc mất mạng. Nhấn ↻ để cập nhật thủ công; không đảm bảo đúng từng phút.","Android may delay refresh during battery saving, Doze or disconnection. Tap ↻ to refresh manually; timing is best effort."),14,muted));
  button(c,tr("Thêm widget vào màn hình chính","Add home-screen widget"),new View.OnClickListener(){public void onClick(View v){pickWidget();}});
  c.addView(text(tr("Chạm tiêu đề widget để chọn lại VPS. Mỗi widget có lựa chọn riêng; kéo cạnh để đổi kích thước.","Tap a widget title to change its servers. Each widget has its own selection; drag its edges to resize."),14,muted));
  c.addView(text("V1.0.0 · Android 10+\nJava · RemoteViews · HTTPS",12,muted));
 }
 private void choice(LinearLayout parent,String title,final String name,final String[] values,final String[] labels){
  String fallback=name.equals("interval")?"15":"system",current=Store.setting(this,name,fallback);int selected=0;for(int i=0;i<values.length;i++)if(values[i].equals(current))selected=i;
  final int checked=selected;
  button(parent,title+" · "+labels[selected],new View.OnClickListener(){public void onClick(View v){new AlertDialog.Builder(MainActivity.this).setTitle(title).setSingleChoiceItems(labels,checked,new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int index){Store.putSetting(MainActivity.this,name,values[index]);Sync.schedule(MainActivity.this);Widgets.updateAll(MainActivity.this);d.dismiss();render();}}).setNegativeButton(tr("Hủy","Cancel"),null).show();}});
 }
 private void pickWidget(){final Class<?>[] types={Widgets.Fleet.class,Widgets.Single.class,Widgets.Wide.class,Widgets.Large.class};new AlertDialog.Builder(this).setTitle(tr("Chọn widget","Choose widget")).setItems(new String[]{"Fleet · 2×2","Server · 2×2","Fleet · 4×2","Fleet · 4×4"},new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int index){AppWidgetManager m=AppWidgetManager.getInstance(MainActivity.this);if(!m.isRequestPinAppWidgetSupported()||!m.requestPinAppWidget(new ComponentName(MainActivity.this,types[index]),null,null))toast(tr("Nhấn giữ màn hình chính → Widget → VPS Control.","Long press home screen → Widgets → VPS Control."));}}).show();}
 private void open(String path){Store.Session s=Store.session(this);if(s==null)return;try{startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(s.base+path)));}catch(ActivityNotFoundException e){toast(tr("Chưa có trình duyệt.","No browser installed."));}}
 private void toast(String value){Toast.makeText(this,value,Toast.LENGTH_LONG).show();}
 private String errorMessage(String kind){
  if(kind.equals("auth")||kind.equals("code"))return tr("Mã không hợp lệ, đã dùng hoặc hết hạn; hoặc quyền thiết bị đã bị thu hồi. Tạo mã mới trên web.","Code invalid, used or expired, or device access revoked. Generate a new code on web.");
  if(kind.equals("tls"))return tr("Chứng chỉ HTTPS không hợp lệ. Kiểm tra máy chủ.","HTTPS certificate validation failed. Check the server.");
  if(kind.equals("rate"))return tr("Quá nhiều yêu cầu. Đợi ít nhất một phút rồi thử lại.","Too many requests. Wait at least one minute and retry.");
  if(kind.equals("redirect"))return tr("Máy chủ chuyển hướng. Nhập đúng địa chỉ HTTPS gốc.","Server redirected. Enter the final root HTTPS address.");
  if(kind.equals("unavailable"))return tr("Mobile API chưa khả dụng trên máy chủ này.","Mobile API is not available on this server.");
  if(kind.equals("format"))return tr("Dữ liệu máy chủ không hợp lệ.","Invalid server response.");
  if(kind.equals("server"))return tr("Máy chủ tạm thời không phản hồi dữ liệu.","Server data is temporarily unavailable.");
  return tr("Không cập nhật được. Kiểm tra mạng; dữ liệu lưu cũ vẫn hiển thị kèm thời gian.","Refresh failed. Check the network; cached data retains its timestamps.");
 }
}
