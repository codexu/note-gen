# NoteGen

![](https://img.shields.io/badge/free-pricing?logo=free&color=%20%23155EEF&label=pricing&labelColor=%20%23528bff)
[![GitHub Repo stars](https://img.shields.io/github/stars/codexu/note-gen)](https://github.com/codexu/note-gen)
[![](https://gitcode.com/codexu/note-gen/star/badge.svg)](https://gitcode.com/codexu/note-gen)
![](https://github.com/codexu/note-gen/actions/workflows/release.yml/badge.svg?branch=release)
[![Netlify Status](https://api.netlify.com/api/v1/badges/8f7518c3-b627-4277-bc2f-e477960f5dc4/deploy-status)](https://app.netlify.com/projects/note-gen-docs/deploys)
![](https://img.shields.io/github/downloads/codexu/note-gen/total)
![](https://img.shields.io/github/issues-closed/codexu/note-gen)

<div>
  <a href="https://trendshift.io/repositories/12784" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12784" alt="codexu%2Fnote-gen | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
  <a href="https://hellogithub.com/repository/0163cb946dca44cc8905dbe34c2c987b" target="_blank"><img src="https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=0163cb946dca44cc8905dbe34c2c987b&claim_uid=YJ39kIMBz1TGAvc" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" /></a>
  <a href="https://www.producthunt.com/products/notegen-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-notegen&#0045;2" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=956348&theme=light&t=1749194675492" alt="NoteGen - A&#0032;cross&#0045;platform&#0032;Markdown&#0032;note&#0045;taking&#0032;application | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>
</div>

## Guide

🖥️ Official Document: [English](https://notegen.top/en/) | [简体中文](https://notegen.top/cn/)

💬 Join [WeChat/QQ Group](https://github.com/codexu/note-gen/discussions/110), [Discord](https://discord.gg/SXyVZGpbpk), [Telegram](https://t.me/notegen)

NoteGen is a cross-platform `Markdown` note-taking application dedicated to using AI to bridge recording and writing, organizing fragmented knowledge into a readable note.

![](https://s2.loli.net/2025/06/13/UbVGPrhFl3etnQz.png)

## Why Choose NoteGen?

- Lightweight: [Installation package](https://github.com/codexu/note-gen/releases) is **only 20MB**, free with no ads or bundled software.
- Cross-platform capabilities of `Tauri2`, it supports Windows, MacOS, Linux, iOS, and Android, and it supports free multi-device data synchronization.
- AI-enhanced: Free AI features powered by [SiliconFlow](https://cloud.siliconflow.cn/i/O2ciJeZw), with support for custom third-party models including ChatGPT, Gemini, Ollama, LM Studio, Grok, and more.
- RAG: Your notes are your knowledge base. Support embedding models and reranking models.
- Supports multiple recording methods including `screenshots`, `text`, `illustrations`, `files`, `links`, etc., meeting fragmented recording needs across various scenarios.
- Native `Markdown(.md)` as storage format, no modifications, easy to migrate.
- Offline, supporting real-time synchronization to `Github、Gitee、Gitlab private repositories` with history rollback, and WebDAV synchronization.

## How to Use?

### Download

Currently supports Mac, Windows, and Linux. Thanks to Tauri2's cross-platform capabilities, it will support iOS and Android in the future.

| Windows | MacOS | Linux | Android | iOS |
| --- | --- | --- | --- | --- |
| ✅ beta | ✅ beta | ✅ beta | 🛠️ alpha | 🛠️ alpha |
| [Download](https://notegen.top/en/docs/download#desktop-beta) | [Download](https://notegen.top/en/docs/download#desktop-beta) | [Download](https://notegen.top/en/docs/download#desktop-beta) | [Download](https://notegen.top/en/docs/download#android) | Self-compiled |

> [UpgradeLink offers application upgrade and download services](http://upgrade.toolsetlink.com/upgrade/example/tauri-example.html)

### Enhancement

The note-taking application can be used directly without configuration. If you want a better experience, please open the settings page to configure AI and synchronization.

[Read settings guide](https://notegen.top/en/settings/sync.html)

## From Recording to Writing

Conventional note-taking applications typically don't provide recording functionality. Users need to manually copy and paste content for recording, which greatly reduces efficiency. When faced with scattered recorded content, it requires significant effort to organize.

NoteGen is divided into `Recording` and `Writing` pages, with the following relationship:

- Recordings can be organized into notes and transferred to the writing page for in-depth composition.
- During writing, you can insert recordings at any time.

### Recording

The recording function is similar to an **AI chatbot**, but when conversing with it, you can associate it with previously recorded content, switching from conversation mode to organization mode to arrange recordings into a readable note.

The following auxiliary features can help you record more effectively:

- **Tags** to distinguish different recording scenarios.
- **Personas** with support for custom prompts to precisely control your AI assistant.
- **Clipboard Assistant** that automatically recognizes text or images in your clipboard and records them to your list.

### Writing

The writing section is divided into two parts: **File Manager** and **Markdown Editor**.

**File Manager**

- Supports management of local Markdown files and GitHub synchronized files.
- Supports unlimited directory hierarchy.
- Supports multiple sorting methods.

**Markdown Editor**

- Supports WYSIWYG, instant rendering, and split-screen preview modes.
- Supports version control with history rollback.
- Supports AI assistance for conversation, continuation, polishing, and translation functions.
- Supports image hosting, uploading images and converting them to Markdown image links.
- Supports HTML to Markdown conversion, automatically converting copied browser content to Markdown format.
- Supports outlines, math formulas, mind maps, charts, flowcharts, Gantt charts, sequence diagrams, staves, multimedia, voice reading, title anchors, code highlighting and copying, graphviz rendering, and plantuml UML diagrams.
- Supports real-time local content saving, delayed (10s without editing) automatic synchronization, and history rollback.

## Other Features

- Global search for quickly finding and jumping to specific content.
- Image hosting management for convenient management of image repository content.
- Themes and appearance with support for dark themes and appearance settings for Markdown, code, etc.
- Internationalization support, currently available in Chinese and English.

## Contribute

- [Read contribution guide](https://notegen.top/en/docs/contributing)
- [Update plans](https://github.com/codexu/note-gen/issues/46)
- [Submit bugs or improvement suggestions](https://github.com/codexu/note-gen/issues)
- [Discussions](https://github.com/codexu/note-gen/discussions)

## Contributors

<a href="https://github.com/codexu/note-gen/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=codexu/note-gen" />
</a>

## Thanks

Special thanks to our technology partners who make NoteGen better:

**[SiliconFlow](https://cloud.siliconflow.cn/i/O2ciJeZw)** - Providing free AI model services, powering NoteGen's intelligent features with high-quality AI capabilities.

<a href="https://cloud.siliconflow.cn/i/O2ciJeZw" target="_blank">
  <img width="240" src="https://s2.loli.net/2025/09/10/KWPOA5XhIGmYTV9.png" />
</a>

**[UpgradeLink](http://upgrade.toolsetlink.com/upgrade/example/tauri-example.html)** - Providing reliable installation and upgrade services, ensuring seamless software updates for users.

<a href="http://upgrade.toolsetlink.com/upgrade/example/tauri-example.html" target="_blank">
  <img width="240" src="https://s2.loli.net/2025/09/10/Ks4EayU9HguXDMF.png" />
</a>

---

We also thank other partners for their service support

<div>
  <a href="https://www.qiniu.com/products/ai-token-api?utm_source=NoteGen" target="_blank">
    <img src="https://s2.loli.net/2025/06/11/OKJq542lTs7U9xg.png" />
  </a>
  <a href="https://share.302.ai/jfFrIP" target="_blank">
    <img src="https://s2.loli.net/2025/07/01/dPlkU1tejnDyV4S.png" />
  </a>
</div>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=codexu/note-gen&type=Date)](https://www.star-history.com/#codexu/note-gen&Date)
