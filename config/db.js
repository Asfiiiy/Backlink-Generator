const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config();

// ✅ Use connection pooling for better performance & avoid blocking
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3307,
  waitForConnections: true,
  connectionLimit: 10, // ✅ Allow up to 10 concurrent connections
  queueLimit: 0, // No limit on request queue
});

// Export as a promise-based connection
module.exports = pool.promise();
