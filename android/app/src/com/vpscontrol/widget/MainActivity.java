package com.vpscontrol.widget;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.*;
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
 private Visuals palette;
 private boolean pairing,registered;
 private EditText origin,code;
 private final BroadcastReceiver updates=new BroadcastReceiver(){public void onReceive(Context c,Intent i){if(Updates.CHANGED.equals(i.getAction())){if(tab!=1)render();Updates.resume(MainActivity.this);}else if(tab==0||tab==1&&Store.session(c)!=null)render();}};
 public void onCreate(Bundle state){super.onCreate(state);if(state!=null)tab=state.getInt("tab",0);render();Sync.schedule(this);}
 public void onStart(){super.onStart();Updates.check(this);}
 public void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putInt("tab",tab);}
 public void onResume(){super.onResume();IntentFilter filter=new IntentFilter(Sync.CHANGED);filter.addAction(Updates.CHANGED);if(android.os.Build.VERSION.SDK_INT>=33)registerReceiver(updates,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(updates,filter);registered=true;render();Updates.resume(this);Sync.schedule(this);if(Store.session(this)!=null)Sync.request(this,null);}
 public void onPause(){if(registered){unregisterReceiver(updates);registered=false;}super.onPause();}
 private String tr(String vi,String en){return Store.tr(this,vi,en);}
 private int dp(int n){return Visuals.dp(this,n);}
 private TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setFontFeatureSettings("tnum");t.setPadding(0,dp(4),0,dp(4));return t;}
 private TextView heading(String value,int size,int color){TextView t=text(value,size,color);t.setTypeface(Typeface.create("sans-serif-medium",0));return t;}
 private LinearLayout vertical(){LinearLayout c=new LinearLayout(this);c.setOrientation(1);return c;}
 private LinearLayout card(){LinearLayout c=vertical();c.setPadding(dp(20),dp(18),dp(20),dp(18));c.setBackground(Visuals.shape(surface,dp(26)));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(14);content.addView(c,lp);return c;}
 private void gap(LinearLayout parent,int height){parent.addView(new View(this),new LinearLayout.LayoutParams(1,dp(height)));}
 private void clickable(View v,int color){v.setBackground(new RippleDrawable(ColorStateList.valueOf(palette.line),Visuals.shape(color,dp(16)),Visuals.shape(-1,dp(16))));}
 private TextView button(LinearLayout parent,String label,View.OnClickListener listener){TextView b=heading(label,15,palette.accent);b.setGravity(Gravity.CENTER);b.setPadding(dp(14),dp(14),dp(14),dp(14));b.setMinHeight(dp(48));clickable(b,palette.inset);b.setOnClickListener(listener);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(10);parent.addView(b,lp);return b;}
 private void primary(TextView b){b.setTextColor(Store.dark(this)?0xFF201638:0xFFFFFFFF);clickable(b,palette.accent);}
 private ImageView icon(String name,int color){ImageView i=new ImageView(this);i.setImageBitmap(Visuals.icon(this,name,color));i.setScaleType(ImageView.ScaleType.FIT_CENTER);return i;}
 private void render(){
  palette=new Visuals(this);ink=palette.ink;muted=palette.muted;bg=palette.bg;surface=palette.surface;boolean dark=Store.dark(this);
  if(tab==1)getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
  root=vertical();root.setBackgroundColor(bg);
  root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener(){public WindowInsets onApplyWindowInsets(View v,WindowInsets i){v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;}});
  getWindow().setNavigationBarColor(bg);getWindow().setStatusBarColor(bg);getWindow().getDecorView().setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(dp(24),dp(16),dp(24),dp(16));LinearLayout titles=vertical();titles.addView(text("VPS CONTROL",11,palette.accent));titles.addView(heading(tab==0?tr("Tổng quan","Overview"):tab==1?tr("Kết nối","Connection"):tr("Cài đặt","Settings"),30,ink));header.addView(titles,new LinearLayout.LayoutParams(0,-2,1));
  ImageView action=icon(tab==0?"refresh":tab==1?"connect":"settings",palette.accent);action.setPadding(dp(12),dp(12),dp(12),dp(12));clickable(action,palette.inset);header.addView(action,new LinearLayout.LayoutParams(dp(48),dp(48)));if(tab==0){action.setContentDescription(tr("Cập nhật dữ liệu","Refresh data"));action.setOnClickListener(new View.OnClickListener(){public void onClick(View v){Sync.request(MainActivity.this,null);}});}else action.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);root.addView(header);
  ScrollView scroll=new ScrollView(this);scroll.setClipToPadding(false);scroll.setFillViewport(true);content=vertical();content.setPadding(dp(20),dp(4),dp(20),dp(12));scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
  if(tab==0)overview();else if(tab==1)connection();else settings();
  LinearLayout nav=new LinearLayout(this);nav.setPadding(dp(16),dp(8),dp(16),dp(8));String[] labels={tr("Tổng quan","Overview"),tr("Kết nối","Connect"),tr("Cài đặt","Settings")};String[] icons={"overview","connect","settings"};
  for(int i=0;i<3;i++){final int target=i;LinearLayout item=vertical();item.setGravity(Gravity.CENTER);item.setTag("nav:"+i);item.setContentDescription(labels[i]);item.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);clickable(item,i==tab?palette.inset:bg);ImageView glyph=icon(icons[i],i==tab?palette.accent:muted);item.addView(glyph,new LinearLayout.LayoutParams(dp(23),dp(23)));TextView label=heading(labels[i],11,i==tab?palette.accent:muted);label.setGravity(Gravity.CENTER);item.addView(label);item.setOnClickListener(new View.OnClickListener(){public void onClick(View v){if(!pairing){tab=target;render();}}});LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,dp(64),1);lp.leftMargin=dp(3);lp.rightMargin=dp(3);nav.addView(item,lp);}root.addView(nav);
  setContentView(root);root.requestApplyInsets();
 }
 private void overview(){
  if(Updates.candidate!=null||Updates.busy()||Updates.phase.equals("permission"))updatesCard();
  Store.Session session=Store.session(this);Snapshot data=Store.snapshot(this);
  if(session==null){LinearLayout c=card();ImageView glyph=icon("server",palette.accent);c.addView(glyph,new LinearLayout.LayoutParams(dp(56),dp(56)));gap(c,18);c.addView(heading(tr("VPS trong tầm tay","Your servers, at a glance"),27,ink));c.addView(text(Store.error(this).equals("auth")?tr("Quyền thiết bị đã hết hạn hoặc bị thu hồi. Ghép nối lại để tiếp tục.","Device access expired or was revoked. Pair again to continue."):tr("Theo dõi tài nguyên và trạng thái máy chủ ngay trên điện thoại và màn hình chính.","Keep server status and resources close, on your phone and home screen."),15,muted));primary(button(c,tr("Ghép nối thiết bị","Pair your phone"),new View.OnClickListener(){public void onClick(View v){tab=1;render();}}));return;}
  int online=0,down=0,other=0;if(data!=null)for(Snapshot.Server s:data.servers){String state=s.state(data);if(state.equals("online"))online++;else if(state.equals("offline"))down++;else other++;}
  LinearLayout sync=new LinearLayout(this);sync.setGravity(Gravity.CENTER_VERTICAL);TextView label=text(Sync.busy()?tr("Đang đồng bộ…","Refreshing…"):tr("Cập nhật ","Updated ")+Widgets.time(this,Store.received(this)),12,muted);sync.addView(label,new LinearLayout.LayoutParams(0,-2,1));sync.addView(heading(tr("CHỈ ĐỌC","READ ONLY"),10,palette.accent));LinearLayout.LayoutParams slp=new LinearLayout.LayoutParams(-1,-2);slp.bottomMargin=dp(14);content.addView(sync,slp);
  if(data==null){LinearLayout c=card();c.addView(heading(tr("Đang chờ dữ liệu","Waiting for data"),22,ink));c.addView(text(tr("Chạm nút cập nhật để lấy trạng thái mới nhất từ máy chủ.","Tap refresh to get the latest server observations."),14,muted));}
  if(data!=null&&data.servers.size()>1){LinearLayout c=card();c.addView(heading(online+" / "+data.servers.size(),38,ink));c.addView(text(tr("VPS đang kết nối","Servers online"),15,palette.green));c.addView(text(down+tr(" mất kết nối · "," unreachable · ")+other+tr(" cần kiểm tra"," to review"),12,muted));}
  if(data!=null&&!data.worker)notice(tr("Bộ giám sát chưa hoạt động. Kiểm tra giờ quan sát trước khi sử dụng số liệu.","Monitor unavailable. Check observation times before using these readings."));
  if(!Store.error(this).isEmpty())notice(errorMessage(Store.error(this)));
  if(data!=null&&data.servers.isEmpty())notice(tr("Không có VPS trong phạm vi được cấp.","No servers in the granted scope."));
  if(data!=null)for(final Snapshot.Server s:data.servers){
   String state=s.state(data);boolean live=state.equals("online");LinearLayout row=card();LinearLayout title=new LinearLayout(this);title.setGravity(Gravity.CENTER_VERTICAL);ImageView glyph=icon("server",palette.accent);glyph.setPadding(dp(9),dp(9),dp(9),dp(9));glyph.setBackground(Visuals.shape(palette.inset,dp(14)));title.addView(glyph,new LinearLayout.LayoutParams(dp(42),dp(42)));LinearLayout name=vertical();name.setPadding(dp(12),0,0,0);TextView serverName=heading(s.name,21,ink);name.addView(serverName);name.addView(text("● "+Widgets.stateLabel(this,state),12,palette.state(state)));title.addView(name,new LinearLayout.LayoutParams(0,-2,1));row.addView(title);gap(row,12);
   Visuals.Meter meter=new Visuals.Meter(this,live?new Double[]{s.cpu,s.memory,s.disk}:new Double[]{null,null,null});row.addView(meter,new LinearLayout.LayoutParams(-1,dp(126)));gap(row,8);row.addView(text(tr("Quan sát ","Observed ")+date(s.observed),11,muted));
   if(live){ArrayList<String> alerts=new ArrayList<String>();if(s.stopped!=null&&s.stopped>0)alerts.add(s.stopped+tr(" container dừng"," stopped containers"));if(s.failed!=null&&s.failed>0)alerts.add(s.failed+tr(" dịch vụ lỗi"," failed services"));if(s.certificates!=null&&s.certificates>0)alerts.add(s.certificates+tr(" SSL sắp hết hạn"," expiring SSL"));if(Boolean.TRUE.equals(s.backup))alerts.add(tr("Cần kiểm tra backup","Check backup freshness"));for(String a:alerts)row.addView(text("• "+a,13,palette.amber));}
   button(row,tr("Mở bảng điều khiển  ↗","Open dashboard  ↗"),new View.OnClickListener(){public void onClick(View v){open(s.id.equals("local")?"/":"/servers/"+android.net.Uri.encode(s.id));}});
  }
  LinearLayout add=card();LinearLayout line=new LinearLayout(this);line.setGravity(Gravity.CENTER_VERTICAL);ImageView glyph=icon("widget",palette.accent);line.addView(glyph,new LinearLayout.LayoutParams(dp(30),dp(30)));LinearLayout copy=vertical();copy.setPadding(dp(14),0,0,0);copy.addView(heading(tr("Đưa VPS ra màn hình chính","Bring servers to your home screen"),16,ink));copy.addView(text(tr("Số liệu rõ ràng, chỉ một cái nhìn.","A clear view without opening the app."),13,muted));line.addView(copy,new LinearLayout.LayoutParams(0,-2,1));add.addView(line);primary(button(add,tr("Thêm widget","Add widget"),new View.OnClickListener(){public void onClick(View v){pickWidget();}}));
 }
 private void notice(String value){LinearLayout c=card();c.addView(text(value,14,palette.amber));}
 private String date(long n){return n<=0?"—":DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT,Store.vi(this)?Locale.forLanguageTag("vi-VN"):Locale.ENGLISH).format(new Date(n));}
 private AlertDialog.Builder dialog(){return new AlertDialog.Builder(this,Store.dark(this)?android.R.style.Theme_Material_Dialog_Alert:android.R.style.Theme_Material_Light_Dialog_Alert);}
 private void connection(){
  Store.Session session=Store.session(this);LinearLayout c=card();ImageView glyph=icon("connect",palette.accent);c.addView(glyph,new LinearLayout.LayoutParams(dp(48),dp(48)));gap(c,14);
  if(session!=null){c.addView(heading(tr("Đã ghép nối an toàn","Securely connected"),24,ink));c.addView(text("● "+tr("Quyền xem dữ liệu","Read-only access"),13,palette.green));gap(c,16);c.addView(heading(session.base.replaceFirst("https://",""),18,ink));c.addView(text(tr("Quyền truy cập đến ","Access until ")+date(session.expiry),12,muted));button(c,tr("Quản lý thiết bị trên web  ↗","Manage devices on web  ↗"),new View.OnClickListener(){public void onClick(View v){open("/settings");}});TextView disconnect=button(c,tr("Ngắt kết nối điện thoại","Disconnect this phone"),new View.OnClickListener(){public void onClick(View v){dialog().setTitle(tr("Ngắt kết nối?","Disconnect?" )).setMessage(tr("Xóa quyền truy cập và số liệu lưu trên điện thoại. Anh có thể thu hồi thiết bị trong Settings trên web.","Erase device access and cached readings from this phone. You can also revoke the device in web Settings.")).setNegativeButton(tr("Hủy","Cancel"),null).setPositiveButton(tr("Ngắt kết nối","Disconnect"),new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int w){Store.clear(MainActivity.this,"");Sync.schedule(MainActivity.this);Widgets.updateAll(MainActivity.this);tab=1;render();}}).show();}});disconnect.setTextColor(palette.red);return;}
  c.addView(heading(tr("Kết nối với VPS của anh","Connect your VPS"),24,ink));c.addView(text(tr("Trên web, vào Settings → Mobile Devices, chọn VPS và tạo mã ghép nối 5 phút.","On the web, go to Settings → Mobile Devices, select servers and generate a 5-minute pairing code."),14,muted));gap(c,18);
  c.addView(heading(tr("Địa chỉ máy chủ","Server address"),13,ink));origin=input("https://vps.mywf.in",false);c.addView(origin);gap(c,14);c.addView(heading(tr("Mã ghép nối","Pairing code"),13,ink));code=input("mp1_…",true);c.addView(code);gap(c,8);
  TextView pair=button(c,pairing?tr("Đang ghép nối…","Pairing…"):tr("Ghép nối thiết bị","Pair device"),new View.OnClickListener(){public void onClick(View v){pair();}});primary(pair);pair.setEnabled(!pairing);origin.setEnabled(!pairing);code.setEnabled(!pairing);gap(c,12);c.addView(text(tr("Kết nối được mã hóa. Điện thoại chỉ nhận quyền đọc dữ liệu giám sát.","Encrypted connection. This phone receives read-only monitoring access."),12,muted));
 }
 private EditText input(String hint,boolean secret){EditText f=new EditText(this);f.setTextColor(ink);f.setHintTextColor(muted);f.setHint(hint);f.setSingleLine(true);f.setTextSize(15);f.setPadding(dp(14),dp(14),dp(14),dp(14));f.setBackground(Visuals.shape(palette.inset,dp(14)));f.setInputType(secret?android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD:android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);f.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);f.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(secret?64:256)});return f;}
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
  updatesCard();
  TextView section=heading(tr("CÁ NHÂN HÓA","PERSONALIZE"),11,muted);section.setPadding(dp(6),dp(6),0,dp(12));content.addView(section);LinearLayout c=card();
  choice(c,tr("Ngôn ngữ","Language"),"language",new String[]{"system","vi","en"},new String[]{tr("Theo hệ thống","System"),"Tiếng Việt","English"});
  choice(c,tr("Giao diện","Appearance"),"theme",new String[]{"system","light","dark"},new String[]{tr("Theo hệ thống","System"),tr("Sáng","Light"),tr("Tối","Dark")});
  choice(c,tr("Làm mới dữ liệu","Refresh interval"),"interval",new String[]{"15","30","60"},new String[]{tr("15 phút","15 minutes"),tr("30 phút","30 minutes"),tr("60 phút","60 minutes")});
  gap(c,12);c.addView(text(tr("Android có thể trì hoãn cập nhật khi tiết kiệm pin hoặc mất mạng. Chạm nút làm mới để cập nhật thủ công.","Android may delay updates while saving battery or offline. Tap refresh for a manual update."),12,muted));
  LinearLayout w=card();w.addView(heading(tr("Widget của anh","Your widgets"),21,ink));w.addView(text(tr("Chọn một VPS để xem tài nguyên chi tiết, hoặc nhiều VPS để xem tổng quan. Bố cục tự đổi khi anh kéo giãn widget.","Choose one server for resource details, or several for a fleet overview. The layout adapts as you resize."),14,muted));primary(button(w,tr("Thêm widget vào màn hình chính","Add home-screen widget"),new View.OnClickListener(){public void onClick(View v){pickWidget();}}));gap(w,6);w.addView(text(tr("Chạm bánh răng trên widget để chỉnh nền, độ trong suốt và kiểu hiển thị.","Tap the gear on a widget to customize its background, transparency and display."),12,muted));
  final AppWidgetManager manager=AppWidgetManager.getInstance(this);int index=0;for(final int id:Widgets.installed(this)){AppWidgetProviderInfo info=manager.getAppWidgetInfo(id);if(info==null)continue;index++;java.util.List<Snapshot.Server> selected=Widgets.selection(this,id,Store.snapshot(this));String names=selected.size()==1?selected.get(0).name:selected.size()+tr(" VPS"," servers");button(w,tr("Tùy chỉnh widget ","Customize widget ")+index+" · "+names,new View.OnClickListener(){public void onClick(View v){startActivity(new Intent(MainActivity.this,WidgetSetupActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id));}});}
  if(index==0)w.addView(text(tr("Sau khi thêm widget, anh cũng có thể tùy chỉnh từng widget tại đây.","After adding widgets, you can customize each one here too."),12,muted));
  TextView version=text("VPS Control · "+Updates.versionName(this),12,muted);version.setGravity(Gravity.CENTER);content.addView(version);
 }
 private void updatesCard(){
  LinearLayout c=card();c.setTag("updates-card");c.addView(heading(tr("Cập nhật ứng dụng","App updates"),20,ink));c.addView(text(tr("Đang dùng ","Installed ")+Updates.versionName(this),12,muted));c.addView(text(Updates.message(this),14,Updates.phase.equals("error")?palette.amber:palette.accent));
  if(Updates.candidate!=null&&!Updates.candidate.notes.isEmpty())c.addView(text(Updates.candidate.notes,13,muted));
  String phase=Updates.phase;
  if(phase.equals("available")){primary(button(c,tr("Tải và cập nhật","Download and update"),new View.OnClickListener(){public void onClick(View v){Updates.download(MainActivity.this);}}));}
  else if(phase.equals("ready")||phase.equals("permission")){primary(button(c,tr("Tiếp tục cài đặt","Continue installation"),new View.OnClickListener(){public void onClick(View v){Updates.install(MainActivity.this);}}));button(c,tr("Hủy cập nhật","Cancel update"),new View.OnClickListener(){public void onClick(View v){Updates.cancel(MainActivity.this);}});}
  else if(phase.equals("downloading")){button(c,tr("Hủy tải","Cancel download"),new View.OnClickListener(){public void onClick(View v){Updates.cancel(MainActivity.this);}});}
  else if(!Updates.busy()&&!phase.equals("checking")){button(c,tr("Kiểm tra trên GitHub","Check GitHub"),new View.OnClickListener(){public void onClick(View v){Updates.check(MainActivity.this);}});}
 }
 private void choice(LinearLayout parent,final String title,final String name,final String[] values,final String[] labels){String current=Store.setting(this,name,name.equals("interval")?"15":"system");int selected=0;for(int i=0;i<values.length;i++)if(values[i].equals(current))selected=i;final int checked=selected;
  LinearLayout row=new LinearLayout(this);row.setPadding(0,dp(9),0,dp(9));row.setGravity(Gravity.CENTER_VERTICAL);LinearLayout copy=vertical();copy.addView(heading(title,16,ink));copy.addView(text(labels[selected],13,muted));row.addView(copy,new LinearLayout.LayoutParams(0,-2,1));TextView arrow=text("›",26,palette.accent);row.addView(arrow);parent.addView(row,new LinearLayout.LayoutParams(-1,-2));row.setOnClickListener(new View.OnClickListener(){public void onClick(View v){dialog().setTitle(title).setSingleChoiceItems(labels,checked,new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int index){Store.putSetting(MainActivity.this,name,values[index]);Sync.schedule(MainActivity.this);Widgets.updateAll(MainActivity.this);d.dismiss();render();}}).setNegativeButton(tr("Hủy","Cancel"),null).show();}});row.setContentDescription(title+": "+labels[selected]);View divider=new View(this);divider.setBackgroundColor(palette.line);parent.addView(divider,new LinearLayout.LayoutParams(-1,dp(1)));}
 private void pickWidget(){final Class<?>[] types={Widgets.Fleet.class,Widgets.Single.class,Widgets.Wide.class,Widgets.Large.class};dialog().setTitle(tr("Chọn widget","Choose widget")).setItems(new String[]{tr("Tổng quan · 2×2","Overview · 2×2"),tr("Một VPS · 2×2","One server · 2×2"),tr("Ngang · 4×2","Wide · 4×2"),tr("Chi tiết · 4×4","Detailed · 4×4")},new DialogInterface.OnClickListener(){public void onClick(DialogInterface d,int index){AppWidgetManager m=AppWidgetManager.getInstance(MainActivity.this);if(!m.isRequestPinAppWidgetSupported()||!m.requestPinAppWidget(new ComponentName(MainActivity.this,types[index]),null,null))toast(tr("Nhấn giữ màn hình chính → Widget → VPS Control.","Long press home screen → Widgets → VPS Control."));}}).show();}
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
