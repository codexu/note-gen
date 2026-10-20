"""Check the host's pinned npm dependency and native plugin protocol version."""
from argparse import ArgumentParser
from pathlib import Path
import json
import re

parser = ArgumentParser(description=__doc__)
parser.add_argument(
    '--sdk', type=Path,
    help='Check a reviewed SDK checkout instead of the installed npm package',
)
args = parser.parse_args()
host = Path(__file__).resolve().parents[1]
dependency = json.loads((host / 'package.json').read_text())['dependencies']['@notegen/plugin-api']
if args.sdk:
    # Keep the SDK repository's Host contract parity workflow compatible.
    package = args.sdk.resolve() / 'packages/plugin-api'
    contract = package / 'src/index.ts'
else:
    package = host / 'node_modules/@notegen/plugin-api'
    contract = package / 'dist/index.js'

metadata = json.loads((package / 'package.json').read_text())
if metadata['version'] != dependency:
    raise SystemExit(f"Plugin API package version {metadata['version']} differs from host dependency {dependency}")
match = re.search(r"PLUGIN_API_VERSION\s*=\s*['\"]([^'\"]+)['\"]", contract.read_text())
if not match:
    raise SystemExit('Missing exported plugin API version')
version = match.group(1)
if metadata['notegen']['pluginApiVersion'] != version:
    raise SystemExit('Plugin API package metadata differs from its exported protocol version')
native = (host / 'src-tauri/src/plugins.rs').read_text()
match = re.search(r'PLUGIN_API_VERSION: &str = "([^"]+)"', native)
if not match or match.group(1) != version:
    raise SystemExit('Native host protocol version differs from the plugin API package')
print(f'Host and @notegen/plugin-api@{dependency} use protocol {version}')
