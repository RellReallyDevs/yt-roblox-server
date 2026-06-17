// Add this block immediately after the /discord/to-channel route,
// before the // START section at the bottom of the file.
//
// Also add this to your Railway environment variables:
//   JOIN_CHANNEL  — the channel ID (not name) of your #player-join channel
//                   (right-click the channel in Discord → Copy Channel ID)

app.post("/discord/player-joined", requireSecret, async (req, res) => {
  const { playerName, userId } = req.body;
  if (!playerName) return res.status(400).json({ error: "Missing playerName" });

  const joinChannelId = process.env.JOIN_CHANNEL;
  if (!joinChannelId) {
    log("WARN  JOIN_CHANNEL env var not set — player-joined route disabled");
    return res.status(503).json({ error: "JOIN_CHANNEL not configured" });
  }

  if (!discordReady) return res.status(503).json({ error: "Discord not ready" });

  try {
    const joinChannel = await discord.channels.fetch(joinChannelId).catch(() => null);
    if (!joinChannel) return res.status(404).json({ error: "Join channel not found" });

    await joinChannel.send({
      embeds: [{
        description: `**${playerName}** just joined the game!`,
        color: 0x7289da,
        footer: userId ? { text: `User ID: ${userId}` } : undefined,
        timestamp: new Date().toISOString(),
      }],
    });

    log(`JOIN  ${playerName} (${userId})`);
    res.json({ ok: true });
  } catch (e) {
    log(`JOIN ERROR: ${e.message}`);
    res.status(500).json({ error: "Failed to post join message" });
  }
});
