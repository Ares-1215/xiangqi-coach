/*
 * vision.js — 用 Google Gemini 從殘局圖片辨識棋盤 → 產生盤面
 * 兩種路徑：
 *  1) 使用者自備金鑰（存 localStorage）→ 直接呼叫 Gemini（無每日額度風險）。
 *  2) 未設金鑰 → 走 Supabase Edge Function 代理（伺服器端金鑰），達成「免自備金鑰」。
 */

const Vision = (() => {
  const KEY_STORE = "xq_gemini_key";
  const MODEL = "gemini-flash-latest";

  // Supabase 代理（免自備金鑰）
  const SUPABASE_URL = "https://hmqnlovyzlvvnkqmfwtt.supabase.co";
  const SUPABASE_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtcW5sb3Z5emx2dm5rcW1md3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NjgxMTAsImV4cCI6MjEwMDU0NDExMH0.epqZ-DZsthezuTjfFGEhosR3hU3v8FgR4w0xnYOHN6s";
  const PROXY_ENDPOINT = `${SUPABASE_URL}/functions/v1/gemini-vision`;

  function getKey() {
    return localStorage.getItem(KEY_STORE) || "";
  }
  function setKey(k) {
    localStorage.setItem(KEY_STORE, k.trim());
  }

  const PROMPT = `你是象棋（中國象棋）棋盤辨識器。請仔細看這張殘局圖片，輸出棋盤上每一格的棋子。

規則：
- 棋盤為 9 直行（col）× 10 橫列（row）。
- 用單一字母代表棋子，紅方大寫、黑方小寫（依棋子顏色判斷，不是位置）：
  K/k=帥將  A/a=仕士  B/b=相象  N/n=傌馬  R/r=俥車  C/c=炮砲  P/p=兵卒
- 空格用 "."。
- grid 由圖片「最上排到最下排」，每列 9 個字元字串，共 10 列。
- red_on_bottom：圖片中紅方棋子若在下半部為 true，在上半部為 false。
- side_to_move：若能判斷輪誰走填 "red" 或 "black"，無法判斷填 "red"。

只輸出 JSON，格式：
{"grid":["9字元","...共10列..."],"red_on_bottom":true,"side_to_move":"red","confidence":0.0}`;

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result.split(",")[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // grid（10列字串）+ red_on_bottom → FEN。若紅在上，旋轉 180° 讓紅到下方。
  function gridToFEN(grid, redBottom, side) {
    let rows = grid.map((s) => (s + ".........").slice(0, 9).split(""));
    while (rows.length < 10) rows.push(".".repeat(9).split(""));
    rows = rows.slice(0, 10);
    if (!redBottom) rows = rows.reverse().map((r) => r.reverse());
    const fenRows = rows.map((r) => {
      let out = "",
        empty = 0;
      for (const ch of r) {
        if (ch === "." || ch === " ") empty++;
        else {
          if (empty) {
            out += empty;
            empty = 0;
          }
          out += ch;
        }
      }
      if (empty) out += empty;
      return out || "9";
    });
    const s = side === "black" ? "b" : "w";
    return `${fenRows.join("/")} ${s} - - 0 1`;
  }

  // 模型回傳的 JSON 文字 → { fen, side, confidence }
  function textToResult(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("無法解析辨識結果：" + text.slice(0, 200));
      parsed = JSON.parse(m[0]);
    }
    const fen = gridToFEN(parsed.grid || [], parsed.red_on_bottom !== false, parsed.side_to_move);
    return {
      fen,
      side: parsed.side_to_move === "black" ? "b" : "w",
      confidence: parsed.confidence ?? null,
    };
  }

  // 路徑一：自備金鑰，直接呼叫 Gemini
  async function recognizeDirect(file) {
    const key = getKey();
    const b64 = await fileToBase64(file);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: file.type || "image/png", data: b64 } }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    };
    const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`Gemini API 錯誤 ${resp.status}：${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return textToResult(text);
  }

  // 路徑二：走 Supabase 代理（免自備金鑰）
  async function recognizeProxy(file) {
    const b64 = await fileToBase64(file);
    const resp = await fetch(PROXY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ image: b64, mime: file.type || "image/png" }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || `代理錯誤 ${resp.status}`);
    return textToResult(data.text || "");
  }

  // 主流程：有金鑰走直連，否則走代理
  async function recognize(file) {
    return getKey() ? recognizeDirect(file) : recognizeProxy(file);
  }

  return { getKey, setKey, recognize, gridToFEN, hasOwnKey: () => !!getKey() };
})();
