# D Collector

Chromeで正常に表示できているアナスロの公開ページから、ジャグラーの台データを読み取り、`k4yxf8bcrk-ui/pokepoke1` の `data.json` に同期するための拡張機能です。

## インストール

1. GitHubの `pokepoke1` を ZIP でダウンロードして展開します。
2. Chromeで `chrome://extensions/` を開きます。
3. 右上の「デベロッパー モード」をONにします。
4. 「パッケージ化されていない拡張機能を読み込む」を押します。
5. 展開したフォルダ内の `extension` フォルダを選びます。

## GitHub同期設定

拡張機能の「GitHub同期設定」を開き、fine-grained personal access token を保存します。

推奨権限:
- Repository access: `Only select repositories` → `pokepoke1`
- Repository permissions: `Contents: Read and write`

トークンはChrome拡張機能のローカルストレージにのみ保存します。

## 使い方

- アナスロの日付別データページを通常どおり開く
- 拡張機能を開き「このページを取得」
- プレビューを確認して「取得内容をサイトへ同期」

日付がURLに含まれるページでは、「現在の日付から連続取得して同期」も使用できます。最大10日、約8秒間隔で通常ページを開きながら取得します。

403 / 429 / CAPTCHA / Cloudflare等の制限ページを検出した場合は停止します。制限を回避する処理は行いません。
