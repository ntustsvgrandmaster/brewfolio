# Brewfolio ☕

記下每一杯，找到你喜歡的沖煮方式。

Brewfolio 是個人咖啡沖煮日誌，記錄沖煮參數、注水過程和品飲心得。

## 目前功能
- 沖煮紀錄新增、查閱與刪除。
- 詳情頁「再煮一杯」：沿用豆款與配方參數，重新記錄時間、評分與心得。
- 豆款管理：名稱、處理法與烘焙度。
- 粉量、研磨度、水量、水溫與冰熱設定。
- 分段注水、等待時間與計時器。
- 酸、甜、苦、醇厚度、香氣的 1–5 分評分。
- 備註編輯、關鍵字搜尋、豆款與冰熱篩選、排序及佳作標記。

## 專案結構
```tex
frontend/index.html              # HTML、CSS 與原生 JavaScript 介面
backend/server.js               # Express API，同時提供前端靜態檔案
database/migrate.js              # 將環境設定傳給 .NET migrator
database/CoffeeMigrator/         # 獨立的 .NET 8 migration 工具
  Migrations/V001__init_schema.sql
.env.example                    # 本機設定範例，不含真實密碼
```

前後端與資料庫 migration 放在同一個 repo，migrator 仍獨立執行。

## 再煮一杯

請先執行 `npm run db:migrate` 套用 `V002__brew_source.sql`，再啟動新版 API。

詳情頁按「再煮一杯」會帶入豆款、粉量、研磨度、冰熱、水量、水溫、冰塊量與各段注水量。計時器、注水與等待時間、評分及心得會清空。儲存後是獨立的新紀錄，不會修改原紀錄。

`brews.source_brew_id` 是可空白的自我關聯外鍵，一般新增為 NULL。刪除來源時設為 NULL，不刪除後續紀錄。若填寫期間來源被刪除，可以移除來源連結後重試，保留已填參數；原豆款已刪除時需重新選擇豆款。

執行 `npm test` 驗證配方複製、結果重置、來源儲存與 API 驗證。測試使用模擬 DOM／資料庫，不會變更本機資料。

## 後續方向
- 摩卡壺沖煮參數與萃取事件紀錄。
- 依歷史沖煮與品飲結果提供 GPT API 建議。
- LINE 或其他 bot 的對話式紀錄與建議。

上述功能仍在規劃中，目前尚未實作。
