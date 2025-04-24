<img src="https://cdn.jsdelivr.net/gh/codexu/note-gen@dev/app-icon.png" width="128" height="128" />

# NoteGen

![](https://github.com/codexu/note-gen/actions/workflows/release.yml/badge.svg?branch=release)
![](https://img.shields.io/github/v/release/codexu/note-gen)
![](https://img.shields.io/badge/version-alpha-orange)
![](https://img.shields.io/github/downloads/codexu/note-gen/total)
![](https://img.shields.io/github/commit-activity/m/codexu/note-gen)

[English](README.md) | [简体中文](README.CN.md) | 日本語

NoteGenは、AIを使用して記録と執筆を橋渡しし、断片化された知識を読みやすいノートに整理することに専念するクロスプラットフォームの`Markdown`ノートアプリケーションです。

## なぜNoteGenを選ぶのか？

- 軽量：[インストールパッケージ](https://github.com/codexu/note-gen/releases)は**わずか約10MB**、無料で広告やバンドルソフトウェアはありません。
- クロスプラットフォーム：Mac、Windows、Linuxをサポートし、`Tauri2`のクロスプラットフォーム機能のおかげで、将来的にはiOSとAndroidもサポートします。
- `スクリーンショット`、`テキスト`、`イラスト`、`ファイル`、`リンク`など、さまざまな記録方法をサポートし、さまざまなシナリオでの断片化された記録ニーズに対応します。
- ネイティブのオフライン使用をサポートし、`Markdown(.md)`をストレージ形式として使用し、`プライベートGitHubリポジトリ`へのリアルタイム同期と履歴のロールバックもサポートします。
- AI強化：ChatGPT、Gemini、Ollama、LM Studio、DeepSeekなどのモデルを設定可能で、サードパーティのモデル設定もサポートします。

## スクリーンショット

記録：

![record](https://s2.loli.net/2025/04/14/NxhiWjMZT7RtusS.png)

執筆：

![writing](https://s2.loli.net/2025/04/16/LcgMvUa86IpRi4V.png)

ダークモード：

![dark](https://s2.loli.net/2025/04/14/9JhgTie2X4tZLdz.png)

## 記録から執筆へ

従来のノートアプリケーションは通常、記録機能を提供しません。ユーザーは手動でコンテンツをコピーして貼り付ける必要があり、記録の効率が大幅に低下します。断片化された記録コンテンツに直面すると、整理に多大な労力が必要です。

NoteGenは`記録`と`執筆`のページに分かれており、次の関係があります：

- 記録はノートに整理され、執筆ページに転送されて詳細な執筆が行われます。
- 執筆中はいつでも記録を挿入できます。

### 記録

記録機能は**AIチャットボット**に似ていますが、対話中に以前に記録したコンテンツと関連付けることができ、対話モードから整理モードに切り替えて、記録を読みやすいノートに整理できます。

次の補助機能は、より効果的に記録するのに役立ちます：

- **タグ**：さまざまな記録シナリオを区別するため。
- **ペルソナ**：カスタムプロンプトをサポートし、AIアシスタントを正確に制御します。
- **クリップボードアシスタント**：クリップボード内のテキストや画像を自動的に認識し、リストに記録します。

### 執筆

執筆セクションは、**ファイルマネージャー**と**Markdownエディター**の2つの部分に分かれています。

**ファイルマネージャー**

- ローカルMarkdownファイルとGitHub同期ファイルの管理をサポートします。
- 無制限のディレクトリ階層をサポートします。
- 複数のソート方法をサポートします。

**Markdownエディター**

- WYSIWYG、即時レンダリング、分割画面プレビューモードをサポートします。
- バージョン管理をサポートし、履歴のロールバックが可能です。
- 会話、継続、ポリッシュ、翻訳機能のためのAI支援をサポートします。
- 画像ホスティングをサポートし、画像をアップロードしてMarkdown画像リンクに変換します。
- HTMLからMarkdownへの変換をサポートし、コピーされたブラウザコンテンツを自動的にMarkdown形式に変換します。
- アウトライン、数式、マインドマップ、チャート、フローチャート、ガントチャート、シーケンス図、五線譜、マルチメディア、音声読み上げ、タイトルアンカー、コードハイライトとコピー、graphvizレンダリング、plantuml UML図をサポートします。
- リアルタイムのローカルコンテンツ保存、遅延（10秒間編集されていない場合）自動同期、履歴のロールバックをサポートします。

## その他の機能

- グローバル検索：特定のコンテンツを迅速に検索してジャンプできます。
- 画像ホスティング管理：画像リポジトリのコンテンツを便利に管理できます。
- テーマと外観：ダークテーマをサポートし、Markdown、コードなどの外観設定をサポートします。
- 国際化サポート：現在、中国語と英語に対応しています。

## 使い方

### ダウンロード

現在、Mac、Windows、Linuxをサポートしています。Tauri2のクロスプラットフォーム機能のおかげで、将来的にはiOSとAndroidもサポートします。

[NoteGenをダウンロード（アルファ版）](https://github.com/codexu/note-gen/releases)

### 強化

ノートアプリケーションは設定なしで直接使用できます。より良い体験をしたい場合は、設定ページを開いてAIと同期を設定してください。

## コミュニティ

NoteGenコミュニティグループに参加して、質問をしたり、使用体験を共有したり、改善提案をしたりできます。また、Tauriについて学び、私と一緒に議論することもできます。

[ディスカッショングループ](https://github.com/codexu/note-gen/discussions/110)に参加するためのQRコードをスキャンしてください。QRコードが期限切れの場合は、WeChat xu461229187を追加してグループに参加してください。

## 貢献

- [貢献ガイドを読む](CONTRIBUTING.md)
- [更新計画](https://github.com/codexu/note-gen/issues/46)
- [バグや改善提案を提出する](https://github.com/codexu/note-gen/issues)
- [ディスカッション](https://github.com/codexu/note-gen/discussions)
