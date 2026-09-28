// -*- coding: utf-8 -*-
// 在 Node 中以模擬 DOM / fetch / MutationObserver 實跑 userscript,
// 驗證: (1) 載入不報錯 (2) 啟動日誌印出 DICT/TWMAP 數量
//       (3) 詞綴資料層攔截: 英文 stat -> 繁中  (4) 物品文字替換: 英文 -> 繁中
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('poe2-trade-zh-tw.user.js', 'utf-8');
// 注入除錯匯出，供 v4.5 資料層/請求橋接測試使用（不改動正式腳本）
let code2 = code.replace('  startWalk();',
  '  window.__POE2DBG = { revRequestBody, rewriteItems, zh2en, presetSave, presetList, presetDel, appPushGroup, appStats, buildPresetPanel };  startWalk();');

const logs = [], errors = [];
let moCallback = null;

class MockMutationObserver {
  constructor(cb) { moCallback = cb; }
  observe() {}
  disconnect() {}
}
function textNode(val) {
  return { nodeType: 3, nodeValue: val, parentNode: { tagName: 'DIV' } };
}

const documentElement = { nodeType: 1, childNodes: [], parentNode: null, tagName: 'HTML' };
const docHandlers = {};   // v4.3：捕捉 userscript 註冊的 document 事件監聽器（中文橋接測試用）
const sandbox = {
  console: {
    log: (...a) => logs.push(a.join(' ')),
    error: (...a) => errors.push(a.join(' ')),
    warn: (...a) => logs.push('WARN ' + a.join(' ')),
  },
  MutationObserver: MockMutationObserver,
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.document = {
  body: null, documentElement, createElement: () => ({ style: {} }),
  addEventListener: (t, f) => { docHandlers[t] = f; },
  removeEventListener: () => {},
};
sandbox.Event = class { constructor(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles); } };
sandbox.XMLHttpRequest = function () {};   // hookData 會改寫 window.XMLHttpRequest; 此處 prototype 為 undefined -> 跳過 XHR 分支, 安全
sandbox.Response = Response;               // Node 22 原生

// 提供一支 fetch: 回傳含英文詞綴的 samples, 交給腳本攔截改寫
const SAMPLE = {
  result: [
    { id: 'pseudo.pseudo_total_cold_resistance', text: '+#% total to Cold Resistance' },
    { id: 'dexterity', text: '+# to Dexterity' },
    { entries: [ { id: 'explicit.stat_709508406', text: 'Adds # to # Fire Damage' } ] },
  ],
};
// 模擬 /api/trade2/fetch 回傳的物品（description 是已渲染的英文）
const FETCH_SAMPLE = {
  result: [
    {
      item: {
        explicitMods: [
          { description: 'Adds 2 to 5 [Fire|Fire] Damage', hash: 'stat.explicit.stat_709508406', mods: [{ name: 'Heated', tier: 'P10' }] },
          { description: '-7% maximum Player Resistances', hash: 'stat.explicit.stat_3376488707', mods: [{ name: 'Illness', tier: 'S1' }] }
        ],
        properties: [
          { name: '[Mace|One Hand Mace]', values: [], displayMode: 0, type: 109 },
          { name: '[Physical] Damage', values: [['12-21', 1]], displayMode: 0, type: 9 },
          { name: 'Attacks per Second', values: [['1.55', 0]], displayMode: 0, type: 13 },
          { name: 'Recovers {0} Life over {1} Seconds', values: [['100', 0], ['3', 0]], displayMode: 0, type: 5 }
        ],
        requirements: [
          { name: 'Level', values: [['10', 0]], displayMode: 0, type: 62 },
          { name: '[Strength|Str]', values: [['21', 0]], displayMode: 1, type: 63 }
        ]
      }
    }
  ]
};
sandbox.fetch = async (input) => {
  const url = (typeof input === 'string') ? input : (input && input.url) || '';
  const data = url.indexOf('api/trade2/fetch') !== -1 ? FETCH_SAMPLE : SAMPLE;
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
};

// ---- 執行腳本 ----
let loadErr = null;
try {
  vm.runInNewContext(code2, sandbox, { filename: 'poe2-trade-zh-tw.user.js' });
} catch (e) {
  loadErr = e;
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
}

// (1) 載入
check('腳本載入無例外', !loadErr, loadErr ? String(loadErr) : 'OK');

// (2) 啟動日誌
const startLog = logs.find(l => l.includes('啟動'));
check('印出啟動日誌', !!startLog, startLog || '缺少啟動日誌');
const m = startLog && startLog.match(/啟動 v([\d.]+)：物品對照 (\d+) 條 \/ 詞綴 TW 資料 (\d+) 筆/);
const HDR_VER = (code.match(/@version ([\d.]+)/) || [])[1];
check('啟動日誌版本號 = header @version（防人工 bump 漏改日誌）', m && m[1] === HDR_VER, 'log=' + (m && m[1]) + ' header=' + HDR_VER);
check('DICT 數量=7059 (v4.30 +9 上架時間選項、v4.31 +10 聯盟名/最後通牒篩選，各 ×Title/大寫雙鍵；以啟動日誌實測值為準、禁手算)', m && m[2] === '7059', m ? 'DICT=' + m[2] : '未解析');
check('TWMAP 數量=7356 (v4.21 +175 筆 + v4.22 +528 筆 = 703 筆 fractured/crafted/enchant/rune/desecrated 變體鏡像；v4.24 週同步 +12 筆；v4.26 +1 筆安全鏡像；以啟動日誌實測值為準、禁手算)', m && m[3] === '7356', m ? 'TWMAP=' + m[3] : '未解析');

// (3) 詞綴資料層攔截改寫
(async () => {
  try {
    const resp = await sandbox.window.fetch('https://www.pathofexile.com/api/trade2/data/stats');
    const j = await resp.json();
    const cold = j.result[0];
    const fire = j.result[2].entries[0];
    check('詞綴攔截: 冰冷抗性 EN->TW',
      cold.text && cold.text !== '+#% total to Cold Resistance' && /[\u4e00-\u9fff]/.test(cold.text),
      'cold.text = ' + cold.text);
    check('詞綴攔截: 火焰傷害 EN->TW',
      fire.text && fire.text !== 'Adds # to # Fire Damage' && /[\u4e00-\u9fff]/.test(fire.text),
      'fire.text = ' + fire.text);
    // dexterity 不在 TWMAP -> 應保持英文
    check('無對應詞綴保持原樣', j.result[1].text === '+# to Dexterity', 'dex.text = ' + j.result[1].text);

    // (3b) /api/trade2/fetch 回傳的物品詞綴物件（description + hash）翻譯
    const respFetch = await sandbox.window.fetch('https://www.pathofexile.com/api/trade2/fetch/abc?query=x');
    const jf = await respFetch.json();
    const fireMod = jf.result[0].item.explicitMods[0];
    const resMod = jf.result[0].item.explicitMods[1];
    check('搜索結果詞綴: Adds Fire Damage -> 附加火焰傷害',
      fireMod.description && fireMod.description.indexOf('Adds') === -1 && /[\u4e00-\u9fff]/.test(fireMod.description),
      'fire.description = ' + fireMod.description);
    check('搜索結果詞綴: 負值 maximum Player Resistances -> 玩家最大抗性',
      resMod.description && resMod.description.indexOf('maximum Player Resistances') === -1 && /[\u4e00-\u9fff]/.test(resMod.description),
      'res.description = ' + resMod.description);

    // (3c) 物品屬性 / 需求 標籤（含 GGG 標記）翻譯
    const it = jf.result[0].item;
    check('屬性標籤: [Mace|One Hand Mace] -> 單手錘',
      it.properties[0].name === '單手錘', 'got=' + it.properties[0].name);
    check('屬性標籤: [Physical] Damage -> 物理傷害',
      it.properties[1].name === '物理傷害', 'got=' + it.properties[1].name);
    check('屬性標籤: Attacks per Second -> 攻擊速度',
      it.properties[2].name === '攻擊速度', 'got=' + it.properties[2].name);
    check('屬性標籤(模板型): Recovers {0} Life over {1} Seconds -> 在 {1} 秒內回復 {0} 生命',
      it.properties[3].name === '在 {1} 秒內回復 {0} 生命', 'got=' + it.properties[3].name);
    check('需求標籤: [Strength|Str] -> 力量',
      it.requirements[1].name === '力量', 'got=' + it.requirements[1].name);
  } catch (e) {
    check('詞綴攔截執行', false, String(e));
  }

  // (4) 物品文字替換 (MutationObserver callback)
  if (moCallback) {
    const n1 = textNode('Exalted Orb');
    const n2 = textNode('Waystone (Tier 1)');
    const n3 = textNode('Pack Size: +12%');
    moCallback([{ addedNodes: [n1, n2, n3] }]);
    check('物品替換: Exalted Orb -> 崇高石', n1.nodeValue === '崇高石', 'got=' + n1.nodeValue);
    check('物品替換: Waystone -> 換界石', n2.nodeValue === '換界石（階級 1）', 'got=' + n2.nodeValue);
    check('屬性DOM替換: Pack Size -> 隊伍尺寸', n3.nodeValue === '隊伍尺寸: +12%', 'got=' + n3.nodeValue);
    const n4 = textNode('Search Items');
    const n5 = textNode('Soul Cores');
    const n6 = textNode('MIN');
    moCallback([{ addedNodes: [n4, n5, n6] }]);
    check('分類/介面替換: Search Items -> 搜尋物品', n4.nodeValue === '搜尋物品', 'got=' + n4.nodeValue);
    check('分類/介面替換: Soul Cores -> 靈魂核心', n5.nodeValue === '靈魂核心', 'got=' + n5.nodeValue);
    check('分類/介面替換: MIN -> 最小', n6.nodeValue === '最小', 'got=' + n6.nodeValue);
    const n7 = textNode('BUCKLER');
    const n8 = textNode('ANY ACCESSORY');
    const n9 = textNode('SKILL GEM');
    const n10 = textNode('SUPPORT GEM');
    const n11 = textNode('META GEM');
    const n12 = textNode('ANY GEM');
    moCallback([{ addedNodes: [n7, n8, n9, n10, n11, n12] }]);
    check('Type篩選: BUCKLER -> 圓盾', n7.nodeValue === '圓盾', 'got=' + n7.nodeValue);
    check('Type篩選: ANY ACCESSORY -> 任意飾品', n8.nodeValue === '任意飾品', 'got=' + n8.nodeValue);
    check('Type篩選: SKILL GEM -> 技能寶石', n9.nodeValue === '技能寶石', 'got=' + n9.nodeValue);
    check('Type篩選: SUPPORT GEM -> 輔助寶石', n10.nodeValue === '輔助寶石', 'got=' + n10.nodeValue);
    check('Type篩選: META GEM -> 主要寶石', n11.nodeValue === '主要寶石', 'got=' + n11.nodeValue);
    check('Type篩選: ANY GEM -> 任意寶石', n12.nodeValue === '任意寶石', 'got=' + n12.nodeValue);
    // v3.4 第二輪補漏 + 單詞邊界
    const n13 = textNode('PINNACLE KEY');
    const n14 = textNode('LIFE FLASK');
    const n15 = textNode('LOGBOOK');
    const n16 = textNode('BARYA');
    const n17 = textNode('MAP FRAGMENT');
    const n18 = textNode('ANY ENDGAME ITEM');
    const n19 = textNode('Djinn Barya');
    const n20 = textNode('ADMIN');
    moCallback([{ addedNodes: [n13, n14, n15, n16, n17, n18, n19, n20] }]);
    check('Type篩選: PINNACLE KEY -> 巔峰之鑰（邊界修復，不再被 PIN 吃掉）', n13.nodeValue === '巔峰之鑰', 'got=' + n13.nodeValue);
    check('Type篩選: LIFE FLASK -> 生命藥劑', n14.nodeValue === '生命藥劑', 'got=' + n14.nodeValue);
    check('Type篩選: LOGBOOK -> 日誌', n15.nodeValue === '日誌', 'got=' + n15.nodeValue);
    check('Type篩選: BARYA -> 試煉代幣', n16.nodeValue === '試煉代幣', 'got=' + n16.nodeValue);
    check('Type篩選: MAP FRAGMENT -> 地圖碎片', n17.nodeValue === '地圖碎片', 'got=' + n17.nodeValue);
    check('Type篩選: ANY ENDGAME ITEM -> 任意終局物品', n18.nodeValue === '任意終局物品', 'got=' + n18.nodeValue);
    check('物品替換: Djinn Barya -> 巨靈之幣', n19.nodeValue === '巨靈之幣', 'got=' + n19.nodeValue);
    check('邊界防誤傷: ADMIN 保持原樣（MIN 不再吃單詞內部）', n20.nodeValue === 'ADMIN', 'got=' + n20.nodeValue);
    // v3.5 篩選面板欄位
    const n21 = textNode('One-Handed Mace');
    const n22 = textNode('UNARMED');
    const n23 = textNode('Any Two-Handed Melee Weapon');
    const n24 = textNode('EQUIPMENT');
    const n25 = textNode('MISCELLANEOUS');
    const n26 = textNode('RUNIC WARD');
    const n27 = textNode('SACRED WATER');
    const n28 = textNode('STACK SIZE');
    moCallback([{ addedNodes: [n21, n22, n23, n24, n25, n26, n27, n28] }]);
    check('Type篩選: One-Handed Mace -> 單手錘（組合詞）', n21.nodeValue === '單手錘', 'got=' + n21.nodeValue);
    check('Type篩選: UNARMED -> 空手', n22.nodeValue === '空手', 'got=' + n22.nodeValue);
    check('Type篩選: Any Two-Handed Melee Weapon -> 任意雙手近戰武器（多鍵組合）', n23.nodeValue === '任意雙手近戰武器', 'got=' + n23.nodeValue);
    check('篩選欄位: EQUIPMENT -> 裝備', n24.nodeValue === '裝備', 'got=' + n24.nodeValue);
    check('篩選欄位: MISCELLANEOUS -> 其他', n25.nodeValue === '其他', 'got=' + n25.nodeValue);
    check('篩選欄位: RUNIC WARD -> 符文保護', n26.nodeValue === '符文保護', 'got=' + n26.nodeValue);
    check('篩選欄位: SACRED WATER -> 神聖之水', n27.nodeValue === '神聖之水', 'got=' + n27.nodeValue);
    check('篩選欄位: STACK SIZE -> 堆疊數量', n28.nodeValue === '堆疊數量', 'got=' + n28.nodeValue);
    // v3.6 Trade 篩選交易選項（Title Case 雙保險）
    const n29 = textNode('TRADE FILTERS');
    const n30 = textNode('Seller Account');
    const n31 = textNode('GOLD FEE');
    const n32 = textNode('ANY TIME');
    const n33 = textNode('Buyout or Fixed Price');
    const n34 = textNode('Min');
    const n35 = textNode('No');
    moCallback([{ addedNodes: [n29, n30, n31, n32, n33, n34, n35] }]);
    check('Trade篩選: TRADE FILTERS -> 交易篩選（站方 CSS 小寫轉大寫、DOM=Title Case）', n29.nodeValue === '交易篩選', 'got=' + n29.nodeValue);
    check('Trade篩選: Seller Account -> 賣家帳號', n30.nodeValue === '賣家帳號', 'got=' + n30.nodeValue);
    check('Trade篩選: GOLD FEE -> 金幣費用', n31.nodeValue === '金幣費用', 'got=' + n31.nodeValue);
    check('Trade篩選: ANY TIME -> 任何時間（v4.30 對齊臺服官方 filters 文案）', n32.nodeValue === '任何時間', 'got=' + n32.nodeValue);
    check('Trade篩選: Buyout or Fixed Price -> 一口價或定價（全短語鍵蓋過舊 Buyout->購買）', n33.nodeValue === '一口價或定價', 'got=' + n33.nodeValue);
    check('Trade篩選: Min -> 最小（Title Case 補齊，原 MIN 已存在）', n34.nodeValue === '最小', 'got=' + n34.nodeValue);
    check('Trade篩選: No -> 否', n35.nodeValue === '否', 'got=' + n35.nodeValue);
    // v4.30 上架時間下拉（臺服官方 /api/trade2/data/filters indexed 欄位權威文案）
    const t1 = textNode('UP TO AN HOUR AGO');
    const t2 = textNode('Up to 12 Hours Ago');
    const t3 = textNode('UP TO A WEEK AGO');
    const t4 = textNode('Up to 2 Months Ago');
    const t5 = textNode('Any Time');
    moCallback([{ addedNodes: [t1, t2, t3, t4, t5] }]);
    check('v4.30 時間選項: UP TO AN HOUR AGO -> 1 小時前（大寫變體自動展開）', t1.nodeValue === '1 小時前', 'got=' + t1.nodeValue);
    check('v4.30 時間選項: Up to 12 Hours Ago -> 12 小時前', t2.nodeValue === '12 小時前', 'got=' + t2.nodeValue);
    check('v4.30 時間選項: UP TO A WEEK AGO -> 至多 1 個禮拜前', t3.nodeValue === '至多 1 個禮拜前', 'got=' + t3.nodeValue);
    check('v4.30 時間選項: Up to 2 Months Ago -> 至多 2 個月前', t4.nodeValue === '至多 2 個月前', 'got=' + t4.nodeValue);
    check('v4.30 時間選項: Any Time -> 任何時間（Title Case 鍵）', t5.nodeValue === '任何時間', 'got=' + t5.nodeValue);
    // v4.31 聯盟選擇器 + 最後通牒篩選（臺服官方 data/leagues、data/filters 權威文案）
    const g1 = textNode('Forbidden Rites');
    const g2 = textNode('HC Forbidden Rites');
    const g3 = textNode('STANDARD');
    const g4 = textNode('Hardcore');
    const g5 = textNode('Ultimatum Trial Hint');
    const g6 = textNode('VICTORIOUS');
    const g7 = textNode('Cowardly');
    const g8 = textNode('Deadly');
    moCallback([{ addedNodes: [g1, g2, g3, g4, g5, g6, g7, g8] }]);
    check('v4.31 聯盟: Forbidden Rites -> 禁忌儀式', g1.nodeValue === '禁忌儀式', 'got=' + g1.nodeValue);
    check('v4.31 聯盟: HC Forbidden Rites -> 禁忌儀式 專家模式', g2.nodeValue === '禁忌儀式 專家模式', 'got=' + g2.nodeValue);
    check('v4.31 聯盟: STANDARD -> 標準模式（大寫變體）', g3.nodeValue === '標準模式', 'got=' + g3.nodeValue);
    check('v4.31 聯盟: Hardcore -> 專家模式', g4.nodeValue === '專家模式', 'got=' + g4.nodeValue);
    check('v4.31 最後通牒: Ultimatum Trial Hint -> 最後通牒試煉提示', g5.nodeValue === '最後通牒試煉提示', 'got=' + g5.nodeValue);
    check('v4.31 最後通牒: VICTORIOUS -> 勝利', g6.nodeValue === '勝利', 'got=' + g6.nodeValue);
    check('v4.31 最後通牒: Cowardly -> 怯懦', g7.nodeValue === '怯懦', 'got=' + g7.nodeValue);
    check('v4.31 最後通牒: Deadly -> 致命', g8.nodeValue === '致命', 'got=' + g8.nodeValue);
    // v4.30 placeholder 屬性翻譯（INPUT 只譯 placeholder、不碰 value）
    const inp = {
      nodeType: 1, tagName: 'INPUT', childNodes: [],
      _placeholder: 'Enter account name...', _set: null,
      getAttribute(k) { return k === 'placeholder' ? this._placeholder : null; },
      setAttribute(k, v) { if (k === 'placeholder') { this._set = v; this._placeholder = v; } },
    };
    const ta = {
      nodeType: 1, tagName: 'TEXTAREA', childNodes: [],
      _placeholder: 'UP TO AN HOUR AGO', _set: null,   // 走大寫懶惰回退路徑
      getAttribute(k) { return k === 'placeholder' ? this._placeholder : null; },
      setAttribute(k, v) { if (k === 'placeholder') { this._set = v; this._placeholder = v; } },
    };
    moCallback([{ type: 'attributes', target: inp }]);
    moCallback([{ type: 'attributes', target: ta }]);
    check('v4.30 placeholder: input placeholder -> 輸入帳號名稱...（value 不受影響）', inp._set === '輸入帳號名稱...', 'got=' + inp._set);
    check('v4.30 placeholder: textarea 大寫回退 -> 1 小時前', ta._set === '1 小時前', 'got=' + ta._set);
    // v3.7 Stat 篩選邏輯詞
    const n36 = textNode('STAT FILTERS');
    const n37 = textNode('Add Stat Group');
    const n38 = textNode('IF');
    const n39 = textNode('COUNT');
    const n40 = textNode('WEIGHTED SUM V2');
    const n41 = textNode('CRUCIBLE PASSIVE TREE PATH');
    const n42 = textNode('MERCENARY SKILL GROUP');
    moCallback([{ addedNodes: [n36, n37, n38, n39, n40, n41, n42] }]);
    check('Stat篩選: STAT FILTERS -> 屬性篩選', n36.nodeValue === '屬性篩選', 'got=' + n36.nodeValue);
    check('Stat篩選: Add Stat Group -> 新增屬性群組', n37.nodeValue === '新增屬性群組', 'got=' + n37.nodeValue);
    check('Stat篩選: IF -> 若', n38.nodeValue === '若', 'got=' + n38.nodeValue);
    check('Stat篩選: COUNT -> 計數', n39.nodeValue === '計數', 'got=' + n39.nodeValue);
    check('Stat篩選: WEIGHTED SUM V2 -> 加權總和 V2', n40.nodeValue === '加權總和 V2', 'got=' + n40.nodeValue);
    check('Stat篩選: CRUCIBLE PASSIVE TREE PATH -> 熔爐天賦樹路徑', n41.nodeValue === '熔爐天賦樹路徑', 'got=' + n41.nodeValue);
    check('Stat篩選: MERCENARY SKILL GROUP -> 傭兵技能群組', n42.nodeValue === '傭兵技能群組', 'got=' + n42.nodeValue);
    // v4.1 Type/Rarity 下拉全大寫補譯（原生全大寫 DOM，非 CSS 轉換）
    const n43 = textNode('SCEPTRE');
    const n44 = textNode('NORMAL');
    const n45 = textNode('MAGIC');
    const n46 = textNode('RARE');
    const n47 = textNode('UNIQUE');
    const n48 = textNode('UNIQUE (FOIL)');
    const n49 = textNode('NON-UNIQUE');
    const n50 = textNode('QUIVER');
    const n51 = textNode('BOW');
    const n52 = textNode('CROSSBOW');
    const n53 = textNode('QUARTERSTAFF');
    const n54 = textNode('FLAIL');
    moCallback([{ addedNodes: [n43, n44, n45, n46, n47, n48, n49, n50, n51, n52, n53, n54] }]);
    check('Type/Rarity篩選: SCEPTRE -> 權杖（原生全大寫 DOM 修復）', n43.nodeValue === '權杖', 'got=' + n43.nodeValue);
    check('Rarity篩選: NORMAL -> 普通', n44.nodeValue === '普通', 'got=' + n44.nodeValue);
    check('Rarity篩選: MAGIC -> 魔法', n45.nodeValue === '魔法', 'got=' + n45.nodeValue);
    check('Rarity篩選: RARE -> 稀有', n46.nodeValue === '稀有', 'got=' + n46.nodeValue);
    check('Rarity篩選: UNIQUE -> 傳奇', n47.nodeValue === '傳奇', 'got=' + n47.nodeValue);
    check('Rarity篩選: UNIQUE (FOIL) -> 傳奇 (鍍膜)（UNIQUE+FOIL 兩鍵組合）', n48.nodeValue === '傳奇 (鍍膜)', 'got=' + n48.nodeValue);
    check('Rarity篩選: NON-UNIQUE -> 非傳奇（不被 UNIQUE 吃掉）', n49.nodeValue === '非傳奇', 'got=' + n49.nodeValue);
    check('Type篩選: QUIVER -> 箭袋（新增）', n50.nodeValue === '箭袋', 'got=' + n50.nodeValue);
    check('Type篩選: BOW -> 弓', n51.nodeValue === '弓', 'got=' + n51.nodeValue);
    check('Type篩選: CROSSBOW -> 十字弓', n52.nodeValue === '十字弓', 'got=' + n52.nodeValue);
    check('Type篩選: QUARTERSTAFF -> 長棍', n53.nodeValue === '長棍', 'got=' + n53.nodeValue);
    check('Type篩選: FLAIL -> 連枷', n54.nodeValue === '連枷', 'got=' + n54.nodeValue);
    // v4.2 自動全大寫變體展開（新增任一鍵即自動具備大寫匹配，不需手補雙保險）
    const u1 = textNode('OMENS');            // 僅登錄 Title Case 鍵 "Omens"，大寫由自動展開提供
    const u2 = textNode('CATALYSTS');
    const u3 = textNode('RELIQUARY KEYS');
    const u4 = textNode('ADMIN');            // 邊界防誤傷：不得因展開而變化
    moCallback([{ addedNodes: [u1, u2, u3, u4] }]);
    check('v4.2 自動大寫展開: OMENS -> 預兆', u1.nodeValue === '預兆', 'got=' + u1.nodeValue);
    check('v4.2 自動大寫展開: CATALYSTS -> 催化劑', u2.nodeValue === '催化劑', 'got=' + u2.nodeValue);
    check('v4.2 自動大寫展開: RELIQUARY KEYS -> 聖物鑰匙', u3.nodeValue === '聖物鑰匙', 'got=' + u3.nodeValue);
    check('v4.2 邊界防誤傷: ADMIN 仍保持原樣', u4.nodeValue === 'ADMIN', 'got=' + u4.nodeValue);
    // v4.2 分類/分隔符標籤（臺服 id 對齊出處）
    const L1 = textNode('Currency');
    const L2 = textNode('Sanctum');
    const L3 = textNode('Wombgift');
    const L4 = textNode('Gems');
    const L5 = textNode('Expedition');
    const L6 = textNode('Delirium');
    const L7 = textNode('Breach');
    const L8 = textNode('Ritual');
    const L9 = textNode('Essences');
    const L10 = textNode('Abyssal Bones');
    const L11 = textNode('Augments');
    const L12 = textNode('Flux');
    const L13 = textNode('Liquid Emotions');
    const L14 = textNode('Uncut Gems');
    const L15 = textNode('Uncut Reservation Gems');
    const L16 = textNode('Lineage Support Gems');
    const L17 = textNode('Pinnacle Fragments');
    moCallback([{ addedNodes: [L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12, L13, L14, L15, L16, L17] }]);
    check('v4.2 標籤: Currency -> 通貨', L1.nodeValue === '通貨', 'got=' + L1.nodeValue);
    check('v4.2 標籤: Sanctum -> 聖域', L2.nodeValue === '聖域', 'got=' + L2.nodeValue);
    check('v4.2 標籤: Wombgift -> 胎贈', L3.nodeValue === '胎贈', 'got=' + L3.nodeValue);
    check('v4.2 標籤: Gems -> 技能寶石', L4.nodeValue === '技能寶石', 'got=' + L4.nodeValue);
    check('v4.2 標籤: Expedition -> 死境探險', L5.nodeValue === '死境探險', 'got=' + L5.nodeValue);
    check('v4.2 標籤: Delirium -> 譫妄異域', L6.nodeValue === '譫妄異域', 'got=' + L6.nodeValue);
    check('v4.2 標籤: Breach -> 裂痕聯盟', L7.nodeValue === '裂痕聯盟', 'got=' + L7.nodeValue);
    check('v4.2 標籤: Ritual -> 祭祀', L8.nodeValue === '祭祀', 'got=' + L8.nodeValue);
    check('v4.2 標籤: Essences -> 精髓', L9.nodeValue === '精髓', 'got=' + L9.nodeValue);
    check('v4.2 標籤: Abyssal Bones -> 深淵遺骸', L10.nodeValue === '深淵遺骸', 'got=' + L10.nodeValue);
    check('v4.2 分隔標籤: Augments -> 增幅', L11.nodeValue === '增幅', 'got=' + L11.nodeValue);
    check('v4.2 分隔標籤: Flux -> 溶劑', L12.nodeValue === '溶劑', 'got=' + L12.nodeValue);
    check('v4.2 分隔標籤: Liquid Emotions -> 液態的情感', L13.nodeValue === '液態的情感', 'got=' + L13.nodeValue);
    check('v4.2 未切割系: Uncut Gems -> 未切割的寶石（不被 Gems/技能寶石 汙染）', L14.nodeValue === '未切割的寶石', 'got=' + L14.nodeValue);
    check('v4.2 未切割系: Uncut Reservation Gems -> 未切割的精魂寶石', L15.nodeValue === '未切割的精魂寶石', 'got=' + L15.nodeValue);
    check('v4.2 未切割系: Lineage Support Gems -> 血脈輔助寶石', L16.nodeValue === '血脈輔助寶石', 'got=' + L16.nodeValue);
    check('v4.2 分隔標籤: Pinnacle Fragments -> 巔峰頭目碎片', L17.nodeValue === '巔峰頭目碎片', 'got=' + L17.nodeValue);
    // v4.5 資料層物品漢化 + 請求反向橋接（搜尋框直接打繁中的正確機制）
    const dbg = sandbox.__POE2DBG;
    check('v4.5 除錯匯出就緒', !!dbg, typeof dbg);
    if (dbg) {
      // (a) 資料層：/api/trade2/data/items 回傳的 entry.text 應被設成繁中
      const ITEMS = {
        result: [
          { id: 'accessory', label: 'Accessories', entries: [
            { type: 'Lapis Amulet' },
            { type: 'Gold Ring', name: 'Andvarius', flags: { unique: true } },
            { type: 'Pearlescent Amulet' },
            { type: 'Zzzunknown Amulet' },   // v4.10 後仍刻意無譯的虛構詞，用來驗證「部分命中」
           ] },
        ],
      };
      dbg.rewriteItems(ITEMS.result);
      check('v4.5 資料層: 基底 type 翻譯 (Lapis Amulet 項無 name)',
        ITEMS.result[0].entries[0].text === '海玉護身符', 'got=' + ITEMS.result[0].entries[0].text);
      check('v4.5 資料層: 獨特 name+type 組合 (Andvarius Gold Ring)',
        ITEMS.result[0].entries[1].text === '貪慾之記 金光戒指', 'got=' + ITEMS.result[0].entries[1].text);
      check('v4.10 資料層: 全名鍵命中 (Pearlescent Amulet -> 珠光項鍊，poe2db 取證)',
        ITEMS.result[0].entries[2].text === '珠光項鍊', 'got=' + ITEMS.result[0].entries[2].text);
      check('v4.5 資料層: 部分命中也設 text (Zzzunknown 無譯但 護身符 有譯)',
        ITEMS.result[0].entries[3].text === 'Zzzunknown 護身符', 'got=' + ITEMS.result[0].entries[3].text);
      // (b) 請求反向橋接：把繁中查詢本體轉回英文
      const rb = dbg.revRequestBody(JSON.stringify({ query: { type: { option: '海玉護身符' }, filters: [] } }));
      const rbObj = JSON.parse(rb);
      check('v4.5 請求橋接: 繁中 option -> 英文', rbObj.query.type.option === 'Lapis Amulet', 'got=' + rbObj.query.type.option);
      const rb2 = dbg.revRequestBody(JSON.stringify({ query: { type: { option: 'Lapis Amulet' } } }));
      check('v4.5 請求橋接: 純英文不動', rb2 === JSON.stringify({ query: { type: { option: 'Lapis Amulet' } } }), 'got=' + rb2);
      const rb3 = dbg.revRequestBody('{ "notJson": true }');
      check('v4.5 請求橋接: 無中文直接回傳原串', rb3 === '{ "notJson": true }', 'got=' + rb3);
    }
    // v4.12 珠寶範圍值補譯（避免與藥劑尺寸的 Medium 衝突，使用整句鍵）
    const r1 = textNode('Radius: Small');
    const r2 = textNode('Radius: Medium');
    const r3 = textNode('Radius: Large');
    moCallback([{ addedNodes: [r1, r2, r3] }]);
    check('v4.12 珠寶範圍: Radius: Small -> 範圍：小', r1.nodeValue === '範圍：小', 'got=' + r1.nodeValue);
    check('v4.12 珠寶範圍: Radius: Medium -> 範圍：中', r2.nodeValue === '範圍：中', 'got=' + r2.nodeValue);
    check('v4.12 珠寶範圍: Radius: Large -> 範圍：大', r3.nodeValue === '範圍：大', 'got=' + r3.nodeValue);
    // 藥劑基底尺寸回歸測試（全名鍵，poe2db.tw 實證；已收錄於 base DICT，此處作為防回歸守門）
    const flaskTests = [
      ['Lesser Life Flask', '低階生命藥劑'], ['Medium Life Flask', '中型生命藥劑'],
      ['Greater Life Flask', '良質生命藥劑'], ['Grand Life Flask', '優質生命藥劑'],
      ['Giant Life Flask', '巨型生命藥劑'], ['Colossal Life Flask', '高階生命藥劑'],
      ['Gargantuan Life Flask', '巨大生命藥劑'], ['Transcendent Life Flask', '卓越生命藥劑'],
      ['Ultimate Life Flask', '終極生命藥劑'],
      ['Lesser Mana Flask', '低階魔力藥劑'], ['Medium Mana Flask', '中型魔力藥劑'],
      ['Greater Mana Flask', '良質魔力藥劑'], ['Grand Mana Flask', '優質魔力藥劑'],
      ['Giant Mana Flask', '巨型魔力藥劑'], ['Colossal Mana Flask', '高階魔力藥劑'],
      ['Gargantuan Mana Flask', '巨大魔力藥劑'], ['Transcendent Mana Flask', '卓越魔力藥劑'],
      ['Ultimate Mana Flask', '終極魔力藥劑'],
    ];
    flaskTests.forEach((pair) => {
      const fn = textNode(pair[0]);
      moCallback([{ addedNodes: [fn] }]);
      check('藥劑尺寸: ' + pair[0] + ' -> ' + pair[1], fn.nodeValue === pair[1], 'got=' + fn.nodeValue);
    });
  } else {
    check('MutationObserver 回呼被捕獲', false, 'moCallback 為 null');
  }

  // ===== v4.11 篩選條件預設組 =====
  const dbgP = (sandbox.window && sandbox.window.__POE2DBG) || null;
  if (dbgP && dbgP.presetSave) {
    // 沙箱無 localStorage → 走記憶體備援（hasLS=false），應照樣可用
    dbgP.presetSave('召喚物流', [{ type: 'and', filters: [{ id: 'explicit.stat_1', disabled: false }] }]);
    const l1 = dbgP.presetList();
    check('v4.11 預設: 儲存後讀得到', l1.length === 1 && l1[0].name === '召喚物流',
      'len=' + l1.length + ' name=' + (l1[0] && l1[0].name));
    check('v4.11 預設: 內容含 1 組篩選', l1[0] && l1[0].stats && l1[0].stats.length === 1,
      'groups=' + (l1[0] && l1[0].stats && l1[0].stats.length));

    dbgP.presetSave('召喚物流', [{ type: 'and', filters: [] }, { type: 'weight', filters: [] }]);
    const l2 = dbgP.presetList();
    check('v4.11 預設: 同名覆蓋不重複', l2.length === 1 && l2[0].stats.length === 2,
      'len=' + l2.length + ' groups=' + (l2[0] && l2[0].stats && l2[0].stats.length));

    dbgP.presetSave('弓系物理', [{ type: 'count', filters: [] }]);
    check('v4.11 預設: 第二筆新增', dbgP.presetList().length === 2, 'len=' + dbgP.presetList().length);

    dbgP.presetDel('召喚物流');
    const l3 = dbgP.presetList();
    check('v4.11 預設: 刪除生效', l3.length === 1 && l3[0].name === '弓系物理',
      'len=' + l3.length + ' name=' + (l3[0] && l3[0].name));

    // 載入：模擬站方 Vue 實例（sandbox.window === sandbox，故設 sandbox.app 即可）
    const pushed = [];
    sandbox.app = {
      query: { query: { stats: [] } },
      $store: { commit: function (m, p) { pushed.push([m, p]); } },
    };
    check('v4.11 預設: 讀得到站方 stats 路徑', Array.isArray(dbgP.appStats()), 'appStats=' + typeof dbgP.appStats());
    const okPush = dbgP.appPushGroup({ type: 'and', filters: [{ id: 'x', disabled: false }] });
    check('v4.11 預設: 載入走 $store.commit(pushStatGroup)',
      okPush === true && pushed.length === 1 && pushed[0][0] === 'pushStatGroup',
      'ok=' + okPush + ' pushed=' + JSON.stringify(pushed.map(p => p[0])));
    check('v4.11 預設: 載入內容為深拷貝（不共用參考）',
      pushed.length === 1 && pushed[0][1] !== undefined && typeof pushed[0][1] === 'object',
      'payload=' + JSON.stringify(pushed[0] && pushed[0][1]));

    // 無 window.app 時應降級不拋錯
    sandbox.app = undefined;
    let degraded = null;
    try { degraded = dbgP.appPushGroup({ type: 'and', filters: [] }); } catch (e) { degraded = 'throw:' + e.message; }
    check('v4.11 預設: 無站方實例時降級不拋錯', degraded === false, 'got=' + degraded);

    check('v4.11 預設: 沙箱無 body 時建面板回傳 false', dbgP.buildPresetPanel() === false, 'got=' + dbgP.buildPresetPanel());
  } else {
    check('v4.11 預設: 除錯匯出就緒', false, '__POE2DBG.presetSave 不存在');
  }

  // 輸出
  let pass = 0;
  for (const r of results) {
    console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']');
    if (r.ok) pass++;
  }
  console.log('---');
  console.log('通過 ' + pass + '/' + results.length);
  if (errors.length) console.log('腳本運行期錯誤: ' + errors.join(' | '));
  if (pass === results.length) console.log('✅ 腳本可正常運行');
  else { console.log('❌ 存在失敗項'); process.exitCode = 1; }
})();
