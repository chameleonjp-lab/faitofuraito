# ファイトフライト

スマートフォンの縦画面で遊ぶ、零戦二一型を題材にした空戦ゲームです。ノーマルは時間無制限、イージーは5分間。

空を触ると現れる操作キーで操縦します。ノーマルは射撃・宙返り・加速・減速の4ボタン、手動射撃です。イージーは操縦補助と円内の敵への自動射撃、宙返りボタンのみです。両モードとも7.7mm 288発・20mm 96発を使い切ると6秒で再装填します。撃墜・節弾・完了した宙返りで加点し、被弾で減点します。ホーム・結果画面でモード別の操作設定を保存でき、一時停止中は現在のモードだけを編集します。宙返り中の新しい操縦で中止し、その場から操縦を続けられます。高度1,200m以下では警告し、10秒後に終了します。結果はURLを含む文章として共有できます。

名前なしでも遊べます。出撃前に名前を入れたプレイはモード別ランキングへ登録し、名前なしは順位対象外として回数だけ数えます。結果に同じモードの上位30位を表示します。

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
- [カイセン基準の航空機仕様・距離減衰・今後の同期手順](docs/AIRCRAFT_PARITY.md)
- [航空機同期の検査台帳](docs/VERIFICATION_AIRCRAFT_PARITY.md)
- [史実資料と再現範囲](docs/AIRCRAFT_REFERENCES.md)
- [ハーネス採用版](docs/HARNESS.md)
- [検査と残る確認](docs/VERIFICATION.md)
- [ランキング接続と本番の状態](docs/DB_RANKING.md)
- [共有画像の記録](docs/SHARING_ASSET.md)

Three.jsのライセンスは `public/third-party-notices.txt` に同梱しています。機体の形状・雲・効果音はこの作品のコードで生成し、博物館写真や他作品の素材を同梱していません。

