/*
 * xiangqi.js — 象棋核心模型
 * 棋盤資料結構、FEN 產生/解析、UCI 座標與中文記譜互轉。
 *
 * 座標系統：
 *   board[row][col]，row 0 = 最上排（黑方，rank 9），row 9 = 最下排（紅方，rank 0）。
 *   col 0 = 最左，col 8 = 最右（以觀看者視角，紅下黑上）。
 *   每格內容為單一字元棋子代號（見下）或 null。
 *
 * 棋子代號（大寫紅、小寫黑）：
 *   K/k 帥將  A/a 仕士  B/b 相象  N/n 傌馬  R/r 俥車  C/c 炮砲  P/p 兵卒
 *
 * UCI 座標（Fairy-Stockfish）：file 為 a–i（col 0–8），rank 為 0–9（row 9→0）。
 *   square = fileLetter + rankDigit，例如 row9/col0 => "a0"。
 */

const Xiangqi = (() => {
  const COLS = 9;
  const ROWS = 10;

  // 紅方棋子名稱
  const RED_NAME = { R: "俥", N: "傌", B: "相", A: "仕", K: "帥", C: "炮", P: "兵" };
  // 黑方棋子名稱
  const BLACK_NAME = { r: "車", n: "馬", b: "象", a: "士", k: "將", c: "砲", p: "卒" };
  const NAME = { ...RED_NAME, ...BLACK_NAME };

  // 顯示用（棋子上的字）
  function glyph(piece) {
    if (!piece) return "";
    return NAME[piece] || "?";
  }

  const HANZI = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

  function isRed(piece) {
    return piece && piece === piece.toUpperCase() && piece !== piece.toLowerCase();
  }
  function isBlack(piece) {
    return piece && piece === piece.toLowerCase() && piece !== piece.toUpperCase();
  }

  // 直行棋子（走直線，進退用步數）：俥/車、炮/砲、兵/卒、帥/將
  const STRAIGHT = new Set(["R", "C", "P", "K", "r", "c", "p", "k"]);
  // 斜/拐棋子（進退用「目標路數」）：傌/馬、相/象、仕/士
  // 其餘（N,B,A）皆屬此類

  // ---- 空棋盤 / 起始盤 ----
  function emptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  const START_FEN =
    "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

  // ---- FEN ----
  // 回傳 { board, side }。side 為 'w'（紅先）或 'b'（黑）。
  function fromFEN(fen) {
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split("/");
    const board = emptyBoard();
    for (let r = 0; r < ROWS; r++) {
      const rowStr = rows[r] || "9";
      let c = 0;
      for (const ch of rowStr) {
        if (/\d/.test(ch)) {
          c += parseInt(ch, 10);
        } else {
          if (c < COLS) board[r][c] = ch;
          c++;
        }
      }
    }
    const side = parts[1] === "b" ? "b" : "w";
    return { board, side };
  }

  function toFEN(board, side = "w") {
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      let rowStr = "";
      let empty = 0;
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            rowStr += empty;
            empty = 0;
          }
          rowStr += p;
        }
      }
      if (empty > 0) rowStr += empty;
      rows.push(rowStr || "9");
    }
    return `${rows.join("/")} ${side} - - 0 1`;
  }

  // ---- 座標轉換 ----
  // Fairy-Stockfish 象棋座標：file a–i（col 0–8），rank 1–10（最下排=1）。
  // 內部 row 0=最上排(rank 10)，row 9=最下排(rank 1)，故 rank = 10 - row。
  function rcToUci(r, c) {
    const file = String.fromCharCode("a".charCodeAt(0) + c);
    const rank = 10 - r;
    return `${file}${rank}`;
  }
  function uciToRc(square) {
    const c = square.charCodeAt(0) - "a".charCodeAt(0);
    const rank = parseInt(square.slice(1), 10); // rank 可能為兩位數(10)
    return { r: 10 - rank, c };
  }
  // UCI 完整著法 "h3e3" 或含兩位數 "e4e10" → { from:{r,c}, to:{r,c} }
  function parseUciMove(mv) {
    const m = mv.match(/^([a-i]\d{1,2})([a-i]\d{1,2})$/);
    if (!m) return { from: uciToRc(mv.slice(0, 2)), to: uciToRc(mv.slice(2)) };
    return { from: uciToRc(m[1]), to: uciToRc(m[2]) };
  }

  // ---- 路數（file number）----
  // 紅：以紅方右手為「一」，即 col 8 => 一，col 0 => 九，回傳漢字。
  // 黑：以黑方右手為「1」，即 col 0 => 1，col 8 => 9，回傳阿拉伯數字。
  function fileLabel(col, red) {
    if (red) return HANZI[9 - col];
    return String(col + 1);
  }
  function num(n, red) {
    return red ? HANZI[n] : String(n);
  }

  // ---- 中文記譜 ----
  // board：走子「之前」的盤面。move：{ from:{r,c}, to:{r,c} }。
  function moveToChinese(board, move) {
    const { from, to } = move;
    const piece = board[from.r][from.c];
    if (!piece) return "";
    const red = isRed(piece);
    const name = NAME[piece];

    // 判斷同一直行是否有同款棋子（決定用「前/後」或路數起始）
    const sameCol = [];
    for (let r = 0; r < ROWS; r++) {
      if (board[r][from.c] === piece) sameCol.push(r);
    }
    let startLabel;
    if (sameCol.length >= 2) {
      // 用 前/中/後
      sameCol.sort((a, b) => a - b); // row 由小到大（上→下）
      // 紅：row 小者較前；黑：row 大者較前
      const order = red ? sameCol : [...sameCol].reverse();
      const idx = order.indexOf(from.r);
      let pos;
      if (order.length === 2) pos = idx === 0 ? "前" : "後";
      else if (order.length === 3) pos = ["前", "中", "後"][idx];
      else pos = ["前", "二", "三", "四", "五"][idx] || "前";
      startLabel = pos + name;
    } else {
      startLabel = name + fileLabel(from.c, red);
    }

    // 動作與目標
    let action, target;
    const straight = STRAIGHT.has(piece);
    if (from.r === to.r) {
      // 水平 → 平
      action = "平";
      target = fileLabel(to.c, red);
    } else {
      const forward = red ? to.r < from.r : to.r > from.r; // 紅上黑下為進
      action = forward ? "進" : "退";
      if (straight) {
        target = num(Math.abs(to.r - from.r), red); // 步數
      } else {
        target = fileLabel(to.c, red); // 斜行棋子用目標路數
      }
    }
    return `${startLabel}${action}${target}`;
  }

  // 產生「紅方 xxx，黑方 yyy」友善描述
  function describeMove(board, move) {
    const piece = board[move.from.r][move.from.c];
    const side = isRed(piece) ? "紅方" : "黑方";
    return `${side} ${moveToChinese(board, move)}`;
  }

  // 套用著法，回傳新盤面（不改原盤）
  function applyMove(board, move) {
    const nb = board.map((row) => row.slice());
    const p = nb[move.from.r][move.from.c];
    nb[move.from.r][move.from.c] = null;
    nb[move.to.r][move.to.c] = p;
    return nb;
  }

  // 統計盤面帥/將是否都存在（給合法性提示用）
  function hasBothKings(board) {
    let k = false,
      K = false;
    for (const row of board) for (const p of row) {
      if (p === "k") k = true;
      if (p === "K") K = true;
    }
    return k && K;
  }

  return {
    COLS,
    ROWS,
    START_FEN,
    RED_NAME,
    BLACK_NAME,
    NAME,
    glyph,
    isRed,
    isBlack,
    emptyBoard,
    fromFEN,
    toFEN,
    rcToUci,
    uciToRc,
    parseUciMove,
    moveToChinese,
    describeMove,
    applyMove,
    hasBothKings,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Xiangqi;
