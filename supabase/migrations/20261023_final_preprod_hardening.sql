-- =============================================================================
-- Migration: 20261023_final_preprod_hardening.sql
-- Description: Final Pre-Production Hardening & Schema Invariants Across Bibles 1-6
-- =============================================================================

-- 1. FCM Tokens: Default id and unique constraint
ALTER TABLE IF EXISTS public.fcm_tokens 
    ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fcm_tokens_user_token_hash 
    ON public.fcm_tokens (user_id, token_hash);

-- 2. Atomic mark_notification_read RPC (INV-NOTIF-004)
CREATE OR REPLACE FUNCTION public.mark_notification_read(
    p_notification_id TEXT,
    p_user_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE public.notifications
    SET read_by_user_ids = CASE
            WHEN COALESCE(read_by_user_ids, '{}') @> ARRAY[p_user_id] THEN read_by_user_ids
            ELSE array_append(COALESCE(read_by_user_ids, '{}'), p_user_id)
        END,
        read_by = CASE
            WHEN COALESCE(read_by, '{}') @> ARRAY[p_user_id] THEN read_by
            ELSE array_append(COALESCE(read_by, '{}'), p_user_id)
        END,
        updated_at = NOW()
    WHERE id = p_notification_id
      AND NOT (COALESCE(read_by_user_ids, '{}') @> ARRAY[p_user_id]);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(TEXT, TEXT) TO authenticated, service_role;

-- 3. Driver profiles columns hardening
ALTER TABLE IF EXISTS public.driver_profiles 
    ADD COLUMN IF NOT EXISTS shift TEXT,
    ADD COLUMN IF NOT EXISTS bus_id TEXT,
    ADD COLUMN IF NOT EXISTS route_id TEXT,
    ADD COLUMN IF NOT EXISTS trip_active BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS active_trip_id TEXT;

-- 4. Notification visibility RLS hardening
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
USING (
    sender_user_id = auth.uid()::text 
    OR recipient_ids @> ARRAY[auth.uid()::text] 
    OR auto_injected_recipient_ids @> ARRAY[auth.uid()::text]
    OR (target->>'type' IN ('all_users', 'all_role', 'route_based'))
    OR user_has_role(auth.uid()::text, 'admin') 
    OR user_has_role(auth.uid()::text, 'moderator')
);
