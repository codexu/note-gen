<img src="https://s2.loli.net/2025/05/26/YMNgxKVDrB84ZtW.png" width="128" height="128" />

# NoteGen

![](https://github.com/codexu/note-gen/actions/workflows/release.yml/badge.svg?branch=release)
![](https://img.shields.io/github/v/release/codexu/note-gen)
![](https://img.shields.io/badge/version-alpha-orange)
![](https://img.shields.io/github/downloads/codexu/note-gen/total)
![](https://img.shields.io/github/commit-activity/m/codexu/note-gen)

English | [简体中文](.github/README.zh.md) | [日本語](.github/README.ja.md)

NoteGen is a cross-platform `Markdown` note-taking application dedicated to using AI to bridge recording and writing, organizing fragmented knowledge into a readable note.

## Guide

🖥️ Official Document: [https://notegen.top](https://notegen.top)

💬 Join [WeChat/QQ Group](https://github.com/codexu/note-gen/discussions/110) | [Discord](https://discord.gg/9vs3qFkb)

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

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=codexu/note-gen&type=Date)](https://www.star-history.com/#codexu/note-gen&Date)
