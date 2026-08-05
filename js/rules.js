/*
 * rules.js — 象棋走子規則與合法性判斷（純 JS，無外部相依）
 * 座標同 xiangqi.js：board[row][col]，row 0=最上排(黑側)，row 9=最下排(紅側)。
 * 紅(大寫)前進為 row 變小；黑(小寫)前進為 row 變大。河界在 row4 與 row5 之間。
 */
const Rules = (() => {
  const ROWS = 10,
    COLS = 9;
  const isRed = (p) => p && p === p.toUpperCase();
  const sameColor = (a, b) => a && b && isRed(a) === isRed(b);
  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const inPalace = (r, c, red) =>
    c >= 3 && c <= 5 && (red ? r >= 7 && r <= 9 : r >= 0 && r <= 2);

  // 產生某一子的「擬合法」目標（僅依走子規則與己方阻擋，不含將軍檢查）
  function pseudoMoves(board, r, c) {
    const p = board[r][c];
    if (!p) return [];
    const red = isRed(p);
    const type = p.toUpperCase();
    const res = [];
    const push = (tr, tc) => {
      if (!inBoard(tr, tc)) return;
      const t = board[tr][tc];
      if (t && sameColor(p, t)) return; // 不能吃自己
      res.push({ r: tr, c: tc });
    };

    if (type === "R") {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let tr = r + dr,
          tc = c + dc;
        while (inBoard(tr, tc)) {
          const t = board[tr][tc];
          if (!t) {
            res.push({ r: tr, c: tc });
          } else {
            if (!sameColor(p, t)) res.push({ r: tr, c: tc });
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    } else if (type === "C") {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let tr = r + dr,
          tc = c + dc;
        let jumped = false;
        while (inBoard(tr, tc)) {
          const t = board[tr][tc];
          if (!jumped) {
            if (!t) res.push({ r: tr, c: tc }); // 未過砲架，走空格
            else jumped = true; // 遇到砲架
          } else {
            if (t) {
              if (!sameColor(p, t)) res.push({ r: tr, c: tc }); // 隔一子吃
              break;
            }
          }
          tr += dr;
          tc += dc;
        }
      }
    } else if (type === "N") {
      // 馬走日，別馬腿
      const legs = [
        [-2, -1, -1, 0], [-2, 1, -1, 0],
        [2, -1, 1, 0], [2, 1, 1, 0],
        [-1, -2, 0, -1], [1, -2, 0, -1],
        [-1, 2, 0, 1], [1, 2, 0, 1],
      ];
      for (const [dr, dc, lr, lc] of legs) {
        if (board[r + lr] && board[r + lr][c + lc]) continue; // 馬腿被塞
        push(r + dr, c + dc);
      }
    } else if (type === "B") {
      // 相/象走田，塞象眼，不過河
      const steps = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
      for (const [dr, dc] of steps) {
        const tr = r + dr,
          tc = c + dc;
        if (!inBoard(tr, tc)) continue;
        if (board[r + dr / 2][c + dc / 2]) continue; // 象眼被塞
        if (red && tr < 5) continue; // 紅相不過河
        if (!red && tr > 4) continue; // 黑象不過河
        push(tr, tc);
      }
    } else if (type === "A") {
      // 仕/士走斜，限九宮
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const tr = r + dr,
          tc = c + dc;
        if (inPalace(tr, tc, red)) push(tr, tc);
      }
    } else if (type === "K") {
      // 帥/將走直一步，限九宮
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const tr = r + dr,
          tc = c + dc;
        if (inPalace(tr, tc, red)) push(tr, tc);
      }
      // 飛將：同一直線、中間無子，可吃對方帥/將
      const dir = red ? -1 : 1;
      let tr = r + dir;
      while (inBoard(tr, c)) {
        const t = board[tr][c];
        if (t) {
          if (t.toUpperCase() === "K" && !sameColor(p, t)) res.push({ r: tr, c });
          break;
        }
        tr += dir;
      }
    } else if (type === "P") {
      // 兵/卒
      const fwd = red ? -1 : 1;
      push(r + fwd, c);
      const crossed = red ? r <= 4 : r >= 5; // 過河後可左右
      if (crossed) {
        push(r, c - 1);
        push(r, c + 1);
      }
    }
    return res;
  }

  function findKing(board, red) {
    const k = red ? "K" : "k";
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (board[r][c] === k) return { r, c };
    return null;
  }

  // (r,c) 是否被 byRed 方任一子攻擊
  function squareAttackedBy(board, r, c, byRed) {
    for (let sr = 0; sr < ROWS; sr++) {
      for (let sc = 0; sc < COLS; sc++) {
        const p = board[sr][sc];
        if (!p || isRed(p) !== byRed) continue;
        const ms = pseudoMoves(board, sr, sc);
        for (const m of ms) if (m.r === r && m.c === c) return true;
      }
    }
    return false;
  }

  function applyMove(board, from, to) {
    const nb = board.map((row) => row.slice());
    nb[to.r][to.c] = nb[from.r][from.c];
    nb[from.r][from.c] = null;
    return nb;
  }

  // 走此步後，自己的帥/將是否安全（不被將、且不與對方帥直線相對）
  function moveIsSafe(board, from, to, red) {
    const nb = applyMove(board, from, to);
    const king = findKing(nb, red);
    if (!king) return false;
    return !squareAttackedBy(nb, king.r, king.c, !red);
  }

  // 某一子的所有合法走法（供高亮）
  function legalMovesFrom(board, r, c) {
    const p = board[r][c];
    if (!p) return [];
    const red = isRed(p);
    return pseudoMoves(board, r, c).filter((m) => moveIsSafe(board, { r, c }, m, red));
  }

  // 某方所有合法走法
  function legalMoves(board, side) {
    const red = side === "w";
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = board[r][c];
        if (!p || isRed(p) !== red) continue;
        for (const m of legalMovesFrom(board, r, c)) out.push({ from: { r, c }, to: m });
      }
    }
    return out;
  }

  // 該方是否正被將軍
  function inCheck(board, side) {
    const red = side === "w";
    const king = findKing(board, red);
    if (!king) return false;
    return squareAttackedBy(board, king.r, king.c, !red);
  }

  // 局面狀態：'checkmate' | 'stalemate' | 'check' | 'normal'
  function status(board, side) {
    const moves = legalMoves(board, side);
    const chk = inCheck(board, side);
    if (moves.length === 0) return chk ? "checkmate" : "stalemate";
    return chk ? "check" : "normal";
  }

  return {
    pseudoMoves,
    legalMovesFrom,
    legalMoves,
    inCheck,
    status,
    squareAttackedBy,
    findKing,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Rules;
