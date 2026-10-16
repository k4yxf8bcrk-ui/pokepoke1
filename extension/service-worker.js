const DEFAULTS = {
  repo: "k4yxf8bcrk-ui/pokepoke1",
  branch: "main",
  maxDays: 10,
  intervalMs: 8000
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64decode(str) {
  const bin = atob(String(str || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function settings() {
  const s = await chrome.storage.local.get(["githubToken", "repo", "branch"]);
  return {
    token: s.githubToken || "",
    repo: s.repo || DEFAULTS.repo,
    branch: s.branch || DEFAULTS.branch
  };
}

async function ghFetch(url, options = {}) {
  const s = await settings();
  if (!s.token) throw new Error("GitHubトークン未設定です。拡張機能の設定を開いてください。");
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Authorization": `Bearer ${s.token}`,
    ...(options.headers || {})
  };
  const r = await fetch(url, { ...options, headers });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).message || ""; } catch (_) {}
    throw new Error(`GitHub ${r.status}${detail ? `: ${detail}` : ""}`);
  }
  return r.json();
}

function mergeRecords(existing, incoming) {
  const map = new Map();
  for (const row of existing || []) {
    if (!row?.date || !row?.machineNo) continue;
    map.set(`${row.date}|${row.machineNo}`, { ...row });
  }
  let added = 0, updated = 0;
  for (const row of incoming || []) {
    if (!row?.date || !row?.machineNo) continue;
    const k = `${row.date}|${row.machineNo}`;
    const old = map.get(k);
    const next = old ? { ...old } : {
      date: row.date,
      machineNo: String(row.machineNo),
      machine: row.machine || "ジャグラー",
      games: 0,
      diff: 0,
      bb: 0,
      rb: 0
    };
    if (row.machine && row.machine !== "ジャグラー") next.machine = row.machine;
    for (const key of ["games", "diff", "bb", "rb"]) {
      if (row[key] !== null && row[key] !== undefined && Number.isFinite(Number(row[key]))) next[key] = Number(row[key]);
    }
    if (old) updated++; else added++;
    map.set(k, next);
  }
  const records = [...map.values()].sort((a, b) => {
    const dc = String(a.date).localeCompare(String(b.date));
    if (dc) return dc;
    return Number(a.machineNo) - Number(b.machineNo);
  });
  return { records, added, updated };
}

async function syncRows(rows, note = "Anaslo import") {
  const s = await settings();
  const api = `https://api.github.com/repos/${s.repo}/contents/data.json?ref=${encodeURIComponent(s.branch)}`;
  const current = await ghFetch(api);
  const obj = JSON.parse(b64decode(current.content));
  const { records, added, updated } = mergeRecords(obj.records || [], rows);
  const latestDate = records.reduce((m, r) => !m || r.date > m ? r.date : m, null);
  const payload = {
    ...obj,
    schemaVersion: obj.schemaVersion || 1,
    generatedAt: new Date().toISOString(),
    latestDate,
    recordCount: records.length,
    machineCount: new Set(records.map((r) => String(r.machineNo))).size,
    modelCount: new Set(records.map((r) => String(r.machine || "Unknown"))).size,
    records
  };
  const putUrl = `https://api.github.com/repos/${s.repo}/contents/data.json`;
  const body = {
    message: `${note}: ${rows.length} rows`,
    content: b64encode(JSON.stringify(payload, null, 2)),
    sha: current.sha,
    branch: s.branch
  };
  await ghFetch(putUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: true, rows: rows.length, added, updated, total: records.length, latestDate };
}

function shiftDateInUrl(url, backDays) {
  const u = new URL(url);
  const patterns = [
    /(20\d{2})-(\d{2})-(\d{2})/,
    /(20\d{2})(\d{2})(\d{2})/,
    /(20\d{2})\/(\d{2})\/(\d{2})/
  ];
  const src = u.href;
  for (const re of patterns) {
    const m = src.match(re);
    if (!m) continue;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
    d.setDate(d.getDate() - backDays);
    const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
    let rep;
    if (m[0].includes("-")) rep = `${y}-${mo}-${da}`;
    else if (m[0].includes("/")) rep = `${y}/${mo}/${da}`;
    else rep = `${y}${mo}${da}`;
    return src.replace(re, rep);
  }
  return null;
}

function waitTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("ページ読み込みタイムアウト")); }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectTab(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "COLLECT_PAGE" });
}

async function runBatch(tabId, startUrl, days) {
  const n = Math.max(1, Math.min(DEFAULTS.maxDays, Number(days) || 1));
  const all = [];
  const log = [];
  for (let i = 0; i < n; i++) {
    const url = shiftDateInUrl(startUrl, i);
    if (!url) throw new Error("URL内の日付を判定できないため連続取得できません。単日取得を使ってください。");
    await chrome.tabs.update(tabId, { url });
    await waitTabComplete(tabId);
    await sleep(1200);
    let result;
    try { result = await collectTab(tabId); }
    catch (e) { throw new Error(`ページ解析失敗: ${e.message}`); }
    if (result?.blocked) {
      log.push(`${result.date || "?"}: 制限ページを検出したため停止`);
      break;
    }
    if (result?.ok) {
      all.push(...result.rows);
      log.push(`${result.date}: ${result.rows.length}件`);
    } else {
      log.push(`${result?.date || "?"}: 0件`);
    }
    if (i < n - 1) await sleep(DEFAULTS.intervalMs);
  }
  const dedup = new Map();
  for (const r of all) dedup.set(`${r.date}|${r.machineNo}`, r);
  const rows = [...dedup.values()];
  if (!rows.length) return { ok: false, rows: 0, log, reason: "取得できるデータがありませんでした" };
  const sync = await syncRows(rows, "Anaslo batch import");
  return { ...sync, log };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "SYNC_ROWS") return syncRows(msg.rows || []);
    if (msg?.type === "START_BATCH") {
      const tabId = msg.tabId || sender.tab?.id;
      if (!tabId) throw new Error("対象タブが見つかりません");
      return runBatch(tabId, msg.startUrl, msg.days);
    }
    if (msg?.type === "GET_SETTINGS") return settings();
    return null;
  })().then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});
