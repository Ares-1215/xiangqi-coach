/*
 * app.js — 互動棋盤 UI 與流程控制
 */
(() => {
  const X = Xiangqi;

  // ---- 幾何：viewBox 552 x 612，邊界 M=36，格距 cell=60 ----
  const M = 36,
    CELL = 60,
    VW = 552,
    VH = 612;
  const px = (r, c) => ({ x: M + c * CELL, y: M + r * CELL });
  const pct = (r, c) => ({ xp: (100 * (M + c * CELL)) / VW, yp: (100 * (M + r * CELL)) / VH });

  // ---- 狀態 ----
  let board = X.fromFEN(X.START_FEN).board;
  let side = "w";
  let flipped = false;
  let mode = "move"; // 'place' | 'erase' | 'move'
  let placePiece = null; // mode==='place' 時要放的棋子
  let selected = null; // move 模式下選取的格 {r,c}
  let lastResult = null; // 最近一次求解結果

  const disp = (r, c) => (flipped ? { r: 9 - r, c: 8 - c } : { r, c }); // 內部→顯示

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const boardBg = $("board-bg");
  const arrowSvg = $("board-arrow");
  const piecesEl = $("pieces");

  // ---- 繪製棋盤底圖 ----
  function drawBoardBg() {
    const L = [];
    const line = (x1, y1, x2, y2, w = 2) =>
      L.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--wood-line)" stroke-width="${w}" stroke-linecap="round"/>`);
    // 外框
    L.push(`<rect x="${M}" y="${M}" width="${8 * CELL}" height="${9 * CELL}" fill="none" stroke="var(--wood-line)" stroke-width="3"/>`);
    // 橫線 10 條
    for (let r = 0; r < 10; r++) line(M, M + r * CELL, M + 8 * CELL, M + r * CELL);
    // 直線 9 條（中間 7 條在楚河漢界斷開）
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        line(M + c * CELL, M, M + c * CELL, M + 9 * CELL);
      } else {
        line(M + c * CELL, M, M + c * CELL, M + 4 * CELL);
        line(M + c * CELL, M + 5 * CELL, M + c * CELL, M + 9 * CELL);
      }
    }
    // 九宮斜線
    const cross = (r0, c0) => {
      const a = px(r0, c0),
        b = px(r0 + 2, c0 + 2),
        c = px(r0, c0 + 2),
        d = px(r0 + 2, c0);
      line(a.x, a.y, b.x, b.y);
      line(c.x, c.y, d.x, d.y);
    };
    cross(0, 3); // 上宮（黑）
    cross(7, 3); // 下宮（紅）
    // 楚河漢界
    L.push(
      `<text x="${M + 2 * CELL}" y="${M + 4.62 * CELL}" font-size="30" fill="var(--wood-line)" text-anchor="middle" font-family="serif" letter-spacing="6">楚 河</text>`
    );
    L.push(
      `<text x="${M + 6 * CELL}" y="${M + 4.62 * CELL}" font-size="30" fill="var(--wood-line)" text-anchor="middle" font-family="serif" letter-spacing="6">漢 界</text>`
    );
    boardBg.innerHTML = L.join("");
  }

  // ---- 繪製棋子與熱區 ----
  function render() {
    piecesEl.innerHTML = "";
    // 選取棋子時計算其合法走點以高亮
    const targets = new Set();
    if (selected && mode === "move" && board[selected.r][selected.c]) {
      for (const m of Rules.legalMovesFrom(board, selected.r, selected.c)) {
        targets.add(m.r * 9 + m.c);
      }
    }
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const d = disp(r, c);
        const { xp, yp } = pct(d.r, d.c);
        // 熱區（永遠存在，接收點擊）
        const hot = document.createElement("div");
        hot.className = "hot" + (targets.has(r * 9 + c) ? " target" : "");
        hot.style.left = xp + "%";
        hot.style.top = yp + "%";
        hot.dataset.r = r;
        hot.dataset.c = c;
        hot.addEventListener("click", () => onCell(r, c));
        piecesEl.appendChild(hot);
        // 棋子
        const p = board[r][c];
        if (p) {
          const el = document.createElement("div");
          el.className = "piece " + (X.isRed(p) ? "red" : "black");
          if (selected && selected.r === r && selected.c === c) el.classList.add("selected");
          el.style.left = xp + "%";
          el.style.top = yp + "%";
          el.textContent = X.glyph(p);
          piecesEl.appendChild(el);
        }
      }
    }
    drawArrow();
    updateCheckStatus();
  }

  // ---- 將軍/將死狀態顯示 ----
  function updateCheckStatus() {
    const el = $("check-status");
    if (!X.hasBothKings(board)) {
      el.textContent = "";
      el.className = "check-status";
      return;
    }
    const st = Rules.status(board, side);
    const mover = side === "w" ? "紅方" : "黑方";
    if (st === "checkmate") {
      el.textContent = `⚑ ${mover}已被將死`;
      el.className = "check-status mate";
    } else if (st === "stalemate") {
      el.textContent = `${mover}無著可走（困斃）`;
      el.className = "check-status mate";
    } else if (st === "check") {
      el.textContent = `⚠ ${mover}正被將軍`;
      el.className = "check-status check";
    } else {
      el.textContent = "";
      el.className = "check-status";
    }
  }

  // ---- 點擊格子 ----
  function onCell(r, c) {
    if (mode === "place" && placePiece) {
      board[r][c] = placePiece;
      clearResult();
    } else if (mode === "erase") {
      board[r][c] = null;
      clearResult();
    } else {
      // move / 選取
      if (selected) {
        if (selected.r === r && selected.c === c) {
          selected = null; // 再點一次取消
        } else {
          board[r][c] = board[selected.r][selected.c];
          board[selected.r][selected.c] = null;
          selected = null;
          clearResult();
        }
      } else if (board[r][c]) {
        selected = { r, c };
      }
    }
    render();
  }

  // ---- 箭頭 ----
  let arrowMove = null; // {from:{r,c}, to:{r,c}}
  function drawArrow() {
    if (!arrowMove) {
      arrowSvg.innerHTML = "";
      return;
    }
    const df = disp(arrowMove.from.r, arrowMove.from.c);
    const dt = disp(arrowMove.to.r, arrowMove.to.c);
    const a = px(df.r, df.c),
      b = px(dt.r, dt.c);
    arrowSvg.innerHTML = `
      <defs>
        <marker id="ah" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)"/>
        </marker>
      </defs>
      <circle cx="${a.x}" cy="${a.y}" r="26" fill="none" stroke="var(--accent)" stroke-width="3" opacity="0.8"/>
      <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent)" stroke-width="5" opacity="0.85" marker-end="url(#ah)"/>`;
  }

  function clearResult() {
    arrowMove = null;
    lastResult = null;
    $("result").classList.add("hidden");
  }

  // ---- 調色盤 ----
  function buildPalette() {
    const reds = ["K", "A", "B", "N", "R", "C", "P"];
    const blacks = ["k", "a", "b", "n", "r", "c", "p"];
    const make = (containerId, list) => {
      const el = $(containerId);
      el.innerHTML = "";
      for (const p of list) {
        const chip = document.createElement("button");
        chip.className = "pchip " + (X.isRed(p) ? "red" : "black");
        chip.textContent = X.glyph(p);
        chip.dataset.piece = p;
        chip.addEventListener("click", () => {
          mode = "place";
          placePiece = p;
          selected = null;
          highlightPalette(chip);
          setToolActive(null);
        });
        el.appendChild(chip);
      }
    };
    make("palette-red", reds);
    make("palette-black", blacks);
  }
  function highlightPalette(active) {
    document.querySelectorAll(".pchip").forEach((c) => c.classList.toggle("active", c === active));
  }
  function setToolActive(tool) {
    document.querySelectorAll(".tool").forEach((t) => t.classList.toggle("active", t.dataset.tool === tool));
  }

  // ---- 工具鈕 ----
  document.querySelectorAll(".tool").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.tool === "erase" ? "erase" : "move";
      placePiece = null;
      selected = null;
      highlightPalette(null);
      setToolActive(btn.dataset.tool);
      render();
    });
  });

  // ---- 頂部與按鈕 ----
  $("btn-start").onclick = () => {
    const s = X.fromFEN(X.START_FEN);
    board = s.board;
    side = "w";
    setTurn("w");
    clearResult();
    render();
  };
  $("btn-clear").onclick = () => {
    board = X.emptyBoard();
    clearResult();
    render();
  };
  $("btn-flip").onclick = () => {
    flipped = !flipped;
    render();
  };
  function setTurn(s) {
    side = s;
    $("turn-red").classList.toggle("active", s === "w");
    $("turn-black").classList.toggle("active", s === "b");
  }
  $("turn-red").onclick = () => setTurn("w");
  $("turn-black").onclick = () => setTurn("b");

  // ---- 求解 ----
  const engineStatus = $("engine-status");
  $("btn-solve").onclick = async () => {
    if (!X.hasBothKings(board)) {
      setStatus(engineStatus, "盤面需同時有紅帥與黑將才能求解。", "err");
      return;
    }
    const btn = $("btn-solve");
    btn.disabled = true;
    const useWasm = Engine.envSupported();
    const eng = useWasm ? Engine : JsEngine;
    const engName = useWasm ? "" : "（內建輕量引擎）";
    setStatus(engineStatus, `思考中…${engName}`, "");
    try {
      const fen = X.toFEN(board, side);
      const movetime = parseInt($("difficulty").value, 10);
      const res = await eng.analyze(fen, {
        movetime,
        onInfo: (info) => {
          const sc = fmtScore(info, side);
          setStatus(engineStatus, `思考中…${engName} 深度 ${info.depth || "-"}　${sc}`, "");
        },
      });
      showResult(res);
      setStatus(engineStatus, useWasm ? "完成。" : "完成（內建輕量引擎；如需最強棋力請用 Chrome／Safari 開啟）。", "ok");
    } catch (e) {
      const msg = String(e.message || e);
      setStatus(engineStatus, msg === "NEED_COI" ? "多執行緒未啟用，無法運算（見上說明）。" : "求解失敗：" + msg, "err");
    } finally {
      btn.disabled = false;
    }
  };

  function showResult(res) {
    if (!res.bestmove) {
      setStatus(engineStatus, "找不到合法著法（可能已被將死或盤面不合法）。", "err");
      return;
    }
    lastResult = res;
    const mv = X.parseUciMove(res.bestmove);
    arrowMove = mv;
    const cn = X.moveToChinese(board, mv);
    $("best-cn").textContent = cn;
    $("best-uci").textContent = "(" + res.bestmove + ")";
    $("eval").innerHTML = evalHtml(res, side);
    $("pv").innerHTML = pvHtml(res, board);
    $("result").classList.remove("hidden");
    render();
  }

  // 走這一步：套用到盤面並換邊
  $("btn-play").onclick = () => {
    if (!lastResult || !lastResult.bestmove) return;
    const mv = X.parseUciMove(lastResult.bestmove);
    board = X.applyMove(board, mv);
    setTurn(side === "w" ? "b" : "w");
    clearResult();
    render();
  };

  // ---- 評分與 PV 顯示 ----
  function fmtScore(info, mover) {
    if (info.mate !== undefined && info.mate !== null) {
      const n = Math.abs(info.mate);
      return info.mate > 0 ? `${n} 步殺！` : `對方 ${n} 步殺`;
    }
    if (info.cp !== undefined && info.cp !== null) {
      const pawns = (info.cp / 100).toFixed(1);
      return `評分 ${info.cp > 0 ? "+" : ""}${pawns}`;
    }
    return "";
  }
  function evalHtml(res, mover) {
    const moverName = mover === "w" ? "紅方" : "黑方";
    if (res.mate !== undefined && res.mate !== null) {
      const n = Math.abs(res.mate);
      if (res.mate > 0) return `<b style="color:var(--accent)">${moverName} ${n} 步之內可將死對方！</b>`;
      return `<b style="color:var(--accent-red)">${moverName} 將在 ${n} 步內被將死</b>`;
    }
    if (res.cp !== undefined && res.cp !== null) {
      const cp = res.cp;
      let judge = "均勢";
      if (cp > 200) judge = "明顯優勢";
      else if (cp > 60) judge = "略優";
      else if (cp < -200) judge = "明顯劣勢";
      else if (cp < -60) judge = "略劣";
      const w = Math.min(100, Math.abs(cp) / 6);
      const color = cp >= 0 ? "var(--accent)" : "var(--accent-red)";
      return `${moverName}目前${judge}（${cp > 0 ? "+" : ""}${(cp / 100).toFixed(1)}）
        <span class="bar" style="width:${w}px;background:${color}"></span>`;
    }
    return "";
  }
  // 把 PV 前幾步翻成中文
  function pvHtml(res, startBoard) {
    if (!res.pv || res.pv.length < 2) return "";
    let b = startBoard.map((row) => row.slice());
    let s = side;
    const steps = [];
    for (let i = 0; i < Math.min(res.pv.length, 6); i++) {
      const mv = X.parseUciMove(res.pv[i]);
      if (!b[mv.from.r][mv.from.c]) break;
      const cn = X.moveToChinese(b, mv);
      steps.push((s === "w" ? "紅 " : "黑 ") + cn);
      b = X.applyMove(b, mv);
      s = s === "w" ? "b" : "w";
    }
    return "<b>後續變化：</b>" + steps.join("　→　");
  }

  function setStatus(el, msg, cls) {
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  }

  // ---- 殘局題庫 ----
  function buildPuzzles() {
    const sel = $("puzzle-select");
    if (!sel || typeof PUZZLES === "undefined") return;
    sel.innerHTML = "";
    const groups = {};
    PUZZLES.forEach((p, i) => {
      const cat = p.cat || "其他";
      (groups[cat] = groups[cat] || []).push({ p, i });
    });
    for (const cat of Object.keys(groups)) {
      const og = document.createElement("optgroup");
      og.label = `${cat}（${groups[cat].length}）`;
      for (const { p, i } of groups[cat]) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = `${p.name}（${p.level}）`;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  }
  function loadPuzzle() {
    const sel = $("puzzle-select");
    const p = PUZZLES[parseInt(sel.value, 10)];
    if (!p) return;
    const parsed = X.fromFEN(p.fen);
    board = parsed.board;
    setTurn(parsed.side);
    selected = null;
    mode = "move";
    placePiece = null;
    highlightPalette(null);
    setToolActive("move");
    clearResult();
    render();
    $("puzzle-desc").textContent = p.desc;
    setStatus(engineStatus, "題目已載入，按下方「算出最佳下一步」看解答。", "");
  }
  if ($("btn-load-puzzle")) $("btn-load-puzzle").onclick = loadPuzzle;

  // ---- 啟動 ----
  buildPuzzles();
  buildPalette();
  drawBoardBg();
  setToolActive("move");
  render();

  // 環境提示
  if (!Engine.envSupported()) {
    setStatus(
      engineStatus,
      "提示：此瀏覽器（如 LINE 內建瀏覽器）不支援多執行緒，將使用內建輕量引擎，殘局求解沒問題。想要最強棋力，可用手機的 Chrome／Safari 開啟本頁。",
      ""
    );
  }
})();
