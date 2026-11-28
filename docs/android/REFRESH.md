# Android 1.3.0 refresh correction — work in progress (2026-11-28 Vietnam)

Owner reports that the widget's refresh interval is too long and data is usually not ready without a manual refresh. Current stable is 1.2.0 / 10200. This work does not alter the public feed or backend.

## Root cause
The phone only offers 15/30/60-minute JobScheduler cadence, but local freshness expires after roughly three minutes for a 60-second worker. The renderer then hides all numbers. This makes most of a normal refresh cycle unhelpful even when the cached observation was valid when fetched.

## Intended behavior
- Add 1/3/5-minute choices alongside 15/30/60. Preserve the owner's existing preference; selecting a fast interval is explicit.
- The optional fast mechanism is one shared AlarmManager ELAPSED_REALTIME exact alarm, which does not wake the device. Android12+ needs user-granted SCHEDULE_EXACT_ALARM access. Explain the reason in the app and open only the platform settings screen after the owner's tap. No USE_EXACT_ALARM, allow-while-idle alarms, wake lock, continuously running service or silent permission change.
- Without fast access, show the real 15-minute background fallback instead of pretending a one-minute periodic job exists. With no widget installed, do not maintain fast alarms. Phone sleep/Doze/OEM restrictions may delay delivery; fast mode does not promise exact execution while asleep.
- One persisted JobScheduler job (minimum15 minutes) remains fallback. Provider updatePeriodMillis becomes0 so the launcher does not create a second independent periodic fetch loop. Re-arm fast work after boot/package replacement/access grant/foreground entry; cancel when disconnected, access lost or last widget removed.
- The visible app refreshes once per minute and stops its timer on pause. All widgets, manual, foreground and scheduled triggers coalesce into the same bounded authenticated snapshot request.
- Keep last-known metrics from a previously online observation for up to24 hours after local aging, visibly marked Cached / Đã lưu with the original observation time and muted resource colors. Never count cached data as currently online. Backend-reported offline/unknown/stale/disabled metrics and missing values remain unavailable. Future/invalid times and older observations do not become cached metrics. Authentication failure/expiry/disconnect still erases credentials and cached data with the existing generation guard.
- Avoid recreating a widget editor for ordinary numeric refresh if its authorized server IDs/names are unchanged; retain drafts and update the preview in place.

## Validation/release gates
Build/JVM checks, Android10/API29 and15/API35 actual RemoteViews, cache bounds/state/authorization, denied/granted/revoked access, non-wakeup alarm delivery without a manual tap, shared cadence, no duplicate postponement, boot/replacement recovery, foreground timer lifecycle and real same-certificate update/cancellation must be verified. Do not call an options-only build background QA.

Candidate target: stable package com.vpscontrol.widget, version1.3.0/code10300, separate disposable QA5 package for testing. Hermes signs the final tested unsigned artifact with the existing stable certificate after QA; no key recreation or public CI signing secret. No production backend/proxy/key change or host-command execution on mobile reads.

## Platform references
- https://developer.android.com/develop/background-work/services/alarms
- https://developer.android.com/reference/android/app/AlarmManager
- https://developer.android.com/develop/ui/views/appwidgets/advanced

Status: implementation and native validation in progress; no 1.3.0 publication claimed.
