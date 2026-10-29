package expo.modules.liquidnative

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

private const val TAG = CrashReporter.TAG
private const val CH_WORK = "agents_work"
private const val CH_ALERT = "agents_alerts"
private const val FG_ID = 4201

private fun ensureChannels(ctx: Context) {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
  val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  nm.createNotificationChannel(NotificationChannel(CH_WORK, "Agents working", NotificationManager.IMPORTANCE_LOW).apply {
    description = "Shown while agents are running tasks in the background"
  })
  nm.createNotificationChannel(NotificationChannel(CH_ALERT, "Reminders and results", NotificationManager.IMPORTANCE_HIGH).apply {
    description = "Reminders and finished or blocked agent tasks"
  })
}

private fun builder(ctx: Context, channel: String): Notification.Builder =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(ctx, channel) else Notification.Builder(ctx)

private fun openAppIntent(ctx: Context): PendingIntent? {
  val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
  return PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}

/** Keeps the app process (and the model server child) alive while agents have work to do. */
class AgentService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra("text") ?: "Agents are working"
    // Android kills the app if startForeground() is not reached quickly, so build defensively
    // and always make that call, even if the pretty notification could not be built.
    val n: Notification = try {
      ensureChannels(this)
      builder(this, CH_WORK)
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setContentTitle("LFM3 Pocket")
        .setContentText(text)
        .setOngoing(true)
        .setContentIntent(openAppIntent(this))
        .build()
    } catch (e: Throwable) {
      Log.w(TAG, "notification build failed: ${e.message}")
      builder(this, CH_WORK).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("LFM3 Pocket").build()
    }
    var started = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        started = true
      } catch (e: Throwable) {
        Log.w(TAG, "typed startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
      }
    }
    if (!started) {
      try {
        startForeground(FG_ID, n)
      } catch (e: Throwable) {
        Log.e(TAG, "startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  companion object {
    fun set(ctx: Context, on: Boolean, text: String) {
      val app = ctx.applicationContext
      val intent = Intent(app, AgentService::class.java).putExtra("text", text)
      try {
        if (on) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent) else app.startService(intent)
        } else {
          app.stopService(intent)
        }
      } catch (e: Throwable) {
        // e.g. started from the background on Android 12+: not fatal, the work just may not survive
        Log.w(TAG, "keepAlive($on) failed: ${e.message}")
      }
    }
  }
}

/** Posts a visible notification (reminder fired, task finished, task needs you). */
object Notifier {
  fun post(ctx: Context, id: Int, title: String, text: String) {
    try {
      ensureChannels(ctx)
      val n = builder(ctx, CH_ALERT)
        .setSmallIcon(android.R.drawable.ic_popup_reminder)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .setContentIntent(openAppIntent(ctx))
        .build()
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, n)
    } catch (e: Throwable) {
      // missing POST_NOTIFICATIONS permission etc.
      Log.w(TAG, "notify failed: ${e.message}")
    }
  }

  private fun pending(ctx: Context, id: Int, title: String, text: String, flags: Int): PendingIntent? {
    val i = Intent(ctx, ReminderReceiver::class.java).apply {
      putExtra("id", id)
      putExtra("title", title)
      putExtra("text", text)
    }
    return PendingIntent.getBroadcast(ctx, id, i, flags or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Fires even if the app is closed. Not exact to the second under Doze, which is fine for reminders. */
  fun schedule(ctx: Context, id: Int, atMs: Long, title: String, text: String) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pending(ctx, id, title, text, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi)
    else am.set(AlarmManager.RTC_WAKEUP, atMs, pi)
  }

  fun cancel(ctx: Context, id: Int) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    pending(ctx, id, "", "", PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it) }
  }
}

class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Notifier.post(
      context,
      intent.getIntExtra("id", 1),
      intent.getStringExtra("title") ?: "Reminder",
      intent.getStringExtra("text") ?: "",
    )
  }
}
