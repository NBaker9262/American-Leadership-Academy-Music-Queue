// ======================================================
// ALA Music Queue Dashboard
// Cleaned + fixed single-file app.js
// - Spotify PKCE login
// - Live playback preview
// - Previous / Play-Pause / Next transport
// - Time progress + remaining
// - Google Sheet request moderation
// - Approved queue flow
// - Musixmatch lyrics quick links
// ======================================================

// --------------------
// CONFIG
// --------------------
const CONFIG = {
  clientId: "6bcc4a0a3c1b4d869374c628d28a794a",
  redirectUriFallback: "https://coltonsharp-dev.github.io/American-Leadership-Academy-Music-Queue/",
  defaultPlaylistId: "3dcGJ6miJHVxZkQEIwGog5",
  slowPlaylistId: "36GLC9OyT3WQ8YA2yBQhFJ",
  funPlaylistId: "0hVO11nm205QK7BCfLyXNh",
  requestsCsvUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQyc3RRDmjc-nN-XgMMDocbnn1tlxue5ynNoNnYSxnRKxgp2LRGNmYZXnVgAFLH7IViwTAtmIAkvDsK/pub?output=csv",
  scopes: [
    "user-read-private",
    "user-read-email",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-modify-public",
    "playlist-modify-private"
  ],
  playbackPollMs: 15000,
  localProgressTickMs: 1000,
  trackLookupConcurrency: 5,
  trackLookupRetryCount: 2,
  trackLookupRetryDelayMs: 500,
  manualSearchLimit: 8,
  lyricsApiBaseUrl: "",
  lyricsApiTimeoutMs: 12000,
  themeHardBlockTerms: [
    "sex",
    "sexy",
    "strip",
    "nude",
    "porn",
    "drunk",
    "drug",
    "weed",
    "high",
    "gang",
    "kill",
    "murder",
    "suicide"
  ],
  themeReviewTerms: [
    "party",
    "club",
    "breakup",
    "heartbreak",
    "revenge",
    "rage",
    "wild",
    "after dark",
    "late night"
  ],
  themePolicyRules: [
    {
      id: "sexual-block",
      category: "Sexual Content",
      severity: "block",
      terms: ["sex", "sexy", "porn", "nude", "strip", "hookup", "bdsm", "fetish"],
      phrases: ["one night stand", "explicit content", "sexual fantasy", "body shots"]
    },
    {
      id: "drugs-block",
      category: "Drug References",
      severity: "block",
      terms: ["cocaine", "meth", "heroin", "ecstasy", "xanax", "perc", "weed", "blunt", "drug"],
      phrases: ["pop a pill", "getting high", "rolling up", "drug run"]
    },
    {
      id: "violence-block",
      category: "Violence",
      severity: "block",
      terms: ["kill", "murder", "suicide", "shoot", "stab", "blood", "homicide"],
      phrases: ["take your life", "pull the trigger", "body bag", "die tonight"]
    },
    {
      id: "hate-block",
      category: "Hate or Harassment",
      severity: "block",
      terms: ["slur", "racist", "nazi", "hate", "lynch"],
      phrases: ["hate them", "ethnic cleansing", "white power"]
    },
    {
      id: "gang-block",
      category: "Gang or Criminal Themes",
      severity: "block",
      terms: ["gang", "cartel", "driveby", "robbery", "crime", "weapon"],
      phrases: ["gang life", "armed robbery", "hit list", "territory war"]
    },
    {
      id: "party-review",
      category: "Party / Club",
      severity: "review",
      terms: ["party", "club", "wild", "rager", "lit"],
      phrases: ["all night", "turn up", "dance floor", "after party"]
    },
    {
      id: "romance-review",
      category: "Romance / Breakup",
      severity: "review",
      terms: ["breakup", "heartbreak", "kiss", "dating", "revenge"],
      phrases: ["broke my heart", "love triangle", "toxic love", "get back at"]
    },
    {
      id: "language-review",
      category: "Mild Language",
      severity: "review",
      terms: ["damn", "hell", "sucks", "freakin"],
      phrases: ["lose my mind", "out of control", "shut up"]
    }
  ]
};

// --------------------
// STORAGE KEYS
// --------------------
const LS = {
  pkceVerifier: "ala_dash_pkce_verifier",
  oauthState: "ala_dash_oauth_state",
  accessToken: "ala_dash_access_token",
  refreshToken: "ala_dash_refresh_token",
  expiresAt: "ala_dash_expires_at",
  approvedQueue: "ala_approved_queue",
  rejectedIds: "ala_rejected_ids",
  queuePointer: "ala_queue_pointer",
  djAssistedRequests: "ala_dj_assisted_requests"
};

const authStorage = window.sessionStorage;
const persistentStorage = window.localStorage;

function authSet(key, value) {
  authStorage.setItem(key, value);
}

function authGet(key) {
  return authStorage.getItem(key);
}

function authRemove(key) {
  authStorage.removeItem(key);
}

// Clears old auth values that may still exist from prior localStorage-based versions.
function clearLegacyAuthStorage() {
  persistentStorage.removeItem(LS.pkceVerifier);
  persistentStorage.removeItem(LS.oauthState);
  persistentStorage.removeItem(LS.accessToken);
  persistentStorage.removeItem(LS.refreshToken);
  persistentStorage.removeItem(LS.expiresAt);
}

// --------------------
// DOM
// --------------------
const el = {
  btnLogin: document.getElementById("btnLogin"),
  btnLogout: document.getElementById("btnLogout"),
  btnLoadRequests: document.getElementById("btnLoadRequests"),
  btnRefreshPlayback: document.getElementById("btnRefreshPlayback"),
  btnPrevQueue: document.getElementById("btnPrevQueue"),
  btnNextQueue: document.getElementById("btnNextQueue"),
  btnStartDefaultPlaylist: document.getElementById("btnStartDefaultPlaylist"),
  btnStartSlowPlaylist: document.getElementById("btnStartSlowPlaylist"),
  btnStartFunPlaylist: document.getElementById("btnStartFunPlaylist"),
  btnAddApprovedToQueue: document.getElementById("btnAddApprovedToQueue"),
  btnApproveAllCleanVisible: document.getElementById("btnApproveAllCleanVisible"),
  btnRemoveAllApproved: document.getElementById("btnRemoveAllApproved"),
  btnUndoModerationAction: document.getElementById("btnUndoModerationAction"),
  btnOpenModeration: document.getElementById("btnOpenModeration"),
  btnSearchSongs: document.getElementById("btnSearchSongs"),
  btnNowPlayingLyrics: document.getElementById("btnNowPlayingLyrics"),
  btnPrevTrack: document.getElementById("btnPrevTrack"),
  btnPlayPause: document.getElementById("btnPlayPause"),
  btnNextTrack: document.getElementById("btnNextTrack"),
  btnAddDjAssistedRequest: document.getElementById("btnAddDjAssistedRequest"),
  btnAddSelectedToMainPlaylist: document.getElementById("btnAddSelectedToMainPlaylist"),
  btnAddSelectedToSlowPlaylist: document.getElementById("btnAddSelectedToSlowPlaylist"),
  btnAddSelectedToFunPlaylist: document.getElementById("btnAddSelectedToFunPlaylist"),
  btnCloseModerationReason: document.getElementById("btnCloseModerationReason"),
  btnCloseLyricsModal: document.getElementById("btnCloseLyricsModal"),
  playPauseIcon: document.getElementById("playPauseIcon"),

  status: document.getElementById("status"),
  nowPlaying: document.getElementById("nowPlaying"),
  nowPlayingMeta: document.getElementById("nowPlayingMeta"),
  nowPlayingArt: document.getElementById("nowPlayingArt"),
  nowPlayingProgressText: document.getElementById("nowPlayingProgressText"),
  nowPlayingRemaining: document.getElementById("nowPlayingRemaining"),
  nowPlayingTotalTime: document.getElementById("nowPlayingTotalTime"),
  nowPlayingProgressBar: document.getElementById("nowPlayingProgressBar"),
  nowPlayingSeekTrack: document.getElementById("nowPlayingSeekTrack"),
  nowPlayingVolumeTrack: document.getElementById("nowPlayingVolumeTrack"),
  nowPlayingVolumeBar: document.getElementById("nowPlayingVolumeBar"),
  nowPlayingVolumeText: document.getElementById("nowPlayingVolumeText"),
  playbackStateLabel: document.getElementById("playbackStateLabel"),

  hideExplicitOnly: document.getElementById("hideExplicitOnly"),
  requestSummary: document.getElementById("requestSummary"),
  requestTableBody: document.getElementById("requestTableBody"),
  approvedQueueList: document.getElementById("approvedQueueList"),
  approvedPreviewTable: document.getElementById("approvedPreviewTable"),
  spotifyQueueList: document.getElementById("spotifyQueueList"),
  manualSearchInput: document.getElementById("manualSearchInput"),
  manualSearchResults: document.getElementById("manualSearchResults"),
  djStudentNameInput: document.getElementById("djStudentNameInput"),
  djThemeInput: document.getElementById("djThemeInput"),
  djSpotifyLinkInput: document.getElementById("djSpotifyLinkInput"),
  moderationReasonModal: document.getElementById("moderationReasonModal"),
  moderationReasonBackdrop: document.getElementById("moderationReasonBackdrop"),
  moderationReasonTitle: document.getElementById("moderationReasonTitle"),
  moderationReasonBody: document.getElementById("moderationReasonBody"),
  lyricsBackdrop: document.getElementById("lyricsBackdrop"),
  lyricsModal: document.getElementById("lyricsModal"),
  lyricsModalTitle: document.getElementById("lyricsModalTitle"),
  lyricsModalMeta: document.getElementById("lyricsModalMeta"),
  lyricsModalBody: document.getElementById("lyricsModalBody"),
  lyricsModalExternalLink: document.getElementById("lyricsModalExternalLink")
};

// --------------------
// STATE
// --------------------
let currentRequests = [];
let playbackTimer = null;
let localProgressTimer = null;
const moderationHistory = [];
let isUndoingModeration = false;
let manualSearchResults = [];

let currentNowPlayingTrack = null;
let currentSpotifyQueueTracks = [];
let currentPlaybackProgressMs = 0;
let currentPlaybackDurationMs = 0;
let isPlaybackActive = false;
let currentVolumePercent = 0;
let moderationDetailContext = null;
let draggingApprovedRequestId = null;
const lyricsFetchStateByRequestId = new Map();

// ======================================================
// BASIC HELPERS
// ======================================================
function setStatus(message) {
  if (el.status) el.status.textContent = message;
  console.log(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function msToMinSec(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function spotifyTrackUrl(trackId) {
  return `https://open.spotify.com/track/${trackId}`;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildRequestId(row) {
  if (row?.requestId) {
    return String(row.requestId);
  }

  return [row.timestamp || "", row.email || "", row.spotifyLink || ""].join("|");
}

function formatTimestamp(dateLike) {
  try {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function decodeLeetspeak(value) {
  return String(value ?? "")
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");
}

function normalizeModerationText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModerationVariants(value) {
  const direct = normalizeModerationText(value);
  const decoded = normalizeModerationText(decodeLeetspeak(value));
  if (!decoded || decoded === direct) return [direct].filter(Boolean);
  return [direct, decoded].filter(Boolean);
}

function containsNormalizedPhrase(normalizedText, normalizedPhrase) {
  if (!normalizedText || !normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function getModerationSearchEntries(request) {
  const spotify = request?.spotify || null;
  return [
    { field: "theme", value: request?.theme || "" },
    { field: "title", value: spotify?.name || "" },
    { field: "artist", value: spotify?.artist || "" },
    { field: "album", value: spotify?.album || "" }
  ];
}

function collectThemePolicyHits(request) {
  const entries = getModerationSearchEntries(request)
    .map((entry) => ({
      ...entry,
      variants: normalizeModerationVariants(entry.value)
    }))
    .filter((entry) => entry.variants.length > 0);

  const seen = new Set();
  const hits = [];

  for (const rule of CONFIG.themePolicyRules || []) {
    const terms = Array.isArray(rule.terms) ? rule.terms : [];
    const phrases = Array.isArray(rule.phrases) ? rule.phrases : [];
    const allCandidates = [
      ...terms.map((term) => ({ type: "keyword", value: term })),
      ...phrases.map((phrase) => ({ type: "phrase", value: phrase }))
    ];

    for (const candidate of allCandidates) {
      const normalizedCandidate = normalizeModerationText(candidate.value);
      if (!normalizedCandidate) continue;

      for (const entry of entries) {
        const matched = entry.variants.some((variant) =>
          containsNormalizedPhrase(variant, normalizedCandidate)
        );

        if (!matched) continue;

        const dedupeKey = [rule.id, entry.field, normalizedCandidate].join("|");
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        hits.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          field: entry.field,
          matchType: candidate.type,
          matchedText: candidate.value,
          normalizedMatch: normalizedCandidate
        });
      }
    }
  }

  return hits;
}

function summarizePolicyHits(hits) {
  const grouped = new Map();
  for (const hit of hits) {
    const key = `${hit.category}|${hit.severity}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        category: hit.category,
        severity: hit.severity,
        count: 0,
        fields: new Set(),
        matches: new Set()
      });
    }

    const group = grouped.get(key);
    group.count += 1;
    group.fields.add(hit.field);
    group.matches.add(hit.matchedText);
  }

  return [...grouped.values()].map((group) => ({
    category: group.category,
    severity: group.severity,
    count: group.count,
    fields: [...group.fields],
    matches: [...group.matches]
  }));
}

function findThemeMatches(rawTheme, termList) {
  const normalizedTheme = normalizeModerationText(rawTheme);
  if (!normalizedTheme) return [];

  const paddedTheme = ` ${normalizedTheme} `;
  return termList.filter((term) => {
    const normalizedTerm = normalizeModerationText(term);
    if (!normalizedTerm) return false;
    return paddedTheme.includes(` ${normalizedTerm} `);
  });
}

function analyzeThemeModeration(request) {
  const theme = String(request?.theme ?? "").trim();
  const policyHits = collectThemePolicyHits(request);
  const hardHits = policyHits.filter((hit) => hit.severity === "block");
  const reviewHits = policyHits.filter((hit) => hit.severity === "review");

  const fallbackHardTerms = findThemeMatches(theme, CONFIG.themeHardBlockTerms);
  const fallbackReviewTerms = findThemeMatches(theme, CONFIG.themeReviewTerms);

  if (!theme && !policyHits.length) {
    return {
      status: "none",
      label: "No Theme",
      reason: "No theme was submitted and no risky keywords were detected in track metadata.",
      matchedTerms: [],
      hits: [],
      summary: []
    };
  }

  if (hardHits.length || fallbackHardTerms.length) {
    const categories = [...new Set(hardHits.map((hit) => hit.category))];
    const fallbackCategory = fallbackHardTerms.length ? ["Legacy Theme Blocklist"] : [];
    return {
      status: "blocked",
      label: "Theme Blocked",
      reason: `Detected blocked policy categories: ${[...categories, ...fallbackCategory].join(", ")}.`,
      matchedTerms: [...new Set([...hardHits.map((hit) => hit.matchedText), ...fallbackHardTerms])],
      hits: policyHits,
      summary: summarizePolicyHits(policyHits)
    };
  }

  if (reviewHits.length || fallbackReviewTerms.length) {
    const categories = [...new Set(reviewHits.map((hit) => hit.category))];
    const fallbackCategory = fallbackReviewTerms.length ? ["Legacy Theme Review"] : [];
    return {
      status: "flagged",
      label: "Theme Review",
      reason: `Detected review categories: ${[...categories, ...fallbackCategory].join(", ")}. Manual review is recommended.`,
      matchedTerms: [...new Set([...reviewHits.map((hit) => hit.matchedText), ...fallbackReviewTerms])],
      hits: policyHits,
      summary: summarizePolicyHits(policyHits)
    };
  }

  return {
    status: "clear",
    label: "Theme Clear",
    reason: "Theme and related track metadata passed current keyword and phrase policy checks.",
    matchedTerms: [],
    hits: policyHits,
    summary: summarizePolicyHits(policyHits)
  };
}

function buildModerationMetadata(request) {
  const explicitFlag = request?.spotify?.explicit;
  const themeEvaluation = analyzeThemeModeration(request);
  const policyHits = Array.isArray(themeEvaluation.hits) ? themeEvaluation.hits : [];

  const hardHitCount = policyHits.filter((hit) => hit.severity === "block").length;
  const reviewHitCount = policyHits.filter((hit) => hit.severity === "review").length;

  let explicitStatus = "unknown";
  let explicitLabel = "Unknown";
  let explicitReason = "Spotify track metadata was unavailable for explicit classification.";

  if (explicitFlag === true) {
    explicitStatus = "explicit";
    explicitLabel = "Explicit";
    explicitReason = "Spotify marks this track explicit (explicit=true).";
  } else if (explicitFlag === false) {
    explicitStatus = "clean";
    explicitLabel = "Clean";
    explicitReason = "Spotify marks this track non-explicit (explicit=false).";
  }

  let recommendation = "pass";
  let recommendationLabel = "Auto-Approve Eligible";
  let recommendationReason = "No explicit or blocked theme signals were detected.";

  if (explicitStatus === "explicit" || themeEvaluation.status === "blocked") {
    recommendation = "block";
    recommendationLabel = "Block";
    recommendationReason =
      explicitStatus === "explicit"
        ? "Track is marked explicit by Spotify metadata."
        : "Theme or metadata triggered blocked policy categories. Review required before any approval.";
  } else if (themeEvaluation.status === "flagged") {
    recommendation = "review";
    recommendationLabel = "Manual Review";
    recommendationReason = "Theme/metadata passed hard blocks but matched review categories that need manual review.";
  }

  const compactReason = `${explicitLabel} by Spotify metadata | ${themeEvaluation.label} (${hardHitCount} hard, ${reviewHitCount} review hits)`;

  return {
    explicitStatus,
    explicitLabel,
    explicitReason,
    explicitSource: "Spotify track metadata",
    themeStatus: themeEvaluation.status,
    themeLabel: themeEvaluation.label,
    themeReason: themeEvaluation.reason,
    themeTerms: themeEvaluation.matchedTerms,
    themePolicyHits: policyHits,
    themePolicySummary: summarizePolicyHits(policyHits),
    recommendation,
    recommendationLabel,
    recommendationReason,
    compactReason,
    evaluatedAt: new Date().toISOString(),
    confidence: explicitStatus === "unknown" && !policyHits.length ? "Medium" : "High"
  };
}

function ensureModerationMetadata(request) {
  if (!request) return null;
  if (!request.moderation || typeof request.moderation !== "object") {
    request.moderation = buildModerationMetadata(request);
  }
  return request.moderation;
}

function getSourceLabel(source) {
  if (source === "dj-assisted") return "DJ Assisted";
  if (source === "moderator") return "Moderator Search";
  return "Student Request";
}

function isTrackObject(item) {
  return !!item && item.type === "track";
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getErrorStatusCode(error) {
  const message = String(error?.message || "");
  const match = message.match(/^(\d{3})\b/);
  if (!match) return null;
  return Number(match[1]);
}

function pushModerationHistory(action) {
  if (isUndoingModeration) return;
  moderationHistory.push(action);
  if (moderationHistory.length > 100) {
    moderationHistory.shift();
  }
}

function getVisibleUnapprovedRequests(requests) {
  const hideExplicit = !!el.hideExplicitOnly?.checked;
  const rejected = getRejectedIds();

  return requests.filter((request) => {
    if (rejected.has(request.requestId)) return false;
    if (isApproved(request.requestId)) return false;
    if (hideExplicit && request.spotify && request.spotify.explicit === true) return false;
    return true;
  });
}

function updatePlaybackProgressUI(progressMs, durationMs) {
  if (el.nowPlayingProgressText) {
    el.nowPlayingProgressText.textContent = msToMinSec(progressMs);
  }

  if (el.nowPlayingRemaining) {
    const remaining = Math.max(0, durationMs - progressMs);
    el.nowPlayingRemaining.textContent = `-${msToMinSec(remaining)}`;
  }

  if (el.nowPlayingTotalTime) {
    el.nowPlayingTotalTime.textContent = msToMinSec(durationMs);
  }

  if (el.nowPlayingProgressBar) {
    const pct = durationMs > 0 ? Math.min(100, Math.max(0, (progressMs / durationMs) * 100)) : 0;
    el.nowPlayingProgressBar.style.width = `${pct}%`;
  }
}

function updateVolumeUI(volumePercent) {
  const safeVolume = Number.isFinite(volumePercent) ? Math.max(0, Math.min(100, volumePercent)) : 0;
  currentVolumePercent = safeVolume;

  if (el.nowPlayingVolumeBar) {
    el.nowPlayingVolumeBar.style.width = `${safeVolume}%`;
  }

  if (el.nowPlayingVolumeText) {
    el.nowPlayingVolumeText.textContent = `${Math.round(safeVolume)}%`;
  }
}

function updatePlaybackStateLabel() {
  if (!el.playbackStateLabel) return;

  if (!currentNowPlayingTrack) {
    el.playbackStateLabel.textContent = "No Active Song";
    if (el.playPauseIcon) el.playPauseIcon.textContent = "▶︎";
    return;
  }

  el.playbackStateLabel.textContent = isPlaybackActive ? "Playing" : "Paused";
  if (el.playPauseIcon) {
    el.playPauseIcon.textContent = isPlaybackActive ? "⏸︎" : "▶︎";
  }
}

function setTransportBusy(isBusy) {
  const buttons = [el.btnPrevTrack, el.btnPlayPause, el.btnNextTrack];
  for (const button of buttons) {
    if (button) button.disabled = !!isBusy;
  }
}

function startLocalProgressTimer() {
  stopLocalProgressTimer();

  localProgressTimer = window.setInterval(() => {
    if (!currentNowPlayingTrack || !isPlaybackActive) return;

    currentPlaybackProgressMs = Math.min(
      currentPlaybackDurationMs,
      currentPlaybackProgressMs + CONFIG.localProgressTickMs
    );

    updatePlaybackProgressUI(currentPlaybackProgressMs, currentPlaybackDurationMs);
  }, CONFIG.localProgressTickMs);
}

function stopLocalProgressTimer() {
  if (localProgressTimer) {
    window.clearInterval(localProgressTimer);
    localProgressTimer = null;
  }
}

// ======================================================
// STORAGE HELPERS
// ======================================================
function ensureStorageDefaults() {
  if (!persistentStorage.getItem(LS.approvedQueue)) {
    persistentStorage.setItem(LS.approvedQueue, JSON.stringify([]));
  }
  if (!persistentStorage.getItem(LS.rejectedIds)) {
    persistentStorage.setItem(LS.rejectedIds, JSON.stringify([]));
  }
  if (!persistentStorage.getItem(LS.queuePointer)) {
    persistentStorage.setItem(LS.queuePointer, "0");
  }
  if (!persistentStorage.getItem(LS.djAssistedRequests)) {
    persistentStorage.setItem(LS.djAssistedRequests, JSON.stringify([]));
  }
}

function getApprovedQueue() {
  const stored = persistentStorage.getItem(LS.approvedQueue);
  if (!stored) {
    persistentStorage.setItem(LS.approvedQueue, JSON.stringify([]));
    return [];
  }
  const parsed = safeJsonParse(stored, []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveApprovedQueue(queue) {
  persistentStorage.setItem(LS.approvedQueue, JSON.stringify(queue));
}

function getRejectedIds() {
  const stored = safeJsonParse(persistentStorage.getItem(LS.rejectedIds), []);
  return new Set(Array.isArray(stored) ? stored : []);
}

function saveRejectedIds(setObj) {
  persistentStorage.setItem(LS.rejectedIds, JSON.stringify([...setObj]));
}

function getQueuePointer() {
  const raw = Number(persistentStorage.getItem(LS.queuePointer));
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function setQueuePointer(index) {
  persistentStorage.setItem(LS.queuePointer, String(Math.max(0, index)));
}

function clampQueuePointer() {
  const queue = getApprovedQueue();
  if (!queue.length) {
    setQueuePointer(0);
    return 0;
  }

  const current = getQueuePointer();
  const clamped = Math.min(current, queue.length - 1);
  setQueuePointer(clamped);
  return clamped;
}

function isTrackApproved(trackId) {
  if (!trackId) return false;
  return getApprovedQueue().some((item) => item.spotify?.id === trackId);
}

function countTrackInApprovedQueue(trackId) {
  if (!trackId) return 0;
  return getApprovedQueue().filter((item) => item.spotify?.id === trackId).length;
}

function getDjAssistedRequests() {
  const stored = safeJsonParse(persistentStorage.getItem(LS.djAssistedRequests), []);
  if (!Array.isArray(stored)) return [];
  return stored;
}

function saveDjAssistedRequests(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  persistentStorage.setItem(LS.djAssistedRequests, JSON.stringify(safeRows));
}

function createManualApprovedRequest(track) {
  const spotify = normalizeSpotifyTrack(track);

  const request = {
    requestId: `manual|${spotify?.id || randomString(8)}|${Date.now()}|${randomString(6)}`,
    timestamp: "Added manually",
    email: "",
    spotifyLink: spotify?.externalUrl || "",
    source: "moderator",
    theme: "",
    studentName: "",
    spotify
  };

  request.moderation = buildModerationMetadata(request);
  return request;
}

function createDjAssistedRawRow({ studentName, theme, spotifyLink }) {
  const timestampIso = new Date().toISOString();
  const displayTimestamp = formatTimestamp(timestampIso) || timestampIso;

  return {
    requestId: `dj|${Date.now()}|${randomString(6)}`,
    timestamp: displayTimestamp,
    email: "",
    spotifyLink,
    source: "dj-assisted",
    studentName: String(studentName || "").trim(),
    theme: String(theme || "").trim(),
    createdAt: timestampIso
  };
}

// ======================================================
// CSV PARSER
// ======================================================
function parseCSV(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows.filter((r) => Array.isArray(r) && r.length > 0);
}

// ======================================================
// SPOTIFY LINK PARSER
// ======================================================
function extractSpotifyTrackId(url) {
  if (!url) return null;

  const trimmed = String(url).trim();

  const trackUrlMatch = trimmed.match(/spotify\.com\/track\/([A-Za-z0-9]+)/i);
  if (trackUrlMatch) return trackUrlMatch[1];

  const spotifyUriMatch = trimmed.match(/spotify:track:([A-Za-z0-9]+)/i);
  if (spotifyUriMatch) return spotifyUriMatch[1];

  return null;
}

// ======================================================
// LYRICS HELPERS (MUSIXMATCH)
// ======================================================
function slugifyForMusixmatch(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "-")
    .replace(/[,&/+]+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildMusixmatchUrl(artist, song) {
  const artistSlug = slugifyForMusixmatch(artist) || "Unknown-Artist";
  const songSlug = slugifyForMusixmatch(song) || "Unknown-Song";

  return `https://www.musixmatch.com/lyrics/${artistSlug}/${songSlug}`;
}

function buildLyricsUrl(artist, song) {
  return buildMusixmatchUrl(artist, song);
}

function getLyricsApiBaseUrl() {
  return String(CONFIG.lyricsApiBaseUrl || "").trim().replace(/\/+$/, "");
}

function buildLyricsApiUrl(artist, song) {
  const base = getLyricsApiBaseUrl();
  if (!base) return "";

  const params = new URLSearchParams({
    artist: String(artist || "").trim(),
    song: String(song || "").trim()
  });

  return `${base}/lyrics?${params.toString()}`;
}

async function fetchLyricsFromApi(artist, song) {
  const apiUrl = buildLyricsApiUrl(artist, song);
  if (!apiUrl) {
    return {
      ok: false,
      reason: "Lyrics API is not configured.",
      status: "not-configured"
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.lyricsApiTimeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        ok: false,
        reason: errorText || `Lyrics API responded with ${response.status}.`,
        status: "api-error"
      };
    }

    const json = await response.json();
    const lyrics = String(json?.lyrics || "").trim();
    if (!lyrics) {
      return {
        ok: false,
        reason: "Lyrics API returned no lyrics text.",
        status: "empty"
      };
    }

    return {
      ok: true,
      lyrics,
      selectorUsed: String(json?.selector_used || ""),
      source: String(json?.source || "Lyrics API")
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "Lyrics API request timed out." : (error?.message || "Lyrics API request failed."),
      status: "request-failed"
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function createLyricsButtonHtml({ url = "", artist = "", song = "", requestId = "" } = {}) {
  return `
    <button
      class="ghost-btn btn-lyrics btn-lyrics-fetch"
      type="button"
      data-lyrics-url="${escapeHtml(url)}"
      data-lyrics-artist="${escapeHtml(artist)}"
      data-lyrics-song="${escapeHtml(song)}"
      data-lyrics-request-id="${escapeHtml(requestId)}"
    >
      Lyrics
    </button>
  `;
}

// ======================================================
// NORMALIZE SPOTIFY TRACK
// ======================================================
function normalizeSpotifyTrack(track) {
  if (!track) return null;

  const artistNames = Array.isArray(track.artists)
    ? track.artists.map((artist) => artist?.name).filter(Boolean).join(", ")
    : String(track.artist || "").trim();

  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: artistNames || "Unknown Artist",
    explicit: !!track.explicit,
    durationMs: track.duration_ms ?? track.durationMs ?? 0,
    externalUrl:
      track.external_urls?.spotify ||
      track.externalUrl ||
      (track.id ? spotifyTrackUrl(track.id) : ""),
    album: track.album?.name || track.album || "",
    image:
      track.album?.images?.[0]?.url ||
      track.album?.images?.[1]?.url ||
      track.album?.images?.[2]?.url ||
      track.image || ""
  };
}

// ======================================================
// PKCE AUTH HELPERS
// ======================================================
function randomString(length = 64) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createCodeChallenge(verifier) {
  const digest = await sha256(verifier);
  return base64UrlEncode(digest);
}

function getRedirectUri() {
  if (!window?.location?.origin || !window?.location?.pathname) {
    return CONFIG.redirectUriFallback;
  }

  const path = window.location.pathname.endsWith(".html")
    ? window.location.pathname.replace(/[^/]+$/, "")
    : window.location.pathname;

  return `${window.location.origin}${path}`;
}

// ======================================================
// SPOTIFY AUTH
// ======================================================
async function loginToSpotify() {
  setStatus("Starting Spotify login...");

  const verifier = randomString(64);
  const state = randomString(32);
  const challenge = await createCodeChallenge(verifier);

  authSet(LS.pkceVerifier, verifier);
  authSet(LS.oauthState, state);

  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: CONFIG.scopes.join(" "),
    state,
    show_dialog: "true"
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleSpotifyCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    setStatus(`Spotify login error: ${error}`);
    return;
  }

  if (!code) return;

  const expectedState = authGet(LS.oauthState);
  if (!expectedState || !returnedState || expectedState !== returnedState) {
    throw new Error("Spotify login state mismatch. Please try logging in again.");
  }

  const verifier = authGet(LS.pkceVerifier);
  if (!verifier) {
    setStatus("Missing PKCE verifier. Try logging in again.");
    return;
  }

  setStatus("Exchanging Spotify authorization code...");

  const body = new URLSearchParams({
    client_id: CONFIG.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const json = await response.json();

  authSet(LS.accessToken, json.access_token);
  if (json.refresh_token) {
    authSet(LS.refreshToken, json.refresh_token);
  }
  authSet(
    LS.expiresAt,
    String(Date.now() + json.expires_in * 1000 - 30000)
  );
  authRemove(LS.pkceVerifier);

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  window.history.replaceState({}, document.title, url.toString());
  authRemove(LS.oauthState);

  setStatus("Spotify login successful.");
}

async function getAccessToken() {
  const accessToken = authGet(LS.accessToken);
  const expiresAt = Number(authGet(LS.expiresAt) || "0");

  if (accessToken && Date.now() < expiresAt) {
    return accessToken;
  }

  const refreshToken = authGet(LS.refreshToken);
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    client_id: CONFIG.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Refresh failed:", text);
    return null;
  }

  const json = await response.json();

  authSet(LS.accessToken, json.access_token);
  authSet(
    LS.expiresAt,
    String(Date.now() + json.expires_in * 1000 - 30000)
  );

  return json.access_token;
}

function logoutSpotify() {
  authRemove(LS.accessToken);
  authRemove(LS.refreshToken);
  authRemove(LS.expiresAt);
  authRemove(LS.pkceVerifier);
  authRemove(LS.oauthState);

  stopPlaybackPolling();
  stopLocalProgressTimer();

  currentNowPlayingTrack = null;
  currentSpotifyQueueTracks = [];
  currentPlaybackProgressMs = 0;
  currentPlaybackDurationMs = 0;
  isPlaybackActive = false;

  resetNowPlayingUI();
  renderSpotifyQueue(null);
  setStatus("Logged out of Spotify.");
}

async function getTrackByIdWithRetry(trackId) {
  const maxAttempts = Math.max(1, CONFIG.trackLookupRetryCount + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await getTrackById(trackId);
    } catch (error) {
      const statusCode = getErrorStatusCode(error);
      const isLastAttempt = attempt === maxAttempts;

      if (statusCode === 429 && !isLastAttempt) {
        await wait(CONFIG.trackLookupRetryDelayMs * attempt);
        continue;
      }

      throw error;
    }
  }

  throw new Error("Track lookup failed unexpectedly.");
}

// ======================================================
// SPOTIFY API
// ======================================================
async function spotifyFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Spotify login required.");
  }

  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 204) return null;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }

  return response.json();
}

async function spotifyNoContent(path, options = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Spotify login required.");

  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }

  return true;
}

async function getCurrentUserProfile() {
  return spotifyFetch("/me");
}

async function getTrackById(trackId) {
  return spotifyFetch(`/tracks/${trackId}`);
}

async function getCurrentlyPlaying() {
  try {
    return await spotifyFetch("/me/player");
  } catch (error) {
    console.warn("Currently playing unavailable:", error);
    return null;
  }
}

async function getAvailableDevices() {
  return spotifyFetch("/me/player/devices");
}

async function getSpotifyQueue() {
  return spotifyFetch("/me/player/queue");
}

async function searchSpotifyTracks(query) {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(CONFIG.manualSearchLimit)
  });

  const response = await spotifyFetch(`/search?${params.toString()}`);
  return Array.isArray(response?.tracks?.items) ? response.tracks.items : [];
}

async function ensureActiveDevice() {
  const deviceData = await getAvailableDevices();
  const devices = deviceData?.devices || [];

  if (!devices.length) {
    throw new Error(
      "No active Spotify device found. Open Spotify in another window or app and start playback there first."
    );
  }

  const activeDevice = devices.find((d) => d.is_active);
  if (activeDevice) return activeDevice;

  const controllable = devices.find((d) => !d.is_restricted) || devices[0];
  if (!controllable?.id) {
    throw new Error("A Spotify device was found, but it cannot be controlled.");
  }

  return controllable;
}

async function startDefaultPlaylist() {
  return startPlaylistById(CONFIG.defaultPlaylistId);
}

async function startSlowPlaylist() {
  return startPlaylistById(CONFIG.slowPlaylistId);
}

async function startFunPlaylist() {
  return startPlaylistById(CONFIG.funPlaylistId);
}

async function startPlaylistById(playlistId) {
  const token = await getAccessToken();
  if (!token) throw new Error("Spotify login required.");

  if (!playlistId) {
    throw new Error("Missing playlist ID in app configuration.");
  }

  const device = await ensureActiveDevice();

  const response = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device.id)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        context_uri: `spotify:playlist:${playlistId}`
      })
    }
  );

  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }
}

async function addTrackToPlaylist(playlistId, trackUri) {
  if (!playlistId) {
    throw new Error("Missing playlist ID in app configuration.");
  }

  if (!trackUri) {
    throw new Error("Missing track URI for playlist add.");
  }

  const token = await getAccessToken();
  if (!token) throw new Error("Spotify login required.");

  const response = await fetch(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ uris: [trackUri] })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }
}

async function addTrackToSpotifyQueue(trackUri) {
  const token = await getAccessToken();
  if (!token) throw new Error("Spotify login required.");

  await ensureActiveDevice();

  const url = new URL("https://api.spotify.com/v1/me/player/queue");
  url.searchParams.set("uri", trackUri);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok && response.status !== 204) {
    const text = await response.text();

    if (response.status === 404 && text.includes("NO_ACTIVE_DEVICE")) {
      throw new Error(
        "No active Spotify device found. Open Spotify and start playback first."
      );
    }

    if (response.status === 403) {
      throw new Error(
        "Spotify blocked Add to Queue. This usually means the account is not Premium or the device cannot be controlled."
      );
    }

    throw new Error(`${response.status} ${text}`);
  }
}

async function pausePlayback() {
  await ensureActiveDevice();
  await spotifyNoContent("/me/player/pause", { method: "PUT" });
}

async function resumePlayback() {
  await ensureActiveDevice();
  await spotifyNoContent("/me/player/play", { method: "PUT" });
}

async function skipToNextTrack() {
  await ensureActiveDevice();
  await spotifyNoContent("/me/player/next", { method: "POST" });
}

async function skipToPreviousTrack() {
  await ensureActiveDevice();
  await spotifyNoContent("/me/player/previous", { method: "POST" });
}

async function togglePlayPause() {
  if (isPlaybackActive) {
    await pausePlayback();
  } else {
    await resumePlayback();
  }
}

async function seekPlayback(positionMs) {
  await ensureActiveDevice();
  const safePosition = Math.max(0, Math.floor(positionMs));
  await spotifyNoContent(`/me/player/seek?position_ms=${safePosition}`, { method: "PUT" });
}

async function setPlaybackVolume(volumePercent) {
  await ensureActiveDevice();
  const safeVolume = Math.max(0, Math.min(100, Math.round(volumePercent)));
  await spotifyNoContent(`/me/player/volume?volume_percent=${safeVolume}`, { method: "PUT" });
}

// ======================================================
// GOOGLE SHEET REQUEST LOADING
// ======================================================
function findHeaderIndex(headers, candidates, fallbackIndex = -1) {
  const normalized = headers.map(normalizeHeader);

  for (const candidate of candidates) {
    const target = normalizeHeader(candidate);
    const idx = normalized.findIndex((h) => h === target);
    if (idx !== -1) return idx;
  }

  for (const candidate of candidates) {
    const target = normalizeHeader(candidate);
    const idx = normalized.findIndex((h) => h.includes(target));
    if (idx !== -1) return idx;
  }

  return fallbackIndex;
}

async function fetchStudentRequestRows() {
  const url = `${CONFIG.requestsCsvUrl}${CONFIG.requestsCsvUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google Sheet CSV: ${response.status}`);
  }

  const text = await response.text();
  const rows = parseCSV(text);

  if (!rows.length) return [];

  const headers = rows[0].map((cell) => String(cell ?? "").trim());

  const timestampIndex = findHeaderIndex(headers, ["Timestamp"], 0);
  const emailIndex = findHeaderIndex(headers, ["Email Address", "Email", "Student Email"], 1);
  const spotifyLinkIndex = findHeaderIndex(
    headers,
    [
      "Please insert the Spotify song share link here:",
      "Spotify share link",
      "Spotify song share link",
      "Spotify link",
      "Song Link",
      "Track Link"
    ],
    2
  );
  const themeIndex = findHeaderIndex(
    headers,
    [
      "Theme",
      "Event Theme",
      "Request Theme",
      "Requested Theme",
      "Song Theme"
    ],
    -1
  );
  const studentNameIndex = findHeaderIndex(
    headers,
    [
      "Student Name",
      "Name",
      "Requested By",
      "Requested For"
    ],
    -1
  );

  if (spotifyLinkIndex === -1) {
    throw new Error(
      `Could not find the Spotify link column in the sheet headers: ${headers.join(" | ")}`
    );
  }

  return rows
    .slice(1)
    .filter(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => String(cell ?? "").trim() !== "")
    )
    .map((row) => ({
      timestamp: String(row[timestampIndex] ?? "").trim(),
      email: String(row[emailIndex] ?? "").trim(),
      spotifyLink: String(row[spotifyLinkIndex] ?? "").trim(),
      theme: themeIndex >= 0 ? String(row[themeIndex] ?? "").trim() : "",
      studentName: studentNameIndex >= 0 ? String(row[studentNameIndex] ?? "").trim() : "",
      source: "request"
    }))
    .filter((row) => row.spotifyLink);
}

async function enrichRequestRows(rows) {
  const rejected = getRejectedIds();
  const enriched = new Array(rows.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= rows.length) return;

      const row = rows[index];
      const requestId = buildRequestId(row);
      const trackId = extractSpotifyTrackId(row.spotifyLink);

      const result = {
        ...row,
        requestId,
        trackId,
        rejected: rejected.has(requestId),
        source: row.source || "request",
        spotify: null,
        error: null,
        moderation: null
      };

      if (!trackId) {
        result.error = "Invalid or missing Spotify track link";
        result.moderation = buildModerationMetadata(result);
        enriched[index] = result;
        continue;
      }

      try {
        const track = await getTrackByIdWithRetry(trackId);
        result.spotify = normalizeSpotifyTrack(track);
      } catch (error) {
        result.error = error?.message || "Spotify lookup failed";
      }

      result.moderation = buildModerationMetadata(result);

      enriched[index] = result;
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(CONFIG.trackLookupConcurrency, rows.length || 1)) },
    () => worker()
  );

  await Promise.all(workers);
  return enriched;
}

// ======================================================
// REQUEST SUMMARY
// ======================================================
function isApproved(requestId) {
  const queue = getApprovedQueue();
  return queue.some((item) => item.requestId === requestId);
}

function buildRequestSummary(requests) {
  const total = requests.length;
  const valid = requests.filter((r) => !!r.spotify).length;
  const clean = requests.filter((r) => r.spotify && r.spotify.explicit === false).length;
  const explicit = requests.filter((r) => r.spotify && r.spotify.explicit === true).length;
  const errors = requests.filter((r) => !r.spotify).length;
  const themeReview = requests.filter((r) => ensureModerationMetadata(r)?.themeStatus === "flagged").length;
  const themeBlocked = requests.filter((r) => ensureModerationMetadata(r)?.themeStatus === "blocked").length;

  if (el.requestSummary) {
    el.requestSummary.textContent =
      `Loaded ${total} request(s) | Valid Spotify links: ${valid} | Clean: ${clean} | Explicit: ${explicit} | Theme Review: ${themeReview} | Theme Blocked: ${themeBlocked} | Errors: ${errors}`;
  }
}

// ======================================================
// APPROVE / REJECT
// ======================================================
function approveRequest(request, options = {}) {
  const {
    silentStatus = false,
    allowExplicit = false,
    allowDuplicateTrack = false,
    selectAdded = false,
    allowThemeBlocked = false
  } = options;

  const moderation = ensureModerationMetadata(request);

  if (!request.spotify) {
    if (!silentStatus) setStatus("Cannot approve a request with no valid Spotify track.");
    return false;
  }

  if (request.spotify.explicit && !allowExplicit) {
    if (!silentStatus) setStatus("Cannot approve an explicit song.");
    return false;
  }

  if (moderation?.themeStatus === "blocked" && !allowThemeBlocked) {
    if (!silentStatus) setStatus("Cannot approve: theme contains blocked terms.");
    return false;
  }

  const queue = getApprovedQueue();
  if (
    queue.some(
      (item) =>
        item.requestId === request.requestId ||
        (!allowDuplicateTrack && item.spotify?.id && item.spotify.id === request.spotify.id)
    )
  ) {
    if (!silentStatus) setStatus("Song is already approved.");
    return false;
  }

  queue.push({
    requestId: request.requestId,
    timestamp: request.timestamp,
    email: request.email,
    spotifyLink: request.spotifyLink,
    source: request.source || "request",
    studentName: request.studentName || "",
    theme: request.theme || "",
    spotify: request.spotify,
    moderation
  });

  saveApprovedQueue(queue);
  if (selectAdded) {
    setQueuePointer(queue.length - 1);
  }

  pushModerationHistory({
    type: "approve",
    requestId: request.requestId
  });

  renderApprovedQueue();
  renderRequests(currentRequests);
  renderApprovedPreview();

  if (!silentStatus) {
    setStatus(`Approved: ${request.spotify.artist} — ${request.spotify.name}`);
  }

  return true;
}

function rejectRequest(request) {
  const rejected = getRejectedIds();
  rejected.add(request.requestId);
  saveRejectedIds(rejected);

  pushModerationHistory({
    type: "reject",
    requestId: request.requestId
  });

  renderRequests(currentRequests);
  setStatus("Request removed from unapproved list.");
}

function removeApproved(requestId) {
  return removeApprovedItem(requestId);
}

function removeApprovedItem(requestId, options = {}) {
  const { silentStatus = false, skipHistory = false } = options;

  const existingQueue = getApprovedQueue();
  const removedIndex = existingQueue.findIndex((item) => item.requestId === requestId);
  const removedItem = removedIndex >= 0 ? existingQueue[removedIndex] : null;
  const queue = existingQueue.filter((item) => item.requestId !== requestId);

  if (removedItem && !skipHistory) {
    pushModerationHistory({
      type: "remove-approved",
      index: removedIndex,
      item: removedItem
    });
  }

  saveApprovedQueue(queue);
  clampQueuePointer();
  renderApprovedQueue();
  renderRequests(currentRequests);
  renderApprovedPreview();

  if (!silentStatus) {
    setStatus("Removed song from approved list.");
  }

  return removedItem;
}

function clearApprovedQueue() {
  const queue = getApprovedQueue();

  if (!queue.length) {
    setStatus("Moderator queue is already empty.");
    return;
  }

  pushModerationHistory({
    type: "clear-approved",
    queue,
    pointer: getQueuePointer()
  });

  saveApprovedQueue([]);
  setQueuePointer(0);
  renderApprovedQueue();
  renderRequests(currentRequests);
  renderApprovedPreview();
  renderManualSearchResults();
  setStatus("Removed all songs from the moderator queue.");
}

function approveAllVisibleCleanRequests() {
  const visible = getVisibleUnapprovedRequests(currentRequests);
  const cleanVisible = visible.filter((request) => {
    const moderation = ensureModerationMetadata(request);
    return request.spotify && request.spotify.explicit === false && moderation?.themeStatus !== "blocked";
  });

  if (!cleanVisible.length) {
    setStatus("No visible clean requests to approve.");
    return;
  }

  let approvedCount = 0;
  for (const request of cleanVisible) {
    if (approveRequest(request, { silentStatus: true })) {
      approvedCount += 1;
    }
  }

  setStatus(`Approved ${approvedCount} clean visible request(s).`);
}

function undoLastModerationAction() {
  const action = moderationHistory.pop();
  if (!action) {
    setStatus("No moderation actions to undo.");
    return;
  }

  isUndoingModeration = true;

  try {
    if (action.type === "approve") {
      const queue = getApprovedQueue().filter((item) => item.requestId !== action.requestId);
      saveApprovedQueue(queue);
      clampQueuePointer();
      renderApprovedQueue();
      renderRequests(currentRequests);
      renderApprovedPreview();
      setStatus("Undid last approve action.");
      return;
    }

    if (action.type === "reject") {
      const rejected = getRejectedIds();
      rejected.delete(action.requestId);
      saveRejectedIds(rejected);
      renderRequests(currentRequests);
      setStatus("Undid last reject action.");
      return;
    }

    if (action.type === "remove-approved") {
      const queue = getApprovedQueue();
      if (!queue.some((item) => item.requestId === action.item?.requestId)) {
        const insertIndex = Math.max(0, Math.min(action.index, queue.length));
        queue.splice(insertIndex, 0, action.item);
        saveApprovedQueue(queue);
        setQueuePointer(insertIndex);
      }
      renderApprovedQueue();
      renderRequests(currentRequests);
      renderApprovedPreview();
      setStatus("Undid last remove action.");
      return;
    }

    if (action.type === "clear-approved") {
      saveApprovedQueue(Array.isArray(action.queue) ? action.queue : []);
      setQueuePointer(action.pointer || 0);
      renderApprovedQueue();
      renderRequests(currentRequests);
      renderApprovedPreview();
      renderManualSearchResults();
      setStatus("Undid remove all action.");
      return;
    }

    setStatus("No undo handler for the last action.");
  } finally {
    isUndoingModeration = false;
  }
}

// ======================================================
// RENDER HELPERS
// ======================================================
function renderManualSearchResults() {
  if (!el.manualSearchResults) return;

  if (!manualSearchResults.length) {
    el.manualSearchResults.innerHTML = `
      <div class="empty-state">
        Search Spotify to verify and add the exact track you want.
      </div>
    `;
    return;
  }

  el.manualSearchResults.innerHTML = manualSearchResults
    .map((track) => {
      const spotify = normalizeSpotifyTrack(track);
      const isExplicit = spotify?.explicit === true;
      const existingCount = countTrackInApprovedQueue(spotify?.id);
      const buttonLabel = existingCount ? `Add Again (${existingCount} queued)` : "Add to Mod Queue";
      const moderation = buildModerationMetadata({ spotify, theme: "", source: "moderator" });

      return `
        <div class="request-item">
          <div class="request-art-wrap">
            ${
              spotify?.image
                ? `<img class="request-art" src="${escapeHtml(spotify.image)}" alt="${escapeHtml(spotify.name)} cover art">`
                : `<div class="request-art request-art-placeholder">No Art</div>`
            }
          </div>

          <div class="request-main">
            <div class="request-title-row">
              <div class="request-song">${escapeHtml(spotify?.name || "Unknown track")}</div>
              <span class="badge ${isExplicit ? "badge-explicit" : "badge-clean"}">
                ${isExplicit ? "Explicit" : "Clean"}
              </span>
            </div>

            <div class="request-artist">${escapeHtml(spotify?.artist || "Unknown artist")}</div>
            <div class="request-meta">
              ${escapeHtml(spotify?.album || "Unknown Album")} • ${escapeHtml(msToMinSec(spotify?.durationMs || 0))}
            </div>
            <div class="request-submitted">Spotify track ID: ${escapeHtml(spotify?.id || "Unavailable")}</div>
            <div class="moderation-inline-note">${escapeHtml(moderation.compactReason)}</div>
          </div>

          <div class="request-actions">
            <a class="ghost-btn" href="${escapeHtml(spotify?.externalUrl || "#")}" target="_blank" rel="noopener noreferrer">
              Open in Spotify
            </a>
            <button class="search-moderation-details-btn" data-track-id="${escapeHtml(spotify?.id || "")}">
              Moderation Details
            </button>
            <button class="add-search-result-btn" data-track-id="${escapeHtml(spotify?.id || "")}">
              ${buttonLabel}
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderRequests(requests) {
  if (!el.requestTableBody) return;

  const visibleRequests = getVisibleUnapprovedRequests(requests);

  if (!visibleRequests.length) {
    el.requestTableBody.innerHTML = `
      <div class="empty-state">
        No unapproved requests available with the current filter.
      </div>
    `;
    return;
  }

  el.requestTableBody.innerHTML = visibleRequests
    .map((request) => {
      const moderation = ensureModerationMetadata(request);
      const songTitle = request.spotify?.name || "Unknown track";
      const artistName = request.spotify?.artist || "Unknown artist";
      const image = request.spotify?.image || "";
      const album = request.spotify?.album || "Unknown Album";
      const explicitClass = request.spotify
        ? request.spotify.explicit
          ? "badge-explicit"
          : "badge-clean"
        : "badge-error";

      const explicitText = request.spotify
        ? request.spotify.explicit
          ? "Explicit"
          : "Clean"
        : "Error";

      const approveDisabled =
        !request.spotify || request.spotify.explicit || moderation?.themeStatus === "blocked"
          ? "disabled"
          : "";
      const lyricsUrl = request.spotify ? buildLyricsUrl(request.spotify.artist, request.spotify.name) : "";
      const sourceLabel = getSourceLabel(request.source);

      return `
        <div class="request-item">
          <div class="request-art-wrap">
            ${
              image
                ? `<img class="request-art" src="${escapeHtml(image)}" alt="${escapeHtml(songTitle)} cover art">`
                : `<div class="request-art request-art-placeholder">No Art</div>`
            }
          </div>

          <div class="request-main">
            <div class="request-title-row">
              <div class="request-song">${escapeHtml(songTitle)}</div>
              <span class="badge ${explicitClass}">${explicitText}</span>
            </div>

            <div class="request-artist">${escapeHtml(artistName)}</div>
            <div class="request-meta">
              ${escapeHtml(album)} • ${request.spotify ? escapeHtml(msToMinSec(request.spotify.durationMs)) : "—"}
            </div>
            <div class="request-submitted">${escapeHtml(request.timestamp || "—")} • ${escapeHtml(sourceLabel)}</div>
            <div class="request-status-tags">${buildRequestStatusTags(request, moderation)}</div>
            <div class="moderation-inline-note">${escapeHtml(moderation?.compactReason || "Moderation metadata unavailable.")}</div>
          </div>

          <div class="request-actions">
            ${
              request.spotify
                ? `
                  <a class="ghost-btn" href="${escapeHtml(request.spotify.externalUrl)}" target="_blank" rel="noopener noreferrer">Open in Spotify</a>
                  ${createLyricsButtonHtml({
                    url: lyricsUrl,
                    artist: request.spotify.artist,
                    song: request.spotify.name,
                    requestId: request.requestId
                  })}
                `
                : `<span class="error-text">${escapeHtml(request.error || "No match")}</span>`
            }

            <button class="moderation-details-btn" data-request-id="${escapeHtml(request.requestId)}">
              Moderation Details
            </button>

            <button class="approve-btn" data-request-id="${escapeHtml(request.requestId)}" ${approveDisabled}>
              Approve
            </button>

            <button class="reject-btn" data-request-id="${escapeHtml(request.requestId)}">
              Reject
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderApprovedQueue() {
  if (!el.approvedQueueList) return;

  const queue = getApprovedQueue();
  clampQueuePointer();

  if (!queue.length) {
    el.approvedQueueList.innerHTML = `<div class="empty-state">No approved songs yet.</div>`;
    renderApprovedPreview();
    return;
  }

  const pointer = getQueuePointer();

  el.approvedQueueList.innerHTML = queue
    .map((item, index) => {
      const moderation = ensureModerationMetadata(item);
      const activeClass = index === pointer ? " queue-item-active" : "";
      const artist = item.spotify?.artist || "Unknown Artist";
      const name = item.spotify?.name || "Unknown Song";
      const image = item.spotify?.image || "";
      const sourceLabel = getSourceLabel(item.source);
      const sourceBadge =
        item.source === "moderator"
          ? '<span class="badge badge-override">Moderator</span>'
          : item.source === "dj-assisted"
            ? '<span class="badge badge-error">DJ Assisted</span>'
            : '<span class="badge badge-clean">Student</span>';

      const lyricsUrl = buildLyricsUrl(artist, name);

      return `
        <div class="queue-item${activeClass}" data-queue-index="${index}" data-request-id="${escapeHtml(item.requestId)}" draggable="true">
          <div class="queue-item-art-wrap">
            ${
              image
                ? `<img class="queue-item-art" src="${escapeHtml(image)}" alt="${escapeHtml(name)} cover art">`
                : `<div class="queue-item-art queue-item-art-placeholder">No Art</div>`
            }
          </div>

          <div class="queue-item-main">
            <div class="request-title-row">
              <span class="queue-drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
              <div class="queue-item-title">${escapeHtml(name)}</div>
              ${sourceBadge}
            </div>
            <div class="queue-item-artist">${escapeHtml(artist)}</div>
            <div class="request-status-tags">${buildRequestStatusTags(item, moderation)}</div>
            <div class="moderation-inline-note">${escapeHtml(sourceLabel)} • ${escapeHtml(moderation?.compactReason || "Moderation metadata unavailable.")}</div>
          </div>

          <div class="queue-item-actions">
            ${createLyricsButtonHtml({
              url: lyricsUrl,
              artist,
              song: name,
              requestId: item.requestId
            })}
            <button class="remove-approved-btn" data-request-id="${escapeHtml(item.requestId)}">
              Remove
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  renderApprovedPreview();
}

function renderApprovedPreview() {
  if (!el.approvedPreviewTable) return;

  const queue = getApprovedQueue();

  if (!queue.length) {
    el.approvedPreviewTable.innerHTML = `<div class="empty-state">No approved songs yet.</div>`;
    return;
  }

  const pointer = clampQueuePointer();
  const current = queue[pointer];

  if (!current?.spotify) {
    el.approvedPreviewTable.innerHTML = `<div class="empty-state">No approved songs yet.</div>`;
    return;
  }

  const item = current.spotify;
  const moderation = ensureModerationMetadata(current);
  const statusBadge = current.source === "moderator" ? "Moderator Override" : "Approved";
  const statusClass = current.source === "moderator" ? "badge-override" : "badge-clean";
  const lyricsUrl = buildLyricsUrl(item.artist, item.name);

  el.approvedPreviewTable.innerHTML = `
    <div class="request-item queue-item-active">
      <div class="request-art-wrap">
        ${
          item.image
            ? `<img class="request-art" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)} cover art">`
            : `<div class="request-art request-art-placeholder">No Art</div>`
        }
      </div>

      <div class="request-main">
        <div class="request-title-row">
          <div class="request-song">${escapeHtml(item.name)}</div>
          <span class="badge ${statusClass}">${statusBadge}</span>
        </div>

        <div class="request-artist">${escapeHtml(item.artist || "Unknown artist")}</div>
        <div class="request-meta">
          ${escapeHtml(item.album || "Unknown Album")} • ${escapeHtml(msToMinSec(item.durationMs))}
        </div>
        <div class="request-submitted">Selected approved track preview • ${escapeHtml(getSourceLabel(current.source))}</div>
        <div class="request-status-tags">${buildRequestStatusTags(current, moderation)}</div>
        <div class="moderation-inline-note">${escapeHtml(moderation?.compactReason || "Moderation metadata unavailable.")}</div>
      </div>

      <div class="request-actions">
        <a class="ghost-btn" href="${escapeHtml(item.externalUrl || "#")}" target="_blank" rel="noopener noreferrer">
          Open in Spotify
        </a>
        <button class="approved-moderation-details-btn" data-request-id="${escapeHtml(current.requestId)}">
          Moderation Details
        </button>
        ${createLyricsButtonHtml({
          url: lyricsUrl,
          artist: item.artist,
          song: item.name,
          requestId: current.requestId
        })}
      </div>
    </div>
  `;
}

function renderSpotifyQueue(queueData) {
  if (!el.spotifyQueueList) return;

  const currentlyPlaying = queueData?.currently_playing;
  const queue = Array.isArray(queueData?.queue) ? queueData.queue : [];

  if (!currentlyPlaying && !queue.length) {
    el.spotifyQueueList.innerHTML = `<div class="empty-state">Spotify queue is empty or unavailable.</div>`;
    return;
  }

  const blocks = [];

  if (currentlyPlaying && isTrackObject(currentlyPlaying)) {
    const currentArtist = (currentlyPlaying.artists || []).map((a) => a.name).join(", ");
    const currentLyricsUrl = buildLyricsUrl(currentArtist, currentlyPlaying.name);

    blocks.push(`
      <div class="request-item queue-item-active">
        <div class="request-art-wrap">
          ${
            currentlyPlaying.album?.images?.[0]?.url
              ? `<img class="request-art" src="${escapeHtml(currentlyPlaying.album.images[0].url)}" alt="${escapeHtml(currentlyPlaying.name)} cover art">`
              : `<div class="request-art request-art-placeholder">No Art</div>`
          }
        </div>

        <div class="request-main">
          <div class="request-title-row">
            <div class="request-song">${escapeHtml(currentlyPlaying.name)}</div>
            <span class="badge badge-clean">Now Playing</span>
          </div>

          <div class="request-artist">${escapeHtml(currentArtist || "Unknown artist")}</div>
          <div class="request-meta">
            ${escapeHtml(currentlyPlaying.album?.name || "Unknown Album")} • ${escapeHtml(msToMinSec(currentlyPlaying.duration_ms))}
          </div>
        </div>

        <div class="request-actions">
          <a class="ghost-btn" href="${escapeHtml(currentlyPlaying.external_urls?.spotify || "#")}" target="_blank" rel="noopener noreferrer">
            Open in Spotify
          </a>
          ${createLyricsButtonHtml({
            url: currentLyricsUrl,
            artist: currentArtist,
            song: currentlyPlaying.name
          })}
        </div>
      </div>
    `);
  }

  queue.forEach((item, index) => {
    if (!isTrackObject(item)) return;

    const artist = (item.artists || []).map((a) => a.name).join(", ");
    const lyricsUrl = buildLyricsUrl(artist, item.name);

    blocks.push(`
      <div class="request-item">
        <div class="request-art-wrap">
          ${
            item.album?.images?.[0]?.url
              ? `<img class="request-art" src="${escapeHtml(item.album.images[0].url)}" alt="${escapeHtml(item.name)} cover art">`
              : `<div class="request-art request-art-placeholder">No Art</div>`
          }
        </div>

        <div class="request-main">
          <div class="request-title-row">
            <div class="request-song">${escapeHtml(item.name)}</div>
            <span class="badge badge-clean">Queue #${index + 1}</span>
          </div>

          <div class="request-artist">${escapeHtml(artist || "Unknown artist")}</div>
          <div class="request-meta">
            ${escapeHtml(item.album?.name || "Unknown Album")} • ${escapeHtml(msToMinSec(item.duration_ms))}
          </div>
        </div>

        <div class="request-actions">
          <a class="ghost-btn" href="${escapeHtml(item.external_urls?.spotify || "#")}" target="_blank" rel="noopener noreferrer">
            Open in Spotify
          </a>
          ${createLyricsButtonHtml({
            url: lyricsUrl,
            artist,
            song: item.name
          })}
        </div>
      </div>
    `);
  });

  el.spotifyQueueList.innerHTML = blocks.join("");
}

// ======================================================
// PLAYBACK PREVIEW
// ======================================================
function resetNowPlayingUI() {
  if (el.nowPlaying) el.nowPlaying.textContent = "No song playing";
  if (el.nowPlayingMeta) el.nowPlayingMeta.textContent = "Start a playlist, then press Refresh.";
  if (el.nowPlayingArt) {
    el.nowPlayingArt.src = "";
    el.nowPlayingArt.style.visibility = "hidden";
  }

  currentPlaybackProgressMs = 0;
  currentPlaybackDurationMs = 0;
  currentVolumePercent = 0;
  updatePlaybackProgressUI(0, 0);
  updateVolumeUI(0);
  updatePlaybackStateLabel();
}

async function refreshPlayback() {
  if (!el.nowPlaying || !el.nowPlayingMeta) return;

  try {
    const [playbackData, queueData] = await Promise.all([
      getCurrentlyPlaying(),
      getSpotifyQueue().catch(() => null)
    ]);

    currentNowPlayingTrack = playbackData?.item || null;
    currentSpotifyQueueTracks = Array.isArray(queueData?.queue) ? queueData.queue : [];
    isPlaybackActive = !!playbackData?.is_playing;
    currentVolumePercent = Number(playbackData?.device?.volume_percent || 0);

    if (!playbackData || !playbackData.item) {
      currentNowPlayingTrack = null;
      currentSpotifyQueueTracks = [];
      currentPlaybackProgressMs = 0;
      currentPlaybackDurationMs = 0;
      isPlaybackActive = false;
      currentVolumePercent = 0;

      resetNowPlayingUI();
      renderSpotifyQueue(queueData);
      stopLocalProgressTimer();
      return;
    }

    const item = playbackData.item;
    const artists = item.artists?.map((a) => a.name).join(", ") || "Unknown Artist";
    const image =
      item.album?.images?.[0]?.url ||
      item.album?.images?.[1]?.url ||
      item.album?.images?.[2]?.url ||
      "";

    currentPlaybackProgressMs = Number(playbackData.progress_ms || 0);
    currentPlaybackDurationMs = Number(item.duration_ms || 0);

    el.nowPlaying.textContent = item.name || "Unknown Song";
    el.nowPlayingMeta.textContent =
      `${artists} | ${item.album?.name || "Unknown Album"}`;

    if (el.nowPlayingArt) {
      el.nowPlayingArt.src = image;
      el.nowPlayingArt.alt = `${item.name} cover art`;
      el.nowPlayingArt.style.visibility = image ? "visible" : "hidden";
    }

    updatePlaybackProgressUI(currentPlaybackProgressMs, currentPlaybackDurationMs);
    updateVolumeUI(currentVolumePercent);
    updatePlaybackStateLabel();
    renderSpotifyQueue(queueData);

    if (isPlaybackActive) {
      startLocalProgressTimer();
    } else {
      stopLocalProgressTimer();
    }
  } catch (error) {
    currentNowPlayingTrack = null;
    currentSpotifyQueueTracks = [];
    currentPlaybackProgressMs = 0;
    currentPlaybackDurationMs = 0;
    isPlaybackActive = false;
    currentVolumePercent = 0;

    if (el.nowPlaying) el.nowPlaying.textContent = "No song playing";
    if (el.nowPlayingMeta) {
      el.nowPlayingMeta.textContent = error?.message || "Playback unavailable";
    }

    if (el.nowPlayingArt) {
      el.nowPlayingArt.src = "";
      el.nowPlayingArt.style.visibility = "hidden";
    }

    updatePlaybackProgressUI(0, 0);
    updateVolumeUI(0);
    updatePlaybackStateLabel();
    renderSpotifyQueue(null);
    stopLocalProgressTimer();
  }
}

function moveQueuePointer(delta) {
  const queue = getApprovedQueue();
  if (!queue.length) {
    setQueuePointer(0);
    renderApprovedQueue();
    return;
  }

  let pointer = getQueuePointer() + delta;
  if (pointer < 0) pointer = 0;
  if (pointer > queue.length - 1) pointer = queue.length - 1;

  setQueuePointer(pointer);
  renderApprovedQueue();
}

function getApprovedRequestIdAtPointer() {
  const queue = getApprovedQueue();
  if (!queue.length) return null;
  const pointer = clampQueuePointer();
  return queue[pointer]?.requestId || null;
}

function clearApprovedQueueDropTargets() {
  if (!el.approvedQueueList) return;
  for (const row of el.approvedQueueList.querySelectorAll(".queue-item-drop-target")) {
    row.classList.remove("queue-item-drop-target");
  }
}

function reorderApprovedQueueByRequestId(draggedRequestId, targetRequestId) {
  if (!draggedRequestId || !targetRequestId || draggedRequestId === targetRequestId) return false;

  const queue = getApprovedQueue();
  const fromIndex = queue.findIndex((item) => item.requestId === draggedRequestId);
  const toIndex = queue.findIndex((item) => item.requestId === targetRequestId);
  if (fromIndex < 0 || toIndex < 0) return false;

  const selectedRequestId = getApprovedRequestIdAtPointer();
  const [moved] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, moved);

  saveApprovedQueue(queue);

  if (selectedRequestId) {
    const nextPointer = queue.findIndex((item) => item.requestId === selectedRequestId);
    setQueuePointer(nextPointer >= 0 ? nextPointer : 0);
  }

  renderApprovedQueue();
  renderRequests(currentRequests);
  setStatus("Reordered approved queue.");
  return true;
}

async function addSelectedApprovedToQueue() {
  const queue = getApprovedQueue();
  if (!queue.length) {
    throw new Error("No approved songs available.");
  }

  const pointer = clampQueuePointer();
  const item = queue[pointer];

  if (!item?.spotify?.uri) {
    throw new Error("Selected approved song is missing Spotify data.");
  }

  await addTrackToSpotifyQueue(item.spotify.uri);
  removeApprovedItem(item.requestId, { silentStatus: true });

  try {
    await refreshPlayback();
  } catch (error) {
    console.warn("Playback refresh after add-to-queue failed:", error);
  }

  return item;
}

function getSelectedApprovedItem() {
  const queue = getApprovedQueue();
  if (!queue.length) return null;
  const pointer = clampQueuePointer();
  return queue[pointer] || null;
}

async function addSelectedApprovedToPlaylist(playlistId) {
  const item = getSelectedApprovedItem();
  if (!item?.spotify?.uri) {
    throw new Error("Selected approved song is missing Spotify track data.");
  }

  await addTrackToPlaylist(playlistId, item.spotify.uri);
  return item;
}

async function addDjAssistedRequestFromForm() {
  const studentName = String(el.djStudentNameInput?.value || "").trim();
  const theme = String(el.djThemeInput?.value || "").trim();
  const spotifyLinkInput = String(el.djSpotifyLinkInput?.value || "").trim();

  const trackId = extractSpotifyTrackId(spotifyLinkInput);
  if (!trackId) {
    throw new Error("Please paste a valid Spotify track link for the DJ-assisted request.");
  }

  const spotifyLink = spotifyTrackUrl(trackId);
  const djRows = getDjAssistedRequests();
  const row = createDjAssistedRawRow({
    studentName,
    theme,
    spotifyLink
  });

  djRows.unshift(row);
  saveDjAssistedRequests(djRows);

  if (el.djStudentNameInput) el.djStudentNameInput.value = "";
  if (el.djThemeInput) el.djThemeInput.value = "";
  if (el.djSpotifyLinkInput) el.djSpotifyLinkInput.value = "";

  await loadRequests();
  setStatus("DJ-assisted request added and loaded for moderation.");
}

function badgeClassForRecommendation(moderation) {
  if (moderation?.recommendation === "block") return "badge-explicit";
  if (moderation?.recommendation === "review") return "badge-error";
  return "badge-clean";
}

function statusTagToneForTheme(themeStatus) {
  if (themeStatus === "blocked") return "danger";
  if (themeStatus === "flagged") return "warn";
  if (themeStatus === "clear") return "ok";
  return "neutral";
}

function statusTagToneForRecommendation(recommendation) {
  if (recommendation === "block") return "danger";
  if (recommendation === "review") return "warn";
  return "ok";
}

function statusTagHtml(label, tone = "neutral") {
  return `<span class="mod-status-tag mod-status-tag-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function getLyricsFetchStatusTag(requestId) {
  const key = String(requestId || "").trim();
  const state = key ? lyricsFetchStateByRequestId.get(key) : null;

  if (!key) {
    return {
      label: "Lyrics: Not Tracked",
      tone: "neutral",
      detail: "This row is not tied to a moderation request ID."
    };
  }

  if (!state || !state.state) {
    return {
      label: "Lyrics: Not Fetched",
      tone: "neutral",
      detail: "Lyrics have not been fetched for this request yet."
    };
  }

  if (state.state === "loading") {
    return {
      label: "Lyrics: Fetching",
      tone: "info",
      detail: "Lyrics request is currently in progress."
    };
  }

  if (state.state === "success") {
    return {
      label: "Lyrics: Fetched",
      tone: "ok",
      detail: state.detail || "Live lyrics were fetched from the configured API."
    };
  }

  if (state.state === "fallback") {
    return {
      label: "Lyrics: API Fallback",
      tone: "warn",
      detail: state.detail || "Lyrics API fallback was used."
    };
  }

  return {
    label: "Lyrics: Fetch Failed",
    tone: "danger",
    detail: state.detail || "Lyrics request failed."
  };
}

function setLyricsFetchStatus(requestId, state, detail = "") {
  const key = String(requestId || "").trim();
  if (!key) return;

  lyricsFetchStateByRequestId.set(key, {
    state: String(state || "").trim() || "unknown",
    detail: String(detail || "").trim(),
    updatedAt: new Date().toISOString()
  });
}

function buildRequestStatusTags(request, moderation) {
  const spotifyTag = request?.spotify
    ? statusTagHtml("Spotify: Found", "ok")
    : statusTagHtml("Spotify: Missing", "danger");

  const explicitTone = moderation?.explicitStatus === "explicit"
    ? "danger"
    : moderation?.explicitStatus === "clean"
      ? "ok"
      : "neutral";

  const explicitTag = statusTagHtml(`Explicit: ${moderation?.explicitLabel || "Unknown"}`, explicitTone);
  const themeTag = statusTagHtml(`Theme: ${moderation?.themeLabel || "No Theme"}`, statusTagToneForTheme(moderation?.themeStatus));
  const recTag = statusTagHtml(`Decision: ${moderation?.recommendationLabel || "Manual Review"}`, statusTagToneForRecommendation(moderation?.recommendation));

  const lyricsStatus = getLyricsFetchStatusTag(request?.requestId);
  const lyricsTag = statusTagHtml(lyricsStatus.label, lyricsStatus.tone);

  return `${spotifyTag}${explicitTag}${themeTag}${recTag}${lyricsTag}`;
}

function moderationReasonHtml(request, moderation) {
  const safeTheme = String(request?.theme || "").trim() || "No theme submitted";
  const safeStudent = String(request?.studentName || "").trim() || "Not provided";
  const themeTerms = Array.isArray(moderation?.themeTerms) && moderation.themeTerms.length
    ? moderation.themeTerms.join(", ")
    : "None";
  const themePolicyHits = Array.isArray(moderation?.themePolicyHits) ? moderation.themePolicyHits : [];
  const policySummary = Array.isArray(moderation?.themePolicySummary) ? moderation.themePolicySummary : [];
  const lyricsStatus = getLyricsFetchStatusTag(request?.requestId);
  const spotifySummary = request?.spotify
    ? "Spotify track lookup succeeded and metadata was found."
    : "Spotify track lookup failed or the submitted link was invalid.";

  const detailTags = [
    statusTagHtml(`Recommendation: ${moderation?.recommendationLabel || "Manual Review"}`, statusTagToneForRecommendation(moderation?.recommendation)),
    statusTagHtml(`Spotify: ${request?.spotify ? "Found" : "Missing"}`, request?.spotify ? "ok" : "danger"),
    statusTagHtml(`Explicit: ${moderation?.explicitLabel || "Unknown"}`, moderation?.explicitStatus === "explicit" ? "danger" : moderation?.explicitStatus === "clean" ? "ok" : "neutral"),
    statusTagHtml(`Theme: ${moderation?.themeLabel || "No Theme"}`, statusTagToneForTheme(moderation?.themeStatus)),
    statusTagHtml(lyricsStatus.label, lyricsStatus.tone)
  ].join("");

  const summaryRows = policySummary.length
    ? policySummary
      .map((entry) => `
        <div class="moderation-reason-item">
          <div class="moderation-reason-label">${escapeHtml(entry.severity.toUpperCase())} • ${escapeHtml(entry.category)}</div>
          <div class="moderation-reason-value">${escapeHtml(entry.count)} hit(s) • Fields: ${escapeHtml(entry.fields.join(", "))}</div>
          <div class="moderation-inline-note">Matches: ${escapeHtml(entry.matches.join(", "))}</div>
        </div>
      `)
      .join("")
    : "<div class=\"empty-state\">No policy hits were detected for this request.</div>";

  const hitRows = themePolicyHits.length
    ? themePolicyHits
      .map((hit) => `
        <tr>
          <td>${escapeHtml(hit.severity)}</td>
          <td>${escapeHtml(hit.category)}</td>
          <td>${escapeHtml(hit.field)}</td>
          <td>${escapeHtml(hit.matchType)}</td>
          <td>${escapeHtml(hit.matchedText)}</td>
        </tr>
      `)
      .join("")
    : "<tr><td colspan=\"5\">No keyword or phrase matches.</td></tr>";

  return `
    <div class="moderation-reason-section">
      <h3>Status Tags</h3>
      <div class="request-status-tags moderation-tags-wrap">
        ${detailTags}
      </div>
    </div>

    <div class="moderation-reason-grid">
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Source</div>
        <div class="moderation-reason-value">${escapeHtml(getSourceLabel(request?.source))}</div>
      </div>
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Student Name</div>
        <div class="moderation-reason-value">${escapeHtml(safeStudent)}</div>
      </div>
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Theme Submitted</div>
        <div class="moderation-reason-value">${escapeHtml(safeTheme)}</div>
      </div>
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Confidence</div>
        <div class="moderation-reason-value">${escapeHtml(moderation?.confidence || "Medium")}</div>
      </div>
    </div>

    <div class="moderation-reason-callout">
      <span class="badge ${badgeClassForRecommendation(moderation)}">${escapeHtml(moderation?.recommendationLabel || "Review")}</span>
      <p>${escapeHtml(moderation?.recommendationReason || "Manual review recommended.")}</p>
    </div>

    <div class="moderation-reason-section">
      <h3>Decision Summary</h3>
      <ul class="moderation-reason-list">
        <li>${escapeHtml(spotifySummary)}</li>
        <li>${escapeHtml(moderation?.explicitReason || "No explicit reasoning available.")}</li>
        <li>${escapeHtml(moderation?.themeReason || "No theme reasoning available.")}</li>
        <li>${escapeHtml(lyricsStatus.detail || "Lyrics have not been fetched for this request.")}</li>
      </ul>
      <p class="moderation-inline-note">Matched terms: ${escapeHtml(themeTerms)}</p>
    </div>

    <div class="moderation-reason-section">
      <h3>Policy Category Summary</h3>
      <div class="moderation-reason-grid moderation-reason-grid-full">
        ${summaryRows}
      </div>
    </div>

    <details class="moderation-reason-details">
      <summary>Detailed Keyword / Phrase Hits (${themePolicyHits.length})</summary>
      <div class="moderation-reason-table-wrap">
        <table class="moderation-reason-table" aria-label="Moderation policy hit details">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Category</th>
              <th>Field</th>
              <th>Type</th>
              <th>Matched Text</th>
            </tr>
          </thead>
          <tbody>
            ${hitRows}
          </tbody>
        </table>
      </div>
    </details>

    <div class="moderation-reason-footnote">
      Evaluated at ${escapeHtml(formatTimestamp(moderation?.evaluatedAt) || String(moderation?.evaluatedAt || "now"))}
    </div>
  `;
}

function openModerationReasonModal(request) {
  if (!request || !el.moderationReasonModal || !el.moderationReasonBackdrop || !el.moderationReasonBody) return;

  const moderation = ensureModerationMetadata(request);
  const songName = request?.spotify?.name || "Unknown Song";

  moderationDetailContext = request;
  if (el.moderationReasonTitle) {
    el.moderationReasonTitle.textContent = `${songName} - Moderation Analysis`;
  }

  el.moderationReasonBody.innerHTML = moderationReasonHtml(request, moderation);
  el.moderationReasonBackdrop.classList.add("moderation-reason-is-open");
  el.moderationReasonModal.classList.add("moderation-reason-is-open");
}

function closeModerationReasonModal() {
  if (!el.moderationReasonModal || !el.moderationReasonBackdrop) return;
  moderationDetailContext = null;
  el.moderationReasonBackdrop.classList.remove("moderation-reason-is-open");
  el.moderationReasonModal.classList.remove("moderation-reason-is-open");
}

function openModerationDetailsByRequestId(requestId) {
  const request =
    currentRequests.find((item) => item.requestId === requestId) ||
    getApprovedQueue().find((item) => item.requestId === requestId);

  if (!request) {
    setStatus("Could not find request details for moderation reasoning.");
    return;
  }

  openModerationReasonModal(request);
}

function openModerationDetailsByTrackId(trackId) {
  const track = manualSearchResults.find((item) => item.id === trackId);
  if (!track) {
    setStatus("Selected search result is no longer available for moderation details.");
    return;
  }

  const request = {
    requestId: `preview|${track.id}`,
    timestamp: "Search preview",
    source: "moderator",
    studentName: "",
    theme: "",
    spotify: normalizeSpotifyTrack(track)
  };
  request.moderation = buildModerationMetadata(request);

  openModerationReasonModal(request);
}

function closeLyricsModal() {
  if (!el.lyricsModal || !el.lyricsBackdrop) return;
  el.lyricsBackdrop.classList.remove("lyrics-is-open");
  el.lyricsModal.classList.remove("lyrics-is-open");
}

function renderLyricsFallbackContent({ artist, song, fallbackUrl, reason }) {
  if (!el.lyricsModalBody || !el.lyricsModalExternalLink) return;

  el.lyricsModalExternalLink.href = fallbackUrl;
  el.lyricsModalBody.innerHTML = `
    <div class="lyrics-fallback">
      <p class="lyrics-fallback-title">Live lyrics unavailable from API.</p>
      <p class="lyrics-fallback-copy">${escapeHtml(reason || "The API did not return lyrics.")}</p>
      <p class="lyrics-fallback-copy">
        GitHub Pages cannot run Python directly. To use live lyric scraping in-app,
        host the Python endpoint separately and set CONFIG.lyricsApiBaseUrl.
      </p>
      <a class="btn btn-small btn-primary" href="${escapeHtml(fallbackUrl)}" target="_blank" rel="noopener noreferrer">
        Open Musixmatch Page
      </a>
      <p class="lyrics-fallback-copy">Track: ${escapeHtml(artist)} - ${escapeHtml(song)}</p>
    </div>
  `;
}

function renderLyricsLoading() {
  if (!el.lyricsModalBody) return;
  el.lyricsModalBody.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';
}

function renderLyricsSuccess({ lyrics, selectorUsed, source }) {
  if (!el.lyricsModalBody) return;

  el.lyricsModalBody.innerHTML = `
    <div class="lyrics-success-wrap">
      <pre class="lyrics-text-pre">${escapeHtml(lyrics)}</pre>
      <p class="lyrics-fallback-copy">Source: ${escapeHtml(source || "Lyrics API")} ${selectorUsed ? `• Selector: ${escapeHtml(selectorUsed)}` : ""}</p>
    </div>
  `;
}

async function openLyricsModal({ artist, song, fallbackUrl, requestId = "" }) {
  if (!el.lyricsModal || !el.lyricsBackdrop || !el.lyricsModalTitle || !el.lyricsModalMeta) {
    window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const safeArtist = String(artist || "Unknown Artist").trim() || "Unknown Artist";
  const safeSong = String(song || "Unknown Song").trim() || "Unknown Song";
  const safeFallbackUrl = String(fallbackUrl || buildLyricsUrl(safeArtist, safeSong));
  const safeRequestId = String(requestId || "").trim();

  if (safeRequestId) {
    setLyricsFetchStatus(safeRequestId, "loading");
    renderRequests(currentRequests);
    renderApprovedQueue();
  }

  el.lyricsModalTitle.textContent = safeSong;
  el.lyricsModalMeta.textContent = safeArtist;
  if (el.lyricsModalExternalLink) {
    el.lyricsModalExternalLink.href = safeFallbackUrl;
  }

  renderLyricsLoading();
  el.lyricsBackdrop.classList.add("lyrics-is-open");
  el.lyricsModal.classList.add("lyrics-is-open");

  const result = await fetchLyricsFromApi(safeArtist, safeSong);
  if (!result.ok) {
    if (safeRequestId) {
      const fallbackState = result.status === "api-error" || result.status === "empty" || result.status === "not-configured"
        ? "fallback"
        : "error";
      setLyricsFetchStatus(safeRequestId, fallbackState, result.reason || "Lyrics API did not return live lyrics.");
      renderRequests(currentRequests);
      renderApprovedQueue();
      if (moderationDetailContext?.requestId === safeRequestId) {
        openModerationReasonModal(moderationDetailContext);
      }
    }

    renderLyricsFallbackContent({
      artist: safeArtist,
      song: safeSong,
      fallbackUrl: safeFallbackUrl,
      reason: result.reason
    });
    return;
  }

  if (safeRequestId) {
    setLyricsFetchStatus(safeRequestId, "success", `Live lyrics fetched from ${result.source || "Lyrics API"}.`);
    renderRequests(currentRequests);
    renderApprovedQueue();
    if (moderationDetailContext?.requestId === safeRequestId) {
      openModerationReasonModal(moderationDetailContext);
    }
  }

  renderLyricsSuccess(result);
}

async function runManualTrackSearch() {
  const query = String(el.manualSearchInput?.value || "").trim();

  if (!query) {
    manualSearchResults = [];
    renderManualSearchResults();
    setStatus("Enter a song or artist to search Spotify.");
    return;
  }

  setStatus(`Searching Spotify for "${query}"...`);

  const tracks = await searchSpotifyTracks(query);
  manualSearchResults = tracks;
  renderManualSearchResults();

  if (!tracks.length) {
    setStatus("No Spotify tracks matched that search.");
    return;
  }

  setStatus(`Found ${tracks.length} Spotify track(s). Review the exact result before adding.`);
}

async function addManualSearchResultToQueue(trackId) {
  const track = manualSearchResults.find((item) => item.id === trackId);

  if (!track) {
    setStatus("Selected search result is no longer available.");
    return;
  }

  setStatus("Verifying selected Spotify track before adding...");

  let verifiedTrack;
  try {
    verifiedTrack = await getTrackByIdWithRetry(trackId);
  } catch (error) {
    setStatus(error?.message || "Could not verify the selected Spotify track.");
    return;
  }

  const request = createManualApprovedRequest(verifiedTrack);
  const wasApproved = approveRequest(request, {
    silentStatus: true,
    allowExplicit: true,
    allowDuplicateTrack: true,
    selectAdded: true
  });

  if (!wasApproved) {
    setStatus("That Spotify track could not be added to the moderator queue.");
    renderManualSearchResults();
    return;
  }

  renderManualSearchResults();
  setStatus(`Moderator override added: ${request.spotify.artist} — ${request.spotify.name}`);
}

// ======================================================
// LOAD REQUESTS
// ======================================================
async function loadRequests() {
  setStatus("Loading request rows from Google Sheet and DJ local storage...");

  let sheetRows = [];
  let sheetError = null;

  try {
    sheetRows = await fetchStudentRequestRows();
  } catch (error) {
    sheetError = error;
    console.warn("Sheet request load failed:", error);
  }

  const djRows = getDjAssistedRequests();
  const rawRows = [...djRows, ...sheetRows];

  if (!rawRows.length && sheetError) {
    throw sheetError;
  }

  setStatus(`Loaded ${rawRows.length} raw request row(s). Looking up Spotify tracks...`);

  const enriched = await enrichRequestRows(rawRows);
  currentRequests = enriched;

  buildRequestSummary(enriched);
  renderRequests(enriched);
  renderApprovedQueue();

  if (sheetError) {
    setStatus(`Loaded ${enriched.length} request(s). Google Sheet was unavailable, DJ local requests are still active.`);
    return;
  }

  setStatus(`Finished loading ${enriched.length} request(s).`);
}

// ======================================================
// MODERATION PANEL
// ======================================================
function openModerationPanel() {
  document.getElementById("modOverlay")?.classList.add("mod-is-open");
  document.getElementById("modBackdrop")?.classList.add("mod-is-open");
  document.body.classList.add("mod-panel-open");
}

function closeModerationPanel() {
  document.getElementById("modOverlay")?.classList.remove("mod-is-open");
  document.getElementById("modBackdrop")?.classList.remove("mod-is-open");
  document.body.classList.remove("mod-panel-open");
  closeModerationReasonModal();
  closeLyricsModal();
}

// ======================================================
// EVENT WIRING
// ======================================================
function wireStaticEvents() {
  el.btnLogin?.addEventListener("click", async () => {
    try {
      await loginToSpotify();
    } catch (error) {
      setStatus(error?.message || "Spotify login failed.");
    }
  });

  el.btnLogout?.addEventListener("click", () => {
    logoutSpotify();
  });

  el.btnLoadRequests?.addEventListener("click", async () => {
    try {
      await loadRequests();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Failed to load requests.");
    }
  });

  el.btnRefreshPlayback?.addEventListener("click", async () => {
    try {
      await refreshPlayback();
      setStatus("Player refreshed.");
    } catch (error) {
      setStatus(error?.message || "Failed to refresh playback.");
    }
  });

  el.btnStartDefaultPlaylist?.addEventListener("click", async () => {
    try {
      await startDefaultPlaylist();
      setStatus("Main playlist started.");
      await refreshPlayback();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not start main playlist.");
    }
  });

  el.btnStartSlowPlaylist?.addEventListener("click", async () => {
    try {
      await startSlowPlaylist();
      setStatus("Slow playlist started.");
      await refreshPlayback();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not start slow playlist.");
    }
  });

  el.btnStartFunPlaylist?.addEventListener("click", async () => {
    try {
      await startFunPlaylist();
      setStatus("Fun playlist started.");
      await refreshPlayback();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not start fun playlist.");
    }
  });

  el.btnAddApprovedToQueue?.addEventListener("click", async () => {
    try {
      const item = await addSelectedApprovedToQueue();
      setStatus(
        `Added to queue: ${item?.spotify?.artist || "Unknown Artist"} — ${item?.spotify?.name || "Unknown Song"}`
      );
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not add approved song to queue.");
    }
  });

  el.btnPrevQueue?.addEventListener("click", () => {
    moveQueuePointer(-1);
  });

  el.btnNextQueue?.addEventListener("click", () => {
    moveQueuePointer(1);
  });

  el.btnApproveAllCleanVisible?.addEventListener("click", () => {
    approveAllVisibleCleanRequests();
  });

  el.btnRemoveAllApproved?.addEventListener("click", () => {
    clearApprovedQueue();
  });

  el.btnUndoModerationAction?.addEventListener("click", () => {
    undoLastModerationAction();
  });

  el.btnSearchSongs?.addEventListener("click", async () => {
    try {
      await runManualTrackSearch();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Spotify search failed.");
    }
  });

  el.btnAddDjAssistedRequest?.addEventListener("click", async () => {
    try {
      await addDjAssistedRequestFromForm();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not add DJ-assisted request.");
    }
  });

  el.djSpotifyLinkInput?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    try {
      await addDjAssistedRequestFromForm();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not add DJ-assisted request.");
    }
  });

  el.manualSearchInput?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    try {
      await runManualTrackSearch();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Spotify search failed.");
    }
  });

  el.hideExplicitOnly?.addEventListener("change", () => {
    renderRequests(currentRequests);
  });

  el.requestTableBody?.addEventListener("click", async (event) => {
    const approveButton = event.target.closest(".approve-btn");
    const rejectButton = event.target.closest(".reject-btn");
    const moderationDetailsButton = event.target.closest(".moderation-details-btn");

    if (moderationDetailsButton) {
      openModerationDetailsByRequestId(moderationDetailsButton.dataset.requestId || "");
      return;
    }

    if (approveButton) {
      const requestId = approveButton.dataset.requestId;
      const request = currentRequests.find((r) => r.requestId === requestId);
      if (request) approveRequest(request);
      return;
    }

    if (rejectButton) {
      const requestId = rejectButton.dataset.requestId;
      const request = currentRequests.find((r) => r.requestId === requestId);
      if (request) rejectRequest(request);
    }
  });

  el.approvedQueueList?.addEventListener("click", async (event) => {
    const removeButton = event.target.closest(".remove-approved-btn");
    const queueItem = event.target.closest(".queue-item[data-queue-index]");

    if (removeButton) {
      removeApproved(removeButton.dataset.requestId);
      return;
    }

    if (queueItem) {
      const index = Number(queueItem.dataset.queueIndex);
      if (Number.isFinite(index)) {
        setQueuePointer(index);
        renderApprovedQueue();
      }
    }
  });

  el.approvedQueueList?.addEventListener("dragstart", (event) => {
    const queueItem = event.target.closest(".queue-item[data-request-id]");
    if (!queueItem) return;

    draggingApprovedRequestId = queueItem.dataset.requestId || null;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggingApprovedRequestId || "");
    queueItem.classList.add("queue-item-dragging");
  });

  el.approvedQueueList?.addEventListener("dragover", (event) => {
    if (!draggingApprovedRequestId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    clearApprovedQueueDropTargets();
    const queueItem = event.target.closest(".queue-item[data-request-id]");
    if (queueItem && queueItem.dataset.requestId !== draggingApprovedRequestId) {
      queueItem.classList.add("queue-item-drop-target");
    }
  });

  el.approvedQueueList?.addEventListener("drop", (event) => {
    event.preventDefault();
    const queueItem = event.target.closest(".queue-item[data-request-id]");
    const targetRequestId = queueItem?.dataset.requestId || "";

    clearApprovedQueueDropTargets();
    for (const row of el.approvedQueueList.querySelectorAll(".queue-item-dragging")) {
      row.classList.remove("queue-item-dragging");
    }

    if (draggingApprovedRequestId && targetRequestId) {
      reorderApprovedQueueByRequestId(draggingApprovedRequestId, targetRequestId);
    }
    draggingApprovedRequestId = null;
  });

  el.approvedQueueList?.addEventListener("dragend", () => {
    clearApprovedQueueDropTargets();
    for (const row of el.approvedQueueList.querySelectorAll(".queue-item-dragging")) {
      row.classList.remove("queue-item-dragging");
    }
    draggingApprovedRequestId = null;
  });

  el.manualSearchResults?.addEventListener("click", async (event) => {
    const detailButton = event.target.closest(".search-moderation-details-btn");
    if (detailButton) {
      openModerationDetailsByTrackId(detailButton.dataset.trackId || "");
      return;
    }

    const addButton = event.target.closest(".add-search-result-btn");
    if (!addButton) return;

    try {
      await addManualSearchResultToQueue(addButton.dataset.trackId || "");
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Moderator add failed.");
    }
  });

  el.approvedPreviewTable?.addEventListener("click", (event) => {
    const detailButton = event.target.closest(".approved-moderation-details-btn");
    if (!detailButton) return;

    openModerationDetailsByRequestId(detailButton.dataset.requestId || "");
  });

  el.btnAddSelectedToMainPlaylist?.addEventListener("click", async () => {
    try {
      const item = await addSelectedApprovedToPlaylist(CONFIG.defaultPlaylistId);
      setStatus(`Added to Main playlist: ${item?.spotify?.artist || "Unknown Artist"} - ${item?.spotify?.name || "Unknown Song"}`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not add selected song to Main playlist.");
    }
  });

  el.btnAddSelectedToSlowPlaylist?.addEventListener("click", async () => {
    try {
      const item = await addSelectedApprovedToPlaylist(CONFIG.slowPlaylistId);
      setStatus(`Added to Slow playlist: ${item?.spotify?.artist || "Unknown Artist"} - ${item?.spotify?.name || "Unknown Song"}`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not add selected song to Slow playlist.");
    }
  });

  el.btnAddSelectedToFunPlaylist?.addEventListener("click", async () => {
    try {
      const item = await addSelectedApprovedToPlaylist(CONFIG.funPlaylistId);
      setStatus(`Added to Fun playlist: ${item?.spotify?.artist || "Unknown Artist"} - ${item?.spotify?.name || "Unknown Song"}`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not add selected song to Fun playlist.");
    }
  });

  el.btnOpenModeration?.addEventListener("click", () => openModerationPanel());
  document.getElementById("btnCloseModeration")?.addEventListener("click", () => closeModerationPanel());
  document.getElementById("modBackdrop")?.addEventListener("click", () => closeModerationPanel());
  el.btnCloseModerationReason?.addEventListener("click", () => closeModerationReasonModal());
  el.moderationReasonBackdrop?.addEventListener("click", () => closeModerationReasonModal());
  el.btnCloseLyricsModal?.addEventListener("click", () => closeLyricsModal());
  el.lyricsBackdrop?.addEventListener("click", () => closeLyricsModal());

  el.btnNowPlayingLyrics?.addEventListener("click", () => {
    if (!currentNowPlayingTrack) {
      setStatus("No active track is currently playing.");
      return;
    }

    const artist = (currentNowPlayingTrack.artists || []).map((a) => a.name).join(", ");
    const title = currentNowPlayingTrack.name || "Unknown Song";
    const url = buildLyricsUrl(artist, title);
    openLyricsModal({ artist, song: title, fallbackUrl: url }).catch((error) => {
      console.error(error);
      window.open(url, "_blank", "noopener,noreferrer");
    });
  });

  document.addEventListener("click", (event) => {
    const lyricsButton = event.target.closest(".btn-lyrics-fetch");
    if (!lyricsButton) return;

    const artist = String(lyricsButton.dataset.lyricsArtist || "");
    const song = String(lyricsButton.dataset.lyricsSong || "");
    const fallbackUrl = String(lyricsButton.dataset.lyricsUrl || buildLyricsUrl(artist, song));
    const requestId = String(lyricsButton.dataset.lyricsRequestId || "");

    openLyricsModal({ artist, song, fallbackUrl, requestId }).catch((error) => {
      console.error(error);
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    });
  });

  el.btnPrevTrack?.addEventListener("click", async () => {
    try {
      setTransportBusy(true);
      await skipToPreviousTrack();
      setStatus("Skipped to previous track.");
      await wait(500);
      await refreshPlayback();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not go to previous track.");
    } finally {
      setTransportBusy(false);
    }
  });

  el.btnPlayPause?.addEventListener("click", async () => {
    try {
      setTransportBusy(true);
      await togglePlayPause();
      await wait(350);
      await refreshPlayback();
      setStatus(isPlaybackActive ? "Playback resumed." : "Playback paused.");
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not toggle playback.");
    } finally {
      setTransportBusy(false);
    }
  });

  el.btnNextTrack?.addEventListener("click", async () => {
    try {
      setTransportBusy(true);
      await skipToNextTrack();
      setStatus("Skipped to next track.");
      await wait(500);
      await refreshPlayback();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not go to next track.");
    } finally {
      setTransportBusy(false);
    }
  });

  el.nowPlayingSeekTrack?.addEventListener("click", async (event) => {
    if (!currentNowPlayingTrack || currentPlaybackDurationMs <= 0) return;

    try {
      const rect = el.nowPlayingSeekTrack.getBoundingClientRect();
      const clickPosition = event.clientX - rect.left;
      const percent = rect.width > 0 ? Math.max(0, Math.min(1, clickPosition / rect.width)) : 0;
      const nextProgressMs = Math.floor(currentPlaybackDurationMs * percent);

      updatePlaybackProgressUI(nextProgressMs, currentPlaybackDurationMs);
      await seekPlayback(nextProgressMs);
      currentPlaybackProgressMs = nextProgressMs;
      setStatus(`Seeked to ${msToMinSec(nextProgressMs)}.`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not seek playback.");
      await refreshPlayback();
    }
  });

  el.nowPlayingVolumeTrack?.addEventListener("click", async (event) => {
    try {
      const rect = el.nowPlayingVolumeTrack.getBoundingClientRect();
      const clickPosition = event.clientX - rect.left;
      const percent = rect.width > 0 ? Math.max(0, Math.min(100, (clickPosition / rect.width) * 100)) : 0;

      updateVolumeUI(percent);
      await setPlaybackVolume(percent);
      setStatus(`Volume set to ${Math.round(percent)}%.`);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not change playback volume.");
      await refreshPlayback();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (el.lyricsModal?.classList.contains("lyrics-is-open")) {
        closeLyricsModal();
        return;
      }
      if (el.moderationReasonModal?.classList.contains("moderation-reason-is-open")) {
        closeModerationReasonModal();
        return;
      }
      closeModerationPanel();
    }
  });
}

// ======================================================
// AUTO REFRESH PLAYBACK
// ======================================================
function startPlaybackPolling() {
  stopPlaybackPolling();

  playbackTimer = window.setInterval(async () => {
    try {
      await refreshPlayback();
    } catch (error) {
      console.warn("Playback poll failed:", error);
    }
  }, CONFIG.playbackPollMs);
}

function stopPlaybackPolling() {
  if (playbackTimer) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
}

// ======================================================
// INIT
// ======================================================
async function init() {
  clearLegacyAuthStorage();
  ensureStorageDefaults();
  wireStaticEvents();
  renderApprovedQueue();
  renderApprovedPreview();
  renderManualSearchResults();
  buildRequestSummary([]);
  resetNowPlayingUI();

  await handleSpotifyCallback();

  let hasActiveSpotifyLogin = false;

  try {
    const me = await getCurrentUserProfile();
    hasActiveSpotifyLogin = true;

    if (me?.display_name) {
      setStatus(`Ready. Logged in as ${me.display_name}.`);
    } else {
      setStatus("Ready.");
    }
  } catch {
    setStatus("Ready.");
  }

  try {
    await refreshPlayback();
  } catch (error) {
    console.warn("Initial playback refresh failed:", error);
  }

  if (hasActiveSpotifyLogin || !!authGet(LS.accessToken)) {
    startPlaybackPolling();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || "App failed to initialize.");
  });
});
