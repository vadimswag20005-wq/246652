-- Миграция со схемы с ролями admin / teacher / accountant
-- на student / teacher / accountant / director.
-- Выполните один раз на существующей БД (например: psql $DATABASE_URL -f db/migrate_from_legacy_roles.sql).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'student';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'director';

DO $$
BEGIN
    ALTER TYPE user_role RENAME VALUE 'admin' TO 'director';
EXCEPTION
    WHEN undefined_object THEN
        NULL;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_student_id ON users (student_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
UPDATE users SET email = CONCAT(username, '@local.app') WHERE email IS NULL;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS teacher_students (
    teacher_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (teacher_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_students_teacher ON teacher_students (teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_students_student ON teacher_students (student_id);
