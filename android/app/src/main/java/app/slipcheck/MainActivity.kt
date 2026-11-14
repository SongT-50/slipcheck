package app.slipcheck

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.ondevice.DownloadStatus
import com.google.firebase.ai.ondevice.FirebaseAIOnDevice
import com.google.firebase.ai.ondevice.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.Schema
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * SlipCheck for Android. The screens and the arithmetic are the same files as the web app (copied in at build time).
 * This activity only supplies what the page cannot do itself on a phone:
 *  - reading a slip through Firebase AI Logic for Android — Gemini Nano on the phone (ONLY_ON_DEVICE),
 *    or the cloud model only after the user agreed in the page (ONLY_IN_CLOUD); never a silent fallback;
 *  - the camera, and read-aloud with the phone's own speech engine.
 */
@OptIn(PublicPreviewAPI::class)
class MainActivity : ComponentActivity() {
  private val tag = "SlipCheck"
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private lateinit var web: WebView
  private var tts: TextToSpeech? = null
  private var fileCallback: ValueCallback<Array<Uri>>? = null
  private var photoUri: Uri? = null

  private val cloudModel = "gemini-3.5-flash-lite"
  private val str = Schema.string()
  private val slipSchema = Schema.obj(
    mapOf(
      "issuer" to str,
      "items" to Schema.array(Schema.obj(mapOf("product" to str, "unit" to str, "qty" to str, "unit_price" to str, "amount" to str), optionalProperties = listOf("unit"))),
      "gross" to str,
      "deductions" to Schema.array(Schema.obj(mapOf("label" to str, "rate_pct" to str, "amount" to str), optionalProperties = listOf("rate_pct"))),
      "total_deductions" to str,
      "net" to str,
    ),
    optionalProperties = listOf("issuer", "total_deductions"),
  )
  private val explainSchema = Schema.obj(
    mapOf("total_sale" to str, "you_received" to str, "share" to str, "meanings" to Schema.array(str), "mismatch" to str),
  )

  private val ai by lazy { Firebase.ai(backend = GenerativeBackend.googleAI()) }
  private val deviceReader by lazy {
    ai.generativeModel(
      modelName = cloudModel,
      onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE, maxOutputTokens = 1024, temperature = 0f),
    )
  }
  private val cloudReader by lazy {
    ai.generativeModel(
      modelName = cloudModel,
      generationConfig = generationConfig { temperature = 0f; responseMimeType = "application/json"; responseSchema = slipSchema },
      onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
    )
  }
  private val explainer by lazy {
    ai.generativeModel(
      modelName = cloudModel,
      generationConfig = generationConfig { temperature = 0.2f; responseMimeType = "application/json"; responseSchema = explainSchema },
      onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
    )
  }

  private val takePhoto = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
    val picked = r.data?.data
    val result = when {
      r.resultCode != RESULT_OK -> null
      picked != null -> arrayOf(picked)
      photoUri != null -> arrayOf(photoUri!!)
      else -> null
    }
    fileCallback?.onReceiveValue(result)
    fileCallback = null
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // App Check: debug provider for this contest build (the debug token is printed to logcat once and
    // registered by hand in the Firebase console). A store build would use Play Integrity.
    Firebase.appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())

    val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
    web = WebView(this)
    web.settings.javaScriptEnabled = true
    web.settings.domStorageEnabled = true
    web.settings.allowFileAccess = false
    web.settings.mediaPlaybackRequiresUserGesture = false  // the read-aloud clips play one after another
    web.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest) = assets.shouldInterceptRequest(req.url)
    }
    web.webChromeClient = object : WebChromeClient() {
      override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = cb
        val dir = File(cacheDir, "shots").apply { mkdirs() }
        val f = File(dir, "slip-${System.currentTimeMillis()}.jpg")
        photoUri = FileProvider.getUriForFile(this@MainActivity, "app.slipcheck.files", f)
        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
          .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        val gallery = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
        val chooser = if (params.isCaptureEnabled) camera
          else Intent.createChooser(gallery, null).putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
        takePhoto.launch(chooser)
        return true
      }
    }
    web.addJavascriptInterface(Bridge(), "SlipNative")
    // Android 15+ draws apps edge to edge: keep the page clear of the status bar (top) and the navigation bar (bottom).
    val root = FrameLayout(this).apply { setBackgroundColor(0xFFFFFFFF.toInt()); addView(web) }
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    setContentView(root)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        // The page decides what "back" means (it returns to the scan screen); on the scan screen, leave the app.
        web.evaluateJavascript("(window.__slipBack ? window.__slipBack() : false)") { handled ->
          if (handled != "true") finish()
        }
      }
    })
    web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
  }

  override fun onDestroy() { tts?.shutdown(); super.onDestroy() }

  private fun reply(id: String, kind: String, payload: String) = runOnUiThread {
    web.evaluateJavascript("window.__slipNative(${JSONObject.quote(id)}, '$kind', ${JSONObject.quote(payload)})", null)
  }

  inner class Bridge {
    @JavascriptInterface
    fun status(id: String) {
      scope.launch {
        try {
          val s = FirebaseAIOnDevice.checkStatus()
          val name = when (s) {
            OnDeviceModelStatus.AVAILABLE -> "available"
            OnDeviceModelStatus.DOWNLOADABLE -> "downloadable"
            OnDeviceModelStatus.DOWNLOADING -> "downloading"
            else -> "unavailable"
          }
          Log.i(tag, "on-device status: $name")
          reply(id, "done", name)
          if (s == OnDeviceModelStatus.DOWNLOADABLE) scope.launch {
            FirebaseAIOnDevice.download().collect { d -> if (d is DownloadStatus.DownloadCompleted) Log.i(tag, "on-device model downloaded") }
          }
        } catch (e: Throwable) {
          Log.w(tag, "status failed", e); reply(id, "done", "unavailable")
        }
      }
    }

    @JavascriptInterface
    fun read(id: String, jpegBase64: String, where: String, prompt: String) {
      scope.launch {
        val t0 = System.currentTimeMillis()
        try {
          val bytes = Base64.decode(jpegBase64, Base64.DEFAULT)
          val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
          val model = if (where == "cloud") cloudReader else deviceReader
          val text = StringBuilder()
          var source = "unknown"
          model.generateContentStream(content { image(bmp); text(prompt) }).collect { chunk ->
            chunk.text?.let { text.append(it) }
            source = when (chunk.inferenceSource) { InferenceSource.ON_DEVICE -> "on_device"; InferenceSource.IN_CLOUD -> "in_cloud"; else -> source }
            reply(id, "chunk", text.toString())
          }
          Log.i(tag, "read $where -> $source in ${System.currentTimeMillis() - t0} ms")
          reply(id, "done", JSONObject().put("text", text.toString()).put("source", source).toString())
        } catch (e: Throwable) {
          Log.w(tag, "read failed ($where)", e)
          reply(id, "error", "${e.javaClass.simpleName}: ${e.message}")
        }
      }
    }

    @JavascriptInterface
    fun explain(id: String, prompt: String) {
      scope.launch {
        try { reply(id, "done", explainer.generateContent(prompt).text ?: "{}") }
        catch (e: Throwable) { Log.w(tag, "explain failed", e); reply(id, "error", "${e.javaClass.simpleName}: ${e.message}") }
      }
    }

    @JavascriptInterface
    fun speak(linesJson: String, lang: String) {
      val lines = JSONArray(linesJson)
      val go = {
        tts?.language = Locale.forLanguageTag(lang)
        tts?.setSpeechRate(0.95f)
        for (i in 0 until lines.length()) tts?.speak(lines.getString(i), if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, "l$i")
      }
      runOnUiThread {
        if (tts == null) tts = TextToSpeech(this@MainActivity) { ok -> if (ok == TextToSpeech.SUCCESS) go() }
        else go()
      }
    }

    @JavascriptInterface
    fun stopSpeak() { runOnUiThread { tts?.stop() } }
  }
}
