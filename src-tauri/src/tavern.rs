use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use flate2::read::ZlibDecoder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// V2 角色卡规范数据结构
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CharacterCardV2 {
    pub spec: Option<String>,
    pub spec_version: Option<String>,
    pub data: CharacterData,
}

/// 角色数据
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CharacterData {
    pub name: Option<String>,
    pub description: Option<String>,
    pub personality: Option<String>,
    pub scenario: Option<String>,
    pub first_mes: Option<String>,
    pub mes_example: Option<String>,
    pub creator_notes: Option<String>,
    pub system_prompt: Option<String>,
    pub post_history_instructions: Option<String>,
    pub alternate_greetings: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub creator: Option<String>,
    pub character_version: Option<String>,
    pub extensions: Option<HashMap<String, serde_json::Value>>,
    pub character_book: Option<CharacterBook>,
}

/// 角色内嵌世界书
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CharacterBook {
    pub name: Option<String>,
    pub description: Option<String>,
    pub scan_depth: Option<u32>,
    pub token_budget: Option<u32>,
    pub recursive_scanning: Option<bool>,
    pub entries: Option<Vec<WorldInfoEntry>>,
}

/// 世界书条目
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct WorldInfoEntry {
    pub keys: Option<Vec<String>>,
    pub secondary_keys: Option<Vec<String>>,
    pub content: Option<String>,
    pub extensions: Option<HashMap<String, serde_json::Value>>,
    pub enabled: Option<bool>,
    pub insertion_order: Option<i32>,
    pub case_sensitive: Option<bool>,
    pub name: Option<String>,
    pub priority: Option<i32>,
    pub id: Option<i32>,
    pub comment: Option<String>,
    pub selective: Option<bool>,
    pub constant: Option<bool>,
    pub position: Option<i32>,
}

/// PNG 解析结果
#[derive(Debug, Serialize, Deserialize)]
pub struct PngParseResult {
    pub success: bool,
    pub error: Option<String>,
    pub version: Option<String>, // "v1", "v2", "v3"
    pub data: Option<serde_json::Value>,
    pub raw_text: Option<String>, // 原始 base64 解码后的文本
}

/// PNG 数据块类型
const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/// 读取 PNG 文件并提取角色卡数据
#[tauri::command]
pub async fn parse_character_png(file_path: String) -> Result<PngParseResult, String> {
    let path = Path::new(&file_path);
    
    if !path.exists() {
        return Ok(PngParseResult {
            success: false,
            error: Some("文件不存在".to_string()),
            version: None,
            data: None,
            raw_text: None,
        });
    }

    let file = File::open(path).map_err(|e| format!("无法打开文件: {}", e))?;
    let mut reader = BufReader::new(file);

    // 验证 PNG 签名
    let mut signature = [0u8; 8];
    reader.read_exact(&mut signature).map_err(|e| format!("读取签名失败: {}", e))?;
    
    if signature != PNG_SIGNATURE {
        return Ok(PngParseResult {
            success: false,
            error: Some("不是有效的 PNG 文件".to_string()),
            version: None,
            data: None,
            raw_text: None,
        });
    }

    // 遍历 PNG 数据块
    let mut chara_data: Option<String> = None;
    let mut ccv3_data: Option<String> = None;

    loop {
        // 读取数据块长度 (4 bytes, big-endian)
        let mut length_bytes = [0u8; 4];
        if reader.read_exact(&mut length_bytes).is_err() {
            break;
        }
        let length = u32::from_be_bytes(length_bytes) as usize;

        // 读取数据块类型 (4 bytes)
        let mut chunk_type = [0u8; 4];
        if reader.read_exact(&mut chunk_type).is_err() {
            break;
        }
        let chunk_type_str = String::from_utf8_lossy(&chunk_type).to_string();

        // 读取数据块内容
        let mut chunk_data = vec![0u8; length];
        if reader.read_exact(&mut chunk_data).is_err() {
            break;
        }

        // 读取 CRC (4 bytes)
        let mut crc = [0u8; 4];
        if reader.read_exact(&mut crc).is_err() {
            break;
        }

        // 处理 tEXt 数据块 (V1/V2 格式)
        if chunk_type_str == "tEXt" {
            if let Some((keyword, text)) = parse_text_chunk(&chunk_data) {
                if keyword == "chara" {
                    chara_data = Some(text);
                }
            }
        }

        // 处理 iTXt 数据块 (V3 格式)
        if chunk_type_str == "iTXt" {
            if let Some((keyword, text)) = parse_itxt_chunk(&chunk_data) {
                if keyword == "ccv3" {
                    ccv3_data = Some(text);
                } else if keyword == "chara" && chara_data.is_none() {
                    chara_data = Some(text);
                }
            }
        }

        // IEND 表示 PNG 结束
        if chunk_type_str == "IEND" {
            break;
        }
    }

    // 优先使用 V3 格式
    if let Some(ccv3) = ccv3_data {
        return parse_character_data(&ccv3, "v3");
    }

    // 使用 V1/V2 格式
    if let Some(chara) = chara_data {
        return parse_character_data(&chara, "v2");
    }

    Ok(PngParseResult {
        success: false,
        error: Some("PNG 文件中未找到角色卡数据".to_string()),
        version: None,
        data: None,
        raw_text: None,
    })
}

/// 解析 tEXt 数据块
fn parse_text_chunk(data: &[u8]) -> Option<(String, String)> {
    // tEXt 格式: keyword + NULL + text
    if let Some(null_pos) = data.iter().position(|&b| b == 0) {
        let keyword = String::from_utf8_lossy(&data[..null_pos]).to_string();
        let text = String::from_utf8_lossy(&data[null_pos + 1..]).to_string();
        return Some((keyword, text));
    }
    None
}

/// 解析 iTXt 数据块
fn parse_itxt_chunk(data: &[u8]) -> Option<(String, String)> {
    // iTXt 格式: keyword + NULL + compression_flag + compression_method + language_tag + NULL + translated_keyword + NULL + text
    
    // 读取 keyword
    let keyword_end = data.iter().position(|&b| b == 0)?;
    let keyword = String::from_utf8_lossy(&data[..keyword_end]).to_string();
    let mut pos = keyword_end + 1;

    if pos >= data.len() {
        return None;
    }

    // 读取 compression flag 和 compression method
    let compression_flag = data.get(pos)?;
    let compression_method = data.get(pos + 1)?;
    pos += 2;

    // 跳过 language tag (以 NULL 结尾)
    while pos < data.len() && data[pos] != 0 {
        pos += 1;
    }
    pos += 1; // 跳过 NULL

    // 跳过 translated keyword (以 NULL 结尾)
    while pos < data.len() && data[pos] != 0 {
        pos += 1;
    }
    pos += 1; // 跳过 NULL

    if pos >= data.len() {
        return None;
    }

    // 读取文本内容
    let text_data = &data[pos..];
    
    let text = if *compression_flag == 1 && *compression_method == 0 {
        // 使用 zlib 解压缩
        let mut decoder = ZlibDecoder::new(text_data);
        let mut decompressed = String::new();
        if decoder.read_to_string(&mut decompressed).is_ok() {
            decompressed
        } else {
            String::from_utf8_lossy(text_data).to_string()
        }
    } else {
        String::from_utf8_lossy(text_data).to_string()
    };

    Some((keyword, text))
}

/// 解析角色卡数据
fn parse_character_data(encoded_data: &str, version_hint: &str) -> Result<PngParseResult, String> {
    // Base64 解码
    let decoded = match BASE64.decode(encoded_data.trim()) {
        Ok(d) => d,
        Err(e) => {
            return Ok(PngParseResult {
                success: false,
                error: Some(format!("Base64 解码失败: {}", e)),
                version: None,
                data: None,
                raw_text: Some(encoded_data.to_string()),
            });
        }
    };

    // 转换为 UTF-8 字符串
    let json_str = match String::from_utf8(decoded) {
        Ok(s) => s,
        Err(e) => {
            return Ok(PngParseResult {
                success: false,
                error: Some(format!("UTF-8 解码失败: {}", e)),
                version: None,
                data: None,
                raw_text: Some(encoded_data.to_string()),
            });
        }
    };

    // 解析 JSON
    let json_value: serde_json::Value = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(e) => {
            return Ok(PngParseResult {
                success: false,
                error: Some(format!("JSON 解析失败: {}", e)),
                version: None,
                data: None,
                raw_text: Some(json_str),
            });
        }
    };

    // 判断版本
    let version = if let Some(spec) = json_value.get("spec").and_then(|s| s.as_str()) {
        if spec == "chara_card_v3" {
            "v3".to_string()
        } else if spec == "chara_card_v2" {
            "v2".to_string()
        } else {
            version_hint.to_string()
        }
    } else if json_value.get("data").is_some() {
        // 有 data 字段通常是 V2
        "v2".to_string()
    } else {
        // V1 格式 (直接是角色数据)
        "v1".to_string()
    };

    // 如果是 V1，转换为 V2 格式
    let normalized_data = if version == "v1" {
        serde_json::json!({
            "spec": "chara_card_v2",
            "spec_version": "2.0",
            "data": json_value
        })
    } else {
        json_value
    };

    Ok(PngParseResult {
        success: true,
        error: None,
        version: Some(version),
        data: Some(normalized_data),
        raw_text: Some(json_str),
    })
}

/// 将角色数据编码为 Base64
#[tauri::command]
pub async fn encode_character_to_base64(character_json: String) -> Result<String, String> {
    Ok(BASE64.encode(character_json.as_bytes()))
}

/// 导出角色卡到 PNG 文件
/// 将角色数据嵌入到现有 PNG 图片的 tEXt 数据块中
#[tauri::command]
pub async fn export_character_png(
    source_png_path: String,
    output_path: String,
    character_json: String,
) -> Result<bool, String> {
    use std::io::Write;
    
    let source_path = Path::new(&source_png_path);
    let output = Path::new(&output_path);
    
    if !source_path.exists() {
        return Err("源图片文件不存在".to_string());
    }
    
    // 读取源 PNG 文件
    let source_data = std::fs::read(source_path)
        .map_err(|e| format!("读取源文件失败: {}", e))?;
    
    // 验证 PNG 签名
    if source_data.len() < 8 || &source_data[0..8] != &PNG_SIGNATURE {
        return Err("源文件不是有效的 PNG".to_string());
    }
    
    // Base64 编码角色数据
    let encoded_data = BASE64.encode(character_json.as_bytes());
    
    // 构建 tEXt 数据块
    let keyword = b"chara";
    let mut chunk_data = Vec::new();
    chunk_data.extend_from_slice(keyword);
    chunk_data.push(0); // NULL 分隔符
    chunk_data.extend_from_slice(encoded_data.as_bytes());
    
    // 计算 CRC
    let chunk_type = b"tEXt";
    let mut crc_data = Vec::new();
    crc_data.extend_from_slice(chunk_type);
    crc_data.extend_from_slice(&chunk_data);
    let crc = calculate_crc(&crc_data);
    
    // 构建新的 PNG 文件
    let mut output_data = Vec::new();
    output_data.extend_from_slice(&PNG_SIGNATURE);
    
    let mut pos = 8;
    let mut inserted = false;
    
    while pos < source_data.len() {
        // 读取数据块长度
        if pos + 4 > source_data.len() { break; }
        let length = u32::from_be_bytes([source_data[pos], source_data[pos+1], source_data[pos+2], source_data[pos+3]]) as usize;
        pos += 4;
        
        // 读取数据块类型
        if pos + 4 > source_data.len() { break; }
        let chunk_type_bytes = &source_data[pos..pos+4];
        let chunk_type_str = String::from_utf8_lossy(chunk_type_bytes);
        pos += 4;
        
        // 跳过现有的 chara tEXt 数据块
        if chunk_type_str == "tEXt" && pos + length <= source_data.len() {
            let chunk_content = &source_data[pos..pos+length];
            if let Some(null_pos) = chunk_content.iter().position(|&b| b == 0) {
                let kw = String::from_utf8_lossy(&chunk_content[..null_pos]);
                if kw == "chara" {
                    // 跳过这个数据块
                    pos += length + 4; // +4 for CRC
                    continue;
                }
            }
        }
        
        // 在 IDAT 之前插入新的 tEXt 数据块
        if !inserted && (chunk_type_str == "IDAT" || chunk_type_str == "IEND") {
            // 写入新的 tEXt 数据块
            output_data.extend_from_slice(&(chunk_data.len() as u32).to_be_bytes());
            output_data.extend_from_slice(b"tEXt");
            output_data.extend_from_slice(&chunk_data);
            output_data.extend_from_slice(&crc.to_be_bytes());
            inserted = true;
        }
        
        // 复制原始数据块
        output_data.extend_from_slice(&(length as u32).to_be_bytes());
        output_data.extend_from_slice(chunk_type_bytes);
        if pos + length <= source_data.len() {
            output_data.extend_from_slice(&source_data[pos..pos+length]);
            pos += length;
        }
        // CRC
        if pos + 4 <= source_data.len() {
            output_data.extend_from_slice(&source_data[pos..pos+4]);
            pos += 4;
        }
        
        if chunk_type_str == "IEND" {
            break;
        }
    }
    
    // 写入输出文件
    let mut file = std::fs::File::create(output)
        .map_err(|e| format!("创建输出文件失败: {}", e))?;
    file.write_all(&output_data)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    
    Ok(true)
}

/// 计算 PNG CRC32
fn calculate_crc(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    crc ^ 0xFFFFFFFF
}

/// 批量解析多个 PNG 文件
#[tauri::command]
pub async fn parse_character_pngs(file_paths: Vec<String>) -> Result<Vec<PngParseResult>, String> {
    let mut results = Vec::new();
    
    for path in file_paths {
        let result = parse_character_png(path).await?;
        results.push(result);
    }
    
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_text_chunk() {
        let data = b"chara\0SGVsbG8gV29ybGQ=";
        let result = parse_text_chunk(data);
        assert!(result.is_some());
        let (keyword, text) = result.unwrap();
        assert_eq!(keyword, "chara");
        assert_eq!(text, "SGVsbG8gV29ybGQ=");
    }
}
