mod ai;
mod analytics;
#[cfg(target_os = "android")]
mod android_ocr;
mod backup;
mod database_recovery;
mod device;
mod fonts;
#[cfg(target_os = "ios")]
mod ios_ocr;
mod mcp;
mod mcp_runtime;
mod mobile_system_bars;
mod notion_import;
mod ocr_packages;
mod printing;
mod remote_skills;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod skill_runtime;
mod skills;
mod system_trash;

use ai::{
    ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request,
    cancel_ai_request, AiRequestManager,
};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use device::get_device_id;
use fonts::list_system_fonts;
use mcp::{
    send_mcp_message, send_mcp_notification, start_mcp_stdio_server, stop_mcp_server,
    McpServerManager,
};
use mcp_runtime::{
    cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager,
};
use notion_import::import_notion_zip;
use ocr_packages::{list_ocr_providers, run_ocr_provider};
use remote_skills::{
    cancel_remote_skill_download, inspect_remote_skill, install_remote_skill, search_remote_skills,
    RemoteSkillManager,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use skill_runtime::{
    cancel_skill_script, inspect_skill_python, install_skill_python_dependencies, run_skill_script,
    SkillProcessManager,
};
use skills::{
    import_skill, import_skill_zip, install_skill_package, uninstall_skill, validate_skill_package,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .manage(RemoteSkillManager::default());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.manage(SkillProcessManager::default());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(android_ocr::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(mobile_system_bars::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(ios_ocr::init());

    builder
        .invoke_handler(tauri::generate_handler![
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            send_mcp_notification,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            list_system_fonts,
            analytics::track_analytics_event,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            database_recovery::delete_local_database,
            import_skill,
            import_skill_zip,
            import_notion_zip,
            validate_skill_package,
            install_skill_package,
            uninstall_skill,
            search_remote_skills,
            inspect_remote_skill,
            install_remote_skill,
            cancel_remote_skill_download,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            run_skill_script,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            cancel_skill_script,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            inspect_skill_python,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            install_skill_python_dependencies,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            list_ocr_providers,
            run_ocr_provider,
            printing::print_webview,
            mobile_system_bars::set_mobile_system_bars,
            system_trash::move_paths_to_trash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
