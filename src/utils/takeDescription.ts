import { Data, getCompletions } from '../api/completions.ts';

// 提取识别文字里的重要内容
export default async function takeDescription(content: string) {
  const request_content = `
    内容：${content}，总结这段内容的描述，长度不要超过50字，直接返回总结内容，不要回复内容为类似的开头。
  `
  const data: Data = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: request_content,
      },
    ]
  }
  const res = await getCompletions(data);
  const result = res.data.choices[0].message.content
  return result
}