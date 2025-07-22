// db.js
// ------------
// Usa esclusivamente DATABASE_URL in produzione (Railway)
// e in locale puoi continuare a definire DATABASE_URL in .env se vuoi.

const { Pool } = require('pg');

// La variabile DATABASE_URL deve essere presente su Railway (controlla in Settings → Variables)
if (!process.env.DATABASE_URL) {
  console.error('⚠️ Errore: variabile DATABASE_URL non trovata.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
