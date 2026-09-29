-- ファイトフライトのランキング台帳・名前なしプレイ連携。
-- 最初は is_active = false で登録し、候補版が公開されてから有効化する。

insert into public.games (
  game_slug,
  title,
  game_url,
  description,
  share_text,
  score_order,
  score_unit,
  is_active,
  release_date,
  score_scale,
  score_decimals,
  score_label,
  first_score_label,
  best_score_label,
  display_order,
  top_ranking_type,
  submission_mode,
  score_min,
  score_max
)
values
(
  'faitofuraito_normal',
  'ファイトフライト（ノーマル）',
  'https://chameleonjp-lab.github.io/faitofuraito/',
  '零戦風の機体を操縦し、敵機を撃墜する空戦ゲーム（ノーマル）',
  'ファイトフライト（ノーマル）で空戦スコアを競おう。',
  'desc', '点', false, date '2026-09-29', 1, 0,
  'スコア', '初回スコア', '最高スコア', 58, 'best', 'shared', 0, 100000000
),
(
  'faitofuraito_easy',
  'ファイトフライト（イージー）',
  'https://chameleonjp-lab.github.io/faitofuraito/',
  '零戦風の機体を操縦し、敵機を撃墜する空戦ゲーム（イージー）',
  'ファイトフライト（イージー）で空戦スコアを競おう。',
  'desc', '点', false, date '2026-09-29', 1, 0,
  'スコア', '初回スコア', '最高スコア', 59, 'best', 'shared', 0, 100000000
)
on conflict (game_slug) do update set
  title = excluded.title,
  game_url = excluded.game_url,
  description = excluded.description,
  share_text = excluded.share_text,
  score_order = excluded.score_order,
  score_unit = excluded.score_unit,
  release_date = excluded.release_date,
  score_scale = excluded.score_scale,
  score_decimals = excluded.score_decimals,
  score_label = excluded.score_label,
  first_score_label = excluded.first_score_label,
  best_score_label = excluded.best_score_label,
  display_order = excluded.display_order,
  top_ranking_type = excluded.top_ranking_type,
  submission_mode = excluded.submission_mode,
  score_min = excluded.score_min,
  score_max = excluded.score_max;

-- 名前なしプレイは既存のゲーム専用ゲストRPCで開始だけを記録する。
-- `20260929035730 faitofuraito_ranking_guest_v1` が次を提供する。
--   start_faitofuraito_guest_play_v1
--   get_faitofuraito_play_stats_v1
-- ゲストには public.game_scores の行を作らないため、通常ランキングには出ず、
-- 実験場側の未登録プレイ数だけが増える。重複RPCをここで再定義しない。

-- 候補版の動作確認後、公開版を反映した時点で実行する。
-- update public.games set is_active = true
-- where game_slug in ('faitofuraito_normal', 'faitofuraito_easy');
