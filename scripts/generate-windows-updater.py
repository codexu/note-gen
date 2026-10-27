"""Add signed NSIS/MSI targets after tauri-action finishes the release manifest."""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--repository", required=True)
    args = parser.parse_args()

    manifest_path = args.directory / "latest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version", "").removeprefix("v") != args.version:
        raise ValueError("Release manifest version does not match the built version")
    platforms = manifest["platforms"]
    release_url = (
        f"https://github.com/{args.repository}/releases/download/"
        f"note-gen-v{args.version}"
    )
    patterns = {
        "nsis": rf"NoteGen_{re.escape(args.version)}_x64-setup\.exe",
        "msi": rf"NoteGen_{re.escape(args.version)}_x64(?:_[\w-]+)?\.msi",
    }
    for installer, pattern in patterns.items():
        candidates = [
            path for path in args.directory.iterdir()
            if path.is_file() and re.fullmatch(pattern, path.name)
        ]
        if len(candidates) != 1:
            raise ValueError(f"Expected exactly one x64 {installer} installer, found {len(candidates)}")
        asset = candidates[0]
        signature = asset.with_name(f"{asset.name}.sig").read_text(encoding="utf-8").strip()
        if not signature:
            raise ValueError(f"Empty updater signature for {asset.name}")
        platforms[f"windows-x86_64-{installer}"] = {
            "url": f"{release_url}/{quote(asset.name)}",
            "signature": signature,
        }

    # Old clients cannot distinguish installation formats. Keep their existing MSI path.
    platforms["windows-x86_64"] = dict(platforms["windows-x86_64-msi"])
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
