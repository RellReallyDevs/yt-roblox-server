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
  const { token, ...rest } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  const key = token.trim().toLowerCase(); // normalize here
  sessions[key] = { ...rest, updatedAt: Date.now() };
  log(`UPDATE  [${key}] ${rest.paused ? "⏸" : "▶"} ${rest.title?.slice(0, 40)}`);
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

  // lowercase both so casing never matters
  userMap[robloxUserId] = code.trim().toLowerCase();
  log(`LINKED  robloxId=${robloxUserId} → token=${code.trim().toLowerCase()}`);
  res.json({ ok: true });
});
// Check if a Roblox player is linked
app.get("/linked/:robloxUserId", (req, res) => {
  res.json({ linked: !!userMap[req.params.robloxUserId] });
});

app.listen(PORT, () => log(`Server running on port ${PORT}`));
