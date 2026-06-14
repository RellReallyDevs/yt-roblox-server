// ─── YouTube → Roblox Bridge ─── content.js ───────────────────────────────
// Runs on every youtube.com/watch?v=... page.
// Scrapes the current video's metadata and sends it to the background worker
// whenever the video or its playback state changes.

(() => {
  // ── Helpers ──────────────────────────────────────────────────────────────

  const getVideoId = () => new URLSearchParams(window.location.search).get("v");

  const getTitle = () => {
    // YouTube renders the title in different elements depending on layout
    return (
      document.querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string")
        ?.innerText ||
      document.querySelector("h1.style-scope.ytd-watch-metadata yt-formatted-string")
        ?.innerText ||
      document.title.replace(" - YouTube", "").trim() ||
      null
    );
  };

  const getChannel = () => {
    return (
      document.querySelector("#channel-name a")?.innerText ||
      document.querySelector("ytd-channel-name a")?.innerText ||
      null
    );
  };

  const getThumbnail = (videoId) =>
    videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;

  const getVideoEl = () => document.querySelector("video");

  const getDuration = () => {
    const v = getVideoEl();
    return v ? Math.floor(v.duration) : null;
  };

  const getPosition = () => {
    const v = getVideoEl();
    return v ? Math.floor(v.currentTime) : null;
  };

  const isPaused = () => {
    const v = getVideoEl();
    return v ? v.paused : true;
  };

  // ── State ─────────────────────────────────────────────────────────────────

  let lastPayload = null;
  let pollTimer = null;

  // ── Core send function ────────────────────────────────────────────────────

  const sendUpdate = (overridePaused) => {
    const videoId = getVideoId();
    if (!videoId) return;

    const paused = overridePaused !== undefined ? overridePaused : isPaused();

    const payload = {
      type: "YT_NOW_PLAYING",
      videoId,
      title: getTitle(),
      channel: getChannel(),
      thumbnail: getThumbnail(videoId),
      duration: getDuration(),
      position: getPosition(),
      paused,
      url: window.location.href,
      timestamp: Date.now(),
    };

    // Avoid spamming identical updates (only position changes get through)
    const sig = `${payload.videoId}|${payload.paused}|${payload.position}`;
    if (sig === lastPayload) return;
    lastPayload = sig;

    chrome.runtime.sendMessage(payload).catch(() => {
      // Extension context may be invalidated on navigation — safe to ignore
    });
  };

  // ── Event listeners ───────────────────────────────────────────────────────

  const attachVideoListeners = () => {
    const video = getVideoEl();
    if (!video || video._robloxBridged) return;
    video._robloxBridged = true;

    video.addEventListener("play",  () => sendUpdate(false));
    video.addEventListener("pause", () => sendUpdate(true));
    video.addEventListener("ended", () => sendUpdate(true));

    // Send a position update every 15 s while playing so Roblox can show a progress bar
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!isPaused()) sendUpdate();
    }, 15_000);
  };

  // ── YouTube is a SPA — watch for navigation changes ───────────────────────

  // Initial attach (page may already have a video element)
  const tryAttach = () => {
    attachVideoListeners();
    sendUpdate();
  };

  // Wait for the video element if it hasn't mounted yet
  const observer = new MutationObserver(() => {
    if (getVideoEl()) {
      tryAttach();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // YouTube fires "yt-navigate-finish" for in-app navigation (no real page reload)
  window.addEventListener("yt-navigate-finish", () => {
    lastPayload = null; // force a fresh send on navigation
    setTimeout(tryAttach, 1000); // give React a moment to render
  });

  // Also handle standard page load
  if (document.readyState === "complete") {
    tryAttach();
  } else {
    window.addEventListener("load", tryAttach);
  }
})();
