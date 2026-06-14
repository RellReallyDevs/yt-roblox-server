// ─── YouTube → Roblox Bridge Server ──────────────────────────────────────
// Sits between the browser extension and Roblox.
// Extension POSTs here → Roblox polls here.

const express = require("express");
const cors    = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── In-memory state ───────────────────────────────────────────────────────
// These reset if the server restarts, which is fine for a "now playing" use case.

// token → current video data
//   e.g. { "XK-4921": { videoId, title, channel, thumbnail, paused, ... } }
const sessions = {};

// linkCode → token  (temporary codes users type in Roblox chat)
//   e.g. { "XK-4921": "XK-4921" }   (we just use token as code for simplicity)
const linkCodes = {};

// robloxUserId → token
//   e.g. { "12345678": "XK-4921" }
const userMap = {};

// ── Helpers ───────────────────────────────────────────────────────────────

// Generate a random readable link code like "XK-4921"
const makeCode = () => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const L = () => letters[Math.floor(Math.random() * letters.length)];
  const N = () => Math.floor(Math.random() * 10);
  return `${L()}${L()}-${N()}${N()}${N()}${N()}`;
};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── Routes ────────────────────────────────────────────────────────────────

// Health check — Railway uses this to confirm the server is alive
app.get("/", (_req, res) => {
  res.json({ status: "ok", sessions: Object.keys(sessions).length });
});

// ── Extension → Server ────────────────────────────────────────────────────

// Called by the browser extension whenever the video changes
app.post("/update", (req, res) => {
  const { token, videoId, title, channel, thumbnail, duration, position, paused, timestamp } = req.body;

  if (!token) return res.status(400).json({ error: "Missing token" });

  sessions[token] = { videoId, title, channel, thumbnail, duration, position, paused, timestamp, updatedAt: Date.now() };

  log(`UPDATE  [${token}] ${paused ? "⏸" : "▶"} ${title?.slice(0, 40)}`);
  res.json({ ok: true });
});

// ── Roblox → Server ───────────────────────────────────────────────────────

// Called by Roblox HttpService to get a player's current video
// Roblox passes the player's Roblox UserId — we look up their token
app.get("/status/:robloxUserId", (req, res) => {
  const { robloxUserId } = req.params;
  const token = userMap[robloxUserId];

  if (!token) return res.json({ linked: false });

  const data = sessions[token];
  if (!data) return res.json({ linked: true, playing: false });

  // Consider stale if no update in 5 minutes
  const stale = Date.now() - (data.updatedAt || 0) > 5 * 60 * 1000;
  if (stale) return res.json({ linked: true, playing: false });

  res.json({ linked: true, playing: true, ...data });
});

// ── Account Linking ───────────────────────────────────────────────────────

// Extension calls this to generate a link code for the user
// Returns a short code the user types in Roblox chat (/link XK-4921)
app.post("/generate-code", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  // Reuse existing code or create a new one
  const existing = Object.entries(linkCodes).find(([, t]) => t === token);
  if (existing) return res.json({ code: existing[0] });

  const code = makeCode();
  linkCodes[code] = token;

  // Codes expire after 10 minutes
  setTimeout(() => delete linkCodes[code], 10 * 60 * 1000);

  log(`CODE    [${token}] generated code ${code}`);
  res.json({ code });
});

// Roblox calls this when a player types /link <code> in chat
app.post("/link", (req, res) => {
  const { code, robloxUserId } = req.body;
  if (!code || !robloxUserId) return res.status(400).json({ error: "Missing code or robloxUserId" });

  const token = linkCodes[code.toUpperCase()];
  if (!token) return res.status(404).json({ error: "Invalid or expired code" });

  userMap[robloxUserId] = token;
  delete linkCodes[code.toUpperCase()]; // one-time use

  log(`LINKED  robloxId=${robloxUserId} → token=${token}`);
  res.json({ ok: true, token });
});

// Roblox can check if a player is already linked
app.get("/linked/:robloxUserId", (req, res) => {
  const linked = !!userMap[req.params.robloxUserId];
  res.json({ linked });
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  log(`Server running on port ${PORT}`);
});
