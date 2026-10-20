#[tauri::command]
pub fn print_webview(
    window: tauri::WebviewWindow,
    path: Option<String>,
    event_name: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::{Read, Seek, SeekFrom};
        use std::path::{Path, PathBuf};
        use std::time::Duration;

        use objc2::runtime::AnyObject;
        use objc2::{AnyThread, ClassType};
        use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSWindow};
        use objc2_foundation::{NSString, NSURL};
        use objc2_web_kit::WKWebView;
        use tauri::{Emitter, Manager};

        fn pdf_is_complete(path: &Path) -> bool {
            let Ok(mut file) = std::fs::File::open(path) else {
                return false;
            };
            let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
                return false;
            };
            if length == 0 {
                return false;
            }

            let tail_length = length.min(2048);
            if file.seek(SeekFrom::End(-(tail_length as i64))).is_err() {
                return false;
            }
            let mut tail = vec![0; tail_length as usize];
            file.read_exact(&mut tail).is_ok()
                && tail.windows(5).any(|window| window == b"%%EOF")
        }

        let print_window = window.clone();
        window
            .with_webview(move |webview| unsafe {
                let webview = &*(webview.inner() as *mut WKWebView);
                let shared_print_info = NSPrintInfo::sharedPrintInfo();
                let print_info = NSPrintInfo::initWithDictionary(
                    NSPrintInfo::alloc(),
                    &shared_print_info.dictionary(),
                );
                let output_paths = path.as_deref().map(|output_path| {
                    let output_path = PathBuf::from(output_path);
                    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
                    let temporary_path = parent.join(format!(
                        ".notegen-pdf-{}.tmp",
                        uuid::Uuid::new_v4()
                    ));
                    (output_path, temporary_path)
                });
                let is_direct_export = output_paths.is_some();

                if let Some((_, temporary_path)) = output_paths.as_ref() {
                    let path = NSString::from_str(&temporary_path.to_string_lossy());
                    let url = NSURL::fileURLWithPath(&path);
                    let url_object: &AnyObject = url.as_super().as_super();
                    print_info.dictionary().insert(NSPrintJobSavingURL, url_object);
                    print_info.setJobDisposition(NSPrintSaveJob);
                }

                let operation = webview.printOperationWithPrintInfo(&print_info);
                operation.setShowsPrintPanel(!is_direct_export);
                operation.setShowsProgressPanel(!is_direct_export);

                if let Some((output_path, temporary_path)) = output_paths {
                    let ns_window = &*(print_window.ns_window().expect("missing NSWindow") as *mut NSWindow);
                    operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                        ns_window,
                        None,
                        None,
                        std::ptr::null_mut(),
                    );

                    // AppKit retains the operation while it runs. Keep our retain alive until
                    // the PDF is complete, then release it back on the main thread.
                    let operation_ptr = objc2::rc::Retained::into_raw(operation) as usize;
                    std::thread::spawn(move || {
                        let mut success = false;
                        let mut error = None;

                        for _ in 0..240 {
                            if pdf_is_complete(&temporary_path) {
                                match std::fs::rename(&temporary_path, &output_path) {
                                    Ok(()) => success = true,
                                    Err(reason) => error = Some(reason.to_string()),
                                }
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(250));
                        }

                        if !success && error.is_none() {
                            error = Some("PDF export timed out".to_string());
                            let _ = std::fs::remove_file(&temporary_path);
                        }

                        if let Some(event_name) = event_name {
                            let _ = print_window.app_handle().emit_to(
                                "main",
                                &event_name,
                                serde_json::json!({ "success": success, "error": error }),
                            );
                        }

                        let close_window = print_window.clone();
                        let _ = print_window.run_on_main_thread(move || {
                            drop(objc2::rc::Retained::from_raw(
                                operation_ptr as *mut NSPrintOperation,
                            ));
                            let _ = close_window.close();
                        });
                    });
                } else {
                    let success = operation.runOperation();
                    if let Some(event_name) = event_name {
                        let _ = print_window.app_handle().emit_to(
                            "main",
                            &event_name,
                            serde_json::json!({ "success": success }),
                        );
                    }
                    let _ = print_window.close();
                }
            })
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, event_name);
        window
            .eval("window.print()")
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}
