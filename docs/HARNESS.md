# 採用ハーネス

- 対象：`chameleonjp-lab/faitofuraito` / ファイトフライト
- 参照元：`chameleonjp-lab/chameleonjp-browser-game-harness`
- 取得版：`2accbc6f062c6b7932777c61051df56a02302339`
- 読取日：2026-09-28
- 基点：ゲーム側 `main` = `922df38d09ffe6a99f7aed587774326af7968e65`（READMEのみ）

AGENTS → core.contract / core.execution → adapter.work → registry の条件を確認した。新規Three.jsゲーム、入力、機体、材質、照明、環境、動き、音、カメラ、物理、敵行動、停止復帰、検査、提出を対象に選択した。

読んだ規約：domain.code / domain.gameplay / domain.ui-input / visual.foundation / visual.shape / visual.surface-light / visual.motion-environment / visual.camera / engine.threejs / domain.audio / domain.performance / domain.security / domain.assets / domain.physics / domain.enemy-ai / domain.lifecycle / domain.testing / workflow.delivery。確定情報の新設には governance/PROJECT_STATE.md、書込前には references/work/write-preflight.md を使用。

初回作成では順位送信、Supabase、他作品の規約・データを対象外とした（今回の連携追加は末尾を参照）。利用者の明示した実機確認用の公開依頼には workflow.release を追加適用する。規約本文を作品へ大量複製せず、この固定版の関連ファイルを必要時に取得する。

## 品質の観察条件

通常の後方斜め上カメラで、丸い翼端・細い胴体・黒いカウル・風防・尾翼・日の丸を判別できること。金属色一色の平面模型にせず、塗装面の粗さ、風防の反射、継ぎ目の差を確認する。空は遠景から手前まで連続し、宙返り・旋回時にも機体の接続と視点が破綻しないこと。射撃中でも機体・敵・照準・残弾・操作ボタンが読めること。

画像の保存と内容の確認、検査環境の寸法とiPhone実機、機能の成功と「超リアル」という体験目標は区別する。画質の最終採用はユーザー本人の判断であり、初回の表示だけで承認済みとは扱わない。

## 操作・損傷改修の対象

2026-09-28の改修基点は `main` = `6feac27a6a4a4c5e1a536745fd7b19908493f195`。採用ハーネスの固定版は維持。U02b・U03b・U07b・U09b・U10〜U15を追加／置換し、入力・状態・敵AI・物理・描写・停止復帰・検査・提出・公開を照合する。ソースは作業ブランチ/Draft PR、実機確認用成果物は既存gh-pagesへ反映する。

## 旧段階：モード・飛行・共有改修（2026-09-29、PR #3）

基点 `main` = `536f26f48d477df9e68cda87a639ba866d10f5da`。固定ハーネス版を維持し、今回のモード・飛行・共有変更では gameplay / ui-input / audio / testing / lifecycle / persistence / security / sharing / physics / enemy-ai / assets / camera / threejs / delivery を照合。操作設定はモード別、結果は確定値、共有の非同期応答は結果世代を照合する。実験場は結果からのリンクのみで、集計・順位送信は追加しない。提出は作業ブランチとDraft PR。


## 2026-09-29 名前任意・ランキング追加

同じ固定版を使用。今回確認した規約はcore.contract / core.execution / adapter.work / domain.code / domain.gameplay / domain.ui-input / domain.audio / domain.security / domain.ranking / domain.network / adapter.supabase / domain.lifecycle / domain.testing / workflow.delivery。作品仕様の更新にはPROJECT_STATE、GitHub提出直前にはwrite-preflightを照合する。

共通の名前必須・上位10件は、今回の利用者による名前任意・上位30位指定で、この作品に限って置き換わる。名前なしのプレイを違反者と同一視せず、順位対象外として回数を保存する。別作品の匿名参加や得点・集計方式は変更しない。

添付の担当表に従いLuna Maxへ音・本体・通信の実装と画面検査を分担、SupabaseはSol Extra High、独立レビューはSol Highに依頼。主担当が仕様判断・統合・提出を担当する。

## PR #5の競合解消と自機効果音

固定版を維持し、domain.audio / domain.testing / domain.lifecycle / workflow.deliveryを適用する。マージ済み#4を競合解消の基準とし、音の変更を飛行・ランキング・公開DBへ広げない。音色は合成による仮調整。実ブラウザの出力検査と実機で聴く品質確認を区別する。

## 2026-10-01 操作・視認距離・接触改修

基点 `8d57747e1ef45e4a805a72f8e5d40dbcef76a06b`、採用版 `2accbc6f062c6b7932777c61051df56a02302339` を維持。先に取得した最新版は採用版へ切り替えず、固定版のAGENTS / core.contract / core.execution / registry / adapter.workを改めて照合した。今回の実物に合わせてcode / gameplay / ui-input / visual.foundation / motion-environment / camera / threejs / physics / lifecycle / testing / deliveryを読む。確定事項にはPROJECT_STATE、提出にはwrite-preflightを使用。

調査・実装・自己点検を主担当が実行。別担当を起動していないため、独立レビュー済みとは記録しない。ローカルの描画と画面検査はChromium 153 / SwiftShaderで実行し、外向き通信を模擬応答に置き換える。GitHubへの提出は作業ブランチとDraft PRに限る。
