# 共有画像

SNSカードは `public/social-card-eed6ea12da6e1c73.png`（1200 × 630 px）を使用する。タイトルと背景は `docs/social-card-source.svg` のネイティブSVGで組版し、左側には本作の実ゲーム画面を配置した。架空の機体・戦闘場面や別の写真素材は追加していない。

- 実画面素材: `faitofuraito-gameplay-evidence.png`（監査済みmain画面の295 × 639 px PNG、Git blob `c006f11a4005db6efa5d00bfaa6481634eab631c`、SHA-256 `b9086c0cf2236bac38761622f8a5a50016429ef24c939ed1e0c55512ce53e972`）。画像の画素内容は変更せず、カード全体に収めるため比例縮小のみ行った。切り抜き・色調変更・合成要素の描き足しはない。
- `docs/social-card-source.svg` に素材PNGをdata URIで埋め込み、外部画像や外部参照なしに再現できる。PNGはInkscape 1.4で幅1200・高さ630として出力し、PNGのSHA-256先頭16文字を公開ファイル名に含めた。
- 生成カードのSHA-256: `eed6ea12da6e1c73653a732350a019e83c6ba209f1eeaf773dbdede82eec673b`。
- 旧 `public/social-card.png`（1730 × 909 px、SHA-256 `7a3fb68e0504a3a2ec31178325394cf62a793518f65833645e69661353db8989`）は上書きせず保全し、Open Graph/Twitterの参照先からは外した。
- `index.html` のOpen Graph/Twitter画像URLは同じ新しいfingerprinted PNGを参照する。実SNSでの表示とプラットフォーム側キャッシュは、公開後の確認事項。
