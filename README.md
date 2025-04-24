<img src="https://cdn.jsdelivr.net/gh/codexu/note-gen@dev/app-icon.png" width="128" height="128" />

# NoteGen

![](https://github.com/codexu/note-gen/actions/workflows/release.yml/badge.svg?branch=release)
![](https://img.shields.io/github/v/release/codexu/note-gen)
![](https://img.shields.io/badge/version-alpha-orange)
![](https://img.shields.io/github/downloads/codexu/note-gen/total)
![](https://img.shields.io/github/commit-activity/m/codexu/note-gen)

English | [简体中文](README.CN.md) | [日本語](README.JP.md)

NoteGen is a cross-platform `Markdown` note-taking application dedicated to using AI to bridge recording and writing, organizing fragmented knowledge into a readable note.

## Why Choose NoteGen?

- Lightweight: [Installation package](https://github.com/codexu/note-gen/releases) is **only about 10MB**, free with no ads or bundled software.
- Cross-platform: Supports Mac, Windows, Linux, and thanks to `Tauri2`'s cross-platform capabilities, will support iOS and Android in the future.
- Supports multiple recording methods including `screenshots`, `text`, `illustrations`, `files`, `links`, etc., meeting fragmented recording needs across various scenarios.
- Native offline usage with `Markdown(.md)` as the storage format, while also supporting real-time synchronization to `private GitHub repositories` with history rollback.
- AI-enhanced: Configurable with ChatGPT, Gemini, Ollama, LM Studio, DeepSeek, and other models, with support for custom third-party model configuration.

## Screenshots

Recording:

![record](https://s2.loli.net/2025/04/14/NxhiWjMZT7RtusS.png)

Writing:

![writing](https://s2.loli.net/2025/04/16/LcgMvUa86IpRi4V.png)

Dark Mode:

![dark](https://s2.loli.net/2025/04/14/9JhgTie2X4tZLdz.png)

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

## Community

Welcome to join the NoteGen community group where you can ask questions, share usage experiences, or suggest improvements. You can also join to learn about Tauri and discuss it with me.

Scan the QR code to join the [discussion group](https://github.com/codexu/note-gen/discussions/110). If the QR code expires, you can add WeChat xu461229187 to join the group.

## Contribute

- [Read contribution guide](CONTRIBUTING.md)
- [Update plans](https://github.com/codexu/note-gen/issues/46)
- [Submit bugs or improvement suggestions](https://github.com/codexu/note-gen/issues)
- [Discussions](https://github.com/codexu/note-gen/discussions)
