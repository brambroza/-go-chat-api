require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST, 
  database: process.env.DB_NAME,
  options: {
    encrypt: true, // ถ้า MSSQL เป็น Azure
    trustServerCertificate: true // ตั้งค่าให้ true ถ้าเป็น dev/local
  }
};

async function connectDB() {
  try {
    // ถ้ามี pool อยู่แล้วก็ใช้ตัวเดิม
    if (sql.connected) {
      return sql;
    }
    const pool = await sql.connect(config);
    console.log('Connected to MSSQL');
    return pool;
  } catch (err) {
    console.error('MSSQL Connection Failed: ', err);
    throw err;
  }
}

module.exports = {
  sql,
  connectDB
};
