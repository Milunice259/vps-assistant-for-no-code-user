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
 public Visuals(Context c){boolean d=Store.dark(c);bg=d?0xFF10121B:0xFFF3F4F9;surface=d?0xFF1B1E2D:0xFFFFFFFF;inset=d?0xFF252A3C:0xFFF0F1F7;ink=d?0xFFF4F5FC:0xFF20243A;muted=d?0xFFA5ACC3:0xFF6D748B;accent=d?0xFFB6A7FF:0xFF6954CD;green=d?0xFF64DDB1:0xFF16835F;red=d?0xFFFF909D:0xFFC53F56;amber=d?0xFFF4CA7B:0xFF9B6A18;line=d?0xFF30364B:0xFFE5E7F1;metric=new int[]{accent,d?0xFF83B8FF:0xFF3978CB,green};}
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
 public static Bitmap metrics(Context context,int width,int height,Double[] values){
  int w=Math.max(1,width),h=Math.max(1,height);float scale=Math.min(2f,(float)Math.sqrt(180000.0/(w*(double)h)));Bitmap b=Bitmap.createBitmap(Math.max(1,(int)(w*scale)),Math.max(1,(int)(h*scale)),Bitmap.Config.ARGB_8888);Canvas c=new Canvas(b);c.scale(scale,scale);drawMetrics(context,c,w,h,values);return b;
 }
 static void drawMetrics(Context context,Canvas c,float w,float h,Double[] values){
  Visuals v=new Visuals(context);String[] names={"CPU","RAM",Store.tr(context,"Ổ đĩa","Disk")};float fs=Math.min(1.18f,context.getResources().getConfiguration().fontScale);
  if(h<55||w<145){float col=w/3;for(int i=0;i<3;i++){float x=i*col;number(c,Widgets.percent(values[i]),x+col/2,Math.max(17,h*.43f),Math.min(21,col*.46f)*fs,col-5,values[i]==null?v.muted:v.metric[i]);smallLabel(c,names[i],x+col/2,Math.max(30,h*.77f),10*fs,col-4,v.muted);if(h>=50)bar(c,x+5,h-5,col-10,3,values[i],v.metric[i],v.line);}return;}
  if(h>w*.75f&&h>180){float row=h/3;for(int i=0;i<3;i++){float y=i*row+5;Paint p=paint(v.inset);c.drawRoundRect(0,y,w,y+row-12,16,16,p);label(c,names[i],16,y+27,13*fs,v.muted,false);Paint t=paint(values[i]==null?v.muted:v.metric[i]);t.setTypeface(MEDIUM);t.setTextSize(28*fs);t.setTextAlign(Paint.Align.RIGHT);c.drawText(Widgets.percent(values[i]),w-16,y+34,t);bar(c,16,y+row-26,w-32,6,values[i],v.metric[i],v.line);}return;}
  float col=w/3,r=Math.min((col-16)/2,(h-24)/2);r=Math.max(12,r);float cy=(h-23)/2;
  for(int i=0;i<3;i++){float cx=col*(i+.5f);Paint p=paint(v.line);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(Math.max(4,r*.13f));p.setStrokeCap(Paint.Cap.ROUND);RectF oval=new RectF(cx-r,cy-r,cx+r,cy+r);c.drawArc(oval,140,260,false,p);if(values[i]!=null&&values[i]>0){p.setColor(v.metric[i]);c.drawArc(oval,140,(float)(260*values[i]/100),false,p);}number(c,Widgets.percent(values[i]),cx,cy+7,Math.min(26,r*.85f)*fs,r*2-6,values[i]==null?v.muted:v.ink);center(c,names[i],cx,Math.min(h-2,cy+r+19),12*fs,v.muted,false);}
 }
 public static Bitmap fleet(Context context,int width,int height,List<Snapshot.Server> servers,Snapshot data){
  int w=Math.max(1,width),h=Math.max(1,height);float scale=Math.min(2f,(float)Math.sqrt(180000.0/(w*(double)h)));Bitmap b=Bitmap.createBitmap(Math.max(1,(int)(w*scale)),Math.max(1,(int)(h*scale)),Bitmap.Config.ARGB_8888);Canvas c=new Canvas(b);c.scale(scale,scale);Visuals v=new Visuals(context);
  if(h<55||w<150){int online=0;for(Snapshot.Server s:servers)if(s.state(data).equals("online"))online++;float x=8,y=h/2;Paint p=paint(v.green);c.drawCircle(x,y,4,p);fit(c,online+Store.tr(context," đang kết nối"," online"),22,y+5,w-24,13,v.ink,true);return b;}
  int count=Math.min(servers.size(),Math.max(1,(h-16)/64));boolean overflow=count<servers.size();float row=Math.min(82,(h-(overflow?22:0))/(float)Math.max(1,count));
  for(int i=0;i<count;i++){Snapshot.Server s=servers.get(i);String state=s.state(data);float y=i*row;Paint p=paint(v.inset);c.drawRoundRect(0,y+3,w,y+row-5,14,14,p);fit(c,s.name,12,y+24,w*.55f-12,14,v.ink,true);fit(c,Widgets.stateLabel(context,state),w*.58f,y+23,w*.42f-12,10,v.state(state),false);String[] names={"CPU","RAM",Store.tr(context,"Đĩa","Disk")};Double[] values=state.equals("online")?new Double[]{s.cpu,s.memory,s.disk}:new Double[]{null,null,null};for(int j=0;j<3;j++){float x=12+j*(w-24)/3;fit(c,names[j]+" "+Widgets.percent(values[j]),x,y+44,(w-24)/3-4,11,v.muted,false);if(row>59)bar(c,x,y+52,(w-24)/3-10,3,values[j],v.metric[j],v.line);} }
  if(overflow)label(c,"+"+(servers.size()-count)+Store.tr(context," VPS · mở ứng dụng"," servers · open app"),3,h-3,11,v.muted,false);return b;
 }
 public static Bitmap placeholder(Context context,int width,int height){int w=Math.max(1,width),h=Math.max(1,height);float scale=Math.min(2f,(float)Math.sqrt(180000.0/(w*(double)h)));Bitmap b=Bitmap.createBitmap(Math.max(1,(int)(w*scale)),Math.max(1,(int)(h*scale)),Bitmap.Config.ARGB_8888);Canvas c=new Canvas(b);c.scale(scale,scale);Visuals v=new Visuals(context);float size=Math.min(80,Math.min(w*.6f,h*.75f));Paint p=paint(v.inset);c.drawRoundRect((w-size)/2,(h-size)/2,(w+size)/2,(h+size)/2,size/3,size/3,p);Bitmap icon=icon(context,"server",v.accent);c.drawBitmap(icon,null,new RectF((w-size*.65f)/2,(h-size*.65f)/2,(w+size*.65f)/2,(h+size*.65f)/2),paint(v.accent));icon.recycle();return b;}
 public static final class Meter extends View {
  private final Double[] values;
  public Meter(Context c,Double[] value){super(c);values=value;setContentDescription("CPU "+Widgets.percent(value[0])+", RAM "+Widgets.percent(value[1])+", "+Store.tr(c,"Ổ đĩa ","Disk ")+Widgets.percent(value[2]));setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);}
  protected void onDraw(Canvas c){float d=getResources().getDisplayMetrics().density;c.save();c.scale(d,d);drawMetrics(getContext(),c,getWidth()/d,getHeight()/d,values);c.restore();}
 }
}
