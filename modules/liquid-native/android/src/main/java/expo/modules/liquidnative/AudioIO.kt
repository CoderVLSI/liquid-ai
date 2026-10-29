package expo.modules.liquidnative

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max
import kotlin.math.sqrt

private const val TAG = CrashReporter.TAG

/** Captures mono PCM16 from the mic in 40 ms frames and hands them to JS as base64 + RMS level. */
class MicCapture(private val emit: (String, Map<String, Any?>) -> Unit) {
  private var record: AudioRecord? = null
  private var aec: AcousticEchoCanceler? = null
  private var ns: NoiseSuppressor? = null
  private var worker: Thread? = null

  @Volatile
  private var running = false

  @Synchronized
  fun start(sampleRate: Int, voiceCommunication: Boolean): Map<String, Any?> {
    stop()
    val channel = AudioFormat.CHANNEL_IN_MONO
    val encoding = AudioFormat.ENCODING_PCM_16BIT
    val minBuf = AudioRecord.getMinBufferSize(sampleRate, channel, encoding)
    if (minBuf <= 0) {
      throw CodedException("ERR_MIC", "AudioRecord.getMinBufferSize failed ($minBuf) for $sampleRate Hz", null)
    }
    val frame = sampleRate / 25 // 40 ms
    val bufBytes = max(minBuf * 2, frame * 2 * 6)
    val source =
      if (voiceCommunication) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.MIC

    val rec = try {
      AudioRecord(source, sampleRate, channel, encoding, bufBytes)
    } catch (e: SecurityException) {
      throw CodedException("ERR_MIC_PERMISSION", "RECORD_AUDIO permission denied", e)
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw CodedException("ERR_MIC", "AudioRecord failed to initialise (permission denied or mic in use)", null)
    }

    var aecOn = false
    var nsOn = false
    try {
      if (AcousticEchoCanceler.isAvailable()) {
        aec = AcousticEchoCanceler.create(rec.audioSessionId)?.also {
          it.enabled = true
          aecOn = true
        }
      }
      if (NoiseSuppressor.isAvailable()) {
        ns = NoiseSuppressor.create(rec.audioSessionId)?.also {
          it.enabled = true
          nsOn = true
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "audio effects unavailable: ${e.message}")
    }

    rec.startRecording()
    if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      rec.release()
      throw CodedException("ERR_MIC", "AudioRecord.startRecording() did not start recording", null)
    }

    record = rec
    running = true
    worker = Thread({
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
      } catch (ignored: Throwable) {
        // best effort
      }
      val shorts = ShortArray(frame)
      val bytes = ByteArray(frame * 2)
      while (running) {
        val n = rec.read(shorts, 0, frame)
        if (n < 0) {
          emit("micError", mapOf("code" to n, "message" to "AudioRecord.read returned $n"))
          break
        }
        if (n == 0) continue
        val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        var sum = 0.0
        for (i in 0 until n) {
          val s = shorts[i]
          sum += s.toDouble() * s.toDouble()
          bb.putShort(s)
        }
        val rms = sqrt(sum / n) / 32768.0
        emit("micFrame", mapOf("data" to Base64.encodeToString(bytes, 0, n * 2, Base64.NO_WRAP), "rms" to rms))
      }
    }, "mic-capture").also {
      it.isDaemon = true
      it.start()
    }
    Log.i(TAG, "mic started rate=${rec.sampleRate} aec=$aecOn ns=$nsOn source=$source")
    return mapOf("sampleRate" to rec.sampleRate, "aec" to aecOn, "ns" to nsOn)
  }

  @Synchronized
  fun stop() {
    running = false
    try {
      worker?.join(500)
    } catch (ignored: InterruptedException) {
    }
    worker = null
    try {
      record?.stop()
    } catch (ignored: Throwable) {
    }
    record?.release()
    record = null
    aec?.release()
    aec = null
    ns?.release()
    ns = null
  }
}

/**
 * Streaming PCM16 mono player with a jitter buffer.
 *
 * The model may generate speech slower than real time on a phone. Playing chunks as they arrive then
 * sounds like stuttering, so audio is first collected until [prebufferMs] is buffered, then played; if
 * playback ever catches up with generation we pause and refill instead of playing fragments.
 * [flush] drops everything instantly (barge-in).
 */
class PcmPlayer {
  private var track: AudioTrack? = null
  private var rate = 24000
  private var writer: Thread? = null
  private val queue = LinkedBlockingQueue<ByteArray>()
  private val queuedBytes = AtomicLong(0)
  private val writtenFrames = AtomicLong(0)
  private val underruns = AtomicInteger(0)
  private val rebufferMs = AtomicLong(0)

  @Volatile
  private var epoch = 0

  @Volatile
  private var running = false

  /** false while the jitter buffer is (re)filling */
  @Volatile
  private var playing = false

  /** the response is complete: play out whatever is left even if it is below the prebuffer */
  @Volatile
  private var ended = false

  @Volatile
  private var prebufferMs = 900
  private var headBase = 0L
  private var starvedSince = 0L

  @Synchronized
  fun start(sampleRate: Int, callMode: Boolean, prebuffer: Int) {
    stop()
    rate = sampleRate
    prebufferMs = prebuffer.coerceIn(0, 6000)
    val minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuf <= 0) {
      throw CodedException("ERR_PLAYER", "AudioTrack.getMinBufferSize failed ($minBuf) for $sampleRate Hz", null)
    }
    val attrs = AudioAttributes.Builder()
      .setUsage(if (callMode) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(sampleRate)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val b = AudioTrack.Builder()
      .setAudioAttributes(attrs)
      .setAudioFormat(format)
      .setBufferSizeInBytes(max(minBuf * 4, sampleRate * 2)) // >= 1 s of audio inside the track
      .setTransferMode(AudioTrack.MODE_STREAM)
    // big HAL buffers: latency does not matter here, glitches do
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_POWER_SAVING)
    val t = b.build()
    if (t.state != AudioTrack.STATE_INITIALIZED) {
      t.release()
      throw CodedException("ERR_PLAYER", "AudioTrack failed to initialise", null)
    }
    track = t // started lazily, once the jitter buffer is full
    queue.clear()
    queuedBytes.set(0)
    writtenFrames.set(0)
    underruns.set(0)
    rebufferMs.set(0)
    headBase = 0
    playing = false
    ended = false
    running = true
    writer = Thread({
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
      } catch (ignored: Throwable) {
        // best effort
      }
      while (running) {
        val track = t
        if (!playing) {
          val buffered = bufferedMs()
          val hasData = queuedBytes.get() > 0
          if (hasData && (buffered >= prebufferMs || ended)) {
            if (starvedSince != 0L) {
              rebufferMs.addAndGet(System.currentTimeMillis() - starvedSince)
              starvedSince = 0L
            }
            try {
              track.play()
            } catch (e: Throwable) {
              Log.w(TAG, "play failed: ${e.message}")
            }
            playing = true
          } else {
            try {
              Thread.sleep(15)
            } catch (ignored: InterruptedException) {
              // loop re-checks running
            }
            continue
          }
        } else if (queue.isEmpty()) {
          // everything we had is inside the track; has playback caught up with generation?
          val pendingFrames = writtenFrames.get() - playedFrames(track)
          if (pendingFrames <= 0) {
            try {
              track.pause()
            } catch (ignored: Throwable) {
              // ignore
            }
            playing = false
            if (ended) {
              ended = false // clean finish: the next response starts with a fresh buffer
            } else {
              underruns.incrementAndGet()
              starvedSince = System.currentTimeMillis()
            }
            continue
          }
        }

        var next: ByteArray? = null
        try {
          next = queue.poll(20, TimeUnit.MILLISECONDS)
        } catch (ignored: InterruptedException) {
          // fall through
        }
        val chunk = next ?: continue
        val myEpoch = epoch
        var off = 0
        while (off < chunk.size && running && myEpoch == epoch) {
          val n = track.write(chunk, off, chunk.size - off)
          if (n < 0) break
          off += n
        }
        if (myEpoch == epoch) {
          writtenFrames.addAndGet((chunk.size / 2).toLong())
          queuedBytes.addAndGet(-chunk.size.toLong())
        }
      }
    }, "pcm-writer").also {
      it.isDaemon = true
      it.start()
    }
    Log.i(TAG, "player started rate=$sampleRate callMode=$callMode prebuffer=${prebufferMs}ms")
  }

  private fun playedFrames(t: AudioTrack): Long = (t.playbackHeadPosition.toLong() and 0xFFFFFFFFL) - headBase

  private fun bufferedMs(): Long {
    val t = track ?: return 0
    val frames = queuedBytes.get() / 2 + max(writtenFrames.get() - playedFrames(t), 0L)
    return frames * 1000 / rate
  }

  fun enqueue(base64: String) {
    if (!running) return
    val bytes = Base64.decode(base64, Base64.DEFAULT)
    if (bytes.isEmpty()) return
    queuedBytes.addAndGet(bytes.size.toLong())
    queue.add(bytes)
  }

  /** A new response begins: fill the buffer again before playing. */
  fun begin() {
    ended = false
  }

  /** The response is complete: play the rest even if it is shorter than the prebuffer. */
  fun end() {
    ended = true
  }

  fun setPrebuffer(ms: Int) {
    prebufferMs = ms.coerceIn(0, 6000)
  }

  fun stats(): Map<String, Any?> {
    val hal = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) track?.underrunCount ?: 0 else 0
    } catch (ignored: Throwable) {
      0
    }
    return mapOf(
      "underruns" to underruns.get(),
      "halUnderruns" to hal,
      "rebufferMs" to rebufferMs.get().toDouble(),
      "prebufferMs" to prebufferMs,
      "bufferedMs" to bufferedMs().toDouble(),
    )
  }

  /** Drops everything that has not been heard yet. */
  @Synchronized
  fun flush() {
    val t = track ?: return
    epoch++
    queue.clear()
    queuedBytes.set(0)
    playing = false
    ended = false
    starvedSince = 0L
    try {
      t.pause()
      t.flush()
    } catch (e: Throwable) {
      Log.w(TAG, "flush failed: ${e.message}")
    }
    writtenFrames.set(0)
    headBase = t.playbackHeadPosition.toLong() and 0xFFFFFFFFL
  }

  /** Audio queued or written but not yet played, in ms. */
  fun pendingMs(): Double = bufferedMs().toDouble()

  @Synchronized
  fun stop() {
    running = false
    epoch++
    try {
      writer?.join(300)
    } catch (ignored: InterruptedException) {
      // ignore
    }
    writer = null
    queue.clear()
    try {
      track?.stop()
    } catch (ignored: Throwable) {
      // ignore
    }
    track?.release()
    track = null
    playing = false
  }
}

/** Switches Android into "call" audio mode so the platform echo canceller has a reference signal. */
class VoiceRoute(private val ctx: Context) {
  private val am get() = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var previousMode = AudioManager.MODE_NORMAL
  private var active = false

  @Suppress("DEPRECATION")
  @Synchronized
  fun enter(callMode: Boolean): Map<String, Any?> {
    if (active) leave()
    previousMode = am.mode
    active = true
    if (!callMode) return mapOf("mode" to "media", "speaker" to false)
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    val external = hasExternalOutput()
    if (!external) am.isSpeakerphoneOn = true
    return mapOf("mode" to "call", "speaker" to !external, "headset" to external)
  }

  @Suppress("DEPRECATION")
  @Synchronized
  fun leave() {
    if (!active) return
    active = false
    try {
      am.isSpeakerphoneOn = false
      am.mode = previousMode
    } catch (e: Throwable) {
      Log.w(TAG, "leave voice route failed: ${e.message}")
    }
  }

  private fun hasExternalOutput(): Boolean =
    am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
      when (it.type) {
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        -> true
        else -> false
      }
    }
}
