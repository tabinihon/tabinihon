/**
 * 旅日嚮導 — SEO 靜態景點頁產生器
 * ---------------------------------------------------------------
 * 做什麼：從 Supabase 的 spots 表（status=已上架）抓資料，
 *         每個景點產生一個獨立、可被 Google / AI 爬蟲索引的靜態 HTML，
 *         並產生 sitemap.xml、robots.txt、spots/index.html（景點總覽）。
 *
 * 你的 SPA（index.html）完全不動。這些是「給爬蟲和分享預覽用」的入口頁，
 * 使用者點頁面上的按鈕會深連結回 APP：/tabinihon/?spot=<id>
 *
 * 怎麼跑（在 repo 根目錄）：
 *     node build.js
 * 需求：Node 18 以上（內建 fetch）。不需要 npm install。
 *
 * 跑完會在 repo 產生：
 *     /spots/<slug>.html   （每個景點一頁）
 *     /spots/index.html    （景點總覽 hub）
 *     /sitemap.xml
 *     /robots.txt
 * 然後 git add . && git commit && git push 就部署了。
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// ── 設定（anon key 是公開金鑰，本來就在 index.html 裡，可放心使用）──
const SUPABASE_URL = 'https://vxdpnhjitcdtyshnopus.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4ZHBuaGppdGNkdHlzaG5vcHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NTcwMzEsImV4cCI6MjA5MTEzMzAzMX0.VEFi_QAH4afDCMYPiNVsRPgAIGrTxwjY7ApflwUsANU';

const SITE_BASE = 'https://tabinihon.github.io/tabinihon'; // 站台根（GitHub Pages 路徑）
const OUT_DIR   = '.';                                     // 輸出根目錄（= repo 根）
const TODAY     = new Date().toISOString().slice(0, 10);

// ── 小工具 ──
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 把可能是 string / JSON 字串 / 陣列的欄位統一成陣列
function toArray(field) {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  if (typeof field === 'object') return [field];
  const t = String(field).trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try { const p = JSON.parse(t); return Array.isArray(p) ? p : [p]; } catch (e) {}
  }
  if (t.includes('｜')) return t.split('｜').map(x => x.trim()).filter(Boolean);
  if (t.includes('|'))  return t.split('|').map(x => x.trim()).filter(Boolean);
  if (t.includes('\n')) return t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return t ? [t] : [];
}

// 從照片檔名推 slug：asakusa_01.jpg → asakusa
function slugFromPhoto(url) {
  if (!url) return '';
  const base = String(url).split('/').pop() || '';
  const m = base.match(/^([a-zA-Z0-9-]+?)(_\d+)?\.(jpg|jpeg|png|webp)$/i);
  return m ? m[1].toLowerCase() : '';
}

function makeSlug(row, photos) {
  if (row.slug) return String(row.slug).trim().toLowerCase();          // 1) 有 slug 欄位最好
  const fromPhoto = slugFromPhoto(row.cover_photo) || slugFromPhoto(photos[0]); // 2) 退而求其次用照片檔名
  if (fromPhoto) return fromPhoto;
  return 'spot-' + (row.id != null ? row.id : Math.random().toString(36).slice(2, 8)); // 3) 最後用 id
}

// ── 抓 Supabase ──
async function fetchSpots() {
  const url = `${SUPABASE_URL}/rest/v1/spots?status=eq.${encodeURIComponent('已上架')}&order=sort_order.asc`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new Error('Supabase 回應錯誤 ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// ── 組一頁景點 HTML ──
function spotPage(row) {
  const photos = toArray(row.photos).filter(p => typeof p === 'string' && p.startsWith('http'));
  if (row.cover_photo && row.cover_photo.startsWith('http') && !photos.includes(row.cover_photo)) {
    photos.unshift(row.cover_photo);
  }
  const slug = makeSlug(row, photos);
  const pageUrl = `${SITE_BASE}/spots/${slug}.html`;
  const appUrl  = `${SITE_BASE}/?spot=${encodeURIComponent(row.id)}`;
  const heroImg = photos[0] || `${SITE_BASE}/icon-512.png`;

  const name   = row.name || '';
  const jaName = row.name_ja || '';
  const area   = row.area || '';
  const axis   = row.axis || '';
  const tag    = row.positioning || '';
  const editorial = (row.editorial || '').trim();

  // meta description：取評述前段，沒有就用組合句
  const descRaw = editorial
    ? editorial.replace(/\s+/g, ' ').slice(0, 110)
    : `${name}（${jaName}）位於${area}，旅日嚮導實地查核・客觀評述，不接業配。`;
  const metaDesc = descRaw + (editorial.length > 110 ? '…' : '');

  // metro 文字
  const metro = toArray(row.metro_lines)
    .map(m => (m && typeof m === 'object' && m.info) ? m.info : (typeof m === 'string' ? m : ''))
    .filter(Boolean);

  // 基本資訊列
  const info = [];
  if (row.best_visit_time) info.push(['最佳時機', row.best_visit_time]);
  if (row.season_highlights) info.push(['季節亮點', toArray(row.season_highlights).join('・')]);
  const fee = (row.ticket_price || '').includes('免費') ? '免費'
            : (row.ticket_price ? row.ticket_price : (row.ticket_method || ''));
  if (fee) info.push(['費用', fee]);
  if (row.opening_hours) info.push(['開放時間', row.opening_hours]);
  if (row.closed_days) info.push(['公休', row.closed_days]);
  if (row.suggested_duration) info.push(['建議停留', row.suggested_duration]);
  if (row.walk_minutes) info.push(['步行', `車站徒步約 ${row.walk_minutes} 分`]);

  const nearby = toArray(row.nearby_spots);

  // JSON-LD（Google 推薦格式）
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: name,
    alternateName: jaName || undefined,
    description: editorial ? editorial.replace(/\s+/g, ' ').slice(0, 300) : metaDesc,
    image: photos.slice(0, 5),
    url: pageUrl,
    address: area ? { '@type': 'PostalAddress', addressRegion: area, addressCountry: 'JP' } : undefined,
    geo: (row.latitude && row.longitude)
      ? { '@type': 'GeoCoordinates', latitude: row.latitude, longitude: row.longitude }
      : undefined,
    isAccessibleForFree: (row.ticket_price || '').includes('免費') ? true : undefined,
    sameAs: row.website_url || undefined,
  };
  // 去掉 undefined
  Object.keys(jsonld).forEach(k => jsonld[k] === undefined && delete jsonld[k]);

  const editorialHtml = editorial
    ? editorial.split(/\n\s*\n|\r?\n/).map(p => p.trim()).filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`).join('\n')
    : `<p>${esc(metaDesc)}</p>`;

  return { slug, pageUrl, html: `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}（${esc(jaName)}）｜${esc(area)} - 旅日嚮導</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${pageUrl}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(name)}｜旅日嚮導">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(heroImg)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:locale" content="zh_TW">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
  :root{--red:#c0392b;--ink:#2c3e50;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;color:#333;line-height:1.8;background:#f7f7f8;}
  .wrap{max-width:680px;margin:0 auto;background:#fff;}
  .hero{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#eee;}
  .body{padding:20px 18px 40px;}
  .tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;}
  .tag{font-size:12px;padding:3px 10px;border-radius:999px;background:#f0e9e7;color:var(--red);font-weight:700;}
  h1{font-size:24px;margin:6px 0 2px;}
  .ja{color:#888;font-size:14px;margin-bottom:16px;}
  .editorial p{margin:0 0 14px;font-size:15px;}
  .info{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;}
  .info th{text-align:left;color:#999;font-weight:600;width:84px;padding:8px 0;vertical-align:top;}
  .info td{padding:8px 0;border-bottom:1px solid #f2f2f2;}
  .metro{margin:8px 0 0;font-size:14px;}
  .metro div{padding:4px 0;}
  .gallery{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:18px 0;}
  .gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;}
  .cta{display:block;text-align:center;background:var(--red);color:#fff;text-decoration:none;font-weight:700;padding:15px;border-radius:14px;margin:22px 0 10px;font-size:16px;}
  .cta.sub{background:var(--ink);}
  .nearby{font-size:14px;color:#555;}
  .nearby li{margin:4px 0;}
  .note{font-size:12px;color:#aaa;margin-top:20px;border-top:1px solid #f0f0f0;padding-top:14px;}
  .note a{color:var(--red);}
</style>
</head>
<body>
<div class="wrap">
  <img class="hero" src="${esc(heroImg)}" alt="${esc(name)}">
  <div class="body">
    <div class="tags">
      ${axis ? `<span class="tag">${esc(axis)}</span>` : ''}
      ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
      ${area ? `<span class="tag">${esc(area)}</span>` : ''}
    </div>
    <h1>${esc(name)}</h1>
    <div class="ja">${esc(jaName)}</div>

    <div class="editorial">${editorialHtml}</div>

    ${info.length ? `<table class="info"><tbody>${
      info.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')
    }</tbody></table>` : ''}

    ${metro.length ? `<div class="metro"><strong>交通</strong>${
      metro.map(m => `<div>🚇 ${esc(m)}</div>`).join('')
    }</div>` : ''}

    <a class="cta" href="${appUrl}">在 APP 開啟・加入行程 →</a>

    ${photos.length > 1 ? `<div class="gallery">${
      photos.slice(1, 5).map(p => `<img src="${esc(p)}" alt="${esc(name)}" loading="lazy">`).join('')
    }</div>` : ''}

    ${nearby.length ? `<div class="nearby"><strong>附近順遊</strong><ul>${
      nearby.map(n => `<li>${esc(n)}</li>`).join('')
    }</ul></div>` : ''}

    <a class="cta sub" href="${SITE_BASE}/">看完整景點地圖・規劃行程 →</a>

    <div class="note">
      旅日嚮導不接業配・所有景點實地查核或多方評價篩選。本頁為景點導覽，
      完整互動版請見 <a href="${SITE_BASE}/">旅日嚮導 APP</a>。
    </div>
  </div>
</div>
</body>
</html>` };
}

// ── 總覽 hub 頁 ──
function hubPage(items) {
  const cards = items.map(it =>
    `<li><a href="${SITE_BASE}/spots/${it.slug}.html">${esc(it.name)}<span>${esc(it.area)}</span></a></li>`
  ).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>東京景點總覽｜旅日嚮導 - 不接業配的東京旅遊指南</title>
<meta name="description" content="旅日嚮導實地查核的東京景點總覽，客觀評述、不接業配。傳統文化、潮流散策、美食職人、職人選物、近郊小旅行。">
<link rel="canonical" href="${SITE_BASE}/spots/">
<style>
  body{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;max-width:680px;margin:0 auto;padding:24px 18px;color:#333;background:#f7f7f8;}
  h1{font-size:22px;margin-bottom:4px;}
  p.sub{color:#888;font-size:14px;margin-bottom:20px;}
  ul{list-style:none;padding:0;}
  li a{display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:8px;text-decoration:none;color:#333;font-weight:600;}
  li a span{color:#aaa;font-size:12px;font-weight:400;}
  a.app{display:block;text-align:center;background:#c0392b;color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:12px;margin:20px 0;}
</style>
</head>
<body>
  <h1>東京景點總覽</h1>
  <p class="sub">旅日嚮導・實地查核・客觀評述・不接業配</p>
  <a class="app" href="${SITE_BASE}/">開啟旅日嚮導 APP →</a>
  <ul>${cards}</ul>
</body>
</html>`;
}

// ── 主流程 ──
(async () => {
  console.log('▶ 從 Supabase 抓已上架景點…');
  const rows = await fetchSpots();
  console.log(`  取得 ${rows.length} 筆`);

  const spotsDir = path.join(OUT_DIR, 'spots');
  fs.mkdirSync(spotsDir, { recursive: true });

  const built = [];
  const seen = new Set();
  for (const row of rows) {
    const page = spotPage(row);
    let slug = page.slug;
    // 避免 slug 撞名
    if (seen.has(slug)) slug = slug + '-' + row.id;
    seen.add(slug);
    fs.writeFileSync(path.join(spotsDir, slug + '.html'), page.html, 'utf8');
    built.push({ slug, name: row.name || '', area: row.area || '', url: `${SITE_BASE}/spots/${slug}.html` });
  }

  // hub
  fs.writeFileSync(path.join(spotsDir, 'index.html'), hubPage(built), 'utf8');

  // sitemap.xml
  const urls = [
    { loc: `${SITE_BASE}/`, pri: '1.0' },
    { loc: `${SITE_BASE}/spots/`, pri: '0.8' },
    ...built.map(b => ({ loc: b.url, pri: '0.7' })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${TODAY}</lastmod><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(OUT_DIR, 'sitemap.xml'), sitemap, 'utf8');

  // robots.txt
  fs.writeFileSync(path.join(OUT_DIR, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE_BASE}/sitemap.xml\n`, 'utf8');

  console.log(`✅ 完成：${built.length} 個景點頁 + hub + sitemap.xml + robots.txt`);
  console.log('   接著：git add . && git commit -m "add SEO pages" && git push');
})().catch(e => { console.error('❌ 失敗：', e.message); process.exit(1); });
