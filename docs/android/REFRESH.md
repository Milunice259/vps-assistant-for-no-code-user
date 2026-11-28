# Android 1.3.0 refresh correction — signing handoff (2026-11-28 Vietnam)

Owner reports that the widget's refresh interval is too long and data is usually not ready without a manual refresh. Current stable is 1.2.0 / 10200. This work does not alter the public feed or backend.

## Root cause
The phone only offers 15/30/60-minute JobScheduler cadence, but local freshness expires after roughly three minutes for a 60-second worker. The renderer then hides all numbers. This makes most of a normal refresh cycle unhelpful even when the cached observation was valid when fetched.

## Implemented behavior
- Add 1/3/5-minute choices alongside 15/30/60. Preserve the owner's existing preference; selecting a fast interval is explicit.
- The optional fast mechanism is one shared AlarmManager ELAPSED_REALTIME exact alarm, which does not wake the device. Android12+ needs user-granted SCHEDULE_EXACT_ALARM access. Explain the reason in the app and open only the platform settings screen after the owner's tap. No USE_EXACT_ALARM, allow-while-idle alarms, wake lock, continuously running service or silent permission change.
- Without fast access, show the real 15-minute background fallback instead of pretending a one-minute periodic job exists. With no widget installed, do not maintain fast alarms. Phone sleep/Doze/OEM restrictions may delay delivery; fast mode does not promise exact execution while asleep.
- One persisted JobScheduler job (minimum15 minutes) remains fallback. Provider updatePeriodMillis becomes0 so the launcher does not create a second independent periodic fetch loop. Re-arm fast work after boot/package replacement/access grant/foreground entry; cancel when disconnected, access lost or last widget removed.
- The visible app refreshes once per minute and stops its timer on pause. All widgets, manual, foreground and scheduled triggers coalesce into the same bounded authenticated snapshot request.
- Keep last-known metrics from a previously online observation for up to24 hours after local aging, visibly marked Cached / Đã lưu with the original observation time and muted resource colors. Never count cached data as currently online. Backend-reported offline/unknown/stale/disabled metrics and missing values remain unavailable. Future/invalid times and older observations do not become cached metrics. Authentication failure/expiry/disconnect still erases credentials and cached data with the existing generation guard.
- Avoid recreating a widget editor for ordinary numeric refresh if its authorized server IDs/names are unchanged; retain drafts and update the preview in place.

## Validation/release gates
Build/JVM checks, Android10/API29 and15/API35 actual RemoteViews, cache bounds/state/authorization, denied/granted/revoked access, non-wakeup alarm delivery without a manual tap, shared cadence, no duplicate postponement, boot/replacement recovery, foreground timer lifecycle and real same-certificate update/cancellation form the validation scope. The final receipt below distinguishes executed tests from remaining physical-device acceptance. Do not call an options-only build background QA.

Candidate target: stable package com.vpscontrol.widget, version1.3.0/code10300, separate disposable QA5 package for testing. Hermes signs the final tested unsigned artifact with the existing stable certificate after QA; no key recreation or public CI signing secret. No production backend/proxy/key change or host-command execution on mobile reads.

## Platform references
- https://developer.android.com/develop/background-work/services/alarms
- https://developer.android.com/reference/android/app/AlarmManager
- https://developer.android.com/develop/ui/views/appwidgets/advanced

## Final validation receipt

Source `42d25be78208ead526e5782199ff13158ab384ba` merged in PR #6 as `1d521efbda6f60b7cf1b0c2aa489a81172e34e4b`. [CI46102820099](https://github.com/Milunice259/vps-assistant-for-no-code-user/actions/runs/46102820099) PASS on API29/35: JVM22+23+38; core403/options1748 each; refresh160/163, auto17/18, API35 revoked5. Real awake native60s delivery updates two widgets through exactly one snapshot GET, with normal jobs isolated during measurement; no direct request substitutes the measured alarm. Native dump is ELAPSED/type3 with0 wakeups. Real foreground timer and same-certificate QA upgrade preserve pairing/cache/style/fast preference. App/widget images inspected; recorded crash log empty. The fixture host is cleaned before instrumentation finish; Settings checks support Android15 SPA redirection.

Final unsigned stable package/version10300/1.3.0 is72,466 bytes, SHA-256 `409bd99ae645a7ecac95ca53306479d256f30e749946eb42cf1b4d9658557428`. Artifact15246587474, archive hash `40e6e9446a05f7a0f35fcb8db959bbd615eaed69386470a8b6f1a1ca8fdb02ce`. Downloaded and checked; durable owner handoff retained. Hermes signs exact bytes with the existing stable certificate, then verifies public APK/tag/feed before announcing availability.

Status: merged; ready for owner-side stable signature/publication. Public feed remains1.2.0. Physical reboot and Samsung sleep/battery acceptance remain owner gates; receiver wiring and real package replacement do not prove every OEM lifecycle case. No1.3.0 publication claimed.
