# ファイトフライトのDBランキング連携

対象本番: Supabase `mlpnjgezrnhdxsxolyzj`。2026-09-29に移行 `20260929035730_faitofuraito_ranking_guest_v1` を適用。元SQLは [`sql/20260929_faitofuraito_ranking.sql`](sql/20260929_faitofuraito_ranking.sql)。通常・イージーをそれぞれ `faitofuraito_normal`（表示順58）と `faitofuraito_easy`（59）として、共通URL、降順整数点、0〜2,147,483,647点、`shared` で登録した。両行とも `is_active=false` を維持する。ゲーム版は `faitofuraito-web-20260929-02`。クライアントと実験場の候補が公開・照合された後だけ有効化する。

名前ありのプレイは既存の `start_game_play_v1` → `finish_game_play_v1` → `submit_score_idempotent_v1` を使い、空白を除いた1〜20字の名前を要求する。波のない本作の終了時は `p_result_type='game_over'`、`p_reached_wave=1`、`p_ranking_score=null` を共通RPCへ渡す。再送は同一の `start_id`、`play_id`、`submission_id` と確定結果を使う。

名前なしの開始だけは `start_faitofuraito_guest_play_v1(p_start_id uuid,p_game_slug text,p_client_version text)` を呼ぶ。成功時は `accepted`,`duplicate`,`start_id`,`play_id`,`game_slug`,`started_at` を持つJSONを返す。専用の非公開表へ開始時に一度だけ保存し、終了・得点送信の経路を持たない。`get_faitofuraito_play_stats_v1(p_game_slug text)` は `total_play_count`,`player_count`,`registered_play_count`,`unregistered_play_count` を各モードで返す。`player_count` は名前あり開始のモード内登録名数であり、匿名人数の推計ではない。実験場のゲスト回数は「名前未登録・順位対象外」として表示し、不正ユーザー扱いしない。ランキングの初回・ベスト・プレイ回数順位には匿名開始を混ぜない。

ゲストの直接表権限はなく、anonに開始・集計RPCだけを許可する。RPCは `SECURITY DEFINER`、空のsearch_path、対象2識別子・公開中shared行・引数形式の検査を持つ。公開用APIから非公開表に書くための限定的な昇格である。名前・ゲスト開始は本人認証や得点再計算ではない。ゲスト開始の版は1〜80字を検査するが固定版への限定はなく、共通名ありv1と同じ制約に合わせている。クライアントを偽装したゲスト開始や任意の別UUIDによる水増しは防げない。意図的に同一UUIDをゲスト開始の後で共通名あり開始へ渡した場合も、共通名ありv1がゲスト表を見ないため2回になる。

## 本番確認

[`sql/verify_faitofuraito_ranking_rollback.sql`](sql/verify_faitofuraito_ranking_rollback.sql) をanonロールで実行。トランザクション内で両行だけを一時的に有効化し、名前あり・なしの開始再送、UUID競合、他ゲーム拒否、空名拒否、匿名終了拒否、終了と得点の再送、名前あり順位1件、開始数内訳（合計2、名前あり1、なし1）を確認し、明示的にロールバックした。実行結果は `rollback_verified`。その後の独立照会で両行は `is_active=false`、専用ゲスト表・名ありセッション・得点履歴・集計は各0件。`anon` はゲスト開始と集計RPCを実行可能で、専用表へ直接アクセス不可、`authenticated` はゲスト開始RPCの権限なし。

Supabase security advisorには専用表の「RLS有効・policyなし」と2つの公開 `SECURITY DEFINER` RPCの警告が残る。専用表をブラウザへ直接開放せず、対象2識別子を検査するAPI経由に限定する設計による。パフォーマンスadvisorの既存の重複索引警告などは対象外。
