// ─── YouTube → Roblox Bridge Server ──────────────────────────────────────
const express = require("express");
const cors    = require("cors");
const https   = require("https");
const http    = require("http");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = {};
const userMap  = {};
const commands = {};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── Piped API instances (tried in order, falls back if one is down) ────────

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://pipedapi.drgns.space",
  "https://piped-api.privacy.com.de",
];

// ── HTTP fetch helper ──────────────────────────────────────────────────────

const fetchJson = (url) => new Promise((resolve, reject) => {
  const lib = url.startsWith("https") ? https : http;
  const req = lib.get(url, { headers: { "User-Agent": "AURA-Roblox-Bridge/1.0" } }, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
  req.on("error", reject);
  req.setTimeout(5000, () => { req.destroy(); reject(new Error("Timeout")); });
});

// ── Search with automatic instance fallback ───────────────────────────────

const searchYouTube = async (query) => {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url  = `${instance}/search?q=${encodeURIComponent(query)}&filter=videos`;
      const data = await fetchJson(url);

      if (!data.items || !Array.isArray(data.items)) continue;

      // Normalize results — Piped returns url as "/watch?v=ID"
      const results = data.items
        .filter(v => v.type === "stream" || v.url?.includes("watch"))
        .slice(0, 8)
        .map(v => ({
          videoId:  v.url?.split("v=")?.[1]?.split("&")?.[0] || "",
          title:    v.title    || "Unknown",
          channel:  v.uploaderName || "Unknown",
          duration: v.duration || 0,
          views:    v.views    || 0,
        }))
        .filter(v => v.videoId);

      log(`SEARCH  [${instance}] "${query}" → ${results.length} results`);
      return results;
    } catch (err) {
      log(`SEARCH  [${instance}] failed: ${err.message} — trying next`);
    }
  }
  throw new Error("All Piped instances failed");
};

// ── Health check ──────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ status: "ok", sessions: Object.keys(sessions).length });
});

// ── Thumbnail proxy ───────────────────────────────────────────────────────

app.get("/thumbnail/:videoId", (req, res) => {
  const url = `https://i.ytimg.com/vi/${req.params.videoId}/hqdefault.jpg`;
  https.get(url, (imgRes) => {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    imgRes.pipe(res);
  }).on("error", () => res.status(500).json({ error: "Failed" }));
});

// ── Search endpoint (called by Roblox) ───────────────────────────────────

app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing query" });

  try {
    const results = await searchYouTube(query);
    res.json({ results });
  } catch (err) {
    log(`SEARCH ERROR: ${err.message}`);
    res.status(503).json({ error: "Search unavailable", results: [] });
  }
});

// ── Extension → Server (video update) ────────────────────────────────────

app.post("/update", (req, res) => {
  const { token, videoId, title, channel, duration, position, paused, timestamp } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  const key = token.trim().toLowerCase();
  sessions[key] = {
    videoId,
    title,
    channel,
    thumbnail: videoId ? `/thumbnail/${videoId}` : null,
    duration,
    position,
    paused,
    timestamp,
    updatedAt: Date.now(),
  };

  log(`UPDATE  [${key}] ${paused ? "⏸" : "▶"} ${title?.slice(0, 40)}`);
  res.json({ ok: true });
});

// ── Extension polls for commands ──────────────────────────────────────────

app.get("/commands/:token", (req, res) => {
  const key     = req.params.token.trim().toLowerCase();
  const pending = commands[key] || null;
  if (pending) delete commands[key];
  res.json({ command: pending });
});

// ── Roblox sends a playback command ──────────────────────────────────────

app.post("/command", (req, res) => {
  const { robloxUserId, action } = req.body;
  if (!robloxUserId || !action) return res.status(400).json({ error: "Missing fields" });

  const token = userMap[robloxUserId];
  if (!token) return res.status(404).json({ error: "User not linked" });

  // For load_video, action is "load_video:VIDEO_ID"
  commands[token] = action;
  log(`COMMAND [${token}] ${action}`);
  res.json({ ok: true });
});

// ── Roblox polls player status ────────────────────────────────────────────

app.get("/status/:robloxUserId", (req, res) => {
  const token = userMap[req.params.robloxUserId];
  if (!token) return res.json({ linked: false });

  const data = sessions[token];
  if (!data) return res.json({ linked: true, playing: false });

  const stale = Date.now() - (data.updatedAt || 0) > 5 * 60 * 1000;
  if (stale) return res.json({ linked: true, playing: false });

  res.json({ linked: true, playing: true, ...data });
});

// ── Account linking ───────────────────────────────────────────────────────

app.post("/link", (req, res) => {
  const { code, robloxUserId } = req.body;
  if (!code || !robloxUserId) return res.status(400).json({ error: "Missing fields" });

  const token = code.trim().toLowerCase();
  userMap[robloxUserId] = token;
  log(`LINKED  robloxId=${robloxUserId} → token=${token}`);
  res.json({ ok: true });
});

app.get("/linked/:robloxUserId", (req, res) => {
  res.json({ linked: !!userMap[req.params.robloxUserId] });
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => log(`Server running on port ${PORT}`));
