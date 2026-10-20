use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchItem {
    pub id: Option<String>,
    pub desc: Option<String>,
    pub title: Option<String>,
    pub article: Option<String>,
    pub url: Option<String>,
    pub path: Option<String>,
    pub search_type: Option<String>,
    pub score: Option<i64>,
    pub matches: Option<Vec<MatchInfo>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchInfo {
    pub key: String,
    pub indices: Vec<[usize; 2]>,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FuzzySearchResult {
    pub item: SearchItem,
    pub refindex: usize,
    pub score: i64,
    pub matches: Vec<MatchInfo>,
}

fn search_item(
    item: &SearchItem,
    pattern: &str,
    keys: &[&str],
    threshold: f64,
) -> Option<FuzzySearchResult> {
    let matcher = SkimMatcherV2::default();
    let mut best_score = 0;
    let mut all_matches = Vec::new();
    let mut has_match = false;

    for key in keys {
        let text = match *key {
            "desc" => item.desc.as_deref().unwrap_or(""),
            "title" => item.title.as_deref().unwrap_or(""),
            "article" => item.article.as_deref().unwrap_or(""),
            "path" => item.path.as_deref().unwrap_or(""),
            "search_type" => item.search_type.as_deref().unwrap_or(""),
            _ => continue,
        };

        if let Some((score, indices)) = matcher.fuzzy_indices(text, pattern) {
            let pattern_length = pattern.chars().count().max(1) as f64;
            let normalized_score = (score as f64).abs() / pattern_length;

            if normalized_score < threshold {
                continue;
            }

            has_match = true;

            if score > best_score {
                best_score = score;
            }

            let mut ranges = Vec::new();
            for &idx in &indices {
                ranges.push([idx, idx]);
            }

            all_matches.push(MatchInfo {
                key: key.to_string(),
                indices: ranges,
                value: text.to_string(),
            });
        }
    }

    if !has_match {
        return None;
    }

    Some(FuzzySearchResult {
        item: item.clone(),
        refindex: 0,
        score: best_score,
        matches: all_matches,
    })
}

#[command]
pub fn fuzzy_search(
    items: Vec<SearchItem>,
    query: String,
    keys: Vec<String>,
    threshold: f64,
    include_score: bool,
    include_matches: bool,
) -> Vec<FuzzySearchResult> {
    if query.is_empty() {
        return Vec::new();
    }

    let keys_str: Vec<&str> = keys.iter().map(|s| s.as_str()).collect();

    let mut results: Vec<_> = items
        .par_iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let mut result = search_item(item, &query, &keys_str, threshold)?;
            result.refindex = index;
            Some(result)
        })
        .collect();

    results.sort_by_key(|r| Reverse(r.score));

    if !include_score || !include_matches {
        for result in &mut results {
            if !include_score {
                result.score = 0;
                result.item.score = None;
            }
            if !include_matches {
                result.matches.clear();
                result.item.matches = None;
            }
        }
    }

    results
}

#[command]
pub fn fuzzy_search_parallel(
    items: Vec<SearchItem>,
    query: String,
    keys: Vec<String>,
    threshold: f64,
    include_score: bool,
    include_matches: bool,
) -> Vec<FuzzySearchResult> {
    fuzzy_search(
        items,
        query,
        keys,
        threshold,
        include_score,
        include_matches,
    )
}
