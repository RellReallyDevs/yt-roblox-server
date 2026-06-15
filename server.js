// ─── YouTube → Roblox Bridge Server ──────────────────────────────────────
const express = require("express");
const cors    = require("cors");
const https   = require("https");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = {};
const userMap  = {};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── Health check ──────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ status: "ok", sessions: Object.keys(sessions).length });
});

// ── Thumbnail proxy ───────────────────────────────────────────────────────
// Roblox can't load i.ytimg.com directly — we proxy it through our server
// Roblox calls: GET /thumbnail/:videoId
// We fetch the YouTube thumbnail and pipe it back

app.get("/thumbnail/:videoId", (req, res) => {
  const { videoId } = req.params;
  const url = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  https.get(url, (imgRes) => {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    imgRes.pipe(res);
  }).on("error", (err) => {
    log(`THUMB ERROR ${videoId}: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch thumbnail" });
  });
});

// ── Extension → Server ────────────────────────────────────────────────────

app.post("/update", (req, res) => {
  const { token, videoId, title, channel, thumbnail, duration, position, paused, timestamp } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  const key = token.trim().toLowerCase();
  sessions[key] = {
    videoId,
    title,
    channel,
    // Store our proxy URL instead of the raw YouTube URL
    thumbnail: videoId ? `/thumbnail/${videoId}` : null,
    duration,
    position,
    paused,
    timestamp,
    updatedAt: Date.now()
  };

  log(`UPDATE  [${key}] ${paused ? "⏸" : "▶"} ${title?.slice(0, 40)}`);
  res.json({ ok: true });
});

// ── Roblox → Server ───────────────────────────────────────────────────────

app.get("/status/:robloxUserId", (req, res) => {
  const token = userMap[req.params.robloxUserId];
  if (!token) return res.json({ linked: false });

  const data = sessions[token];
  if (!data) return res.json({ linked: true, playing: false });

  const stale = Date.now() - (data.updatedAt || 0) > 5 * 60 * 1000;
  if (stale) return res.json({ linked: true, playing: false });

  res.json({ linked: true, playing: true, ...data });
});

// ── Account Linking ───────────────────────────────────────────────────────

app.post("/link", (req, res) => {
  const { code, robloxUserId } = req.body;
  if (!code || !robloxUserId) return res.status(400).json({ error: "Missing code or robloxUserId" });

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
