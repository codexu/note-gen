#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
}

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    collect_system_font_families().map(|families| {
        families
            .into_iter()
            .map(|family| SystemFont { family })
            .collect()
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn collect_system_font_families() -> Result<Vec<String>, String> {
    use font_kit::source::SystemSource;
    use std::collections::HashSet;

    let mut families = SystemSource::new()
        .all_families()
        .map_err(|error| format!("Failed to list system fonts: {}", error))?
        .into_iter()
        .map(|family| family.trim().to_string())
        .filter(|family| !family.is_empty())
        .collect::<Vec<_>>();

    families.sort_by_cached_key(|family| family.to_lowercase());

    let mut seen = HashSet::new();
    families.retain(|family| seen.insert(family.to_lowercase()));

    Ok(families)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn collect_system_font_families() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}
