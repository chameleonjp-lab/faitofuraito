# ファイトフライト

スマートフォンの縦画面で遊ぶ、零戦二一型を題材にした空戦ゲームです。ノーマルは時間無制限、イージーは5分間。

空を触ると現れる操作キーで操縦します。ノーマルは射撃・宙返り・加速・減速の4ボタン、弾数有限。イージーは操縦補助と円内の敵への自動射撃、無限弾数、宙返りボタンのみです。撃墜・節弾・完了した宙返りで加点し、被弾で減点します。ホーム・結果画面でモード別の操作設定を保存でき、一時停止中は現在のモードだけを編集します。結果はURLを含む文章として共有・コピーできます。

[ゲームを開く](https://chameleonjp-lab.github.io/faitofuraito/)

## 開発

Node.js 22.12以上を使用します。

```sh
npm ci
npm run dev
npm test
npm run build
```

成果物は `dist/` です。相対パスで出力するため、GitHub Pagesの `/faitofuraito/` 配下にも配置できます。公開済みのGitHub Pagesは `gh-pages` の成果物を配信します。公開元のソースコミットは `deployment.json` に記録します。

- [仕様・採用判断](docs/SPEC.md)
- [史実資料と再現範囲](docs/AIRCRAFT_REFERENCES.md)
- [ハーネス採用版](docs/HARNESS.md)
- [検査と残る確認](docs/VERIFICATION.md)
- [共有画像の記録](docs/SHARING_ASSET.md)

Three.jsのライセンスは `public/third-party-notices.txt` に同梱しています。機体の形状・雲・効果音はこの作品のコードで生成し、博物館写真や他作品の素材を同梱していません。
