<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>YT → Roblox</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #0f0f0f;
      --surface:  #1a1a1a;
      --border:   #2a2a2a;
      --text:     #f1f1f1;
      --muted:    #aaaaaa;
      --green:    #1DB954;
      --red:      #E53E3E;
      --yellow:   #F6AD55;
      --radius:   8px;
      --font:     'Segoe UI', system-ui, sans-serif;
    }

    body {
      width: 320px;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 13px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .header h1 {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .header h1 span { color: var(--green); }

    .toggle-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }

    /* Toggle switch */
    .toggle { position: relative; display: inline-block; width: 36px; height: 20px; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0;
      background: var(--border);
      border-radius: 20px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .slider::before {
      content: '';
      position: absolute;
      width: 14px; height: 14px;
      left: 3px; bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    input:checked + .slider { background: var(--green); }
    input:checked + .slider::before { transform: translateX(16px); }

    /* ── Now Playing card ── */
    .now-playing {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      display: flex;
      gap: 10px;
      align-items: center;
      min-height: 72px;
    }

    .thumb-wrap {
      flex-shrink: 0;
      width: 72px;
      height: 54px;
      border-radius: 4px;
      overflow: hidden;
      background: var(--border);
    }

    .thumb-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .track-info { flex: 1; overflow: hidden; }

    .track-title {
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 3px;
    }

    .track-channel {
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .track-state {
      margin-top: 6px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .state-playing { color: var(--green); }
    .state-paused  { color: var(--muted); }
    .state-idle    { color: var(--muted); font-weight: 400; font-style: italic; }

    /* ── Form fields ── */
    .field { display: flex; flex-direction: column; gap: 5px; }

    label {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    input[type="text"] {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font);
      font-size: 12px;
      padding: 8px 10px;
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
    }

    input[type="text"]:focus { border-color: var(--green); }
    input[type="text"]::placeholder { color: var(--border); }

    /* ── Link code box ── */
    .link-code-wrap {
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .link-code {
      font-family: 'Courier New', monospace;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.2em;
      color: var(--green);
    }

    .link-hint {
      font-size: 10px;
      color: var(--muted);
      line-height: 1.4;
    }

    /* ── Status bar ── */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--muted);
    }

    .status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--border);
      flex-shrink: 0;
    }

    .status-dot.ok     { background: var(--green); }
    .status-dot.error  { background: var(--red); }
    .status-dot.warn   { background: var(--yellow); }

    /* ── Save button ── */
    .btn-save {
      background: var(--green);
      color: #000;
      border: none;
      border-radius: var(--radius);
      font-family: var(--font);
      font-size: 12px;
      font-weight: 700;
      padding: 9px;
      cursor: pointer;
      width: 100%;
      transition: opacity 0.15s;
    }

    .btn-save:hover { opacity: 0.85; }

    hr { border: none; border-top: 1px solid var(--border); }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <h1>YT <span>→</span> Roblox</h1>
    <div class="toggle-wrap">
      <span id="toggle-label">On</span>
      <label class="toggle">
        <input type="checkbox" id="enabled-toggle" checked />
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <!-- Now Playing -->
  <div class="now-playing" id="now-playing-card">
    <div class="thumb-wrap">
      <img id="thumb" src="" alt="" style="display:none" />
    </div>
    <div class="track-info">
      <div class="track-title" id="track-title">—</div>
      <div class="track-channel" id="track-channel"></div>
      <div class="track-state state-idle" id="track-state">Not watching anything</div>
    </div>
  </div>

  <hr />

  <!-- Token field -->
  <div class="field">
    <label>Your Roblox Link Token</label>
    <input type="text" id="user-token" placeholder="e.g. XK-4921" spellcheck="false" />
  </div>

  <!-- Server URL field -->
  <div class="field">
    <label>Bridge Server URL</label>
    <input type="text" id="server-url" placeholder="https://your-server.com" spellcheck="false" />
  </div>

  <button class="btn-save" id="save-btn">Save Settings</button>

  <hr />

  <!-- Link code (shown after saving token) -->
  <div class="field" id="link-code-section" style="display:none">
    <label>In-Game Link Code</label>
    <div class="link-code-wrap">
      <span class="link-code" id="link-code">——</span>
      <span class="link-hint">Type /link in&nbsp;Roblox<br>and enter this code</span>
    </div>
  </div>

  <!-- Status -->
  <div class="status-bar">
    <div class="status-dot" id="status-dot"></div>
    <span id="status-text">Waiting for settings…</span>
  </div>

  <script src="popup.js"></script>
</body>
</html>
