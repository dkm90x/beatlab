/*
 * BeatLab browser bridge.
 * Files never leave the browser. Folder handles and favorites are stored
 * only in origin-scoped IndexedDB; audio is played via local blob URLs.
 * The Tauri desktop build retains its native scanner instead.
 */
(() => {
  "use strict";
  if (window.__TAURI__?.core?.invoke) return;

  const DB_NAME = "beatlab-browser-v1";
  const STORE = "settings";
  const AUDIO_TYPES = new Set(["mp3", "wav", "m4a", "aif", "aiff", "flac", "ogg", "aac"]);
  const fileHandles = new Map();
  let settingsPromise;
  let currentAudioUrl;

  const database = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser cannot persist a local music library."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function readSettings() {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get("library");
      request.onsuccess = () => resolve(request.result || { folders: [], favorites: [] });
      request.onerror = () => reject(request.error);
    });
  }

  async function writeSettings(settings) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(settings, "library");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function getSettings() {
    if (!settingsPromise) settingsPromise = readSettings();
    return settingsPromise;
  }

  function rootPath(folder) {
    return "local/" + folder.id + "/" + folder.handle.name;
  }

  async function hasReadPermission(handle) {
    try {
      const mode = { mode: "read" };
      if (typeof handle.queryPermission !== "function") return false;
      if (await handle.queryPermission(mode) === "granted") return true;
      // A previously chosen folder may require explicit reauthorization.
      // Browsers reject this when no user gesture is available; that is safe.
      return typeof handle.requestPermission === "function"
        && await handle.requestPermission(mode) === "granted";
    } catch {
      return false;
    }
  }

  async function chooseFolder() {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error("Folder selection requires Chrome or Edge on a desktop computer. Download the BeatLab desktop app for other browsers.");
    }
    // Invoke the permission picker immediately, before any other await,
    // to retain the user's click activation.
    const handle = await window.showDirectoryPicker({ mode: "read", id: "beatlab-library" });
    const state = await getSettings();
    for (const existing of state.folders) {
      if (await existing.handle.isSameEntry(handle)) return;
    }
    const next = {
      folders: [...state.folders, { id: crypto.randomUUID(), handle }],
      favorites: [...state.favorites],
    };
    await writeSettings(next);
    settingsPromise = Promise.resolve(next);
  }

  async function removeFolder(path) {
    const state = await getSettings();
    const next = {
      folders: state.folders.filter(folder => rootPath(folder) !== path),
      favorites: state.favorites.filter(item => !item.startsWith(path + "/")),
    };
    await writeSettings(next);
    settingsPromise = Promise.resolve(next);
  }

  async function setFavorite(path, favorite) {
    if (!fileHandles.has(path)) throw new Error("That audio file is no longer in the selected library.");
    const state = await getSettings();
    const favorites = new Set(state.favorites);
    if (favorite) favorites.add(path);
    else favorites.delete(path);
    const next = { folders: state.folders, favorites: [...favorites] };
    await writeSettings(next);
    settingsPromise = Promise.resolve(next);
  }

  async function scanFolder(directory, prefix, favorites, tracks, skipped) {
    try {
      for await (const [name, entry] of directory.entries()) {
        if (name.startsWith(".")) continue;
        if (entry.kind === "directory") {
          await scanFolder(entry, prefix + "/" + name, favorites, tracks, skipped);
          continue;
        }
        if (entry.kind !== "file") continue;
        const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
        if (!AUDIO_TYPES.has(ext)) continue;
        try {
          const file = await entry.getFile();
          const path = prefix + "/" + name;
          fileHandles.set(path, entry);
          tracks.push({
            path,
            title: name.slice(0, -(ext.length + 1)),
            format: ext.toUpperCase(),
            sizeBytes: file.size,
            favorite: favorites.has(path),
          });
        } catch {
          skipped.count += 1;
        }
      }
    } catch {
      skipped.count += 1;
    }
  }

  async function scanLibrary() {
    const state = await getSettings();
    fileHandles.clear();
    const tracks = [];
    const folders = [];
    const favorites = new Set(state.favorites);
    const skipped = { count: 0 };
    for (const folder of state.folders) {
      const available = await hasReadPermission(folder.handle);
      const path = rootPath(folder);
      folders.push({ path, available });
      if (available) await scanFolder(folder.handle, path, favorites, tracks, skipped);
    }
    tracks.sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
    return { tracks, folders, skippedEntries: skipped.count };
  }

  async function resolveTrackUrl(path) {
    const handle = fileHandles.get(path);
    if (!handle) throw new Error("File unavailable. Rescan your folder.");
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = url;
    return url;
  }

  window.BeatLabBrowser = {
    invoke(command, args = {}) {
      switch (command) {
        case "choose_folder": return chooseFolder();
        case "remove_folder": return removeFolder(args.path);
        case "set_favorite": return setFavorite(args.path, args.favorite);
        case "scan_library": return scanLibrary();
        default: return Promise.reject(new Error("Unsupported operation: " + command));
      }
    },
    resolveTrackUrl,
  };

  document.addEventListener("DOMContentLoaded", () => {
    const version = document.querySelector(".version");
    if (version) version.textContent = "BROWSER PREVIEW · 0.1";
    const playerLabel = document.querySelector(".player-right");
    if (playerLabel) playerLabel.textContent = "BEATLAB · THIS DEVICE";
  });
})();