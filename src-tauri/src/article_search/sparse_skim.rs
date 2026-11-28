//! SkimMatcherV2 scoring for long notes. Retain only positions that match a
//! query character, and the first character of each winning alignment. RAG
//! needs the score and excerpt start, not a full matrix or all match indices.
use fuzzy_matcher::skim::SkimScoreConfig;
use std::collections::HashMap;
#[derive(Clone, Copy)]
struct Position {
    index: i64,
    actual: char,
    bonus: i64,
}
#[derive(Clone, Copy, Debug)]
struct Alignment {
    end: i64,
    first: usize,
    score: i64,
}

fn boundary_bonus(config: &SkimScoreConfig, previous: char, current: char) -> i64 {
    match previous {
        '\0' | ' ' | '/' | '\\' | '|' | '(' | ')' | '[' | ']' | '{' | '}' => {
            config.bonus_head.into()
        }
        '!'..='\'' | '*'..='.' | ':'..='@' | '^'..='`' | '~' => config.bonus_break.into(),
        _ if current.is_ascii_uppercase() && !previous.is_ascii_uppercase() => {
            config.bonus_camel.into()
        }
        _ => 0,
    }
}

pub(super) fn score_and_start(text: &str, pattern: &str) -> Option<(i64, usize)> {
    let config = SkimScoreConfig::default();
    let sensitive = pattern.bytes().any(|b| b.is_ascii_uppercase());
    let fold = |c: char| if sensitive { c } else { c.to_ascii_lowercase() };
    let mut ascii = [usize::MAX; 128];
    let mut unicode = HashMap::new();
    let mut places: Vec<Vec<Position>> = Vec::new();
    let mut rows = Vec::new();
    for ch in pattern.chars() {
        let c = fold(ch);
        let entry = if c.is_ascii() {
            &mut ascii[c as usize]
        } else {
            unicode.entry(c).or_insert(usize::MAX)
        };
        if *entry == usize::MAX {
            *entry = places.len();
            places.push(Vec::new());
        }
        rows.push((ch, *entry));
    }
    let mut prev = '\0';
    for (j, ch) in text.chars().enumerate() {
        let key = fold(ch);
        let slot = if key.is_ascii() {
            ascii[key as usize]
        } else if unicode.is_empty() {
            usize::MAX
        } else {
            *unicode.get(&key).unwrap_or(&usize::MAX)
        };
        if slot != usize::MAX {
            let bonus = boundary_bonus(&config, prev, ch)
                * if j == 0 {
                    i64::from(config.bonus_first_char_multiplier)
                } else {
                    1
                };
            places[slot].push(Position {
                index: j as i64,
                actual: ch,
                bonus,
            });
        }
        prev = ch;
    }
    let mut prior: Vec<Alignment> = Vec::new();
    let mut next = Vec::new();
    for (i, (c, slot)) in rows.into_iter().enumerate() {
        let mut offset = 0;
        let mut best: Option<Alignment> = None;
        for p in &places[slot] {
            let match_score = i64::from(
                config.score_match
                    + if c == p.actual {
                        0
                    } else {
                        config.penalty_case_mismatch
                    },
            );
            if i == 0 {
                next.push(Alignment {
                    first: p.index as usize,
                    end: p.index,
                    score: match_score + p.bonus + i64::from(config.gap_extension),
                });
                continue;
            }
            // For a gap, score = previous.score + open + extension * gap.
            // Keep the best eligible previous endpoint; ties prefer the latest.
            while offset < prior.len() && prior[offset].end < p.index - 1 {
                let candidate = prior[offset];
                if best.is_none_or(|b| {
                    candidate.score - candidate.end * i64::from(config.gap_extension)
                        >= b.score - b.end * i64::from(config.gap_extension)
                }) {
                    best = Some(candidate)
                }
                offset += 1;
            }
            let skip = best.map(|b| {
                (
                    b.score
                        + i64::from(config.gap_start)
                        + i64::from(config.gap_extension) * (p.index - b.end - 1)
                        + p.bonus,
                    b.first,
                )
            });
            let contiguous = prior.get(offset).filter(|b| b.end == p.index - 1).map(|b| {
                (
                    b.score + i64::from(config.bonus_consecutive).max(p.bonus),
                    b.first,
                )
            });
            let chosen = match (contiguous, skip) {
                (Some(a), Some(b)) => {
                    if a.0 >= b.0 {
                        Some(a)
                    } else {
                        Some(b)
                    }
                }
                (a, b) => a.or(b),
            };
            if let Some((score, first)) = chosen {
                next.push(Alignment {
                    end: p.index,
                    first,
                    score: score + match_score,
                });
            }
        }
        std::mem::swap(&mut prior, &mut next);
        next.clear();
        if prior.is_empty() {
            return None;
        }
    }
    prior
        .iter()
        .max_by_key(|x| x.score)
        .map(|p| (p.score, p.first))
}
