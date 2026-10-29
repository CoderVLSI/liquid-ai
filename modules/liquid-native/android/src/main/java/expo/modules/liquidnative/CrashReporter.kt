package expo.modules.liquidnative

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Persists anything that can kill the app so the next launch can show it in the Debug screen:
 *  - uncaught Java/Kotlin exceptions (this includes fatal JS errors, which RN rethrows natively)
 *  - JS-side crash reports written through [write]
 *  - Android's own record of why the process died (OOM kill, native crash, ANR...) via ApplicationExitInfo
 */
object CrashReporter {
  const val TAG = "LiquidVoice"
  private const val MAX_FILES = 12
  private const val MAX_CHARS = 40_000

  @Volatile
  private var installed = false

  fun dir(ctx: Context): File = File(ctx.filesDir, "crash").apply { mkdirs() }

  fun install(ctx: Context) {
    if (installed) return
    installed = true
    val appCtx = ctx.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        write(appCtx, "native", "thread: ${thread.name}\n$sw")
      } catch (ignored: Throwable) {
        // nothing sensible left to do while crashing
      }
      previous?.uncaughtException(thread, throwable)
    }
  }

  fun write(ctx: Context, kind: String, text: String) {
    val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date())
    val header = "kind: $kind\ntime: $stamp\ndevice: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE}, SDK ${Build.VERSION.SDK_INT})\n\n"
    val body = (header + text).take(MAX_CHARS)
    val d = dir(ctx)
    File(d, "$kind-$stamp.txt").writeText(body)
    Log.e(TAG, "crash report written: $kind-$stamp.txt")
    d.listFiles()?.sortedByDescending { it.name }?.drop(MAX_FILES)?.forEach { it.delete() }
  }

  fun pending(ctx: Context): List<Map<String, Any?>> =
    (dir(ctx).listFiles() ?: emptyArray())
      .sortedByDescending { it.name }
      .map { mapOf("name" to it.name, "text" to it.readText().take(MAX_CHARS)) }

  fun clear(ctx: Context) {
    dir(ctx).listFiles()?.forEach { it.delete() }
  }

  /** Why did previous processes of this app die? Needs Android 11+. */
  fun exitReasons(ctx: Context): List<Map<String, Any?>> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
    return try {
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.getHistoricalProcessExitReasons(ctx.packageName, 0, 8).map {
        mapOf(
          "reason" to reasonName(it.reason),
          "status" to it.status,
          "description" to (it.description ?: ""),
          "process" to it.processName,
          "timestamp" to it.timestamp.toDouble(),
          "pssKb" to it.pss.toDouble(),
          "rssKb" to it.rss.toDouble(),
        )
      }
    } catch (e: Throwable) {
      Log.w(TAG, "exitReasons failed", e)
      emptyList()
    }
  }

  private fun reasonName(r: Int): String =
    when (r) {
      ApplicationExitInfo.REASON_ANR -> "ANR"
      ApplicationExitInfo.REASON_CRASH -> "CRASH (java/kotlin/js)"
      ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
      ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
      ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
      ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
      ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
      ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY (killed by Android to free RAM)"
      ApplicationExitInfo.REASON_OTHER -> "OTHER"
      ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
      ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
      ApplicationExitInfo.REASON_UNKNOWN -> "UNKNOWN"
      ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
      ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
      else -> "REASON_$r"
    }
}
