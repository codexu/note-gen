use jieba_rs::Jieba;
use jieba_rs::KeywordExtract;
use jieba_rs::TextRank;
use serde::{Serialize, Deserialize};
use std::sync::OnceLock;
use tauri::command;
use std::collections::HashSet;
use regex::Regex;

#[derive(Debug, Serialize, Deserialize)]
pub struct Keyword {
    pub text: String,
    pub weight: f64,
}

fn get_jieba() -> &'static Jieba {
    static JIEBA: OnceLock<Jieba> = OnceLock::new();

    JIEBA.get_or_init(|| {
        Jieba::new()
    })
}

fn get_text_rank() -> TextRank {
    TextRank::default()
}

/// 获取停用词集合
/// 过滤掉没有实际检索意义的虚词、系动词等
fn get_stop_words() -> HashSet<&'static str> {
    [
        // 中文虚词/系动词
        "的", "了", "是", "在", "有", "和", "就", "不", "人", "都", "一", "一个",
        "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看",
        "好", "自己", "这", "那", "里", "就是", "为", "与", "之", "用", "可以",
        "但", "而", "或", "及", "等", "对", "把", "被", "让", "给", "从", "向",
        "什么", "怎么", "怎样", "如何", "为什么", "哪些", "多少",

        // 英文停用词
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
        "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "must", "can", "this", "that", "these", "those",
        "what", "how", "why", "where", "when", "who", "which",
    ].into_iter().collect()
}

/// 检查词是否为停用词
fn is_stop_word(word: &str) -> bool {
    let stop_words = get_stop_words();
    let word_lower = word.to_lowercase();
    // 检查是否在停用词表中，或者长度为1（单字没有检索意义）
    stop_words.contains(word_lower.as_str()) || word.len() <= 1
}

/// 从文本中提取英文单词
/// 作为 jieba 分词的后备机制，用于提取英文专业术语（如 iPhone、API 等）
fn extract_english_words(text: &str) -> Vec<String> {
    // 匹配连续的英文字母（包括大写开头的词）
    let re = Regex::new(r"[A-Za-z]{2,}").unwrap();
    let mut words = Vec::new();

    for cap in re.find_iter(text) {
        let word = cap.as_str();
        // 过滤掉停用词
        if !is_stop_word(word) {
            words.push(word.to_string());
        }
    }

    // 去重
    words.sort();
    words.dedup();
    words
}

#[command]
pub fn rank_keywords(text: &str, top_k: usize, allowed_pos: Option<Vec<String>>) -> Vec<Keyword> {
    let jieba = get_jieba();
    let extractor = get_text_rank();

    let pos_tags = allowed_pos.unwrap_or_else(||
        vec![
            String::from("n"),    // noun
            String::from("ns"),   // place name
            String::from("nr"),   // person name
            String::from("nz"),   // other proper noun
            String::from("v"),    // verb
            String::from("vn"),   // verbal noun
            String::from("a"),    // adjective
            String::from("ad"),   // adjective as verb
            String::from("an"),   // adjective as noun
            String::from("eng"),  // 英文字母（尝试支持英文）
        ]
    );

    // 提取更多候选关键词（因为会被过滤掉一部分）
    let extract_k = top_k * 3;
    let jieba_keywords = extractor.extract_keywords(
        jieba,
        text,
        extract_k,
        pos_tags,
    );

    // 过滤掉停用词
    let filtered_keywords: Vec<_> = jieba_keywords
        .into_iter()
        .filter(|kw| !is_stop_word(&kw.keyword))
        .collect();

    // 如果 jieba 没有提取到任何关键词，尝试使用英文单词提取作为后备
    if filtered_keywords.is_empty() {
        let english_words = extract_english_words(text);
        if !english_words.is_empty() {
            return english_words
                .into_iter()
                .take(top_k)
                .map(|word| Keyword {
                    text: word,
                    weight: 1000000000.0, // 给英文单词一个高权重
                })
                .collect();
        }
    }

    // 取前 top_k 个
    filtered_keywords
        .into_iter()
        .take(top_k)
        .map(|kw| Keyword {
            text: kw.keyword.clone(),
            weight: kw.weight,
        })
        .collect()
}
