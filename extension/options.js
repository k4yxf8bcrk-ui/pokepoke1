const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(["githubToken", "repo", "branch"]);
  $("token").value = s.githubToken || "";
  $("repo").value = s.repo || "k4yxf8bcrk-ui/pokepoke1";
  $("branch").value = s.branch || "main";
}

$("save").addEventListener("click", async () => {
  const githubToken = $("token").value.trim();
  const repo = $("repo").value.trim() || "k4yxf8bcrk-ui/pokepoke1";
  const branch = $("branch").value.trim() || "main";
  await chrome.storage.local.set({ githubToken, repo, branch });
  $("status").textContent = githubToken ? "保存しました。" : "設定を保存しました。トークンは未設定です。";
  $("status").className = "note ok";
});

$("remove").addEventListener("click", async () => {
  await chrome.storage.local.remove("githubToken");
  $("token").value = "";
  $("status").textContent = "トークンを削除しました。";
  $("status").className = "note ok";
});

load();
