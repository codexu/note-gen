"""Compare the host's vendored contract with an explicitly selected SDK checkout."""
from argparse import ArgumentParser
from pathlib import Path
import difflib
import json
import re
import sys

parser = ArgumentParser(description=__doc__)
parser.add_argument('--sdk', type=Path, required=True, help='Reviewed SDK checkout (pin its commit in CI)')
args = parser.parse_args()
host = Path(__file__).resolve().parents[1]
sdk = args.sdk.resolve()
relative = Path('packages/plugin-api/src/index.ts')
left = (host / relative).read_text()
right = (sdk / relative).read_text()
if left != right:
    sys.stderr.writelines(difflib.unified_diff(left.splitlines(True), right.splitlines(True), fromfile='host API', tofile='SDK API'))
    raise SystemExit('Plugin API contracts differ, including fields, documentation or error codes')
version = re.search(r"PLUGIN_API_VERSION = '([^']+)'", right).group(1)
native = (host / 'src-tauri/src/plugins.rs').read_text()
if re.search(r'PLUGIN_API_VERSION: &str = "([^"]+)"', native).group(1) != version:
    raise SystemExit('Native host protocol version differs')
metadata = json.loads((sdk / 'packages/plugin-api/package.json').read_text())
if metadata['notegen']['pluginApiVersion'] != version:
    raise SystemExit('Published SDK contract metadata differs')
print(f'Host and SDK contract match: {version}')
