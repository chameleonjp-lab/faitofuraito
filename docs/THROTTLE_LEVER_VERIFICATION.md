# 速度レバー変更・検査記録（2026-10-05）

対象 `faitofuraito`。起点main `c2b313d37875b93458032d98636fcf5b5d30a138`。利用者の「全ての戦闘機の加速・減速を上下レバーへ変更、UIと設定を同仕様で個別PR」の指示に基づく限定変更。共通仕様は [THROTTLE_LEVER_CONTRACT.md](THROTTLE_LEVER_CONTRACT.md)。

## 採用差分と維持境界

Normalのタッチ加速・減速2ボタンを速度レバー1本へ置換。上は連続加速指令、下は連続減速指令、中央と指を離した後は目標速度保持。幅64px・高さ128pxを既定とし、横画面では既存表示寸法規則と長方形safe-area境界へ合わせる。射撃・宙返りの位置は維持し、旧ボタン中点で重なる場合はレバーだけ安全位置へ退避する。空きがなければ設定に警告して保存を拒否し、実画面はレバーのみ無効化する。

Easyの巡航、操作制限、射撃・宙返り、機体・カメラ・音・敵・得点・ランキングは変更しない。既存加速／減速キーは9操作の設定を保ち、±1の同じ指令へ接続。18 m/s毎秒・65〜141m/s、既存の速度追従式を保持。FFの実行経路はsimulation.tsのstepGameもadvanceThrottleへ接続した。

v2保存キー `faitofuraito-controls-v2` / `faitofuraito-controls-easy-v2` は明示保存時のみ使用。旧v1 rawは読み取り専用で変更・削除しない。キーバインドの既存v1形式は維持。保存前の最大64KiBの復元控えは `faitofuraito-controls-recovery-v1`、対象は2モードとキーボードの3キーだけ。途中失敗／復元失敗でも旧rawを読み戻せる状態を保持し、未来版や別の書込みを上書きしない。独占ロックによる複数タブ同時更新保証ではない。

## 検査

- ローカル単体：134件成功（2026-10-05、失敗/skipなし、最終候補）
- 型・production build：成功。既存と同様の500kB chunk警告あり
- 共通fixture、FF/Geki実際の速度更新、死域・非有限・legacy fallback・明示0・Easy、目標保持と上限下限、pointer所有と解除、focused短押しの1tick消費、キー混在、移行と復元失敗を検査
- ブラウザー：ローカルChromiumはOS socket EPERM、許可付き再試行も同結果。cloud browserはlocalhostをERR_BLOCKED_BY_CLIENT。アクセス境界を迂回せず、Draft PRのCIでChromium／WebKitを実行する
- 新規browser specは縦320×568/393×852・横568×320/852×393、200%文字、設定保存/取消/再読込、未来形式、実際のinputクラスのpointer/keyboard、Chromium製品飛行を対象。WebKitはDOM/入力/設定の検査でありWebGL実機性能ではない
- baseline/candidate画像はCIの固定base checkoutと同じviewport・Normal開始・中立入力・clock fixture +200msで取得。スクリーンショットを保存しただけで視覚確認済みとはしない
- 実iPhone/Safariの操作感・touch assistive technology・GPU性能・人間の試遊は未実施

同一性と変更しないファイルは [throttle-lever-parity.json](throttle-lever-parity.json)。提出前に最新mainと進行PRを再照合する。独立レビューと最終head CIの確定結果はPRへ記録する。mainへの直接push・merge・auto-merge・配備・公開・外部ランキング設定変更は行わない。

## 最終独立レビューと修正

独立担当が実装差分をレビューし、保存readback不足、フォーカスを離した後のPC速度キー所有、CSS zoom時のレール端点、HUD utility重なり保護を指摘。4作の共通adapterへ修正し、silent write/rollback/cleanup・別書込・focusout/Escape・zoom端点の8回帰を追加しました。単体と型/buildは上記件数で成功。pure coreとfixtureは既存共通契約と同じhashです。

比較scriptは開始完了と進行中Normalを確認し、同じ制御時計で取得した変更前後の状態をassertします。画像生成・画像目視・ブラウザ合格は、最終headのCIとartifact確認後にPRへ記録します。現時点は未実行で、単体成功で代用していません。保存は排他ロックではなく、読戻し・競合検知・復元記録の範囲を保証します。

## CIで検出した設定ズーム不具合への対応

センリョウの実Chromium/WebKitで200%CSS zoom時に設定の保存ボタンが画面外になることを検出。同じ4作共通のviewport値を、拡大後の画面ピクセルからlayout CSS pxへ幅・高さとも変換し、rootの寸法変化にも追随する修正を追加しました。全4作へ同じhelperと倍率.5/1/2の回帰を適用。実browser gateは保存ボタン全体の可視と左右境界を確認します。

この実行関連候補の全単体は135/135、型/build成功。browser一覧は成功ですが本実行は最終headのCIを別判定します。中間CIの失敗は隠さず、PRに新headの結果を記録します。画像artifactは生成/保存と目視を区別し、現時点の取得・目視は未確認です。

FFの次CIではレバーとpauseが非重複のまま、拡大された宙返りラベルがボタン外へ張り出してpause中心の入力を取得することを座標ログから特定。文字サイズと既存配置を保ち、装飾子のpointer-eventsを無効化してボタン本体を入力域の正本にしました。設定の拡大・多指解除・utility中心の検査は維持します。
