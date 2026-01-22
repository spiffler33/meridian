-- Migration: Copy all data from testuser to vats
-- This copies data while maintaining referential integrity
-- Run this in the Supabase SQL Editor

DO $$
DECLARE
    source_user_id UUID;
    target_user_id UUID;
    habit_mapping JSONB := '{}';
    pack_mapping JSONB := '{}';
    old_habit_id UUID;
    new_habit_id UUID;
    old_pack_id UUID;
    new_pack_id UUID;
    habit_row RECORD;
    pack_row RECORD;
BEGIN
    -- Get user IDs
    SELECT id INTO source_user_id FROM profiles WHERE username = 'testuser';
    SELECT id INTO target_user_id FROM profiles WHERE username = 'vats';

    IF source_user_id IS NULL THEN
        RAISE EXCEPTION 'Source user "testuser" not found';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'Target user "vats" not found';
    END IF;

    RAISE NOTICE 'Copying data from testuser (%) to vats (%)', source_user_id, target_user_id;

    -- 1. Copy profile settings (except id and username)
    UPDATE profiles
    SET
        display_name = (SELECT display_name FROM profiles WHERE id = source_user_id),
        week_starts_on = (SELECT week_starts_on FROM profiles WHERE id = source_user_id),
        theme = (SELECT theme FROM profiles WHERE id = source_user_id),
        personal_context = (SELECT personal_context FROM profiles WHERE id = source_user_id),
        ai_tone = (SELECT ai_tone FROM profiles WHERE id = source_user_id),
        claude_api_key = (SELECT claude_api_key FROM profiles WHERE id = source_user_id)
    WHERE id = target_user_id;
    RAISE NOTICE 'Copied profile settings';

    -- 2. Copy habits and build mapping
    FOR habit_row IN
        SELECT * FROM habits WHERE user_id = source_user_id
    LOOP
        new_habit_id := gen_random_uuid();

        INSERT INTO habits (id, user_id, label, description, category, emoji, sort_order, created_at, archived_at)
        VALUES (
            new_habit_id,
            target_user_id,
            habit_row.label,
            habit_row.description,
            habit_row.category,
            habit_row.emoji,
            habit_row.sort_order,
            habit_row.created_at,
            habit_row.archived_at
        );

        -- Store mapping
        habit_mapping := habit_mapping || jsonb_build_object(habit_row.id::text, new_habit_id::text);
    END LOOP;
    RAISE NOTICE 'Copied habits: %', habit_mapping;

    -- 3. Copy habit_completions using the mapping
    INSERT INTO habit_completions (id, user_id, habit_id, date, created_at)
    SELECT
        gen_random_uuid(),
        target_user_id,
        (habit_mapping ->> hc.habit_id::text)::uuid,
        hc.date,
        hc.created_at
    FROM habit_completions hc
    WHERE hc.user_id = source_user_id
      AND habit_mapping ? hc.habit_id::text;
    RAISE NOTICE 'Copied habit_completions';

    -- 4. Copy daily_entries
    INSERT INTO daily_entries (id, user_id, date, focus, reflection, created_at, updated_at)
    SELECT
        gen_random_uuid(),
        target_user_id,
        date,
        focus,
        reflection,
        created_at,
        updated_at
    FROM daily_entries
    WHERE user_id = source_user_id;
    RAISE NOTICE 'Copied daily_entries';

    -- 5. Copy tasks
    INSERT INTO tasks (id, user_id, date, category, text, completed, first_step, sort_order, created_at, completed_at)
    SELECT
        gen_random_uuid(),
        target_user_id,
        date,
        category,
        text,
        completed,
        first_step,
        sort_order,
        created_at,
        completed_at
    FROM tasks
    WHERE user_id = source_user_id;
    RAISE NOTICE 'Copied tasks';

    -- 6. Copy year_themes
    INSERT INTO year_themes (id, user_id, year, theme)
    SELECT
        gen_random_uuid(),
        target_user_id,
        year,
        theme
    FROM year_themes
    WHERE user_id = source_user_id;
    RAISE NOTICE 'Copied year_themes';

    -- 7. Copy tower_items
    INSERT INTO tower_items (id, user_id, text, status, waiting_on, expects_by, effort, is_event, last_touched, created_at, done_at)
    SELECT
        gen_random_uuid(),
        target_user_id,
        text,
        status,
        waiting_on,
        expects_by,
        effort,
        is_event,
        last_touched,
        created_at,
        done_at
    FROM tower_items
    WHERE user_id = source_user_id;
    RAISE NOTICE 'Copied tower_items';

    -- 8. Copy packs and build mapping
    FOR pack_row IN
        SELECT * FROM packs WHERE user_id = source_user_id
    LOOP
        new_pack_id := gen_random_uuid();

        INSERT INTO packs (id, user_id, label, total, created_at, archived_at)
        VALUES (
            new_pack_id,
            target_user_id,
            pack_row.label,
            pack_row.total,
            pack_row.created_at,
            pack_row.archived_at
        );

        -- Store mapping
        pack_mapping := pack_mapping || jsonb_build_object(pack_row.id::text, new_pack_id::text);
    END LOOP;
    RAISE NOTICE 'Copied packs: %', pack_mapping;

    -- 9. Copy pack_sessions using the mapping
    INSERT INTO pack_sessions (id, pack_id, date, note, created_at)
    SELECT
        gen_random_uuid(),
        (pack_mapping ->> ps.pack_id::text)::uuid,
        ps.date,
        ps.note,
        ps.created_at
    FROM pack_sessions ps
    JOIN packs p ON ps.pack_id = p.id
    WHERE p.user_id = source_user_id
      AND pack_mapping ? ps.pack_id::text;
    RAISE NOTICE 'Copied pack_sessions';

    -- 10. Copy activities (optional - historical log)
    INSERT INTO activities (id, user_id, type, metadata, created_at)
    SELECT
        gen_random_uuid(),
        target_user_id,
        type,
        metadata,
        created_at
    FROM activities
    WHERE user_id = source_user_id;
    RAISE NOTICE 'Copied activities';

    RAISE NOTICE 'Migration complete! All data copied from testuser to vats.';
END $$;
