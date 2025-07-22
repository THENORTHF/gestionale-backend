// db.js
const { Pool } = require('pg');
require('dotenv').config();

// disabilita SSL in locale se PGSSLMODE=disable, altrimenti lo abilita
const sslEnabled = process.env.PGSSLMODE !== 'disable';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled
    ? { rejectUnauthorized: false }
    : false
});

module.exports = pool;
