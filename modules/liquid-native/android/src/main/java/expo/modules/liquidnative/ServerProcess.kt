package expo.modules.liquidnative

import android.content.Context
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.IOException
import java.io.InputStream
import kotlin.concurrent.thread

/**
 * Runs the cross-compiled llama.cpp server (shipped as libllama_server.so) as a child process.
 *
 * Why a child process instead of loading it in-process: if the model/runtime crashes natively
 * (SIGSEGV, OOM kill, abort) the app survives, and we get the exit code plus the last log lines.
 */
class ServerProcess(
  private val ctx: Context,
  private val emit: (String, Map<String, Any?>) -> Unit,
) {
  private val tag = CrashReporter.TAG
  private var proc: java.lang.Process? = null
  private var pid: Int = -1
  private var stopping = false
  private var generation = 0
  private val tail = ArrayDeque<String>()

  private val pidFile: File get() = File(ctx.filesDir, "server.pid")

  fun binary(): File = File(ctx.applicationInfo.nativeLibraryDir, "libllama_server.so")

  @Synchronized
  fun isRunning(): Boolean {
    val p = proc ?: return false
    return try {
      p.exitValue()
      false
    } catch (_: IllegalThreadStateException) {
      true
    }
  }

  fun tailText(): String = synchronized(tail) { tail.joinToString("\n") }

  @Synchronized
  fun start(args: List<String>): Int {
    stop()
    killStale()

    val bin = binary()
    if (!bin.exists()) {
      throw CodedException(
        "ERR_SERVER_BINARY",
        "Server binary not found at ${bin.absolutePath}. The APK was built without libllama_server.so " +
          "or native libs were not extracted (useLegacyPackaging must be true).",
        null,
      )
    }

    val pb = ProcessBuilder(listOf(bin.absolutePath) + args)
    pb.directory(ctx.filesDir)
    pb.environment()["LD_LIBRARY_PATH"] = ctx.applicationInfo.nativeLibraryDir
    pb.environment()["HOME"] = ctx.filesDir.absolutePath
    pb.environment()["TMPDIR"] = ctx.cacheDir.absolutePath

    val p = try {
      pb.start()
    } catch (e: IOException) {
      throw CodedException("ERR_SERVER_START", "Could not exec ${bin.absolutePath}: ${e.message}", e)
    }

    val myGen = ++generation
    proc = p
    stopping = false
    pid = pidOf(p)
    synchronized(tail) { tail.clear() }
    try {
      pidFile.writeText(pid.toString())
    } catch (_: IOException) {
    }
    Log.i(tag, "server started pid=$pid args=${args.joinToString(" ")}")

    pump(p.inputStream, "out")
    pump(p.errorStream, "err")

    thread(name = "llama-wait", isDaemon = true) {
      val code = try {
        p.waitFor()
      } catch (_: InterruptedException) {
        -1
      }
      val expected: Boolean
      synchronized(this) {
        expected = stopping
        if (generation == myGen) {
          proc = null
          pidFile.delete()
        }
      }
      Log.i(tag, "server exited code=$code expected=$expected")
      emit(
        "serverExit",
        mapOf(
          "code" to code,
          "expected" to expected,
          "signal" to if (code > 128) code - 128 else 0,
          "tail" to tailText().lines().takeLast(60).joinToString("\n"),
        ),
      )
    }
    return pid
  }

  @Synchronized
  fun stop() {
    val p = proc ?: return
    stopping = true
    p.destroy()
    var waited = 0
    while (waited < 3000 && isAlive(p)) {
      Thread.sleep(50)
      waited += 50
    }
    if (isAlive(p) && pid > 0) {
      Log.w(tag, "server ignored SIGTERM, killing pid=$pid")
      android.os.Process.killProcess(pid)
    }
  }

  private fun isAlive(p: java.lang.Process): Boolean =
    try {
      p.exitValue()
      false
    } catch (_: IllegalThreadStateException) {
      true
    }

  /** A previous app process may have died without stopping its child; don't leave 1.5 GB of model resident. */
  private fun killStale() {
    try {
      val old = pidFile.takeIf { it.exists() }?.readText()?.trim()?.toIntOrNull() ?: return
      val cmd = File("/proc/$old/cmdline").takeIf { it.exists() }?.readText() ?: ""
      if (cmd.contains("libllama_server")) {
        Log.w(tag, "killing stale server pid=$old")
        android.os.Process.killProcess(old)
        Thread.sleep(200)
      }
    } catch (e: Throwable) {
      Log.w(tag, "killStale failed: ${e.message}")
    } finally {
      pidFile.delete()
    }
  }

  private fun pidOf(p: java.lang.Process): Int {
    try {
      // Process.pid() exists on Android 13+
      return (java.lang.Process::class.java.getMethod("pid").invoke(p) as Long).toInt()
    } catch (_: Throwable) {
    }
    try {
      val f = p.javaClass.getDeclaredField("pid")
      f.isAccessible = true
      return f.getInt(p)
    } catch (_: Throwable) {
    }
    return -1
  }

  private fun pump(stream: InputStream, name: String) {
    thread(name = "llama-$name", isDaemon = true) {
      try {
        stream.bufferedReader().forEachLine { line ->
          synchronized(tail) {
            tail.addLast(line)
            while (tail.size > 300) tail.removeFirst()
          }
          Log.i(tag, "[server/$name] $line")
          emit("serverLog", mapOf("stream" to name, "line" to line))
        }
      } catch (_: IOException) {
        // stream closed when the process exits
      }
    }
  }
}
