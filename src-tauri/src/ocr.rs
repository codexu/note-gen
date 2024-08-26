#[tauri::command]
pub fn lt_ocr (path: String) -> String {
  let mut lt = leptess::LepTess::new(None, "chi_sim").unwrap();
  let _ = lt.set_image(path);
  let text = lt.get_utf8_text().unwrap()
    .replace(" ", "")
    .to_string();
  text
}