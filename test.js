const mysql = require("mysql2/promise"); // Use the promise-compatible version
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});


async function testQuery() {
  try {
    const [results] = await db.query(
      `
      SELECT s.id, s.site_url, s.niche_id, n.name AS niche_name, s.backlinks_generated
        FROM submitted_sites s
        JOIN niches n ON s.niche_id = n.id
       WHERE s.backlinks_generated < ?
         AND s.status IN ('approved', 'pending')
       ORDER BY s.created_at ASC
       LIMIT 1
      `,
      [MAX_BACKLINKS]
    );

    console.log("Query results:", results);
  } catch (err) {
    console.error("❌ Database error:", {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      sql: err.sql,
    });
  }
}

testQuery();