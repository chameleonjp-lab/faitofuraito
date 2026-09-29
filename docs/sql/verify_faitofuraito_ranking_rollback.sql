-- Live transaction test; no records or active-state changes survive.
begin;
update public.games set is_active = true
where game_slug in ('faitofuraito_normal', 'faitofuraito_easy');
set local role anon;
do $test$
declare
  v_named_start uuid := gen_random_uuid();
  v_guest_start uuid := gen_random_uuid();
  v_submit uuid := gen_random_uuid();
  v_named jsonb;
  v_guest jsonb;
  v_result jsonb;
  v_named_id uuid;
  v_guest_id uuid;
  v_stats record;
  v_rows integer;
  v_duplicate boolean;
begin
  v_named := public.start_game_play_v1(v_named_start, 'FF test session', 'faitofuraito_normal', 'faitofuraito-web-20260929-02');
  assert v_named ->> 'accepted' = 'true' and v_named ->> 'duplicate' = 'false', 'named start';
  v_named_id := (v_named ->> 'play_id')::uuid;
  v_result := public.start_game_play_v1(v_named_start, 'FF test session', 'faitofuraito_normal', 'faitofuraito-web-20260929-02');
  assert v_result ->> 'duplicate' = 'true' and (v_result ->> 'play_id')::uuid = v_named_id, 'named duplicate';
  v_guest := public.start_faitofuraito_guest_play_v1(v_guest_start, 'faitofuraito_normal', 'faitofuraito-web-20260929-02');
  assert v_guest ->> 'accepted' = 'true' and v_guest ->> 'duplicate' = 'false', 'guest start';
  v_guest_id := (v_guest ->> 'play_id')::uuid;
  v_result := public.start_faitofuraito_guest_play_v1(v_guest_start, 'faitofuraito_normal', 'faitofuraito-web-20260929-02');
  assert v_result ->> 'duplicate' = 'true' and (v_result ->> 'play_id')::uuid = v_guest_id, 'guest duplicate';
  v_result := public.start_faitofuraito_guest_play_v1(v_guest_start, 'faitofuraito_easy', 'faitofuraito-web-20260929-02');
  assert v_result ->> 'reason' = 'start_id_conflict', 'guest conflict';
  v_result := public.start_faitofuraito_guest_play_v1(v_named_start, 'faitofuraito_normal', 'faitofuraito-web-20260929-02');
  assert v_result ->> 'reason' = 'start_id_conflict', 'named to guest conflict';
  v_result := public.start_faitofuraito_guest_play_v1(gen_random_uuid(), 'sainome_300_seconds', 'faitofuraito-web-20260929-02');
  assert v_result ->> 'reason' = 'invalid_input', 'other slug';
  v_result := public.start_game_play_v1(gen_random_uuid(), '', 'faitofuraito_normal', 'faitofuraito-web-20260929-02');
  assert v_result ->> 'reason' = 'invalid_input', 'blank ranked name';
  v_result := public.finish_game_play_v1(v_guest_id, '', 'faitofuraito_normal', 'game_over', 1, 7, 'faitofuraito-web-20260929-02', null);
  assert v_result ->> 'accepted' = 'false', 'guest finish rejected';
  v_result := public.finish_game_play_v1(v_named_id, 'FF test session', 'faitofuraito_normal', 'game_over', 1, 12345, 'faitofuraito-web-20260929-02', null);
  assert v_result ->> 'accepted' = 'true', 'named finish';
  v_result := public.finish_game_play_v1(v_named_id, 'FF test session', 'faitofuraito_normal', 'game_over', 1, 12345, 'faitofuraito-web-20260929-02', null);
  assert v_result ->> 'duplicate' = 'true', 'named finish duplicate';
  select count(*), bool_or(was_duplicate) into v_rows, v_duplicate
  from public.submit_score_idempotent_v1(v_named_id, v_submit, 'FF test session', 'faitofuraito_normal', 12345, 'faitofuraito-web-20260929-02');
  assert v_rows = 1 and not v_duplicate, 'named score';
  select count(*), bool_or(was_duplicate) into v_rows, v_duplicate
  from public.submit_score_idempotent_v1(v_named_id, v_submit, 'FF test session', 'faitofuraito_normal', 12345, 'faitofuraito-web-20260929-02');
  assert v_rows = 1 and v_duplicate, 'named score duplicate';
  select * into v_stats from public.get_faitofuraito_play_stats_v1('faitofuraito_normal');
  assert (v_stats.total_play_count, v_stats.player_count,
          v_stats.registered_play_count, v_stats.unregistered_play_count) = (2,1,1,1), 'split stats';
  select count(*) into v_rows from public.get_best_score_ranking('faitofuraito_normal', 30)
  where display_name = 'FF test session' and best_score = 12345;
  assert v_rows = 1, 'ranked named only';
  select total_play_count into v_rows from public.get_faitofuraito_play_stats_v1('sainome_300_seconds');
  assert v_rows = 0, 'other game stat isolation';
end
$test$;
reset role;
rollback;
select 'rollback_verified' as result;
