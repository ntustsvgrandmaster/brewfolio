# Brewfolio ☕

一邊煮咖啡，一邊做的小工具。用來記錄豆款、沖煮參數和喝起來的感覺，也當作自己的開發練習。

這個 repo 目前主要用來保存 side project 的開發紀錄與雲端備份。功能會隨著實際沖煮時遇到的問題慢慢調整。

## 現在拿來做什麼

- 管理豆款，記錄每杯的參數、分段注水、評分與心得。
- 搜尋過去的紀錄，標記喜歡的配方。
- 從某杯按「再煮一杯」，帶入參數後再調整，存成獨立的新紀錄。

## 用到的東西

- 前端：HTML、CSS、原生 JavaScript。
- 後端：Node.js、Express。
- 資料庫：MySQL，搭配 .NET 8 寫的 migration 工具。

```text
frontend/                  # 咖啡日誌介面
backend/                   # API
database/CoffeeMigrator/   # 資料庫 migration
database/migrate.js        # migration 執行入口
tests/                     # 自動測試
openapi.yaml               # Swagger / OpenAPI API 規格
.env.example               # 連線設定範例
```

## API 文件

目前的 API 規格寫在 `openapi.yaml`，使用 OpenAPI 3.0.3 格式。之後如果要接 LINE bot、GPT API tool calling，或用 Swagger UI 查看 endpoint，都可以從這份規格開始。

本機開發 API 預設跑在：

```text
http://localhost:3001
```

## 目前 endpoints

| Method | Path | 功能 |
| --- | --- | --- |
| GET | `/api/brews` | 取得沖煮紀錄列表，依時間由新到舊排序，包含豆款顯示名稱、冰熱、星標與備註。 |
| GET | `/api/brews/:id` | 取得單筆沖煮紀錄，包含豆款資料、沖煮參數、評分、備註、來源紀錄與分段注水。 |
| GET | `/api/beans` | 取得所有豆款，依豆款名稱排序。 |
| POST | `/api/brews` | 新增沖煮紀錄與分段注水，並快照當下豆款資訊。 |
| PATCH | `/api/brews/:id/notes` | 更新單筆沖煮紀錄的備註。 |
| PATCH | `/api/brews/:id/starred` | 更新單筆沖煮紀錄的星標狀態。 |
| DELETE | `/api/brews/:id` | 刪除單筆沖煮紀錄與其分段注水。 |
| POST | `/api/beans` | 新增豆款。 |
| PUT | `/api/beans/:id` | 編輯豆款名稱、處理法與烘焙度。 |
| DELETE | `/api/beans/:id` | 刪除豆款。 |

目前 `openapi.yaml` 先整理 GET endpoints；寫入與刪除類 endpoint 會再逐步補進規格。

## 還在想的事

摩卡壺的紀錄方式先多煮幾杯再想，累積一點實際經驗，看看哪些資料真的值得留下來。

之後也想試試 GPT API 搭配 LINE 或其他 bot，根據過去的沖煮紀錄討論下一杯可以怎麼調整。
