package com.codexu.NoteGen

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class AndroidCloudFolderRootArgs {
    lateinit var rootUri: String
    var scope: String = "sync"
}

@InvokeArg
class AndroidCloudFolderFileArgs {
    lateinit var rootUri: String
    lateinit var key: String
    var scope: String = "sync"
}

@InvokeArg
class AndroidCloudFolderWriteArgs {
    lateinit var rootUri: String
    lateinit var key: String
    lateinit var contentBase64: String
    var scope: String = "sync"
}

@InvokeArg
class AndroidCloudFolderListArgs {
    lateinit var rootUri: String
    var prefix: String? = null
    var scope: String = "sync"
}

@InvokeArg
class AndroidSecureKeyArgs {
    lateinit var key: String
}

@InvokeArg
class AndroidSecureValueArgs {
    lateinit var key: String
    lateinit var value: String
}

@TauriPlugin
class CloudFolderPlugin(private val activity: Activity) : Plugin(activity) {
    private val resolver get() = activity.contentResolver
    private val securePreferences by lazy {
        activity.getSharedPreferences("notegen_secure_storage", Activity.MODE_PRIVATE)
    }

    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEYSTORE_ALIAS = "NoteGenSecureStorageKey"
        private const val GCM_TAG_LENGTH = 128
    }

    @Command
    fun setSecureValue(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidSecureValueArgs::class.java)
            requireSecureKey(args.key)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecureKey())
            val encrypted = cipher.doFinal(args.value.toByteArray(Charsets.UTF_8))
            val payload = "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(encrypted, Base64.NO_WRAP)}"
            if (!securePreferences.edit().putString(args.key, payload).commit()) {
                throw IllegalStateException("Failed to save the secure value")
            }
            null
        }
    }

    @Command
    fun getSecureValue(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidSecureKeyArgs::class.java)
            requireSecureKey(args.key)
            val payload = securePreferences.getString(args.key, null) ?: return@runAsync null
            try {
                val parts = payload.split(':', limit = 2)
                if (parts.size != 2) throw IllegalStateException("Invalid secure value")
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateSecureKey(),
                    GCMParameterSpec(GCM_TAG_LENGTH, Base64.decode(parts[0], Base64.NO_WRAP))
                )
                String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
            } catch (error: Exception) {
                securePreferences.edit().remove(args.key).commit()
                throw IllegalStateException("The secure value can no longer be decrypted", error)
            }
        }
    }

    @Command
    fun deleteSecureValue(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidSecureKeyArgs::class.java)
            requireSecureKey(args.key)
            if (!securePreferences.edit().remove(args.key).commit()) {
                throw IllegalStateException("Failed to delete the secure value")
            }
            null
        }
    }

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve()
            return
        }
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.reject("Failed to select the cloud folder")
            return
        }

        try {
            val intent = result.data ?: throw IllegalStateException("The folder picker returned no data")
            val uri = intent.data ?: throw IllegalStateException("The folder picker returned no URI")
            val grantedFlags = intent.flags and
                (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            if (grantedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0 ||
                grantedFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION == 0
            ) {
                throw SecurityException("The selected folder does not grant read and write access")
            }
            resolver.takePersistableUriPermission(uri, grantedFlags)
            val root = documentTree(uri)
            invoke.resolve(JSObject().apply {
                put("uri", uri.toString())
                put("displayName", root.name ?: uri.lastPathSegment ?: "Cloud folder")
            })
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to persist cloud folder access", error)
        }
    }

    @Command
    fun releaseFolder(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidCloudFolderRootArgs::class.java)
            val uri = Uri.parse(args.rootUri)
            try {
                resolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // The grant may already have been revoked by the provider or the user.
            }
            null
        }
    }

    @Command
    fun testFolder(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidCloudFolderRootArgs::class.java)
            val base = resolveBase(args.rootUri, args.scope, true)
                ?: throw IllegalStateException("Unable to create the NoteGen sync directory")
            val manifest = findChild(base, "provider.json")
            if (manifest == null) {
                writeBytes(
                    base,
                    "provider.json",
                    "{\n  \"format\": \"notegen-cloud-folder-sync\",\n  \"version\": 1\n}\n".toByteArray()
                )
            } else if (!manifest.isFile) {
                throw IllegalStateException("The NoteGen sync manifest is not a file")
            }
            val probeName = ".notegen-probe-${UUID.randomUUID()}.tmp"
            val probeBytes = UUID.randomUUID().toString().toByteArray()
            val probe = writeBytes(base, probeName, probeBytes)
            val matches = readBytes(probe).contentEquals(probeBytes)
            if (!probe.delete()) throw IllegalStateException("Unable to delete files from the selected folder")
            matches
        }
    }

    @Command
    fun writeFile(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidCloudFolderWriteArgs::class.java)
            val segments = normalizedSegments(args.key)
            val base = resolveBase(args.rootUri, args.scope, true)
                ?: throw IllegalStateException("Unable to create the NoteGen sync directory")
            val parent = resolveDirectory(base, segments.dropLast(1), true)
                ?: throw IllegalStateException("Unable to create the cloud folder path")
            val bytes = Base64.decode(args.contentBase64, Base64.DEFAULT)
            val file = writeBytes(parent, segments.last(), bytes)
            fileMetadata(args.key, file, sha256(bytes))
        }
    }

    @Command
    fun readFile(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidCloudFolderFileArgs::class.java)
            val file = resolveFile(args.rootUri, args.scope, args.key) ?: return@runAsync null
            val bytes = readBytes(file)
            mapOf(
                "contentBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
                "size" to bytes.size.toLong(),
                "modifiedAt" to file.lastModified(),
                "etag" to sha256(bytes)
            )
        }
    }

    @Command
    fun deleteFile(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidCloudFolderFileArgs::class.java)
            val file = resolveFile(args.rootUri, args.scope, args.key) ?: return@runAsync true
            if (!file.isFile) throw IllegalStateException("Cloud sync target is not a file")
            if (!file.delete()) throw IllegalStateException("Failed to delete the cloud sync file")
            true
        }
    }

    @Command
    fun listFiles(invoke: Invoke) {
        runAsync(invoke) {
            val args = invoke.parseArgs(AndroidCloudFolderListArgs::class.java)
            val base = resolveBase(args.rootUri, args.scope, false) ?: return@runAsync emptyList<Map<String, Any>>()
            val prefix = args.prefix?.takeIf { it.isNotBlank() }
            val start = if (prefix == null) base else resolveEntry(base, normalizedSegments(prefix))
                ?: return@runAsync emptyList<Map<String, Any>>()
            val files = mutableListOf<Map<String, Any>>()
            if (start.isFile) {
                val key = prefix ?: start.name.orEmpty()
                files.add(fileMetadata(key, start, sha256(readBytes(start))))
            } else {
                val initialPath = prefix?.trim('/') ?: ""
                collectFiles(start, initialPath, args.scope, files)
            }
            files.sortedBy { it["key"] as String }
        }
    }

    private fun runAsync(invoke: Invoke, operation: () -> Any?) {
        Thread {
            try {
                val result = operation()
                if (result == null) invoke.resolve() else invoke.resolveObject(result)
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Android cloud folder operation failed", error)
            }
        }.start()
    }

    private fun documentTree(uri: Uri): DocumentFile {
        if (uri.scheme != "content") throw IllegalArgumentException("Cloud folder URI must use the content scheme")
        return DocumentFile.fromTreeUri(activity, uri)
            ?: throw IllegalArgumentException("The selected folder is not available")
    }

    private fun resolveBase(rootUri: String, scope: String, create: Boolean): DocumentFile? {
        val root = documentTree(Uri.parse(rootUri))
        if (!root.exists() || !root.isDirectory || !root.canRead() || !root.canWrite()) {
            throw SecurityException("The selected cloud folder is no longer readable and writable")
        }
        if (scope == "workspace") return root
        if (scope != "sync") throw IllegalArgumentException("Unsupported cloud folder scope")
        return resolveDirectory(root, listOf(".notegen", "sync-v1"), create)
    }

    private fun normalizedSegments(key: String): List<String> {
        if (key.isBlank() || key.startsWith('/') || key.startsWith('\\')) {
            throw IllegalArgumentException("Cloud sync key must be a non-empty relative path")
        }
        val segments = key.replace('\\', '/').split('/')
        if (segments.any { it.isBlank() || it == "." || it == ".." || it.contains('\u0000') }) {
            throw IllegalArgumentException("Cloud sync key contains an unsafe path component")
        }
        return segments
    }

    private fun findChild(directory: DocumentFile, name: String): DocumentFile? {
        return directory.listFiles().firstOrNull { it.name == name }
    }

    private fun resolveDirectory(
        base: DocumentFile,
        segments: List<String>,
        create: Boolean
    ): DocumentFile? {
        var current = base
        for (segment in segments) {
            val existing = findChild(current, segment)
            if (existing != null) {
                if (!existing.isDirectory) throw IllegalStateException("Cloud sync path contains a non-directory entry")
                current = existing
                continue
            }
            if (!create) return null
            current = current.createDirectory(segment)
                ?: throw IllegalStateException("Failed to create cloud sync directory: $segment")
        }
        return current
    }

    private fun resolveEntry(base: DocumentFile, segments: List<String>): DocumentFile? {
        var current = base
        for (segment in segments) {
            current = findChild(current, segment) ?: return null
        }
        return current
    }

    private fun resolveFile(rootUri: String, scope: String, key: String): DocumentFile? {
        val segments = normalizedSegments(key)
        val base = resolveBase(rootUri, scope, false) ?: return null
        val parent = resolveDirectory(base, segments.dropLast(1), false) ?: return null
        val file = findChild(parent, segments.last()) ?: return null
        if (!file.isFile) throw IllegalStateException("Cloud sync target is not a file")
        return file
    }

    private fun writeBytes(parent: DocumentFile, name: String, bytes: ByteArray): DocumentFile {
        val existing = findChild(parent, name)
        if (existing != null && !existing.isFile) {
            throw IllegalStateException("Cloud sync target is not a file")
        }
        val target = existing ?: parent.createFile("application/octet-stream", name)
            ?: throw IllegalStateException("Failed to create cloud sync file: $name")
        resolver.openOutputStream(target.uri, "rwt").use { output ->
            if (output == null) throw IllegalStateException("Failed to open cloud sync file for writing")
            output.write(bytes)
            output.flush()
        }
        return target
    }

    private fun readBytes(file: DocumentFile): ByteArray {
        return resolver.openInputStream(file.uri).use { input ->
            input?.readBytes() ?: throw IllegalStateException("Failed to open cloud sync file for reading")
        }
    }

    private fun collectFiles(
        directory: DocumentFile,
        relativePath: String,
        scope: String,
        files: MutableList<Map<String, Any>>
    ) {
        for (entry in directory.listFiles()) {
            val name = entry.name ?: continue
            if (scope == "workspace" && name.startsWith('.')) continue
            val key = if (relativePath.isEmpty()) name else "$relativePath/$name"
            if (entry.isDirectory) {
                collectFiles(entry, key, scope, files)
            } else if (entry.isFile) {
                files.add(fileMetadata(key, entry, sha256(readBytes(entry))))
            }
        }
    }

    private fun fileMetadata(key: String, file: DocumentFile, etag: String): Map<String, Any> {
        return mapOf(
            "key" to key.trim('/'),
            "size" to file.length(),
            "modifiedAt" to file.lastModified(),
            "etag" to etag
        )
    }

    private fun sha256(bytes: ByteArray): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }

    private fun requireSecureKey(key: String) {
        if (!key.matches(Regex("[A-Za-z0-9._-]{1,64}"))) {
            throw IllegalArgumentException("Invalid secure storage key")
        }
    }

    private fun getOrCreateSecureKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getKey(KEYSTORE_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }
}
