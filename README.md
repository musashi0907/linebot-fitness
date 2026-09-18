# 減量・筋トレ LINE Bot

体重・筋トレ・食事・目標を、LINEに自由な文章か写真を送るだけで記録できるBotです。

- テキスト:「今日68.4kg」「ベンチプレス60kg 10回×3セット」「昼食 鶏胸肉とごはん 600kcal」「目標体重65kg、3月末まで」
- 写真:体重計の表示を撮って送ると数値を読み取り、料理の写真を送るとカロリー・栄養素を推定します
- コマンド:「今日」でサマリー表示、「目標」で今の目標確認、「取り消し」で直前の記録を取り消し

裏側ではAnthropicのClaude APIを使ってメッセージ・写真を解析し、SQLiteに記録を保存します。

## 必要なもの(先に用意してください)

1. **LINEアカウント**(個人のLINEアプリ用アカウントでOK)
2. **Anthropicのアカウント**([console.anthropic.com](https://console.anthropic.com)でAPIキーを発行。claude.aiの契約とは別に、従量課金のAPI利用料がかかります。個人の記録用途なら月数百円程度が目安です)
3. **ホスティングサービスのアカウント**(下記はRender.comの無料プランを想定)
4. **Node.js 22以上**(ローカルで試す場合。LINEのSDKが内部でNode 22以上を要求します)

## 1. LINE Developersでチャネルを作る

1. [LINE Developers Console](https://developers.line.biz/console/) にLINEアカウントでログイン
2. 「プロバイダー」を新規作成(会社名でなく好きな名前でOK)
3. そのプロバイダーの下で「チャネルを作成」→ **Messaging API** を選択
4. チャネル名・説明・カテゴリなどを入力して作成
5. 作成したチャネルの「Messaging API設定」タブを開き、以下を控える:
   - **チャネルアクセストークン(長期)**:「発行」ボタンを押して発行 → `LINE_CHANNEL_ACCESS_TOKEN`
   - チャネル基本設定タブの「チャネルシークレット」→ `LINE_CHANNEL_SECRET`
6. 「Messaging API設定」タブで以下を設定:
   - Webhookの利用:**オン**
   - 応答メッセージ:**オフ**(LINEのデフォルト応答と競合しないように)
   - あいさつメッセージ:オフでも可
7. 同じページのQRコードでこのBotを自分のLINEアカウントに友だち追加しておく(サーバー用意後、実際に話しかけて動作確認します)

Webhook URLは後述のデプロイ後に設定します(サーバーがまだ無いので一旦保留)。

## 2. Anthropic APIキーを取得する

1. [console.anthropic.com](https://console.anthropic.com) でアカウントを作成
2. 「API Keys」からキーを発行 → `ANTHROPIC_API_KEY`
3. 「Billing」で少額のクレジットを追加(従量課金なので使った分だけ請求されます)

## 3. ローカルで動かして試す(任意)

```bash
cd linebot-fitness
npm install
cp .env.example .env
```

`.env` を開いて、控えた3つの値(`LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` / `ANTHROPIC_API_KEY`)を貼り付けてください。

```bash
npm start
```

`LINE fitness bot listening on port 3000` と表示されれば起動成功です。ただしこのままではLINEからの通信を受け取れません(自分のPCはインターネットから直接アクセスできないため)。動作確認だけしたい場合は [ngrok](https://ngrok.com/) などでトンネルを張る方法もありますが、まずは下記の本番デプロイに進むのが簡単です。

## 4. Render.comにデプロイする

1. このフォルダをGitHubリポジトリにpushする
   ```bash
   git add -A
   git commit -m "Initial LINE fitness bot"
   git remote add origin <あなたのGitHubリポジトリURL>
   git push -u origin main
   ```
2. [Render.com](https://render.com) にGitHubアカウントでログイン
3. 「New +」→「Web Service」→ 今pushしたリポジトリを選択
4. 設定:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free でまず問題ありません
   - Node.jsのバージョンはリポジトリに含めた `.node-version`(22)を自動で読み取ってくれます。もし反映されない場合はRenderの環境変数に `NODE_VERSION=22` を追加してください
5. 「Environment」タブで環境変数を3つ登録:
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `ANTHROPIC_API_KEY`
6. デプロイが完了すると `https://<サービス名>.onrender.com` のようなURLが発行されます

⚠️ 無料プランは一定時間アクセスが無いとスリープし、次のメッセージへの返信が数秒〜数十秒遅れることがあります。気になる場合は有料プラン(月$7〜)への変更を検討してください。

## 5. LINEのWebhook URLを設定する

1. LINE Developers Consoleに戻り、「Messaging API設定」タブを開く
2. Webhook URLに `https://<Renderで発行されたURL>/callback` を入力して「更新」
3. 「検証」ボタンを押して成功することを確認

## 6. 使ってみる

友だち追加したBotに、試しにメッセージを送ってみてください。

```
今日68.4kg
```

「記録しました」のような返信が来れば成功です。

## データの保存場所と注意点

- 記録はサーバー上のSQLiteファイル(`data/fitness.sqlite`)に保存されます。Render無料プランはデプロイのたびにファイルシステムがリセットされる場合があるため、**長期的にデータを残したい場合は有料プランの永続ディスク(Persistent Disk)を追加する**か、外部のデータベース(Supabase、PlanetScaleなど)への移行を検討してください
- このBotはLINEユーザーIDごとにデータを分けて保存する作りになっているので、複数人が友だち追加しても記録は混ざりません
- Claude APIの呼び出しには実際に課金が発生します。使いすぎが心配な場合はAnthropicコンソールの使用量アラートを設定してください

## モデルを変えたい場合

`.env` の `CLAUDE_MODEL` を変更してください。デフォルトは `claude-sonnet-5`(精度重視)。コストを抑えたい場合は `claude-haiku-4-5-20251001` を試してください。
