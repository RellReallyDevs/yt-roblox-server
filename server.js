// ─── AURA — YouTube → Roblox Bridge + Discord Bot (ESM) ─────────────────────
import express        from "express";
import cors           from "cors";
import https          from "https";
import fs             from "fs";
import path           from "path";
import { Innertube }  from "youtubei.js";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Environment ───────────────────────────────────────────────────────────────
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN   || "";
const DISCORD_APP_ID  = process.env.DISCORD_APP_ID  || "";
const GATEWAY_CHANNEL = process.env.GATEWAY_CHANNEL || "aura-gateway";
const SUPPORTER_ROLE  = process.env.SUPPORTER_ROLE  || "Discord Supporter";
const ROBLOX_SECRET   = process.env.ROBLOX_SECRET   || "aura_internal";

// Railway mounts a persistent volume at /data when configured.
// Falls back to the local directory if /data doesn't exist.
const DATA_DIR        = fs.existsSync("/data") ? "/data" : ".";
const LINKS_FILE      = path.join(DATA_DIR, "discord_links.json");
const USERMAP_FILE    = path.join(DATA_DIR, "user_map.json");

app.use(cors());
app.use(express.json());

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const loadJSON = (filePath, fallback) => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    log(`WARN  Could not load ${filePath}: ${e.message}`);
  }
  return fallback;
};

// Debounced write — waits 500ms after the last call before writing,
// so rapid successive updates don't hammer disk.
const writeTimers = {};
const saveJSON = (filePath, data) => {
  clearTimeout(writeTimers[filePath]);
  writeTimers[filePath] = setTimeout(() => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      log(`ERROR  Could not save ${filePath}: ${e.message}`);
    }
  }, 500);
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE  (loaded from disk on startup)
// ─────────────────────────────────────────────────────────────────────────────

const sessions        = {};                          // token → YouTube session  (ephemeral — not persisted)
const commands        = {};                          // token → pending playback command  (ephemeral)
const pendingCodes    = {};                          // code  → { robloxUserId, expiresAt }  (ephemeral)
const gatewayMessages = [];                          // rolling buffer of last 50 gateway messages  (ephemeral)

// ✅ Persisted — survives Railway restarts
const userMap      = loadJSON(USERMAP_FILE,  {});   // robloxUserId → YouTube token
const discordLinks = loadJSON(LINKS_FILE,    {});   // robloxUserId → discordUserId

log(`Loaded ${Object.keys(userMap).length} YouTube links from disk`);
log(`Loaded ${Object.keys(discordLinks).length} community links from disk`);

// ─────────────────────────────────────────────────────────────────────────────
// INNERTUBE (YouTube)
// ─────────────────────────────────────────────────────────────────────────────

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
    videoId:  v.id                || "",
    title:    v.title?.text       || "Unknown",
    channel:  v.author?.name      || "Unknown",
    duration: v.duration?.seconds || 0,
  })).filter(v => v.videoId);
};

// ─────────────────────────────────────────────────────────────────────────────
// DISCORD CLIENT
// ─────────────────────────────────────────────────────────────────────────────

let discordReady   = false;
let gatewayChannel = null;

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

discord.once("ready", async () => {
  log(`Discord bot logged in as ${discord.user.tag}`);
  discordReady = true;

  for (const guild of discord.guilds.cache.values()) {
    const ch = guild.channels.cache.find(
      c => c.name === GATEWAY_CHANNEL && c.isTextBased()
    );
    if (ch) { gatewayChannel = ch; break; }
  }
  if (gatewayChannel) log(`Gateway channel: #${gatewayChannel.name} (${gatewayChannel.id})`);
  else                log(`⚠️  Gateway channel "#${GATEWAY_CHANNEL}" not found — create it in Discord`);

  if (DISCORD_APP_ID) {
    const cmds = [
      new SlashCommandBuilder()
        .setName("verify")
        .setDescription("Link your community account to your Roblox account in AURA")
        .addStringOption(opt =>
          opt.setName("code")
             .setDescription("6-character code from /server in-game")
             .setRequired(true)
        ),
    ].map(c => c.toJSON());

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(DISCORD_APP_ID), { body: cmds });
      log("Slash commands registered globally");
    } catch (e) {
      log(`Slash command registration failed: ${e.message}`);
    }
  } else {
    log("⚠️  DISCORD_APP_ID not set — skipping slash command registration");
  }
});

discord.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "verify") return;

  const code        = interaction.options.getString("code").trim().toUpperCase();
  const discordUser = interaction.user;
  const pending     = pendingCodes[code];

  if (!pending) {
    await interaction.reply({ content: "❌ Invalid or expired code. Use `/server` in-game to get a new one.", ephemeral: true });
    return;
  }
  if (Date.now() > pending.expiresAt) {
    delete pendingCodes[code];
    await interaction.reply({ content: "⏰ That code has expired. Use `/server` in-game to get a new one.", ephemeral: true });
    return;
  }

  const { robloxUserId } = pending;

  // Save the link and persist to disk immediately
  discordLinks[robloxUserId] = discordUser.id;
  saveJSON(LINKS_FILE, discordLinks);
  delete pendingCodes[code];

  log(`COMMUNITY LINK  robloxId=${robloxUserId} → discordId=${discordUser.id}`);

  let roleGranted = false;
  for (const guild of discord.guilds.cache.values()) {
    const role   = guild.roles.cache.find(r => r.name === SUPPORTER_ROLE);
    const member = await guild.members.fetch(discordUser.id).catch(() => null);
    if (role && member) {
      await member.roles.add(role).catch(e => log(`Role add failed: ${e.message}`));
      roleGranted = true;
    }
  }

  await interaction.reply({
    content: roleGranted
      ? `✅ Linked! You've been given the **${SUPPORTER_ROLE}** role. Your in-game perks will activate within 30 seconds.`
      : `✅ Linked! Your in-game perks will activate within 30 seconds.`,
    ephemeral: true,
  });
});

discord.on("messageCreate", (msg) => {
  if (msg.author.bot)                              return;
  if (!gatewayChannel)                             return;
  if (msg.channelId !== gatewayChannel.id)         return;

  const entry = {
    id:        msg.id,
    author:    msg.author.username,
    content:   msg.content,
    timestamp: msg.createdTimestamp,
  };
  gatewayMessages.push(entry);
  if (gatewayMessages.length > 50) gatewayMessages.shift();
  log(`GATEWAY  <${msg.author.username}> ${msg.content.slice(0, 60)}`);
});

if (DISCORD_TOKEN) {
  discord.login(DISCORD_TOKEN).catch(e => log(`Discord login failed: ${e.message}`));
} else {
  log("⚠️  DISCORD_TOKEN not set — Discord bot disabled");
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

const requireSecret = (req, res, next) => {
  const secret = req.headers["x-aura-secret"] || req.body?.secret;
  if (secret !== ROBLOX_SECRET) return res.status(403).json({ error: "Forbidden" });
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES — General
// ─────────────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({
    status:           "ok",
    sessions:         Object.keys(sessions).length,
    discordOnline:    discordReady,
    youtubeLinks:     Object.keys(userMap).length,
    communityLinks:   Object.keys(discordLinks).length,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES — YouTube
// ─────────────────────────────────────────────────────────────────────────────

app.get("/thumbnail/:videoId", (req, res) => {
  const url = `https://i.ytimg.com/vi/${req.params.videoId}/hqdefault.jpg`;
  https.get(url, (imgRes) => {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    imgRes.pipe(res);
  }).on("error", () => res.status(500).json({ error: "Failed" }));
});

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

app.post("/update", (req, res) => {
  const { token, videoId, title, channel, duration, position, paused, timestamp } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });

  const key = token.trim().toLowerCase();
  sessions[key] = { videoId, title, channel,
    thumbnail: videoId ? `/thumbnail/${videoId}` : null,
    duration, position, paused, timestamp, updatedAt: Date.now(),
  };
  log(`UPDATE  [${key}] ${paused ? "⏸" : "▶"} ${title?.slice(0, 40)}`);
  res.json({ ok: true });
});

app.get("/commands/:token", (req, res) => {
  const key     = req.params.token.trim().toLowerCase();
  const pending = commands[key] || null;
  if (pending) delete commands[key];
  res.json({ command: pending });
});

app.post("/command", (req, res) => {
  const { robloxUserId, action } = req.body;
  if (!robloxUserId || !action) return res.status(400).json({ error: "Missing fields" });
  const token = userMap[robloxUserId];
  if (!token) return res.status(404).json({ error: "User not linked" });
  commands[token] = action;
  log(`COMMAND [${token}] ${action}`);
  res.json({ ok: true });
});

app.get("/status/:robloxUserId", (req, res) => {
  const token = userMap[req.params.robloxUserId];
  if (!token) return res.json({ linked: false });
  const data  = sessions[token];
  if (!data)  return res.json({ linked: true, playing: false });
  const stale = Date.now() - (data.updatedAt || 0) > 5 * 60 * 1000;
  if (stale)  return res.json({ linked: true, playing: false });
  res.json({ linked: true, playing: true, ...data });
});

app.post("/link", (req, res) => {
  const { code, robloxUserId } = req.body;
  if (!code || !robloxUserId) return res.status(400).json({ error: "Missing fields" });
  userMap[robloxUserId] = code.trim().toLowerCase();
  saveJSON(USERMAP_FILE, userMap);   // ✅ persist YouTube link
  log(`LINKED  robloxId=${robloxUserId} → token=${code.trim().toLowerCase()}`);
  res.json({ ok: true });
});

app.get("/linked/:robloxUserId", (req, res) => {
  res.json({ linked: !!userMap[req.params.robloxUserId] });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES — Community (Discord) integration
// All routes require the x-aura-secret header.
// ─────────────────────────────────────────────────────────────────────────────

app.post("/discord/generate-code", requireSecret, (req, res) => {
  const { robloxUserId } = req.body;
  if (!robloxUserId) return res.status(400).json({ error: "Missing robloxUserId" });

  // Invalidate any existing pending code for this player
  for (const [k, v] of Object.entries(pendingCodes)) {
    if (v.robloxUserId === robloxUserId) delete pendingCodes[k];
  }

  const code      = Math.random().toString(36).substring(2, 8).toUpperCase();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  pendingCodes[code] = { robloxUserId, expiresAt };

  log(`CODE    robloxId=${robloxUserId} → ${code} (expires in 10m)`);
  res.json({ code });
});

app.get("/discord/linked/:robloxUserId", requireSecret, (req, res) => {
  const linked = !!discordLinks[req.params.robloxUserId];
  res.json({ linked });
});

app.get("/discord/gateway", requireSecret, (req, res) => {
  const since    = parseInt(req.query.since || "0", 10);
  const messages = gatewayMessages.filter(m => m.timestamp > since);
  res.json({ messages });
});

app.post("/discord/to-channel", requireSecret, async (req, res) => {
  const { robloxUserId, robloxUsername, message } = req.body;
  if (!robloxUserId || !message) return res.status(400).json({ error: "Missing fields" });
  if (!gatewayChannel) return res.status(503).json({ error: "Gateway channel not available" });

  const text = `🎮 **${robloxUsername || robloxUserId}** (Roblox): ${message.slice(0, 200)}`;
  try {
    await gatewayChannel.send(text);
    log(`TO-CHANNEL  ${robloxUsername}: ${message.slice(0, 60)}`);
    res.json({ ok: true });
  } catch (e) {
    log(`TO-CHANNEL ERROR: ${e.message}`);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  log(`Server running on port ${PORT}`);
  log(`Data directory: ${DATA_DIR}`);
  try { await getInnertube(); }
  catch (e) { log(`Innertube warmup failed: ${e.message}`); }
});
