![note-gen](https://socialify.git.ci/codexu/note-gen/image?custom_description=Cross-Platform+%7C+LLM+%7C+Markdown+%7C++Recording++%26+Writing&description=1&font=Raleway&forks=1&issues=1&logo=https%3A%2F%2Fcamo.githubusercontent.com%2Fbe4a3a39f8724658ad5bc549d63f0454ad4ca98564c73b7b0778704ca5212509%2F68747470733a2f2f73322e6c6f6c692e6e65742f323032352f30352f32362f594d4e67784b5644724238345a74572e706e67&name=1&owner=1&pattern=Circuit+Board&stargazers=1&theme=Light)

# NoteGen

![](https://github.com/codexu/note-gen/actions/workflows/release.yml/badge.svg?branch=release)
![](https://img.shields.io/github/v/release/codexu/note-gen)
![](https://img.shields.io/badge/version-alpha-orange)
![](https://img.shields.io/github/downloads/codexu/note-gen/total)
![](https://img.shields.io/github/commit-activity/m/codexu/note-gen)

English | [简体中文](.github/README.zh.md) | [日本語](.github/README.ja.md)

<div style="display: flex; gap: 1rem;">
  <a href="https://www.producthunt.com/products/notegen-2?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-notegen&#0045;2" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=956348&theme=light&t=1749194675492" alt="NoteGen - A&#0032;cross&#0045;platform&#0032;Markdown&#0032;note&#0045;taking&#0032;application | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

  <a href="https://trendshift.io/repositories/12784" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12784" alt="codexu%2Fnote-gen | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

## Guide

NoteGen is a cross-platform `Markdown` note-taking application dedicated to using AI to bridge recording and writing, organizing fragmented knowledge into a readable note.

🖥️ Official Document: [https://notegen.top](https://notegen.top)

💬 Join [WeChat/QQ Group](https://github.com/codexu/note-gen/discussions/110)

## Why Choose NoteGen?

- Lightweight: [Installation package](https://github.com/codexu/note-gen/releases) is **only 20MB**, free with no ads or bundled software.
- Cross-platform: Supports Mac, Windows, Linux, and thanks to `Tauri2`'s cross-platform capabilities, will support iOS and Android in the future.
- Supports multiple recording methods including `screenshots`, `text`, `illustrations`, `files`, `links`, etc., meeting fragmented recording needs across various scenarios.
- Native `Markdown(.md)` as storage format, no modifications, easy to migrate.
- Native offline usage, supporting real-time synchronization to `GitHub, Gitee private repositories` with history rollback, and WebDAV synchronization.
- AI-enhanced: Configurable with ChatGPT, Gemini, Ollama, LM Studio, Grok, and other models, with support for custom third-party model configuration.
- RAG: Your notes are your knowledge base. Support embedding models and reranking models.

## Screenshots


https://github.com/user-attachments/assets/4f8a3bc5-17f5-4b36-9b17-d87128685257


Recording:

![1.png](https://s2.loli.net/2025/05/19/Cs5viKfkqb2HJmd.png)

Writing:

![2.png](https://s2.loli.net/2025/05/19/5vwQBPoLr6jzgUA.png)

Theme:

![3.png](https://s2.loli.net/2025/05/19/8yU72prmWdsCHeu.png)

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

## How to Use?

### Download

Currently supports Mac, Windows, and Linux. Thanks to Tauri2's cross-platform capabilities, it will support iOS and Android in the future.

[Download NoteGen (alpha)](https://github.com/codexu/note-gen/releases)

### Enhancement

The note-taking application can be used directly without configuration. If you want a better experience, please open the settings page to configure AI and synchronization.

## Contribute

- [Read contribution guide](.github/CONTRIBUTING.md)
- [Update plans](https://github.com/codexu/note-gen/issues/46)
- [Submit bugs or improvement suggestions](https://github.com/codexu/note-gen/issues)
- [Discussions](https://github.com/codexu/note-gen/discussions)

## Contributors

<a href="https://github.com/codexu/note-gen/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=codexu/note-gen" />
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=codexu/note-gen&type=Date)](https://www.star-history.com/#codexu/note-gen&Date)
