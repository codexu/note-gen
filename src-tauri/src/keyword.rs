// 关键词提取
use jieba_rs::Jieba;
use jieba_rs::{TfIdf, KeywordExtract};

#[tauri::command]
pub fn cut_words(str: String) -> Vec<String> {
    let jieba = Jieba::new();
    let keyword_extractor = TfIdf::default();
    let top_key = keyword_extractor.extract_keywords(
        &jieba,
        &str,
        5,
        vec![],
    );
    top_key.iter().map(|x| x.keyword.clone()).collect()
}
