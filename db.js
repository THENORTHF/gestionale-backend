// db.js
require('dotenv').config();
const { Pool } = require('pg');

let pool;

if (process.env.DATABASE_URL) {
  // PRODUZIONE su Railway: usa un unico connection string e SSL
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  // SVILUPPO in locale: usa le singole variabili (se le hai)
  pool = new Pool({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

module.exports = {
  query: (text, params) => pool.query(text, params),
};
