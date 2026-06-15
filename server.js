// ─── YouTube → Roblox Bridge Server ──────────────────────────────────────
const express = require("express");
const cors    = require("cors");
const https   = require("https");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions  = {};
const userMap   = {};
const commands  = {}; // token → pending command

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

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

// ── Extension polls for pending commands ──────────────────────────────────
// Extension calls GET /commands/:token every 2 seconds
// If there's a pending command, return it and clear it

app.get("/commands/:token", (req, res) => {
  const key     = req.params.token.trim().toLowerCase();
  const pending = commands[key] || null;
  if (pending) delete commands[key]; // one-shot
  res.json({ command: pending });
});

// ── Roblox → Server (send a playback command) ─────────────────────────────

app.post("/command", (req, res) => {
  const { robloxUserId, action } = req.body;
  // action: "play_pause" | "next" | "previous" | "volume_up" | "volume_down"
  if (!robloxUserId || !action) return res.status(400).json({ error: "Missing fields" });

  const token = userMap[robloxUserId];
  if (!token) return res.status(404).json({ error: "User not linked" });

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
