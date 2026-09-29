-- Fight Flight ranking registration and isolated guest start counter.
-- Apply with Supabase apply_migration. The two games remain inactive until
-- their deployed client and lab display pass the release checks.
-- The common named v1 start accepts any 1..80-character client_version; this
-- guest path mirrors that format rather than imposing a Fight Flight-only
-- allowlist. Public clients can forge guest starts and names; this is a count,
-- not person verification. Common named v1 does not inspect guest start IDs,
-- so a deliberate guest-first/name-second reuse can count twice; the client
-- freezes one mode and one start ID per accepted start.
insert into public.games (
  game_slug, title, game_url, description, share_text,
  score_order, score_unit, is_active, release_date,
  score_scale, score_decimals, score_label, first_score_label,
  best_score_label, display_order, top_ranking_type,
  submission_mode, score_min, score_max
) values
  ('faitofuraito_normal', 'ファイトフライト（ノーマル）',
   'https://chameleonjp-lab.github.io/faitofuraito/',
   '戦闘機で空を飛び、敵機を撃墜するフライトゲーム（ノーマル）。',
   'ファイトフライト https://chameleonjp-lab.github.io/faitofuraito/',
   'desc', '点', false, current_date, 1, 0, 'スコア', '初回スコア',
   '最高スコア', 58, 'best', 'shared', 0, 2147483647),
  ('faitofuraito_easy', 'ファイトフライト（イージー）',
   'https://chameleonjp-lab.github.io/faitofuraito/',
   '戦闘機で空を飛び、敵機を撃墜するフライトゲーム（イージー）。',
   'ファイトフライト https://chameleonjp-lab.github.io/faitofuraito/',
   'desc', '点', false, current_date, 1, 0, 'スコア', '初回スコア',
   '最高スコア', 59, 'best', 'shared', 0, 2147483647);

create table private.faitofuraito_guest_plays_v1 (
  start_id uuid primary key,
  play_id uuid not null unique default pg_catalog.gen_random_uuid(),
  game_slug text not null references public.games(game_slug),
  client_version text not null,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint faitofuraito_guest_slug_check check
    (game_slug in ('faitofuraito_normal', 'faitofuraito_easy')),
  constraint faitofuraito_guest_version_check check
    (pg_catalog.char_length(client_version) between 1 and 80)
);

create index faitofuraito_guest_plays_v1_slug_started_idx
  on private.faitofuraito_guest_plays_v1 (game_slug, started_at);

alter table private.faitofuraito_guest_plays_v1 enable row level security;
revoke all on private.faitofuraito_guest_plays_v1 from public, anon, authenticated;

create function public.start_faitofuraito_guest_play_v1(
  p_start_id uuid, p_game_slug text, p_client_version text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_slug text;
  v_version text;
  v_existing private.faitofuraito_guest_plays_v1%rowtype;
  v_play_id uuid;
  v_started_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_start_id is null or p_game_slug is null or p_client_version is null then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'required_input_missing');
  end if;

  v_slug := pg_catalog.lower(pg_catalog.btrim(p_game_slug));
  v_version := pg_catalog.btrim(p_client_version);
  if p_game_slug <> v_slug
     or v_slug not in ('faitofuraito_normal', 'faitofuraito_easy')
     or p_client_version <> v_version
     or pg_catalog.char_length(v_version) not between 1 and 80 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_start_id::text, 0::bigint)
  );
  select * into v_existing
  from private.faitofuraito_guest_plays_v1
  where start_id = p_start_id
  for update;
  if found then
    if v_existing.game_slug <> v_slug or v_existing.client_version <> v_version then
      return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'start_id_conflict');
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', true, 'duplicate', true, 'start_id', p_start_id,
      'play_id', v_existing.play_id, 'game_slug', v_existing.game_slug,
      'started_at', v_existing.started_at
    );
  end if;

  if exists (select 1 from private.game_play_sessions where start_id = p_start_id) then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'start_id_conflict');
  end if;

  if not exists (
    select 1 from public.games
    where game_slug = v_slug and is_active is true and submission_mode = 'shared'
  ) then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reason', 'game_not_available', 'game_slug', v_slug
    );
  end if;

  -- Coarse traffic guard. This cannot establish guest identity or prevent
  -- inflated counts; it only limits an accidental flood of writes.
  if (
    select count(*) from private.faitofuraito_guest_plays_v1
    where game_slug = v_slug
      and started_at >= v_started_at - interval '1 minute'
  ) >= 10000 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'play_rate_limited');
  end if;

  v_play_id := pg_catalog.gen_random_uuid();
  insert into private.faitofuraito_guest_plays_v1
    (start_id, play_id, game_slug, client_version, started_at)
  values (p_start_id, v_play_id, v_slug, v_version, v_started_at);

  return pg_catalog.jsonb_build_object(
    'accepted', true, 'duplicate', false, 'start_id', p_start_id,
    'play_id', v_play_id, 'game_slug', v_slug, 'started_at', v_started_at
  );
end;
$function$;

revoke all on function public.start_faitofuraito_guest_play_v1(uuid,text,text)
  from public, authenticated;
grant execute on function public.start_faitofuraito_guest_play_v1(uuid,text,text) to anon;

create function public.get_faitofuraito_play_stats_v1(p_game_slug text)
returns table (
  total_play_count bigint,
  player_count bigint,
  registered_play_count bigint,
  unregistered_play_count bigint
)
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_slug text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_game_slug, '')));
begin
  if v_slug not in ('faitofuraito_normal', 'faitofuraito_easy') then
    return query select 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  return query
  with named as (
    select count(*)::bigint as plays,
           count(distinct s.normalized_name)::bigint as players
    from private.game_play_sessions s
    where s.game_slug = v_slug
  ), guests as (
    select count(*)::bigint as plays
    from private.faitofuraito_guest_plays_v1 g
    where g.game_slug = v_slug
  )
  select named.plays + guests.plays, named.players,
         named.plays, guests.plays
  from named cross join guests;
end;
$function$;

revoke all on function public.get_faitofuraito_play_stats_v1(text)
  from public;
grant execute on function public.get_faitofuraito_play_stats_v1(text)
  to anon, authenticated;
