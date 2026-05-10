use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Manager};
use zip::ZipArchive;

#[command]
pub async fn import_skill_zip(app_handle: AppHandle, zip_path: String) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // 确保 skills 目录存在
    let skills_dir = app_data_dir.join("skills");
    if !skills_dir.exists() {
        fs::create_dir_all(&skills_dir)
            .map_err(|e| format!("Failed to create skills directory: {}", e))?;
    }

    // 创建临时目录用于解压
    let temp_dir = app_data_dir.join("temp_skill_import");
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // 使用 zip crate 解压到临时目录
    let file = fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let outpath = temp_dir.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    let skill_root = match find_skill_root(&temp_dir)? {
        Some(path) => path,
        None => {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err("No valid skill found in zip file. A valid skill must contain a SKILL.md file.".to_string());
        }
    };

    let skill_name = if skill_root == temp_dir {
        Path::new(&zip_path)
            .file_stem()
            .and_then(|n| n.to_str())
            .filter(|n| !n.trim().is_empty())
            .ok_or("Failed to get skill directory name from zip file")?
            .to_string()
    } else {
        skill_root.file_name()
            .and_then(|n| n.to_str())
            .ok_or("Failed to get skill directory name")?
            .to_string()
    };

    let dest_path = skills_dir.join(&skill_name);
    if dest_path.exists() {
        fs::remove_dir_all(&dest_path)
            .map_err(|e| format!("Failed to remove existing skill directory: {}", e))?;
    }

    if skill_root == temp_dir {
        copy_dir_recursive(&skill_root, &dest_path)
            .map_err(|e| format!("Failed to copy skill directory: {}", e))?;
    } else {
        fs::rename(&skill_root, &dest_path)
            .or_else(|_| copy_dir_recursive(&skill_root, &dest_path))
            .map_err(|e| format!("Failed to move skill directory: {}", e))?;
    }

    // 清理临时目录
    fs::remove_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to remove temp directory: {}", e))?;

    Ok(skill_name)
}

fn find_skill_root(root: &Path) -> Result<Option<PathBuf>, String> {
    if root.join("SKILL.md").is_file() {
        return Ok(Some(root.to_path_buf()));
    }

    let entries = fs::read_dir(root)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() || is_ignored_zip_metadata_dir(&path) {
            continue;
        }

        if let Some(skill_root) = find_skill_root(&path)? {
            return Ok(Some(skill_root));
        }
    }

    Ok(None)
}

fn is_ignored_zip_metadata_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|name| name == "__MACOSX")
        .unwrap_or(false)
}

// 递归复制目录的辅助函数
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_file() {
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        } else if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        }
    }

    Ok(())
}
