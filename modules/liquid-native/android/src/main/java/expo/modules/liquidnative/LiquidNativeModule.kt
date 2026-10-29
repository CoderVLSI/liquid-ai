package expo.modules.liquidnative

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException

class LiquidNativeModule : Module() {
  private val tag = CrashReporter.TAG

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private val server by lazy { ServerProcess(context) { name, body -> sendEvent(name, body) } }
  private val mic by lazy { MicCapture { name, body -> sendEvent(name, body) } }
  private val player by lazy { PcmPlayer() }
  private val route by lazy { VoiceRoute(context) }
  private val downloader by lazy { Downloader() }
  private var wakeLock: PowerManager.WakeLock? = null

  override fun definition() = ModuleDefinition {
    Name("LiquidNative")

    Events("serverLog", "serverExit", "micFrame", "micError", "downloadProgress")

    OnCreate {
      CrashReporter.install(context)
      Log.i(tag, "LiquidNative module created")
    }

    OnDestroy {
      try {
        server.stop()
        mic.stop()
        player.stop()
        route.leave()
        wakeLock?.let { if (it.isHeld) it.release() }
      } catch (e: Throwable) {
        Log.w(tag, "cleanup failed: ${e.message}")
      }
    }

    // ---- device / environment ------------------------------------------------------------------

    Function("getInfo") {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      val mem = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
      val bin = File(context.applicationInfo.nativeLibraryDir, "libllama_server.so")
      mapOf(
        "filesDir" to context.filesDir.absolutePath,
        "nativeLibraryDir" to context.applicationInfo.nativeLibraryDir,
        "serverBinaryPresent" to bin.exists(),
        "serverBinarySize" to (if (bin.exists()) bin.length().toDouble() else 0.0),
        "abis" to Build.SUPPORTED_ABIS.toList(),
        "sdk" to Build.VERSION.SDK_INT,
        "device" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "totalRamBytes" to mem.totalMem.toDouble(),
        "availRamBytes" to mem.availMem.toDouble(),
        "freeDiskBytes" to context.filesDir.usableSpace.toDouble(),
        "cores" to Runtime.getRuntime().availableProcessors(),
      )
    }

    Function("getMemory") {
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      val mem = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
      mapOf("availRamBytes" to mem.availMem.toDouble(), "lowMemory" to mem.lowMemory)
    }

    // ---- llama.cpp server process --------------------------------------------------------------

    AsyncFunction("startServer") { args: List<String> ->
      server.start(args)
    }

    AsyncFunction("stopServer") {
      server.stop()
    }

    Function("isServerRunning") {
      server.isRunning()
    }

    Function("getServerTail") {
      server.tailText()
    }

    // ---- microphone / speaker ------------------------------------------------------------------

    AsyncFunction("startMic") { sampleRate: Int, voiceCommunication: Boolean ->
      mic.start(sampleRate, voiceCommunication)
    }

    AsyncFunction("stopMic") {
      mic.stop()
    }

    AsyncFunction("enterVoiceMode") { callMode: Boolean ->
      route.enter(callMode)
    }

    AsyncFunction("leaveVoiceMode") {
      route.leave()
    }

    AsyncFunction("startPlayer") { sampleRate: Int, callMode: Boolean, prebufferMs: Int ->
      player.start(sampleRate, callMode, prebufferMs)
    }

    Function("playerBegin") {
      player.begin()
    }

    Function("playerEnd") {
      player.end()
    }

    Function("playerSetPrebuffer") { ms: Int ->
      player.setPrebuffer(ms)
    }

    Function("playerStats") {
      player.stats()
    }

    // Runs on the JS thread on purpose: ordering of audio deltas must be preserved.
    Function("playPcm") { base64: String ->
      player.enqueue(base64)
    }

    Function("flushPlayer") {
      player.flush()
    }

    Function("playerPendingMs") {
      player.pendingMs()
    }

    AsyncFunction("stopPlayer") {
      player.stop()
    }

    Function("setWakeLock") { on: Boolean ->
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (on) {
        if (wakeLock == null) wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LiquidVoice:inference")
        if (wakeLock?.isHeld == false) wakeLock?.acquire(60 * 60 * 1000L)
      } else {
        wakeLock?.let { if (it.isHeld) it.release() }
      }
    }

    // ---- files / downloads ---------------------------------------------------------------------

    Function("fileSize") { path: String ->
      val f = File(path)
      if (f.exists()) f.length().toDouble() else -1.0
    }

    Function("partialSize") { path: String ->
      val f = File("$path.part")
      if (f.exists()) f.length().toDouble() else 0.0
    }

    AsyncFunction("deleteFile") { path: String ->
      val a = File(path).delete()
      val b = File("$path.part").delete()
      a || b
    }

    AsyncFunction("readText") { path: String ->
      val f = File(path)
      if (f.exists()) f.readText() else null
    }

    // Synchronous so a log line survives even if the process dies right after.
    Function("writeText") { path: String, text: String, append: Boolean ->
      val f = File(path)
      f.parentFile?.mkdirs()
      if (append) f.appendText(text) else f.writeText(text)
    }

    AsyncFunction("downloadFile") { id: String, url: String, dest: String, promise: Promise ->
      downloader.start(
        id,
        url,
        File(dest),
        onProgress = { received, total ->
          sendEvent(
            "downloadProgress",
            mapOf("id" to id, "received" to received.toDouble(), "total" to total.toDouble()),
          )
        },
        onDone = { result -> promise.resolve(result) },
        onError = { message, cancelled ->
          promise.reject(if (cancelled) "ERR_CANCELLED" else "ERR_DOWNLOAD", message, null)
        },
      )
    }

    Function("cancelDownload") { id: String ->
      downloader.cancel(id)
    }

    Function("isDownloading") { id: String ->
      downloader.isActive(id)
    }

    // ---- agents: background keep-alive, notifications, reminders -------------------------------

    Function("keepAlive") { on: Boolean, text: String ->
      AgentService.set(context, on, text)
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Opens the system dialog that lets the user exempt this app, so Android does not stop background work.
    Function("requestIgnoreBatteryOptimizations") {
      try {
        val i = android.content.Intent(
          android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          android.net.Uri.parse("package:${context.packageName}"),
        ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
      } catch (e: Throwable) {
        Log.w(tag, "battery optimisation intent failed: ${e.message}")
        try {
          context.startActivity(
            android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
              .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
          )
        } catch (e2: Throwable) {
          Log.w(tag, "battery settings intent failed: ${e2.message}")
        }
      }
    }

    Function("notify") { id: Int, title: String, body: String ->
      Notifier.post(context, id, title, body)
    }

    Function("scheduleReminder") { id: Int, atMs: Double, title: String, body: String ->
      Notifier.schedule(context, id, atMs.toLong(), title, body)
    }

    Function("cancelReminder") { id: Int ->
      Notifier.cancel(context, id)
    }

    // ---- diagnostics ---------------------------------------------------------------------------

    // Mirrors the app's JS log into logcat (tag LiquidVoice) so `adb logcat -s LiquidVoice` shows everything.
    Function("log") { level: String, message: String ->
      when (level) {
        "error" -> Log.e(tag, message)
        "warn" -> Log.w(tag, message)
        else -> Log.i(tag, message)
      }
    }

    Function("getCrashReports") {
      CrashReporter.pending(context)
    }

    Function("clearCrashReports") {
      CrashReporter.clear(context)
    }

    Function("writeCrash") { kind: String, text: String ->
      try {
        CrashReporter.write(context, kind, text)
      } catch (e: IOException) {
        Log.e(tag, "writeCrash failed", e)
      }
    }

    Function("getExitReasons") {
      CrashReporter.exitReasons(context)
    }

    AsyncFunction("readLogcat") { maxLines: Int ->
      try {
        val p = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-v", "time", "-t", maxLines.toString()))
        val out = p.inputStream.bufferedReader().readText()
        p.destroy()
        out.takeLast(400_000)
      } catch (e: Throwable) {
        throw CodedException("ERR_LOGCAT", "could not read logcat: ${e.message}", e)
      }
    }
  }
}
