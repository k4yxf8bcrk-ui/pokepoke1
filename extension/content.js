(() => {
  const norm = (s) => String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const toInt = (s) => {
    const t = norm(s).replace(/,/g, "").replace(/[＋+]/g, "+").replace(/[−ー―‐]/g, "-");
    const m = t.match(/[+-]?\d+(?:\.\d+)?/);
    return m ? Math.round(Number(m[0])) : null;
  };
  const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  function pageDate() {
    const src = `${location.href} ${document.title} ${document.body?.innerText?.slice(0, 4000) || ""}`;
    let m = src.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
    if (m) return isoDate(m[1], m[2], m[3]);
    m = src.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
    if (m) return isoDate(m[1], m[2], m[3]);
    return null;
  }

  function blockedPage() {
    const s = norm(`${document.title} ${document.body?.innerText?.slice(0, 6000) || ""}`).toLowerCase();
    const words = ["just a moment", "cloudflare", "too many requests", "captcha", "アクセスが制限", "アクセス制限", "429", "403 forbidden"];
    return words.find((w) => s.includes(w)) || null;
  }

  function headerIndex(headers, pats) {
    return headers.findIndex((h) => pats.some((p) => p.test(h)));
  }

  function nearestModel(table) {
    const cap = norm(table.querySelector("caption")?.innerText);
    if (/ジャグラー/i.test(cap)) return cap;
    let node = table.previousElementSibling;
    for (let i = 0; node && i < 8; i++, node = node.previousElementSibling) {
      const txt = norm(node.innerText);
      if (/ジャグラー/i.test(txt) && txt.length < 180) return txt;
    }
    const parentText = norm(table.parentElement?.innerText?.slice(0, 600));
    const mm = parentText.match(/[^\n]{0,50}ジャグラー[^\n]{0,50}/i);
    return mm ? norm(mm[0]) : "";
  }

  function parseTable(table, date) {
    const trs = [...table.querySelectorAll("tr")];
    if (!trs.length) return [];
    let headerRow = trs.find((tr) => tr.querySelectorAll("th").length >= 2) || trs[0];
    let headers = [...headerRow.querySelectorAll("th,td")].map((x) => norm(x.innerText));
    const idx = {
      no: headerIndex(headers, [/^台番$/, /台番号/, /^番号$/]),
      machine: headerIndex(headers, [/機種名/, /^機種$/]),
      games: headerIndex(headers, [/ゲーム/, /^G数$/i, /回転/]),
      diff: headerIndex(headers, [/差枚/, /出玉/, /差.*枚/]),
      bb: headerIndex(headers, [/^BB$/i, /BIG/i, /ビッグ/]),
      rb: headerIndex(headers, [/^RB$/i, /^REG$/i, /レギュラー/])
    };
    const fallbackModel = nearestModel(table);
    const rows = [];
    for (const tr of trs) {
      if (tr === headerRow) continue;
      const cells = [...tr.querySelectorAll("td")].map((x) => norm(x.innerText));
      if (cells.length < 3) continue;
      let no = idx.no >= 0 ? norm(cells[idx.no]) : "";
      if (!/^\d{3,5}$/.test(no)) {
        const candidate = cells.find((c) => /^\d{3,5}$/.test(c));
        no = candidate || "";
      }
      if (!no) continue;
      const model = idx.machine >= 0 ? norm(cells[idx.machine]) : fallbackModel;
      if (model && !/ジャグラー/i.test(model)) continue;
      const rec = {
        date,
        machineNo: no,
        machine: model || "ジャグラー",
        games: idx.games >= 0 ? toInt(cells[idx.games]) : null,
        diff: idx.diff >= 0 ? toInt(cells[idx.diff]) : null,
        bb: idx.bb >= 0 ? toInt(cells[idx.bb]) : null,
        rb: idx.rb >= 0 ? toInt(cells[idx.rb]) : null,
        source: "anaslo"
      };
      // ヘッダーが取れない場合は、よくある数値列を最低限補助。確定できない値は null のままにする。
      if (rec.games == null) {
        const nums = cells.map(toInt);
        const ni = cells.indexOf(no);
        const after = ni >= 0 ? nums.slice(ni + 1) : nums;
        const gameLike = after.find((v) => Number.isInteger(v) && v >= 100 && v <= 20000);
        if (gameLike != null) rec.games = gameLike;
      }
      if ([rec.games, rec.diff, rec.bb, rec.rb].every((v) => v == null)) continue;
      rows.push(rec);
    }
    return rows;
  }

  function collect() {
    const blocked = blockedPage();
    if (blocked) return { ok: false, blocked: true, reason: blocked, url: location.href };
    const date = pageDate();
    if (!date) return { ok: false, reason: "日付を判定できませんでした", url: location.href };
    const tables = [...document.querySelectorAll("table")];
    let rows = tables.flatMap((t) => parseTable(t, date));
    const seen = new Map();
    for (const r of rows) {
      const k = `${r.date}|${r.machineNo}`;
      const old = seen.get(k);
      if (!old) seen.set(k, r);
      else {
        for (const key of ["machine", "games", "diff", "bb", "rb"]) {
          if ((old[key] == null || old[key] === "") && r[key] != null && r[key] !== "") old[key] = r[key];
        }
      }
    }
    rows = [...seen.values()];
    return {
      ok: rows.length > 0,
      date,
      url: location.href,
      title: document.title,
      tableCount: tables.length,
      rows,
      sample: rows.slice(0, 5),
      reason: rows.length ? null : "ジャグラーデータを見つけられませんでした"
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "COLLECT_PAGE") sendResponse(collect());
  });
})();
