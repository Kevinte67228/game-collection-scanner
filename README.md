# 🎮 遊戲書背查重神器 (Game Collection Scanner PWA)

專為復古遊戲、實體光碟與卡匣收藏家設計的手機 PWA（漸進式網頁應用）。在二手店（如 Book-off、駿河屋、地下街）巡店採購時，打開相機即可透過 OCR 掃描書背/側標，立即得知是否已在現有收藏庫中，避免重複破費！

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![PWA](https://img.shields.io/badge/PWA-Ready-success.svg)
![Games](https://img.shields.io/badge/Collections-2,143%20Games-orange.svg)

---

## 📱 核心特色

- **純離線可用 (100% Offline)**：內建 23 個主機平台、**2,143 款遊戲**離線索引庫，在地下街或收訊不良處也能秒查。
- **直覺紅綠燈號與感官回饋**：
  - 🔴 **紅燈【已收藏】**：警示重複！不要重複購買（觸發警告震動與提示音）。
  - 🟢 **綠燈【未收藏】**：無重複紀錄，推薦入手（觸發輕快震動與悅耳提示音）。
  - 🟡 **黃燈【跨平台已有】**：例如您已有 SS 版，架上為 PS1 版時貼心提醒。
- **側標/書背專屬取景框**：支援**水平**與**垂直**導引框切換，自動針對書背區域裁切並強化黑白對比度以提升 OCR 辨識率。
- **雙模 OCR 識別引擎**：
  - **離線端側辨識 (Tesseract.js)**：無需網路，直接辨識英數字型商品編號（如 `SLPS 00542`、`GS-9099`、`SHVC-A96J` 等）。
  - **雲端極速高精準 (Google Gemini Flash)**：可在設定頁輸入免費的 Gemini API Key，即使是變形藝術字體日文側標也能 1 秒辨識。
- **急速模糊搜尋 (Fuse.js)**：相機之外，隨時可用文字輸入 2~3 個字或代碼快速手動比對。

---

## 🚀 如何在手機上使用（加入主畫面）

1. **開啟 GitHub Pages 網址**：
   ```
   https://kevinte67228.github.io/game-collection-scanner/
   ```
2. **安裝至手機桌面**：
   - **iOS (iPhone / iPad - Safari)**：
     點擊底部分享按鈕 ➔ 選擇 **「加入主畫面」(Add to Home Screen)**。
   - **Android (Chrome)**：
     點擊右上角選單 ➔ 選擇 **「安裝應用程式」(Install app)**。
3. 即可像原生 App 一樣全螢幕秒開秒用！

---

## 🛠️ 本地開發與資料庫同步

若本機 Excel 收藏清單更新：
```bash
# 重新執行匯出腳本以更新 games.json
python ../scripts/export_pwa_data.py

# 提交並推送到 GitHub
git add .
git commit -m "Update game database"
git push origin main
```

---

## 📄 授權條款
MIT License
