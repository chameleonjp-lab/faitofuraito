# ファイトフライト 作業入口

対象は `chameleonjp-lab/faitofuraito`。作品名は「ファイトフライト」。

1. `docs/SPEC.md`、`docs/VERIFICATION.md` で仕様と現在の検査状態を照合する。
2. `docs/HARNESS.md` の固定コミットから共通ハーネスを取得し、AGENTS → core → registry → 今回必要な規約だけを読む。
3. 本体ロジック `src/simulation.ts` と描画 `src/scene.ts`、入力・画面を区別する。描画乱数で得点や敵行動を変えない。
4. `npm test` と `npm run build`、変更に関係する画面操作を検査する。模擬端末をiPhone実機と呼ばない。
5. 作業ブランチへの提出とDraft PRまで進める。mainへの直接push・マージ・自動マージ、公開設定の変更は行わない。

ユーザー提供の担当分担：企画と設計・判断支援はSol High、日常実装と複雑検査・反復確認はLuna Max、原因不明・安全性・重大判断はSol Extra High、公開前独立レビューはSol High。利用可能な担当へ実際に依頼した場合だけ独立レビューと記録する。最終判断者はユーザー本人。
