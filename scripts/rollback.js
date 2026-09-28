// -*- coding: utf-8 -*-
// rollback.js — 還原 userscript 到指定 commit，並把版本號 bump 到「比壞版本更高」
//   （Tampermonkey 靠版本號判斷更新，只還原內容不 bump 的話，使用者不會自動降版）
// 用法：node scripts/rollback.js <good-commit-sha>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const sha = process.argv[2];
if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
  console.error('用法：node scripts/rollback.js <good-commit-sha>');
  process.exit(1);
}

const git = (args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });

let goodScript, goodVerify = null;
try {
  goodScript = git(['show', sha + ':poe2-trade-zh-tw.user.js']);
} catch (e) {
  console.error('❌ 取不到 ' + sha + ' 的 userscript：' + e.message);
  process.exit(1);
}
try { goodVerify = git(['show', sha + ':verify_run.js']); } catch (e) { console.log('（該 commit 無 verify_run.js，略過）'); }

const curPath = path.join(ROOT, 'poe2-trade-zh-tw.user.js');
const cur = fs.readFileSync(curPath, 'utf8');
const curVer = (cur.match(/\/\/ @version ([\d.]+)/) || [])[1] || '0.0';
const parts = curVer.split('.');
parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
const newVer = parts.join('.');
console.log('目前（壞）版本 v' + curVer + ' → 還原 ' + sha.slice(0, 7) + ' 內容，版本號設為 v' + newVer);

let out = goodScript.replace(/\/\/ @version [\d.]+/, '// @version ' + newVer);
out = out.replace(/啟動 v[\d.]+/, '啟動 v' + newVer);
fs.writeFileSync(curPath, out);
if (goodVerify) fs.writeFileSync(path.join(ROOT, 'verify_run.js'), goodVerify);

// 驗證還原後的檔能跑
try {
  const r = execFileSync(process.execPath, [path.join(ROOT, 'verify_run.js')], { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.includes('❌')) {
    console.log('❌ 還原後驗證未通過，放棄：');
    console.log(r.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 10).join('\n'));
    fs.writeFileSync(curPath, cur);
    process.exit(1);
  }
  console.log('✅ 驗證通過：' + (r.match(/通過 \d+\/\d+/) || ['?'])[0]);
} catch (e) {
  console.log('⚠ 無法執行驗證器（略過）：' + (e.message || '').split('\n')[0]);
}
console.log('🔄 已還原為 v' + newVer + '，等待 workflow 提交');
