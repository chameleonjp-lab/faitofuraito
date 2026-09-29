# ファイトフライトのランキング連携

ノーマルとイージーを別の `game_slug` として登録します。

| モード | game_slug | 順位方式 |
| --- | --- | --- |
| ノーマル | `faitofuraito_normal` | 最高スコア |
| イージー | `faitofuraito_easy` | 最高スコア |

名前があるプレイは `start_game_play_v1` → `finish_game_play_v1` → `submit_score_idempotent_v1` の順に送信します。名前なしのプレイは、既存マイグレーション `20260929035730 faitofuraito_ranking_guest_v1` の `start_faitofuraito_guest_play_v1` で開始だけを記録します。ゲストには `public.game_scores` の行を作らないため、違反プレイヤーと同様に通常の順位には出ませんが、`get_faitofuraito_play_stats_v1` で未登録プレイ数として実験場に集計されます。

結果画面はモード別に `get_best_score_ranking` を上限30件で読み込み、得点の直下に表示します。

`20260929_faitofuraito.sql` は台帳行を最初に非公開で作成します。候補版が公開された後に、次の更新だけを実行します。

```sql
update public.games
set is_active = true
where game_slug in ('faitofuraito_normal', 'faitofuraito_easy');
```

名前なし開始では名前必須の標準RPCへ固定名を渡しません。ランキング登録を選んだ場合だけ名前欄の値を標準RPCへ送信します。
