if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: { rejectUnauthorized: false },
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
