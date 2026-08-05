/*
 * jsengine.js — 純 JS 象棋引擎後備
 * 用途：in-app 瀏覽器（LINE/FB/IG…）不支援 SharedArrayBuffer，
 *       多執行緒 WASM 引擎跑不起來時，改用這個單執行緒引擎。
 * 方法：alpha-beta + 迭代加深 + 靜態搜尋(吃子延伸) + 殺棋偵測。
 * 依賴：rules.js（合法走法/將軍/將死）。強度不如 Fairy-Stockfish，但殘局足夠。
 */
const JsEngine = (() => {
  const MATE = 1000000;
  const VAL = { R: 600, C: 285, N: 270, B: 130, A: 130, P: 100, K: 60000 };
  const isRed = (p) => p && p === p.toUpperCase();

  // 兵/卒過河加值、靠近對方九宮加值（簡易）
  function pieceScore(p, r, c) {
    const t = p.toUpperCase();
    let v = VAL[t];
    if (t === "P") {
      const red = isRed(p);
      const crossed = red ? r <= 4 : r >= 5;
      if (crossed) v += 60 + (red ? (4 - r) * 8 : (r - 5) * 8);
    }
    return v;
  }

  // 靜態評估（紅方觀點，正=紅優）
  function evalBoard(board) {
    let s = 0;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (!p) continue;
        s += (isRed(p) ? 1 : -1) * pieceScore(p, r, c);
      }
    return s;
  }

  function apply(board, m) {
    const nb = board.map((row) => row.slice());
    nb[m.to.r][m.to.c] = nb[m.from.r][m.from.c];
    nb[m.from.r][m.from.c] = null;
    return nb;
  }

  // 走法排序：吃子優先（MVV-LVA）
  function order(board, moves) {
    return moves
      .map((m) => {
        const victim = board[m.to.r][m.to.c];
        const attacker = board[m.from.r][m.from.c];
        const score = victim ? VAL[victim.toUpperCase()] * 10 - VAL[attacker.toUpperCase()] : 0;
        return { m, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
  }

  let nodes = 0,
    deadline = 0,
    stopped = false;

  function timeUp() {
    if ((nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
    return stopped;
  }

  // 靜態搜尋：只延伸吃子，避免地平線效應
  function quiesce(board, side, alpha, beta, ply) {
    nodes++;
    const red = side === "w";
    let stand = red ? evalBoard(board) : -evalBoard(board);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (timeUp()) return alpha;
    const caps = Rules.legalMoves(board, side).filter((m) => board[m.to.r][m.to.c]);
    for (const m of order(board, caps)) {
      const v = -quiesce(apply(board, m), side === "w" ? "b" : "w", -beta, -alpha, ply + 1);
      if (stopped) return alpha;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  // negamax + alpha-beta（回傳 side 觀點分數）
  function search(board, side, depth, alpha, beta, ply) {
    nodes++;
    if (timeUp()) return 0;
    const moves = Rules.legalMoves(board, side);
    if (moves.length === 0) {
      // 無著可走：被將死或困斃，象棋皆判負
      return -MATE + ply;
    }
    if (depth <= 0) return quiesce(board, side, alpha, beta, ply);
    let best = -Infinity;
    for (const m of order(board, moves)) {
      const v = -search(apply(board, m), side === "w" ? "b" : "w", depth - 1, -beta, -alpha, ply + 1);
      if (stopped) return best === -Infinity ? alpha : best;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 對外：analyze(fen, {movetime, depth, onInfo}) → {bestmove, cp, mate, pv, depth}
  async function analyze(fen, opts = {}) {
    const { board, side } = Xiangqi.fromFEN(fen);
    deadline = Date.now() + (opts.movetime || 2500);
    stopped = false;
    nodes = 0;
    const maxDepth = opts.depth || 20;
    const rootMoves = Rules.legalMoves(board, side);
    if (rootMoves.length === 0) return { bestmove: null, cp: 0, mate: null, pv: [], depth: 0 };

    let bestMove = rootMoves[0],
      bestScore = 0,
      reachedDepth = 0;

    for (let d = 1; d <= maxDepth; d++) {
      let localBest = null,
        localScore = -Infinity;
      // 上一輪最佳先搜，其餘依吃子排序
      let ordered = order(board, rootMoves);
      if (bestMove) ordered = [bestMove, ...ordered.filter((m) => !sameMove(m, bestMove))];
      for (const m of ordered) {
        // 根節點每步用完整視窗，取得精確分數（避免 fail-high 誤判成殺棋）
        const v = -search(apply(board, m), side === "w" ? "b" : "w", d - 1, -Infinity, Infinity, 1);
        if (stopped) break;
        if (v > localScore) {
          localScore = v;
          localBest = m;
        }
      }
      if (!stopped && localBest) {
        bestMove = localBest;
        bestScore = localScore;
        reachedDepth = d;
        if (opts.onInfo) opts.onInfo(toInfo(bestScore, d));
        if (Math.abs(bestScore) > MATE - 1000) break; // 已找到確定殺棋
      }
      if (stopped || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 0)); // 讓出主執行緒避免卡 UI
      if (Date.now() > deadline) break;
    }

    const info = toInfo(bestScore, reachedDepth);
    return {
      bestmove: Xiangqi.rcToUci(bestMove.from.r, bestMove.from.c) + Xiangqi.rcToUci(bestMove.to.r, bestMove.to.c),
      cp: info.cp,
      mate: info.mate,
      pv: [],
      depth: reachedDepth,
    };
  }

  function sameMove(a, b) {
    return a.from.r === b.from.r && a.from.c === b.from.c && a.to.r === b.to.r && a.to.c === b.to.c;
  }
  function toInfo(score, depth) {
    if (Math.abs(score) > MATE - 1000) {
      const ply = MATE - Math.abs(score);
      const mv = Math.ceil(ply / 2);
      return { mate: score > 0 ? mv : -mv, cp: undefined, depth };
    }
    return { cp: score, mate: undefined, depth };
  }

  return { analyze };
})();
