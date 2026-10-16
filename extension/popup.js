let collectedRows = [];
const $ = (id) => document.getElementById(id);
const setStatus = (s) => { $("status").textContent = s; };

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function showSample(result) {
  const box = $("sample");
  if (!result?.sample?.length) { box.hidden = true; box.textContent = ""; return; }
  box.hidden = false;
  box.textContent = result.sample.map((r) => `${r.date}  ${r.machineNo}  ${r.machine}\nG:${r.games ?? "?"} 差枚:${r.diff ?? "?"} BB:${r.bb ?? "?"} RB:${r.rb ?? "?"}`).join("\n\n");
}

$("collect").addEventListener("click", async () => {
  collectedRows = [];
  $("sync").disabled = true;
  setStatus("読み取り中…");
  try {
    const tab = await activeTab();
    if (!tab?.id || !/^https:\/\/(www\.)?ana-slo\.com\//.test(tab.url || "")) throw new Error("アナスロのページを開いてください。");
    const result = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_PAGE" });
    if (!result?.ok) throw new Error(result?.reason || "データを取得できませんでした。");
    collectedRows = result.rows || [];
    $("sync").disabled = collectedRows.length === 0;
    setStatus(`${result.date}\n${collectedRows.length}件取得しました。\nテーブル ${result.tableCount}個を確認。`);
    showSample(result);
  } catch (e) {
    setStatus(`取得失敗: ${e.message}`);
  }
});

$("sync").addEventListener("click", async () => {
  if (!collectedRows.length) return;
  setStatus(`GitHubへ同期中… ${collectedRows.length}件`);
  const result = await chrome.runtime.sendMessage({ type: "SYNC_ROWS", rows: collectedRows });
  if (!result?.ok) {
    setStatus(`同期失敗: ${result?.error || "不明なエラー"}`);
    return;
  }
  setStatus(`同期完了\n対象 ${result.rows}件\n新規 ${result.added}件 / 更新 ${result.updated}件\n全体 ${result.total}件\n最新 ${result.latestDate}`);
});

$("batch").addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    if (!tab?.id || !/^https:\/\/(www\.)?ana-slo\.com\//.test(tab.url || "")) throw new Error("アナスロの日付入りページを開いてください。");
    const days = Math.max(1, Math.min(10, Number($("days").value) || 1));
    setStatus(`${days}日分の連続取得を開始します。タブはそのままにしてください…`);
    const result = await chrome.runtime.sendMessage({ type: "START_BATCH", tabId: tab.id, startUrl: tab.url, days });
    if (!result?.ok) throw new Error(result?.error || result?.reason || "連続取得に失敗しました");
    setStatus(`連続取得・同期完了\n${(result.log || []).join("\n")}\n\n同期 ${result.rows}件 / 新規 ${result.added}件 / 更新 ${result.updated}件`);
  } catch (e) {
    setStatus(`連続取得停止: ${e.message}`);
  }
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
