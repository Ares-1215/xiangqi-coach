/*
 * ocr.js — 離線棋盤辨識（零金鑰、零下載）
 * 方法：使用者點四個角 → 雙線性取樣 90 個交叉點 → 每格用「墨跡樣板比對」判棋子，
 *       顏色（紅/黑）由墨色決定大小寫。純 Canvas，全離線。
 * 適用：清晰的電子棋盤截圖最佳；實體照片可用四角校正但準確度較低。
 */
const OCR = (() => {
  const N = 16; // 特徵解析度 16x16
  const TYPE_OF = {
    帥: "K", 將: "K", 帅: "K", 将: "K",
    仕: "A", 士: "A",
    相: "B", 象: "B",
    俥: "R", 車: "R", 车: "R",
    傌: "N", 馬: "N", 马: "N",
    炮: "C", 砲: "C",
    兵: "P", 卒: "P",
  };
  const FONTS = [
    "'Microsoft JhengHei'", "'Noto Sans TC'", "'Noto Serif TC'",
    "'PMingLiU'", "'DFKai-SB'", "serif", "sans-serif",
  ];

  let templates = null; // [{type, vec}]

  // 將字元渲染成 N×N 墨跡分數向量
  function glyphVector(ch, font) {
    const S = 48;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#000";
    ctx.font = `bold ${Math.floor(S * 0.82)}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, S / 2, S / 2 + 1);
    const d = ctx.getImageData(0, 0, S, S).data;
    // 墨跡遮罩（暗=墨）
    const mask = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
      mask[i] = l < 128 ? 1 : 0;
    }
    return normalizeToVec(mask, S, S);
  }

  // 依墨跡外接框置中裁切 → 縮成 N×N 分數向量（單位化）
  function normalizeToVec(mask, W, H) {
    let minx = W, miny = H, maxx = -1, maxy = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (mask[y * W + x] > 0.3) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
    const vec = new Float32Array(N * N);
    if (maxx < minx) return vec; // 空
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const v = mask[y * W + x];
        if (v <= 0) continue;
        const nx = Math.min(N - 1, Math.floor(((x - minx) / bw) * N));
        const ny = Math.min(N - 1, Math.floor(((y - miny) / bh) * N));
        vec[ny * N + nx] += v;
      }
    }
    // 單位化
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  function buildTemplates() {
    if (templates) return;
    templates = [];
    const seen = Object.keys(TYPE_OF);
    for (const ch of seen)
      for (const f of FONTS) templates.push({ type: TYPE_OF[ch], ch, vec: glyphVector(ch, f) });
  }

  function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // 從一張影像 + 四角，辨識出 grid（10 列字串）
  // corners: {tl,tr,br,bl}，每個為 {x,y}（影像原生像素座標）
  // 回傳 { grid, redBottom, occupied }
  function recognizeGrid(imageData, W, H, corners) {
    buildTemplates();
    const px = imageData.data;
    const { tl, tr, br, bl } = corners;
    // 交叉點影像座標（雙線性）
    const pt = (u, v) => {
      const topx = tl.x * (1 - u) + tr.x * u,
        topy = tl.y * (1 - u) + tr.y * u;
      const botx = bl.x * (1 - u) + br.x * u,
        boty = bl.y * (1 - u) + br.y * u;
      return { x: topx * (1 - v) + botx * v, y: topy * (1 - v) + boty * v };
    };
    // 估格距 → 取樣半徑
    const cellW = Math.hypot(tr.x - tl.x, tr.y - tl.y) / 8;
    const cellH = Math.hypot(bl.x - tl.x, bl.y - tl.y) / 9;
    const R = Math.max(6, Math.floor(Math.min(cellW, cellH) * 0.42));

    const grid = [];
    let occupied = 0;
    for (let r = 0; r < 10; r++) {
      let row = "";
      for (let c = 0; c < 9; c++) {
        const p = pt(c / 8, r / 9);
        const cell = classifyCell(px, W, H, Math.round(p.x), Math.round(p.y), R);
        row += cell;
        if (cell !== ".") occupied++;
      }
      grid.push(row);
    }
    return { grid, occupied };
  }

  // 判斷單格：回傳棋子字母或 "."
  function classifyCell(px, W, H, cx, cy, R) {
    const size = R * 2;
    const mask = new Float32Array(size * size);
    let inkCount = 0,
      redSum = 0,
      inkPix = 0;
    const r2 = R * R;
    for (let dy = -R; dy < R; dy++) {
      for (let dx = -R; dx < R; dx++) {
        if (dx * dx + dy * dy > r2) continue; // 只取圓內
        const x = cx + dx,
          y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        const Rr = px[i], Gg = px[i + 1], Bb = px[i + 2];
        const lum = (Rr + Gg + Bb) / 3;
        const redness = Rr - (Gg + Bb) / 2;
        // 墨＝很暗（黑字）或 強烈偏紅且不太亮（紅字）；排除木底(偏橘但較亮、redness 中等)
        const isInk = lum < 90 || (redness > 95 && lum < 165);
        if (isInk) {
          mask[(dy + R) * size + (dx + R)] = 1;
          inkCount++;
          redSum += redness;
          inkPix++;
        }
      }
    }
    const area = Math.PI * r2;
    const density = inkCount / area;
    if (density < 0.05) return "."; // 墨太少＝空格（薄格線不算）
    const vec = normalizeToVec(mask, size, size);
    // 比對樣板
    let best = null,
      bestScore = -1;
    for (const t of templates) {
      const s = cosine(vec, t.vec);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    if (!best || bestScore < 0.3) return ".";
    const red = inkPix > 0 && redSum / inkPix > 40; // 平均偏紅＝紅方
    const letter = best.type;
    return red ? letter.toUpperCase() : letter.toLowerCase();
  }

  // 對外：從 <img>/<canvas> 元素 + 四角 → { fen, grid, occupied }
  function recognize(imgEl, corners, redBottom, side) {
    const W = imgEl.naturalWidth || imgEl.width;
    const H = imgEl.naturalHeight || imgEl.height;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    cv.getContext("2d").drawImage(imgEl, 0, 0, W, H);
    const imageData = cv.getContext("2d").getImageData(0, 0, W, H);
    const { grid, occupied } = recognizeGrid(imageData, W, H, corners);
    const fen = Vision.gridToFEN(grid, redBottom, side);
    return { fen, grid, occupied };
  }

  return { recognize, recognizeGrid, buildTemplates, _glyphVector: glyphVector };
})();
