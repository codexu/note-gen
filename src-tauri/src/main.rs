// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod analytics;
#[cfg(target_os = "android")]
mod android_ocr;
mod app_setup;
mod backup;
mod backup_manager;
mod cloud_folder_sync;
mod database_recovery;
mod device;
mod document_parser;
mod file_open;
mod fonts;
mod fuzzy_search;
mod keywords;
mod local_mcp;
mod mcp;
mod mcp_runtime;
mod notion_import;
mod ocr_packages;
mod printing;
mod plugins;
mod remote_skills;
mod screenshot;
mod self_hosted_crypto;
mod self_hosted_files;
mod self_hosted_security;
mod skill_runtime;
mod skills;
mod storefront;
mod system_trash;
mod tray;
mod web_clipper;
mod window;

use ai::{
    ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request,
    cancel_ai_request, AiRequestManager,
};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use backup_manager::{create_managed_backup, list_managed_backups, restore_managed_backup};
use cloud_folder_sync::{
    delete_cloud_folder_sync_file, get_icloud_sync_folder, list_cloud_folder_sync_files,
    migrate_workspace_to_cloud_folder, read_cloud_folder_sync_file, test_cloud_folder_sync,
    write_cloud_folder_sync_file,
};
use device::get_device_id;
use fonts::list_system_fonts;
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::rank_keywords;
use local_mcp::{
    create_local_mcp_connection, get_local_mcp_status, get_or_create_local_mcp_connection,
    list_local_mcp_connections, rename_local_mcp_connection, reset_local_mcp_access_token,
    reset_local_mcp_connection_token, resolve_local_mcp_request, revoke_local_mcp_connection,
    set_local_mcp_enabled, set_local_mcp_port, set_local_mcp_ready, LocalMcpState,
};
use mcp::{
    send_mcp_message, send_mcp_notification, start_mcp_stdio_server, stop_mcp_server,
    McpServerManager,
};
use mcp_runtime::{
    cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager,
};
use notion_import::import_notion_zip;
use ocr_packages::{list_ocr_providers, run_ocr_provider};
use plugins::{
    plugin_commit_host_state, plugin_confirm_activation, plugin_fetch_market, plugin_import_local,
    plugin_install_market, plugin_list_installed, plugin_read_host_state,
    plugin_delete_workspace_note, plugin_list_workspace_notes, plugin_move_workspace_note,
    plugin_network_fetch, plugin_open_or_create_note, plugin_read_entry, plugin_read_locale,
    plugin_read_usage, plugin_read_workspace_note, plugin_rollback, plugin_uninstall, plugin_write_workspace_note,
    plugin_storage_get, plugin_storage_set, plugin_storage_remove,
    PluginManager,
};
use remote_skills::{
    cancel_remote_skill_download, inspect_remote_skill, install_remote_skill, search_remote_skills,
    RemoteSkillManager,
};
use screenshot::{cleanup_temp_screenshot_dir, screenshot};
use skill_runtime::{
    cancel_skill_script, inspect_skill_python, install_skill_python_dependencies, run_skill_script,
    SkillProcessManager,
};
use skills::{
    import_skill, import_skill_zip, install_skill_package, uninstall_skill, validate_skill_package,
};
use tray::update_tray_record_toolbar_config;
use web_clipper::{
    approve_web_clipper_pairing, get_web_clipper_status, list_web_clipper_connections,
    reject_web_clipper_pairing, resolve_web_clipper_request, revoke_web_clipper_connection,
    set_web_clipper_enabled, set_web_clipper_ready, WebClipperState,
};

fn main() {
    tauri::Builder::default()
        // 单实例插件必须最先加载，避免 Windows 文件关联二次启动时继续初始化托盘等资源。
        .plugin(tauri_plugin_single_instance::init(
            window::handle_single_instance,
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(window::AUTOSTART_ARG)
                .build(),
        )
        // 核心插件
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // MCP 服务器管理器
        .manage(file_open::PendingOpenFiles::default())
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .manage(SkillProcessManager::default())
        .manage(RemoteSkillManager::default())
        .manage(PluginManager::default())
        .manage(WebClipperState::new())
        .manage(LocalMcpState::new())
        // 系统级插件
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        // UI 相关插件
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // 功能插件
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 注册命令处理器
        .invoke_handler(tauri::generate_handler![
            screenshot,
            fuzzy_search,
            fuzzy_search_parallel,
            rank_keywords,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            create_managed_backup,
            list_managed_backups,
            restore_managed_backup,
            get_icloud_sync_folder,
            test_cloud_folder_sync,
            write_cloud_folder_sync_file,
            read_cloud_folder_sync_file,
            delete_cloud_folder_sync_file,
            list_cloud_folder_sync_files,
            migrate_workspace_to_cloud_folder,
            database_recovery::delete_local_database,
            import_skill,
            import_skill_zip,
            import_notion_zip,
            validate_skill_package,
            install_skill_package,
            uninstall_skill,
            plugin_read_host_state,
            plugin_commit_host_state,
            plugin_storage_get,
            plugin_storage_set,
            plugin_storage_remove,
            plugin_list_installed,
            plugin_fetch_market,
            plugin_install_market,
            plugin_confirm_activation,
            plugin_import_local,
            plugins::plugin_development_revision,
            plugin_uninstall,
            plugin_rollback,
            plugin_read_entry,
            plugin_read_locale,
            plugin_read_usage,
            plugin_open_or_create_note,
            plugin_read_workspace_note,
            plugins::plugin_read_attachment,
            plugins::plugin_create_attachment,
            plugin_list_workspace_notes,
            plugin_write_workspace_note,
            plugin_delete_workspace_note,
            plugin_move_workspace_note,
            plugin_network_fetch,
            search_remote_skills,
            inspect_remote_skill,
            install_remote_skill,
            cancel_remote_skill_download,
            run_skill_script,
            cancel_skill_script,
            inspect_skill_python,
            install_skill_python_dependencies,
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            send_mcp_notification,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            document_parser::parse_document,
            list_system_fonts,
            analytics::track_analytics_event,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            update_tray_record_toolbar_config,
            list_ocr_providers,
            run_ocr_provider,
            storefront::get_app_storefront_country_code,
            printing::print_webview,
            file_open::drain_pending_open_files,
            system_trash::move_paths_to_trash,
            approve_web_clipper_pairing,
            reject_web_clipper_pairing,
            get_web_clipper_status,
            list_web_clipper_connections,
            revoke_web_clipper_connection,
            set_web_clipper_enabled,
            set_web_clipper_ready,
            resolve_web_clipper_request,
            create_local_mcp_connection,
            get_local_mcp_status,
            get_or_create_local_mcp_connection,
            list_local_mcp_connections,
            rename_local_mcp_connection,
            reset_local_mcp_access_token,
            reset_local_mcp_connection_token,
            resolve_local_mcp_request,
            revoke_local_mcp_connection,
            set_local_mcp_enabled,
            set_local_mcp_port,
            set_local_mcp_ready,
            self_hosted_crypto::self_hosted_generate_workspace_key,
            self_hosted_crypto::self_hosted_generate_device_key_pair,
            self_hosted_crypto::self_hosted_encrypt,
            self_hosted_crypto::self_hosted_encrypt_bytes,
            self_hosted_crypto::self_hosted_decrypt,
            self_hosted_crypto::self_hosted_decrypt_packed,
            self_hosted_crypto::self_hosted_decrypt_packed_bytes,
            self_hosted_crypto::self_hosted_sha256,
            self_hosted_crypto::self_hosted_derive_argon2id_key,
            self_hosted_crypto::self_hosted_wrap_workspace_key,
            self_hosted_crypto::self_hosted_unwrap_workspace_key,
            self_hosted_security::self_hosted_secure_set,
            self_hosted_security::self_hosted_secure_get,
            self_hosted_security::self_hosted_secure_delete,
            self_hosted_files::self_hosted_portable_path,
            self_hosted_files::self_hosted_import_object_id,
            self_hosted_files::self_hosted_atomic_write,
            self_hosted_files::self_hosted_delete_file,
            self_hosted_files::self_hosted_create_directory,
            self_hosted_files::self_hosted_delete_directory,
            self_hosted_files::self_hosted_move_path,
            self_hosted_files::self_hosted_pending_file_journal,
            self_hosted_files::self_hosted_recover_file_journal,
        ])
        // 应用设置 - 在所有插件和命令注册后
        .setup(app_setup::setup_app)
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                window::handle_macos_reopen(&app_handle, has_visible_windows);
            }
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            tauri::RunEvent::Opened { urls } => {
                file_open::handle_opened_urls(&app_handle, urls);
            }
            tauri::RunEvent::Exit => {
                cleanup_temp_screenshot_dir(&app_handle);
            }
            _ => {}
        });
}
