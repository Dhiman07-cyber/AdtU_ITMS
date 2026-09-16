-- Migration: add atomic reminder claim function
-- Prevents duplicate expiry reminders when two cron executions race on the same day.
--
-- The function:
--   1. Locks the student row (FOR UPDATE) so concurrent calls are serialized.
--   2. Checks whether a reminder was already sent today (UTC).
--   3. If not, increments expiry_reminder_count and stamps last_expiry_reminder_sent_at.
--   4. Returns TRUE if the increment happened, FALSE if already done today.
--
-- Callers: src/lib/expiry-check.ts -- replace the read-then-write pattern with
-- a single call to this function.  The notification side-effect (push/email)
-- should only run when this function returns TRUE.

CREATE OR REPLACE FUNCTION increment_expiry_reminder_count(p_uid TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_last_sent TIMESTAMPTZ;
    v_today     DATE := CURRENT_DATE;  -- UTC date
BEGIN
    -- Lock the target row for the duration of this transaction.
    SELECT last_expiry_reminder_sent_at
      INTO v_last_sent
      FROM student_profiles
     WHERE uid = p_uid
       FOR UPDATE;

    -- If no row found, nothing to do.
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Already reminded today -- idempotent, return FALSE so the caller skips the
    -- notification side effect.
    IF v_last_sent IS NOT NULL AND v_last_sent::DATE = v_today THEN
        RETURN FALSE;
    END IF;

    -- First reminder for today -- increment counter and stamp timestamp.
    UPDATE student_profiles
       SET expiry_reminder_count      = COALESCE(expiry_reminder_count, 0) + 1,
           last_expiry_reminder_sent_at = NOW(),
           updated_at                  = NOW()
     WHERE uid = p_uid;

    RETURN TRUE;
END;
$$;

-- Grant execute to the service role used by the Next.js backend.
GRANT EXECUTE ON FUNCTION increment_expiry_reminder_count(TEXT) TO service_role;
