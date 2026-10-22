# KEY DASH Ranking

CardputerZero向けタイピングゲーム **KEY DASH** の公開ランキングです。

- ランキング: https://yuk1-kondo.github.io/key-dash-ranking/
- 公開API: https://key-dash-ranking.yukilab-m.workers.dev
- GitHub Pagesは表示を担当し、Cloudflare Worker + D1が登録・保存・採点を担当します。
- プレイヤーはGitHubアカウント不要。アプリの **5 Online → Enter → 名前を入力 → Enter** で登録できます。
- 名前は3〜12文字の英数字、`_`、`-`。名前は大文字小文字を区別せず予約されます。
- 30秒/60秒 × English/Code、4部門。個人ベストのみ表示。WPM、正確率、先に記録した日時の順です。
- オフラインプレイと練習は送信されません。オンラインを明示的に選ぶと、名前・入力キーと時刻・スコアをAPIに送信します。

## 公平性と保存

サーバーはランダムな単語シードを発行し、時刻付き入力から採点を再現します。申告されたWPMは受け付けません。期限・一回限りの提出・同一提出の再送を扱います。打ち直しで速度が増えない採点です。自動入力や改造クライアントを完全に防ぐ競技認証ではありません。

プレイヤーごとにランダムなキーを発行します。DBにはSHA-256ハッシュだけを保存し、キーを公開コードへ埋め込みません。プレイヤーキーはアプリ設定内の `online-player.json` に所有者のみ読み書きできる権限で保存されます。端末変更に備えて**非公開でバックアップ**してください。メール認証や復旧フローはありません。

名前・自己ベスト・正確率・記録日は公開です。入力履歴は採点時だけ処理し、DBに保存しません。チャレンジと再送用結果は期限の翌日以降に日次削除します。プレイヤーとベストは削除依頼まで保持します。乱用対策に日ごとのIPハッシュを一時保存し、生のIPをDBへ記録しません。Cloudflareの基盤自体はネットワーク情報を処理します。

削除依頼はこのリポジトリのIssueで管理者にご連絡ください。**プレイヤーキーは公開しないでください。** 管理者は別経路で所有確認後、対象のscores/runs/playersをトランザクションで削除します。

## ローカル開発

Node.js 22以降、npm、Wranglerを使います。

```sh
npm ci
npm test
npx wrangler d1 execute key-dash-scores --local --file schema.sql
npx wrangler dev --ip 127.0.0.1 --port 8787 --var ALLOWED_ORIGIN:http://127.0.0.1:8766
```

ローカルサイトを検証するときは `site/config.js` のURLを `http://127.0.0.1:8787` に設定し、別ターミナルで `python3 -m http.server 8766 --bind 127.0.0.1 --directory site`。公開前に本番URLへ戻してください。

Cloudflare認証は公式の `npx wrangler login` で行います。認証ファイル・`.dev.vars`・`.wrangler`・プレイヤーキーをコミットしないでください。

## 公開

GitHub Pagesは `.github/workflows/pages.yml` により `site/` をビルドして `dist/site/` を配信します。CSS/JavaScriptのファイル名には内容のハッシュを付け、更新前のキャッシュが残ることを避けます。`npm run build` で同じ静的成果物を生成できます。APIやDBがPages上で動くわけではありません。

```sh
npx wrangler d1 execute key-dash-scores --remote --file schema.sql --yes
npx wrangler deploy
```

`wrangler.jsonc` のアカウントID・DB IDは公開のリソース識別子であり、認証情報ではありません。別の管理者がフォークして公開するときは自分のアカウント・D1を作成して差し替えてください。GitHub ActionsにCloudflareトークンを設定する必要はありません。Workerは管理者がCLIから公開します。

## API（rules 1）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/v1/health` | サービスとルールのバージョン |
| POST | `/v1/players` | `{name}` → `{id,name,token}`。キーを返すのは作成時だけ |
| POST | `/v1/runs` | Bearerキー、`{mode:30\|60,pack:"english"\|"code",rules:1}` → シードとチャレンジID |
| POST | `/v1/runs/:id/score` | 同じBearerキー、`{events:[[経過ms,"キー"],...]}` → サーバー採点結果 |
| GET | `/v1/leaderboard?mode=30&pack=english` | 上位100人の自己ベスト |

最初の有効入力は0ms、時刻は単調増加（同じ時刻可）、期限未満。SpaceまたはEnterは`" "`、Backspaceは`"\b"`として送ります。先頭Space/Backspaceは開始に使いません。最大2400イベント、80KB。最初の入力から計時し、チャレンジ作成から10分以内に提出します。サーバーは制限時間より早い提出を拒否します。失敗後の再送は同じチャレンジIDで行います。登録はIPあたり1日5回、書込みは1時間180回、チャレンジはプレイヤーあたり1時間60回までです。

HTTPSの証明書検証を有効にしたクライアントを使ってください。ブラウザーのCORSはPagesのオリジンに限定し、ネイティブアプリはOriginヘッダーを付けません。

MIT License.
