pub use models::*;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
#[cfg(desktop)]
mod desktop;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;
pub mod utils;
pub use error::{Error, Result};

#[cfg(desktop)]
pub use desktop::Clipboard;
#[cfg(mobile)]
pub use mobile::Clipboard;

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("clipboard")
        .invoke_handler(tauri::generate_handler![
            commands::stop_monitor,
            commands::start_monitor,
            commands::is_monitor_running,
            commands::has_text,
            commands::has_image,
            commands::has_html,
            commands::has_rtf,
            commands::has_files,
            commands::available_types,
            commands::read_text,
            commands::read_files,
            commands::read_files_uris,
            commands::read_html,
            commands::read_image_base64,
            commands::read_image_binary,
            commands::read_rtf,
            commands::write_text,
            commands::write_html,
            commands::write_html_and_text,
            commands::write_rtf,
            commands::write_image_binary,
            commands::write_image_base64,
            commands::write_files_uris,
            commands::write_files,
            commands::clear
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let clipboard = mobile::init(app, api)?;
            #[cfg(desktop)]
            let clipboard = desktop::init(api)?;
            app.manage(clipboard);
            Ok(())
        })
        .build()
}
