// ─── YouTube → Roblox Bridge Server (ESM) ────────────────────────────────
import express  from "express";
import cors     from "cors";
import https    from "https";
import { Innertube } from "youtubei.js";

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const sessions = {};
const userMap  = {};
const commands = {};

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── Innertube session ─────────────────────────────────────────────────────

let innertube = null;

const getInnertube = async () => {
  if (innertube) return innertube;
  innertube = await Innertube.create({ generate_session_locally: true });
  log("Innertube session created");
  return innertube;
};

const searchYouTube = async (query) => {
  const yt      = await getInnertube();
  const results = await yt.search(query, { type: "video" });

  return results.videos.slice(0, 8).map(v => ({
    videoId:  v.id              || "",
    title:    v.title?.text     || "Unknown",
    channel:  v.author?.name   || "Unknown",
    duration: v.duration?.seconds || 0,
  })).filter(v => v.videoId);
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

// ── Search ────────────────────────────────────────────────────────────────

app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing query" });

  try {
    const results = await searchYouTube(query);
    log(`SEARCH  "${query}" → ${results.length} results`);
    res.json({ results });
  } catch (err) {
    log(`SEARCH ERROR: ${err.message}`);
    res.status(503).json({ error: "Search unavailable", results: [] });
  }
});

// ── Extension → Server ────────────────────────────────────────────────────

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

// ── Roblox sends a command ────────────────────────────────────────────────

app.post("/command", (req, res) => {
  const { robloxUserId, action } = req.body;
  if (!robloxUserId || !action) return res.status(400).json({ error: "Missing fields" });

  const token = userMap[robloxUserId];
  if (!token) return res.status(404).json({ error: "User not linked" });

  commands[token] = action;
  log(`COMMAND [${token}] ${action}`);
  res.json({ ok: true });
});

// ── Roblox polls status ───────────────────────────────────────────────────

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

  userMap[robloxUserId] = code.trim().toLowerCase();
  log(`LINKED  robloxId=${robloxUserId} → token=${code.trim().toLowerCase()}`);
  res.json({ ok: true });
});

app.get("/linked/:robloxUserId", (req, res) => {
  res.json({ linked: !!userMap[req.params.robloxUserId] });
});

// ── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  log(`Server running on port ${PORT}`);
  try { await getInnertube(); }
  catch (e) { log(`Innertube warmup failed: ${e.message}`); }
});
