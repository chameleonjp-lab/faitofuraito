# ファイトフライト：手動操縦・正面射線・補間描画の検証

2026-11-07日本時間（実行環境2026-11-06 UTC）。対象は[8作品の修正計画](https://github.com/chameleonjp-lab/zero-series/pull/13)。カイセンK1〜K3の先行回帰14件が担当者と取りまとめ担当の再実行で合格した後に本作へ適用した。mainへのpush、マージ、公開設定、ランキングや保存先の変更は実施していない。

## 開始版と実際の公開ファイル

- 開発開始版：`069e3e65e46bae95144ce11fb41de7487435e4e9`。clone直後のmainとorigin/mainが一致、未保存変更なし。
- 公開URL：https://chameleonjp-lab.github.io/faitofuraito/ 。開始時deployment.jsonは404。旧公開記録のソース`85e79c13612c06d301b0d7e9ed39e8ad2cb0c86b`を別ディレクトリで同じlockfile・Vite設定から再ビルドし、下記3ファイルの全バイト一致を確認した。

| 配信ファイル | SHA256 |
| --- | --- |
| index.html | `1c23de11c6d6a7f510a7eafd85a3185b35035f95464389e9af3891c943ab7fce` |
| assets/index-C5l2eOOg.js | `9940004269ff5f31af94a380bf7d7fae8da53a954bb4b9ec6c3fca7690e439a9` |
| assets/index-CfcgTNfg.css | `94428227347712c1269c74b07de397632fa2368e76b324bdedbe1edbeea1eef0` |

開始版のmainビルドJSは`a018578812808cc889680ac8f11f507468f1f86f0458e2e78c6d72a442e72baa`で公開JSと異なる。現在のActionsはmain検査後にPages artifactを配信する構成だが、この調査は公開済みファイルの読み取りだけである。

## 再現と変更

固定seed73、高度1500、60Hz、0.2秒、1敵。カメラ基準の右105・前方500と背後500を比較。角度・位置の許容差は計画の0.001度・0.001距離単位を使用。

| 観測 | 修正前 | 修正後の検査 |
| --- | --- | --- |
| 敵配置変更・Easy無操作 | 視線差2.546666度 | 同じ入力で自機・カメラの位置と向きが一致 |
| 両モードで右入力0.2 | 視線差約0.509170度、画面外倍率1.65 | 両モード倍率1、上下左右と斜めの経路が一致 |
| 約20度上向きで中央を0.2秒保持 | 両モード9.386182度戻る | 保持中は0、解放後は既存の上限内で水平へ戻る |
| 120Hz相当・上昇0.45・先頭12表示を除く48表示 | 両モード24/48の視線が同じ | 両モード0/48、補間結果は確定した飛行状態を変更しない |
| Easy左右MG/機関砲の初速方向 | 正面から約0.632〜0.804度ずれる | 4銃口すべて発射時の機首正面に一致 |
| 402×874→402×820・同じ指の移動 | pointer1を失い旋回量0へ | 所有者と操作量を保持、次の座標変化を合わせて継続 |

自機の飛行処理は毎回補正履歴を消して生入力だけを使う。Easyの暫定自動発射は最新姿勢・実画面比の円内、1.2km以内、生存する敵の条件だけで判断し、銃口方向には渡さない。Normalはボタン保持中だけ射撃する。敵機の従来の射撃予測・散布、巡航、速度による旋回、宙返り、弾数・再装填、得点と保存は維持した。

表示用FlightPresentationは飛行計算直前の位置・姿勢を独立コピーし、自機・敵・銃弾・照準表示を同じ割合で描く。時計・命中・発射は元の確定状態を使う。出撃し直し、停止・再開では古い補間を引き継がない。height-only resizeでは初回の移動座標を保持していた操作量へ合わせ、回転・離脱・停止では従来どおり入力を解放する。

## 実行済みと未確認

- RED：新規manual-flight-contract7件中6件（Normal正面弾の1件は変更前から合格）、input-viewport-continuity1件、flight-presentation3件が、変更前に敵依存の倍率、保持中の水平復帰、斜めの初速、古い発射lock、resizeでpointerが消える条件、補間未実装で失敗することを確認。
- GREEN：同じ11件がすべて合格。旧追尾・1.65・自機射線補正・resize全解除を期待していた検査を現行条件へ更新。NPC射撃、速度と旋回の感度、reload、得点などの検査は維持。
- `npm test`：初回209件、独立レビュー後の検証追加を含む最終216件合格、失敗0（network-enabled実行、実際の子検査を含む）。`npm run build`：成功、既存の500kB超チャンク警告のみ。`git diff --check`：成功。
- ブラウザはChromium/WebKitの模擬端末。最初の4177競合は検査開始前に停止。取りまとめ側の全55件実行は26合格、3timeout、1中断、1既存skip、24未実行で終了したため全件成功とは扱わない。元の結果を保存し、下のCI切り分けと修正を行った。
- 修正版のカメラ検査は既定60秒・retry0で両モードのmotion/viewportとpause/replay/mode-reset計4件が合格（43.2/34.4/56.5/33.4秒）。全pose/input/停止/再出撃assertionを維持し、reset側も実際の出撃と非ゼロの位置・姿勢履歴から始める。Easyの操縦・実弾撃墜・停止中の墜落機・期限切れ・再出撃は、下記のcontrolled-clock検査で44.1秒以内に合格。正式な全件CIはこの候補の提出後に確認する。
- CI所定の`node scripts/capture-throttle-comparison.mjs /tmp/faito-throttle-baseline`は成功。固定版`c2b313d37875b93458032d98636fcf5b5d30a138`を別checkoutとし、package/lockfileが同一であることを確認して同じ固定依存を使用。393×852と852×393で通常出撃から正確に12tickまで進め、元の敵・自機・弾数・得点・時計・速度などが完全一致し、現行の開始敵2機の追加分だけが異なる。候補の縦横の論理状態も完全一致。保存した4枚の画像の内容も確認した（旧UIと現行UIの画素一致を意味しない）。
- 候補buildのJSは`assets/index-Bk2Nwb68.js`、SHA256 `604a4c4a46346f590225f73b5ca8394e389a83e2abd6d4b1d04ae0e5b6fb473b`。CSSは着手時と同じ照合値。ワークフロー、依存、検査の既定制限時間、retry設定は変更していない。

- 独立差分レビュー：実装`a67e32fa39499d022e1a3075c79e9a3884858667`に具体的なコード不具合の指摘0件。レビューで不足とされた表示頻度別の戦闘一致・照準色の境界検査を、実装を変えずに追加した。
- 追加検査：[presentation-combat-contract.test.ts](../tests/presentation-combat-contract.test.ts)。両モードでseed73、2敵（先頭1機はHP1）、tick単位の同一入力を使い、30/60/120Hzの表示で180回の固定計算を再生。各tickのGameState全フィールド（自機・敵の姿勢、全弾、イベント、墜落機、時計、命中・撃墜・得点・終了状態）を表示なしの基準列と完全比較した。capture前後、sampleとカメラ/マーカー/色計算前後の原本不変も毎回検査した。実際に発射した弾でEasyは26発・1命中・1撃墜・1976点、Normalは48発・3命中・1撃墜・1957点となり、開始済み低高度警告の実カウントダウンによる2秒時点の終了も一致した。
- 表示色追加検査：実際のThree.js PerspectiveCameraによる標的位置の投影とマーカー位置を比較。円の出入り・別IDへの交代それぞれでalpha0/.5/1の色を両モードで確認し、古い対象の色や姿勢を継承しない。元のpresentation3件と合わせ9/9合格。追加6件は既存の正しい動作の証拠を補う検査で、production sourceは変更していない（src tree `4a4c1a4e8eed2b32dba8dd239550b53a816bf8ba`）。


## 初回CIの失敗と追補

初回[Actions42275554856](https://github.com/chameleonjp-lab/faitofuraito/actions/runs/42275554856)は提出版`b9aa1eb5119219e34b2a14e41de1127b36383913`（レビュー版a67e32fと同一tree）で単体・buildが3jobとも成功、WebKit jobも成功した。Chromium1は19合格/1timeout、Chromium2は16合格/1timeout。throttle比較は先行失敗によってskipされており、比較assertionの失敗ではない。

- Easyはpilot開始前のelapsed>.1待ちで停止。実際のartifactには「画面の更新が止まったため一時停止しました」のoverlay、286/94発の残弾があり、既存のRAF gap>1秒による安全停止を確認。別の実時間実行ではpilot途中にも同じ停止が再現したため、途中の自動復帰で隠していない。
- Normal cameraは60秒の総予算超過をfinallyのclosed-page cleanupが覆っていた。元のerrorを維持しstageを記録した再現では、すべてのinput・5viewportのpose確認後のpause/quit/replay中に総予算が尽きた。独立したmotion/viewportとresetの2契約へ分け、すべてのassertionと60秒の上限を維持した。
- Easyのpilot/death/replayはフレーム性能の検査ではないため、合意したcontrolled page.clockへ変更。100ms以下ずつ本物のframeと固定計算を進め、各stepで実WebGL2 contextの`finish()`を待つ。入力は実pointer、撃墜と結果は実弾の計算から得る。world・health・resultを書き換えず、安全停止の条件も変えない。実際の長いRAF gapを検査する専用pause-recovery suiteは変更していない。既知のstartup slow-pauseをUIから最大1回だけ再開する処理もsetupに限定し、pilot途中のpauseは失敗のままにする。
- clock変更後はpauseなしで進むことを確認したが、旧test pilotが絶対pitchをmanual pitch-rateへ渡しており長く狙いを外すことが分かった。整列済みの標的へ機首が動くREDを実飛行controllerで再現し、test helperだけを現在pitchとの差へ修正してGREENにした。条件を緩めず、実弾撃墜・停止・墜落機の経過・再出撃のassertionを保持した。
- 他作品のreviewで見つかった402×430→402×390の高さ変更も追加再現した（RED pointer1→null）。幅が不変なら縦横の見かけが変わっても入力を維持し、真のorientationchange eventと幅変更は従来どおり解除する。mainのresizeは描画のみで入力解除を行わない。所有権・throttle関連14件はGREEN。

初回の失敗ログ、チェックサムを照合したartifact、旧60秒の失敗、修正後のfocused結果をそれぞれ保存している。現在の正式CI状態は[Draft PR29のChecks](https://github.com/chameleonjp-lab/faitofuraito/pull/29/checks)と提出原票に対象SHAごとに記録する。今回のclock検査から実機の表示間隔の改善を推定しない。

- 実機iPhone17Pro/Safariで両モード・縦横・短い縦画面の操作と表示間隔中央値/p95は未確認。GPU描画間隔の改善原因はこの数値検査から断定しない。本人のマージ後の公開バイト再照合、初回起動と古いタブの再読込も未実施。

ローカル証拠：`/workspace/scratch/faito-p0.{ts,json}`、`faito-r1-red-detail.log`、`faito-input-red-detail.log`、`faito-presentation-red.log`、対応するgreenログ、`faito-r1-tests-third.log`、`faito-r1-build.log`、`faito-review-gap-focused.log`、`faito-review-gap-full.log`、`faito-ci-first-diagnosis.md`、`faito-ci-split-focused.log`、`faito-pilot-rate-{red,green}.log`、`faito-ci-easy-rate-focused.log`、`faito-ci-fix-{units,build,throttle-comparison}.log`。候補はローカル作業ブランチ`fix/manual-camera-aim-20261107`のレビュー対象コミット。実装差分とこの未確認事項を含む文書を同時にコミットして取りまとめへ渡す。公開後の全件完了を意味しない。
