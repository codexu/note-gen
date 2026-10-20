package com.codexu.NoteGen

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import android.webkit.WebView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class SystemBarsArgs {
    lateinit var statusBarColor: String
    lateinit var navigationBarColor: String
    var lightStatusBar: Boolean = false
    var lightNavigationBar: Boolean = false
}

@TauriPlugin
class SystemBarsPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        activity.runOnUiThread {
            val content = activity.findViewById<View>(android.R.id.content)
            val initialLeft = content.paddingLeft
            val initialTop = content.paddingTop
            val initialRight = content.paddingRight
            val initialBottom = content.paddingBottom

            // Older WebViews report zero CSS safe-area insets even when Tauri
            // draws behind the system bars. Size the WebView's container instead.
            ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
                val types = WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
                val insets = windowInsets.getInsets(types)
                view.setPadding(
                    initialLeft + insets.left,
                    initialTop + insets.top,
                    initialRight + insets.right,
                    initialBottom + insets.bottom
                )

                // Forward zero system insets to avoid double spacing on newer
                // WebViews, while preserving keyboard insets and resize events.
                WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(types, Insets.NONE)
                    .setInsetsIgnoringVisibility(types, Insets.NONE)
                    .build()
            }
            ViewCompat.requestApplyInsets(content)
        }
    }

    @Command
    fun setSystemBars(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(SystemBarsArgs::class.java)

            activity.runOnUiThread {
                try {
                    activity.findViewById<View>(android.R.id.content)
                        .setBackgroundColor(Color.parseColor(args.statusBarColor))
                    activity.window.statusBarColor = Color.parseColor(args.statusBarColor)
                    activity.window.navigationBarColor = Color.parseColor(args.navigationBarColor)
                    updateSystemBarIconAppearance(args.lightStatusBar, args.lightNavigationBar)

                    invoke.resolve(JSObject().apply {
                        put("success", true)
                    })
                } catch (ex: Exception) {
                    invoke.reject(ex.message ?: "Failed to update system bars", ex)
                }
            }
        } catch (ex: Exception) {
            invoke.reject(ex.message ?: "Invalid system bars arguments", ex)
        }
    }

    private fun updateSystemBarIconAppearance(lightStatusBar: Boolean, lightNavigationBar: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val statusAppearance = if (lightStatusBar) {
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
            } else {
                0
            }
            val navigationAppearance = if (lightNavigationBar) {
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            } else {
                0
            }

            activity.window.insetsController?.setSystemBarsAppearance(
                statusAppearance or navigationAppearance,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
            return
        }

        var flags = activity.window.decorView.systemUiVisibility

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags = if (lightStatusBar) {
                flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            } else {
                flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = if (lightNavigationBar) {
                flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            } else {
                flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            }
        }

        activity.window.decorView.systemUiVisibility = flags
    }
}
