# BeatLab

**Your beats. One library.** An open-source, local-first beat organizer for macOS, Windows, and compatible desktop browsers.

BeatLab finds the music you already own. Choose folders or external drives, and it creates one searchable library without copying, moving, deleting, or uploading your audio.

### What you can do

- Index MP3, WAV, M4A, AIFF, FLAC, OGG, and AAC files in nested folders.
- Search tracks and locations in one combined library.
- Play beats, mark favorites, and rescan when files change.
- Reconnect external drives without losing their folder selection.
- Keep original music files on your own machine.

### Download and installation

Official beta installers will appear under [GitHub Releases](https://github.com/dkm90x/beatlab/releases) after the cross-platform build and manual verification have passed. **Until installer assets are published, do not treat this as a finished download.**

Unsigned beta packages may trigger macOS Gatekeeper or Windows SmartScreen warnings. Never disable system protections globally to install an app.

### Run from source

Requirements: Node.js 20+, the Rust toolchain, and [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/). On macOS, Xcode Command Line Tools; on Windows, MSVC Build Tools and WebView2.

```sh
npm ci
npm run check
npm run dev
```

To build an unsigned local installer, run `npm run build`.

### Browser version

The same interface can run as a static website. On desktop Chrome or Edge, click **Add folder or drive**, grant folder access, and organize your local MP3s. Permissions and favorites stay in browser-local IndexedDB storage. The website does not upload music.

To test on localhost:

```sh
python3 -m http.server 8766 --directory ui
```

Open http://localhost:8766 in Chrome or Edge. A web browser cannot automatically read your Mac's folders from another device; opening the same website on your phone will **not** sync your music.

### Privacy and supported behavior

Only folders selected by the user are scanned. The desktop scanner skips hidden directories and does not follow symlinks. Removing a source removes it from BeatLab, not the disk. Playback depends on OS codec support. Large libraries can take time to scan.

Not yet available: automatic folder watching, tag/BPM/key detection, audio duplicate fingerprinting, account sync, remotely streaming your Mac's music to a phone, signed updates, or notarized installers.

This code is released under the [MIT License](LICENSE). Personal music libraries and private songwriting project files are **not** part of this repository.
