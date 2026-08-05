/*
 * engine.js — Fairy-Stockfish WASM 引擎封裝
 * 依賴：engine/stockfish.js 先以 <script> 載入，提供全域工廠函式 Stockfish()。
 * 對外提供 promise 化的 analyze()。
 */

const Engine = (() => {
  let engine = null; // emscripten module
  let ready = false;
  let listeners = []; // 逐行文字監聽（除錯用）
  let bootPromise = null;

  function log(line) {
    for (const fn of listeners) fn(line);
  }
  function onLine(fn) {
    listeners.push(fn);
  }

  // 送一行 UCI 指令
  function send(cmd) {
    if (engine) engine.postMessage(cmd);
  }

  // 等待某個字串出現在輸出中
  function waitFor(token) {
    return new Promise((resolve) => {
      const handler = (line) => {
        if (line.includes(token)) {
          listeners = listeners.filter((l) => l !== handler);
          resolve(line);
        }
      };
      listeners.push(handler);
    });
  }

  // 初始化引擎（僅一次）
  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      if (typeof Stockfish !== "function") {
        throw new Error("找不到 Stockfish()，engine/stockfish.js 尚未載入");
      }
      if (typeof SharedArrayBuffer === "undefined" || !self.crossOriginIsolated) {
        throw new Error(
          "NEED_COI" // 未啟用 crossOriginIsolated，多執行緒 WASM 無法運作
        );
      }
      engine = await Stockfish();
      engine.addMessageListener((line) => log(line));
      send("uci");
      await waitFor("uciok");
      send("setoption name UCI_Variant value xiangqi");
      send("setoption name Use NNUE value false"); // 古典評估，免載 NNUE 大檔
      send("isready");
      await waitFor("readyok");
      ready = true;
    })();
    return bootPromise;
  }

  // 解析 info 行取得評分
  function parseScore(line) {
    // 例：info depth 15 ... score cp 34 ... pv h2e2 b9c7 ...
    const out = {};
    const d = line.match(/\bdepth (\d+)/);
    if (d) out.depth = parseInt(d[1], 10);
    const cp = line.match(/score cp (-?\d+)/);
    if (cp) out.cp = parseInt(cp[1], 10);
    const mate = line.match(/score mate (-?\d+)/);
    if (mate) out.mate = parseInt(mate[1], 10);
    const pv = line.match(/\bpv (.+)$/);
    if (pv) out.pv = pv[1].trim().split(/\s+/);
    return out;
  }

  /*
   * 分析局面。
   * fen：Fairy-Stockfish 象棋 FEN。
   * opts：{ movetime(ms) 或 depth, onInfo(cb) }
   * 回傳：{ bestmove, ponder, cp, mate, pv, depth }
   */
  async function analyze(fen, opts = {}) {
    await boot();
    if (!ready) throw new Error("引擎尚未就緒");

    send("ucinewgame");
    send("isready");
    await waitFor("readyok");
    send(`position fen ${fen}`);

    let last = {}; // 最近一筆有分數的 info
    const infoHandler = (line) => {
      if (line.startsWith("info") && /score /.test(line)) {
        last = parseScore(line);
        if (opts.onInfo) opts.onInfo(last);
      }
    };
    listeners.push(infoHandler);

    const goCmd = opts.depth
      ? `go depth ${opts.depth}`
      : `go movetime ${opts.movetime || 2000}`;
    send(goCmd);

    const bestLine = await waitFor("bestmove");
    listeners = listeners.filter((l) => l !== infoHandler);

    const m = bestLine.match(/bestmove (\S+)(?:\s+ponder (\S+))?/);
    const bestmove = m ? m[1] : null;
    const ponder = m && m[2] ? m[2] : null;

    return {
      bestmove: bestmove === "(none)" ? null : bestmove,
      ponder,
      cp: last.cp,
      mate: last.mate,
      pv: last.pv || (bestmove ? [bestmove] : []),
      depth: last.depth,
    };
  }

  // 供 UI 事先偵測環境是否可用
  function envSupported() {
    return typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated;
  }

  return { boot, analyze, onLine, envSupported };
})();
