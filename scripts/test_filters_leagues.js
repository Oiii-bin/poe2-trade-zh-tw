// -*- coding: utf-8 -*-
// 用法：node scripts/test_filters_leagues.js <放 intl_filters.json/tw_filters.json/intl_leagues.json/tw_leagues.json 的目錄>
'use strict';
const fs = require('fs');
const path = require('path');
const { shapeIssues, collectFilterPairs, detectNewLeagues, FILTER_SKIP } = require('./filters_leagues');
const dir = process.argv[2] || '.';
const j = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
let n = 0, bad = 0;
function ok(name, cond, detail) {
  n++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) bad++;
}
const enF = j('intl_filters.json'), twF = j('tw_filters.json');
ok('filters 雙語樹結構完全一致', shapeIssues(enF, twF, '').length === 0);
const fp = collectFilterPairs(enF, twF);
ok('擷取 197 個 text 節點', fp.total === 197, 'total=' + fp.total);
ok('Instant Buyout 對齊臺服官方', fp.pairs.some((p) => p[0] === 'Instant Buyout' && p[1] === '即刻購買'));
ok('Waystone Packsize 對齊臺服官方', fp.pairs.some((p) => p[0] === 'Waystone Packsize' && p[1] === '換界石怪物群大小'));
const broken = JSON.parse(JSON.stringify(twF));
broken.result[0].filters[0].option.options.pop();
ok('結構被破壞時拒絕配對', collectFilterPairs(enF, broken).issues.length > 0);
ok('Unique (Foil) 列為已知衝突、不自動補', FILTER_SKIP.has('Unique (Foil)')
  && fp.pairs.some((p) => p[0] === 'Unique (Foil)'));
const enL = j('intl_leagues.json'), twL = j('tw_leagues.json');
const dict = {}; for (const x of enL.result) { dict[x.text] = 'x'; dict[x.text.toUpperCase()] = 'x'; }
ok('現有 6 個聯盟皆已收錄', detectNewLeagues(dict, enL, twL).missing.length === 0);
const enL2 = JSON.parse(JSON.stringify(enL));
enL2.result.push({ id: 'New Test League', realm: 'poe2', text: 'New Test League' });
ok('新聯盟會被偵測且附註不自動翻譯', detectNewLeagues(dict, enL2, twL).missing.length === 1);
console.log('---\n通過 ' + (n - bad) + '/' + n);
if (bad) process.exitCode = 1;
