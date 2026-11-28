package com.vpscontrol.widget;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.text.TextUtils;
import java.util.*;
/** Native drawing shared by the dashboard and RemoteViews. Only current observations. */
public final class Visuals {
 public final int bg,surface,inset,ink,muted,accent,green,red,amber,line;
 public final int[] metric;
 public Visuals(Context c){this(Store.dark(c),"violet",255,false);}
 public static Visuals widget(WidgetStyle s,Context c){return new Visuals(s.dark(c),s.accent,s.alpha(),true);}
 private Visuals(boolean d,String accentName,int alpha,boolean widget){
  bg=d?0xFF10121B:0xFFF3F4F9;surface=d?0xFF1B1E2D:widget?0xFFE6EAF2:0xFFFFFFFF;
  int panel=d?0xFF252A3C:widget?0xFFD8DFEB:0xFFF0F1F7;inset=(panel&0x00FFFFFF)|(alpha<<24);
  ink=d?0xFFF4F5FC:0xFF202D43;muted=d?0xFFB2B9CD:0xFF53627A;
  accent=accentName.equals("blue")?(d?0xFF92C3FF:0xFF2B69B9):accentName.equals("teal")?(d?0xFF68D9CB:0xFF087E72):accentName.equals("amber")?(d?0xFFF2C77E:0xFF98600B):(d?0xFFB6A7FF:0xFF6954CD);
  green=d?0xFF64DDB1:0xFF16835F;red=d?0xFFFF909D:0xFFC53F56;amber=d?0xFFF4CA7B:0xFF9B6A18;
  int track=d?0xFF424B64:0xFFACB7CD;line=widget?(track&0x00FFFFFF)|(Math.max(75,alpha*2/3)<<24):(d?0xFF30364B:0xFFE5E7F1);
  metric=new int[]{accent,d?0xFF83B8FF:0xFF3978CB,green};
 }
 public int state(String s){return s.equals("online")?green:s.equals("offline")?red:s.equals("stale")?amber:muted;}
 public static int dp(Context c,float n){return Math.round(n*c.getResources().getDisplayMetrics().density);}
 public static GradientDrawable shape(int color,float radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);return d;}
 private static final Typeface MEDIUM=Typeface.create("sans-serif-medium",Typeface.NORMAL),REGULAR=Typeface.create("sans-serif",Typeface.NORMAL);
 private static Paint paint(int color){Paint p=new Paint(3);p.setColor(color);return p;}
 private static void label(Canvas c,String text,float x,float y,float size,int color,boolean bold){Paint p=paint(color);p.setTypeface(bold?MEDIUM:REGULAR);p.setTextSize(size);c.drawText(text,x,y,p);}
 private static void fit(Canvas c,String text,float x,float y,float width,float size,int color,boolean bold){android.text.TextPaint p=new android.text.TextPaint(paint(color));p.setTypeface(bold?MEDIUM:REGULAR);p.setTextSize(size);c.drawText(TextUtils.ellipsize(text,p,width,TextUtils.TruncateAt.END).toString(),x,y,p);}
 private static void center(Canvas c,String text,float x,float y,float size,int color,boolean bold){Paint p=paint(color);p.setTypeface(bold?MEDIUM:REGULAR);p.setTextSize(size);p.setTextAlign(Paint.Align.CENTER);c.drawText(text,x,y,p);}
 private static void number(Canvas c,String text,float x,float y,float size,float maxWidth,int color){Paint p=paint(color);p.setTypeface(MEDIUM);p.setTextSize(size);float width=p.measureText(text);if(width>maxWidth)size*=maxWidth/width;center(c,text,x,y,size,color,true);}
 private static void smallLabel(Canvas c,String text,float x,float y,float size,float maxWidth,int color){Paint p=paint(color);p.setTypeface(REGULAR);p.setTextSize(size);float width=p.measureText(text);if(width>maxWidth)size*=maxWidth/width;center(c,text,x,y,size,color,false);}
 private static void bar(Canvas c,float x,float y,float width,float h,Double value,int fill,int track){Paint p=paint(track);c.drawRoundRect(x,y,x+width,y+h,h,h,p);if(value!=null&&value>0){p.setColor(fill);c.drawRoundRect(x,y,x+width*(float)(value/100),y+h,h,h,p);}}
 public static Bitmap icon(Context c,String name,int color){Bitmap b=Bitmap.createBitmap(72,72,Bitmap.Config.ARGB_8888);Canvas cv=new Canvas(b);cv.scale(3,3);Paint p=paint(color);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(1.7f);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);
  if(name.equals("refresh")){cv.drawArc(4,4,20,20,40,295,false,p);cv.drawLine(20,4,20,10,p);cv.drawLine(20,10,14,10,p);}
  else if(name.equals("overview")){for(int x=4;x<=13;x+=9)for(int y=4;y<=13;y+=9)cv.drawRoundRect(x,y,x+7,y+7,2,2,p);}
  else if(name.equals("connect")){cv.drawRoundRect(7,2,17,22,3,3,p);cv.drawLine(10,18,14,18,p);cv.drawLine(10,6,14,6,p);}
  else if(name.equals("settings")){cv.drawCircle(12,12,7,p);cv.drawCircle(12,12,2.5f,p);for(int a=0;a<360;a+=60){double r=a*Math.PI/180;cv.drawLine(12+7*(float)Math.cos(r),12+7*(float)Math.sin(r),12+10*(float)Math.cos(r),12+10*(float)Math.sin(r),p);}}
  else if(name.equals("server")){cv.drawRoundRect(3,3,21,11,2,2,p);cv.drawRoundRect(3,14,21,22,2,2,p);cv.drawLine(7,7,7.1f,7,p);cv.drawLine(7,18,7.1f,18,p);cv.drawLine(12,7,17,7,p);cv.drawLine(12,18,17,18,p);}
  else if(name.equals("widget")){cv.drawRoundRect(3,3,21,21,4,4,p);cv.drawLine(3,10,21,10,p);cv.drawLine(11,10,11,21,p);}
  else if(name.equals("arrow")){cv.drawLine(5,12,19,12,p);cv.drawLine(14,7,19,12,p);cv.drawLine(14,17,19,12,p);}
  return b;
 }
 private static Bitmap bitmap(int width,int height){int w=Math.max(1,width),h=Math.max(1,height);float scale=Math.min(2f,(float)Math.sqrt(180000.0/(w*(double)h)));return Bitmap.createBitmap(Math.max(1,(int)(w*scale)),Math.max(1,(int)(h*scale)),Bitmap.Config.ARGB_8888);}
 public static Bitmap metrics(Context c,int w,int h,Double[] values){return metrics(c,w,h,values,null);}
 public static Bitmap metrics(Context c,int width,int height,Double[] values,WidgetStyle style){int w=Math.max(1,width),h=Math.max(1,height);Bitmap b=bitmap(w,h);Canvas cv=new Canvas(b);cv.scale(b.getWidth()/(float)w,b.getHeight()/(float)h);drawMetrics(c,cv,w,h,values,style==null?new Visuals(c):style.palette(c),style==null?"auto":style.layout);return b;}
 static void drawMetrics(Context c,Canvas cv,float w,float h,Double[] values){drawMetrics(c,cv,w,h,values,new Visuals(c),"auto");}
 private static void mini(Context context,Canvas c,float w,float h,Double[] values,Visuals v,boolean tracks){String[] names={"CPU","RAM",Store.tr(context,"Ổ đĩa","Disk")};float fs=Math.min(1.18f,context.getResources().getConfiguration().fontScale),col=w/3;for(int i=0;i<3;i++){float x=i*col;number(c,Widgets.percent(values[i]),x+col/2,Math.max(15,Math.min(h-14,h*.43f)),Math.min(23,col*.46f)*fs,col-5,values[i]==null?v.muted:v.metric[i]);smallLabel(c,names[i],x+col/2,Math.min(h-3,Math.max(27,h*.77f)),10*fs,col-4,v.muted);if(tracks&&h>=49)bar(c,x+5,h-4,col-10,3,values[i],v.metric[i],v.line);}}
 private static void drawMetrics(Context context,Canvas c,float w,float h,Double[] values,Visuals v,String layout){
  String[] names={"CPU","RAM",Store.tr(context,"Ổ đĩa","Disk")};float fs=Math.min(1.18f,context.getResources().getConfiguration().fontScale);
  if(layout.equals("numbers")){if(h<75||w<150){mini(context,c,w,h,values,v,false);return;}float col=w/3,cy=h/2;for(int i=0;i<3;i++){number(c,Widgets.percent(values[i]),col*(i+.5f),cy,Math.min(42,col*.52f)*fs,col-8,values[i]==null?v.muted:v.metric[i]);smallLabel(c,names[i],col*(i+.5f),cy+25,13*fs,col-8,v.muted);}return;}
  if(h<52||w<145){mini(context,c,w,h,values,v,true);return;}
  boolean bars=layout.equals("bars")||layout.equals("auto")&&h>w*.75f&&h>180;
  if(bars){float row=h/3;for(int i=0;i<3;i++){float y=i*row;if(h<180){label(c,names[i],2,y+row*.5f+4,11*fs,v.muted,false);Paint p=paint(values[i]==null?v.muted:v.metric[i]);p.setTypeface(MEDIUM);p.setTextSize(14*fs);p.setTextAlign(Paint.Align.RIGHT);c.drawText(Widgets.percent(values[i]),w-2,y+row*.5f+4,p);bar(c,48,y+row*.5f-3,Math.max(8,w-100),6,values[i],v.metric[i],v.line);}else{Paint p=paint(v.inset);c.drawRoundRect(0,y+3,w,y+row-6,14,14,p);label(c,names[i],14,y+25,12*fs,v.muted,false);p=paint(values[i]==null?v.muted:v.metric[i]);p.setTypeface(MEDIUM);p.setTextSize(Math.min(28,row*.4f)*fs);p.setTextAlign(Paint.Align.RIGHT);c.drawText(Widgets.percent(values[i]),w-14,y+29,p);bar(c,14,y+row-20,w-28,6,values[i],v.metric[i],v.line);}}return;}
  boolean vertical=layout.equals("rings")&&h>w*.8f&&h>190;
  if(vertical){float row=h/3,r=Math.min(39,(row-20)/2);for(int i=0;i<3;i++){float cy=row*(i+.5f);Paint p=paint(v.inset);c.drawRoundRect(0,i*row+3,w,(i+1)*row-5,16,16,p);ring(c,r+17,cy,r,values[i],v,v.metric[i]);label(c,names[i],r*2+37,cy+5,17*fs,v.ink,true);}return;}
  float col=w/3,r=Math.max(12,Math.min((col-16)/2,(h-24)/2)),cy=(h-23)/2;
  for(int i=0;i<3;i++){float cx=col*(i+.5f);ring(c,cx,cy,r,values[i],v,v.metric[i]);smallLabel(c,names[i],cx,Math.min(h-2,cy+r+19),12*fs,col-6,v.muted);}
 }
 private static void ring(Canvas c,float cx,float cy,float r,Double value,Visuals v,int color){Paint p=paint(v.line);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(Math.max(4,r*.13f));p.setStrokeCap(Paint.Cap.ROUND);RectF oval=new RectF(cx-r,cy-r,cx+r,cy+r);c.drawArc(oval,140,260,false,p);if(value!=null&&value>0){p.setColor(color);c.drawArc(oval,140,(float)(260*value/100),false,p);}number(c,Widgets.percent(value),cx,cy+7,Math.min(26,r*.85f),r*2-6,value==null?v.muted:v.ink);}
 public static Bitmap fleet(Context c,int w,int h,List<Snapshot.Server> servers,Snapshot data){return fleet(c,w,h,servers,data,null);}
 public static Bitmap fleet(Context context,int width,int height,List<Snapshot.Server> servers,Snapshot data,WidgetStyle style){
  int w=Math.max(1,width),h=Math.max(1,height);Bitmap b=bitmap(w,h);Canvas c=new Canvas(b);c.scale(b.getWidth()/(float)w,b.getHeight()/(float)h);Visuals v=style==null?new Visuals(context):style.palette(context);String layout=style==null?"auto":style.layout;boolean compact=style!=null&&style.density.equals("compact");
  if(h<55||w<150){int online=0;for(Snapshot.Server s:servers)if(s.state(data).equals("online"))online++;Paint p=paint(v.green);c.drawCircle(7,h/2,4,p);fit(c,online+Store.tr(context," đang kết nối"," online"),20,h/2+5,w-22,13,v.ink,true);return b;}
  int target=layout.equals("rings")?(compact?88:108):layout.equals("numbers")?(compact?56:70):(compact?60:80);
  int count=Math.min(servers.size(),Math.max(1,h/target));boolean overflow=count<servers.size();if(overflow)count=Math.max(1,Math.min(count,(h-22)/target));float row=Math.min(target,(h-(overflow?22:0))/(float)Math.max(1,count));
  for(int i=0;i<count;i++){Snapshot.Server s=servers.get(i);String state=s.state(data);float y=i*row;Paint p=paint(v.inset);c.drawRoundRect(0,y+2,w,y+row-4,14,14,p);float titleY=y+(row<62?18:24);fit(c,s.name,12,titleY,w*.55f-12,compact?13:14,v.ink,true);fit(c,Widgets.stateLabel(context,state),w*.58f,titleY-1,w*.42f-12,10,v.state(state),false);Double[] values=state.equals("online")?new Double[]{s.cpu,s.memory,s.disk}:new Double[]{null,null,null};
   if(layout.equals("rings")&&row>=82){c.save();c.translate(12,y+29);drawMetrics(context,c,w-24,row-34,values,v,"rings");c.restore();}
   else if(row>=46){String[] names={"CPU","RAM",Store.tr(context,"Đĩa","Disk")};float baseline=row<62?y+row-9:y+44;for(int j=0;j<3;j++){float x=12+j*(w-24)/3;fit(c,names[j]+" "+Widgets.percent(values[j]),x,baseline,(w-24)/3-4,compact?10:11,v.muted,false);if(!layout.equals("numbers")&&row>=62)bar(c,x,y+row-13,(w-24)/3-10,3,values[j],v.metric[j],v.line);}}
  }
  if(overflow)label(c,"+"+(servers.size()-count)+Store.tr(context," VPS · mở ứng dụng"," servers · open app"),3,h-3,11,v.muted,false);return b;
 }
 public static Bitmap placeholder(Context c,int w,int h){return placeholder(c,w,h,null);}
 public static Bitmap placeholder(Context context,int width,int height,WidgetStyle style){int w=Math.max(1,width),h=Math.max(1,height);Bitmap b=bitmap(w,h);Canvas c=new Canvas(b);c.scale(b.getWidth()/(float)w,b.getHeight()/(float)h);Visuals v=style==null?new Visuals(context):style.palette(context);float size=Math.min(80,Math.min(w*.6f,h*.75f));Paint p=paint(v.inset);c.drawRoundRect((w-size)/2,(h-size)/2,(w+size)/2,(h+size)/2,size/3,size/3,p);Bitmap icon=icon(context,"server",v.accent);c.drawBitmap(icon,null,new RectF((w-size*.65f)/2,(h-size*.65f)/2,(w+size*.65f)/2,(h+size*.65f)/2),paint(v.accent));icon.recycle();return b;}
 public static final class Meter extends View {
  private final Double[] values;
  public Meter(Context c,Double[] value){super(c);values=value;setContentDescription("CPU "+Widgets.percent(value[0])+", RAM "+Widgets.percent(value[1])+", "+Store.tr(c,"Ổ đĩa ","Disk ")+Widgets.percent(value[2]));setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);}
  protected void onDraw(Canvas c){float d=getResources().getDisplayMetrics().density;c.save();c.scale(d,d);drawMetrics(getContext(),c,getWidth()/d,getHeight()/d,values);c.restore();}
 }
}
