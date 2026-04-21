const state = {
  bootstrap: null,
  selectedPlaylistId: null,
  searchResults: [],
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function setStatus(text) {
  const node = document.getElementById("statusText");
  if (node) node.textContent = text;
}

function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.floor((durationMs || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${`${seconds % 60}`.padStart(2, "0")}`;
}

function ratingBadge(label, tone) {
  return `<span class="rating-badge ${tone}">${label}</span>`;
}

function getLeadTracks() {
  const queueTracks = (state.bootstrap?.queue || []).map((entry) => entry.track).filter(Boolean);
  const recentTracks = state.bootstrap?.recent_tracks || [];
  const unique = new Map();
  [...queueTracks, ...recentTracks].forEach((track) => {
    if (track && !unique.has(track.id)) unique.set(track.id, track);
  });
  return [...unique.values()];
}

function getFeatureTrack() {
  const queueTrack = state.bootstrap?.queue?.[0]?.track;
  return queueTrack || getLeadTracks()[0] || null;
}

function createRowButton(label, onClick, tone = "default") {
  const button = document.createElement("button");
  button.className = `row-button ${tone === "primary" ? "primary" : ""}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function buildTrackRow(track, actions = []) {
  const node = document.getElementById("trackRowTemplate").content.firstElementChild.cloneNode(true);
  const cover = node.querySelector(".track-row-cover");
  const title = node.querySelector(".track-row-title");
  const meta = node.querySelector(".track-row-meta");
  const reasons = node.querySelector(".track-row-reasons");
  const badges = node.querySelector(".track-row-badges");
  const actionsWrap = node.querySelector(".track-row-actions");

  if (track.image_url) cover.style.backgroundImage = `url("${track.image_url}")`;
  title.textContent = track.title;
  meta.textContent = `${track.artist}${track.album ? ` - ${track.album}` : ""}${track.duration_ms ? ` - ${formatDuration(track.duration_ms)}` : ""}`;
  reasons.textContent = (track.rating_reasons || []).slice(0, 2).join(" - ");
  badges.innerHTML = [
    ratingBadge(`Merged: ${track.merged_rating}`, track.merged_rating),
    ratingBadge(`Spotify: ${track.spotify_rating}`, track.spotify_rating),
    ratingBadge(`Lyrics: ${track.lyrics_rating}`, track.lyrics_rating),
  ].join("");

  actions.forEach((action) => {
    actionsWrap.appendChild(createRowButton(action.label, action.onClick, action.primary ? "primary" : "default"));
  });
  return node;
}

function renderSidebarPlaylists() {
  const wrap = document.getElementById("sidebarPlaylistList");
  const playlists = state.bootstrap?.playlists || [];
  wrap.innerHTML = "";

  playlists.forEach((playlist, index) => {
    const button = document.createElement("button");
    button.className = `sidebar-playlist-item ${playlist.id === state.selectedPlaylistId ? "active" : ""}`.trim();
    const leadTrack = getLeadTracks()[index % Math.max(1, getLeadTracks().length)] || null;
    const coverStyle = leadTrack?.image_url ? `style="background-image:url('${leadTrack.image_url}')"` : "";
    button.innerHTML = `
      <div class="sidebar-cover" ${coverStyle}></div>
      <div>
        <div class="sidebar-name">${playlist.name}</div>
        <div class="sidebar-meta">Playlist - ${playlist.track_count} tracks</div>
      </div>
    `;
    button.addEventListener("click", async () => {
      setView("playlists");
      await loadPlaylist(playlist.id);
    });
    wrap.appendChild(button);
  });
}

function renderHeroGrid() {
  const wrap = document.getElementById("heroGrid");
  const playlists = state.bootstrap?.playlists || [];
  const leadTracks = getLeadTracks();
  wrap.innerHTML = "";

  playlists.slice(0, 6).forEach((playlist, index) => {
    const lead = leadTracks[index % Math.max(1, leadTracks.length)] || null;
    const card = document.createElement("button");
    card.className = "hero-card";
    card.innerHTML = `
      <div class="hero-card-image" ${lead?.image_url ? `style="background-image:url('${lead.image_url}')"` : ""}></div>
      <div class="hero-card-title">${playlist.name}</div>
    `;
    card.addEventListener("click", async () => {
      setView("playlists");
      await loadPlaylist(playlist.id);
    });
    wrap.appendChild(card);
  });

  if (!wrap.children.length) {
    wrap.innerHTML = `
      <div class="hero-card">
        <div class="hero-card-image"></div>
        <div class="hero-card-title">Import a playlist to begin</div>
      </div>
    `;
  }
}

function renderMadeForGrid() {
  const wrap = document.getElementById("madeForGrid");
  const tracks = getLeadTracks();
  wrap.innerHTML = "";

  tracks.slice(0, 8).forEach((track) => {
    const card = document.createElement("article");
    card.className = "made-card";
    card.innerHTML = `
      <div class="made-card-image" ${track.image_url ? `style="background-image:url('${track.image_url}')"` : ""}></div>
      <div class="made-card-title">${track.title}</div>
      <div class="made-card-meta">${track.artist}</div>
    `;
    card.addEventListener("click", () => {
      setBottomPlayer(track);
      setFeatureTrack(track);
    });
    wrap.appendChild(card);
  });

  if (!wrap.children.length) {
    wrap.innerHTML = `<article class="made-card"><div class="made-card-image"></div><div class="made-card-title">No tracks yet</div><div class="made-card-meta">Search or import songs to fill this view.</div></article>`;
  }
}

function renderStats() {
  const wrap = document.getElementById("heroStats");
  const counts = state.bootstrap?.scrape?.counts || {};
  const worker = state.bootstrap?.scrape?.worker || {};
  const queueCount = (state.bootstrap?.queue || []).length;
  const requestCount = (state.bootstrap?.requests || []).length;
  const stats = [
    ["Queue", queueCount],
    ["Requests", requestCount],
    ["Scrape Jobs", counts.total || 0],
    ["Worker", worker.paused ? "Paused" : "Running"],
  ];

  wrap.innerHTML = stats
    .map(
      ([label, value]) => `
        <div class="stat-pill">
          <div class="stat-pill-label">${label}</div>
          <div class="stat-pill-value">${value}</div>
        </div>
      `,
    )
    .join("");
}

function renderSearch() {
  const wrap = document.getElementById("searchResults");
  const requestSelect = document.getElementById("requestMatchSelect");
  const pendingRequests = (state.bootstrap?.requests || []).filter((request) => request.status === "pending" || request.status === "matched");
  requestSelect.innerHTML = `<option value="">No request selected</option>${pendingRequests
    .map((request) => `<option value="${request.id}">${request.raw_query}${request.student_name ? ` - ${request.student_name}` : ""}</option>`)
    .join("")}`;

  wrap.innerHTML = "";
  if (!state.searchResults.length) {
    wrap.className = "list-surface empty-state";
    wrap.textContent = "Search results will appear here.";
    return;
  }
  wrap.className = "list-surface";
  state.searchResults.forEach((track) => {
    wrap.appendChild(
      buildTrackRow(track, [
        { label: "Queue", primary: true, onClick: () => addTrackToQueue(track.id) },
        { label: "Scrape", onClick: () => scrapeTrack(track.id) },
        { label: "Add to Playlist", onClick: () => quickAddToSelectedPlaylist(track.id) },
        { label: "Attach to Request", onClick: () => attachTrackToRequest(track.id) },
      ]),
    );
  });
}

function renderPlaylistLibrary() {
  const wrap = document.getElementById("playlistList");
  const playlists = state.bootstrap?.playlists || [];
  wrap.innerHTML = "";

  playlists.forEach((playlist) => {
    const card = document.createElement("article");
    card.className = "track-row";
    card.innerHTML = `
      <div class="track-row-top">
        <div class="track-row-title">${playlist.name}</div>
        <div class="track-row-meta">${playlist.track_count} tracks</div>
      </div>
      <div class="track-row-reasons">${playlist.description || "Playlist ready for DJ use."}</div>
    `;
    const actions = document.createElement("div");
    actions.className = "track-row-actions";
    actions.appendChild(createRowButton("Open", async () => loadPlaylist(playlist.id), "primary"));
    card.appendChild(actions);
    wrap.appendChild(card);
  });

  if (!wrap.children.length) {
    wrap.className = "list-surface empty-state";
    wrap.textContent = "No playlists available.";
  } else {
    wrap.className = "list-surface";
  }
}

function renderQueue() {
  const wrap = document.getElementById("queueList");
  const queue = state.bootstrap?.queue || [];
  wrap.innerHTML = "";

  if (!queue.length) {
    wrap.className = "list-surface empty-state";
    wrap.textContent = "Queue is empty.";
    return;
  }

  wrap.className = "list-surface";
  queue.forEach((entry) => {
    wrap.appendChild(
      buildTrackRow(entry.track, [
        { label: "Up", onClick: () => moveQueueEntry(entry.id, "up") },
        { label: "Down", onClick: () => moveQueueEntry(entry.id, "down") },
        { label: "Remove", onClick: () => removeQueueEntry(entry.id) },
      ]),
    );
  });
}

function renderRequests() {
  const wrap = document.getElementById("requestList");
  const requests = state.bootstrap?.requests || [];
  wrap.innerHTML = "";

  if (!requests.length) {
    wrap.className = "list-surface empty-state";
    wrap.textContent = "No requests yet.";
    return;
  }

  wrap.className = "list-surface";
  requests.forEach((request) => {
    const matched = request.matched_track;
    const row = document.createElement("article");
    row.className = "track-row";
    row.innerHTML = `
      <div class="track-row-top">
        <div class="track-row-title">${request.raw_query}</div>
        <div class="track-row-badges">${ratingBadge(request.status, request.status === "queued" ? "clean" : request.status === "dismissed" ? "blocked" : "review")}</div>
      </div>
      <div class="track-row-meta">${request.student_name || "Student name not provided"}${request.note ? ` - ${request.note}` : ""}</div>
      <div class="track-row-reasons">${matched ? `Matched: ${matched.title} - ${matched.artist}` : "Use search to attach a track and approve it."}</div>
    `;
    const actions = document.createElement("div");
    actions.className = "track-row-actions";
    if (matched) {
      actions.appendChild(createRowButton("Approve to Queue", () => resolveRequest(request.id, "queued", matched.id), "primary"));
    }
    actions.appendChild(createRowButton("Dismiss", () => resolveRequest(request.id, "dismissed")));
    row.appendChild(actions);
    wrap.appendChild(row);
  });
}

function renderScrapeStatus() {
  const wrap = document.getElementById("scrapeStatus");
  const counts = state.bootstrap?.scrape?.counts || {};
  const worker = state.bootstrap?.scrape?.worker || {};
  wrap.innerHTML = [
    ["Queued", counts.queued || 0],
    ["Retry", counts.retry || 0],
    ["Done", counts.done || 0],
    ["Failed", counts.failed || 0],
    ["Worker", worker.paused ? "Paused" : "Running"],
  ]
    .map(
      ([label, value]) => `
        <div class="stat-pill">
          <div class="stat-pill-label">${label}</div>
          <div class="stat-pill-value">${value}</div>
        </div>
      `,
    )
    .join("");

  const recentWrap = document.getElementById("scrapeRecentTracks");
  const tracks = state.bootstrap?.recent_tracks || [];
  recentWrap.innerHTML = "";
  if (!tracks.length) {
    recentWrap.className = "list-surface empty-state";
    recentWrap.textContent = "Recent scrape activity will appear here.";
    return;
  }
  recentWrap.className = "list-surface";
  tracks.slice(0, 8).forEach((track) => {
    recentWrap.appendChild(buildTrackRow(track, [{ label: "Rescrape", onClick: () => scrapeTrack(track.id) }]));
  });
}

function renderRightRail() {
  const featureTrack = getFeatureTrack();
  setFeatureTrack(featureTrack);

  const wrap = document.getElementById("rightRailList");
  wrap.innerHTML = "";
  getLeadTracks()
    .slice(1, 5)
    .forEach((track) => {
      const row = document.createElement("article");
      row.className = "mini-row";
      row.innerHTML = `
        <div class="mini-row-cover" ${track.image_url ? `style="background-image:url('${track.image_url}')"` : ""}></div>
        <div>
          <div class="mini-row-title">${track.title}</div>
          <div class="mini-row-meta">${track.artist}</div>
        </div>
      `;
      row.addEventListener("click", () => {
        setFeatureTrack(track);
        setBottomPlayer(track);
      });
      wrap.appendChild(row);
    });
}

function setFeatureTrack(track) {
  const card = document.getElementById("featureTrackCard");
  const image = card.querySelector(".feature-image");
  const title = card.querySelector(".feature-title");
  const artist = card.querySelector(".feature-artist");

  if (track?.image_url) {
    image.style.backgroundImage = `linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.35)), url("${track.image_url}")`;
  } else {
    image.style.backgroundImage = "";
  }
  title.textContent = track?.title || "No song selected";
  artist.textContent = track ? `${track.artist} - ${track.merged_rating}` : "Import tracks to begin";
}

function setBottomPlayer(track) {
  const art = document.getElementById("bottomArt");
  const title = document.getElementById("bottomTrackTitle");
  const artist = document.getElementById("bottomTrackArtist");
  const end = document.getElementById("bottomEndTime");
  const fill = document.getElementById("timelineFill");

  if (track?.image_url) art.style.backgroundImage = `url("${track.image_url}")`;
  title.textContent = track?.title || "No song selected";
  artist.textContent = track?.artist || "ALA Music Queue";
  end.textContent = formatDuration(track?.duration_ms || 0);
  fill.style.width = track?.duration_ms ? "36%" : "0%";
}

async function refreshBootstrap() {
  const data = await api("/api/bootstrap");
  state.bootstrap = data;
  renderSidebarPlaylists();
  renderHeroGrid();
  renderMadeForGrid();
  renderStats();
  renderSearch();
  renderPlaylistLibrary();
  renderQueue();
  renderRequests();
  renderScrapeStatus();
  renderRightRail();
  setBottomPlayer(getFeatureTrack());
  setStatus(`Loaded ${data.playlists.length} playlists, ${data.queue.length} queued songs, and ${data.scrape.counts.total || 0} scrape jobs.`);
}

async function searchTracks() {
  const query = document.getElementById("searchInput").value.trim();
  if (!query) {
    state.searchResults = [];
    renderSearch();
    return;
  }
  setView("search");
  setStatus(`Searching for "${query}"...`);
  const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
  state.searchResults = data.results || [];
  renderSearch();
  setStatus(`Found ${state.searchResults.length} track result(s).`);
}

async function createPlaylist() {
  const input = document.getElementById("playlistNameInput");
  const name = input.value.trim();
  if (!name) return;
  await api("/api/playlists", { method: "POST", body: JSON.stringify({ name }) });
  input.value = "";
  await refreshBootstrap();
}

async function loadPlaylist(id) {
  state.selectedPlaylistId = id;
  renderSidebarPlaylists();
  renderPlaylistLibrary();
  const data = await api(`/api/playlists/${id}`);
  const wrap = document.getElementById("playlistTracks");
  document.getElementById("playlistDetailTitle").textContent = data.playlist.name;
  wrap.innerHTML = "";
  if (!(data.playlist.tracks || []).length) {
    wrap.className = "list-surface empty-state";
    wrap.textContent = "This playlist is empty.";
    return;
  }
  wrap.className = "list-surface";
  data.playlist.tracks.forEach((track) => {
    wrap.appendChild(
      buildTrackRow(track, [
        { label: "Queue", primary: true, onClick: () => addTrackToQueue(track.id) },
        { label: "Scrape", onClick: () => scrapeTrack(track.id) },
      ]),
    );
  });
}

async function addTrackToQueue(trackId) {
  await api("/api/queue", { method: "POST", body: JSON.stringify({ track_ids: [trackId] }) });
  await refreshBootstrap();
}

async function quickAddToSelectedPlaylist(trackId) {
  if (!state.selectedPlaylistId) {
    setStatus("Open a playlist first, then add tracks from search.");
    return;
  }
  await api(`/api/playlists/${state.selectedPlaylistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ track_ids: [trackId] }),
  });
  await loadPlaylist(state.selectedPlaylistId);
  await refreshBootstrap();
}

async function moveQueueEntry(entryId, direction) {
  await api(`/api/queue/${entryId}/move`, {
    method: "POST",
    body: JSON.stringify({ direction }),
  });
  await refreshBootstrap();
}

async function removeQueueEntry(entryId) {
  await api(`/api/queue/${entryId}`, { method: "DELETE" });
  await refreshBootstrap();
}

async function addRequest() {
  const rawQuery = document.getElementById("requestSongInput").value.trim();
  const studentName = document.getElementById("requestStudentInput").value.trim();
  const note = document.getElementById("requestNoteInput").value.trim();
  if (!rawQuery) return;
  await api("/api/requests", {
    method: "POST",
    body: JSON.stringify({ raw_query: rawQuery, student_name: studentName, note }),
  });
  document.getElementById("requestSongInput").value = "";
  document.getElementById("requestStudentInput").value = "";
  document.getElementById("requestNoteInput").value = "";
  await refreshBootstrap();
}

async function resolveRequest(requestId, status, matchedTrackId = null) {
  await api(`/api/requests/${requestId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ status, matched_track_id: matchedTrackId }),
  });
  await refreshBootstrap();
}

async function attachTrackToRequest(trackId) {
  const requestId = document.getElementById("requestMatchSelect").value;
  if (!requestId) {
    setStatus("Pick a pending request in Search before attaching a track.");
    return;
  }
  await resolveRequest(Number(requestId), "matched", trackId);
  setStatus("Attached track to the selected student request.");
}

async function scrapeTrack(trackId) {
  await api(`/api/scrape/track/${trackId}`, { method: "POST" });
  await refreshBootstrap();
}

async function uploadSeeds(event) {
  event.preventDefault();
  const file = document.getElementById("uploadFileInput").files[0];
  if (!file) return;
  const data = new FormData();
  data.set("file", file);
  data.set("fmt", document.getElementById("uploadFormatInput").value);
  data.set("playlist_name", document.getElementById("uploadPlaylistInput").value.trim());
  const response = await fetch("/api/import/upload", { method: "POST", body: data });
  if (!response.ok) throw new Error(await response.text());
  await response.json();
  await refreshBootstrap();
}

async function importSpotifyPlaylist() {
  const playlistRef = document.getElementById("spotifyPlaylistInput").value.trim();
  const destinationName = document.getElementById("spotifyDestinationInput").value.trim();
  if (!playlistRef) return;
  await api("/api/import/spotify-playlist", {
    method: "POST",
    body: JSON.stringify({ playlist_ref: playlistRef, destination_name: destinationName }),
  });
  await refreshBootstrap();
}

async function exportCatalog() {
  const data = await api("/api/export", { method: "POST" });
  setStatus(`Exported ${data.export.stats.rows} cached tracks to ${data.export.chunks.length} file(s).`);
}

function setView(viewName) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  document.querySelectorAll(".filter-pill").forEach((button) => {
    button.classList.toggle("selected", button.dataset.view === viewName);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.classList.contains("round-icon")) {
      button.classList.toggle("active", button.dataset.view === viewName);
    }
  });
}

function attachEvents() {
  document.getElementById("refreshAllBtn").addEventListener("click", refreshBootstrap);
  document.getElementById("searchBtn").addEventListener("click", searchTracks);
  document.getElementById("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchTracks();
  });
  document.querySelectorAll(".filter-pill").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll(".round-icon[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll(".link-action[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.getElementById("createPlaylistBtn").addEventListener("click", createPlaylist);
  document.getElementById("addRequestBtn").addEventListener("click", addRequest);
  document.getElementById("uploadForm").addEventListener("submit", uploadSeeds);
  document.getElementById("importSpotifyBtn").addEventListener("click", importSpotifyPlaylist);
  document.getElementById("exportBtn").addEventListener("click", exportCatalog);
  document.getElementById("startWorkerBtn").addEventListener("click", async () => {
    await api("/api/scrape/start", { method: "POST" });
    await refreshBootstrap();
  });
  document.getElementById("pauseWorkerBtn").addEventListener("click", async () => {
    await api("/api/scrape/pause", { method: "POST" });
    await refreshBootstrap();
  });
}

async function init() {
  attachEvents();
  await refreshBootstrap();
  setView("overview");
}

init().catch((error) => {
  console.error(error);
  setStatus(error.message || "Failed to load app");
});
