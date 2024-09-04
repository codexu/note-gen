//计算中文字符长度
export default function checkTextLength(chars: string) {
  const fuhao = [
    "，",
    "。",
    "；",
    "！",
    "：",
    "【",
    "】",
    "…",
    "？",
    "“",
    "”",
    "—",
    "·",
    "、",
    "《",
    "》",
    "（",
    "）",
    "￥",
    "＠",
  ];
  const fuhao_code = [];
  for (var j = 0; j < fuhao.length; j++) {
    fuhao_code.push(fuhao[j].charCodeAt(0));
  }

  let sum = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars.charCodeAt(i);
    if ((c >= 0x0001 && c <= 0x007e) || (0xff60 <= c && c <= 0xff9f)) {
    } else if (fuhao_code.indexOf(c) >= 0) {
    } else {
      sum += 2;
    }
  }

  return sum / 2;
}
