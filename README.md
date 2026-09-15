# POE2 Trade 繁體中文化

把 **Path of Exile 2 國際服市集**（`pathofexile.com/trade2`）介面與物品資訊翻成**繁體中文**（臺服用語）的 Tampermonkey 使用者腳本。

- 物品 / 傳奇 / 介面文字 → 繁中（字典替換）
- 詞綴 → 攔截 `api/trade2/data` 與 `api/trade2/fetch` 回傳，套用臺服詞綴模板
- 搜尋框可直接打**繁中**並觸發站方建議選單（中文 → 英文查詢橋接）

## 安裝

1. 瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 皆可）
2. 開啟這個網址安裝腳本：

   ```
   https://raw.githubusercontent.com/Oiii-bin/poe2-trade-zh-tw/main/poe2-trade-zh-tw.user.js
   ```

   或手動：Tampermonkey → 控制台 → 實用工具 → 新增腳本 → 貼上 `poe2-trade-zh-tw.user.js` 內容

3. 打開 [pathofexile.com/trade2](https://www.pathofexile.com/trade2) 即可生效

## 自動更新

腳本 header 已設定 `@updateURL` / `@downloadURL`，Tampermonkey 會定期檢查
`raw.githubusercontent.com` 上的版本號。往後只要本倉庫推送新版本，你的瀏覽器就會自動更新
（或在 Tampermonkey 控制台手動按「檢查使用者腳本更新」）。

> 注意：`@grant none` 是本腳本的必要設定（任何 `@grant` 都會讓 fetch/XHR 攔截失效），請勿更改。
>
> 若改版後瀏覽器沒更新：Tampermonkey 是比對 `@version` 決定要不要重新下載的，版本號沒提升就不會觸發更新。

## 目前版本

- **v4.21**
- 物品對照 **6987** 條 / 詞綴 TW 資料 **6799** 筆
- v4.18：移除每文字節點的 `getComputedStyle` 偵測（改用「翻不出就試一次全大寫」懶惰回退），加快交易站動態內容翻譯。
- v4.19：掃描發現基底物品只翻後綴漏整名（如 `Gladiator Armour`→`衛士護甲`），補 25 筆整名譯（poe2db.tw 實證）。
- v4.20：覆蓋率掃描發現 partial 清單藏基底整名缺口（只翻後綴基底型、漏前綴形容詞/專名，如 `Lupine Sceptre`→`兇殘權杖`、`Golden Shield`→`黃金盾牌`），補 53 筆整名譯（poe2db.tw data-tabname 實證）；另 25 筆 fullGap 經實證為 POE1 污染（Scarab / To-the-Goddess / Leaguestone / legacy gem），不補。
- v4.21：詞綴覆蓋率審計（比對交易站授權詞綴清單 `intl_stats.json`）發現 2333 筆 TWMAP 缺口；其中 175 筆為 fractured / crafted / enchant / augment / desecrated 變體，其底層 `explicit.` / `implicit.` 同文本模板已存在於 TWMAP，直接鏡像補入（同文本保證翻譯正確、無臆測）。其餘 2158 筆（593 explicit + 其變體 + implicit）本機無權威 TW 來源（`tw_stats.json` 僅 5841 筆、不含這些 id），**不臆測翻譯**，待取得 TW 詞綴來源後再補。

## 授權

本專案由 Oiii-bin 維護，僅供個人遊玩輔助使用。
