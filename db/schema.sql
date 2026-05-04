-- Учёт оплаты обучения — инициализация PostgreSQL
-- Роли: student, teacher, accountant, director (иерархия полномочий на приложении).
-- Семестр платежа: first, second, full.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('student', 'teacher', 'accountant', 'director');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_semester AS ENUM ('first', 'second', 'full');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    specialty VARCHAR(255) NOT NULL DEFAULT '',
    course INT NOT NULL CHECK (course >= 1 AND course <= 6),
    group_name VARCHAR(100) NOT NULL,
    enrollment_order TEXT NOT NULL DEFAULT '',
    phone VARCHAR(50) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    total_cost NUMERIC(14, 2) NOT NULL CHECK (total_cost >= 0),
    next_payment_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_specialty ON students (specialty);
CREATE INDEX IF NOT EXISTS idx_students_group ON students (group_name);

-- Привязка учётной записи «студент» к карточке в students (остальные роли — NULL)
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_student_id ON users (student_id);

CREATE TABLE IF NOT EXISTS teacher_students (
    teacher_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (teacher_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_students_teacher ON teacher_students (teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_students_student ON teacher_students (student_id);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    payment_date DATE NOT NULL,
    semester payment_semester,
    check_number VARCHAR(200) NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    check_file TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments (student_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments (payment_date);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_updated_at ON students;
CREATE TRIGGER students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();
