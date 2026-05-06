'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

const ROLES = {
  STUDENT: 'student',
  TEACHER: 'teacher',
  ACCOUNTANT: 'accountant',
  DIRECTOR: 'director',
};

const PERMISSIONS = {
  [ROLES.STUDENT]: {
    viewAllStudents: false,
    addStudent: false,
    editStudent: false,
    deleteStudent: false,
    addPayment: false,
    deletePayment: false,
    viewReports: false,
    manageUsers: false,
  },
  [ROLES.TEACHER]: {
    viewAllStudents: true,
    addStudent: true,
    editStudent: true,
    deleteStudent: false,
    addPayment: true,
    deletePayment: true,
    viewReports: true,
    manageUsers: false,
  },
  [ROLES.ACCOUNTANT]: {
    viewAllStudents: true,
    addStudent: true,
    editStudent: true,
    deleteStudent: false,
    addPayment: true,
    deletePayment: true,
    viewReports: true,
    manageUsers: false,
  },
  [ROLES.DIRECTOR]: {
    viewAllStudents: true,
    addStudent: true,
    editStudent: true,
    deleteStudent: true,
    addPayment: true,
    deletePayment: true,
    viewReports: true,
    manageUsers: true,
  },
};

function sslFromDatabaseUrl(url) {
  if (!url) return false;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFromDatabaseUrl(process.env.DATABASE_URL || ''),
});

function num(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function formatDateOnly(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function rowToPayment(row) {
  return {
    id: row.id,
    amount: num(row.amount),
    date: formatDateOnly(row.payment_date),
    semester: row.semester || '',
    studyYear:
      row.study_year != null && row.study_year !== ''
        ? Number(row.study_year)
        : null,
    checkNumber: row.check_number || '',
    note: row.note || '',
    checkFile: row.check_file || null,
  };
}

function rowToStudent(row, payments) {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty || '',
    course: row.course,
    group: row.group_name,
    enrollmentOrder: row.enrollment_order || '',
    phone: row.phone || '',
    email: row.email || '',
    totalCost: num(row.total_cost),
    nextPaymentDate: formatDateOnly(row.next_payment_date),
    payments: payments || [],
  };
}

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name || '',
    email: row.email || '',
    role: row.role,
    isActive: Boolean(row.is_active),
    studentId: row.student_id ? String(row.student_id) : null,
  };
}

async function fetchStudentsByIds(studentIds) {
  if (!studentIds || studentIds.length === 0) return [];
  const { rows: studentRows } = await pool.query(
    `SELECT * FROM students WHERE id = ANY($1::uuid[]) ORDER BY name`,
    [studentIds]
  );
  if (studentRows.length === 0) return [];

  const ids = studentRows.map((r) => r.id);
  const { rows: paymentRows } = await pool.query(
    `SELECT * FROM payments WHERE student_id = ANY($1::uuid[])
     ORDER BY payment_date DESC, created_at DESC`,
    [ids]
  );

  const byStudent = new Map();
  for (const p of paymentRows) {
    if (!byStudent.has(p.student_id)) byStudent.set(p.student_id, []);
    byStudent.get(p.student_id).push(rowToPayment(p));
  }

  return studentRows.map((s) => rowToStudent(s, byStudent.get(s.id) || []));
}

async function fetchStudentsWithPaymentsForUser(user) {
  if (user.role === ROLES.STUDENT) {
    if (!user.studentId) return [];
    return fetchStudentsByIds([user.studentId]);
  }

  if (user.role === ROLES.TEACHER) {
    const { rows } = await pool.query(
      `SELECT student_id FROM teacher_students WHERE teacher_user_id = $1`,
      [user.id]
    );
    return fetchStudentsByIds(rows.map((r) => r.student_id));
  }

  const { rows: studentRows } = await pool.query(`SELECT * FROM students ORDER BY name`);
  if (studentRows.length === 0) return [];
  return fetchStudentsByIds(studentRows.map((r) => r.id));
}

function canAccessStudentRecord(req, studentId) {
  if (req.user.role === ROLES.STUDENT) {
    return Boolean(req.user.studentId && String(req.user.studentId) === String(studentId));
  }
  return true;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      studentId: payload.studentId || null,
      fullName: payload.fullName || '',
      email: payload.email || '',
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    const set = PERMISSIONS[req.user.role];
    if (!set || !set[permission]) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    return next();
  };
}

function parseStudentPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const name = String(body.name || '').trim();
  const specialty = String(body.specialty || '').trim();
  const course = parseInt(body.course, 10);
  const group = String(body.group || '').trim();
  const enrollmentOrder = String(body.enrollmentOrder || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const totalCost = num(body.totalCost);
  let nextPaymentDate = body.nextPaymentDate;
  if (nextPaymentDate === '' || nextPaymentDate == null) nextPaymentDate = null;

  if (!name) return { error: 'Укажите ФИО' };
  if (!Number.isFinite(course) || course < 1 || course > 6) {
    return { error: 'Курс должен быть от 1 до 6' };
  }
  if (!group) return { error: 'Укажите группу' };
  if (totalCost < 0) return { error: 'Стоимость не может быть отрицательной' };

  return {
    value: {
      name,
      specialty,
      course,
      group_name: group,
      enrollment_order: enrollmentOrder,
      phone,
      email,
      total_cost: totalCost,
      next_payment_date: nextPaymentDate,
    },
  };
}

function normalizeSemester(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (s === 'first' || s === 'second' || s === 'full') return s;
  return null;
}

function buildDebtorsReport(students) {
  const specialties = {};
  for (const student of students) {
    const paid = student.payments.reduce((sum, p) => sum + num(p.amount), 0);
    const debt = Math.max(0, num(student.totalCost) - paid);
    if (debt <= 0) continue;
    const key = student.specialty && student.specialty.trim() ? student.specialty : 'Без специальности';
    if (!specialties[key]) specialties[key] = { students: [], totalDebt: 0 };
    specialties[key].students.push({ name: student.name, debt });
    specialties[key].totalDebt += debt;
  }
  return { specialties };
}

function paidForCourseSemester(student, studyYear, semesterKey) {
  if (!student.payments || !semesterKey) return 0;
  return student.payments.reduce((sum, p) => {
    if (num(p.studyYear) !== studyYear) return sum;
    if (p.semester !== semesterKey) return sum;
    return sum + num(p.amount);
  }, 0);
}

/** 4 курса × 2 семестра: доля стоимости одного семестра */
function semesterShareEight(total) {
  const t = num(total);
  return t > 0 ? t / 8 : 0;
}

function buildSemesterAmountsReport(students) {
  const fullPeriod = [];
  const bySlot = [];

  for (let course = 1; course <= 4; course++) {
    for (const sem of ['first', 'second']) {
      const paidList = [];
      const debtList = [];
      const semLabel = sem === 'first' ? 1 : 2;

      for (const student of students) {
        const total = num(student.totalCost);
        const share = semesterShareEight(total);
        const paidTotal = student.payments.reduce((s, p) => s + num(p.amount), 0);
        const paidFull = total > 0 && paidTotal >= total;
        const slotPaid = paidForCourseSemester(student, course, sem);
        const specialty =
          student.specialty && student.specialty.trim()
            ? student.specialty
            : 'Без специальности';

        if (total <= 0 || share <= 0) continue;

        if (paidFull || slotPaid >= share) {
          paidList.push({
            name: student.name,
            specialty,
            slotPaid: paidFull ? total : slotPaid,
            total,
            norm: share,
          });
        } else if (slotPaid > 0) {
          debtList.push({
            name: student.name,
            specialty,
            slotPaid,
            debtSlot: Math.max(0, share - slotPaid),
            total,
          });
        } else {
          debtList.push({
            name: student.name,
            specialty,
            slotPaid: 0,
            debtSlot: share,
            total,
          });
        }
      }

      paidList.sort((a, b) => a.specialty.localeCompare(b.specialty, 'ru'));
      debtList.sort((a, b) => b.debtSlot - a.debtSlot);

      bySlot.push({
        course,
        semester: semLabel,
        semesterKey: sem,
        paidList,
        debtList,
      });
    }
  }

  for (const student of students) {
    const paid = student.payments.reduce((sum, p) => sum + num(p.amount), 0);
    const total = num(student.totalCost);
    const specialty =
      student.specialty && student.specialty.trim()
        ? student.specialty
        : 'Без специальности';
    if (total > 0 && paid >= total) {
      fullPeriod.push({ name: student.name, specialty, total, paid });
    }
  }
  fullPeriod.sort((a, b) => a.specialty.localeCompare(b.specialty, 'ru'));

  return { bySlot, fullPeriod };
}

function buildPrepaidReport(students) {
  return students
    .filter((s) => s.payments.reduce((sum, p) => sum + num(p.amount), 0) > num(s.totalCost))
    .map((student) => {
      const paid = student.payments.reduce((sum, p) => sum + num(p.amount), 0);
      return {
        name: student.name,
        specialty: student.specialty && student.specialty.trim() ? student.specialty : 'Без специальности',
        totalCost: num(student.totalCost),
        paid,
        prepaid: paid - num(student.totalCost),
      };
    });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const username = String(req.body?.username || email).trim().toLowerCase();
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Заполните все поля регистрации' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Пароли не совпадают' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5::user_role, false)
       RETURNING id`,
      [username, fullName, email, passwordHash, ROLES.STUDENT]
    );

    return res.status(201).json({
      ok: true,
      userId: rows[0].id,
      message: 'Регистрация успешна. Аккаунт ожидает активации директором.',
    });
  } catch (e) {
    if (String(e.message || '').includes('duplicate key value')) {
      return res.status(409).json({ error: 'Пользователь с таким email или логином уже существует' });
    }
    console.error(e);
    return res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Укажите логин и пароль' });

    const { rows } = await pool.query(
      `SELECT id, username, full_name, email, password_hash, role, is_active, student_id FROM users WHERE username = $1 OR email = $1`,
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });
    if (!user.is_active) return res.status(403).json({ error: 'Аккаунт ещё не активирован директором' });

    const studentId = user.student_id ? String(user.student_id) : null;
    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        studentId,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ token, user: rowToUser(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, full_name, email, role, is_active, student_id FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'Пользователь не найден' });
  res.json({ user: rowToUser(rows[0]) });
});

app.get('/api/director/users', requireAuth, requirePermission('manageUsers'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, full_name, email, role, is_active, student_id FROM users ORDER BY created_at DESC`
  );
  res.json(rows.map(rowToUser));
});

app.patch('/api/director/users/:id/access', requireAuth, requirePermission('manageUsers'), async (req, res) => {
  const role = String(req.body?.role || '');
  const isActive = Boolean(req.body?.isActive);
  const studentId = req.body?.studentId || null;
  if (!Object.values(ROLES).includes(role)) return res.status(400).json({ error: 'Некорректная роль' });

  const { rows } = await pool.query(
    `UPDATE users
     SET role = $1::user_role,
         is_active = $2,
         student_id = CASE WHEN $1::user_role = 'student' THEN $3::uuid ELSE NULL END
     WHERE id = $4
     RETURNING id, username, full_name, email, role, is_active, student_id`,
    [role, isActive, studentId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(rowToUser(rows[0]));
});

app.post('/api/director/teachers', requireAuth, requirePermission('manageUsers'), async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const username = String(req.body?.username || email).trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!fullName || !email || !password) return res.status(400).json({ error: 'Заполните ФИО, email и пароль' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, full_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'teacher'::user_role, true)
       RETURNING id, username, full_name, email, role, is_active, student_id`,
      [username, fullName, email, hash]
    );
    res.status(201).json(rowToUser(rows[0]));
  } catch (e) {
    if (String(e.message || '').includes('duplicate key value')) {
      return res.status(409).json({ error: 'Пользователь с таким email или логином уже существует' });
    }
    console.error(e);
    res.status(500).json({ error: 'Ошибка создания преподавателя' });
  }
});

app.get('/api/director/teachers-with-students', requireAuth, requirePermission('manageUsers'), async (req, res) => {
  const { rows: teachers } = await pool.query(
    `SELECT id, username, full_name, email, role, is_active, student_id
     FROM users WHERE role = 'teacher'::user_role ORDER BY full_name, username`
  );

  const result = [];
  for (const t of teachers) {
    const { rows: students } = await pool.query(
      `SELECT s.id, s.name, s.group_name
       FROM teacher_students ts
       JOIN students s ON s.id = ts.student_id
       WHERE ts.teacher_user_id = $1
       ORDER BY s.name`,
      [t.id]
    );
    result.push({ ...rowToUser(t), students: students.map((s) => ({ id: s.id, name: s.name, group: s.group_name })) });
  }

  res.json(result);
});

app.put('/api/director/teachers/:id/students', requireAuth, requirePermission('manageUsers'), async (req, res) => {
  const teacherId = req.params.id;
  const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];

  await pool.query('BEGIN');
  try {
    const teacher = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'teacher'::user_role`,
      [teacherId]
    );
    if (!teacher.rows.length) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Преподаватель не найден' });
    }

    await pool.query(`DELETE FROM teacher_students WHERE teacher_user_id = $1`, [teacherId]);
    for (const sid of studentIds) {
      await pool.query(
        `INSERT INTO teacher_students (teacher_user_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [teacherId, sid]
      );
    }

    await pool.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить закрепления' });
  }
});

app.get('/api/students', requireAuth, async (req, res) => {
  try {
    const data = await fetchStudentsWithPaymentsForUser(req.user);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось загрузить студентов' });
  }
});

app.get('/api/students/:id', requireAuth, async (req, res) => {
  try {
    if (!canAccessStudentRecord(req, req.params.id)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    const data = await fetchStudentsByIds([req.params.id]);
    if (!data.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(data[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

app.post('/api/students', requireAuth, requirePermission('addStudent'), async (req, res) => {
  const parsed = parseStudentPayload(req.body);
  if (parsed?.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  try {
    const { rows } = await pool.query(
      `INSERT INTO students (name, specialty, course, group_name, enrollment_order, phone, email, total_cost, next_payment_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [v.name, v.specialty, v.course, v.group_name, v.enrollment_order, v.phone, v.email, v.total_cost, v.next_payment_date]
    );
    res.status(201).json(rowToStudent(rows[0], []));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось создать студента' });
  }
});

app.put('/api/students/:id', requireAuth, requirePermission('editStudent'), async (req, res) => {
  if (!canAccessStudentRecord(req, req.params.id)) return res.status(403).json({ error: 'Недостаточно прав' });
  const parsed = parseStudentPayload(req.body);
  if (parsed?.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  try {
    const { rows } = await pool.query(
      `UPDATE students SET name=$1,specialty=$2,course=$3,group_name=$4,enrollment_order=$5,phone=$6,email=$7,total_cost=$8,next_payment_date=$9
       WHERE id=$10 RETURNING *`,
      [v.name, v.specialty, v.course, v.group_name, v.enrollment_order, v.phone, v.email, v.total_cost, v.next_payment_date, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    const full = await fetchStudentsByIds([req.params.id]);
    res.json(full[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось обновить студента' });
  }
});

app.delete('/api/students/:id', requireAuth, requirePermission('deleteStudent'), async (req, res) => {
  if (!canAccessStudentRecord(req, req.params.id)) return res.status(403).json({ error: 'Недостаточно прав' });
  try {
    const r = await pool.query(`DELETE FROM students WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось удалить студента' });
  }
});

app.post('/api/students/:id/payments', requireAuth, requirePermission('addPayment'), async (req, res) => {
  if (!canAccessStudentRecord(req, req.params.id)) return res.status(403).json({ error: 'Недостаточно прав' });
  try {
    const amount = num(req.body?.amount);
    const dateRaw = req.body?.date;
    if (!dateRaw) return res.status(400).json({ error: 'Укажите дату платежа' });
    if (amount < 0) return res.status(400).json({ error: 'Сумма не может быть отрицательной' });

    const semester = normalizeSemester(req.body?.semester);
    const syRaw = parseInt(req.body?.studyYear, 10);
    let studyYear =
      Number.isFinite(syRaw) && syRaw >= 1 && syRaw <= 4 ? syRaw : null;
    if (!semester || semester === 'full') {
      studyYear = null;
    } else if (semester === 'first' || semester === 'second') {
      if (studyYear == null) {
        return res.status(400).json({
          error: 'Укажите курс обучения (от 1 до 4) для оплаты за семестр',
        });
      }
    }

    const checkNumber = String(req.body?.checkNumber || '').trim();
    const note = String(req.body?.note || '').trim();
    const checkFile = req.body?.checkFile ? String(req.body.checkFile) : null;

    const { rows } = await pool.query(
      `INSERT INTO payments (student_id, amount, payment_date, semester, study_year, check_number, note, check_file)
       VALUES ($1,$2,$3,$4::payment_semester,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id,
        amount,
        dateRaw,
        semester,
        studyYear,
        checkNumber,
        note,
        checkFile,
      ]
    );
    res.status(201).json(rowToPayment(rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось добавить платёж' });
  }
});

app.delete('/api/payments/:paymentId', requireAuth, requirePermission('deletePayment'), async (req, res) => {
  try {
    const { rows: payRows } = await pool.query(`SELECT student_id FROM payments WHERE id=$1`, [req.params.paymentId]);
    if (!payRows.length) return res.status(404).json({ error: 'Не найдено' });
    if (!canAccessStudentRecord(req, payRows[0].student_id)) return res.status(403).json({ error: 'Недостаточно прав' });

    await pool.query(`DELETE FROM payments WHERE id = $1`, [req.params.paymentId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось удалить платёж' });
  }
});

app.get('/api/reports/debtors', requireAuth, requirePermission('viewReports'), async (req, res) => {
  try {
    const students = await fetchStudentsWithPaymentsForUser(req.user);
    res.json(buildDebtorsReport(students));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка отчёта' });
  }
});

app.get('/api/reports/semester-amounts', requireAuth, requirePermission('viewReports'), async (req, res) => {
  try {
    const students = await fetchStudentsWithPaymentsForUser(req.user);
    res.json(buildSemesterAmountsReport(students));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка отчёта' });
  }
});

app.get('/api/reports/prepaid', requireAuth, requirePermission('viewReports'), async (req, res) => {
  try {
    const students = await fetchStudentsWithPaymentsForUser(req.user);
    res.json({ prepaid: buildPrepaidReport(students) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка отчёта' });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Не найдено' });
  return next();
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`Сервер слушает порт ${PORT}`);
});
