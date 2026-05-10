## Type of Change

- [x] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Related Issue

Fixes https://github.com/codexu/note-gen/issues/1072

## Description

### Summary

Improve skill import functionality to support nested directory structures in ZIP files and ignore macOS metadata directories.

### Changes Made

- Added `find_skill_root()` function to recursively search for SKILL.md files
- Added `is_ignored_zip_metadata_dir()` function to ignore __MACOSX directories
- Improved import logic to handle flexible directory structures
- Enhanced directory move/copy logic with better error handling
- Improved error messages for better user feedback

### Technical Details

Modified `src-tauri/src/skills.rs`:
- Recursive search for SKILL.md to determine skill root directory
- Automatically handles different levels of ZIP archive structures
- Falls back to copy operation when move fails (cross-device scenarios)
- More reliable cleanup of temporary directories

## Testing

### How to Test

1. Create a skill ZIP file with nested directory structure
2. Upload ZIP through NoteGen import feature
3. Verify skill imports correctly and is usable
4. Test with macOS ZIP files (containing __MACOSX directory)

### Test Results

- [x] Tested locally
- [ ] Tested on Windows
- [ ] Tested on macOS
- [ ] Tested on Linux
- [ ] Build succeeds with `pnpm tauri build`

## Checklist

- [x] My code follows the style guidelines of this project
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [x] Any dependent changes have been merged and published in downstream modules
- [x] I have checked my code and corrected any misspellings

## Additional Notes

This fix primarily targets the skill import functionality to handle more complex ZIP archive directory structures, specifically:
- Supports skills nested within subdirectories
- Ignores macOS automatically generated __MACOSX metadata directories
- Improved error handling and user feedback
