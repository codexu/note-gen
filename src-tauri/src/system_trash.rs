#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::PathBuf;

#[tauri::command]
pub async fn move_paths_to_trash(paths: Vec<String>) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
        if paths.is_empty() {
            return Ok(());
        }
        if paths.iter().any(|path| !path.is_absolute()) {
            return Err("system trash only accepts absolute paths".to_string());
        }

        return tauri::async_runtime::spawn_blocking(move || trash::delete_all(paths))
            .await
            .map_err(|error| format!("failed to run system trash operation: {error}"))?
            .map_err(|error| format!("failed to move item to system trash: {error}"));
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = paths;
        Err("system trash is not available on mobile".to_string())
    }
}
