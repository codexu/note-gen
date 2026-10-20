# Tauri Plugin clipboard

[![Clippy](https://github.com/CrossCopy/tauri-plugin-clipboard/actions/workflows/clippy.yml/badge.svg)](https://github.com/CrossCopy/tauri-plugin-clipboard/actions/workflows/clippy.yml)
[![Test](https://github.com/CrossCopy/tauri-plugin-clipboard/actions/workflows/test.yml/badge.svg)](https://github.com/CrossCopy/tauri-plugin-clipboard/actions/workflows/test.yml)

![Crates.io Version](https://img.shields.io/crates/v/tauri-plugin-clipboard)
![Crates.io Downloads (recent)](https://img.shields.io/crates/dr/tauri-plugin-clipboard)

![NPM Version](https://img.shields.io/npm/v/tauri-plugin-clipboard-api)
![NPM Downloads](https://img.shields.io/npm/dm/tauri-plugin-clipboard-api)

[![Documentation](https://docs.rs/tauri-plugin-clipboard/badge.svg)](https://docs.rs/tauri-plugin-clipboard)
![GitHub License](https://img.shields.io/github/license/CrossCopy/tauri-plugin-clipboard)

## Documentation Website: https://crosscopy.github.io/tauri-plugin-clipboard

> A Tauri plugin for clipboard read/write/monitor. Support text, rich text, HTML, files and image.
>
> The reason I built this plugin is becasue official Tauri API only supports clipboard read and write for text, not image, HTML, rich text or files. So you can still use the official API for text.
> Update: V2 now supports text, HTML, and image.

## Installation

> If you are installing from npm and crate.io package registry, make sure the versions for both packages are the same, otherwise, the API may not match.
> 
> I will make sure the latest version is published to both npm and crates.io.

### Short Instructions

Crate: https://crates.io/crates/tauri-plugin-clipboard

NPM Package: https://www.npmjs.com/package/tauri-plugin-clipboard-api

#### Installation

Now latest version defaults to Tauri V2. If you are using Tauri V1, you can install this plugin with version `1.x.x`.

```bash
cargo add tauri-plugin-clipboard # in src-tauri folder
npm i tauri-plugin-clipboard-api
```


<details>
<summary>More Installation Options</summary>

Crate: https://crates.io/crates/tauri-plugin-clipboard

`cargo add tauri-plugin-clipboard` to add the package.

Or add the following to your `Cargo.toml` for the latest unpublished version (not recommanded).

```toml
tauri-plugin-clipboard = { git = "https://github.com/CrossCopy/tauri-plugin-clipboard" }
```

You can also add a tag to github url.

```toml
# for tag v2.1.9, this may not be the latest version, check the tag on github
tauri-plugin-clipboard = { git = "https://github.com/CrossCopy/tauri-plugin-clipboard", tag = "v2.1.9" }
```

NPM Package: https://www.npmjs.com/package/tauri-plugin-clipboard-api

Run the following to install JavaScript/TypeScript API package.

```bash
npm i tauri-plugin-clipboard-api

# or this for latest unpublished version (not recommended)
npm i https://github.com/CrossCopy/tauri-plugin-clipboard

# or this for tag, e.g. v0.6.5 (this may not be the latest version, check the tag on github)
npm i https://github.com/CrossCopy/tauri-plugin-clipboard#v2.1.9
```

</details>

```toml
# In Cargo.toml
tauri-plugin-clipboard = { git = "https://github.com/CrossCopy/tauri-plugin-clipboard", branch = "v2" }
```

```bash
# Install npm package
npm i tauri-plugin-clipboard-api#v2 --save
```

In `main.rs`, add the following to your `tauri::Builder`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_clipboard::init()) // add this line
    .run(tauri::generate_context!())
    .expect("failed to run app");
```

Read more in the [official doc](https://tauri.app/v1/guides/features/plugin/#using-a-plugin) about how to use.

## Example

> The best way to learn this plugin is to read the source code of the example.
>
> The example is very detailed.

![](./README.assets/tauri-plugin-clipboard-dmeo-1.png)
![](./README.assets/tauri-plugin-clipboard-dmeo-2.png)

```bash
npm run build
cd examples/demo
npm i
npm run tauri dev
# there are a few buttons you can click to test the clipboard plugin
```

See [+page.svelte](examples/demo/src/routes/+page.svelte) for an example of how to use the plugin in JS/TS.

It works the same with other frontend frameworks like Vue, React, etc.

### Sample Usage (TypeScript API)

```ts
import clipboard from "tauri-plugin-clipboard-api";

await clipboard.readText();
await clipboard.writeText("huakun zui shuai");

clipboard
  .readImageBase64()
  .then((base64Img) => {
    imageStr = `data:image/png;base64, ${base64Img}`;
  })
  .catch((err) => {
    alert(err);
  });

await clipboard.writeImageBase64(sample_base64_image);
const files: string[] = await readFiles();

clipboard.readHtml().then((t: string) => {
  // todo
});
```

### Sample Usage (Rust API)

`ClipboardManager` contains the state state as well as the API functions.

```rust
use tauri::Manager;
use tauri_plugin_clipboard::ManagerExt;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_clipboard::init())
    .setup(|app| {
        let handle = app.handle();
        let clipboard = handle.state::<tauri_plugin_clipboard::Clipboard>();
        clipboard.write_text("huakun zui shuai".to_string()).unwrap();
        Ok(())
    })
    .build(tauri::generate_context!())
    .expect("failed to run app");
}
```

### Sample Listener Usage

We use Tauri's event system. Start a listener with Tauri's `listen()` function to start listening for event, and call `listenImage()` and `listenText()` to listen for clipboard update. When clipboard is updated, event will be emitted.

The following example is in svelte.

Read the full source code in [examples/demo/src/lib/components/listener.svelte](./examples/demo/src/lib/components/listener.svelte).

```ts
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onDestroy, onMount } from "svelte";
import {
  onClipboardUpdate,
  onImageUpdate,
  onTextUpdate,
  onHTMLUpdate,
  onRTFUpdate,
  onFilesUpdate,
  startListening,
  listenToMonitorStatusUpdate,
  isMonitorRunning,
  hasHTML,
  hasImage,
  hasText,
  hasRTF,
  hasFiles,
} from "tauri-plugin-clipboard-api";

let text = "";
let files: string[] = [];
let base64Image = "";
let htmlMonitorContent = "";
let monitorRunning = false;
let rtf = "";
let unlistenTextUpdate: UnlistenFn;
let unlistenImageUpdate: UnlistenFn;
let unlistenHtmlUpdate: UnlistenFn;
let unlistenRTF: UnlistenFn;
let unlistenClipboard: () => Promise<void>;
let unlistenFiles: UnlistenFn;
const has = {
  hasHTML: false,
  hasImage: false,
  hasText: false,
  hasRTF: false,
  hasFiles: false,
};
onMount(async () => {
  unlistenTextUpdate = await onTextUpdate((newText) => {
    text = newText;
  });
  unlistenHtmlUpdate = await onHTMLUpdate((newHtml) => {
    htmlMonitorContent = newHtml;
  });
  unlistenImageUpdate = await onImageUpdate((b64Str) => {
    base64Image = b64Str;
  });
  unlistenFiles = await onFilesUpdate((newFiles) => {
    files = newFiles;
  });
  unlistenRTF = await onRTFUpdate((newRTF) => {
    rtf = newRTF;
  });
  unlistenClipboard = await startListening();

  onClipboardUpdate(async () => {
    has.hasHTML = await hasHTML();
    has.hasImage = await hasImage();
    has.hasText = await hasText();
    has.hasRTF = await hasRTF();
    has.hasFiles = await hasFiles();
    console.log("plugin:clipboard://clipboard-monitor/update event received");
  });

  // setInterval(async () => {
  // 	console.log("Running:", await isMonitorRunning());
  // }, 1000);
});

listenToMonitorStatusUpdate((running) => {
  monitorRunning = running;
});

onDestroy(() => {
  if (unlistenTextUpdate) unlistenTextUpdate();
  if (unlistenImageUpdate) unlistenImageUpdate();
  if (unlistenHtmlUpdate) unlistenHtmlUpdate();
  if (unlistenFiles) unlistenFiles();
  if (unlistenClipboard) unlistenClipboard();
});
```

## API

### Files

Clipboard Files has the following APIs, check the source code for more details ([./webview-src/api.ts](./webview-src/api.ts)).

1. `writeFilesURIs`
   1. On Linux and MacOS, the URIs should start with `files://`. Otherwise the code will throw an error. See the docstring in the source code for more details ([./src/lib.rs](./src/lib.rs)).
2. `readFiles`
3. `readFilesURIs`

Difference between URI and no-URI is that URI starts with `files://` on Linux and MacOS. On Windows `readFiles` and `readFilesURIs` have no difference.

## Notes

> You don't really need to read this section if you are just using the plugin.

The logic of tauri's listen API is encapsulated in `onTextUpdate`, `onFilesUpdate`, `startListening`.

You can also listen to the events directly using Tauri's `listen()` function.

```ts
import {
  TEXT_CHANGED,
  FILES_CHANGED,
  IMAGE_CHANGED,
} from "tauri-plugin-clipboard-api";

await listen(TEXT_CHANGED, (event) => {
  const text = event.payload.value;
});
```

The listener `startListening` function contains two parts:

1. Start monitor thread in Tauri core (rust). (Invoke `start_monitor` command)
2. Run `listenToClipboard` function.
   1. The rust code only emit event (`plugin:clipboard://clipboard-monitor/update`) when clipboard is updated without the clipboard content because we don't always need the content.
   2. In order to distinguish content type, `listenToClipboard` detects the data type and emit new events.`onTextUpdate`, `onFilesUpdate`, `startListening` listen to these events.
      1. `plugin:clipboard://text-changed`
      2. `plugin:clipboard://files-changed`
      3. `plugin:clipboard://image-changed`
      4. `plugin:clipboard://html-changed`
      5. `plugin:clipboard://rtf-changed`

The returned unlisten function from `startListening` also does two things:

1. Stop monitor thread by invoking `stop_monitor` command to Tauri core.
2. Stop listener started in `listenToClipboard`.

For more details read the source code from [./webview-src/api.ts](./webview-src/api.ts).

## Note

The base64 image string can be converted to `Uint8Array` and written to file system using tauri's fs API. (We also provide a `readImageBinary` function to read image as binary data (`Uint8Array` is one of the available return type).

```ts
import { writeBinaryFile, BaseDirectory } from "@tauri-apps/api/fs";

writeBinaryFile(
  "tmp/avatar.png",
  new Uint8Array(
    atob(base64Img)
      .split("")
      .map((char) => char.charCodeAt(0))
  ),
  { dir: BaseDirectory.Cache }
);
```
