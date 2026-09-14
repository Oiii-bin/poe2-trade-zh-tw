# POE2 Trade 繁體中文化

把 **Path of Exile 2 國際服市集**（`pathofexile.com/trade2`）介面與物品資訊翻成**繁體中文**（臺服用語）的 Tampermonkey 使用者腳本。

- 物品 / 傳奇 / 介面文字 → 繁中（字典替換）
- 詞綴 → 攔截 `api/trade2/data` 與 `api/trade2/fetch` 回傳，套用臺服詞綴模板
- 搜尋框可直接打**繁中**並觸發站方建議選單（中文 → 英文查詢橋接）

## 安裝

1. 瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 皆可）
2. 開啟這個網址安裝腳本：

   ```
   https://raw.githubusercontent.com/oiiiibin-droid/poe2-trade-zh-tw/main/poe2-trade-zh-tw.user.js
   ```

   或手動：Tampermonkey → 控制台 → 實用工具 → 新增腳本 → 貼上 `poe2-trade-zh-tw.user.js` 內容

3. 打開 [pathofexile.com/trade2](https://www.pathofexile.com/trade2) 即可生效

## 自動更新

腳本 header 已設定 `@updateURL` / `@downloadURL`，Tampermonkey 會定期檢查
`raw.githubusercontent.com` 上的版本號。往後只要本倉庫推送新版本，你的瀏覽器就會自動更新
（或在 Tampermonkey 控制台手動按「檢查使用者腳本更新」）。

> 注意：`@grant none` 是本腳本的必要設定（任何 `@grant` 都會讓 fetch/XHR 攔截失效），請勿更改。

## 目前版本

- **v4.16**
- 物品對照 **6831** 條 / 詞綴 TW 資料 **6624** 筆

## 授權

本專案由 oiiiibin-droid 維護，僅供個人遊玩輔助使用。
