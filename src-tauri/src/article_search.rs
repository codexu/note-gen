use fuzzy_matcher::{skim::SkimMatcherV2, FuzzyMatcher};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::path::{Component, PathBuf};
use tauri::{command, Manager, Webview};
use tauri_plugin_fs::FsExt;

mod sparse_skim;

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FsPermission {
    Path(PathBuf),
    Object { path: PathBuf },
}

impl FsPermission {
    fn path(&self) -> PathBuf {
        match self {
            Self::Path(path) | Self::Object { path } => path.clone(),
        }
    }
}

#[derive(Serialize)]
pub struct ArticleHit {
    file: usize,
    score: i64,
    snippet: Excerpt,
}

// Skim matches an ordered subsequence with ASCII smart case. A missing character
// rules out a candidate; text after the last possible match cannot change its score.
fn candidate_prefix<'a>(text: &'a str, query: &str) -> Option<&'a str> {
    let sensitive = query.bytes().any(|c| c.is_ascii_uppercase());
    let last = query.chars().next_back()?;
    let opposite = |c: char| (!sensitive && c.is_ascii_lowercase()).then(|| c.to_ascii_uppercase());
    let end = text
        .rfind(last)
        .max(opposite(last).and_then(|upper| text.rfind(upper)))?
        + last.len_utf8();
    let prefix = &text[..end];
    let mut remainder = prefix;
    for ch in query.chars() {
        let pos = if let Some(upper) = opposite(ch) {
            remainder.find([ch, upper])
        } else {
            remainder.find(ch)
        }?;
        remainder = &remainder[pos + ch.len_utf8()..];
    }
    Some(prefix)
}

fn article_match(
    text: &str,
    query: &str,
    minimum: f64,
    title_hit: bool,
) -> Option<(i64, Option<usize>)> {
    let prefix = candidate_prefix(text, query)?;
    if prefix.len() >= 16 * 1024 && query.len() <= 128 {
        let (score, first) = sparse_skim::score_and_start(prefix, query)?;
        // Skim's negative sentinel can win across very long gaps. Only a
        // positive title can expose the snippet for a non-positive body score.
        if score > 0 || !title_hit {
            return ((score.abs() as f64) >= minimum).then_some((score, Some(first)));
        }
    }
    let (mut score, mut indices) = SkimMatcherV2::default().fuzzy_indices(prefix, query)?;
    if score <= 0 && title_hit && prefix.len() != text.len() {
        (score, indices) = SkimMatcherV2::default().fuzzy_indices(text, query)?;
    }
    ((score.abs() as f64) >= minimum).then(|| (score, indices.first().copied()))
}

#[derive(Serialize)]
#[serde(untagged)]
enum Excerpt {
    Text(String),
    Utf16(Vec<u16>),
}

fn excerpt(text: &str, first: Option<usize>) -> Excerpt {
    // Match JavaScript String.trim (notably BOM and U+0085).
    if text.chars().all(|c| matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')) {
        return Excerpt::Text(String::new());
    }
    // WebKit's original selection uses UTF-16 offsets from the Skim match.
    let start = first.unwrap_or(0).saturating_sub(250);
    let end = first.map_or(500, |i| i + 250);
    let units: Vec<_> = text.encode_utf16().skip(start).take(end - start).collect();
    match String::from_utf16(&units) {
        Ok(snippet) => Excerpt::Text(snippet),
        // JS slice can cut a surrogate pair. Keep those exact units for stable IDs.
        Err(_) => Excerpt::Utf16(units),
    }
}

#[command]
pub async fn search_article_fuzzy(
    webview: Webview,
    root: Option<PathBuf>,
    paths: Vec<PathBuf>,
    queries: Vec<String>,
    threshold: f64,
) -> Result<Vec<Vec<ArticleHit>>, String> {
    // Reuse the calling webview's read_text_file command/global ACL and dynamic FS grants.
    // This command also runs from standalone windows with different capabilities.
    let permission = webview
        .resolve_command_scope::<FsPermission>("fs", "read_text_file")
        .map_err(|e| e.to_string())?
        .ok_or("Filesystem read access is required")?;
    let global = permission.global_scope();
    let command = permission.command_scope();
    let leading_dot = webview
        .config()
        .plugins
        .0
        .get("fs")
        .and_then(|v| v.get("requireLiteralLeadingDot"))
        .and_then(|v| v.as_bool());
    let scope = tauri::fs::Scope::new(
        &webview,
        &tauri::utils::config::FsScope::Scope {
            allow: global
                .allows()
                .iter()
                .chain(command.allows())
                .map(|entry| entry.path())
                .collect(),
            deny: global
                .denies()
                .iter()
                .chain(command.denies())
                .map(|entry| entry.path())
                .collect(),
            require_literal_leading_dot: leading_dot,
        },
    )
    .map_err(|e| e.to_string())?;
    let dynamic = webview.fs_scope();
    let root = match root {
        Some(path) if path.is_absolute() => path,
        Some(_) => return Err("Expected an absolute workspace path".into()),
        None => webview
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("article"),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut groups: Vec<Vec<ArticleHit>> = (0..queries.len()).map(|_| Vec::new()).collect();
        let minimums: Vec<_> = queries
            .iter()
            .map(|q| threshold * q.chars().count() as f64)
            .collect();
        for (file, relative) in paths.iter().enumerate() {
            if relative.extension() != Some("md".as_ref())
                || !relative
                    .components()
                    .all(|x| matches!(x, Component::Normal(_)))
            {
                continue;
            }
            let Some(title) = relative.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(path) = root.join(relative).canonicalize() else {
                continue;
            };
            if scope.is_forbidden(&path)
                || dynamic.is_forbidden(&path)
                || !(scope.is_allowed(&path) || dynamic.is_allowed(&path))
            {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else {
                continue;
            };
            let text = String::from_utf8_lossy(&bytes);
            let article = text.strip_prefix('\u{feff}').unwrap_or(&text);
            for (i, query) in queries.iter().enumerate() {
                let matcher = SkimMatcherV2::default();
                let title_match = matcher.fuzzy_indices(title, query);
                let cached_title = title_match.is_some();
                let title_match = title_match.filter(|m| (m.0.abs() as f64) >= minimums[i]);
                let title_hit = title_match.as_ref().is_some_and(|m| m.0 > 0);
                let title_cells =
                    (title.chars().count() + 1).saturating_mul(query.chars().count() + 1);
                // Skim reuses the title matrix. In a sufficiently long body the
                // first row clears all of it. Short notes must use the original
                // matcher and full strings to preserve historical ties and scores.
                let body_match = if cached_title && article.len() / 4 < title_cells {
                    matcher
                        .fuzzy_indices(article, query)
                        .filter(|m| (m.0.abs() as f64) >= minimums[i])
                        .map(|(score, indices)| (score, indices.first().copied()))
                } else {
                    article_match(article, query, minimums[i], title_hit)
                };
                let score = title_match
                    .map_or(0, |m| m.0)
                    .max(body_match.map_or(0, |m| m.0));
                if score > 0 {
                    groups[i].push(ArticleHit {
                        file,
                        score,
                        snippet: excerpt(article, body_match.and_then(|m| m.1)),
                    });
                }
            }
        }
        for hits in &mut groups {
            hits.sort_by_key(|hit| Reverse(hit.score));
        }
        groups
    })
    .await
    .map_err(|e| e.to_string())
}
