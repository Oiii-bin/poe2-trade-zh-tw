// -*- coding: utf-8 -*-
// filters_leagues.js — /data/filters 雙語結構對齊 + /data/leagues 新聯盟偵測
// 純函式、不抓網路、不寫檔（loadFullDict 除外，只讀入傳入的程式碼），方便單測。
// 硬規則：filters 只在 EN/TW 樹「逐節點結構完全一致」時才配對；leagues 不自動翻譯。
'use strict';
const vm = require('vm');

// 已知衝突：臺服 filters 寫 "Unique (Foil)" -> "傳奇 (貼模)"，
// 但腳本既有 UNIQUE + FOIL 組合譯法為「傳奇 (鍍膜)」，且 verify_run.js 有斷言鎖定。
// 自動補入會破壞既有譯法 → 明確排除、回報，不靜默覆蓋。
const FILTER_SKIP = new Set(['Unique (Foil)']);

function shapeIssues(a, b, path) {
  path = path || '';
  const out = [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return [path + ': 型別不一致'];
    if (Array.isArray(a)) {
      if (a.length !== b.length) return [path + ': 陣列長度 ' + a.length + ' vs ' + b.length];
      a.forEach((x, i) => out.push(...shapeIssues(x, b[i], path + '/' + i)));
    } else {
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length || ka.some((k) => !(k in b))) return [path + ': 物件鍵不一致'];
      ka.forEach((k) => out.push(...shapeIssues(a[k], b[k], path + '/' + k)));
    }
  } else if (typeof a !== typeof b && a !== null && b !== null) {
    out.push(path + ': 葉節點型別不一致');
  }
  return out;
}

// 回傳 { pairs: [[EN, TW], ...], total, issues }
function collectFilterPairs(en, tw) {
  const issues = shapeIssues(en, tw, '');
  if (issues.length) return { pairs: [], total: 0, issues: issues };
  const cjk = /[\u4e00-\u9fff]/;
  const raw = [];
  let total = 0;
  (function walk(a, b) {
    if (!a || typeof a !== 'object') return;
    if (!Array.isArray(a) && typeof a.text === 'string' && typeof b.text === 'string') {
      total++;
      if (a.text !== b.text && cjk.test(b.text)) raw.push([a.text, b.text]);
    }
    Object.keys(a).forEach((k) => { if (k !== 'text') walk(a[k], b[k]); });
  })(en, tw);
  const seen = new Set(), pairs = [];
  for (const p of raw) {
    if (seen.has(p[0])) continue;
    seen.add(p[0]);
    pairs.push(p);
  }
  return { pairs, total, issues: [] };
}

// 只偵測、不翻譯：國際服聯盟名尚未被 DICT 收錄者寫入 pending 清單。
// EN/TW 端點無共通 id，陣列順序僅供人工參考，依硬規則不自動寫入 DICT。
function detectNewLeagues(dict, enLeagues, twLeagues) {
  const en = ((enLeagues && enLeagues.result) || []).filter((x) => x.realm === 'poe2');
  const tw = ((twLeagues && twLeagues.result) || []).filter((x) => x.realm === 'poe2');
  const aligned = en.length === tw.length;
  const missing = [];
  en.forEach((x, i) => {
    const label = x.text || x.id;
    if (!label || dict[label] || dict[label.toUpperCase()]) return;
    missing.push({
      en: label,
      tw_hint: aligned ? ((tw[i] && (tw[i].text || tw[i].id)) || null) : null,
      note: '順序對照僅供人工確認；無共通 id 對齊，依硬規則不自動翻譯',
    });
  });
  return { missing, aligned, total: en.length };
}

// 以真實執行取得完整 DICT（含 PROP、所有 assign 區塊與自動大寫變體）。
// parseFull() 只解析字面量會漏鍵，filters / leagues 與週報統計都必須用這個。
function loadFullDict(code) {
  const logs = [];
  const documentElement = { nodeType: 1, childNodes: [], parentNode: null, tagName: 'HTML' };
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), error() {}, warn() {} },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    setTimeout, clearTimeout, Response,
    XMLHttpRequest: function () {}, Event: class {},
  };
  sandbox.window = sandbox;
  sandbox.document = {
    body: null, documentElement, createElement: () => ({ style: {} }),
    addEventListener() {}, removeEventListener() {},
  };
  sandbox.fetch = async () => new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const anchor = '  const KEYS = Object.keys(DICT)';
  if (code.indexOf(anchor) < 0) throw new Error('找不到 KEYS 錨點');
  vm.runInNewContext(code.replace(anchor, '  window.__FULLDICT = DICT;\n' + anchor, 1), sandbox, { filename: 'userscript' });
  return sandbox.__FULLDICT;
}

module.exports = { shapeIssues, collectFilterPairs, detectNewLeagues, FILTER_SKIP, loadFullDict };
