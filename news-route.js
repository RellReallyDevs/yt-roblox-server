// ============================================================
// news-route.js — add this to your Railway Express server
// ============================================================
// Usage:
//   const newsRouter = require('./news-route');
//   app.use(newsRouter);
//
// Then Roblox hits:  GET https://your-railway-url.up.railway.app/news
// ============================================================

const express = require('express');
const router = express.Router();

const APITUBE_KEY = 'api_live_1rgt5ipe40o6gyaoshA7OeALFvZ2dLi9EJ01NXxYp6BbfRpsoycjAgtkbMz';
const BASE_URL    = 'https://api.apitube.io/v1/news/everything';
const PER_TOPIC   = 5;   // articles per topic (3 topics × 5 = up to 15 total)
const REFRESH_MS  = 15 * 60 * 1000; // 15 minutes

// ── In-memory cache ─────────────────────────────────────────
let cache = {
  articles:    [],
  lastUpdated: null,
  error:       null,
};

// ── Topic definitions ────────────────────────────────────────
// category.id reference:
//   medtop:13000000 = Science & Technology
//   medtop:15000000 = Sport
//   title=gaming    = Gaming (no dedicated medtop category)
const TOPICS = [
  { label: 'Gaming',     params: `title=gaming&language.code=en`                               },
  { label: 'Tech',       params: `category.id=medtop:13000000&language.code=en`                },
  { label: 'Sports',     params: `category.id=medtop:15000000&language.code=en`                },
];

// ── Fetch one topic from APITube ─────────────────────────────
async function fetchTopic(topic) {
  const url = `${BASE_URL}?${topic.params}&per_page=${PER_TOPIC}&sort.by=published_at&sort.order=desc&api_key=${APITUBE_KEY}`;
  const res  = await fetch(url);

  if (!res.ok) {
    throw new Error(`APITube returned ${res.status} for topic "${topic.label}"`);
  }

  const data = await res.json();
  const items = (data.articles || data.data || []).slice(0, PER_TOPIC);

  return items.map(a => ({
    category:    topic.label,
    title:       a.title       || 'No title',
    description: a.description || a.summary || '',
    url:         a.url         || a.link    || '',
    source:      a.source?.name || a.source  || '',
    publishedAt: a.published_at || a.publishedAt || '',
  }));
}

// ── Refresh all topics and update cache ──────────────────────
async function refreshCache() {
  console.log('[news-route] Refreshing news cache…');
  try {
    const results = await Promise.all(TOPICS.map(fetchTopic));
    cache = {
      articles:    results.flat(),
      lastUpdated: new Date().toISOString(),
      error:       null,
    };
    console.log(`[news-route] Cache updated — ${cache.articles.length} articles`);
  } catch (err) {
    console.error('[news-route] Refresh failed:', err.message);
    cache.error = err.message;
  }
}

// Fetch immediately on startup, then every 15 minutes
refreshCache();
setInterval(refreshCache, REFRESH_MS);

// ── GET /news ────────────────────────────────────────────────
router.get('/news', (req, res) => {
  if (cache.error && cache.articles.length === 0) {
    return res.status(503).json({ error: cache.error });
  }

  res.json({
    lastUpdated: cache.lastUpdated,
    count:       cache.articles.length,
    articles:    cache.articles,
  });
});

module.exports = router;
