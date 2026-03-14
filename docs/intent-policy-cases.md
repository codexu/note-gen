# Intent Policy Cases

用于整理 Agent 意图判定、确认策略和执行策略的高风险回归场景，方便后续补自动化测试。

## 应继续分析

- `这个 PR 改了什么`
- `帮我看看这份脚本在做什么`
- `这个 PPT 大概会长什么样`
- `解释一下这段 Python`
- `这个 skill 是怎么工作的`

预期：
- `allowWrite = false`
- `allowExecute = false`
- 不触发工具执行

## 应允许写入并进入确认流

- `帮我写一篇关于关羽的文章`
- `创建一篇关于关羽的笔记`
- `把这段加到当前文档结尾`
- `把标题改成《上下文测试》`
- `重命名这个文件`
- `移动到归档目录`
- `复制一份到 outputs`

预期：
- `allowWrite = true` 或至少允许写入工具进入确认流
- `allowExecute = false`
- 不应被“分析模式”提前拦截

## 应允许执行

- `导出成 PDF`
- `转成 PPTX`
- `生成一个两页演示文稿并保存为 pptx 文件`
- `把这篇 Markdown 渲染成幻灯片`
- `生成缩略图`
- `导出图片`
- `把这个文档转换成 docx`
- `用 pptx skill 生成演示文稿`
- `帮我跑这个转换脚本`
- `执行这个 skill 产出文件`

预期：
- `allowExecute = true`
- 不应被“分析模式：不会执行命令或脚本”拦截

## 应执行但仍逐次确认高风险

- `删除这个文件`
- `清空输出目录`
- `运行这个 shell 命令`
- `执行 Python 脚本删除临时文件`
- `批量删除这些记录`

预期：
- 高风险操作仍然逐次确认
- 不应被“本会话都允许”自动放行

## 应允许当前 Skill 的 Runtime 脚本本会话放行

场景 A：
- 第一次确认：`execute_skill_script`
- `skill_id = pptx`
- `args = ["create_pptx.py"]`

预期：
- 可显示“本会话允许此 Skill 脚本”

场景 B：
- 同一会话再次执行 `execute_skill_script`
- `skill_id = pptx`
- runtime 脚本参数如 `["render_cover.py"]`

预期：
- 自动通过，不再次弹确认

场景 C：
- 同一会话执行 `execute_skill_script`
- `skill_id = pdf`
- runtime 脚本参数如 `["convert_pdf.py"]`

预期：
- 不自动通过

场景 D：
- 同一会话执行 `execute_skill_script`
- `skill_id = pptx`
- 参数为内置脚本 `["scripts/office/unpack.py"]`

预期：
- 不自动通过

## 最容易漏掉的边界

- `保存为文件` 应算执行，不只是写入
- `生成报告` 如果目标是文件产物，应算执行
- `写一篇文章` 只是内容生成，不应算执行
- `生成脚本` 是写入
- `生成脚本并运行` 同时是写入 + 执行
- `create_file` 成功后，如果后续模型续答失败，不应把成功任务显示成失败
- `Action Input` 中的长文本若包含未转义换行，不应直接导致任务提前结束
