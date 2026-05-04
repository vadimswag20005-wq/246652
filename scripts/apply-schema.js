'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

function sslFromDatabaseUrl(url) {
  if (!url) return false;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

async function ensureFirstDirector(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;

  const username = (
    process.env.SEED_DIRECTOR_USERNAME ||
    process.env.SEED_ADMIN_USERNAME ||
    'director'
  ).trim();
  const password =
    process.env.SEED_DIRECTOR_PASSWORD ||
    process.env.SEED_ADMIN_PASSWORD ||
    'director123';
  const fullName = process.env.SEED_DIRECTOR_FULLNAME || 'Системный директор';
  const email = (
    process.env.SEED_DIRECTOR_EMAIL || `${username}@local.app`
  )
    .trim()
    .toLowerCase();

  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (username, full_name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, 'director'::user_role, true)`,
    [username, fullName, email, hash]
  );
  console.log(
    `Первый директор создан: логин «${username}» или email «${email}»`
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL не задан');
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const fileSql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client({
    connectionString: url,
    ssl: sslFromDatabaseUrl(url),
  });
  await client.connect();

  // Весь файл одним запросом: надёжнее, чем разбор по `;` (комментарии перед
  // оператором давали ложное `startsWith('--')` и операторы терялись).
  await client.query(fileSql);

  await ensureFirstDirector(client);
  await client.end();
  console.log('Схема БД применена, приложение может стартовать.');
}

main().catch((e) => {
  console.error('Ошибка применения схемы:', e.message || e);
  process.exit(1);
});
