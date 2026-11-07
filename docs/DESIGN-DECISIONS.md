# Why BeatLab works this way

> Written November 7, 2026. This is a retrospective explanation grounded in the current implementation and project records, not a contemporaneous decision log. It distinguishes the original need, the implemented behavior, and remaining limitations. Software implementation and current documentation were developed with AI assistance; the project direction and workflow requirements are Jordan McDonley’s.

## The need

Music files accumulate across project folders and external drives. Jordan wanted one place to find and listen to the beats he already had, without reorganizing his disk or uploading his library. The core task is choose sources → browse/search → play → shortlist, not a new streaming service or a full digital audio workstation.

## Decisions and tradeoffs

| Decision | Realistic alternative | Reason | Tradeoff |
| --- | --- | --- | --- |
| Index existing folders, do not import/copy audio | Copy every track into an application-managed library | Preserves the user’s project organization and avoids a second audio collection. | Original sources must remain available; moved files need rescanning. |
| User-selected roots | Scan the entire home folder | Makes scope intentional and limits accidental indexing. The desktop scanner skips hidden directories and does not follow symlinks. | Users must add each desired source. |
| Keep audio local | Cloud upload and account library | Local playback solves the immediate need without hosting audio, upload time, or an account system. | No automatic access to the Mac’s library from a phone or another computer. |
| Browser UI plus a Tauri/Rust desktop path | Separate platform-specific interfaces | The interface can share library/search/playback behavior while using different filesystem mechanisms. | Two bridges and different permission/codec behavior require separate validation. |
| IndexedDB folder handles in the browser | Store arbitrary filesystem paths and assume access | Browser folder access is permission-based. Handles and favorites belong to that browser origin; playback uses local blob URLs. | Desktop Chrome/Edge folder-picker support is required; permissions can need renewal. |
| Persist selected sources and favorites | Save an application-owned copy of every track | Retains user intent while leaving audio bytes in their original location. | A rescan is needed to refresh files; no automatic folder watching. |
| Preserve unavailable desktop roots | Delete a source when a drive is disconnected | A temporarily unplugged drive is not an instruction to forget the library source. | The UI must communicate availability rather than imply every track is playable. |
| Canonical-path deduplication in the native scanner | Audio fingerprinting | Overlapping selected folders should not list the same file twice; a canonical path addresses that case directly. | Different files containing the same recording are not detected as audio duplicates. |
| Search and favorites before music analysis | BPM, key, waveform editing, or AI tagging first | A small useful organizer addresses the find-and-listen task before adding specialized analysis. | Those analysis features are not implemented. |

## Data path

### Browser

An explicit folder-picker action grants access to a directory handle. The browser bridge keeps chosen handles and favorites in origin-scoped IndexedDB, scans supported audio files, and passes the resulting list to the shared interface. Local blob URLs supply audio playback. Removing a source removes its index/settings association, not files from disk.

### Desktop source implementation

The Tauri folder dialog provides a native selection. The Rust scanner walks selected roots, skips hidden directories and symlinks, canonicalizes file paths, deduplicates repeated paths, and builds a sorted track list. Local settings contain folders and favorites, not audio bytes. The existence of this source is not a claim that signed native installers are currently available.

## Evidence and limitations

The portfolio screenshots, captured November 5, 2026, show the actual browser app using Jordan’s 35-file local library: browsing/playing, searching, and favorites. They are not fabricated track lists. The personal audio files are not distributed in this repository.

`npm run check` performs JavaScript syntax checks, not a complete end-to-end test suite. Review the [browser bridge](../ui/browser-bridge.js), [UI logic](../ui/app.js), and [native scanner](../src-tauri/src/lib.rs) to inspect the implementation. Folder permissions, external-drive behavior, codecs, and large-library responsiveness need platform-specific testing.

The current scope excludes account sync, remote streaming, automatic folder watching, BPM/key detection, audio fingerprinting, signed updates, and notarized installers. Consult actual release assets before representing a native download as available.

## Contribution and next decisions

Jordan defined the personal workflow need, local-file requirements, and product direction; software implementation was AI-assisted. The visible evidence supports a practical local organizer. It does not establish audio-engineering research, a production streaming service, or cross-platform installer acceptance.

If library size makes rescanning slow, measure scan time and UI responsiveness before adding a persistent metadata database or background watcher. If remote listening becomes the objective, revisit the privacy, hosting, and synchronization model explicitly instead of implying that the existing static website provides it.
