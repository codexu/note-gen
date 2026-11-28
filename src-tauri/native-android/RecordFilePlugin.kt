package com.codexu.NoteGen

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentResolver
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Parcelable
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.util.Locale
import kotlin.concurrent.thread

private const val OPEN_RECORD_FILE_EXTRA = "com.codexu.NoteGen.extra.OPEN_RECORD_FILE"

@InvokeArg
class RecordFileOpenArgs {
    lateinit var path: String
}

@InvokeArg
class MarkdownFilesListenerArgs {
    lateinit var handler: Channel
}

private data class MarkdownIntent(val mimeType: String?, val flags: Int)

@TauriPlugin
class RecordFilePlugin(private val activity: Activity) : Plugin(activity) {
    private val pendingMarkdownFiles = linkedMapOf<Uri, MarkdownIntent>()
    @Volatile
    private var markdownFilesListener: Channel? = null

    init {
        activity.intent?.let(::enqueueMarkdownFiles)
    }

    override fun onNewIntent(intent: Intent) = enqueueMarkdownFiles(intent)

    private fun enqueueMarkdownFiles(intent: Intent) {
        val uris = markdownIntentUris(intent).filter(::isContentUri)
        if (uris.isEmpty()) return

        val origin = MarkdownIntent(intent.type, intent.flags)
        synchronized(pendingMarkdownFiles) {
            uris.forEach { pendingMarkdownFiles[it] = origin }
        }
        markdownFilesListener?.send(JSObject())
    }

    @Command
    fun setMarkdownFilesListener(invoke: Invoke) {
        markdownFilesListener = invoke.parseArgs(MarkdownFilesListenerArgs::class.java).handler
        invoke.resolve()
    }

    @Command
    fun takePendingMarkdownFiles(invoke: Invoke) {
        val pending = synchronized(pendingMarkdownFiles) {
            pendingMarkdownFiles.toMap().also { pendingMarkdownFiles.clear() }
        }
        if (pending.isEmpty()) {
            invoke.resolve(JSObject().put("files", JSArray()))
            return
        }

        thread(name = "NoteGen Markdown files") {
            try {
                val files = JSArray()
                for ((uri, origin) in pending) {
                    resolveMarkdownFile(uri, origin)?.let { files.put(it) }
                }
                invoke.resolve(JSObject().put("files", files))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Failed to receive Markdown files", error)
            }
        }
    }

    private fun resolveMarkdownFile(uri: Uri, origin: MarkdownIntent): JSObject? {
        val name = displayName(uri) ?: uri.lastPathSegment?.substringAfterLast('/').orEmpty()
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        val resolver = activity.contentResolver
        val declaredType = runCatching { resolver.getType(uri) }.getOrNull()
        if (extension != "md" && extension != "markdown" &&
            !isMarkdownMimeType(declaredType) && !isMarkdownMimeType(origin.mimeType)) return null

        val readGrant = origin.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
        if (readGrant != 0 && (origin.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
            // Shared documents may only grant access while this task is alive.
            runCatching { resolver.takePersistableUriPermission(uri, readGrant) }
        }
        return JSObject().apply {
            put("path", uri.toString())
            put("name", name.ifBlank { "Markdown.md" })
        }
    }

    @Suppress("DEPRECATION")
    private fun markdownIntentUris(intent: Intent): Set<Uri> = runCatching {
        when (intent.action) {
            Intent.ACTION_VIEW -> {
                if (intent.getBooleanExtra(OPEN_RECORD_FILE_EXTRA, false)) emptySet()
                else setOfNotNull(intent.data)
            }
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> buildSet {
                val clipData = intent.clipData
                if (clipData != null) {
                    for (index in 0 until clipData.itemCount) clipData.getItemAt(index).uri?.let(::add)
                }
                val streams = runCatching {
                    if (intent.action == Intent.ACTION_SEND) {
                        listOfNotNull(intent.getParcelableExtra<Parcelable>(Intent.EXTRA_STREAM) as? Uri)
                    } else {
                        intent.getParcelableArrayListExtra<Parcelable>(Intent.EXTRA_STREAM).orEmpty().filterIsInstance<Uri>()
                    }
                }.getOrDefault(emptyList())
                addAll(streams)
            }
            else -> emptySet()
        }
    }.getOrDefault(emptySet())

    private fun isMarkdownMimeType(type: String?): Boolean {
        val normalized = type?.let(Intent::normalizeMimeType)
        return normalized == "text/markdown" || normalized == "text/x-markdown"
    }

    @Command
    fun pickRecordFile(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                }
                startActivityForResult(invoke, intent, "pickRecordFileResult")
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Failed to select a file", error)
            }
        }
    }

    @ActivityCallback
    fun pickRecordFileResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve(JSObject().put("path", JSONObject.NULL).put("name", JSONObject.NULL))
            return
        }
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Failed to select a file")
            return
        }

        try {
            val intent = result.data ?: throw IllegalStateException("The file picker returned no data")
            val uri = intent.data ?: throw IllegalStateException("The file picker returned no URI")
            requireContentUri(uri)
            val readGrant = intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
            if (readGrant == 0) throw SecurityException("The selected file does not grant read access")

            activity.contentResolver.takePersistableUriPermission(uri, readGrant)
            invoke.resolve(JSObject().apply {
                put("path", uri.toString())
                put("name", displayName(uri) ?: JSONObject.NULL)
            })
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to persist file access", error)
        }
    }

    @Command
    fun openRecordFile(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val uri = Uri.parse(invoke.parseArgs(RecordFileOpenArgs::class.java).path)
                requireContentUri(uri)

                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, mimeType(uri))
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .putExtra(OPEN_RECORD_FILE_EXTRA, true)
                activity.startActivity(externalViewerIntent(intent))
                invoke.resolve()
            } catch (error: ActivityNotFoundException) {
                invoke.reject("No Android app can open this file", error)
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Failed to open the file", error)
            }
        }
    }

    private fun externalViewerIntent(view: Intent): Intent {
        val packageManager = activity.packageManager
        val (own, external) = packageManager.queryIntentActivities(view, PackageManager.MATCH_DEFAULT_ONLY)
            .asSequence()
            .map { it.activityInfo }
            .filter { it.exported && it.enabled }
            .map { ComponentName(it.packageName, it.name) }
            .distinct()
            .partition { it.packageName == activity.packageName }
        if (external.isEmpty()) throw ActivityNotFoundException()

        val preferred = view.resolveActivity(packageManager)?.takeIf { it in external }
        val direct = preferred ?: external.singleOrNull()
        if (direct != null) return view.setComponent(direct)

        return Intent.createChooser(view, null)
            .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, own.toTypedArray())
    }

    private fun isContentUri(uri: Uri): Boolean =
        uri.scheme == ContentResolver.SCHEME_CONTENT && !uri.authority.isNullOrBlank()

    private fun requireContentUri(uri: Uri) {
        require(isContentUri(uri)) {
            "The file must be an Android content URI"
        }
    }

    private fun mimeType(uri: Uri): String {
        val resolver = activity.contentResolver
        val declaredType = resolver.getType(uri)?.let(Intent::normalizeMimeType)
        if (!declaredType.isNullOrEmpty() && declaredType != "application/octet-stream") return declaredType

        val extension = (displayName(uri) ?: uri.lastPathSegment.orEmpty())
            .substringAfterLast('.', "")
            .lowercase(Locale.ROOT)
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
    }

    private fun displayName(uri: Uri): String? = runCatching {
        activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0)?.takeIf { it.isNotBlank() } else null
        }
    }.getOrNull()
}
