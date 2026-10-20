const CJK_RUN = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+)/u;
const IS_CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[._/-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*(?:\+\+|#)?/gu;

/** 保留连续 CJK 文本和完整标识符，先分离文字系统，避免 React状态管理被吞成一个词。 */
export function getLexicalTerms(text: string): string[] {
  const terms: string[] = [];
  for (const part of text.normalize('NFKC').toLowerCase().split(CJK_RUN)) {
    if (IS_CJK.test(part)) {
      terms.push(part);
    } else {
      terms.push(...(part.match(WORD_PATTERN) || []));
    }
  }
  return terms;
}

/** 使用相同词边界替换一个词，支持 AI模型，同时避免替换 contain 中的 ai。 */
export function replaceLexicalTerm(text: string, term: string, replacement: string): string {
  let replaced = false;
  const normalizedTerm = term.normalize('NFKC').toLowerCase();
  return text.normalize('NFKC').toLowerCase().split(CJK_RUN).map(part => {
    if (replaced) return part;
    if (IS_CJK.test(part)) {
      if (!IS_CJK.test(normalizedTerm) || !part.includes(normalizedTerm)) return part;
      replaced = true;
      return part.replace(normalizedTerm, replacement);
    }
    return part.replace(WORD_PATTERN, candidate => {
      if (replaced || candidate !== normalizedTerm) return candidate;
      replaced = true;
      return replacement;
    });
  }).join('');
}

/** 索引和查询共用：CJK 使用二元组，其他文字保留词、数字及标识符的组成部分。 */
export function tokenizeLexicalText(text: string): string[] {
  const tokens: string[] = [];
  for (const term of getLexicalTerms(text)) {
    if (IS_CJK.test(term)) {
      const characters = Array.from(term);
      if (characters.length === 1) {
        tokens.push(term);
      } else {
        for (let index = 0; index < characters.length - 1; index++) {
          tokens.push(characters[index] + characters[index + 1]);
        }
      }
    } else {
      // 每次出现只计算一次同一词项，保留 ERR_1042、v0.38.0、notes.md、C++ 等。
      tokens.push(...new Set([term, ...term.split(/[._/\-]+|\+\+$|#$/u).filter(Boolean)]));
    }
  }
  return tokens;
}

/** 长问题只补充明确标识符；不把 CJK 二元组逐个送入模糊搜索。 */
export function getIdentifierTerms(text: string): string[] {
  return Array.from(new Set(getLexicalTerms(text).filter(term => (
    !IS_CJK.test(term) && /[\p{N}._/\-+#]/u.test(term)
  )))).slice(0, 4);
}
