package com.codexu.NoteGen

import android.app.Activity
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.util.LinkedHashSet

@InvokeArg
class RecognizeArgs {
    lateinit var imagePath: String
    var languages: List<String> = emptyList()
}

private enum class OcrScript {
    LATIN,
    CHINESE,
    JAPANESE,
}

@TauriPlugin
class OcrPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun recognize(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(RecognizeArgs::class.java)
            val image = InputImage.fromFilePath(activity, Uri.fromFile(File(args.imagePath)))
            val scripts = resolveScripts(args.languages)

            if (scripts.isEmpty()) {
                invoke.reject("No Android OCR recognizer is configured.")
                return
            }

            recognizeNext(
                invoke = invoke,
                image = image,
                scripts = scripts,
                index = 0,
                lines = LinkedHashSet(),
                errors = mutableListOf(),
            )
        } catch (ex: Exception) {
            invoke.reject(ex.message, ex)
        }
    }

    private fun recognizeNext(
        invoke: Invoke,
        image: InputImage,
        scripts: List<OcrScript>,
        index: Int,
        lines: LinkedHashSet<String>,
        errors: MutableList<String>,
    ) {
        if (index >= scripts.size) {
            if (lines.isEmpty() && errors.isNotEmpty()) {
                invoke.reject(errors.joinToString("; "))
                return
            }

            val result = JSObject()
            result.put("text", lines.joinToString("\n"))
            invoke.resolve(result)
            return
        }

        val recognizer = createRecognizer(scripts[index])
        recognizer.process(image)
            .addOnSuccessListener { result ->
                result.text
                    .lineSequence()
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .forEach { lines.add(it) }
            }
            .addOnFailureListener { error ->
                errors.add("${scripts[index]}: ${error.message ?: "recognition failed"}")
            }
            .addOnCompleteListener {
                recognizer.close()
                recognizeNext(invoke, image, scripts, index + 1, lines, errors)
            }
    }

    private fun createRecognizer(script: OcrScript): TextRecognizer {
        return when (script) {
            OcrScript.LATIN -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            OcrScript.CHINESE -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
            OcrScript.JAPANESE -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        }
    }

    private fun resolveScripts(languages: List<String>): List<OcrScript> {
        if (languages.isEmpty()) {
            return listOf(OcrScript.LATIN, OcrScript.CHINESE, OcrScript.JAPANESE)
        }

        val scripts = linkedSetOf<OcrScript>()
        languages.forEach { language ->
            when (normalizeLanguage(language)) {
                "zh" -> scripts.add(OcrScript.CHINESE)
                "ja" -> scripts.add(OcrScript.JAPANESE)
                "latin" -> scripts.add(OcrScript.LATIN)
            }
        }

        return scripts.toList()
    }

    private fun normalizeLanguage(language: String): String? {
        val normalized = language.trim().replace('_', '-').lowercase()
        if (normalized.isEmpty()) {
            return null
        }

        return when {
            normalized == "chi-sim" || normalized == "chi-tra" || normalized == "zh" ||
                normalized.startsWith("zh-") -> "zh"
            normalized == "jpn" || normalized == "ja" || normalized.startsWith("ja-") -> "ja"
            normalized == "eng" || normalized == "en" || normalized.startsWith("en-") ||
                normalized == "pt" || normalized.startsWith("pt-") ||
                normalized == "fr" || normalized.startsWith("fr-") ||
                normalized == "de" || normalized.startsWith("de-") ||
                normalized == "es" || normalized.startsWith("es-") ||
                normalized == "it" || normalized.startsWith("it-") ||
                normalized == "id" || normalized.startsWith("id-") ||
                normalized == "vi" || normalized.startsWith("vi-") ||
                normalized == "tr" || normalized.startsWith("tr-") -> "latin"
            else -> null
        }
    }
}
