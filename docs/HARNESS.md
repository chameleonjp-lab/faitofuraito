# 採用ハーネス

- 対象：`chameleonjp-lab/faitofuraito` / ファイトフライト
- 参照元：`chameleonjp-lab/chameleonjp-browser-game-harness`
- 取得版：`2accbc6f062c6b7932777c61051df56a02302339`
- 読取日：2026-09-28
- 基点：ゲーム側 `main` = `922df38d09ffe6a99f7aed587774326af7968e65`（READMEのみ）

AGENTS → core.contract / core.execution → adapter.work → registry の条件を確認した。新規Three.jsゲーム、入力、機体、材質、照明、環境、動き、音、カメラ、物理、敵行動、停止復帰、検査、提出を対象に選択した。

読んだ規約：domain.code / domain.gameplay / domain.ui-input / visual.foundation / visual.shape / visual.surface-light / visual.motion-environment / visual.camera / engine.threejs / domain.audio / domain.performance / domain.security / domain.assets / domain.physics / domain.enemy-ai / domain.lifecycle / domain.testing / workflow.delivery。確定情報の新設には governance/PROJECT_STATE.md、書込前には references/work/write-preflight.md を使用。

順位送信、Supabase、本番公開、他作品の規約・データは今回の対象外。規約本文を作品へ大量複製せず、この固定版の関連ファイルを必要時に取得する。

## 品質の観察条件

通常の後方斜め上カメラで、丸い翼端・細い胴体・黒いカウル・風防・尾翼・日の丸を判別できること。金属色一色の平面模型にせず、塗装面の粗さ、風防の反射、継ぎ目の差を確認する。空は遠景から手前まで連続し、宙返り・旋回時にも機体の接続と視点が破綻しないこと。射撃中でも機体・敵・照準・残弾・操作ボタンが読めること。

画像の保存と内容の確認、検査環境の寸法とiPhone実機、機能の成功と「超リアル」という体験目標は区別する。画質の最終採用はユーザー本人の判断であり、初回の表示だけで承認済みとは扱わない。
