-- Cleanup: Remove duplicate habits for vats user
-- Keeps the habits that have habit_completions (the ones with streak data)

DO $$
DECLARE
    target_user_id UUID;
    deleted_count INT;
BEGIN
    -- Get vats user ID
    SELECT id INTO target_user_id FROM profiles WHERE username = 'vats';

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'User "vats" not found';
    END IF;

    -- Delete habits that have NO completions (these are the duplicates without data)
    WITH habits_without_completions AS (
        SELECT h.id
        FROM habits h
        LEFT JOIN habit_completions hc ON hc.habit_id = h.id
        WHERE h.user_id = target_user_id
        GROUP BY h.id
        HAVING COUNT(hc.id) = 0
    )
    DELETE FROM habits
    WHERE id IN (SELECT id FROM habits_without_completions);

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % duplicate habits without completion data', deleted_count;
END $$;
