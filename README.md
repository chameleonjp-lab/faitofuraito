# ファイトフライト

スマートフォンの縦画面で遊ぶ、零戦二一型を題材にした5分間の空戦ゲームです。

空を触ると現れるスティックで操縦します。射撃・宙返り・加速・減速は専用ボタン。撃墜と節弾、完了した宙返りで加点し、被弾で減点します。ホーム・一時停止画面の「操作設定」で各ボタンの配置、大きさ、透明度を変更できます。

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

Three.jsのライセンスは `public/third-party-notices.txt` に同梱しています。機体の形状・雲・効果音はこの作品のコードで生成し、博物館写真や他作品の素材を同梱していません。
