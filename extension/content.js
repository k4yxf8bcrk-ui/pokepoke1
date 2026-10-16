(() => {
  const norm = (s) => String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const toInt = (s) => {
    const t = norm(s).replace(/,/g, "").replace(/[＋+]/g, "+").replace(/[−ー―‐]/g, "-");
    const m = t.match(/[+-]?\d+(?:\.\d+)?/);
    return m ? Math.round(Number(m[0])) : null;
  };
  const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  function dateFromText(src) {
    src = String(src || "");
    let m = src.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
    if (m) return isoDate(m[1], m[2], m[3]);
    m = src.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/);
    if (m) return isoDate(m[1], m[2], m[3]);
    return null;
  }
  function pageDate() {
    return dateFromText(location.href) || dateFromText(document.title) || dateFromText(document.body?.innerText?.slice(0, 3000));
  }
  function blockedPage() {
    const s = norm(`${document.title} ${document.body?.innerText?.slice(0, 7000) || ""}`).toLowerCase();
    const words = ["just a moment", "too many requests", "captcha", "access denied", "アクセスが制限", "アクセス制限", "429", "403 forbidden", "cf-chl-"];
    return words.find((w) => s.includes(w)) || null;
  }
  function overlayLikely() {
    const nodes = [...document.querySelectorAll("body *")].slice(0, 3000);
    return nodes.some((el) => {
      const st = getComputedStyle(el);
      if (st.position !== "fixed") return false;
      const r = el.getBoundingClientRect();
      const z = Number(st.zIndex);
      return r.width > innerWidth * .7 && r.height > innerHeight * .7 && (Number.isFinite(z) ? z >= 100 : false);
    });
  }
  function cleanModel(s) {
    return norm(s).replace(/^[\s・●■★☆\-]+/, "").replace(/\s+(データ|一覧).*$/i, "").trim();
  }
  function valid(r) {
    if (!r || !/^\d{3,5}$/.test(String(r.machineNo || ""))) return false;
    if (!/ジャグラー/i.test(String(r.machine || ""))) return false;
    if (r.games == null || r.diff == null || r.bb == null || r.rb == null) return false;
    if (r.games < 0 || r.games > 20000) return false;
    if (Math.abs(r.diff) > 20000) return false;
    if (r.bb < 0 || r.bb > 120 || r.rb < 0 || r.rb > 120) return false;
    return true;
  }

  // 新ハナビ版と同じ考え方：実HTMLの機種行を直接読む。
  // 全データ一覧型: [機種名, 台番, G数, 差枚, BB, RB, ...]
  function parseExactMachineRows(date) {
    const out = [];
    for (const tr of document.querySelectorAll("tr")) {
      const cells = [...tr.querySelectorAll("th,td")].map((x) => norm(x.innerText));
      if (cells.length < 6) continue;
      if (!/ジャグラー/i.test(cells[0])) continue;
      const no = (cells[1].match(/\d{3,5}/) || [])[0] || "";
      const r = {
        date,
        machineNo: no,
        machine: cleanModel(cells[0]),
        games: toInt(cells[2]),
        diff: toInt(cells[3]),
        bb: toInt(cells[4]),
        rb: toInt(cells[5]),
        source: "anaslo",
        strategy: "exact-machine-tr-rows"
      };
      if (valid(r)) out.push(r);
    }
    return out;
  }

  function headingBefore(table) {
    const cap = norm(table.querySelector("caption")?.innerText);
    if (/ジャグラー/i.test(cap)) return cleanModel(cap);
    let n = table.previousElementSibling;
    for (let i = 0; n && i < 10; i++, n = n.previousElementSibling) {
      const t = norm(n.innerText);
      if (/ジャグラー/i.test(t) && t.length < 160) return cleanModel(t);
    }
    const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,strong")];
    const prev = hs.filter(h => h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).reverse();
    const h = prev.find(x => /ジャグラー/i.test(norm(x.innerText)) && norm(x.innerText).length < 160);
    return h ? cleanModel(h.innerText) : "";
  }

  // 機種ごとの表型: 見出し=機種名 / [台番, G数, 差枚, BB, RB, ...]
  function parseSectionTables(date) {
    const out = [];
    for (const table of document.querySelectorAll("table")) {
      const model = headingBefore(table);
      if (!/ジャグラー/i.test(model)) continue;
      for (const tr of table.querySelectorAll("tr")) {
        const cells = [...tr.querySelectorAll("td")].map((x) => norm(x.innerText));
        if (cells.length < 5) continue;
        const no = (cells[0].match(/^\D*(\d{3,5})\D*$/) || [])[1] || "";
        const r = {
          date,
          machineNo: no,
          machine: model,
          games: toInt(cells[1]),
          diff: toInt(cells[2]),
          bb: toInt(cells[3]),
          rb: toInt(cells[4]),
          source: "anaslo",
          strategy: "section-table"
        };
        if (valid(r)) out.push(r);
      }
    }
    return out;
  }

  function collect() {
    const date = pageDate();
    if (!date) return { ok: false, reason: "日付を判定できませんでした", url: location.href, blocked: !!blockedPage() };
    let rows = parseExactMachineRows(date);
    let strategy = "exact-machine-tr-rows";
    if (!rows.length) {
      rows = parseSectionTables(date);
      strategy = "section-table";
    }
    const seen = new Map();
    for (const r of rows) seen.set(`${r.date}|${r.machineNo}`, r);
    rows = [...seen.values()].sort((a,b) => Number(a.machineNo) - Number(b.machineNo));
    const blocked = blockedPage();
    if (!rows.length && blocked) return { ok:false, blocked:true, reason:blocked, date, url:location.href, overlay:overlayLikely(), rows:[] };
    return {
      ok: rows.length > 0,
      blocked: false,
      reason: rows.length ? null : "ジャグラーの実データ行を見つけられませんでした",
      date,
      url: location.href,
      title: document.title,
      strategy,
      overlay: overlayLikely(),
      rows,
      sample: rows.slice(0, 5)
    };
  }

  function dateLinks() {
    const map = new Map();
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.href;
      if (!/^https:\/\/(www\.)?ana-slo\.com\//i.test(href)) continue;
      if (!/-data\/?(?:[?#].*)?$/i.test(href)) continue;
      const date = dateFromText(href) || dateFromText(a.innerText);
      if (!date) continue;
      map.set(date, { date, href, text: norm(a.innerText) });
    }
    return [...map.values()].sort((a,b) => a.date.localeCompare(b.date));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "COLLECT_PAGE") return sendResponse(collect());
    if (msg?.type === "GET_DATE_LINKS") return sendResponse({ ok:true, url:location.href, links:dateLinks(), blocked:!!blockedPage() });
    if (msg?.type === "CLICK_LINK") {
      const target = String(msg.href || "");
      const a = [...document.querySelectorAll("a[href]")].find(x => x.href === target);
      if (a) { a.click(); sendResponse({ok:true, clicked:true}); }
      else { location.href = target; sendResponse({ok:true, clicked:false}); }
      return;
    }
    if (msg?.type === "PAGE_INFO") return sendResponse({ ok:true, date:pageDate(), blocked:!!blockedPage(), overlay:overlayLikely(), url:location.href, links:dateLinks().length });
  });
})();
