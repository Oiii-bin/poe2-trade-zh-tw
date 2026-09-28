// -*- coding: utf-8 -*-
// coverage_report.js — 產出翻譯覆蓋率週報，並開/更新成 GitHub Issue
// 用法：node scripts/coverage_report.js
// 在 CI 會讀 GITHUB_TOKEN / GITHUB_REPOSITORY 自動開 Issue；本機跑則只寫 coverage_report.md。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'poe2-trade-zh-tw.user.js');
const OUT = path.join(ROOT, 'coverage_report.md');
const code = fs.readFileSync(SCRIPT, 'utf8');

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json',
};
const H_HTML = { ...H, Accept: 'text/html' };

function sliceBalanced(src, startIdx) {
  let i = src.indexOf('{', startIdx), d = 0, e = -1;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { e = i + 1; break; } } }
  return e;
}
function parseFull(name) {
  const s0 = code.indexOf('const ' + name + ' = {');
  const obj = new Function('return ' + code.slice(code.indexOf('{', s0), sliceBalanced(code, s0)))();
  const re = new RegExp('Object\\.assign\\(' + name + ', \\{([\\s\\S]*?)\\n  \\}\\);', 'g');
  let m; while ((m = re.exec(code))) Object.assign(obj, new Function('return {' + m[1] + '}')());
  return obj;
}
async function getJSON(u, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise((s) => setTimeout(s, 3000));
  }
  return null;
}
async function getText(u, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u, { headers: H_HTML, signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.text(); } catch (e) {}
    await new Promise((s) => setTimeout(s, 3000));
  }
  return null;
}
function parseUniqueNames(html, loc) {
  const out = {};
  const re = new RegExp('href="/' + loc + '/([^"]+)"[^>]*><span class="uniqueName">([^<]{1,60})</span>', 'g');
  let m; while ((m = re.exec(html))) out[m[1]] = m[2].trim();
  return out;
}

(async () => {
  const TWMAP = parseFull('TWMAP');
  const DICT = parseFull('DICT');
  const version = (code.match(/\/\/ @version ([\d.]+)/) || [])[1] || '?';

  const enStats = await getJSON('https://www.pathofexile.com/api/trade2/data/stats');
  const twStats = await getJSON('https://www.pathofexile.tw/api/trade2/data/stats');
  const enIds = new Set(), twIds = new Set();
  for (const g of (enStats && enStats.result) || []) for (const e of g.entries || []) if (e.id) enIds.add(e.id);
  for (const g of (twStats && twStats.result) || []) for (const e of g.entries || []) if (e.id) twIds.add(e.id);

  const covered = [...enIds].filter((id) => TWMAP[id]).length;
  const twMissing = [...twIds].filter((id) => !TWMAP[id]).length;
  const ceiling = [...enIds].filter((id) => !twIds.has(id)).length;

  const usHtml = await getText('https://poe2db.tw/us/Unique_item');
  const twHtml = await getText('https://poe2db.tw/tw/Unique_item');
  let uniTotal = 0, uniCovered = 0;
  if (usHtml && twHtml) {
    const EU = parseUniqueNames(usHtml, 'us'), TU = parseUniqueNames(twHtml, 'tw');
    const common = Object.keys(EU).filter((s) => TU[s]);
    uniTotal = common.length;
    uniCovered = common.filter((s) => DICT[EU[s]]).length;
  }

  const md = [
    '# POE2 繁中腳本 覆蓋率週報',
    '',
    '- 產生時間：' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    '- 腳本版本：**v' + version + '**',
    '',
    '## 詞綴（TWMAP）',
    '',
    '| 項目 | 數量 |',
    '|---|---|',
    '| GGG 線上 stat 總數 | ' + enIds.size + ' |',
    '| 已收錄 TW 模板 | ' + Object.keys(TWMAP).length + ' |',
    '| 已覆蓋（佔 GGG 總數） | ' + covered + '（' + ((covered / (enIds.size || 1)) * 100).toFixed(1) + '%） |',
    '| 臺服有譯名但尚未收錄 | ' + twMissing + ' |',
    '| 天花板（GGG/臺服皆未翻，不補） | ' + ceiling + ' |',
    '',
    '## 傳奇（poe2db 對照）',
    '',
    (uniTotal ? '| 項目 | 數量 |\n|---|---|\n| 可配對傳奇總數 | ' + uniTotal + ' |\n| 已收錄譯名 | ' + uniCovered + '（' + ((uniCovered / uniTotal) * 100).toFixed(1) + '%） |\n| 待補 | ' + (uniTotal - uniCovered) + ' |' : '（poe2db 本次取不到，略過）'),
    '',
    '## 物品 / 介面（DICT）',
    '',
    '- DICT 鍵數（含後綴區塊）：' + Object.keys(DICT).length,
    '',
    '> 天花板項目屬 GGG 自行未本地化，依專案硬規則不臆測補入。',
  ].join('\n');

  fs.writeFileSync(OUT, md);
  console.log(md);

  // CI 才開 Issue
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) { console.log('\n（無 GITHUB_TOKEN，略過開 Issue）'); return; }
  const AH = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'coverage-report' };
  const title = 'POE2 繁中腳本 覆蓋率週報';
  const list = await (await fetch(`https://api.github.com/repos/${repo}/issues?labels=coverage-report&state=open&per_page=1`, { headers: AH })).json();
  if (Array.isArray(list) && list.length) {
    const n = list[0].number;
    await fetch(`https://api.github.com/repos/${repo}/issues/${n}`, { method: 'PATCH', headers: AH, body: JSON.stringify({ title, body: md }) });
    console.log('\n✅ 已更新 Issue #' + n);
  } else {
    const c = await (await fetch(`https://api.github.com/repos/${repo}/issues`, { method: 'POST', headers: AH, body: JSON.stringify({ title, body: md, labels: ['coverage-report'] }) })).json();
    console.log('\n✅ 已開 Issue #' + (c.number || '?'));
  }
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
