# NoteGen clipboard image formats

This is the Rust portion of `tauri-plugin-clipboard` 2.1.11, from
https://github.com/CrossCopy/tauri-plugin-clipboard (MIT; see LICENSE).

The only functional change from the published crate is in Cargo.toml:
`image` disables default features and enables PNG, JPEG, GIF, WebP, BMP, and ICO.
This removes this plugin's request for AVIF/AV1, EXR, TIFF, and other unused codecs without changing the
clipboard commands, permission identifiers, or JavaScript API.

The root Cargo.toml applies this through `[patch.crates-io]`. Cargo features are
additive, so other dependencies must also avoid enabling `image/default`.
On macOS, `clipboard-rs` and `arboard` still enable TIFF for native clipboard
interoperability; retain that platform requirement.
When updating the upstream plugin, retain this dependency change or remove the
patch after upstream supports configuring image formats.
