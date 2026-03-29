# Changelog

## [0.1.5] - 2026-03-29

### Fixed
- Removed remaining "vibescroll" references
- Added demo GIF and GitHub repository

## [0.1.4] - 2026-03-29

### Fixed
- macOS: use AXRaise to bring only the Shorts window to front, not all Chrome windows

## [0.1.3] - 2026-03-29

### Fixed
- Poll every 5 seconds for the most recently active Claude session — reliably detects new projects

## [0.1.2] - 2026-03-29

### Fixed
- Extension now works in any project, not just the one it was first activated in
- Monitors the most recently active Claude session across all projects

## [0.1.1] - 2026-03-29

### Fixed
- Status bar button now appears even when no workspace folder is open
- Linux: improved Chrome path detection (added Brave, `/opt/google/chrome`)
- Linux: fixed window raise and close commands
- macOS: Shorts window no longer pushes other Chrome windows to front
- Windows/Linux: fixed window positioning bug

## [0.1.0] - 2026-03-29

### Added
- Initial release
- Auto-opens YouTube Shorts when Claude is working
- Auto-closes when Claude finishes
- Configurable window width and side (left/right)
- Status bar indicator with active/inactive toggle
- macOS, Windows, and Linux support
