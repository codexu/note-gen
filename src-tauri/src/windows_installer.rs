use std::io;
use std::path::{Path, PathBuf};
use winreg::enums::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY, KEY_WRITE,
};
use winreg::RegKey;

const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

fn install_location(key: &RegKey) -> Option<PathBuf> {
    let location: String = key.get_value("InstallLocation").ok()?;
    // NSIS quotes InstallLocation, while MSI writes an unquoted path.
    let location = location
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(&location);
    if location.is_empty() {
        return None;
    }
    std::fs::canonicalize(location).ok()
}

fn same_directory(left: &Path, right: &Path) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

fn has_current_msi(install_dir: &Path, version: &str) -> bool {
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            let Ok(uninstall) = RegKey::predef(hive)
                .open_subkey_with_flags(UNINSTALL_KEY, KEY_READ | view)
            else {
                continue;
            };
            for name in uninstall.enum_keys().filter_map(Result::ok) {
                // MSI product registrations use a braced product GUID.
                if !name.starts_with('{')
                    || !name.ends_with('}')
                    || uuid::Uuid::parse_str(&name).is_err()
                {
                    continue;
                }
                let Ok(product) = uninstall.open_subkey_with_flags(&name, KEY_READ | view) else {
                    continue;
                };
                if product.get_value::<u32, _>("WindowsInstaller").ok() != Some(1)
                    || product
                        .get_value::<String, _>("DisplayName")
                        .ok()
                        .as_deref()
                        != Some("NoteGen")
                    || product
                        .get_value::<String, _>("DisplayVersion")
                        .ok()
                        .as_deref()
                        != Some(version)
                {
                    continue;
                }
                if install_location(&product)
                    .is_some_and(|location| same_directory(&location, install_dir))
                {
                    return true;
                }
            }
        }
    }
    false
}

// Never run the NSIS uninstaller: it would delete files now owned by MSI.
// Only remove the known per-user NSIS entry when the running release has an
// MSI registration for this exact version and directory. Separate installs,
// pure NSIS installs and installations with incomplete evidence are untouched.
pub fn cleanup_legacy_nsis(version: &str) -> io::Result<()> {
    let executable = std::env::current_exe()?;
    if executable.file_name().and_then(|name| name.to_str()) != Some("note-gen.exe") {
        return Ok(());
    }
    let Some(parent) = executable.parent() else {
        return Ok(());
    };
    let install_dir = std::fs::canonicalize(parent)?;
    if !has_current_msi(&install_dir, version) {
        return Ok(());
    }

    for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let legacy_path = format!(r"{UNINSTALL_KEY}\NoteGen");
        let legacy = match hkcu.open_subkey_with_flags(&legacy_path, KEY_READ | view) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        let is_nsis = match legacy.get_value::<u32, _>("WindowsInstaller") {
            Ok(value) => value == 0,
            Err(error) => error.kind() == io::ErrorKind::NotFound,
        };
        if legacy
            .get_value::<String, _>("DisplayName")
            .ok()
            .as_deref()
            != Some("NoteGen")
            || !is_nsis
            || legacy.get_value::<u32, _>("NoModify").ok() != Some(1)
            || legacy.get_value::<u32, _>("NoRepair").ok() != Some(1)
            || !install_location(&legacy)
                .is_some_and(|location| same_directory(&location, &install_dir))
        {
            continue;
        }
        let Ok(command) = legacy.get_value::<String, _>("UninstallString") else {
            continue;
        };
        // Tauri NSIS writes a quoted executable path without arguments.
        let Some(uninstaller) = command
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
        else {
            continue;
        };
        let uninstaller = Path::new(uninstaller);
        if uninstaller.file_name().and_then(|name| name.to_str()) != Some("uninstall.exe")
            || !uninstaller
                .parent()
                .and_then(|path| std::fs::canonicalize(path).ok())
                .is_some_and(|location| same_directory(&location, &install_dir))
        {
            continue;
        }
        drop(legacy);
        let uninstall = hkcu.open_subkey_with_flags(UNINSTALL_KEY, KEY_WRITE | view)?;
        // Remove the dangerous Apps entry first, even if deleting the old
        // executable later fails (for example because antivirus has it open).
        uninstall.delete_subkey_with_flags("NoteGen", view)?;
        let old_uninstaller = install_dir.join("uninstall.exe");
        match std::fs::symlink_metadata(&old_uninstaller) {
            Ok(metadata) if metadata.file_type().is_file() => std::fs::remove_file(old_uninstaller)?,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}
