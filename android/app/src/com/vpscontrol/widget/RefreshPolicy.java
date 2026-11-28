package com.vpscontrol.widget;
/** Requested cadence is separate from Android's permitted background mechanism. */
public final class RefreshPolicy {
 private RefreshPolicy(){}
 public static int minutes(String value){for(int n:new int[]{1,3,5,15,30,60})if(String.valueOf(n).equals(value))return n;return 15;}
 public static boolean fast(int minutes){return minutes==1||minutes==3||minutes==5;}
 public static long periodic(int minutes){return Math.max(15,minutes)*60000L;}
}
