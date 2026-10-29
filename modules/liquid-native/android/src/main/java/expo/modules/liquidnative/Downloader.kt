package expo.modules.liquidnative

import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Resumable file downloader. Data goes to "<dest>.part" and is renamed on success, so a killed app,
 * a dropped connection or a pause just continues from the byte it stopped at.
 */
class Downloader {
  private val cancels = ConcurrentHashMap<String, AtomicBoolean>()

  fun isActive(id: String) = cancels.containsKey(id)

  fun cancel(id: String) {
    cancels[id]?.set(true)
  }

  fun start(
    id: String,
    url: String,
    dest: File,
    onProgress: (received: Long, total: Long) -> Unit,
    onDone: (Map<String, Any?>) -> Unit,
    onError: (message: String, cancelled: Boolean) -> Unit,
  ) {
    val flag = AtomicBoolean(false)
    if (cancels.putIfAbsent(id, flag) != null) {
      onError("download $id is already running", false)
      return
    }
    thread(name = "download-$id", isDaemon = true) {
      var conn: HttpURLConnection? = null
      try {
        dest.parentFile?.mkdirs()
        val part = File(dest.path + ".part")
        var existing = if (part.exists()) part.length() else 0L

        conn = (URL(url).openConnection() as HttpURLConnection).apply {
          instanceFollowRedirects = true
          connectTimeout = 20_000
          readTimeout = 30_000
          setRequestProperty("Accept-Encoding", "identity")
          setRequestProperty("User-Agent", "LiquidVoice/0.1 (Android)")
          if (existing > 0) setRequestProperty("Range", "bytes=$existing-")
        }

        val code = conn.responseCode
        var total: Long
        when (code) {
          200 -> {
            existing = 0 // server ignored Range: start over
            total = conn.contentLengthLong
          }
          206 -> {
            // Content-Range: bytes 100-999/1000
            total = conn.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull()
              ?: (existing + conn.contentLengthLong)
          }
          416 -> {
            // already have everything we asked for
            total = conn.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: existing
            if (total == existing && existing > 0) {
              finish(part, dest, onDone, total)
              return@thread
            }
            part.delete()
            throw IOException("HTTP 416 and partial file does not match server size; restart the download")
          }
          else -> throw IOException("HTTP $code ${conn.responseMessage} for $url")
        }

        var received = existing
        var lastEmit = 0L
        conn.inputStream.use { input ->
          FileOutputStream(part, existing > 0).use { out ->
            val buf = ByteArray(256 * 1024)
            onProgress(received, total)
            while (true) {
              if (flag.get()) {
                onError("cancelled", true)
                return@thread
              }
              val n = input.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              received += n
              val now = System.currentTimeMillis()
              if (now - lastEmit >= 250) {
                lastEmit = now
                onProgress(received, total)
              }
            }
            out.fd.sync()
          }
        }

        if (total > 0 && received != total) {
          throw IOException("incomplete download: got $received of $total bytes (will resume)")
        }
        onProgress(received, if (total > 0) total else received)
        finish(part, dest, onDone, received)
      } catch (e: Throwable) {
        Log.w(CrashReporter.TAG, "download $id failed: ${e.message}")
        onError(e.message ?: e.javaClass.simpleName, false)
      } finally {
        conn?.disconnect()
        cancels.remove(id)
      }
    }
  }

  private fun finish(part: File, dest: File, onDone: (Map<String, Any?>) -> Unit, size: Long) {
    if (dest.exists()) dest.delete()
    if (!part.renameTo(dest)) throw IOException("could not move ${part.name} into place")
    onDone(mapOf("path" to dest.absolutePath, "size" to size.toDouble()))
  }
}
