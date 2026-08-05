/*
 * vision.js — 用 Google Gemini 從殘局圖片辨識棋盤 → 產生盤面
 * API 金鑰由使用者輸入，存於 localStorage（不寫進 repo，避免公開外洩）。
 * 端點：generativelanguage.googleapis.com（此環境未被公司 TLS 攔）。
 */

const Vision = (() => {
  const KEY_STORE = "xq_gemini_key";
  const MODEL = "gemini-flash-latest"; // 對新用戶穩定，勿用已下架的 gemini-2.5-flash

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

  // 讀檔為 base64（去掉 data: 前綴）
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
    if (!redBottom) {
      // 旋轉 180°：上下顛倒 + 左右鏡射
      rows = rows.reverse().map((r) => r.reverse());
    }
    const fenRows = rows.map((r) => {
      let out = "";
      let empty = 0;
      for (const ch of r) {
        if (ch === "." || ch === " ") {
          empty++;
        } else {
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

  // 主流程：檔案 → { fen, side, confidence }
  async function recognize(file) {
    const key = getKey();
    if (!key) throw new Error("NO_KEY");
    const b64 = await fileToBase64(file);
    const mime = file.type || "image/png";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
      key
    )}`;
    const body = {
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Gemini API 錯誤 ${resp.status}：${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("無法解析 Gemini 回傳：" + text.slice(0, 200));
      parsed = JSON.parse(m[0]);
    }
    const fen = gridToFEN(
      parsed.grid || [],
      parsed.red_on_bottom !== false,
      parsed.side_to_move
    );
    return {
      fen,
      side: parsed.side_to_move === "black" ? "b" : "w",
      confidence: parsed.confidence ?? null,
    };
  }

  return { getKey, setKey, recognize, gridToFEN };
})();
