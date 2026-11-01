# ファイトフライト 共通仕様対応記録（2026-10-31）

## 対象と参照版

実験場が現在読むSupabase `games` の登録行で `is_active=true` とゲームURLを確認し、そのURLのHTTP200/タイトルを確認した。固定fallback一覧だけでは判定していない。今回対象 `faitofuraito_easy, faitofuraito_normal`。公開URL: https://chameleonjp-lab.github.io/faitofuraito/

ランキング詳細の現行カードURLは `https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=faitofuraito`。実験場の詳細ページ実装（source commit `4602e17985b7e572dcbcec94471f769cc62b8e30`）は `defaultDifficultyKey=normal` の詳細ビュー内にnormal/easyの難易度タブを持ち、難易度未指定はnormalを表示し、選択後は `difficulty=<mode>` をURLへ付ける。よってゲーム内リンクは同じ詳細ページへ選択中モードを渡す `?game=faitofuraito&difficulty=normal|easy` を使う。登録済みslug/送信先は `faitofuraito_normal` と `faitofuraito_easy` のまま。カードURLとモード付きゲーム内URLは役割が異なり、後者を未対応とは数えない。

着手時GitHub公開ブランチ `main`、SHA `dc85cec0a6a3e6f498cafd46bf372884a7090756`。引継ぎ時点の既存Draft PR #24はhead `54d628671eceebbb17921611c6cf5db1d4bb2bf7`、base `dc85cec0a6a3e6f498cafd46bf372884a7090756`で、本作業はこのPRを継続する。既存の旧記録にある「PR読取り0件」はPR作成前の調査時点であり、引継ぎ時点の状態ではない。ブランチ保護APIは403で詳細未確認、rulesetsの読取りは空。保護・環境・登録フラグは変更していない。Codebergからの導線切替は今回行わない（現在登録されたGitHub公開URLを維持）。

時点差の注記: [`docs/DB_RANKING.md`](DB_RANKING.md) の `is_active=false` と0件は2026-09-29の適用後rollback時点の記録。今回照合した実験場/登録情報（source commit `4602e17985b7e572dcbcec94471f769cc62b8e30`, checked `2026-11-01T15:46:00Z`）ではactive登録として表示され、現在の公開URLも同じGitHub Pagesであった。この変更でSupabaseへ書込/登録状態変更を行っていない。

多言語基準: Sainome `79b1e5733e725cd1148b10fa5699ba846e2bf57d` / `js/language-options.js` の言語選択肢: ja,en,es,pt-BR,zh-Hans,fr,de,ko,ru,it,zh-Hant,id,tr,vi,th。

## 実装と共通仕様13項目の対応

| 項目 | 対応と残る制約 |
|---|---|
|1 対象判定|登録中の2 slugと公開GitHub Pages URLを着手時に別々に照合。対象は `faitofuraito_easy`, `faitofuraito_normal`。新規登録・公開フラグ変更なし。|
|2 ルール/既存記録|既存の採点、score decimals=0、難易度・モード、slug、開始/終了/送信契約は保持。ローカライズは表示値のみ。ランキングparticipantは現行DBの表示名キーのままで、記録を推測で統合・付替えない。|
|3 正式URL/移行|既存GitHub Pages URLを維持し、ホーム/結果/X文の正式URLを合わせる。別origin移行を今回行わず、ローカル保存の別origin間共有を主張しない。|
|4 多言語|15言語（ja/en/es/pt-BR/zh-Hans/fr/de/ko/ru/it/zh-Hant/id/tr/vi/th）のUI、共有文、動的表示、通信/入力エラーを実装。表示言語の選択を保存し、autoは保存設定優先→browser language→対応外はen。scoreは0桁のままlocale groupingだけ変更。14 localeの300 source keysを機械検証済み。母語話者確認は未実施。`Backquote`の「半角」と`IntlRo`の「ろ / \\」はJIS物理キー表記として扱う（[`docs/i18n/source-catalog.json`](i18n/source-catalog.json) `ff.ui.175/.176`）。|
|5 名前/送信|ホーム任意名、公開の説明、IME 229保護を維持し、各runに開始時の名前/参加有無/IDを固定。匿名プレイは既存guest start countのみでスコアを公開しない。pending記録を再送し、今回の実装修正はUUID衝突を避け、同IDの異なるimmutable payloadをmerge・再送しない。個人を端末間で安定して識別するparticipant契約は未完了。|
|6 ランキング|ホーム/結果の詳細リンクは選択modeを保持し、結果画面の上位30サーバー行、読み込み中/空/失敗/再試行、古い応答guardを維持。DB集計は名前単位の既存仕様で、同名別人を分離できないため厳密な「上位30人」の達成は未完了。正常RPC receipt検証とserver rank/同点を保ち、HTTP 200不正応答を空ランキングや名無し0件扱いにしない。|
|7 X共有|ホーム紹介と今回結果を分離し、黒/白ボタン、言語別文面、正式URL、手動投稿、popup阻止時の本文選択/コピー代替を提供。native Share/clipboardは成功時だけ成功を表示。投稿確定は利用者のみ。|
|8 効果音|既存のshot/hit/kill/damage/loop/playerExplosion/aircraft-pass/propellerを維持。既存実装の優先度・voice cap・重複抑制・後片付けを確認。新規ゲームイベントは作らず、音だけで判定/得点は変わらない。実音は未確認。|
|9 音設定|未設定の初回on/volume=1、保存済off/0の区別と再読込を維持し、3画面の表示/切替を翻訳。ブラウザ操作によるaudio unlockはbest-effortで、開始要件にはしない。実機復帰/音質/音量の聴感は未確認。|
|10 文言/画面|選択名、フォーム、ゲーム内HUD、pause/results/ranking/settings/ARIA、空/エラー/通信中、共有を15言語へ。ホーム/一時停止/結果から言語を変更可能。表示言語変更でrun snapshot/score/time/入力名/pending queue/ranking送信を変えない回帰を追加。実機レイアウトは未確認。|
|11 継続公開|既存workflowはPRではverifyだけ、mainの現行SHAを確認して検証済みartifactのみdeployする構成。Pages Source等の外部Settingsは変更していない。GitHub Pagesの実設定・Environment/Secretsは未読取の部分を「確認済み」としない。PR checkを本番公開済みと扱わない。|
|12 検証|下記のローカル/固定翻訳検査と独立reviewを実施中。lockfile依存なしのため完全な `npm test`, build, browser CIは未実行扱い。実CIはPR headのchecks完了後に記録する。母語・実音・iPhone/Safari・マージ後公開は未確認。|
|13 PR/作業記録|既存のDraft PR #24で作業。マージ、公開branch直接push、Pages/DB設定変更は行わない。レビュー/CI完了後に同じPRへ追加する。|

### 破損した端末内ランキングpendingの扱い

有効なJSON配列内に壊れた項目が混じる場合、最初に元の配列文字列を専用の `faitofuraito.ranking-pending-quarantine.v1` へ追記コピーする。元項目は消去・移動しない。壊れた項目だけ送信対象外とし、正常な兄弟項目は処理できる。コピーに失敗したときは送信を止め、成功表示しない。JSON全体が破損していて配列を安全に区分できないときは元値を変更せず、全体を保留する。同一ID・異なるimmutable payloadは衝突として拒否する。

## 初期対応表（変更前）

**時点注記:** 以下の既存対応表・検証ログ・公開手順メモは、Draft PR #24着手前に書かれた初期記録であり、今回の多言語/queue UI変更後の現況ではない。行ごとの旧状態や177件という旧検証数は履歴として残す。現在の対応状況と今回実績は、上の「共通仕様13項目の対応」と下の「今回の検証」による。GitHub Pages `Source`について、旧メモのlegacy記述は現在の設定の読み戻し証拠ではなく、現設定は未確認。

| 共通仕様 | 状態 | 根拠・残り |
|---|---|---|
|1 対象判定|既存確認済み|現行登録行と公開HTMLを別々に確認。|
|2 既存仕様/記録|既存で維持|採点・時間・難易度・ゲームslug・保存済みデータを初期化しない。|
|3 正式URL/移行|既存URL維持|登録されたGitHub Pagesを正式URLとして使用。Codeberg側の新規公開/切替なし。別origin保存の移行完了は主張しない。|
|4 多言語|未完了|未完了: 日本語UIの15言語翻訳・言語選択。|
|5 名前/送信|今回実装/既存維持・一部未完了|既存任意名・凍結したplayハンドル・再送処理を維持。公開説明/保存名変更を修正。|
|6 ランキング|今回実装/既存維持・本人同一性未完了|既存でモード別サーバー集計30件。詳細URLのdifficultyを維持。|
|7 X共有|今回実装|ホーム紹介と今回結果を分離。X投稿確定は利用者。黒/白、コピーまたは選択可能な代替。未翻訳言語は§4。|
|8 効果音|既存確認/今回補修|下記イベント表。実際の聞こえ方は未確認。|
|9 音初期/保存|既存維持/今回実装|初回on、既存offと0尊重。実機復帰/音質は未確認。|
|10 文言/UI|今回実装・一部未確認|公開説明、共有/ランキングラベルと操作サイズ。iPhone17 Pro実機は未確認。|
|11 継続公開|今回実装・本番未確認|PRは検証のみ。保護を維持し、公開ブランチの検証済み成果物のみ公開。下記設定手順。|
|12 検証|今回実施・一部未完了|下記ログ要約。母語話者・実音・実機・マージ後公開は未実施。|
|13 PR/記録|今回作成|ゲーム別Draft PR。未完了を対象外に分類しない。|

### 着手時の実装メモ（旧版）

ホームにもX共有を追加し、結果のX投稿画面/コピー代替と正式URLを統一。名前公開の説明、ランキングリンク名、IMEのEnter抑止、保存名の即時保存を追加。既存効果音のオンオフ/音量を保存し再利用。既存検証workflowからマージ後の公開を接続。この記録は着手時の概要であり、状態の詳細・制約は上の最新表と後段の今回検証に従う。

## 記録とランキング契約

```json
[
  {
    "game_slug": "faitofuraito_easy",
    "title": "ファイトフライト（イージー）",
    "game_url": "https://chameleonjp-lab.github.io/faitofuraito/",
    "is_active": true,
    "release_date": "2026-09-29",
    "score_order": "desc",
    "score_scale": 1,
    "score_decimals": 0,
    "score_unit": "点",
    "top_ranking_type": "best",
    "submission_mode": "shared"
  },
  {
    "game_slug": "faitofuraito_normal",
    "title": "ファイトフライト（ノーマル）",
    "game_url": "https://chameleonjp-lab.github.io/faitofuraito/",
    "is_active": true,
    "release_date": "2026-09-29",
    "score_order": "desc",
    "score_scale": 1,
    "score_decimals": 0,
    "score_unit": "点",
    "top_ranking_type": "best",
    "submission_mode": "shared"
  }
]
```

サーバーの既存参加者は表示名で識別される。このままでは同名の別人を区別できず、改名で同じ参加者を保つことも保証できない。今回データを削除/再構築したり、全記録を新しい参加者へ割り当て直したりしない。別途、安定したparticipant IDと旧記録の所有確認/移行方式が必要。上位30名の厳密な「本人単位」の達成はこの制約が残る。API集計と詳細ランキングの既存名前単位集計は一致させる。表示名や上位一覧から圏外順位/全人数を推測しない。

## 効果音対応表

| 対象イベント/役割 | 条件・重複防止・箇所 |
|---|---|
|実在するゲームイベント|src/audio.ts のshot/hit/kill/damage/loop/playerExplosion/aircraft-passとプロペラ音を維持。最大10 effect sources、優先順位、連打抑制は既存。今回audio-preferences.tsで既存音量比を維持するvolume=1、off/0保存とスライダーを追加。|
|無音時|視覚の判定・得点・状態表示を維持。音成功を開始条件にしない。|
|実音検証|自動テストは発音呼出/ノード/保存値を確認する範囲。スピーカーでの音量/音質・iPhone復帰は未確認。|

## 変更前の検証ログ（初期記録・今回PRの合格実績ではない）

Draft PR #24着手前の記録: node unit177件、TypeScript/build成功。共有文・コピー・音の保存設定を追加確認。着手前のブラウザ記録ではローカル/mockを使用し、iPhone17 Pro実機Safari、実音/OS共有画面、全言語の母語話者確認、マージ後公開は未実施。これは今回の変更後sourceに対するCI/Playwright実績ではない。

本番ランキングへ試験スコアを書いていない。ブラウザ検証はmock/ローカルページを使用し、幅変更・WebKitを実機Safari確認と混同しない。

## 今回の検証（ローカル実施分・CI前）

公開カタログは [`docs/i18n/source-catalog.json`](i18n/source-catalog.json)（300 keys / 285 translatable phrases、SHA-256 `a338c487c6fb969e0ecea99b63bc81492d29a3b180d2275c650542a1aac3af36`）。locale JSONは [`docs/i18n/locales/`](i18n/locales/)に置き、[`docs/i18n/verification-receipt.json`](i18n/verification-receipt.json)にsource/runtime/各localeの相対path、件数、SHA-256、機械検査範囲と未確認を記録。14 locale × 300 entriesの値/非空/placeholder/数値/tag/改行/日本語残存を機械検査PASS。JIS key legendsは意図的な物理表記として扱う。

利用可能な検査では対象unit test 33/33 PASS（TS5.9.3 transpile loader、うち効果音/音保存8件）、source/locale JSONの14言語検査PASS、23 changed/new TypeScript filesの構文transpile PASS、locale assetの相対path/全300 key/全SHA check PASS、`git diff --check` PASS。これらは`npm test`/完全なtypecheck/buildを代替しない。現在のworkspaceにlockfileに合う`node_modules`がなく、installを迂回しない方針のため、公式npm script全件、Vite build、Playwrightは未実行。ranking unit suiteもsimulation依存のlocked three未導入でローカル未実行。SolHigh独立reviewではv1/v2のdynamic key errors、locale切替でname-error stale、docs時点矛盾を修正確認し、v4候補42ファイルの追加blockerなしと報告。このreviewは完全なCI・ranking unit suite・実機を通した確認ではない。

音テストはWebAudio呼出し/優先度/cleanupと設定保存値を確認する範囲で、実スピーカーの音量/音質/復帰を確認しない。言語切替ブラウザ回帰はCIに追加済み。Playwrightの実行結果はCI後に追記する。

本番ランキングへ試験スコアを書いていない。未実施の全言語自然さ、iPhone17 Pro Safariの縦横/ソフトキーボード/ブラウザバー/画面ロック復帰、実音、マージ後の公開確認は残る。

## 適用順・公開後確認・切戻し（初期メモ、現Pages設定は未確認）

**外部設定は未変更・未確認扱い**: Pages → Build and deployment → Source、および`github-pages` environmentの現行値は本作業では書き換えていない。公開先を切替える必要がある場合は、本人がPRマージ前にSource=`GitHub Actions`、必要なPages設定/Environmentを確認する。PR checksはdeploy jobに入らない。マージ後はmainでverify成功・現main SHAとの一致・artifactのSHAを確認してから公開し、旧branchの実行による二重/遅延配備がないか確認する。設定変更をこの作業で実施したとは報告しない。

1. PR差分とCIを確認し、ユーザーが `main` へマージする。直接push/自動マージはしない。
2. マージコミットの検証/ビルド/公開が成功したことと、公開URLの共有ラベル・ランキング詳細導線・今回の変更を確認する。PR段階の成功を本番公開済みとは扱わない。
3. iPhoneで名前空欄→開始→結果→ランキング、名前変更後の次プレイ、Xをキャンセルして復帰、音オフ/0→再読み込み、縦横とキーボード表示を短く確認する。実データへの多数の試験登録は避ける。
4. 問題があればこのPRをrevertする新PRを作成し通常の検証/マージで戻す。DB行/設定/自己ベストを消さない。Pages設定を変更した場合は元の `legacy` / `gh-pages` 設定と既存公開artifactを記録して戻す。元の実行が新しい公開を後から上書きしないよう、古い実行を再実行しない。

現時点: **コード対応のうち実装可能な項目は実装/確認、participant identity（端末内か複数端末かの本人確認とDB契約）・完全なCI・母語/実音/実機・Pages実設定・本番公開は未完了。Draft PR #24のSolHigh review/PR CIと本人のマージ待ち。共通仕様全体を完了とは報告しない。**
