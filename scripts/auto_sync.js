// -*- coding: utf-8 -*-
// auto_sync.js — 雲端（GitHub Actions）自動同步 GGG / 臺服資料 → 補進 TWMAP / DICT
//
// 用法：node scripts/auto_sync.js        （在倉庫根目錄執行）
// 行為：有新增才改檔 + bump 版本；沒新增就原樣結束（讓 workflow 不產生空 commit）。
//
// 可靠來源（靠 entry id 對齊，100% 可對齊才用）：
//   1. 詞綴：GGG EN /data/stats + 臺服 TW /data/stats → id 完全一致
//   2. 物品：GGG EN /data/static + 臺服 TW /data/static → id 完全一致（通貨/符文/精髓/換界石…）
//   3. 變體詞綴安全鏡像：底層 explicit/implicit 模板已存在且 EN 文本相同才鏡像
// 硬規則：不臆測。沒有權威臺服譯名的一律不補，只寫入 pending_tw_gaps.json。
//   ⚠ /data/items（armour/weapon/accessory/gem/map）兩邊數量不相等，索引配對不安全 → 不用。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'poe2-trade-zh-tw.user.js');
const VERIFIER = path.join(ROOT, 'verify_run.js');
const GAPS = path.join(ROOT, 'pending_tw_gaps.json');
const ORIG = fs.readFileSync(SCRIPT, 'utf8');
const ORIG_VERIFY = fs.existsSync(VERIFIER) ? fs.readFileSync(VERIFIER, 'utf8') : null;

const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json',
};

async function getJSON(u) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.json();
      console.log('   HTTP ' + r.status + ' → 重試 ' + (i + 1));
    } catch (e) {
      console.log('   ' + (e.code || e.message) + ' → 重試 ' + (i + 1));
    }
    await new Promise((s) => setTimeout(s, 3000));
  }
  throw new Error('無法取得 ' + u);
}

function sliceBalanced(src, startIdx) {
  let i = src.indexOf('{', startIdx), d = 0, e = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) { e = i + 1; break; } }
  }
  return e;
}

// 完整解析：基礎字面量 + 全部 Object.assign 增量（勿只讀基礎字面量，會重複補已補過的）
function parseFull(name) {
  const s0 = ORIG.indexOf('const ' + name + ' = {');
  if (s0 < 0) throw new Error('找不到 const ' + name);
  const obj = new Function('return ' + ORIG.slice(ORIG.indexOf('{', s0), sliceBalanced(ORIG, s0)))();
  const re = new RegExp('Object\\.assign\\(' + name + ', \\{([\\s\\S]*?)\\n  \\}\\);', 'g');
  let m;
  while ((m = re.exec(ORIG))) Object.assign(obj, new Function('return {' + m[1] + '}')());
  return obj;
}

// 以真實執行取得啟動日誌的 DICT / TWMAP 數量（禁手算：DICT 含自動大寫變體）
function runtimeCounts(code) {
  const logs = [];
  const documentElement = { nodeType: 1, childNodes: [], parentNode: null, tagName: 'HTML' };
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), error: () => {}, warn: () => {} },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    setTimeout, clearTimeout,
    Response,
    XMLHttpRequest: function () {},
    Event: class {},
  };
  sandbox.window = sandbox;
  sandbox.document = {
    body: null, documentElement,
    createElement: () => ({ style: {} }),
    addEventListener: () => {}, removeEventListener: () => {},
  };
  sandbox.fetch = async () => new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  vm.runInNewContext(code, sandbox, { filename: 'userscript' });
  const line = logs.find((l) => l.includes('啟動'));
  if (!line) throw new Error('抓不到啟動日誌');
  const m = line.match(/物品對照 (\d+) 條 \/ 詞綴 TW 資料 (\d+) 筆/);
  if (!m) throw new Error('啟動日誌格式不符：' + line);
  return { dict: m[1], twmap: m[2] };
}

function blockFor(name, comment, entries) {
  const lines = entries.map(([k, v]) => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(v) + ',').join('\n');
  return '  Object.assign(' + name + ', {\n' + comment.split('\n').map((l) => '    ' + l).join('\n') + '\n' + lines + '\n  });\n';
}

function injectAfterLastAssign(code, name, block) {
  const re = new RegExp('Object\\.assign\\(' + name + ', \\{[\\s\\S]*?\\n  \\}\\);', 'g');
  let last = -1, m;
  while ((m = re.exec(code))) last = m.index + m[0].length;
  if (last < 0) throw new Error('找不到 Object.assign(' + name + ', ...) 插入點');
  return code.slice(0, last) + '\n\n' + block + code.slice(last);
}

function bumpVersion(v) {
  const parts = v.split('.');
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  return parts.join('.');
}

(async () => {
  console.log('=== POE2 繁中腳本 雲端自動同步 ===');
  const TWMAP = parseFull('TWMAP');
  const DICT = parseFull('DICT');
  console.log('現有完整 TWMAP: ' + Object.keys(TWMAP).length + ' / DICT: ' + Object.keys(DICT).length);

  let enStats, twStats, enStatic, twStatic;
  try {
    console.log('抓取資料中…');
    [enStats, twStats, enStatic, twStatic] = await Promise.all([
      getJSON('https://www.pathofexile.com/api/trade2/data/stats'),
      getJSON('https://www.pathofexile.tw/api/trade2/data/stats'),
      getJSON('https://www.pathofexile.com/api/trade2/data/static'),
      getJSON('https://www.pathofexile.tw/api/trade2/data/static'),
    ]);
  } catch (e) {
    console.log('⚠ 取不到來源資料，本次略過（不視為失敗）：' + e.message);
    process.exit(0);
  }

  const flat = (j) => { const o = {}; for (const g of j.result || []) for (const e of g.entries || []) if (e.id && e.text) o[e.id] = e.text; return o; };
  const EN_STATS = flat(enStats), TW_STATS = flat(twStats);
  const EN_STATIC = flat(enStatic), TW_STATIC = flat(twStatic);
  console.log('來源：GGG EN 詞綴 ' + Object.keys(EN_STATS).length + ' / 臺服詞綴 ' + Object.keys(TW_STATS).length +
    ' / EN static ' + Object.keys(EN_STATIC).length + ' / TW static ' + Object.keys(TW_STATIC).length);

  // (1) 詞綴：臺服有譯名、TWMAP 還沒收 → 直接收錄（權威，零臆測）
  const newAffix = Object.keys(TW_STATS).filter((id) => !TWMAP[id]).map((id) => [id, TW_STATS[id]]);

  // (2) 變體詞綴安全鏡像：底層 explicit/implicit 模板已存在且 EN 文本相同
  const PREFIX = /^(fractured|crafted|enchant|augment|desecrated|rune)\.(stat_\d+)/;
  const mirrored = [];
  for (const id of Object.keys(EN_STATS)) {
    if (TWMAP[id]) continue;
    const m = id.match(PREFIX);
    if (!m) continue;
    const base = 'explicit.' + m[2];
    const base2 = 'implicit.' + m[2];
    const b = TWMAP[base] ? base : (TWMAP[base2] ? base2 : null);
    if (!b) continue;
    if (EN_STATS[id] === EN_STATS[b]) mirrored.push([id, TWMAP[b]]);
  }

  // (3) 物品名：static 靠 id 對齊（兩邊 id 一致才收）
  const newItem = [];
  for (const id of Object.keys(EN_STATIC)) {
    const en = EN_STATIC[id], tw = TW_STATIC[id];
    if (!tw || !en) continue;
    if (DICT[en]) continue;
    if (tw === en) continue;
    newItem.push([en, tw]);
  }

  console.log('--- 增量 ---');
  console.log('  詞綴(臺服權威譯名) ' + newAffix.length + ' 筆');
  console.log('  變體安全鏡像      ' + mirrored.length + ' 筆');
  console.log('  物品名(static)    ' + newItem.length + ' 筆');

  // 記錄天花板缺口（GGG 有、臺服沒翻 → 不臆測）
  const gapIds = Object.keys(EN_STATS).filter((id) => !TW_STATS[id] && !TWMAP[id]);
  let prevGap = { items: [] };
  try { prevGap = JSON.parse(fs.readFileSync(GAPS, 'utf8')); } catch (e) {}
  const gapChanged = JSON.stringify(prevGap.items) !== JSON.stringify(gapIds);
  if (gapChanged) {
    fs.writeFileSync(GAPS, JSON.stringify({ updated: new Date().toISOString(), count: gapIds.length, items: gapIds }, null, 2));
    console.log('  天花板缺口(臺服未翻，不補) ' + gapIds.length + ' 筆 → pending_tw_gaps.json 已更新');
  }

  const total = newAffix.length + mirrored.length + newItem.length;
  if (total === 0 && !gapChanged) {
    console.log('✅ 沒有可補的新內容，結束（不產生 commit）');
    process.exit(0);
  }
  if (total === 0) {
    console.log('✅ 沒有可補的新內容（僅更新缺口清單）');
  }

  // ---- 注入 ----
  const curVer = (ORIG.match(/\/\/ @version ([\d.]+)/) || [])[1];
  const newVer = bumpVersion(curVer || '4.26');
  let code = ORIG;
  const stamp = new Date().toISOString().slice(0, 10);
  const tag = 'v' + newVer;

  if (newAffix.length) {
    code = injectAfterLastAssign(code, 'TWMAP', blockFor('TWMAP',
      '// 🤖 AUTO ' + tag + ' 詞綴自動同步（' + newAffix.length + ' 筆）\n' +
      '//   來源：pathofexile.tw /api/trade2/data/stats，靠 stat id 對齊，臺服權威譯名，零臆測。',
      newAffix));
  }
  if (mirrored.length) {
    code = injectAfterLastAssign(code, 'TWMAP', blockFor('TWMAP',
      '// 🤖 AUTO ' + tag + ' 變體詞綴安全鏡像（' + mirrored.length + ' 筆）\n' +
      '//   底層 explicit/implicit 同文本模板已存在於 TWMAP，直接鏡像，零臆測。',
      mirrored));
  }
  if (newItem.length) {
    code = injectAfterLastAssign(code, 'DICT', blockFor('DICT',
      '// 🤖 AUTO ' + tag + ' 物品名自動同步（' + newItem.length + ' 筆）\n' +
      '//   來源：pathofexile.tw /api/trade2/data/static，靠 entry id 對齊，臺服權威譯名，零臆測。',
      newItem));
  }

  // ---- bump 版本 ----
  code = code.replace(/\/\/ @version [\d.]+/, '// @version ' + newVer);
  code = code.replace(/啟動 v[\d.]+/, '啟動 ' + tag);

  // ---- 同步驗證器斷言（以實測值為準，禁手算）----
  let verifySrc = ORIG_VERIFY;
  if (verifySrc) {
    const c = runtimeCounts(code);
    console.log('實測啟動日誌：DICT=' + c.dict + ' / TWMAP=' + c.twmap);
    verifySrc = verifySrc.replace(/(DICT 數量=)\d+/, '$1' + c.dict);
    verifySrc = verifySrc.replace(/m\[1\] === '\d+'/, "m[1] === '" + c.dict + "'");
    verifySrc = verifySrc.replace(/(TWMAP 數量=)\d+/, '$1' + c.twmap);
    verifySrc = verifySrc.replace(/m\[2\] === '\d+'/, "m[2] === '" + c.twmap + "'");
  }

  // ---- 驗證：不過就還原，絕不提交壞檔 ----
  fs.writeFileSync(SCRIPT, code);
  if (verifySrc) fs.writeFileSync(VERIFIER, verifySrc);
  let out = '', ok = false;
  try {
    out = execFileSync(process.execPath, [VERIFIER], { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    ok = !out.includes('❌');
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '') + '\n[exit=' + e.status + ']';
  }
  if (!ok) {
    console.log('❌ 驗證未通過：');
    const lines = out.split('\n');
    const fails = lines.filter((l) => l.startsWith('FAIL'));
    console.log(fails.slice(0, 15).join('\n') || lines.slice(-40).join('\n'));
    if (process.env.AUTO_SYNC_KEEP) {
      console.log('（AUTO_SYNC_KEEP=1：保留改動供除錯，不還原）');
    } else {
      fs.writeFileSync(SCRIPT, ORIG);
      if (ORIG_VERIFY) fs.writeFileSync(VERIFIER, ORIG_VERIFY);
      console.log('已還原原檔');
    }
    process.exit(1);
  }

  console.log('✅ 驗證通過：' + (out.match(/通過 \d+\/\d+/) || ['?'])[0]);
  console.log('🚀 ' + tag + ' 已寫入（新增 ' + total + ' 筆），等待 workflow 提交');
})().catch((e) => {
  console.error('❌ auto_sync 發生例外：' + e.message);
  try { fs.writeFileSync(SCRIPT, ORIG); if (ORIG_VERIFY) fs.writeFileSync(VERIFIER, ORIG_VERIFY); } catch (_) {}
  process.exit(1);
});
