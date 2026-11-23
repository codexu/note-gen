package com.codexu.NoteGen

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.util.Locale

@InvokeArg
class RecordFileOpenArgs {
    lateinit var path: String
}

@TauriPlugin
class RecordFilePlugin(private val activity: Activity) : Plugin(activity) {
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
                activity.startActivity(intent)
                invoke.resolve()
            } catch (error: ActivityNotFoundException) {
                invoke.reject("No Android app can open this file", error)
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Failed to open the file", error)
            }
        }
    }

    private fun requireContentUri(uri: Uri) {
        require(uri.scheme == ContentResolver.SCHEME_CONTENT && !uri.authority.isNullOrBlank()) {
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
