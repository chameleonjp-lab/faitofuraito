# 零戦の資料と再現範囲

調査日：2026-09-28。対象はA6M2を基にした零戦二一型のゲーム表現。写真・資料は参考用途のみで、画像や音声をゲーム素材へ転用しない。

| 項目 | 根拠 | 今回の扱い |
| --- | --- | --- |
| 機首7.7mm機銃2挺、主翼20mm機関砲2門 | 米海軍航空博物館、米空軍博物館 | 銃口配置、異なる発射周期と残弾を実装 |
| 7.7mm各500発、20mm各約60発 | 1942年8月13日米陸軍省検分報告の復刻 | 合計1,000発＋120発を双方に付与 |
| 翼幅約12m、全長約9.06m | 米海軍航空博物館A6M2寸法、豪州航空博物館ネットワークA6M2展示資料 | モデルの大きな比率へ採用。豪州展示機は11型であるため21型の個体測定値とは称さない |
| 軽量、低速で優れた機動性、高速で重くなる操縦 | 博物館解説、1942年10月23日捕獲機飛行試験 | 旋回・上昇時の速度損失と高速操縦減衰の設計根拠。厳密な係数は再現しない |
| 丸い翼端、翼の上反角、三翅プロペラ、枠付き風防、翼端折りたたみ | 1942年検分記録、豪州戦争記念館の21型資料 | 飛行状態の形状を生成。折りたたみ・脚の離着陸操作は対象外 |
| 防弾・燃料防護の不足 | 米空軍博物館 | 損傷しやすい機体という方向。燃料発火、部位別損傷の厳密解析は行わない |
| 零戦固有の定型的な宙返り | 確認できず | 縦の一回転で追手を前へ行かせるゲーム用補助。成功は相手の位置に依存し、史実の定型戦法・自動操縦装置とはしない |

## 一次資料・公式資料

1. 米海軍航空博物館：A6M2 Zero（寸法・装備・特徴）
   https://www.history.navy.mil/content/history/museums/nnam/explore/collections/aircraft/a/a6m2-zero0.html
2. 米空軍博物館：Mitsubishi A6M2 Zero（装備・軽量化・防護）
   https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/196313/mitsubishi-a6m2-zero/
3. U.S. War Department, Tactical and Technical Trends No.5, 1942-08-13, “The New Mitsubishi-Nagoya Zero Fighter”（Lone Sentryによる一次資料の復刻。戦時推測値を含むため、全記載を確定諸元として使わない）
   https://lonesentry.com/articles/ttt08/zero-fighter.html
4. Captured A6M2 flight test memo, 1942-10-23（原本のスキャン2頁）
   https://www.wwiiaircraftperformance.org/japan/a6m2-oct2342.pdf
5. Aviation Museums National Network, A6M2 Zero wreckage（展示機はModel 11）
   https://amnn.com.au/dt_gallery/mitsubishi-a6m2-zero-wreckage/
6. Australian War Memorial, Mitsubishi A6M2 Model 21（折りたたみ翼端）
   https://www.awm.gov.au/collection/C111051

## 限界

本作は飛行訓練用シミュレーターではない。揚力係数、失速特性、燃料、過給機、プロペラピッチ、実機の操縦桿荷重を再現していない。発射周期、弾速、命中領域、損傷量、敵の判断、スコア、レーダーはゲーム用の仮設定。最高速度は博物館資料でも測定条件により異なるため、無条件に一つの史実値として表示しない。塗装は灰緑色を基調とする独自表現で、特定の実在機の完全複製とはしない。

## 操作・外観改修での照合

機首7.7mm2挺と主翼20mm左右各1門の配置を分け、モデルの銃口位置と本体の発射起点を揃える。二一型の翼端折り畳み部は飛行中の展開状態を維持して継ぎ目で表現し、尾部の布張り操縦面には金属外板とは異なる表面を使う。翼端・布張り・収納式尾輪の根拠は豪州戦争記念館の二一型実機説明。細部の質感・塗装摩耗は個体の精密測定ではなく視覚表現。

エースコンバットの操作を参考にするため、HORI公式『ACE COMBAT 7: SKIES UNKNOWN』フライトスティック取説（https://hori.jp/image/2019/01/p4-094_manual_en.pdf 、3頁のレイアウト）で独立した操縦桿とスロットルの配置を確認した。本作ではスマートフォンに合わせ、触った位置を中心とするスティックと加速・減速ボタンへ置き換える。この資料は同作の飛行力学や旋回係数を示すものではない。減速時の小回り、スティックの応答、敵の追従遅れは本作の調整値。
