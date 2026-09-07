# Brewfolio ☕

記下每一杯，找到你喜歡的沖煮方式。

Brewfolio 是個人咖啡沖煮日誌，記錄沖煮參數、注水過程和品飲心得。

## 目前功能
- 沖煮紀錄新增、查閱與刪除。
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

## 後續方向
- 摩卡壺沖煮參數與萃取事件紀錄。
- 依歷史沖煮與品飲結果提供 GPT API 建議。
- LINE 或其他 bot 的對話式紀錄與建議。

上述功能仍在規劃中，目前尚未實作。
