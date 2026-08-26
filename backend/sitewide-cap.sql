-- ============================================================================
-- SITEWIDE MONTHLY FREE-TIER SPEND — sum of Bedrock cost across BOTH signed-in
-- free usage (usage_events) and anonymous usage (anon_usage_events) for the
-- current month, in micros ($1 = 1,000,000). The backend compares this to a cap
-- (default $500) to decide whether to admit NEW free users this month. Run once.
-- (Requires billing-schema.sql, billing-freetier.sql, anon-freetier.sql first.)
-- ============================================================================
create or replace function free_tier_spend_micros() returns bigint
  language sql security definer stable as $$
  select
    coalesce((select sum(cost_micros) from usage_events
                where created_at >= date_trunc('month', now())), 0)
  + coalesce((select sum(cost_micros) from anon_usage_events
                where created_at >= date_trunc('month', now())), 0);
$$;
