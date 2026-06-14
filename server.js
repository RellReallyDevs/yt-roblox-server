// ─── YouTube → Roblox Bridge Server ──────────────────────────────────────
const express = require("express");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = {};
const userMap  = {};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// Health check
app.get("/", (_req, res) => {
  res.json({ status: "ok", sessions: Object.keys(sessions).length });
});

// Extension POSTs video updates here
app.post("/update", (req, res) => {
  const { token, videoId, title, channel, thumbnail, duration, position, paused, timestamp } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  sessions[token] = { videoId, title, channel, thumbnail, duration, position, paused, timestamp, updatedAt: Date.now() };
  log(`UPDATE  [${token}] ${paused ? "⏸" : "▶"} ${title?.slice(0, 40)}`);
  res.json({ ok: true });
});

// Roblox polls this to get a player's current video
app.get("/status/:robloxUserId", (req, res) => {
  const token = userMap[req.params.robloxUserId];
  if (!token) return res.json({ linked: false });

  const data = sessions[token];
  if (!data) return res.json({ linked: true, playing: false });

  const stale = Date.now() - (data.updatedAt || 0) > 5 * 60 * 1000;
  if (stale) return res.json({ linked: true, playing: false });

  res.json({ linked: true, playing: true, ...data });
});

// Roblox calls this when player types /link <token> in chat
// The token is whatever the user typed into the browser extension popup
app.post("/link", (req, res) => {
  const { code, robloxUserId } = req.body;
  if (!code || !robloxUserId) return res.status(400).json({ error: "Missing code or robloxUserId" });

  // Token is used directly — no pre-registration step needed
  userMap[robloxUserId] = code.trim();

  log(`LINKED  robloxId=${robloxUserId} → token=${code.trim()}`);
  res.json({ ok: true });
});

// Check if a Roblox player is linked
app.get("/linked/:robloxUserId", (req, res) => {
  res.json({ linked: !!userMap[req.params.robloxUserId] });
});

app.listen(PORT, () => log(`Server running on port ${PORT}`));
