"use strict";

const api = window.__TAURI__?.core || window.BeatLabBrowser;
const els = {
  folders: document.getElementById("folders"),
  addFolder: document.getElementById("addFolder"),
  emptyAdd: document.getElementById("emptyAdd"),
  refresh: document.getElementById("refresh"),
  search: document.getElementById("search"),
  all: document.getElementById("all"),
  favorites: document.getElementById("favorites"),
  summary: document.getElementById("summary"),
  status: document.getElementById("status"),
  empty: document.getElementById("empty"),
  trackList: document.getElementById("trackList"),
  nowTitle: document.getElementById("nowTitle"),
  nowInfo: document.getElementById("nowInfo"),
  player: document.getElementById("player"),
};
let library = { folders: [], tracks: [], skippedEntries: 0 };
let activePath = null;
let mode = "all";
let busy = false;

function message(text) { els.status.textContent = text; }
function size(bytes) {
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + " MB"
    : Math.round(bytes / 1024) + " KB";
}
function fileName(path) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function call(command, args) {
  if (!api?.invoke) throw new Error("Open BeatLab in its installed desktop app.");
  return api.invoke(command, args);
}
function setBusy(value) {
  busy = value;
  els.refresh.disabled = value;
  els.addFolder.disabled = value;
  els.emptyAdd.disabled = value;
}
function renderFolders() {
  els.folders.replaceChildren();
  for (const folder of library.folders) {
    const row = element("div", "folder" + (folder.available ? "" : " offline"));
    const icon = element("span", "folder-icon", folder.available ? "▤" : "!");
    icon.setAttribute("aria-hidden", "true");
    const details = element("div", "folder-details");
    details.append(
      element("div", "folder-name", fileName(folder.path)),
      element("div", "folder-location", folder.path.startsWith("local/")
        ? (folder.available ? "This browser · approved folder" : "Permission required · click Rescan")
        : (folder.available ? folder.path : "Drive disconnected · " + folder.path)),
    );
    const remove = element("button", "remove-source", "×");
    remove.type = "button";
    remove.title = "Remove from BeatLab (does not delete files)";
    remove.setAttribute("aria-label", "Stop indexing " + folder.path);
    remove.addEventListener("click", () => removeFolder(folder.path));
    row.append(icon, details, remove);
    els.folders.append(row);
  }
}
function shownTracks() {
  const query = els.search.value.trim().toLocaleLowerCase();
  return library.tracks.filter(track =>
    (mode !== "favorites" || track.favorite) &&
    (!query || track.title.toLocaleLowerCase().includes(query) ||
      track.path.toLocaleLowerCase().includes(query))
  );
}
function renderTracks() {
  els.trackList.replaceChildren();
  const filtered = shownTracks();
  const total = library.tracks.length;
  els.summary.textContent = filtered.length === total
    ? total + " " + (total === 1 ? "beat" : "beats") + " in library"
    : filtered.length + " of " + total + " beats";
  const noTracks = !filtered.length;
  els.empty.hidden = !noTracks;
  if (noTracks) {
    const noSources = !library.folders.length;
    els.empty.querySelector("h2").textContent = noSources
      ? "No beats found yet"
      : total ? "No matching beats" : "No audio found";
    els.empty.querySelector("p").textContent = noSources
      ? "Choose a folder or external drive. We'll find supported audio in its subfolders, too."
      : total ? "Try a different search or switch back to All."
      : "Add a folder containing MP3, WAV, M4A, FLAC, OGG, AAC or AIFF files, then rescan.";
    els.emptyAdd.hidden = !noSources;
  }
  for (const track of filtered) {
    const row = element("div", "track" + (activePath === track.path ? " active" : ""));
    row.setAttribute("role", "listitem");
    const play = element("button", "play", activePath === track.path && !els.player.paused ? "Ⅱ" : "▶");
    play.type = "button";
    play.setAttribute("aria-label", "Play " + track.title);
    play.addEventListener("click", () => playTrack(track));
    const info = element("div", "track-info");
    const title = element("div", "track-title", track.title);
    title.title = track.title;
    const meta = element("div", "track-meta", fileName(track.path.split(/[\\/]/).slice(0, -1).join("/")) + " · " + size(track.sizeBytes));
    meta.title = track.path;
    info.append(title, meta);
    const format = element("span", "format", track.format);
    const favorite = element("button", "fav" + (track.favorite ? " chosen" : ""), track.favorite ? "★" : "☆");
    favorite.type = "button";
    favorite.setAttribute("aria-label", (track.favorite ? "Remove favorite " : "Favorite ") + track.title);
    favorite.setAttribute("aria-pressed", String(track.favorite));
    favorite.addEventListener("click", async () => {
      try {
        await call("set_favorite", { path: track.path, favorite: !track.favorite });
        track.favorite = !track.favorite;
        renderTracks();
      } catch (error) { message(String(error)); }
    });
    row.append(play, info, format, favorite);
    els.trackList.append(row);
  }
}
async function playTrack(track) {
  try {
    if (activePath === track.path) {
      if (els.player.paused) await els.player.play();
      else els.player.pause();
      return;
    }
    activePath = track.path;
    els.player.src = api.resolveTrackUrl
      ? await api.resolveTrackUrl(track.path)
      : api.convertFileSrc(track.path);
    els.nowTitle.textContent = track.title;
    els.nowInfo.textContent = track.format + " · " + size(track.sizeBytes);
    els.player.load();
    await els.player.play();
    message("");
  } catch (error) {
    message("Playback failed. This audio format may not be supported on this computer: " + String(error));
  } finally { renderTracks(); }
}
async function rescan() {
  if (busy) return;
  setBusy(true);
  message("Scanning selected folders…");
  try {
    library = await call("scan_library");
    renderFolders();
    renderTracks();
    const offline = library.folders.filter(folder => !folder.available).length;
    const warnings = [
      offline ? offline + " disconnected location(s)" : "",
      library.skippedEntries ? library.skippedEntries + " inaccessible entries skipped" : "",
    ].filter(Boolean);
    message(warnings.join(" · ") || "Up to date");
  } catch (error) {
    message("Scan failed: " + String(error));
  } finally { setBusy(false); }
}
async function addFolder() {
  if (busy) return;
  setBusy(true);
  message("Choose a folder or a mounted drive…");
  let selected = false;
  try {
    await call("choose_folder");
    selected = true;
  } catch (error) {
    message("Unable to add folder: " + String(error));
  } finally {
    setBusy(false);
  }
  if (selected) await rescan();
}
async function removeFolder(path) {
  if (busy) return;
  if (!window.confirm("Stop indexing this folder? Your original audio will not be changed.\n\n" + path)) return;
  try {
    await call("remove_folder", { path });
    // Cleared entries are inaccessible at next app launch. Never delete originals.
    if (activePath?.startsWith(path)) {
      els.player.pause();
      els.player.removeAttribute("src");
      els.player.load();
      els.nowTitle.textContent = "Nothing playing";
      els.nowInfo.textContent = "Select a beat to listen";
      activePath = null;
    }
    await rescan();
  } catch (error) { message("Unable to remove folder: " + String(error)); }
}
function changeMode(next) {
  mode = next;
  els.all.classList.toggle("active", mode === "all");
  els.favorites.classList.toggle("active", mode === "favorites");
  els.all.setAttribute("aria-pressed", String(mode === "all"));
  els.favorites.setAttribute("aria-pressed", String(mode === "favorites"));
  renderTracks();
}
els.addFolder.addEventListener("click", addFolder);
els.emptyAdd.addEventListener("click", addFolder);
els.refresh.addEventListener("click", rescan);
els.search.addEventListener("input", renderTracks);
els.all.addEventListener("click", () => changeMode("all"));
els.favorites.addEventListener("click", () => changeMode("favorites"));
els.player.addEventListener("play", renderTracks);
els.player.addEventListener("pause", renderTracks);
els.player.addEventListener("error", () => {
  if (els.player.src) message("Can't play this file on the current system; try a different format.");
});
if (!api?.invoke) {
  els.empty.hidden = false;
  els.empty.querySelector("h2").textContent = "Run BeatLab as a desktop app";
  els.empty.querySelector("p").textContent = "The native folder scanner is available only in the installed application.";
  els.emptyAdd.hidden = true;
  message("Desktop runtime unavailable");
} else {
  rescan();
}
