# 象棋殘局教練 Xiangqi Coach

上傳象棋殘局照片或手動擺盤，讓引擎算出**最佳下一步**，並以中文記譜與箭頭解說。

純前端、無後端，運算全在你的瀏覽器完成，資料不外流。

## 功能
- 🧩 互動棋盤：拖放／點選擺子、起始局面、清空、翻轉視角、紅先／黑先
- 📷 圖片辨識：上傳殘局照片，用 Google Gemini 自動辨識棋盤預填（需人工校對）
- 🔍 引擎求解：Fairy-Stockfish (WASM) 算出最佳著法、優劣評分、後續變化
- ♟️ 中文記譜：著法自動翻成「炮二平五」式記譜，紅漢字／黑阿拉伯數字

## 技術
- 引擎：[Fairy-Stockfish](https://github.com/fairy-stockfish/fairy-stockfish.wasm) `fairy-stockfish-nnue.wasm`，象棋變體、古典評估（免 NNUE 大檔）
- 多執行緒 WASM 需 `SharedArrayBuffer`，靠 [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker) 在 GitHub Pages 注入 COOP/COEP 標頭啟用
- 圖片辨識：Gemini `gemini-flash-latest`，API 金鑰由使用者輸入、存於瀏覽器 localStorage

## 本機測試
多執行緒 WASM 需要 COOP/COEP 標頭，不能直接雙擊 `index.html` 開啟。用內附的伺服器：

```bash
node devserver.js
# 開 http://localhost:8099
```

## 部署 GitHub Pages
直接把整個資料夾推上 repo 並開啟 Pages 即可（已含 `coi-serviceworker.js` 與 `.nojekyll`）。
首次載入時 service worker 會註冊並自動重整一次以啟用多執行緒。

## 使用注意
- 求解前盤面須同時有紅帥與黑將。
- 若瀏覽器／網路封鎖 service worker，求解功能無法使用，但擺盤與圖片辨識仍可用。
- 圖片辨識結果請務必人工校對後再求解。
