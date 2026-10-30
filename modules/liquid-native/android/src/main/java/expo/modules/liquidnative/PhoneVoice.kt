package expo.modules.liquidnative

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/**
 * The phone's own speech engine (Google / OnePlus TTS). The model only writes text; this turns it into sound with no
 * measurable CPU cost, so the voice cannot stutter because the model generates audio slower than real time.
 */
class PhoneVoice(private val context: Context) {
  private val tag = CrashReporter.TAG
  private var tts: TextToSpeech? = null
  private val pending = AtomicInteger(0)

  // utterances of an older generation (before a stop()) must not change the pending count
  @Volatile private var generation = 0
  @Volatile private var counter = 0

  /** Calls back once with a small description, or an error string. */
  fun init(rate: Float, callMode: Boolean, done: (Map<String, Any?>) -> Unit) {
    shutdown()
    var finished = false
    val finish = { result: Map<String, Any?> ->
      if (!finished) {
        finished = true
        done(result)
      }
    }
    try {
      var engine: TextToSpeech? = null
      engine = TextToSpeech(context) { status ->
        val t = engine
        if (status != TextToSpeech.SUCCESS || t == null) {
          finish(mapOf("ok" to false, "error" to "The phone's speech engine did not start (status $status)."))
        } else {
          try {
            var r = t.setLanguage(Locale.getDefault())
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) r = t.setLanguage(Locale.US)
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
              finish(mapOf("ok" to false, "error" to "The phone's speech engine has no voice installed for English."))
            } else {
              t.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
              t.setPitch(1.0f)
              val usage = if (callMode) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA
              t.setAudioAttributes(
                AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
              )
              t.setOnUtteranceProgressListener(listener)
              tts = t
              finish(mapOf("ok" to true, "engine" to (t.defaultEngine ?: "unknown"), "lang" to (t.voice?.locale?.toLanguageTag() ?: Locale.getDefault().toLanguageTag())))
            }
          } catch (e: Throwable) {
            finish(mapOf("ok" to false, "error" to (e.message ?: e.javaClass.simpleName)))
          }
        }
      }
    } catch (e: Throwable) {
      finish(mapOf("ok" to false, "error" to (e.message ?: e.javaClass.simpleName)))
    }
  }

  private val listener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {}

    override fun onDone(utteranceId: String?) = settle(utteranceId)

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) = settle(utteranceId)

    override fun onError(utteranceId: String?, errorCode: Int) {
      Log.w(tag, "tts error $errorCode")
      settle(utteranceId)
    }

    override fun onStop(utteranceId: String?, interrupted: Boolean) = settle(utteranceId)
  }

  private fun settle(utteranceId: String?) {
    val gen = utteranceId?.substringBefore(':')?.toIntOrNull() ?: return
    if (gen != generation) return
    if (pending.decrementAndGet() < 0) pending.set(0)
  }

  fun speak(text: String) {
    val t = tts ?: return
    if (text.isBlank()) return
    val id = "$generation:${counter++}"
    pending.incrementAndGet()
    val r = t.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id)
    if (r != TextToSpeech.SUCCESS) {
      Log.w(tag, "tts speak failed ($r)")
      if (pending.decrementAndGet() < 0) pending.set(0)
    }
  }

  /** Cuts off whatever is being said and drops everything queued. */
  fun stop() {
    generation++
    pending.set(0)
    try {
      tts?.stop()
    } catch (e: Throwable) {
      Log.w(tag, "tts stop failed: ${e.message}")
    }
  }

  fun busy(): Boolean = pending.get() > 0

  fun shutdown() {
    generation++
    pending.set(0)
    try {
      tts?.stop()
      tts?.shutdown()
    } catch (e: Throwable) {
      Log.w(tag, "tts shutdown failed: ${e.message}")
    }
    tts = null
  }
}
