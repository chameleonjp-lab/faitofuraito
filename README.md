# ファイトフライト

スマートフォンの縦画面で遊ぶ、零戦二一型を題材にした3分間の空戦ゲームです。

空をスワイプして旋回し、下から上へ素早く払って宙返り。画面下部の射撃ボタンを押している間に発射します。撃墜数が多く、消費弾数が少ないほど高得点になり、完了した宙返りにも加点します。

## 開発

Node.js 22.12以上を使用します。

```sh
npm ci
npm run dev
npm test
npm run build
```

成果物は `dist/` です。相対パスで出力するため、GitHub Pagesの `/faitofuraito/` 配下にも配置できます。本PRでは公開設定・本番への配備は行いません。

- [仕様・採用判断](docs/SPEC.md)
- [史実資料と再現範囲](docs/AIRCRAFT_REFERENCES.md)
- [ハーネス採用版](docs/HARNESS.md)
- [検査と残る確認](docs/VERIFICATION.md)

Three.jsのライセンスは `public/third-party-notices.txt` に同梱しています。機体の形状・雲・効果音はこの作品のコードで生成し、博物館写真や他作品の素材を同梱していません。
