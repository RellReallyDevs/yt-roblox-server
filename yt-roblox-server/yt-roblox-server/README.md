# YT → Roblox Bridge Server

## Deploy to Railway (free, ~2 minutes)

### Step 1 — Put this on GitHub
1. Go to github.com → click **New repository**
2. Name it `yt-roblox-server`, make it **Public**
3. Upload all these files (drag & drop works)

### Step 2 — Deploy on Railway
1. Go to **railway.app** and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select `yt-roblox-server`
4. Railway auto-detects Node.js and deploys it
5. Click **Settings → Networking → Generate Domain**
6. You'll get a URL like `https://yt-roblox-server.up.railway.app`

That's it. Your server is live.

---

## API Reference

### `POST /update`
Called by the browser extension whenever the video changes.
```json
{ "token": "XK-4921", "videoId": "abc123", "title": "...", "paused": false }
```

### `GET /status/:robloxUserId`
Called by Roblox to get what a player is watching.
```json
{ "linked": true, "playing": true, "title": "...", "thumbnail": "...", "paused": false }
```

### `POST /generate-code`
Extension calls this to get a link code for the user.
```json
{ "token": "XK-4921" }
→ { "code": "XK-4921" }
```

### `POST /link`
Roblox calls this when a player types `/link XK-4921` in chat.
```json
{ "code": "XK-4921", "robloxUserId": "12345678" }
→ { "ok": true }
```

### `GET /linked/:robloxUserId`
Check if a Roblox player has linked their account.
```json
→ { "linked": true }
```
