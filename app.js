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
  redirectUriFallback: "https://nbaker9262.github.io/American-Leadership-Academy-Music-Queue/",
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
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-public",
    "playlist-modify-private"
  ],
  playbackPollMs: 2500,
  localProgressTickMs: 250,
  transportSyncDelaysMs: [120, 420, 950],
  trackLookupConcurrency: 5,
  trackLookupRetryCount: 2,
  trackLookupRetryDelayMs: 500,
  manualSearchLimit: 8,
  userPlaylistFetchLimit: 50,
  playlistPickerCacheMs: 120000,
  lyricsApiBaseUrl: "",
  lyricsApiTimeoutMs: 12000,
  // Cache is a fallback only (backup).
  lyricsCacheUseOnLoad: false,
  lyricsCacheUrl: "lyrics-cache.json",
  lyricsCacheRefreshMinutes: 5,
  lyricsCacheAutoRefresh: false,
  requestAutoSyncMinutes: 5,
  // Live scraper (Raspberry Pi) is the primary path.
  // Keep concurrency conservative for Pi Zero 2 W.
  lyricsPrefetchOnLoad: true,
  lyricsPrefetchConcurrency: 1,
  lyricsPrefetchMaxSongsPerLoad: 30,
  lyricsPrefetchDelayMs: 300,
  debugModeration: false,
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
      terms: ["damn", "hell", "sucks", "freakin", "shit", "bitch", "ass", "fuck", "motherfucker"],
      phrases: ["lose my mind", "out of control", "shut up", "f you", "f*** you", "middle finger"]
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
  spotifyScopesFingerprint: "ala_dash_spotify_scopes_fingerprint",
  approvedQueue: "ala_approved_queue",
  rejectedIds: "ala_rejected_ids",
  queuePointer: "ala_queue_pointer",
  djAssistedRequests: "ala_dj_assisted_requests",
  moderationOverrides: "ala_moderation_overrides",
  requestAutoSyncEnabled: "ala_request_auto_sync_enabled",
  playlistBuilderPlaylistId: "ala_playlist_builder_playlist_id",
  playlistBuilderPlaylistName: "ala_playlist_builder_playlist_name"
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

function getRequiredSpotifyScopesFingerprint() {
  return `${CONFIG.clientId}::${CONFIG.scopes.join(" ")}`;
}

function enforceSpotifyScopesFingerprint() {
  const required = getRequiredSpotifyScopesFingerprint();
  const stored = String(persistentStorage.getItem(LS.spotifyScopesFingerprint) || "");

  if (stored === required) {
    return;
  }

  persistentStorage.setItem(LS.spotifyScopesFingerprint, required);

  const hasAuth = !!authGet(LS.accessToken) || !!authGet(LS.refreshToken);
  if (hasAuth) {
    authRemove(LS.accessToken);
    authRemove(LS.refreshToken);
    authRemove(LS.expiresAt);
    authRemove(LS.pkceVerifier);
    authRemove(LS.oauthState);
    stopPlaybackPolling();
    stopLocalProgressTimer();
    stopRequestAutoSyncTimer();
    setRequestAutoSyncStatus("Permissions updated. Please Login again.", "warn");
    setNextRequestSyncStatus("Next sync: login required");
    setStatus("Spotify permissions updated. Click Login to continue.");
  }
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
  btnPlayPlaylistPicker: document.getElementById("btnPlayPlaylistPicker"),
  btnOpenPlaylistBuilder: document.getElementById("btnOpenPlaylistBuilder"),
  btnAddApprovedToQueue: document.getElementById("btnAddApprovedToQueue"),
  btnApproveAllCleanVisible: document.getElementById("btnApproveAllCleanVisible"),
  btnRemoveAllApproved: document.getElementById("btnRemoveAllApproved"),
  btnUndoModerationAction: document.getElementById("btnUndoModerationAction"),
  btnOpenModeration: document.getElementById("btnOpenModeration"),
  btnCloseModeration: document.getElementById("btnCloseModeration"),
  btnSearchSongs: document.getElementById("btnSearchSongs"),
  btnNowPlayingLyrics: document.getElementById("btnNowPlayingLyrics"),
  btnPrevTrack: document.getElementById("btnPrevTrack"),
  btnPlayPause: document.getElementById("btnPlayPause"),
  btnNextTrack: document.getElementById("btnNextTrack"),
  btnAddDjAssistedRequest: document.getElementById("btnAddDjAssistedRequest"),
  btnAddSelectedToPlaylistPicker: document.getElementById("btnAddSelectedToPlaylistPicker"),
  btnCloseModerationReason: document.getElementById("btnCloseModerationReason"),
  btnCloseLyricsModal: document.getElementById("btnCloseLyricsModal"),
  btnRefreshPlaylistPicker: document.getElementById("btnRefreshPlaylistPicker"),
  btnClosePlaylistPicker: document.getElementById("btnClosePlaylistPicker"),
  btnToggleAutoSync: document.getElementById("btnToggleAutoSync"),
  playPauseIcon: document.getElementById("playPauseIcon"),

  status: document.getElementById("status"),
  siteTimerBar: document.getElementById("siteTimerBar"),
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
  lyricsModalExternalLink: document.getElementById("lyricsModalExternalLink"),
  modAutoSyncStatus: document.getElementById("modAutoSyncStatus"),
  playlistPickerBackdrop: document.getElementById("playlistPickerBackdrop"),
  playlistPickerModal: document.getElementById("playlistPickerModal"),
  playlistPickerTitle: document.getElementById("playlistPickerTitle"),
  playlistPickerDescription: document.getElementById("playlistPickerDescription"),
  playlistPickerList: document.getElementById("playlistPickerList"),

  playlistBuilderBackdrop: document.getElementById("playlistBuilderBackdrop"),
  playlistBuilderOverlay: document.getElementById("playlistBuilderOverlay"),
  btnPlaylistBuilderClose: document.getElementById("btnPlaylistBuilderClose"),
  playlistBuilderStatus: document.getElementById("playlistBuilderStatus"),
  playlistBuilderSelectedPlaylist: document.getElementById("playlistBuilderSelectedPlaylist"),
  btnPlaylistBuilderChoosePlaylist: document.getElementById("btnPlaylistBuilderChoosePlaylist"),
  playlistBuilderSearchInput: document.getElementById("playlistBuilderSearchInput"),
  btnPlaylistBuilderSearch: document.getElementById("btnPlaylistBuilderSearch"),
  playlistBuilderSearchResults: document.getElementById("playlistBuilderSearchResults"),
  playlistBuilderReview: document.getElementById("playlistBuilderReview"),
  btnPlaylistBuilderAddSelected: document.getElementById("btnPlaylistBuilderAddSelected"),
  playlistBuilderCsvFile: document.getElementById("playlistBuilderCsvFile"),
  playlistBuilderCsvText: document.getElementById("playlistBuilderCsvText"),
  btnPlaylistBuilderBulkParse: document.getElementById("btnPlaylistBuilderBulkParse"),
  btnPlaylistBuilderBulkLoad: document.getElementById("btnPlaylistBuilderBulkLoad"),
  btnPlaylistBuilderBulkAdd: document.getElementById("btnPlaylistBuilderBulkAdd"),
  playlistBuilderBulkStatus: document.getElementById("playlistBuilderBulkStatus"),
  playlistBuilderBulkList: document.getElementById("playlistBuilderBulkList")
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

// Playlist Builder (add songs directly to a chosen playlist)
let playlistBuilderSearchResults = [];
let playlistBuilderSelectedTrackId = "";
let playlistBuilderSelectedTrack = null;
let playlistBuilderSelectedPlaylistId = "";
let playlistBuilderSelectedPlaylistName = "";
const playlistBuilderRatingCacheByTrackId = new Map();
let playlistBuilderBulkParsedTrackIds = [];
let playlistBuilderBulkTracksById = new Map();
let playlistBuilderBulkAddQueue = [];
let playlistBuilderBulkLoadInFlight = false;
let playlistBuilderBulkAddInFlight = false;

let currentNowPlayingTrack = null;
let currentSpotifyQueueTracks = [];
let currentPlaybackProgressMs = 0;
let currentPlaybackDurationMs = 0;
let isPlaybackActive = false;
let currentVolumePercent = 0;
let moderationDetailContext = null;
let draggingApprovedRequestId = null;
const lyricsFetchStateByRequestId = new Map();
const moderationOverrideByRequestId = new Map();
let localProgressLastTickAt = 0;
let refreshPlaybackRequestSeq = 0;
let refreshPlaybackAppliedSeq = 0;
let refreshPlaybackInFlight = false;
let refreshPlaybackQueued = false;
let lastSpotifyQueueFetchAtMs = 0;
let lastSpotifyQueueSnapshot = null;
let lyricsCacheSnapshot = null;
let requestAutoSyncTimer = null;
let requestAutoSyncInFlight = false;
let lastRequestSyncAt = null;
let requestAutoSyncEnabled = true;
let requestAutoSyncCountdownTimer = null;
let requestAutoSyncNextAtMs = 0;
let playlistPickerContext = null;
let playlistPickerCache = { items: [], fetchedAtMs: 0 };

let isLoadingRequests = false;

// ======================================================
// BASIC HELPERS
// ======================================================
function setStatus(message) {
  if (el.status) el.status.textContent = message;
  console.log(message);
}

function logConsoleEvent(scope, message, detail = null, tone = "info") {
  const toneStyleByName = {
    info: "background:#18243a;color:#9fd1ff;padding:2px 8px;border-radius:999px;font-weight:700;",
    success: "background:#123528;color:#8cf5bd;padding:2px 8px;border-radius:999px;font-weight:700;",
    warn: "background:#3b2b10;color:#ffd58b;padding:2px 8px;border-radius:999px;font-weight:700;",
    error: "background:#3b141b;color:#ffb5c0;padding:2px 8px;border-radius:999px;font-weight:700;"
  };

  const scopeStyle = toneStyleByName[tone] || toneStyleByName.info;
  const messageStyle = "color:#d8e5ff;font-weight:600;";
  const timeStyle = "color:#9fb2cf;";
  const timestamp = new Date().toLocaleTimeString();

  console.groupCollapsed(`%c${scope}%c ${message} %c${timestamp}`, scopeStyle, messageStyle, timeStyle);
  if (detail !== null && detail !== undefined) {
    console.log(detail);
  }
  console.groupEnd();
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
    .replaceAll("6", "g")
    .replaceAll("7", "t")
    .replaceAll("8", "b")
    .replaceAll("9", "g")
    .replaceAll("@", "a")
    .replaceAll("$", "s")
    .replaceAll("!", "i")
    .replaceAll("+", "t");
}

function despaceSingleLetterRuns(normalizedText) {
  const text = String(normalizedText || "").trim();
  if (!text) return "";

  const tokens = text.split(" ").filter(Boolean);
  if (tokens.length <= 1) return text;

  const output = [];
  let run = [];

  const flushRun = () => {
    if (!run.length) return;
    output.push(run.join(""));
    run = [];
  };

  for (const token of tokens) {
    if (token.length === 1) {
      run.push(token);
      continue;
    }

    flushRun();
    output.push(token);
  }

  flushRun();
  return output.join(" ").trim();
}

function normalizeModerationText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019'`]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModerationVariants(value) {
  const direct = normalizeModerationText(value);
  const decoded = normalizeModerationText(decodeLeetspeak(value));
  const directDespaced = despaceSingleLetterRuns(direct);
  const decodedDespaced = despaceSingleLetterRuns(decoded);

  return [...new Set([direct, decoded, directDespaced, decodedDespaced].filter(Boolean))];
}

function applyExternalModerationWordlists() {
  const payload = window.ALA_MODERATION_WORDLISTS;
  const rules = Array.isArray(payload?.rules) ? payload.rules : [];
  if (!rules.length) return;

  const existingIds = new Set((CONFIG.themePolicyRules || []).map((r) => String(r?.id || "").trim()).filter(Boolean));

  for (const rule of rules) {
    const id = String(rule?.id || "").trim();
    if (!id || existingIds.has(id)) continue;

    const severity = String(rule?.severity || "review").trim().toLowerCase();
    const safeSeverity = severity === "block" ? "block" : "review";

    const category = String(rule?.category || "External List").trim() || "External List";
    const terms = Array.isArray(rule?.terms) ? rule.terms : [];
    const phrases = Array.isArray(rule?.phrases) ? rule.phrases : [];

    CONFIG.themePolicyRules.push({
      id,
      category,
      severity: safeSeverity,
      terms,
      phrases
    });
    existingIds.add(id);
  }

  logConsoleEvent(
    "Moderation",
    `Loaded ${rules.length} external wordlist rule(s).`,
    {
      generatedAt: String(payload?.generatedAt || ""),
      sources: payload?.sources || []
    },
    "info"
  );
}

function containsNormalizedPhrase(normalizedText, normalizedPhrase) {
  if (!normalizedText || !normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function collectMaskedLanguageHits(entries) {
  const hits = [];
  const seen = new Set();

  // Detect common censoring attempts like sh*t, f**k, b*tch.
  // Keep the character set conservative to reduce false positives.
  const maskedPattern = /\b[a-z]\s*[\*•·_]{1,}\s*[a-z]\b/gi;

  for (const entry of entries || []) {
    const raw = String(entry?.rawValue || "");
    if (!raw) continue;

    const matches = raw.match(maskedPattern) || [];
    for (const match of matches) {
      const key = `${entry.field}|${match.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hits.push({
        ruleId: "masked-language-review",
        category: "Censored Language",
        severity: "review",
        field: entry.field,
        matchType: "pattern",
        matchedText: match,
        normalizedMatch: normalizeModerationText(match)
      });
    }
  }

  return hits;
}

function getModerationSearchEntries(request) {
  const spotify = request?.spotify || null;
  const baseEntries = [
    { field: "theme", value: request?.theme || "" },
    { field: "title", value: spotify?.name || "" },
    { field: "artist", value: spotify?.artist || "" },
    { field: "album", value: spotify?.album || "" }
  ];

  const storedLyrics = getStoredLyricsDataForRequest(request);
  const lyricText = sanitizeLyricsText(storedLyrics?.lyrics || "");
  if (lyricText) {
    baseEntries.push({ field: "lyrics", value: lyricText });
  }

  return baseEntries;
}

const themePolicyCandidateCache = new Map();

function getCachedThemePolicyCandidates(rule) {
  const ruleId = String(rule?.id || "").trim();
  if (!ruleId) return [];

  const terms = Array.isArray(rule?.terms) ? rule.terms : [];
  const phrases = Array.isArray(rule?.phrases) ? rule.phrases : [];
  const cacheKey = `${terms.length}::${phrases.length}`;

  const cached = themePolicyCandidateCache.get(ruleId);
  if (cached?.cacheKey === cacheKey && Array.isArray(cached?.candidates)) {
    return cached.candidates;
  }

  const candidates = [
    ...terms.map((term) => ({ type: "keyword", value: term })),
    ...phrases.map((phrase) => ({ type: "phrase", value: phrase }))
  ]
    .map((candidate) => {
      const normalized = normalizeModerationText(candidate.value);
      return normalized ? { ...candidate, normalized } : null;
    })
    .filter(Boolean);

  themePolicyCandidateCache.set(ruleId, { cacheKey, candidates });
  return candidates;
}

function collectThemePolicyHits(request) {
  const entries = getModerationSearchEntries(request)
    .map((entry) => ({
      ...entry,
      rawValue: entry.value,
      variants: normalizeModerationVariants(entry.value)
    }))
    .filter((entry) => entry.variants.length > 0);

  const seen = new Set();
  const hits = [];

  for (const rule of CONFIG.themePolicyRules || []) {
    const allCandidates = getCachedThemePolicyCandidates(rule);

    for (const candidate of allCandidates) {
      const normalizedCandidate = candidate.normalized;
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

  hits.push(...collectMaskedLanguageHits(entries));

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
      reason: "No theme was submitted and no risky keywords were detected in metadata or lyrics.",
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

  const uniqueReviewTerms = new Set([
    ...reviewHits.map((hit) => hit.normalizedMatch).filter(Boolean),
    ...fallbackReviewTerms.map((term) => normalizeModerationText(term)).filter(Boolean)
  ]);
  const reviewTermCount = uniqueReviewTerms.size;
  const hasLyricsReviewHit = reviewHits.some((hit) => hit.field === "lyrics");

  // Avoid over-flagging on a single mild hit in theme/title/artist/album.
  // Flag when multiple unique review terms appear, or when the review term comes from lyrics.
  if (reviewTermCount >= 2 || hasLyricsReviewHit) {
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
    reason: "Theme, track metadata, and available lyrics passed current keyword and phrase policy checks.",
    matchedTerms: [],
    hits: policyHits,
    summary: summarizePolicyHits(policyHits)
  };
}

function normalizeLyricsRatingCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "");
}

function getLyricsRatingForRequest(request) {
  const ratingLabel = String(request?.lyricsData?.ratingLabel || "").trim();
  const ratingCode = normalizeLyricsRatingCode(request?.lyricsData?.ratingCode || "");
  const ratingReason = String(request?.lyricsData?.ratingReason || "").trim();

  if (!ratingLabel && !ratingCode) return null;

  const label = ratingCode
    ? `Musixmatch Rating: ${ratingCode}`
    : ratingLabel.startsWith("Rating:")
      ? `Musixmatch ${ratingLabel}`
      : `Musixmatch Rating: ${ratingLabel}`;

  return {
    label,
    code: ratingCode,
    reason: ratingReason
  };
}

function statusTagToneForLyricsRating(ratingCode) {
  const code = normalizeLyricsRatingCode(ratingCode);
  if (!code) return "neutral";

  const danger = new Set(["EXPLICIT", "R", "NC-17", "TV-MA", "MA"]);
  if (danger.has(code)) return "danger";

  const ok = new Set(["CLEAN", "OK", "G", "PG", "PG-13"]);
  if (ok.has(code)) return "ok";

  if (code === "NR") return "neutral";
  return "info";
}

function buildModerationMetadata(request) {
  const explicitFlag = request?.spotify?.explicit;
  const themeEvaluation = analyzeThemeModeration(request);
  const policyHits = Array.isArray(themeEvaluation.hits) ? themeEvaluation.hits : [];

  const lyricsRating = getLyricsRatingForRequest(request);

  const lyricsStatusRaw = String(request?.lyricsData?.status || "").trim().toLowerCase();
  const lyricsText = sanitizeLyricsText(request?.lyricsData?.lyrics || "");
  const lyricsHasLyrics = !!lyricsText;
  const lyricsGateStatus = lyricsHasLyrics ? "ok" : (lyricsStatusRaw || "missing");

  const hardHitCount = policyHits.filter((hit) => hit.severity === "block").length;
  const reviewHitCount = policyHits.filter((hit) => hit.severity === "review").length;

  let explicitStatus = "unknown";
  let explicitLabel = "Unknown";
  let explicitReason = "Spotify track metadata was unavailable for explicit classification.";
  let explicitSource = "Spotify track metadata";

  if (explicitFlag === true) {
    explicitStatus = "explicit";
    explicitLabel = "Explicit";
    explicitReason = "Spotify marks this track explicit (explicit=true).";
    explicitSource = "Spotify track metadata";
  } else if (lyricsRating?.code && statusTagToneForLyricsRating(lyricsRating.code) === "danger") {
    // Use scraped lyrics rating as a stronger signal when Spotify says non-explicit or is missing.
    explicitStatus = "explicit";
    explicitLabel = "Explicit";
    explicitReason = `Lyrics rating indicates explicit content${lyricsRating.reason ? ` (${lyricsRating.reason})` : ""}.`;
    explicitSource = "Musixmatch rating";
  } else if (explicitFlag === false) {
    explicitStatus = "clean";
    explicitLabel = "Clean";
    explicitReason = "Spotify marks this track non-explicit (explicit=false).";
    explicitSource = "Spotify track metadata";
  } else if (lyricsRating?.code && statusTagToneForLyricsRating(lyricsRating.code) === "ok") {
    explicitStatus = "clean";
    explicitLabel = "Clean";
    explicitReason = `Lyrics rating indicates non-explicit content${lyricsRating.reason ? ` (${lyricsRating.reason})` : ""}.`;
    explicitSource = "Musixmatch rating";
  }

  let recommendation = "pass";
  let recommendationLabel = "OK";
  let recommendationReason = "Spotify, theme policy, and lyrics checks passed.";

  if (themeEvaluation.status === "blocked") {
    recommendation = "block";
    recommendationLabel = "Block";
    recommendationReason = "Theme or metadata triggered blocked policy categories. Review required before any approval.";
  } else {
    const flagReasons = [];

    if (!request?.spotify) {
      flagReasons.push("Spotify track metadata is missing.");
    }

    // Explicit is not a hard block, but it should never auto-OK.
    if (explicitStatus === "explicit") {
      flagReasons.push(explicitReason || "Track is marked explicit.");
    }

    if (themeEvaluation.status === "flagged") {
      flagReasons.push(themeEvaluation.reason || "Theme status is flagged.");
    }

    // If we do not have lyrics (fallback/missing/error), do not auto-OK.
    if (lyricsGateStatus !== "ok") {
      const detail = String(request?.lyricsData?.detail || "").trim();
      flagReasons.push(`Lyrics unavailable (${lyricsGateStatus})${detail ? `: ${detail}` : ""}.`);
    }

    if (flagReasons.length) {
      recommendation = "flag";
      recommendationLabel = "Flag";
      recommendationReason = flagReasons.join(" | ");
    }
  }

  const compactReason = `${explicitLabel} by ${explicitSource || "metadata"} | ${themeEvaluation.label} (${hardHitCount} hard, ${reviewHitCount} review hits)`;

  const marker = computeFinalMarker({
    explicitStatus,
    explicitReason,
    themeStatus: themeEvaluation.status,
    recommendation,
    recommendationReason,
    lyricsGateStatus
  });

  return {
    explicitStatus,
    explicitLabel,
    explicitReason,
    explicitSource,
    lyricsRatingLabel: lyricsRating?.label || "",
    lyricsRatingCode: lyricsRating?.code || "",
    lyricsRatingReason: lyricsRating?.reason || "",
    lyricsStatus: lyricsStatusRaw || (lyricsHasLyrics ? "success" : "missing"),
    lyricsHasLyrics,
    lyricsGateStatus,
    themeStatus: themeEvaluation.status,
    themeLabel: themeEvaluation.label,
    themeReason: themeEvaluation.reason,
    themeTerms: themeEvaluation.matchedTerms,
    themePolicyHits: policyHits,
    themePolicySummary: summarizePolicyHits(policyHits),
    recommendation,
    recommendationLabel,
    recommendationReason,
    finalMarker: marker.marker,
    finalMarkerLabel: marker.label,
    finalMarkerReason: marker.reason,
    compactReason,
    evaluatedAt: new Date().toISOString(),
    confidence: explicitStatus === "unknown" && !policyHits.length ? "Medium" : "High"
  };
}

function refreshModerationRecommendation(moderation) {
  if (!moderation || typeof moderation !== "object") return moderation;

  let recommendation = "pass";
  let recommendationLabel = "OK";
  let recommendationReason = "Spotify, theme policy, and lyrics checks passed.";

  if (moderation.themeStatus === "blocked") {
    recommendation = "block";
    recommendationLabel = "Block";
    recommendationReason = "Theme status is blocked. Manual override is required to approve.";
  } else {
    const flagReasons = [];

    if (moderation.explicitStatus === "explicit") {
      flagReasons.push(moderation.explicitReason || "Track is marked explicit.");
    }

    if (moderation.themeStatus === "flagged") {
      flagReasons.push(moderation.themeReason || "Theme status is flagged.");
    }

    const gate = String(moderation.lyricsGateStatus || "").trim();
    if (gate && gate !== "ok") {
      flagReasons.push(`Lyrics unavailable (${gate}).`);
    }

    if (flagReasons.length) {
      recommendation = "flag";
      recommendationLabel = "Flag";
      recommendationReason = flagReasons.join(" | ");
    }
  }

  const policyHits = Array.isArray(moderation.themePolicyHits) ? moderation.themePolicyHits : [];
  const hardHitCount = policyHits.filter((hit) => hit.severity === "block").length;
  const reviewHitCount = policyHits.filter((hit) => hit.severity === "review").length;

  moderation.recommendation = recommendation;
  moderation.recommendationLabel = recommendationLabel;
  moderation.recommendationReason = recommendationReason;
  const sourceLabel = String(moderation.explicitSource || "metadata");
  moderation.compactReason = `${moderation.explicitLabel || "Unknown"} by ${sourceLabel} | ${moderation.themeLabel || "No Theme"} (${hardHitCount} hard, ${reviewHitCount} review hits)`;

  const marker = computeFinalMarker(moderation);
  moderation.finalMarker = marker.marker;
  moderation.finalMarkerLabel = marker.label;
  moderation.finalMarkerReason = marker.reason;

  return moderation;
}

function getModerationOverride(requestId) {
  const key = String(requestId || "").trim();
  if (!key) return null;
  return moderationOverrideByRequestId.get(key) || null;
}

function loadModerationOverridesFromStorage() {
  const stored = safeJsonParse(persistentStorage.getItem(LS.moderationOverrides), {});
  moderationOverrideByRequestId.clear();

  if (!stored || typeof stored !== "object") return;

  for (const [requestId, override] of Object.entries(stored)) {
    if (!requestId) continue;
    if (!override || typeof override !== "object") continue;
    moderationOverrideByRequestId.set(String(requestId), override);
  }
}

function persistModerationOverridesToStorage() {
  const serialized = Object.fromEntries(moderationOverrideByRequestId.entries());
  persistentStorage.setItem(LS.moderationOverrides, JSON.stringify(serialized));
}

function setModerationOverride(requestId, patch) {
  const key = String(requestId || "").trim();
  if (!key || !patch || typeof patch !== "object") return null;

  const existing = getModerationOverride(key) || {};
  const merged = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  moderationOverrideByRequestId.set(key, merged);
  persistModerationOverridesToStorage();
  return merged;
}

function clearModerationOverride(requestId) {
  const key = String(requestId || "").trim();
  if (!key) return false;
  const removed = moderationOverrideByRequestId.delete(key);
  if (removed) {
    persistModerationOverridesToStorage();
  }
  return removed;
}

let requestAutoSyncStatusText = "";
let nextRequestSyncText = "";
let lastSiteTimerBarText = "";

function renderSiteTimerBar() {
  if (!el.siteTimerBar) return;

  const requestBase = String(requestAutoSyncStatusText || "").trim();
  const requestNext = String(nextRequestSyncText || "").trim();
  const requestCombined = requestNext ? `${requestBase} | ${requestNext}` : requestBase;

  const parts = [];
  if (requestCombined) parts.push(`Requests: ${requestCombined}`);

  const combinedText = parts.join(" • ");
  if (combinedText === lastSiteTimerBarText) return;

  lastSiteTimerBarText = combinedText;
  el.siteTimerBar.textContent = combinedText;
}

function renderRequestAutoSyncHeaderStatus(tone = "neutral") {
  if (!el.modAutoSyncStatus) return;

  const base = String(requestAutoSyncStatusText || "").trim();
  const next = String(nextRequestSyncText || "").trim();
  const combined = next ? `${base} | ${next}` : base;

  el.modAutoSyncStatus.textContent = combined || base || "Request sync pending...";
  el.modAutoSyncStatus.dataset.tone = tone;
}

function applyModerationOverrides(request, moderation) {
  if (!request || !moderation) return moderation;

  const override = getModerationOverride(request.requestId);
  if (!override) return moderation;

  if (override.explicitStatus && request.spotify) {
    if (override.explicitStatus === "explicit") {
      request.spotify.explicit = true;
    } else if (override.explicitStatus === "clean") {
      request.spotify.explicit = false;
    }

    moderation.explicitStatus = override.explicitStatus;
    moderation.explicitLabel = override.explicitStatus === "explicit" ? "Explicit" : "Clean";
    moderation.explicitReason = "Moderator override marked this track as clean/explicit.";
    moderation.explicitSource = "Moderator override";
  }

  if (override.lyricsGateStatus) {
    moderation.lyricsGateStatus = String(override.lyricsGateStatus);
    moderation.lyricsGateStatusOverride = true;
  }

  if (override.finalMarker) {
    moderation.finalMarkerOverride = String(override.finalMarker);
  }

  if (override.themeStatus) {
    moderation.themeStatus = override.themeStatus;

    if (override.themeStatus === "blocked") {
      moderation.themeLabel = "Theme Blocked";
      moderation.themeReason = "Moderator override set theme status to blocked.";
    } else if (override.themeStatus === "flagged") {
      moderation.themeLabel = "Theme Review";
      moderation.themeReason = "Moderator override set theme status to review.";
    } else {
      moderation.themeLabel = "Theme Clear";
      moderation.themeReason = "Moderator override set theme status to clear.";
    }
  }

  moderation.manualOverride = true;
  moderation.manualOverrideUpdatedAt = override.updatedAt || new Date().toISOString();

  return refreshModerationRecommendation(moderation);
}

function ensureModerationMetadata(request) {
  if (!request) return null;

  const baseline = buildModerationMetadata(request);
  request.moderation = applyModerationOverrides(request, baseline);
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

let spotifyGlobalBackoffUntilMs = 0;
let spotifyLastRateLimitAtMs = 0;

function normalizeSpotifyRetryAfterMs(valueMs, fallbackMs = 5000) {
  const parsed = Number(valueMs);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(30000, Math.max(250, Math.round(parsed)));
  }
  return Math.min(30000, Math.max(250, Math.round(Number(fallbackMs) || 5000)));
}

function noteSpotifyRateLimit(waitMs) {
  const now = Date.now();
  spotifyLastRateLimitAtMs = now;
  spotifyGlobalBackoffUntilMs = Math.max(spotifyGlobalBackoffUntilMs, now + normalizeSpotifyRetryAfterMs(waitMs));
}

async function waitForSpotifyGlobalBackoff() {
  const remainingMs = Math.max(0, spotifyGlobalBackoffUntilMs - Date.now());
  if (remainingMs > 0) {
    await wait(remainingMs);
  }
}

function getSpotifyRetryAfterMs(response) {
  const raw = String(response?.headers?.get("Retry-After") || "").trim();
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(30000, Math.max(250, Math.round(seconds * 1000)));
  }

  return 5000;
}

function getErrorStatusCode(error) {
  const directStatus = Number(error?.status);
  if (Number.isFinite(directStatus)) return directStatus;
  const message = String(error?.message || "");
  const match = message.match(/^(\d{3})\b/);
  if (!match) return null;
  return Number(match[1]);
}

function isInsufficientSpotifyScopeError(error) {
  const message = String(error?.message || "");
  return message.includes("Insufficient client scope");
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
    if (el.playPauseIcon) el.playPauseIcon.textContent = "Play";
    return;
  }

  el.playbackStateLabel.textContent = isPlaybackActive ? "Playing" : "Paused";
  if (el.playPauseIcon) {
    el.playPauseIcon.textContent = isPlaybackActive ? "Pause" : "Play";
  }
}

function setTransportBusy(isBusy) {
  const buttons = [el.btnPrevTrack, el.btnPlayPause, el.btnNextTrack];
  for (const button of buttons) {
    if (button) button.disabled = !!isBusy;
  }
}

function scheduleFastPlaybackSync(delays = CONFIG.transportSyncDelaysMs) {
  const safeDelays = Array.isArray(delays) ? delays : [120, 420, 950];

  for (const delayMs of safeDelays) {
    const waitMs = Math.max(0, Number(delayMs) || 0);
    window.setTimeout(() => {
      refreshPlayback().catch((error) => {
        console.warn("Scheduled playback sync failed:", error);
      });
    }, waitMs);
  }
}

function startLocalProgressTimer() {
  stopLocalProgressTimer();
  localProgressLastTickAt = performance.now();

  localProgressTimer = window.setInterval(() => {
    if (!currentNowPlayingTrack || !isPlaybackActive) return;

    const now = performance.now();
    const elapsedMs = Math.max(0, now - localProgressLastTickAt);
    localProgressLastTickAt = now;

    currentPlaybackProgressMs = Math.min(
      currentPlaybackDurationMs,
      currentPlaybackProgressMs + elapsedMs
    );

    updatePlaybackProgressUI(currentPlaybackProgressMs, currentPlaybackDurationMs);
  }, CONFIG.localProgressTickMs);
}

function stopLocalProgressTimer() {
  if (localProgressTimer) {
    window.clearInterval(localProgressTimer);
    localProgressTimer = null;
  }
  localProgressLastTickAt = 0;
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
  if (!persistentStorage.getItem(LS.moderationOverrides)) {
    persistentStorage.setItem(LS.moderationOverrides, JSON.stringify({}));
  }
  if (!persistentStorage.getItem(LS.requestAutoSyncEnabled)) {
    persistentStorage.setItem(LS.requestAutoSyncEnabled, "1");
  }
}

function loadRequestAutoSyncPreference() {
  const stored = String(persistentStorage.getItem(LS.requestAutoSyncEnabled) || "1").trim();
  requestAutoSyncEnabled = stored !== "0";
}

function persistRequestAutoSyncPreference() {
  persistentStorage.setItem(LS.requestAutoSyncEnabled, requestAutoSyncEnabled ? "1" : "0");
}

function formatCountdownShort(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

function setNextRequestSyncStatus(message) {
  nextRequestSyncText = String(message || "");
  renderRequestAutoSyncHeaderStatus(el.modAutoSyncStatus?.dataset?.tone || "neutral");
  renderSiteTimerBar();
}

function updateAutoSyncToggleButton() {
  if (!el.btnToggleAutoSync) return;
  el.btnToggleAutoSync.textContent = requestAutoSyncEnabled ? "Auto Sync: On" : "Auto Sync: Off";
  el.btnToggleAutoSync.dataset.active = requestAutoSyncEnabled ? "true" : "false";
}

function stopRequestAutoSyncCountdown() {
  if (requestAutoSyncCountdownTimer) {
    window.clearInterval(requestAutoSyncCountdownTimer);
    requestAutoSyncCountdownTimer = null;
  }
}

function updateRequestAutoSyncCountdown() {
  if (!requestAutoSyncEnabled) {
    setNextRequestSyncStatus("Next sync: paused");
    return;
  }

  if (!requestAutoSyncNextAtMs) {
    setNextRequestSyncStatus("Next sync: pending");
    return;
  }

  const remainingMs = requestAutoSyncNextAtMs - Date.now();
  if (remainingMs <= 0) {
    setNextRequestSyncStatus("Next sync: running...");
    return;
  }

  setNextRequestSyncStatus(`Next sync in ${formatCountdownShort(remainingMs)}`);
}

function scheduleNextRequestAutoSyncTick() {
  if (!requestAutoSyncEnabled || !requestAutoSyncTimer) {
    requestAutoSyncNextAtMs = 0;
    updateRequestAutoSyncCountdown();
    return;
  }

  const minutes = Math.max(1, Number(CONFIG.requestAutoSyncMinutes || 5));
  requestAutoSyncNextAtMs = Date.now() + minutes * 60 * 1000;
  updateRequestAutoSyncCountdown();

  if (!requestAutoSyncCountdownTimer) {
    requestAutoSyncCountdownTimer = window.setInterval(updateRequestAutoSyncCountdown, 1000);
  }
}

function updateRequestSyncControlState() {
  if (!el.btnLoadRequests) return;

  if (requestAutoSyncInFlight) {
    el.btnLoadRequests.disabled = true;
    el.btnLoadRequests.textContent = "Syncing...";
    return;
  }

  el.btnLoadRequests.disabled = false;
  el.btnLoadRequests.textContent = "Sync Now";
}

function toggleRequestAutoSync() {
  requestAutoSyncEnabled = !requestAutoSyncEnabled;
  persistRequestAutoSyncPreference();
  updateAutoSyncToggleButton();

  if (requestAutoSyncEnabled) {
    startRequestAutoSyncTimer();
    setRequestAutoSyncStatus("Auto-sync resumed.", "info");
    void runRequestAutoSync("resume", { silent: true });
  } else {
    stopRequestAutoSyncTimer();
    setRequestAutoSyncStatus("Auto-sync paused by moderator.", "warn");
    setNextRequestSyncStatus("Next sync: paused");
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

  const embedMatch = trimmed.match(/spotify\.com\/embed\/track\/([A-Za-z0-9]+)/i);
  if (embedMatch) return embedMatch[1];

  const spotifyUriMatch = trimmed.match(/spotify:track:([A-Za-z0-9]+)/i);
  if (spotifyUriMatch) return spotifyUriMatch[1];

  return null;
}

const spotifyOembedResolveCache = new Map();

async function resolveSpotifyTrackIdFromLink(spotifyLink) {
  const trimmed = String(spotifyLink || "").trim();
  if (!trimmed) return null;

  const direct = extractSpotifyTrackId(trimmed);
  if (direct) return direct;

  if (spotifyOembedResolveCache.has(trimmed)) {
    return spotifyOembedResolveCache.get(trimmed);
  }

  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(trimmed)}`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      spotifyOembedResolveCache.set(trimmed, null);
      return null;
    }

    const json = await response.json();

    const candidateStrings = [
      json?.uri,
      json?.url,
      json?.provider_url,
      json?.html,
      json?.thumbnail_url,
      json?.title
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    for (const candidate of candidateStrings) {
      const found = extractSpotifyTrackId(candidate);
      if (found) {
        spotifyOembedResolveCache.set(trimmed, found);
        return found;
      }

      const embedFound = candidate.match(/open\.spotify\.com\/embed\/track\/([A-Za-z0-9]+)/i);
      if (embedFound) {
        spotifyOembedResolveCache.set(trimmed, embedFound[1]);
        return embedFound[1];
      }
    }
  } catch {
    // Ignore and fall through.
  }

  spotifyOembedResolveCache.set(trimmed, null);
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
    .replace(/[\u2018\u2019'`]/g, " ")
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
  const configured = String(CONFIG.lyricsApiBaseUrl || "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  const host = String(window?.location?.hostname || "").toLowerCase();
  const protocol = String(window?.location?.protocol || "").toLowerCase();

  // If you open index.html directly (file://), default to a local API.
  if (protocol === "file:") {
    return "http://127.0.0.1:8787";
  }

  // GitHub Pages cannot talk to a plain http:// Raspberry Pi API due to mixed-content rules.
  // In that case, keep API disabled and rely on the backup cache.
  if (host.endsWith(".github.io")) {
    return "";
  }

  if (host === "localhost" || host === "127.0.0.1") {
    return "http://127.0.0.1:8787";
  }

  // If the dashboard is being served from the Raspberry Pi (or LAN hostname/IP) over HTTP,
  // assume the API is on the same host at port 8787.
  const looksLikeLanHost =
    host.endsWith(".local") ||
    host === "raspberrypi" ||
    host.startsWith("raspberrypi.") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

  if (looksLikeLanHost && protocol === "http:" && host) {
    return `http://${host}:8787`;
  }

  return "";
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
      let errorText = "";
      let triedUrls = [];
      try {
        const maybeJson = await response.clone().json();
        errorText = String(maybeJson?.error || "").trim();
        triedUrls = Array.isArray(maybeJson?.tried_urls) ? maybeJson.tried_urls : [];
      } catch {
        // Ignore and fall back to text.
      }

      if (!errorText) {
        try {
          errorText = await response.text();
        } catch {
          errorText = "";
        }
      }

      return {
        ok: false,
        reason: errorText || `Lyrics API responded with ${response.status}.`,
        status: "api-error",
        triedUrls
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
      url: String(json?.url || ""),
      selectorUsed: String(json?.selector_used || ""),
      source: String(json?.source || "Lyrics API"),
      ratingLabel: String(json?.rating_label || ""),
      ratingCode: String(json?.rating_code || ""),
      ratingReason: String(json?.rating_reason || ""),
      ratingSelectorUsed: String(json?.rating_selector_used || ""),
      isInstrumental: !!json?.is_instrumental,
      instrumentalSource: String(json?.instrumental_source || "")
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
  try {
    const origin = String(window?.location?.origin || "").trim();
    const pathname = String(window?.location?.pathname || "").trim();
    const protocol = String(window?.location?.protocol || "").trim().toLowerCase();

    if (!origin || !pathname || origin === "null" || protocol === "file:") {
      return CONFIG.redirectUriFallback;
    }

    const path = pathname.endsWith(".html")
      ? pathname.replace(/[^/]+$/, "")
      : pathname;

    return `${origin}${path}`;
  } catch {
    return CONFIG.redirectUriFallback;
  }
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
  persistentStorage.setItem(LS.spotifyScopesFingerprint, getRequiredSpotifyScopesFingerprint());
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
  stopRequestAutoSyncTimer();

  currentNowPlayingTrack = null;
  currentSpotifyQueueTracks = [];
  lastSpotifyQueueSnapshot = null;
  lastSpotifyQueueFetchAtMs = 0;
  spotifyGlobalBackoffUntilMs = 0;
  spotifyLastRateLimitAtMs = 0;
  currentPlaybackProgressMs = 0;
  currentPlaybackDurationMs = 0;
  isPlaybackActive = false;

  resetNowPlayingUI();
  renderSpotifyQueue(null);
  setRequestAutoSyncStatus("Auto-sync paused until Spotify login.", "warn");
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
        const retryAfterMs = normalizeSpotifyRetryAfterMs(
          error?.retryAfterMs,
          CONFIG.trackLookupRetryDelayMs * attempt
        );
        const jitterMs = 120 + attempt * 80;
        noteSpotifyRateLimit(retryAfterMs + jitterMs);
        await waitForSpotifyGlobalBackoff();
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

  await waitForSpotifyGlobalBackoff();

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
    if (response.status === 429) {
      const error = new Error("429 Rate limited by Spotify.");
      error.status = 429;
      error.retryAfterMs = getSpotifyRetryAfterMs(response);
      noteSpotifyRateLimit(error.retryAfterMs);
      throw error;
    }

    const text = await response.text();
    const error = new Error(`${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function spotifyFetchWithRetry(path, options = {}, config = {}) {
  const maxAttempts = Math.max(1, Number(config.maxAttempts || 4));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await spotifyFetch(path, options);
    } catch (error) {
      const status = getErrorStatusCode(error);
      const isLastAttempt = attempt === maxAttempts;

      if (status === 429 && !isLastAttempt) {
        const retryAfterMs = normalizeSpotifyRetryAfterMs(error?.retryAfterMs, 5000);
        const jitterMs = 120 + attempt * 80;
        logConsoleEvent("Spotify", "Rate limited (429). Backing off...", { attempt, retryAfterMs, path }, "warn");
        noteSpotifyRateLimit(retryAfterMs + jitterMs);
        await waitForSpotifyGlobalBackoff();
        continue;
      }

      throw error;
    }
  }

  throw new Error("Spotify request failed unexpectedly.");
}

async function spotifyNoContent(path, options = {}) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await getAccessToken();
    if (!token) throw new Error("Spotify login required.");

    await waitForSpotifyGlobalBackoff();

    const response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (response.ok || response.status === 204) {
      return true;
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfterMs = normalizeSpotifyRetryAfterMs(getSpotifyRetryAfterMs(response), 5000);
      const jitterMs = 120 + attempt * 80;
      logConsoleEvent("Spotify", "Rate limited (429) on request. Backing off...", { attempt, retryAfterMs, path }, "warn");
      noteSpotifyRateLimit(retryAfterMs + jitterMs);
      await waitForSpotifyGlobalBackoff();
      continue;
    }

    const text = await response.text();
    const error = new Error(`${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }

  return true;
}

async function getCurrentUserProfile() {
  return spotifyFetchWithRetry("/me");
}

async function getTrackById(trackId) {
  // Important: keep this as a single-attempt call.
  // Higher-level callers (like getTrackByIdWithRetry / getTracksByIds) control retries
  // to avoid retry-storms when Spotify is rate-limiting.
  return spotifyFetchWithRetry(
    `/tracks/${encodeURIComponent(trackId)}?market=from_token`,
    {},
    { maxAttempts: 1 }
  );
}

const trackCacheById = new Map();

function getCachedSpotifyTrack(trackId) {
  const key = String(trackId || "").trim();
  if (!key) return null;
  const entry = trackCacheById.get(key);
  return entry?.track || null;
}

function setCachedSpotifyTrack(trackId, track) {
  const key = String(trackId || "").trim();
  if (!key || !track) return;

  trackCacheById.set(key, { track, fetchedAtMs: Date.now() });

  if (trackCacheById.size > 2000) {
    const firstKey = trackCacheById.keys().next().value;
    if (firstKey) trackCacheById.delete(firstKey);
  }
}

async function getTracksByIds(trackIds) {
  const ids = [...new Set((trackIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const results = new Map();

  // Adaptive safety: keep bulk URLs short if a network filter / proxy blocks long query strings.
  // This lowers the chance of 403s on /tracks?ids=... while still batching.
  let bulkBatchSize = 50;

  // Guardrail: if we fall back to per-track lookups, do not hammer Spotify for dozens of tracks.
  // We'll stop early if we hit 429, and let the next sync attempt fill in remaining metadata.
  const maxPerTrackFallback = 10;

  for (let i = 0; i < ids.length; i += bulkBatchSize) {
    const chunk = ids.slice(i, i + bulkBatchSize);
    if (!chunk.length) continue;

    // Note: Spotify expects comma-separated IDs. Encode each ID, but keep commas unescaped.
    const idsParam = chunk.map((id) => encodeURIComponent(id)).join(",");

    let response;
    try {
      response = await spotifyFetchWithRetry(`/tracks?ids=${idsParam}&market=from_token`);
    } catch (error) {
      const status = getErrorStatusCode(error);
      if (status === 403 && bulkBatchSize > 10) {
        // Some environments appear to block longer /tracks?ids= URLs; retry with smaller batches.
        bulkBatchSize = 10;
        i -= bulkBatchSize;
        logConsoleEvent(
          "Spotify",
          "Bulk track lookup returned 403; reducing batch size and retrying.",
          { previousBatchSize: 50, nextBatchSize: bulkBatchSize, message: String(error?.message || "").slice(0, 160) },
          "warn"
        );
        continue;
      }

      if (status === 403 || status === 400) {
        logConsoleEvent(
          "Spotify",
          "Bulk track lookup failed; falling back to per-track fetch.",
          { status, chunkSize: chunk.length, message: String(error?.message || "").slice(0, 200) },
          "warn"
        );

        let perTrackCount = 0;
        for (const trackId of chunk) {
          if (perTrackCount >= maxPerTrackFallback) {
            logConsoleEvent(
              "Spotify",
              "Stopping per-track fallback early to avoid rate-limit storms.",
              { attempted: perTrackCount, remaining: Math.max(0, chunk.length - perTrackCount) },
              "warn"
            );
            break;
          }

          perTrackCount += 1;

          try {
            const track = await getTrackByIdWithRetry(trackId);
            const id = String(track?.id || "").trim();
            if (id) results.set(id, track);
          } catch (innerError) {
            const innerStatus = getErrorStatusCode(innerError);
            console.warn("Per-track Spotify lookup failed:", { trackId, error: innerError });

            if (innerStatus === 429) {
              logConsoleEvent(
                "Spotify",
                "Hit Spotify rate limit during per-track fallback; pausing further lookups until next sync.",
                { trackId },
                "warn"
              );
              break;
            }
          }
        }

        continue;
      }

      throw error;
    }

    const tracks = Array.isArray(response?.tracks) ? response.tracks : [];
    for (const track of tracks) {
      const id = String(track?.id || "").trim();
      if (id) results.set(id, track);
    }
  }

  return results;
}

async function getCurrentlyPlaying() {
  try {
    return await spotifyFetchWithRetry("/me/player");
  } catch (error) {
    console.warn("Currently playing unavailable:", error);
    return null;
  }
}

async function getAvailableDevices() {
  return spotifyFetchWithRetry("/me/player/devices");
}

async function getSpotifyQueue() {
  return spotifyFetchWithRetry("/me/player/queue");
}

async function searchSpotifyTracks(query) {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(CONFIG.manualSearchLimit)
  });

  const response = await spotifyFetchWithRetry(`/search?${params.toString()}`);
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
  if (!playlistId) {
    throw new Error("Missing playlist ID in app configuration.");
  }

  const device = await ensureActiveDevice();

  await spotifyNoContent(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      context_uri: `spotify:playlist:${playlistId}`
    })
  });
}

async function addTrackToPlaylist(playlistId, trackUri) {
  if (!playlistId) {
    throw new Error("Missing playlist ID in app configuration.");
  }

  if (!trackUri) {
    throw new Error("Missing track URI for playlist add.");
  }

  await spotifyFetchWithRetry(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris: [trackUri] })
  });
}

async function addTrackToSpotifyQueue(trackUri) {
  await ensureActiveDevice();

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const token = await getAccessToken();
    if (!token) throw new Error("Spotify login required.");

    await waitForSpotifyGlobalBackoff();

    const url = new URL("https://api.spotify.com/v1/me/player/queue");
    url.searchParams.set("uri", trackUri);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.ok || response.status === 204) {
      return;
    }

    const text = await response.text();

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfterMs = normalizeSpotifyRetryAfterMs(getSpotifyRetryAfterMs(response), 5000);
      const jitterMs = 120 + attempt * 80;
      logConsoleEvent(
        "Spotify",
        "Rate limited (429) adding to queue. Backing off...",
        { attempt, retryAfterMs },
        "warn"
      );
      noteSpotifyRateLimit(retryAfterMs + jitterMs);
      await waitForSpotifyGlobalBackoff();
      continue;
    }

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

  const enriched = rows.map((row) => {
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
    }

    return result;
  });

  const itemsNeedingResolve = enriched.filter((item) => !item.trackId && item.spotifyLink);
  if (itemsNeedingResolve.length) {
    logConsoleEvent(
      "Spotify",
      "Resolving Spotify share links...",
      { count: itemsNeedingResolve.length },
      "info"
    );

    const concurrency = 4;
    let idx = 0;

    const worker = async () => {
      while (idx < itemsNeedingResolve.length) {
        const current = itemsNeedingResolve[idx];
        idx += 1;

        try {
          const resolved = await resolveSpotifyTrackIdFromLink(current.spotifyLink);
          if (resolved) {
            current.trackId = resolved;
            current.error = null;
          }
        } catch {
          // Keep existing error.
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, itemsNeedingResolve.length) }, () => worker()));
  }

  const idsToFetch = [];
  for (const item of enriched) {
    if (!item.trackId) continue;

    const cached = getCachedSpotifyTrack(item.trackId);
    if (cached) {
      item.spotify = normalizeSpotifyTrack(cached);
      continue;
    }

    idsToFetch.push(item.trackId);
  }

  const uniqueIdsToFetch = [...new Set(idsToFetch)];
  if (uniqueIdsToFetch.length) {
    logConsoleEvent(
      "Spotify",
      "Bulk fetching track metadata for moderation...",
      { requested: uniqueIdsToFetch.length },
      "info"
    );

    let fetchedById = new Map();
    try {
      fetchedById = await getTracksByIds(uniqueIdsToFetch);
    } catch (error) {
      console.warn("Bulk Spotify track fetch failed; falling back to per-track retries:", error);
      fetchedById = new Map();
    }

    for (const id of uniqueIdsToFetch) {
      const track = fetchedById.get(id);
      if (track) {
        setCachedSpotifyTrack(id, track);
      }
    }

    for (const item of enriched) {
      if (!item.trackId || item.spotify) continue;

      const fromBulk = fetchedById.get(item.trackId) || getCachedSpotifyTrack(item.trackId);
      if (fromBulk) {
        item.spotify = normalizeSpotifyTrack(fromBulk);
        continue;
      }

      if (!item.error) {
        item.error = "Spotify lookup failed";
      }
    }
  }

  for (const item of enriched) {
    item.moderation = buildModerationMetadata(item);
  }

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

  logConsoleEvent(
    "Moderation",
    "Summary refreshed.",
    { total, valid, clean, explicit, themeReview, themeBlocked, errors },
    themeBlocked > 0 || explicit > 0 ? "warn" : "info"
  );
}

// ======================================================
// APPROVE / REJECT
// ======================================================
function approveRequest(request, options = {}) {
  const {
    silentStatus = false,
    allowExplicit = true,
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
    lyricsData: request.lyricsData || null,
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
    setStatus(`Approved: ${request.spotify.artist} - ${request.spotify.name}`);
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
    return request.spotify && request.spotify.explicit === false && moderation?.recommendation === "pass";
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
              ${escapeHtml(spotify?.album || "Unknown Album")} - ${escapeHtml(msToMinSec(spotify?.durationMs || 0))}
            </div>
            <div class="request-submitted">Spotify track ID: ${escapeHtml(spotify?.id || "Unavailable")}</div>
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
      const markerClass = badgeClassForFinalMarker(moderation?.finalMarker);
      const markerText = moderation?.finalMarkerLabel || "Flag";
      const markerTitle = String(moderation?.finalMarkerReason || moderation?.recommendationReason || moderation?.compactReason || "").trim();

      const spotifyExplicitClass = request.spotify
        ? request.spotify.explicit
          ? "badge-explicit"
          : "badge-clean"
        : "badge-error";

      const spotifyExplicitText = request.spotify
        ? request.spotify.explicit
          ? "Spotify Explicit"
          : "Spotify Clean"
        : "Spotify N/A";

      const approveDisabled =
        !request.spotify || moderation?.themeStatus === "blocked"
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
              <div class="request-title-badges">
                <span class="badge ${markerClass}" title="${escapeHtml(markerTitle || "Final marker")}">${escapeHtml(markerText)}</span>
                <span class="badge ${spotifyExplicitClass}">${escapeHtml(spotifyExplicitText)}</span>
              </div>
            </div>

            <div class="request-artist">${escapeHtml(artistName)}</div>
            <div class="request-meta">
              ${escapeHtml(album)} - ${escapeHtml(msToMinSec(request.spotify?.durationMs || 0))}
            </div>
            <div class="request-submitted">${escapeHtml(request.timestamp || "Unknown time")} - ${escapeHtml(sourceLabel)}</div>
            <div class="request-status-tags">${buildRequestStatusTags(request, moderation)}</div>
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
              <span class="queue-drag-handle" aria-hidden="true" title="Drag to reorder">::</span>
              <div class="queue-item-title">${escapeHtml(name)}</div>
              <div class="request-title-badges">
                <span class="badge ${badgeClassForFinalMarker(moderation?.finalMarker)}" title="${escapeHtml(String(moderation?.finalMarkerReason || "").trim() || "Final marker")}">${escapeHtml(moderation?.finalMarkerLabel || "Flag")}</span>
                ${sourceBadge}
              </div>
            </div>
            <div class="queue-item-artist">${escapeHtml(artist)}</div>
            <div class="request-status-tags">${buildRequestStatusTags(item, moderation)}</div>
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
          <div class="request-title-badges">
            <span class="badge ${badgeClassForFinalMarker(moderation?.finalMarker)}" title="${escapeHtml(String(moderation?.finalMarkerReason || "").trim() || "Final marker")}">${escapeHtml(moderation?.finalMarkerLabel || "Flag")}</span>
            <span class="badge ${statusClass}">${statusBadge}</span>
          </div>
        </div>

        <div class="request-artist">${escapeHtml(item.artist || "Unknown artist")}</div>
        <div class="request-meta">
          ${escapeHtml(item.album || "Unknown Album")} - ${escapeHtml(msToMinSec(item.durationMs))}
        </div>
        <div class="request-submitted">Selected approved track preview - ${escapeHtml(getSourceLabel(current.source))}</div>
        <div class="request-status-tags">${buildRequestStatusTags(current, moderation)}</div>
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
            ${escapeHtml(currentlyPlaying.album?.name || "Unknown Album")} - ${escapeHtml(msToMinSec(currentlyPlaying.duration_ms))}
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
            ${escapeHtml(item.album?.name || "Unknown Album")} - ${escapeHtml(msToMinSec(item.duration_ms))}
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

  if (refreshPlaybackInFlight) {
    refreshPlaybackQueued = true;
    return;
  }

  refreshPlaybackInFlight = true;

  const requestSeq = ++refreshPlaybackRequestSeq;

  try {
    const playbackData = await getCurrentlyPlaying();

    const now = Date.now();
    const recentlyRateLimited = now - Number(spotifyLastRateLimitAtMs || 0) < 30000;
    const queueMinIntervalMs = recentlyRateLimited ? 30000 : 10000;
    const shouldFetchQueue =
      !recentlyRateLimited &&
      now - Number(lastSpotifyQueueFetchAtMs || 0) >= queueMinIntervalMs;

    if (shouldFetchQueue) {
      lastSpotifyQueueFetchAtMs = now;
      const freshQueue = await getSpotifyQueue().catch(() => null);
      if (freshQueue) {
        lastSpotifyQueueSnapshot = freshQueue;
      }
    }

    const queueData = lastSpotifyQueueSnapshot;

    if (requestSeq < refreshPlaybackAppliedSeq) {
      return;
    }
    refreshPlaybackAppliedSeq = requestSeq;

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
      localProgressLastTickAt = performance.now();
      startLocalProgressTimer();
    } else {
      stopLocalProgressTimer();
    }
  } catch (error) {
    if (requestSeq < refreshPlaybackAppliedSeq) {
      return;
    }
    refreshPlaybackAppliedSeq = requestSeq;

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
    renderSpotifyQueue(lastSpotifyQueueSnapshot);
    stopLocalProgressTimer();
  } finally {
    refreshPlaybackInFlight = false;

    if (refreshPlaybackQueued) {
      refreshPlaybackQueued = false;
      window.setTimeout(() => {
        if (!refreshPlaybackInFlight) {
          refreshPlayback().catch((error) => console.warn("Queued playback refresh failed:", error));
        }
      }, 250);
    }
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

function toSpotifyApiPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (raw.startsWith("https://api.spotify.com/v1")) {
    return raw.slice("https://api.spotify.com/v1".length) || "";
  }

  if (raw.startsWith("/")) {
    return raw;
  }

  return `/${raw.replace(/^\/+/, "")}`;
}

function closePlaylistPicker() {
  if (!el.playlistPickerModal || !el.playlistPickerBackdrop) return;
  el.playlistPickerModal.classList.remove("playlist-picker-is-open");
  el.playlistPickerBackdrop.classList.remove("playlist-picker-is-open");
  playlistPickerContext = null;
}

function getPlaylistPickerModeLabel(mode) {
  if (mode === "add") return "Choose Playlist for Moderated Song";
  if (mode === "builder") return "Choose Playlist for Playlist Builder";
  return "Choose Playlist to Play";
}

function renderPlaylistPickerList(playlists) {
  if (!el.playlistPickerList) return;

  if (!Array.isArray(playlists) || !playlists.length) {
    el.playlistPickerList.innerHTML = '<div class="empty-state">No playlists were found for this Spotify account.</div>';
    return;
  }

  el.playlistPickerList.innerHTML = playlists
    .map((playlist) => {
      const playlistId = String(playlist?.id || "").trim();
      const playlistName = String(playlist?.name || "Untitled Playlist").trim() || "Untitled Playlist";
      const ownerName = String(playlist?.owner?.display_name || playlist?.owner?.id || "Unknown Owner").trim();
      const totalTracks = Number(playlist?.tracks?.total || 0);
      const imageUrl = String(playlist?.images?.[0]?.url || "").trim();

      const art = imageUrl
        ? `<img class="playlist-picker-art" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(playlistName)} artwork" loading="lazy" />`
        : '<div class="playlist-picker-art playlist-picker-art-fallback">No Art</div>';

      return `
        <button
          type="button"
          class="playlist-picker-item"
          data-playlist-id="${escapeHtml(playlistId)}"
          data-playlist-name="${escapeHtml(playlistName)}"
        >
          ${art}
          <span class="playlist-picker-copy">
            <span class="playlist-picker-name">${escapeHtml(playlistName)}</span>
            <span class="playlist-picker-meta">${escapeHtml(ownerName)} | ${escapeHtml(totalTracks)} track(s)</span>
          </span>
        </button>
      `;
    })
    .join("");
}

async function fetchSignedInUserPlaylists(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    Array.isArray(playlistPickerCache.items) &&
    playlistPickerCache.items.length > 0 &&
    now - Number(playlistPickerCache.fetchedAtMs || 0) < Number(CONFIG.playlistPickerCacheMs || 120000)
  ) {
    return playlistPickerCache.items;
  }

  const limit = Math.max(1, Math.min(50, Number(CONFIG.userPlaylistFetchLimit || 50)));
  let nextPath = `/me/playlists?limit=${limit}`;
  const collected = [];

  try {
    while (nextPath) {
      const page = await spotifyFetchWithRetry(nextPath);
      const pageItems = Array.isArray(page?.items) ? page.items : [];
      collected.push(...pageItems);

      if (collected.length >= 1000) {
        break;
      }

      nextPath = toSpotifyApiPath(page?.next);
    }
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("403") || message.includes("insufficient_scope")) {
      throw new Error("Spotify denied playlist read access. Log out, then log in again to grant playlist-read-private scope.");
    }
    throw error;
  }

  const dedupedById = new Map();
  for (const playlist of collected) {
    const playlistId = String(playlist?.id || "").trim();
    if (!playlistId) continue;
    if (!dedupedById.has(playlistId)) {
      dedupedById.set(playlistId, playlist);
    }
  }

  const visiblePlaylists = [...dedupedById.values()]
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" }));

  playlistPickerCache = {
    items: visiblePlaylists,
    fetchedAtMs: Date.now()
  };

  return visiblePlaylists;
}
async function openPlaylistPicker(mode, forceRefresh = false) {
  const rawMode = String(mode || "start").trim().toLowerCase();
  const safeMode = rawMode === "add" ? "add" : rawMode === "builder" ? "builder" : "start";

  if (!el.playlistPickerModal || !el.playlistPickerBackdrop || !el.playlistPickerList) {
    throw new Error("Playlist picker UI is not available.");
  }

  if (safeMode === "add" && !getSelectedApprovedItem()?.spotify?.uri) {
    throw new Error("Select an approved song before adding to a playlist.");
  }

  playlistPickerContext = { mode: safeMode };

  if (el.playlistPickerTitle) {
    el.playlistPickerTitle.textContent = getPlaylistPickerModeLabel(safeMode);
  }

  if (el.playlistPickerDescription) {
    el.playlistPickerDescription.textContent = safeMode === "add"
      ? "Pick one of your playlists to store the currently selected moderated song."
      : safeMode === "builder"
        ? "Pick one of your playlists as the target for the Playlist Builder screen."
        : "Pick one of your playlists to start playback on the active Spotify device.";
  }

  el.playlistPickerList.innerHTML = '<div class="empty-state">Loading playlists...</div>';
  el.playlistPickerBackdrop.classList.add("playlist-picker-is-open");
  el.playlistPickerModal.classList.add("playlist-picker-is-open");

  let playlists = [];
  try {
    playlists = await fetchSignedInUserPlaylists(forceRefresh);
  } catch (error) {
    if (isInsufficientSpotifyScopeError(error)) {
      throw new Error(
        "Spotify permissions are missing for playlists. Click Logout, then Login again to approve playlist access (playlist-read-private)."
      );
    }

    throw error;
  }
  renderPlaylistPickerList(playlists);

  if (el.playlistPickerDescription) {
    el.playlistPickerDescription.textContent = `${playlists.length} playlist(s) available for ${safeMode === "add" ? "adding moderated songs" : safeMode === "builder" ? "building playlists" : "starting playback"}.`;
  }

  logConsoleEvent("Playlists", `Loaded ${playlists.length} playlist(s) for picker.`, { mode: safeMode }, "success");
}

async function handlePlaylistPickerSelection(playlistId, playlistName) {
  const safePlaylistId = String(playlistId || "").trim();
  const safePlaylistName = String(playlistName || "Playlist").trim() || "Playlist";

  if (!safePlaylistId) {
    throw new Error("Missing playlist ID from picker selection.");
  }

  const mode = playlistPickerContext?.mode || "start";

  if (mode === "builder") {
    setPlaylistBuilderSelectedPlaylist(safePlaylistId, safePlaylistName);
    setStatus(`Playlist Builder target set to: ${safePlaylistName}.`);
    closePlaylistPicker();
    return;
  }

  if (mode === "add") {
    const item = await addSelectedApprovedToPlaylist(safePlaylistId);
    setStatus(`Added to ${safePlaylistName}: ${item?.spotify?.artist || "Unknown Artist"} - ${item?.spotify?.name || "Unknown Song"}`);
    logConsoleEvent("Moderation", "Added moderated song to playlist.", {
      playlistId: safePlaylistId,
      playlistName: safePlaylistName,
      track: item?.spotify?.name || "Unknown Song"
    }, "success");
    closePlaylistPicker();
    return;
  }

  await startPlaylistById(safePlaylistId);
  setStatus(`Started playlist: ${safePlaylistName}.`);
  await refreshPlayback();
  logConsoleEvent("Playback", "Started playlist from picker.", {
    playlistId: safePlaylistId,
    playlistName: safePlaylistName
  }, "success");
  closePlaylistPicker();
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
  if (moderation?.recommendation === "flag") return "badge-error";
  return "badge-clean";
}

function badgeClassForFinalMarker(marker) {
  if (marker === "explicit") return "badge-explicit";
  if (marker === "flag") return "badge-error";
  return "badge-clean";
}

function computeFinalMarker(moderation) {
  const forced = String(moderation?.finalMarkerOverride || "").trim().toLowerCase();
  if (forced === "explicit" || forced === "flag" || forced === "clean") {
    return {
      marker: forced,
      label: forced === "explicit" ? "Explicit" : forced === "flag" ? "Flag" : "Clean",
      reason: "Moderator override forced the final marker."
    };
  }

  // Single at-a-glance marker:
  // - explicit: explicit signal or blocked theme
  // - flag: any uncertainty/review gate (preferred over clean)
  // - clean: only when everything is confidently ok
  if (moderation?.themeStatus === "blocked" || moderation?.recommendation === "block") {
    return { marker: "explicit", label: "Explicit", reason: "Blocked theme/policy categories." };
  }

  if (moderation?.explicitStatus === "explicit") {
    return { marker: "explicit", label: "Explicit", reason: moderation?.explicitReason || "Track is marked explicit." };
  }

  if (moderation?.recommendation === "flag") {
    return { marker: "flag", label: "Flag", reason: moderation?.recommendationReason || "Manual review recommended." };
  }

  const gate = String(moderation?.lyricsGateStatus || "").trim().toLowerCase();
  if (gate && gate !== "ok") {
    return { marker: "flag", label: "Flag", reason: `Lyrics unavailable (${gate}).` };
  }

  // Slight preference to Flag over Clean when explicit classification is unknown.
  if (moderation?.explicitStatus !== "clean") {
    return { marker: "flag", label: "Flag", reason: "Explicit status is unknown; prefer manual review." };
  }

  return { marker: "clean", label: "Clean", reason: "All checks passed." };
}

function statusTagToneForTheme(themeStatus) {
  if (themeStatus === "blocked") return "danger";
  if (themeStatus === "flagged") return "warn";
  if (themeStatus === "clear") return "ok";
  return "neutral";
}

function statusTagToneForRecommendation(recommendation) {
  if (recommendation === "block") return "danger";
  if (recommendation === "flag") return "warn";
  return "ok";
}

function statusTagHtml(label, tone = "neutral", options = {}) {
  const requestId = String(options.requestId || "").trim();
  const editField = String(options.editField || "").trim();

  if (requestId && editField) {
    return `
      <button
        type="button"
        class="mod-status-tag mod-status-tag-${escapeHtml(tone)} mod-status-edit-btn"
        data-request-id="${escapeHtml(requestId)}"
        data-edit-field="${escapeHtml(editField)}"
        title="Click to cycle moderation status"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  return `<span class="mod-status-tag mod-status-tag-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function getRequestById(requestId) {
  const key = String(requestId || "").trim();
  if (!key) return null;

  return (
    currentRequests.find((item) => item.requestId === key) ||
    getApprovedQueue().find((item) => item.requestId === key) ||
    null
  );
}

function getNextThemeOverride(currentThemeStatus) {
  if (currentThemeStatus === "flagged") return "blocked";
  if (currentThemeStatus === "blocked") return "clear";
  return "flagged";
}

function refreshModerationViewsForRequest(requestId) {
  renderRequests(currentRequests);
  renderApprovedQueue();
  renderApprovedPreview();

  if (moderationDetailContext?.requestId === requestId) {
    const updated = getRequestById(requestId) || moderationDetailContext;
    openModerationReasonModal(updated);
  }
}

function applyStatusTagEdit(requestId, editField) {
  const key = String(requestId || "").trim();
  const field = String(editField || "").trim();
  if (!key || !field) return;

  const request = getRequestById(key);
  if (!request) {
    setStatus("Could not find request to edit moderation status.");
    return;
  }

  const moderation = ensureModerationMetadata(request);

  if (field === "explicit") {
    if (!request.spotify) {
      setStatus("Cannot edit explicit status without a valid Spotify track.");
      return;
    }

    const nextExplicit = moderation?.explicitStatus === "explicit" ? "clean" : "explicit";
    setModerationOverride(key, { explicitStatus: nextExplicit });
    setStatus(`Explicit status set to ${nextExplicit}.`);
    logConsoleEvent("Moderation", "Explicit status cycled.", { requestId: key, nextExplicit }, "warn");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "theme") {
    const nextTheme = getNextThemeOverride(moderation?.themeStatus);
    setModerationOverride(key, { themeStatus: nextTheme });
    setStatus(`Theme status set to ${nextTheme}.`);
    logConsoleEvent("Moderation", "Theme status cycled.", { requestId: key, nextTheme }, "warn");
    refreshModerationViewsForRequest(key);
  }
}

function applyModerationBypass(requestId, bypassField) {
  const key = String(requestId || "").trim();
  const field = String(bypassField || "").trim();
  if (!key || !field) return;

  const request = getRequestById(key);
  if (!request) {
    setStatus("Could not find request to override moderation status.");
    return;
  }

  if (field === "allow-all") {
    if (!request.spotify) {
      setStatus("Cannot allow this request because Spotify track data is missing.");
      return;
    }

    setModerationOverride(key, { explicitStatus: "clean", themeStatus: "clear", lyricsGateStatus: "ok", finalMarker: "clean" });
    setStatus("Moderator override applied: marked clean/clear and bypassed lyrics gate.");
    logConsoleEvent("Moderation", "Allow-all override applied.", { requestId: key }, "warn");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "reset") {
    const removed = clearModerationOverride(key);
    if (removed) {
      setStatus("Moderator override removed. Auto moderation restored.");
      logConsoleEvent("Moderation", "Override reset to auto moderation.", { requestId: key }, "info");
    } else {
      setStatus("No override found. Auto moderation is already active.");
    }
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "explicit") {
    if (!request.spotify) {
      setStatus("Cannot bypass explicit status without a valid Spotify track.");
      return;
    }

    setModerationOverride(key, { explicitStatus: "clean" });
    setStatus("Explicit gate bypassed: marked clean by moderator override.");
    logConsoleEvent("Moderation", "Explicit bypass applied.", { requestId: key }, "warn");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "theme") {
    setModerationOverride(key, { themeStatus: "clear" });
    setStatus("Theme gate bypassed: marked clear by moderator override.");
    logConsoleEvent("Moderation", "Theme bypass applied.", { requestId: key }, "warn");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "lyrics") {
    setModerationOverride(key, { lyricsGateStatus: "ok" });
    setStatus("Lyrics gate bypassed for this request.");
    logConsoleEvent("Moderation", "Lyrics gate bypass applied.", { requestId: key }, "warn");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "force-clean") {
    if (!request.spotify) {
      setStatus("Cannot force clean without a valid Spotify track.");
      return;
    }
    setModerationOverride(key, { finalMarker: "clean" });
    setStatus("Final marker forced to Clean.");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "force-flag") {
    setModerationOverride(key, { finalMarker: "flag" });
    setStatus("Final marker forced to Flag.");
    refreshModerationViewsForRequest(key);
    return;
  }

  if (field === "force-explicit") {
    setModerationOverride(key, { finalMarker: "explicit" });
    setStatus("Final marker forced to Explicit.");
    refreshModerationViewsForRequest(key);
    return;
  }
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
    const source = String(state.source || "").toLowerCase();
    const label = source.includes("cache") ? "Lyrics: Cached" : "Lyrics: Fetched";

    return {
      label,
      tone: "ok",
      detail: state.detail || "Lyrics were loaded successfully."
    };
  }

  if (state.state === "fallback") {
    return {
      label: "Lyrics: Fallback",
      tone: "warn",
      detail: state.detail || "Lyrics fallback was used."
    };
  }

  return {
    label: "Lyrics: Fetch Failed",
    tone: "danger",
    detail: state.detail || "Lyrics request failed."
  };
}

function maybeRepairMojibake(value) {
  const text = String(value || "");
  if (!text) return "";

  if (!/[ÃƒÆ’Ãƒâ€šÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÂ¢Ã¢â€šÂ¬]/.test(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (decoded && !decoded.includes("\uFFFD")) {
      return decoded;
    }
  } catch {
    // Keep original text when conversion fails.
  }

  return text;
}

function sanitizeLyricsText(value) {
  const repaired = maybeRepairMojibake(value);
  return String(repaired || "").replace(/\r\n/g, "\n").trim();
}

function setRequestLyricsData(request, payload = {}) {
  if (!request || typeof request !== "object") return;

  const previous = request.lyricsData && typeof request.lyricsData === "object"
    ? request.lyricsData
    : {};

  const next = {
    ...previous,
    ...payload,
    lyrics: sanitizeLyricsText(payload.lyrics ?? previous.lyrics ?? ""),
    ratingLabel: String(payload.ratingLabel ?? previous.ratingLabel ?? "").trim(),
    ratingCode: String(payload.ratingCode ?? previous.ratingCode ?? "").trim(),
    ratingReason: String(payload.ratingReason ?? previous.ratingReason ?? "").trim(),
    ratingSelectorUsed: String(payload.ratingSelectorUsed ?? previous.ratingSelectorUsed ?? "").trim(),
    isInstrumental: !!(payload.isInstrumental ?? previous.isInstrumental ?? false),
    instrumentalSource: String(payload.instrumentalSource ?? previous.instrumentalSource ?? "").trim(),
    updatedAt: payload.updatedAt || new Date().toISOString()
  };

  request.lyricsData = next;
}

function setLyricsFetchStatus(requestId, state, detail = "", payload = {}) {
  const key = String(requestId || "").trim();
  if (!key) return;

  const previous = lyricsFetchStateByRequestId.get(key) || {};
  const nextState = {
    ...previous,
    state: String(state || "").trim() || "unknown",
    detail: String(detail || "").trim(),
    source: String(payload.source ?? previous.source ?? "").trim(),
    selectorUsed: String(payload.selectorUsed ?? previous.selectorUsed ?? "").trim(),
    status: String(payload.status ?? previous.status ?? "").trim(),
    ratingLabel: String(payload.ratingLabel ?? previous.ratingLabel ?? "").trim(),
    ratingCode: String(payload.ratingCode ?? previous.ratingCode ?? "").trim(),
    ratingReason: String(payload.ratingReason ?? previous.ratingReason ?? "").trim(),
    ratingSelectorUsed: String(payload.ratingSelectorUsed ?? previous.ratingSelectorUsed ?? "").trim(),
    isInstrumental: !!(payload.isInstrumental ?? previous.isInstrumental ?? false),
    instrumentalSource: String(payload.instrumentalSource ?? previous.instrumentalSource ?? "").trim(),
    updatedAt: payload.updatedAt || new Date().toISOString()
  };

  if (Object.prototype.hasOwnProperty.call(payload, "lyrics")) {
    nextState.lyrics = sanitizeLyricsText(payload.lyrics);
  }

  lyricsFetchStateByRequestId.set(key, nextState);

  const request = getRequestById(key);
  if (request) {
    setRequestLyricsData(request, {
      lyrics: nextState.lyrics || "",
      status: nextState.state,
      source: nextState.source,
      selectorUsed: nextState.selectorUsed,
      detail: nextState.detail,
      ratingLabel: nextState.ratingLabel,
      ratingCode: nextState.ratingCode,
      ratingReason: nextState.ratingReason,
      ratingSelectorUsed: nextState.ratingSelectorUsed,
      isInstrumental: nextState.isInstrumental,
      instrumentalSource: nextState.instrumentalSource,
      updatedAt: nextState.updatedAt
    });
  }
}

function normalizeLyricsCacheKey(artist, song) {
  const safeArtist = String(artist || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const safeSong = String(song || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!safeArtist || !safeSong) return "";
  return `${safeArtist}|${safeSong}`;
}

function buildLyricsLookupArtistCandidates(artist) {
  const base = String(artist || "").trim();
  if (!base) return [];

  const candidates = new Set([base]);
  candidates.add(base.split(",")[0]?.trim() || "");
  candidates.add(base.split("&")[0]?.trim() || "");
  candidates.add(base.split(/\bfeat\.?\b/i)[0]?.trim() || "");
  return [...candidates].filter(Boolean);
}

function buildLyricsLookupSongCandidates(song) {
  const base = String(song || "").trim();
  if (!base) return [];

  const candidates = new Set([base]);
  candidates.add(base.replace(/\((feat|ft)\.?[^)]*\)/gi, "").trim());
  candidates.add(base.replace(/\[(feat|ft)\.?[^\]]*\]/gi, "").trim());
  candidates.add(base.replace(/\s+-\s+(radio edit|explicit|clean|remaster(ed)?|version)$/i, "").trim());
  return [...candidates].filter(Boolean);
}

function getLyricsCacheEntryByArtistSong(artist, song, cacheData = lyricsCacheSnapshot) {
  if (!cacheData || typeof cacheData !== "object") return null;

  const bySongKey = cacheData?.by_song_key && typeof cacheData.by_song_key === "object"
    ? cacheData.by_song_key
    : {};

  const artistCandidates = buildLyricsLookupArtistCandidates(artist);
  const songCandidates = buildLyricsLookupSongCandidates(song);

  for (const artistCandidate of artistCandidates) {
    for (const songCandidate of songCandidates) {
      const key = normalizeLyricsCacheKey(artistCandidate, songCandidate);
      if (key && bySongKey[key]) {
        return bySongKey[key];
      }
    }
  }

  return null;
}

function getStoredLyricsDataForRequest(request) {
  if (!request || typeof request !== "object") return null;

  const requestId = String(request.requestId || "").trim();
  const requestLyrics = request.lyricsData && typeof request.lyricsData === "object"
    ? request.lyricsData
    : null;

  if (requestLyrics && String(requestLyrics.lyrics || "").trim()) {
    return {
      lyrics: sanitizeLyricsText(requestLyrics.lyrics),
      source: String(requestLyrics.source || "request-cache"),
      selectorUsed: String(requestLyrics.selectorUsed || ""),
      status: String(requestLyrics.status || "success"),
      ratingLabel: String(requestLyrics.ratingLabel || ""),
      ratingCode: String(requestLyrics.ratingCode || ""),
      ratingReason: String(requestLyrics.ratingReason || ""),
      ratingSelectorUsed: String(requestLyrics.ratingSelectorUsed || ""),
      isInstrumental: !!requestLyrics.isInstrumental,
      instrumentalSource: String(requestLyrics.instrumentalSource || "")
    };
  }

  if (requestId) {
    const state = lyricsFetchStateByRequestId.get(requestId);
    if (state && String(state.lyrics || "").trim()) {
      return {
        lyrics: sanitizeLyricsText(state.lyrics),
        source: String(state.source || "runtime"),
        selectorUsed: String(state.selectorUsed || ""),
        status: String(state.state || "success"),
        ratingLabel: String(state.ratingLabel || ""),
        ratingCode: String(state.ratingCode || ""),
        ratingReason: String(state.ratingReason || ""),
        ratingSelectorUsed: String(state.ratingSelectorUsed || ""),
        isInstrumental: !!state.isInstrumental,
        instrumentalSource: String(state.instrumentalSource || "")
      };
    }
  }

  const cacheEntry = getLyricsCacheEntryForRequest(request, lyricsCacheSnapshot);
  if (cacheEntry && String(cacheEntry.lyrics || "").trim()) {
    return {
      lyrics: sanitizeLyricsText(cacheEntry.lyrics),
      source: String(cacheEntry.source || "github-actions-cache"),
      selectorUsed: String(cacheEntry.selector_used || ""),
      status: String(cacheEntry.status || "success"),
      ratingLabel: String(cacheEntry.rating_label || ""),
      ratingCode: String(cacheEntry.rating_code || ""),
      ratingReason: String(cacheEntry.rating_reason || ""),
      ratingSelectorUsed: String(cacheEntry.rating_selector_used || ""),
      isInstrumental: !!cacheEntry.is_instrumental,
      instrumentalSource: String(cacheEntry.instrumental_source || "")
    };
  }

  return null;
}

function formatElapsedShort(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));

  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;

  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d`;
}

async function fetchLyricsCacheSnapshot(options = {}) {
  const cacheUrl = String(CONFIG.lyricsCacheUrl || "").trim();
  if (!cacheUrl) {
    return {
      ok: false,
      reason: "missing-url"
    };
  }

  const quiet = !!options.quiet;
  if (!quiet) {
    logConsoleEvent("Lyrics Cache", "Fetching cache snapshot...", { cacheUrl }, "info");
  }

  try {
    const response = await fetch(`${cacheUrl}${cacheUrl.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      if (!quiet) {
        logConsoleEvent("Lyrics Cache", "Cache snapshot fetch failed.", { status: response.status }, "warn");
      }
      return {
        ok: false,
        reason: `HTTP ${response.status}`
      };
    }

    const json = await response.json();
    lyricsCacheSnapshot = json;

    if (!quiet) {
      logConsoleEvent("Lyrics Cache", "Cache snapshot loaded.", {
        generatedAt: json?.generated_at || "",
        stats: json?.stats || null
      }, "success");
    }

    return {
      ok: true,
      cache: json
    };
  } catch (error) {
    if (!quiet) {
      logConsoleEvent("Lyrics Cache", "Cache snapshot request failed.", { error: error?.message || error }, "error");
    }
    return {
      ok: false,
      reason: error?.message || "Failed to load lyrics cache"
    };
  }
}

function isModerationPanelOpen() {
  return document.body.classList.contains("mod-panel-open");
}

function getLyricsCacheEntryForRequest(request, cacheData) {
  if (!request || !cacheData) return null;

  const byTrackId = cacheData?.by_track_id && typeof cacheData.by_track_id === "object"
    ? cacheData.by_track_id
    : {};
  const bySongKey = cacheData?.by_song_key && typeof cacheData.by_song_key === "object"
    ? cacheData.by_song_key
    : {};

  const trackId = String(request?.spotify?.id || request?.trackId || "").trim();
  if (trackId && byTrackId[trackId]) {
    return byTrackId[trackId];
  }

  const directSongKey = normalizeLyricsCacheKey(request?.spotify?.artist, request?.spotify?.name);
  if (directSongKey && bySongKey[directSongKey]) {
    return bySongKey[directSongKey];
  }

  const candidateMatch = getLyricsCacheEntryByArtistSong(request?.spotify?.artist, request?.spotify?.name, cacheData);
  if (candidateMatch) {
    return candidateMatch;
  }

  return null;
}

function applyLyricsCacheEntriesFromCache(requests, cacheData) {
  if (!Array.isArray(requests) || !requests.length) {
    return {
      started: false,
      reason: "empty"
    };
  }

  let matched = 0;
  let success = 0;
  let fallback = 0;

  for (const request of requests) {
    const requestId = String(request?.requestId || "").trim();
    if (!requestId || !request?.spotify) continue;

    const entry = getLyricsCacheEntryForRequest(request, cacheData);
    if (!entry) continue;

    matched += 1;

    const lyricsText = sanitizeLyricsText(entry?.lyrics || "");
    const hasLyrics = lyricsText.length > 0;
    if (hasLyrics && String(entry?.status || "").toLowerCase() === "success") {
      success += 1;
      const cachedAt = formatTimestamp(entry?.updated_at || cacheData?.generated_at || "") || "latest cache run";
      setLyricsFetchStatus(requestId, "success", `Cached lyrics from ${cachedAt}.`, {
        lyrics: lyricsText,
        source: entry?.source || "github-actions-cache",
        selectorUsed: entry?.selector_used || "",
        ratingLabel: entry?.rating_label || "",
        ratingCode: entry?.rating_code || "",
        ratingReason: entry?.rating_reason || "",
        ratingSelectorUsed: entry?.rating_selector_used || "",
        isInstrumental: !!entry?.is_instrumental,
        instrumentalSource: String(entry?.instrumental_source || ""),
        status: entry?.status || "success",
        updatedAt: entry?.updated_at || cacheData?.generated_at || new Date().toISOString()
      });
      continue;
    }

    fallback += 1;
    setLyricsFetchStatus(
      requestId,
      "fallback",
      String(entry?.error || "Lyrics not found in current cache for this song."),
      {
        lyrics: "",
        source: entry?.source || "github-actions-cache",
        selectorUsed: entry?.selector_used || "",
        ratingLabel: entry?.rating_label || "",
        ratingCode: entry?.rating_code || "",
        ratingReason: entry?.rating_reason || "",
        ratingSelectorUsed: entry?.rating_selector_used || "",
        isInstrumental: !!entry?.is_instrumental,
        instrumentalSource: String(entry?.instrumental_source || ""),
        status: entry?.status || "fallback",
        updatedAt: entry?.updated_at || cacheData?.generated_at || new Date().toISOString()
      }
    );
  }

  buildRequestSummary(currentRequests);
  renderRequests(currentRequests);
  renderApprovedQueue();
  if (moderationDetailContext?.requestId) {
    const updated = getRequestById(moderationDetailContext.requestId) || moderationDetailContext;
    openModerationReasonModal(updated);
  }

  return {
    started: true,
    matched,
    success,
    fallback,
    generatedAt: cacheData?.generated_at || "",
    refreshMinutes: Number(cacheData?.refresh_interval_minutes || CONFIG.lyricsCacheRefreshMinutes || 5)
  };
}

async function applyLyricsCacheForLoadedRequests(requests) {
  if (!Array.isArray(requests) || !requests.length) {
    return {
      started: false,
      reason: "empty"
    };
  }

  const cacheResult = await fetchLyricsCacheSnapshot();
  if (!cacheResult.ok) {
    return {
      started: false,
      reason: cacheResult.reason
    };
  }

  return applyLyricsCacheEntriesFromCache(requests, cacheResult.cache || {});
}

function buildLyricsPrefetchGroups(requests) {
  const groups = new Map();

  for (const request of requests) {
    const requestId = String(request?.requestId || "").trim();
    const artist = String(request?.spotify?.artist || "").trim();
    const song = String(request?.spotify?.name || "").trim();

    if (!requestId || !artist || !song) continue;

    const existingState = lyricsFetchStateByRequestId.get(requestId);
    if (existingState?.state === "success" || existingState?.state === "loading") continue;

    const key = `${artist.toLowerCase()}|${song.toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        artist,
        song,
        requests: []
      });
    }

    groups.get(key).requests.push(request);
  }

  const maxGroups = Math.max(1, Number(CONFIG.lyricsPrefetchMaxSongsPerLoad) || 1);
  return [...groups.values()].slice(0, maxGroups);
}

async function prefetchLyricsForLoadedRequests(requests) {
  if (!Array.isArray(requests) || !requests.length || !CONFIG.lyricsPrefetchOnLoad) {
    return {
      started: false,
      reason: "disabled-or-empty"
    };
  }

  if (!getLyricsApiBaseUrl()) {
    return {
      started: false,
      reason: "not-configured"
    };
  }

  const groups = buildLyricsPrefetchGroups(requests);
  if (!groups.length) {
    return {
      started: false,
      reason: "no-candidates"
    };
  }

  const stats = {
    started: true,
    attempted: groups.length,
    success: 0,
    fallback: 0,
    failed: 0
  };

  let cursor = 0;
  let processed = 0;

  const applyStateToGroup = (group, state, detail, payload = {}) => {
    for (const request of group.requests) {
      setLyricsFetchStatus(request.requestId, state, detail, payload);
    }
  };

  // Show loading tags before requests start so the moderator sees progress quickly.
  for (const group of groups) {
    applyStateToGroup(group, "loading", "Bulk lyrics fetch in progress from Load Requests.");
  }

  buildRequestSummary(currentRequests);
  renderRequests(currentRequests);
  renderApprovedQueue();
  if (moderationDetailContext?.requestId) {
    const updated = getRequestById(moderationDetailContext.requestId) || moderationDetailContext;
    openModerationReasonModal(updated);
  }

  setStatus(`Starting lyrics prefetch for ${groups.length} unique song(s)...`);

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= groups.length) return;

      const group = groups[index];
      const result = await fetchLyricsFromApi(group.artist, group.song);

      if (result.ok) {
        stats.success += 1;
        applyStateToGroup(group, "success", `Live lyrics fetched from ${result.source || "Lyrics API"}.`, {
          lyrics: result.lyrics,
          source: result.source || "Lyrics API",
          selectorUsed: result.selectorUsed || "",
          ratingLabel: result.ratingLabel || "",
          ratingCode: result.ratingCode || "",
          ratingReason: result.ratingReason || "",
          ratingSelectorUsed: result.ratingSelectorUsed || "",
          status: "success",
          updatedAt: new Date().toISOString()
        });
      } else {
        const fallbackState =
          result.status === "api-error" || result.status === "empty" || result.status === "not-configured"
            ? "fallback"
            : "error";

        if (fallbackState === "fallback") {
          stats.fallback += 1;
        } else {
          stats.failed += 1;
        }

        applyStateToGroup(group, fallbackState, result.reason || "Lyrics API did not return live lyrics.", {
          lyrics: "",
          source: result.source || "Lyrics API",
          selectorUsed: result.selectorUsed || "",
          status: result.status || fallbackState,
          updatedAt: new Date().toISOString()
        });
      }

      processed += 1;

      if (processed % 4 === 0 || processed === groups.length) {
        buildRequestSummary(currentRequests);
        renderRequests(currentRequests);
        renderApprovedQueue();
        if (moderationDetailContext?.requestId) {
          const updated = getRequestById(moderationDetailContext.requestId) || moderationDetailContext;
          openModerationReasonModal(updated);
        }
      }

      setStatus(
        `Lyrics prefetch ${processed}/${groups.length} - Fetched: ${stats.success} - Fallback: ${stats.fallback} - Failed: ${stats.failed}`
      );

      await wait(Math.max(0, Number(CONFIG.lyricsPrefetchDelayMs) || 0));
    }
  }

  const workerCount = Math.max(1, Math.min(Number(CONFIG.lyricsPrefetchConcurrency) || 1, groups.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  buildRequestSummary(currentRequests);
  renderRequests(currentRequests);
  renderApprovedQueue();
  if (moderationDetailContext?.requestId) {
    const updated = getRequestById(moderationDetailContext.requestId) || moderationDetailContext;
    openModerationReasonModal(updated);
  }

  return stats;
}

function buildRequestStatusTags(request, moderation) {
  const markerTag = statusTagHtml(
    `Marker: ${moderation?.finalMarkerLabel || "Flag"}`,
    moderation?.finalMarker === "explicit" ? "danger" : moderation?.finalMarker === "flag" ? "warn" : "ok"
  );

  const recommendationTag = statusTagHtml(
    `Decision: ${moderation?.recommendationLabel || "Flag"}`,
    statusTagToneForRecommendation(moderation?.recommendation)
  );

  const spotifyTag = request?.spotify
    ? statusTagHtml("Spotify Match: Found", "ok")
    : statusTagHtml("Spotify Match: Missing", "danger");

  const explicitLabel = moderation?.explicitStatus === "explicit"
    ? "Explicit"
    : moderation?.explicitStatus === "clean"
      ? "Clean"
      : "Unknown";

  const explicitTone = moderation?.explicitStatus === "explicit"
    ? "danger"
    : moderation?.explicitStatus === "clean"
      ? "ok"
      : "neutral";

  const sourceRaw = String(moderation?.explicitSource || "");
  const explicitSourceShort = sourceRaw.includes("Musixmatch")
    ? "Musixmatch"
    : sourceRaw.includes("Spotify")
      ? "Spotify"
      : "";

  const explicitTag = statusTagHtml(
    explicitSourceShort
      ? `Explicit: ${explicitLabel} (${explicitSourceShort})`
      : `Explicit: ${explicitLabel}`,
    explicitTone,
    { requestId: request?.requestId, editField: "explicit" }
  );

  const lyricsRating = getLyricsRatingForRequest(request);
  const ratingTag = lyricsRating
    ? statusTagHtml(lyricsRating.label, statusTagToneForLyricsRating(lyricsRating.code))
    : "";

  const themeTag = statusTagHtml(
    `Theme: ${moderation?.themeLabel || "No Theme"}`,
    statusTagToneForTheme(moderation?.themeStatus),
    { requestId: request?.requestId, editField: "theme" }
  );

  const lyricsStatus = getLyricsFetchStatusTag(request?.requestId);
  const lyricsTag = statusTagHtml(lyricsStatus.label, lyricsStatus.tone);

  return `${markerTag}${recommendationTag}${spotifyTag}${explicitTag}${ratingTag}${themeTag}${lyricsTag}`;
}

function moderationReasonHtml(request, moderation) {
  const safeTheme = String(request?.theme || "").trim() || "No theme submitted";
  const safeStudent = String(request?.studentName || "").trim() || "Not provided";
  const safeSource = getSourceLabel(request?.source);
  const themePolicyHits = Array.isArray(moderation?.themePolicyHits) ? moderation.themePolicyHits : [];
  const policySummary = Array.isArray(moderation?.themePolicySummary) ? moderation.themePolicySummary : [];
  const lyricsStatus = getLyricsFetchStatusTag(request?.requestId);
  const lyricsRating = getLyricsRatingForRequest(request);
  const ratingLabel = String(request?.lyricsData?.ratingLabel || "").trim();
  const ratingReason = String(request?.lyricsData?.ratingReason || "").trim();
  const isInstrumental = !!request?.lyricsData?.isInstrumental;
  const instrumentalSource = String(request?.lyricsData?.instrumentalSource || "").trim();
  const ratingSummaryLabel = ratingLabel || (lyricsRating?.label ? String(lyricsRating.label).replace(/^Lyrics\s+/i, "") : "");
  const matchedTerms = Array.isArray(moderation?.themeTerms) && moderation.themeTerms.length
    ? moderation.themeTerms.join(", ")
    : "None";

  const explicitSourceRaw = String(moderation?.explicitSource || "");
  const explicitSourceShort = explicitSourceRaw.includes("Musixmatch")
    ? "Musixmatch"
    : explicitSourceRaw.includes("Spotify")
      ? "Spotify"
      : "metadata";

  const quickTags = [
    statusTagHtml(`Decision: ${moderation?.recommendationLabel || "Flag"}`, statusTagToneForRecommendation(moderation?.recommendation)),
    statusTagHtml(`Spotify Match: ${request?.spotify ? "Found" : "Missing"}`, request?.spotify ? "ok" : "danger"),
    statusTagHtml(
      `Explicit: ${moderation?.explicitStatus === "explicit" ? "Explicit" : moderation?.explicitStatus === "clean" ? "Clean" : "Unknown"} (${explicitSourceShort})`,
      moderation?.explicitStatus === "explicit" ? "danger" : moderation?.explicitStatus === "clean" ? "ok" : "neutral",
      { requestId: request?.requestId, editField: "explicit" }
    ),
    ...(lyricsRating
      ? [statusTagHtml(lyricsRating.label, statusTagToneForLyricsRating(lyricsRating.code))]
      : []),
    ...(isInstrumental
      ? [statusTagHtml("Instrumental (Musixmatch)", "neutral")]
      : []),
    statusTagHtml(
      `Theme: ${moderation?.themeLabel || "No Theme"}`,
      statusTagToneForTheme(moderation?.themeStatus),
      { requestId: request?.requestId, editField: "theme" }
    ),
    statusTagHtml(lyricsStatus.label, lyricsStatus.tone)
  ].join("");

  const requestIdValue = String(request?.requestId || "").trim();
  const showOverrides = requestIdValue && !requestIdValue.startsWith("preview|");

  const bypassActions = showOverrides
    ? `
      <div class="moderation-bypass-actions">
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="allow-all" type="button">
          Allow Now (Clean/Clear)
        </button>
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="explicit" type="button">
          Bypass Explicit Gate
        </button>
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="theme" type="button">
          Bypass Theme Gate
        </button>
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="lyrics" type="button">
          Bypass Lyrics Gate
        </button>
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="force-clean" type="button">
          Force Marker: Clean
        </button>
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="force-flag" type="button">
          Force Marker: Flag
        </button>
        <button class="btn btn-small moderation-bypass-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="force-explicit" type="button">
          Force Marker: Explicit
        </button>
        <button class="btn btn-small moderation-bypass-btn moderation-bypass-reset-btn" data-request-id="${escapeHtml(requestIdValue)}" data-bypass-field="reset" type="button">
          Remove Override
        </button>
      </div>
    `
    : "";

  const summaryRows = policySummary.length
    ? policySummary
      .map((entry) => `
        <div class="moderation-reason-item">
          <div class="moderation-reason-label">${escapeHtml(entry.category)}</div>
          <div class="moderation-reason-value">${escapeHtml(entry.severity.toUpperCase())} | ${escapeHtml(entry.count)} hit(s)</div>
        </div>
      `)
      .join("")
    : "<div class=\"empty-state\">No policy hits were detected.</div>";

  const hitRows = themePolicyHits.length
    ? themePolicyHits
      .map((hit) => `
        <tr>
          <td>${escapeHtml(hit.severity)}</td>
          <td>${escapeHtml(hit.category)}</td>
          <td>${escapeHtml(hit.field)}</td>
          <td>${escapeHtml(hit.matchedText)}</td>
        </tr>
      `)
      .join("")
    : "<tr><td colspan=\"4\">No keyword or phrase matches.</td></tr>";

  return `
    <div class="moderation-reason-callout">
      <div class="request-title-badges">
        <span class="badge ${badgeClassForFinalMarker(moderation?.finalMarker)}">${escapeHtml(moderation?.finalMarkerLabel || "Flag")}</span>
        <span class="badge ${badgeClassForRecommendation(moderation)}">${escapeHtml(moderation?.recommendationLabel || "Flag")}</span>
      </div>
      <p>${escapeHtml(moderation?.finalMarkerReason || "Final marker computed from moderation signals.")}</p>
      <p>${escapeHtml(moderation?.recommendationReason || "Flagged for moderator review.")}</p>
    </div>

    <div class="moderation-reason-section">
      <h3>Quick Controls</h3>
      <div class="request-status-tags moderation-tags-wrap">
        ${quickTags}
      </div>
      <p class="moderation-inline-note">Tip: click the Explicit or Theme tags to cycle status quickly.</p>
      ${bypassActions}
    </div>

    <div class="moderation-reason-grid">
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Source</div>
        <div class="moderation-reason-value">${escapeHtml(safeSource)}</div>
      </div>
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Student</div>
        <div class="moderation-reason-value">${escapeHtml(safeStudent)}</div>
      </div>
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Theme</div>
        <div class="moderation-reason-value">${escapeHtml(safeTheme)}</div>
      </div>
      <div class="moderation-reason-item">
        <div class="moderation-reason-label">Matched Terms</div>
        <div class="moderation-reason-value">${escapeHtml(matchedTerms)}</div>
      </div>
    </div>

    <div class="moderation-reason-section">
      <h3>Decision Notes</h3>
      <ul class="moderation-reason-list">
        <li>${escapeHtml(moderation?.explicitReason || "No explicit reasoning available.")}</li>
        <li>${escapeHtml(moderation?.themeReason || "No theme reasoning available.")}</li>
        ${isInstrumental ? `<li>${escapeHtml(`Musixmatch marked this track as instrumental${instrumentalSource ? ` (${instrumentalSource})` : ""}.`)}</li>` : ""}
        <li>${escapeHtml(lyricsStatus.detail || "Lyrics have not been fetched for this request.")}</li>
      </ul>
    </div>

    ${ratingSummaryLabel ? (() => {
      const normalizedRatingCode = normalizeLyricsRatingCode(moderation?.lyricsRatingCode || lyricsRating?.code || "");
      const ratingShortRaw = String(ratingSummaryLabel || "")
        .replace(/^(?:Musixmatch\s+)?Rating:\s*/i, "")
        .trim();
      const ratingDerivedCode = normalizedRatingCode || normalizeLyricsRatingCode(ratingShortRaw);
      const ratingShort = ratingDerivedCode ? ratingDerivedCode : (ratingShortRaw || "Unknown");
      const ratingTone = statusTagToneForLyricsRating(ratingDerivedCode);

      const explicitLabel = moderation?.explicitStatus === "explicit"
        ? "Explicit"
        : moderation?.explicitStatus === "clean"
          ? "Clean"
          : "Unknown";

      const explicitTone = moderation?.explicitStatus === "explicit"
        ? "danger"
        : moderation?.explicitStatus === "clean"
          ? "ok"
          : "neutral";

      const sourceRaw = String(moderation?.explicitSource || "");
      const explicitSourceShort = sourceRaw.includes("Musixmatch")
        ? "Musixmatch"
        : sourceRaw.includes("Spotify")
          ? "Spotify"
          : "metadata";

      return `
        <div class="moderation-reason-section">
          <h3>Scraped Rating (Musixmatch)</h3>
          <div class="request-status-tags moderation-tags-wrap">
            ${statusTagHtml(`Musixmatch Rating: ${ratingShort}`, ratingTone)}
            ${statusTagHtml(`Explicit signal: ${explicitLabel} (${explicitSourceShort})`, explicitTone)}
          </div>
          <p class="moderation-inline-note">Musixmatch rating is used as an explicit/clean signal when Spotify is missing or disagrees. It does not auto-approve; missing lyrics still forces a Flag.</p>
          <details class="moderation-reason-details" open>
            <summary>Musixmatch rating explanation</summary>
            <div class="summary-text">
              ${escapeHtml(ratingReason || "No rating explanation was scraped for this track.")}
            </div>
          </details>
        </div>
      `;
    })() : ""}

    <details class="moderation-reason-details">
      <summary>Policy Summary (${policySummary.length})</summary>
      <div class="moderation-reason-grid moderation-reason-grid-full">
        ${summaryRows}
      </div>
    </details>

    <details class="moderation-reason-details">
      <summary>Detailed Hits (${themePolicyHits.length})</summary>
      <div class="moderation-reason-table-wrap">
        <table class="moderation-reason-table" aria-label="Moderation policy hit details">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Category</th>
              <th>Field</th>
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
  const apiBase = getLyricsApiBaseUrl() || "http://127.0.0.1:8787";
  el.lyricsModalBody.innerHTML = `
    <div class="lyrics-fallback">
      <p class="lyrics-fallback-title">Lyrics scrape failed.</p>
      <p class="lyrics-fallback-copy">${escapeHtml(reason || "The API did not return lyrics.")}</p>
      <p class="lyrics-fallback-copy">
        Expected scraper API base: ${escapeHtml(apiBase)}
      </p>
      <p class="lyrics-fallback-copy">Run this check in a terminal: <strong>curl ${escapeHtml(apiBase)}/health</strong></p>
      <a class="btn btn-small btn-primary" href="${escapeHtml(fallbackUrl)}" target="_blank" rel="noopener noreferrer">
        Open Musixmatch Source Page
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
      <pre class="lyrics-text-pre">${escapeHtml(sanitizeLyricsText(lyrics))}</pre>
      <p class="lyrics-fallback-copy">Source: ${escapeHtml(source || "Lyrics API")} ${selectorUsed ? `- Selector: ${escapeHtml(selectorUsed)}` : ""}</p>
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
    setLyricsFetchStatus(safeRequestId, "loading", "Preparing lyrics...");
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

  let cachedLyrics = null;
  if (safeRequestId) {
    const request = getRequestById(safeRequestId);
    cachedLyrics = getStoredLyricsDataForRequest(request);
  }

  if (cachedLyrics?.lyrics) {
    if (safeRequestId) {
      setLyricsFetchStatus(safeRequestId, "success", "Lyrics loaded from cache.", {
        lyrics: cachedLyrics.lyrics,
        source: cachedLyrics.source || "runtime-cache",
        selectorUsed: cachedLyrics.selectorUsed || "",
        ratingLabel: cachedLyrics.ratingLabel || "",
        ratingCode: cachedLyrics.ratingCode || "",
        ratingReason: cachedLyrics.ratingReason || "",
        ratingSelectorUsed: cachedLyrics.ratingSelectorUsed || "",
        status: "success",
        updatedAt: new Date().toISOString()
      });
      buildRequestSummary(currentRequests);
      renderRequests(currentRequests);
      renderApprovedQueue();
      if (moderationDetailContext?.requestId === safeRequestId) {
        openModerationReasonModal(moderationDetailContext);
      }
    }

    renderLyricsSuccess(cachedLyrics);
    return;
  }

  // Live scraper is the primary source.
  const liveResult = await fetchLyricsFromApi(safeArtist, safeSong);
  if (liveResult.ok) {
    if (el.lyricsModalExternalLink && liveResult.url) {
      el.lyricsModalExternalLink.href = String(liveResult.url);
    }
    if (safeRequestId) {
      setLyricsFetchStatus(safeRequestId, "success", `Live lyrics fetched from ${liveResult.source || "Lyrics API"}.`, {
        lyrics: liveResult.lyrics,
        source: liveResult.source || "Lyrics API",
        selectorUsed: liveResult.selectorUsed || "",
        ratingLabel: liveResult.ratingLabel || "",
        ratingCode: liveResult.ratingCode || "",
        ratingReason: liveResult.ratingReason || "",
        ratingSelectorUsed: liveResult.ratingSelectorUsed || "",
        isInstrumental: !!liveResult.isInstrumental,
        instrumentalSource: liveResult.instrumentalSource || "",
        status: "success",
        updatedAt: new Date().toISOString()
      });
      buildRequestSummary(currentRequests);
      renderRequests(currentRequests);
      renderApprovedQueue();
      if (moderationDetailContext?.requestId === safeRequestId) {
        openModerationReasonModal(moderationDetailContext);
      }
    }

    renderLyricsSuccess(liveResult);
    return;
  }

  // Fallback: backup cache (lyrics-cache.json)
  if (!lyricsCacheSnapshot) {
    await fetchLyricsCacheSnapshot({ quiet: true });
  }

  const cacheEntry = safeRequestId
    ? getLyricsCacheEntryForRequest(getRequestById(safeRequestId), lyricsCacheSnapshot)
    : getLyricsCacheEntryByArtistSong(safeArtist, safeSong, lyricsCacheSnapshot);

  if (cacheEntry && sanitizeLyricsText(cacheEntry?.lyrics || "")) {
    const backupLyrics = {
      lyrics: sanitizeLyricsText(cacheEntry.lyrics || ""),
      source: cacheEntry.source || "lyrics-cache.json",
      url: cacheEntry.musixmatch_url || cacheEntry.url || "",
      selectorUsed: cacheEntry.selector_used || "",
      ratingLabel: cacheEntry.rating_label || "",
      ratingCode: cacheEntry.rating_code || "",
      ratingReason: cacheEntry.rating_reason || "",
      ratingSelectorUsed: cacheEntry.rating_selector_used || "",
      isInstrumental: !!cacheEntry.is_instrumental,
      instrumentalSource: String(cacheEntry.instrumental_source || "")
    };

    if (el.lyricsModalExternalLink && backupLyrics.url) {
      el.lyricsModalExternalLink.href = String(backupLyrics.url);
    }

    if (safeRequestId) {
      setLyricsFetchStatus(safeRequestId, "success", "Lyrics loaded from backup cache (may be stale).", {
        lyrics: backupLyrics.lyrics,
        source: backupLyrics.source,
        selectorUsed: backupLyrics.selectorUsed,
        ratingLabel: backupLyrics.ratingLabel,
        ratingCode: backupLyrics.ratingCode,
        ratingReason: backupLyrics.ratingReason,
        ratingSelectorUsed: backupLyrics.ratingSelectorUsed,
        isInstrumental: !!backupLyrics.isInstrumental,
        instrumentalSource: backupLyrics.instrumentalSource || "",
        status: "success",
        updatedAt: new Date().toISOString()
      });
      buildRequestSummary(currentRequests);
      renderRequests(currentRequests);
      renderApprovedQueue();
      if (moderationDetailContext?.requestId === safeRequestId) {
        openModerationReasonModal(moderationDetailContext);
      }
    }

    renderLyricsSuccess(backupLyrics);
    return;
  }

  // No live lyrics and no backup cache.
  if (safeRequestId) {
    const fallbackState = liveResult.status === "api-error" || liveResult.status === "empty" || liveResult.status === "not-configured"
      ? "fallback"
      : "error";
    setLyricsFetchStatus(safeRequestId, fallbackState, liveResult.reason || "Lyrics API did not return live lyrics.", {
      lyrics: "",
      source: liveResult.source || "Lyrics API",
      selectorUsed: liveResult.selectorUsed || "",
      isInstrumental: false,
      instrumentalSource: "",
      status: liveResult.status || fallbackState,
      updatedAt: new Date().toISOString()
    });
    buildRequestSummary(currentRequests);
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
    reason: liveResult.reason || "Live lyrics API failed and no backup cache entry was found."
  });
  return;
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
  setStatus(`Moderator override added: ${request.spotify.artist} - ${request.spotify.name}`);
}

function setRequestAutoSyncStatus(message, tone = "neutral") {
  requestAutoSyncStatusText = String(message || "");
  renderRequestAutoSyncHeaderStatus(tone);
  renderSiteTimerBar();
}

async function runRequestAutoSync(reason = "manual", options = {}) {
  const silent = !!options.silent;

  if (requestAutoSyncInFlight) {
    if (!silent) {
      setStatus("Request sync is already running.");
    }
    return false;
  }

  requestAutoSyncInFlight = true;
  updateRequestSyncControlState();
  setRequestAutoSyncStatus(reason === "manual" ? "Syncing requests now..." : "Auto-sync in progress...", "info");

  try {
    await loadRequests();
    lastRequestSyncAt = new Date();
    const timeText = lastRequestSyncAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const sourceLabel = reason === "manual" ? "manual" : "auto";
    setRequestAutoSyncStatus(`Last sync ${timeText} (${sourceLabel})`, "ok");
    scheduleNextRequestAutoSyncTick();
    return true;
  } catch (error) {
    const message = error?.message || "Request sync failed.";
    setRequestAutoSyncStatus(`Sync failed: ${message}`, "error");
    if (!silent) {
      throw error;
    }
    console.warn("Automatic request sync failed:", error);
    return false;
  } finally {
    requestAutoSyncInFlight = false;
    updateRequestSyncControlState();
  }
}

function stopRequestAutoSyncTimer() {
  if (requestAutoSyncTimer) {
    window.clearInterval(requestAutoSyncTimer);
    requestAutoSyncTimer = null;
  }
  requestAutoSyncNextAtMs = 0;
  stopRequestAutoSyncCountdown();
}

function startRequestAutoSyncTimer() {
  stopRequestAutoSyncTimer();
  updateAutoSyncToggleButton();

  if (!requestAutoSyncEnabled) {
    setRequestAutoSyncStatus("Auto-sync paused by moderator.", "warn");
    setNextRequestSyncStatus("Next sync: paused");
    return;
  }

  const minutes = Math.max(1, Number(CONFIG.requestAutoSyncMinutes || 5));
  setRequestAutoSyncStatus(`Auto-sync every ${minutes} minute(s).`, "neutral");

  requestAutoSyncTimer = window.setInterval(() => {
    void runRequestAutoSync("auto", { silent: true });
  }, minutes * 60 * 1000);

  scheduleNextRequestAutoSyncTick();
}

// ======================================================
// LOAD REQUESTS
// ======================================================
async function loadRequests() {
  if (isLoadingRequests) {
    logConsoleEvent("Moderation", "Request load ignored (already in progress).", null, "warn");
    return;
  }

  isLoadingRequests = true;

  try {
  setStatus("Loading request rows from Google Sheet and DJ local storage...");
  logConsoleEvent("Moderation", "Request load started.", {
    source: "google-sheet-and-dj-storage"
  }, "info");

  let sheetRows = [];
  let sheetError = null;

  try {
    sheetRows = await fetchStudentRequestRows();
  } catch (error) {
    sheetError = error;
    console.warn("Sheet request load failed:", error);
    logConsoleEvent("Moderation", "Google Sheet load failed. Using DJ local requests only.", {
      error: error?.message || error
    }, "warn");
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

  const apiBase = getLyricsApiBaseUrl();

  const shouldRunLivePrefetch = !!apiBase && !!CONFIG.lyricsPrefetchOnLoad;
  const lyricsPrefetch = shouldRunLivePrefetch
    ? await prefetchLyricsForLoadedRequests(enriched)
    : { started: false };

  // Backup-only cache apply when the live scraper is unavailable.
  const shouldApplyBackupCache = !apiBase;
  const lyricsCacheResult = shouldApplyBackupCache
    ? await applyLyricsCacheForLoadedRequests(enriched)
    : { started: false };

  const lyricsSummary = lyricsPrefetch?.started
    ? ` Lyrics (live): ${lyricsPrefetch.success}/${lyricsPrefetch.attempted} fetched, ${lyricsPrefetch.fallback} fallback, ${lyricsPrefetch.failed} failed.`
    : lyricsCacheResult?.started
      ? ` Lyrics (backup cache): ${lyricsCacheResult.success}/${lyricsCacheResult.matched} hits, ${lyricsCacheResult.fallback} fallback.`
      : "";

  if (sheetError) {
    const finalMessage =
      `Loaded ${enriched.length} request(s). Google Sheet was unavailable, DJ local requests are still active.${lyricsSummary}`;
    setStatus(finalMessage);
    logConsoleEvent("Moderation", "Request load completed with Google Sheet fallback.", {
      total: enriched.length,
      lyricsCacheResult,
      lyricsPrefetch
    }, "warn");
    return;
  }

  const finalMessage = `Finished loading ${enriched.length} request(s).${lyricsSummary}`;
  setStatus(finalMessage);
  logConsoleEvent("Moderation", "Request load completed.", {
    total: enriched.length,
    lyricsCacheResult,
    lyricsPrefetch
  }, "success");
  } finally {
    isLoadingRequests = false;
  }
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
  closePlaylistPicker();
}

// ======================================================
// PLAYLIST BUILDER PANEL
// ======================================================
function updatePlaylistBuilderStatus(message) {
  const text = String(message || "").trim();
  if (el.playlistBuilderStatus) {
    el.playlistBuilderStatus.textContent = text || "Ready.";
  }
}

function loadPlaylistBuilderSelectionFromStorage() {
  const storedId = String(persistentStorage.getItem(LS.playlistBuilderPlaylistId) || "").trim();
  const storedName = String(persistentStorage.getItem(LS.playlistBuilderPlaylistName) || "").trim();

  playlistBuilderSelectedPlaylistId = storedId;
  playlistBuilderSelectedPlaylistName = storedName;

  if (el.playlistBuilderSelectedPlaylist) {
    el.playlistBuilderSelectedPlaylist.textContent = storedName || (storedId ? "Selected" : "None");
  }
}

function setPlaylistBuilderSelectedPlaylist(playlistId, playlistName) {
  const safeId = String(playlistId || "").trim();
  const safeName = String(playlistName || "").trim();

  playlistBuilderSelectedPlaylistId = safeId;
  playlistBuilderSelectedPlaylistName = safeName;

  persistentStorage.setItem(LS.playlistBuilderPlaylistId, safeId);
  persistentStorage.setItem(LS.playlistBuilderPlaylistName, safeName);

  if (el.playlistBuilderSelectedPlaylist) {
    el.playlistBuilderSelectedPlaylist.textContent = safeName || (safeId ? "Selected" : "None");
  }

  updatePlaylistBuilderActionState();
}

function openPlaylistBuilderPanel() {
  closeModerationPanel();
  closePlaylistPicker();

  el.playlistBuilderOverlay?.classList.add("mod-is-open");
  el.playlistBuilderBackdrop?.classList.add("mod-is-open");
  document.body.classList.add("mod-panel-open");

  loadPlaylistBuilderSelectionFromStorage();
  updatePlaylistBuilderActionState();

  updatePlaylistBuilderStatus("Choose a playlist, then search Spotify.");
  el.playlistBuilderSearchInput?.focus();
}

function closePlaylistBuilderPanel() {
  el.playlistBuilderOverlay?.classList.remove("mod-is-open");
  el.playlistBuilderBackdrop?.classList.remove("mod-is-open");
  document.body.classList.remove("mod-panel-open");

  updatePlaylistBuilderStatus("Closed.");
}

function updatePlaylistBuilderActionState() {
  const hasPlaylist = !!playlistBuilderSelectedPlaylistId;
  const hasTrack = !!playlistBuilderSelectedTrack?.uri;

  if (el.btnPlaylistBuilderAddSelected) {
    el.btnPlaylistBuilderAddSelected.disabled = !(hasPlaylist && hasTrack);
  }

  if (el.btnPlaylistBuilderBulkAdd) {
    el.btnPlaylistBuilderBulkAdd.disabled = !(hasPlaylist && Array.isArray(playlistBuilderBulkAddQueue) && playlistBuilderBulkAddQueue.length > 0);
  }
}

function extractSpotifyTrackIdLoose(value) {
  const direct = extractSpotifyTrackId(value);
  if (direct) return direct;

  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  // Allow raw Spotify IDs in CSVs (base62 strings are typically 22 chars).
  if (/^[A-Za-z0-9]{10,32}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function renderPlaylistBuilderSearchResults() {
  if (!el.playlistBuilderSearchResults) return;

  if (!Array.isArray(playlistBuilderSearchResults) || !playlistBuilderSearchResults.length) {
    el.playlistBuilderSearchResults.innerHTML = '<div class="empty-state">Search Spotify to get started.</div>';
    return;
  }

  el.playlistBuilderSearchResults.innerHTML = playlistBuilderSearchResults
    .map((track) => {
      const spotify = normalizeSpotifyTrack(track);
      const isExplicit = spotify?.explicit === true;
      const cached = spotify?.id ? playlistBuilderRatingCacheByTrackId.get(spotify.id) : null;
      const ratingShort = cached?.ratingCode || normalizeLyricsRatingCode(cached?.ratingLabel || "");

      return `
        <div class="request-item">
          <div class="request-art-wrap">
            ${spotify?.image
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
              ${escapeHtml(spotify?.album || "Unknown Album")} - ${escapeHtml(msToMinSec(spotify?.durationMs || 0))}
            </div>
            ${ratingShort ? `<div class="request-submitted">Musixmatch rating: ${escapeHtml(ratingShort)}</div>` : ""}
          </div>

          <div class="request-actions">
            <a class="ghost-btn" href="${escapeHtml(spotify?.externalUrl || "#")}" target="_blank" rel="noopener noreferrer">
              Open in Spotify
            </a>
            <button class="playlist-builder-review-btn" data-track-id="${escapeHtml(spotify?.id || "")}">
              Review Rating
            </button>
            <button class="playlist-builder-add-btn" data-track-id="${escapeHtml(spotify?.id || "")}">
              Add to Playlist
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function runPlaylistBuilderSearch() {
  const query = String(el.playlistBuilderSearchInput?.value || "").trim();
  if (!query) {
    playlistBuilderSearchResults = [];
    renderPlaylistBuilderSearchResults();
    updatePlaylistBuilderStatus("Enter a song or artist to search Spotify.");
    return;
  }

  updatePlaylistBuilderStatus(`Searching Spotify for "${query}"...`);

  const tracks = await searchSpotifyTracks(query);
  playlistBuilderSearchResults = tracks;
  renderPlaylistBuilderSearchResults();

  if (!tracks.length) {
    updatePlaylistBuilderStatus("No Spotify tracks matched that search.");
    return;
  }

  updatePlaylistBuilderStatus(`Found ${tracks.length} Spotify track(s). Select one to review rating details.`);
}

async function fetchLyricsMetaFromApi(artist, song) {
  const apiUrl = buildLyricsApiUrl(artist, song);
  if (!apiUrl) {
    return {
      ok: false,
      status: "not-configured",
      reason: "Lyrics API is not configured."
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.lyricsApiTimeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const reason = String(json?.error || "").trim() || `Lyrics API responded with ${response.status}.`;
      return { ok: false, status: "api-error", reason, json };
    }

    return {
      ok: true,
      status: "success",
      json
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === "AbortError" ? "timeout" : "request-failed",
      reason: error?.name === "AbortError" ? "Lyrics API request timed out." : (error?.message || "Lyrics API request failed.")
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchPlaylistBuilderRatingDetails(spotify) {
  const artist = String(spotify?.artist || "").trim();
  const song = String(spotify?.name || "").trim();

  if (!artist || !song) {
    return {
      ratingLabel: "",
      ratingCode: "",
      ratingReason: "",
      ratingSelectorUsed: "",
      isInstrumental: false,
      instrumentalSource: "",
      musixmatchUrl: "",
      source: "missing-metadata"
    };
  }

  if (!lyricsCacheSnapshot) {
    await fetchLyricsCacheSnapshot({ quiet: true });
  }

  const cacheEntry = getLyricsCacheEntryByArtistSong(artist, song, lyricsCacheSnapshot);
  if (cacheEntry) {
    const ratingLabel = String(cacheEntry.rating_label || "").trim();
    const ratingCode = String(cacheEntry.rating_code || "").trim();
    const ratingReason = String(cacheEntry.rating_reason || "").trim();
    const ratingSelectorUsed = String(cacheEntry.rating_selector_used || "").trim();
    const isInstrumental = !!cacheEntry.is_instrumental;
    const instrumentalSource = String(cacheEntry.instrumental_source || "").trim();
    const musixmatchUrl = String(cacheEntry.musixmatch_url || cacheEntry.url || "").trim();

    if (ratingLabel || ratingCode || ratingReason || isInstrumental) {
      return {
        ratingLabel,
        ratingCode,
        ratingReason,
        ratingSelectorUsed,
        isInstrumental,
        instrumentalSource,
        musixmatchUrl,
        source: "lyrics-cache.json"
      };
    }
  }

  const apiResult = await fetchLyricsMetaFromApi(artist, song);
  if (apiResult.ok) {
    const json = apiResult.json || {};
    return {
      ratingLabel: String(json?.rating_label || "").trim(),
      ratingCode: String(json?.rating_code || "").trim(),
      ratingReason: String(json?.rating_reason || "").trim(),
      ratingSelectorUsed: String(json?.rating_selector_used || "").trim(),
      isInstrumental: !!json?.is_instrumental,
      instrumentalSource: String(json?.instrumental_source || "").trim(),
      musixmatchUrl: String(json?.url || "").trim(),
      source: "Lyrics API"
    };
  }

  return {
    ratingLabel: "",
    ratingCode: "",
    ratingReason: "",
    ratingSelectorUsed: "",
    isInstrumental: false,
    instrumentalSource: "",
    musixmatchUrl: "",
    source: apiResult.status || "unknown"
  };
}

function renderPlaylistBuilderReview(track, details) {
  if (!el.playlistBuilderReview) return;

  if (!track) {
    el.playlistBuilderReview.innerHTML = '<div class="empty-state">Select a search result to preview rating details.</div>';
    return;
  }

  const spotify = normalizeSpotifyTrack(track);
  const ratingCode = normalizeLyricsRatingCode(details?.ratingCode || "") || normalizeLyricsRatingCode(details?.ratingLabel || "");
  const ratingShort = ratingCode || (String(details?.ratingLabel || "").replace(/^(?:Musixmatch\s+)?Rating:\s*/i, "").trim() || "Unknown");
  const ratingTone = statusTagToneForLyricsRating(ratingCode);
  const musixmatchUrl = String(details?.musixmatchUrl || "").trim();
  const reason = String(details?.ratingReason || "").trim();
  const selectorUsed = String(details?.ratingSelectorUsed || "").trim();
  const isInstrumental = !!details?.isInstrumental;
  const instrumentalSource = String(details?.instrumentalSource || "").trim();

  el.playlistBuilderReview.innerHTML = `
    <div class="request-item">
      <div class="request-art-wrap">
        ${spotify?.image
          ? `<img class="request-art" src="${escapeHtml(spotify.image)}" alt="${escapeHtml(spotify.name)} cover art">`
          : `<div class="request-art request-art-placeholder">No Art</div>`
        }
      </div>

      <div class="request-main">
        <div class="request-title-row">
          <div class="request-song">${escapeHtml(spotify?.name || "Unknown track")}</div>
        </div>
        <div class="request-artist">${escapeHtml(spotify?.artist || "Unknown artist")}</div>
        <div class="request-meta">
          ${escapeHtml(spotify?.album || "Unknown Album")} - ${escapeHtml(msToMinSec(spotify?.durationMs || 0))}
        </div>

        <div class="request-status-tags moderation-tags-wrap" style="margin-top: 10px;">
          ${statusTagHtml(`Musixmatch Rating: ${ratingShort}`, ratingTone)}
          ${isInstrumental ? statusTagHtml("Instrumental (Musixmatch)", "neutral") : ""}
        </div>

        <details class="moderation-reason-details" open style="margin-top: 10px;">
          <summary>Musixmatch rating explanation</summary>
          <div class="summary-text">
            ${escapeHtml(reason || "No rating explanation was scraped for this track.")}
          </div>
        </details>

        <div class="summary-text" style="margin-top: 10px;">
          Source: ${escapeHtml(details?.source || "unknown")}${selectorUsed ? ` | ${escapeHtml(selectorUsed)}` : ""}
          ${isInstrumental && instrumentalSource ? `<br/>Instrumental source: ${escapeHtml(instrumentalSource)}` : ""}
        </div>
      </div>

      <div class="request-actions">
        <a class="ghost-btn" href="${escapeHtml(spotify?.externalUrl || "#")}" target="_blank" rel="noopener noreferrer">
          Open in Spotify
        </a>
        ${musixmatchUrl ? `<a class="ghost-btn" href="${escapeHtml(musixmatchUrl)}" target="_blank" rel="noopener noreferrer">Open Musixmatch</a>` : ""}
      </div>
    </div>
  `;
}

async function selectPlaylistBuilderTrack(trackId) {
  const safeTrackId = String(trackId || "").trim();
  if (!safeTrackId) return;

  const track = playlistBuilderSearchResults.find((item) => String(item?.id || "") === safeTrackId);
  if (!track) {
    updatePlaylistBuilderStatus("Selected search result is no longer available.");
    return;
  }

  playlistBuilderSelectedTrackId = safeTrackId;
  playlistBuilderSelectedTrack = track;

  updatePlaylistBuilderStatus("Fetching Musixmatch rating details...");
  if (el.playlistBuilderReview) {
    el.playlistBuilderReview.innerHTML = '<div class="empty-state">Loading rating details...</div>';
  }
  updatePlaylistBuilderActionState();

  let details = playlistBuilderRatingCacheByTrackId.get(safeTrackId);
  if (!details) {
    details = await fetchPlaylistBuilderRatingDetails(normalizeSpotifyTrack(track));
    playlistBuilderRatingCacheByTrackId.set(safeTrackId, details);
  }

  renderPlaylistBuilderReview(track, details);
  updatePlaylistBuilderActionState();
  updatePlaylistBuilderStatus("Review rating details, then add to the selected playlist.");
}

async function addPlaylistBuilderSelectedToPlaylist() {
  const playlistId = String(playlistBuilderSelectedPlaylistId || "").trim();
  const trackUri = String(playlistBuilderSelectedTrack?.uri || "").trim();

  if (!playlistId) {
    updatePlaylistBuilderStatus("Choose a playlist first.");
    return;
  }

  if (!trackUri) {
    updatePlaylistBuilderStatus("Select a track first.");
    return;
  }

  const trackLabel = `${playlistBuilderSelectedTrack?.artist || "Unknown"} - ${playlistBuilderSelectedTrack?.name || "Unknown"}`;

  try {
    updatePlaylistBuilderStatus(`Adding to playlist: ${trackLabel}...`);
    await addTrackToPlaylist(playlistId, trackUri);
    updatePlaylistBuilderStatus(`Added: ${trackLabel}`);
  } catch (error) {
    updatePlaylistBuilderStatus(error?.message || "Failed to add track to playlist.");
  }
}

function parsePlaylistBuilderCsvText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];

  const ids = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const cells = String(line || "").split(",");
    for (const cell of cells) {
      const id = extractSpotifyTrackIdLoose(cell);
      if (id) ids.push(id);
    }
  }

  return [...new Set(ids)];
}

function renderPlaylistBuilderBulkList() {
  if (!el.playlistBuilderBulkList) return;

  const ids = Array.isArray(playlistBuilderBulkParsedTrackIds) ? playlistBuilderBulkParsedTrackIds : [];
  if (!ids.length) {
    el.playlistBuilderBulkList.innerHTML = '<div class="empty-state">Parsed tracks will appear here.</div>';
    return;
  }

  el.playlistBuilderBulkList.innerHTML = ids
    .map((trackId) => {
      const track = playlistBuilderBulkTracksById?.get(trackId) || null;
      const spotify = track ? normalizeSpotifyTrack(track) : null;
      const label = spotify ? `${spotify.artist} - ${spotify.name}` : `Track ID: ${trackId}`;
      const meta = spotify ? `${spotify.album || "Unknown Album"} - ${msToMinSec(spotify.durationMs || 0)}` : "Not loaded yet";

      return `
        <div class="request-item">
          <div class="request-art-wrap">
            ${spotify?.image
              ? `<img class="request-art" src="${escapeHtml(spotify.image)}" alt="${escapeHtml(spotify.name)} cover art">`
              : `<div class="request-art request-art-placeholder">${spotify ? "No Art" : "--"}</div>`
            }
          </div>
          <div class="request-main">
            <div class="request-song">${escapeHtml(label)}</div>
            <div class="request-meta">${escapeHtml(meta)}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

function readPlaylistBuilderBulkInputText() {
  const pasted = String(el.playlistBuilderCsvText?.value || "");
  if (pasted.trim()) return pasted;
  return "";
}

async function parsePlaylistBuilderBulkInput() {
  let text = readPlaylistBuilderBulkInputText();

  if (!text && el.playlistBuilderCsvFile?.files?.length) {
    const file = el.playlistBuilderCsvFile.files[0];
    text = await file.text();
    if (el.playlistBuilderCsvText) {
      el.playlistBuilderCsvText.value = text.slice(0, 200000);
    }
  }

  const ids = parsePlaylistBuilderCsvText(text);
  playlistBuilderBulkParsedTrackIds = ids;
  playlistBuilderBulkTracksById = new Map();
  playlistBuilderBulkAddQueue = [];

  if (el.playlistBuilderBulkStatus) {
    el.playlistBuilderBulkStatus.textContent = ids.length ? `Parsed ${ids.length} unique Spotify track ID(s).` : "No Spotify track URLs were found in that CSV.";
  }

  renderPlaylistBuilderBulkList();
  updatePlaylistBuilderActionState();
}

async function loadPlaylistBuilderBulkTracks() {
  if (playlistBuilderBulkLoadInFlight) return;

  const ids = Array.isArray(playlistBuilderBulkParsedTrackIds) ? playlistBuilderBulkParsedTrackIds : [];
  if (!ids.length) {
    if (el.playlistBuilderBulkStatus) el.playlistBuilderBulkStatus.textContent = "Parse a CSV first.";
    return;
  }

  playlistBuilderBulkLoadInFlight = true;
  try {
    if (el.playlistBuilderBulkStatus) el.playlistBuilderBulkStatus.textContent = `Loading ${ids.length} Spotify track(s)...`;

    const fetched = await getTracksByIds(ids);
    playlistBuilderBulkTracksById = fetched;

    const loaded = Array.from(fetched.values()).filter(Boolean);
    playlistBuilderBulkAddQueue = loaded
      .map((track) => normalizeSpotifyTrack(track))
      .filter((spotify) => spotify?.uri);

    if (el.playlistBuilderBulkStatus) {
      el.playlistBuilderBulkStatus.textContent = `Loaded ${playlistBuilderBulkAddQueue.length}/${ids.length} track(s) from Spotify.`;
    }

    renderPlaylistBuilderBulkList();
    updatePlaylistBuilderActionState();
  } catch (error) {
    if (el.playlistBuilderBulkStatus) {
      el.playlistBuilderBulkStatus.textContent = error?.message || "Failed to load tracks from Spotify.";
    }
  } finally {
    playlistBuilderBulkLoadInFlight = false;
  }
}

async function addPlaylistBuilderBulkTracksToPlaylist() {
  if (playlistBuilderBulkAddInFlight) return;

  const playlistId = String(playlistBuilderSelectedPlaylistId || "").trim();
  if (!playlistId) {
    if (el.playlistBuilderBulkStatus) el.playlistBuilderBulkStatus.textContent = "Choose a playlist first.";
    return;
  }

  const queue = Array.isArray(playlistBuilderBulkAddQueue) ? playlistBuilderBulkAddQueue : [];
  if (!queue.length) {
    if (el.playlistBuilderBulkStatus) el.playlistBuilderBulkStatus.textContent = "Load tracks first.";
    return;
  }

  playlistBuilderBulkAddInFlight = true;
  try {
    let added = 0;
    for (let i = 0; i < queue.length; i += 1) {
      const spotify = queue[i];
      if (!spotify?.uri) continue;

      if (el.playlistBuilderBulkStatus) {
        el.playlistBuilderBulkStatus.textContent = `Adding ${i + 1}/${queue.length}: ${spotify.artist} - ${spotify.name}`;
      }

      await addTrackToPlaylist(playlistId, spotify.uri);
      added += 1;
    }

    if (el.playlistBuilderBulkStatus) {
      el.playlistBuilderBulkStatus.textContent = `Done. Added ${added}/${queue.length} track(s) to the selected playlist.`;
    }
  } catch (error) {
    if (el.playlistBuilderBulkStatus) {
      el.playlistBuilderBulkStatus.textContent = error?.message || "Bulk add failed.";
    }
  } finally {
    playlistBuilderBulkAddInFlight = false;
  }
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
      await runRequestAutoSync("manual");
      setStatus("Manual request sync completed.");
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Failed to sync requests.");
    }
  });

  el.btnToggleAutoSync?.addEventListener("click", () => {
    toggleRequestAutoSync();
  });
  el.btnRefreshPlayback?.addEventListener("click", async () => {
    try {
      await refreshPlayback();
      setStatus("Player refreshed.");
    } catch (error) {
      setStatus(error?.message || "Failed to refresh playback.");
    }
  });

  el.btnPlayPlaylistPicker?.addEventListener("click", async () => {
    try {
      await openPlaylistPicker("start", false);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not open playlist picker.");
    }
  });

  // Playlist Builder panel
  el.btnOpenPlaylistBuilder?.addEventListener("click", () => {
    openPlaylistBuilderPanel();
  });

  el.btnPlaylistBuilderClose?.addEventListener("click", () => closePlaylistBuilderPanel());
  el.playlistBuilderBackdrop?.addEventListener("click", () => closePlaylistBuilderPanel());

  el.btnPlaylistBuilderChoosePlaylist?.addEventListener("click", async () => {
    try {
      await openPlaylistPicker("builder", false);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not open playlist picker for Playlist Builder.");
    }
  });

  el.btnPlaylistBuilderSearch?.addEventListener("click", async () => {
    try {
      await runPlaylistBuilderSearch();
    } catch (error) {
      console.error(error);
      updatePlaylistBuilderStatus(error?.message || "Spotify search failed.");
    }
  });

  el.playlistBuilderSearchInput?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    try {
      await runPlaylistBuilderSearch();
    } catch (error) {
      console.error(error);
      updatePlaylistBuilderStatus(error?.message || "Spotify search failed.");
    }
  });

  el.playlistBuilderSearchResults?.addEventListener("click", async (event) => {
    const reviewBtn = event.target.closest(".playlist-builder-review-btn");
    const addBtn = event.target.closest(".playlist-builder-add-btn");

    if (reviewBtn) {
      await selectPlaylistBuilderTrack(reviewBtn.dataset.trackId || "");
      return;
    }

    if (addBtn) {
      await selectPlaylistBuilderTrack(addBtn.dataset.trackId || "");
      await addPlaylistBuilderSelectedToPlaylist();
    }
  });

  el.btnPlaylistBuilderAddSelected?.addEventListener("click", async () => {
    await addPlaylistBuilderSelectedToPlaylist();
  });

  el.btnPlaylistBuilderBulkParse?.addEventListener("click", async () => {
    try {
      await parsePlaylistBuilderBulkInput();
    } catch (error) {
      console.error(error);
      if (el.playlistBuilderBulkStatus) {
        el.playlistBuilderBulkStatus.textContent = error?.message || "Failed to parse CSV.";
      }
    }
  });

  el.btnPlaylistBuilderBulkLoad?.addEventListener("click", async () => {
    await loadPlaylistBuilderBulkTracks();
  });

  el.btnPlaylistBuilderBulkAdd?.addEventListener("click", async () => {
    await addPlaylistBuilderBulkTracksToPlaylist();
  });

  el.btnAddApprovedToQueue?.addEventListener("click", async () => {
    try {
      const item = await addSelectedApprovedToQueue();
      setStatus(`Added to queue: ${item?.spotify?.artist || "Unknown Artist"} - ${item?.spotify?.name || "Unknown Song"}`);
      logConsoleEvent("Moderation", "Approved song added to active queue.", {
        requestId: item?.requestId || "",
        track: item?.spotify?.name || "Unknown Song"
      }, "success");
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
    const statusEditButton = event.target.closest(".mod-status-edit-btn");
    const approveButton = event.target.closest(".approve-btn");
    const rejectButton = event.target.closest(".reject-btn");
    const moderationDetailsButton = event.target.closest(".moderation-details-btn");

    if (statusEditButton) {
      applyStatusTagEdit(
        statusEditButton.dataset.requestId || "",
        statusEditButton.dataset.editField || ""
      );
      return;
    }

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
    const statusEditButton = event.target.closest(".mod-status-edit-btn");
    const removeButton = event.target.closest(".remove-approved-btn");
    const queueItem = event.target.closest(".queue-item[data-queue-index]");

    if (statusEditButton) {
      applyStatusTagEdit(
        statusEditButton.dataset.requestId || "",
        statusEditButton.dataset.editField || ""
      );
      return;
    }

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
    const statusEditButton = event.target.closest(".mod-status-edit-btn");
    const detailButton = event.target.closest(".approved-moderation-details-btn");

    if (statusEditButton) {
      applyStatusTagEdit(
        statusEditButton.dataset.requestId || "",
        statusEditButton.dataset.editField || ""
      );
      return;
    }

    if (!detailButton) return;

    openModerationDetailsByRequestId(detailButton.dataset.requestId || "");
  });

  el.btnAddSelectedToPlaylistPicker?.addEventListener("click", async () => {
    try {
      await openPlaylistPicker("add", false);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not open playlist picker for add-to-playlist.");
    }
  });

  el.btnOpenModeration?.addEventListener("click", () => openModerationPanel());
  el.btnCloseModeration?.addEventListener("click", () => closeModerationPanel());
  document.getElementById("modBackdrop")?.addEventListener("click", () => closeModerationPanel());

  el.btnCloseModerationReason?.addEventListener("click", () => closeModerationReasonModal());
  el.moderationReasonBackdrop?.addEventListener("click", () => closeModerationReasonModal());
  el.moderationReasonBody?.addEventListener("click", (event) => {
    const bypassButton = event.target.closest(".moderation-bypass-btn");
    if (bypassButton) {
      applyModerationBypass(
        bypassButton.dataset.requestId || "",
        bypassButton.dataset.bypassField || ""
      );
      return;
    }

    const statusEditButton = event.target.closest(".mod-status-edit-btn");
    if (!statusEditButton) return;

    applyStatusTagEdit(
      statusEditButton.dataset.requestId || "",
      statusEditButton.dataset.editField || ""
    );
  });

  el.btnCloseLyricsModal?.addEventListener("click", () => closeLyricsModal());
  el.lyricsBackdrop?.addEventListener("click", () => closeLyricsModal());

  el.btnClosePlaylistPicker?.addEventListener("click", () => closePlaylistPicker());
  el.playlistPickerBackdrop?.addEventListener("click", () => closePlaylistPicker());
  el.btnRefreshPlaylistPicker?.addEventListener("click", async () => {
    try {
      await openPlaylistPicker(playlistPickerContext?.mode || "start", true);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not refresh playlists.");
    }
  });

  el.playlistPickerList?.addEventListener("click", async (event) => {
    const playlistButton = event.target.closest(".playlist-picker-item");
    if (!playlistButton) return;

    try {
      await handlePlaylistPickerSelection(
        playlistButton.dataset.playlistId || "",
        playlistButton.dataset.playlistName || ""
      );
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not apply playlist picker selection.");
    }
  });

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
      await refreshPlayback();
      scheduleFastPlaybackSync();
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

      // Optimistic UI response to keep controls feeling instant.
      const nextPlaybackState = !isPlaybackActive;
      isPlaybackActive = nextPlaybackState;
      updatePlaybackStateLabel();
      if (nextPlaybackState) {
        localProgressLastTickAt = performance.now();
        startLocalProgressTimer();
      } else {
        stopLocalProgressTimer();
      }

      await togglePlayPause();
      await refreshPlayback();
      scheduleFastPlaybackSync();
      setStatus(isPlaybackActive ? "Playback resumed." : "Playback paused.");
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not toggle playback.");
      await refreshPlayback();
    } finally {
      setTransportBusy(false);
    }
  });

  el.btnNextTrack?.addEventListener("click", async () => {
    try {
      setTransportBusy(true);
      await skipToNextTrack();
      setStatus("Skipped to next track.");
      await refreshPlayback();
      scheduleFastPlaybackSync();
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
      localProgressLastTickAt = performance.now();
      setStatus(`Seeked to ${msToMinSec(nextProgressMs)}.`);
      scheduleFastPlaybackSync([160, 520]);
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
      scheduleFastPlaybackSync([220, 700]);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not change playback volume.");
      await refreshPlayback();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (el.playlistPickerModal?.classList.contains("playlist-picker-is-open")) {
      closePlaylistPicker();
      return;
    }

    if (el.playlistBuilderOverlay?.classList.contains("mod-is-open")) {
      closePlaylistBuilderPanel();
      return;
    }

    if (el.lyricsModal?.classList.contains("lyrics-is-open")) {
      closeLyricsModal();
      return;
    }

    if (el.moderationReasonModal?.classList.contains("moderation-reason-is-open")) {
      closeModerationReasonModal();
      return;
    }

    closeModerationPanel();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (!playbackPollingActive) return;
    if (playbackTimer) window.clearTimeout(playbackTimer);
    playbackTimer = null;
    void playbackPollTick();
  });
}

// ======================================================
// AUTO REFRESH PLAYBACK
// ======================================================
let playbackPollingActive = false;

async function playbackPollTick() {
  if (!playbackPollingActive) return;

  const baseDelayMs = Math.max(1000, Number(CONFIG.playbackPollMs || 2500));
  const delayMs = document.hidden ? Math.max(15000, baseDelayMs) : baseDelayMs;

  try {
    await refreshPlayback();
  } catch (error) {
    console.warn("Playback poll failed:", error);
  }

  if (!playbackPollingActive) return;
  playbackTimer = window.setTimeout(playbackPollTick, delayMs);
}

function startPlaybackPolling() {
  stopPlaybackPolling();

  playbackPollingActive = true;
  void playbackPollTick();
}

function stopPlaybackPolling() {
  playbackPollingActive = false;
  if (playbackTimer) window.clearTimeout(playbackTimer);
  playbackTimer = null;
}

// ======================================================
// INIT
// ======================================================
async function init() {
  clearLegacyAuthStorage();
  ensureStorageDefaults();
  applyExternalModerationWordlists();
  enforceSpotifyScopesFingerprint();
  loadModerationOverridesFromStorage();
  loadRequestAutoSyncPreference();
  wireStaticEvents();
  updateAutoSyncToggleButton();
  updateRequestSyncControlState();
  updateRequestAutoSyncCountdown();
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

  try {
    await fetchLyricsCacheSnapshot();
  } catch (error) {
    console.warn("Initial lyrics cache fetch failed:", error);
  }

  const hasToken = hasActiveSpotifyLogin || !!authGet(LS.accessToken);
  if (hasToken) {
    startRequestAutoSyncTimer();
    await runRequestAutoSync("startup", { silent: true });
    startPlaybackPolling();
  } else {
    stopRequestAutoSyncTimer();
    setRequestAutoSyncStatus("Login to enable request sync.", "warn");
    setNextRequestSyncStatus("Next sync: login required");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    setStatus(error?.message || "App failed to initialize.");
  });
});
