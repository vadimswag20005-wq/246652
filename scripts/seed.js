'use strict';

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

function sslFromUrl(url) {
  if (!url) return false;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Задайте DATABASE_URL');
    process.exit(1);
  }

  const username = (
    process.env.SEED_DIRECTOR_USERNAME ||
    process.env.SEED_ADMIN_USERNAME ||
    'director'
  ).trim();
  const password =
    process.env.SEED_DIRECTOR_PASSWORD ||
    process.env.SEED_ADMIN_PASSWORD ||
    'director123';
  const role = 'director';

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslFromUrl(databaseUrl),
  });

  const hash = await bcrypt.hash(password, 10);
  const fullName = process.env.SEED_DIRECTOR_FULLNAME || 'Системный директор';
  const email = process.env.SEED_DIRECTOR_EMAIL || `${username}@local.app`;

  await pool.query(
    `INSERT INTO users (username, full_name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5::user_role, true)
     ON CONFLICT (username) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       is_active = EXCLUDED.is_active`,
    [username, fullName, email, hash, role]
  );

  console.log(`Пользователь «${username}» создан или обновлён (роль: ${role}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
