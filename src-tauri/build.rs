#[cfg(target_os = "macos")]
fn copy_dir(source: &std::path::Path, target: &std::path::Path, ignore_names: &[&str]) {
    use std::fs;

    let _ = fs::remove_dir_all(target);

    for entry in fs::read_dir(source).expect("failed to read source directory") {
        let entry = entry.expect("failed to read source directory entry");
        let path = entry.path();
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        if ignore_names.iter().any(|name| *name == file_name_str) {
            continue;
        }

        let output = target.join(&file_name);
        let metadata = entry.metadata().expect("failed to read source metadata");

        if metadata.is_dir() {
            fs::create_dir_all(&output).expect("failed to create output directory");
            copy_dir(&path, &output, ignore_names);
        } else if metadata.is_file() {
            fs::create_dir_all(target).expect("failed to create output directory");
            fs::copy(&path, &output).expect("failed to copy source file");
        }
    }
}

#[cfg(target_os = "macos")]
fn link_ios_vision_ocr_provider() {
    use std::fs;
    use std::path::{Path, PathBuf};

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let plugin_dir = manifest_dir.join("native-ocr").join("ios-vision");
    let tauri_library_path = std::env::var("DEP_TAURI_IOS_LIBRARY_PATH")
        .expect("missing DEP_TAURI_IOS_LIBRARY_PATH for iOS OCR plugin");
    let tauri_api_output = plugin_dir.join(".tauri").join("tauri-api");

    fs::create_dir_all(tauri_api_output.parent().unwrap())
        .expect("failed to create iOS OCR Tauri API directory");
    copy_dir(
        Path::new(&tauri_library_path),
        &tauri_api_output,
        &[".build", "Package.resolved", "Tests"],
    );

    tauri_utils::build::link_apple_library("notegen-ocr-ios", &plugin_dir);
    println!(
        "cargo:rerun-if-changed={}",
        plugin_dir.join("Package.swift").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        plugin_dir.join("Sources").join("OcrPlugin.swift").display()
    );
    println!("cargo:rerun-if-env-changed=DEP_TAURI_IOS_LIBRARY_PATH");
}

#[cfg(target_os = "macos")]
fn build_macos_vision_ocr_provider() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let source = manifest_dir
        .join("native-ocr")
        .join("macos-vision")
        .join("main.swift");
    let resource_output_dir = manifest_dir.join("resources").join("ocr");
    let resource_output = resource_output_dir.join("notegen-ocr-vision");
    let build_output_dir = out_dir.join("native-ocr");
    let build_output = build_output_dir.join("notegen-ocr-vision");
    let swift_target = match std::env::var("TARGET").as_deref() {
        Ok("aarch64-apple-darwin") => "arm64-apple-macosx11.0",
        Ok("x86_64-apple-darwin") => "x86_64-apple-macosx10.13",
        Ok(target) => panic!("unsupported macOS OCR target: {target}"),
        Err(error) => panic!("missing macOS OCR target: {error}"),
    };

    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-env-changed=TARGET");

    if Command::new("swiftc").arg("--version").output().is_err() {
        println!(
            "cargo:warning=swiftc not found; built-in macOS OCR provider will be unavailable."
        );
        return;
    }

    fs::create_dir_all(&resource_output_dir).expect("failed to create OCR resource directory");
    fs::create_dir_all(&build_output_dir).expect("failed to create OCR build directory");

    let status = Command::new("swiftc")
        .arg("-O")
        .arg("-target")
        .arg(swift_target)
        .arg("-framework")
        .arg("Foundation")
        .arg("-framework")
        .arg("Vision")
        .arg(&source)
        .arg("-o")
        .arg(&build_output)
        .status()
        .expect("failed to run swiftc for macOS OCR provider");

    if !status.success() {
        panic!("failed to build macOS OCR provider");
    }

    let built_bytes = fs::read(&build_output).expect("failed to read built OCR provider");
    let resource_bytes = fs::read(&resource_output).ok();

    if resource_bytes.as_deref() != Some(built_bytes.as_slice()) {
        fs::write(&resource_output, built_bytes).expect("failed to update OCR resource");
    }

    let mut permissions = fs::metadata(&resource_output)
        .expect("failed to read OCR resource metadata")
        .permissions();
    if permissions.mode() & 0o111 == 0 {
        permissions.set_mode(0o755);
        fs::set_permissions(&resource_output, permissions)
            .expect("failed to set OCR resource executable permission");
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_vision_ocr_provider();
    }

    #[cfg(target_os = "macos")]
    link_ios_vision_ocr_provider();

    tauri_build::build()
}
