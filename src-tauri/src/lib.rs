use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

// The existing Song Lab Python server remains untouched. This desktop app only reads
// audio from user-selected locations; it never moves, edits or uploads music.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    folders: Vec<String>,
    favorites: Vec<String>,
}

struct Store(Mutex<Settings>);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Track {
    path: String,
    title: String,
    format: String,
    size_bytes: u64,
    favorite: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Folder {
    path: String,
    available: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Library {
    folders: Vec<Folder>,
    tracks: Vec<Track>,
    skipped_entries: usize,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("library.json"))
}

fn read_settings(app: &AppHandle) -> Settings {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = config_path(app)?;
    let parent = path.parent().ok_or("Invalid settings location")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let content = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    // Do not save audio bytes or a track listing in settings.
    fs::write(path, content).map_err(|e| e.to_string())
}

fn supported_file(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| matches!(s.to_ascii_lowercase().as_str(),
            "mp3" | "wav" | "m4a" | "aif" | "aiff" | "flac" | "ogg" | "aac"))
        .unwrap_or(false)
}

fn scan_roots(roots: &[String], favorites: &[String]) -> Library {
    let favs: HashSet<&str> = favorites.iter().map(String::as_str).collect();
    let mut visited = HashSet::new();
    let mut tracks = Vec::new();
    let mut skipped_entries = 0;
    let folders = roots.iter().map(|path| Folder {
        path: path.clone(),
        available: Path::new(path).is_dir(),
    }).collect();

    for root in roots {
        if !Path::new(root).is_dir() { continue; } // disconnected drive; preserve it
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.depth() == 0 ||
                !e.file_name().to_string_lossy().starts_with('.'))
        {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => { skipped_entries += 1; continue; }
            };
            if !entry.file_type().is_file() || !supported_file(entry.path()) { continue; }
            let Ok(real_path) = entry.path().canonicalize() else {
                skipped_entries += 1;
                continue;
            };
            if !visited.insert(real_path.clone()) { continue; }
            let Ok(meta) = fs::metadata(&real_path) else {
                skipped_entries += 1;
                continue;
            };
            let path = real_path.to_string_lossy().into_owned();
            let title = real_path.file_stem().and_then(|x| x.to_str()).unwrap_or("Untitled").to_owned();
            tracks.push(Track {
                favorite: favs.contains(path.as_str()),
                format: real_path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_uppercase(),
                size_bytes: meta.len(),
                path, title,
            });
        }
    }
    tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase())
        .then_with(|| a.path.cmp(&b.path)));
    Library { folders, tracks, skipped_entries }
}

#[tauri::command]
async fn choose_folder(app: AppHandle, state: State<'_, Store>) -> Result<Vec<String>, String> {
    // Native OS picker (not a path provided by untrusted web content).
    let dialog_app = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        dialog_app.dialog().file().blocking_pick_folder()
    }).await.map_err(|e| e.to_string())?;

    let Some(chosen) = chosen else {
        return Ok(state.0.lock().map_err(|e| e.to_string())?.folders.clone());
    };
    let selected = chosen.into_path().map_err(|_| "Select a local folder or mounted drive")?;
    let selected = selected.canonicalize().map_err(|e| e.to_string())?;
    if !selected.is_dir() { return Err("Selected location is not a folder".into()); }
    let path = selected.to_string_lossy().into_owned();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let mut new_settings = guard.clone();
    if !new_settings.folders.contains(&path) {
        new_settings.folders.push(path);
        save_settings(&app, &new_settings)?;
        *guard = new_settings;
    }
    Ok(guard.folders.clone())
}

#[tauri::command]
fn remove_folder(app: AppHandle, state: State<'_, Store>, path: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let mut next = guard.clone();
    next.folders.retain(|folder| folder != &path);
    save_settings(&app, &next)?;
    *guard = next;
    Ok(())
}

#[tauri::command]
fn set_favorite(app: AppHandle, state: State<'_, Store>, path: String, favorite: bool) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if !guard.folders.iter().any(|root| Path::new(&path).starts_with(root)) {
        return Err("Track is outside your selected folders".into());
    }
    let mut next = guard.clone();
    next.favorites.retain(|saved| saved != &path);
    if favorite { next.favorites.push(path); }
    save_settings(&app, &next)?;
    *guard = next;
    Ok(())
}

#[tauri::command]
async fn scan_library(app: AppHandle, state: State<'_, Store>) -> Result<Library, String> {
    let settings = state.0.lock().map_err(|e| e.to_string())?.clone();
    let library = tauri::async_runtime::spawn_blocking(move || {
        scan_roots(&settings.folders, &settings.favorites)
    }).await.map_err(|e| e.to_string())?;

    // Playback is scoped to identified audio files, not the user's entire disk.
    for track in &library.tracks {
        app.asset_protocol_scope().allow_file(&track.path)
            .map_err(|e| format!("Audio permission error: {e}"))?;
    }
    Ok(library)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let initial = read_settings(app.handle());
            app.manage(Store(Mutex::new(initial)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_folder, remove_folder, set_favorite, scan_library
        ])
        .run(tauri::generate_context!())
        .expect("BeatLab could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_audio_extensions_are_indexed() {
        let folder = std::env::temp_dir().join(format!(
            "beatlab-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(folder.join("nested")).unwrap();
        fs::write(folder.join("nested/song.MP3"), b"sample").unwrap();
        fs::write(folder.join("nested/notes.txt"), b"not audio").unwrap();
        let library = scan_roots(&[folder.to_string_lossy().to_string()], &[]);
        assert_eq!(library.tracks.len(), 1);
        assert_eq!(library.tracks[0].title, "song");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn missing_drives_remain_in_source_list() {
        let folder = std::env::temp_dir().join(format!("beatlab-disconnected-{}", std::process::id()));
        let library = scan_roots(&[folder.to_string_lossy().to_string()], &[]);
        assert!(!library.folders[0].available);
        assert!(library.tracks.is_empty());
    }
}
