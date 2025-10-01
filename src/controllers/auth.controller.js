/* const bcrypt = require('bcrypt'); */
const crypto = require('crypto');
const { generateToken } = require('../utils/jwt.util');
const { connectDB, sql } = require('../config/database');

function verifyPassword(hashedPassword, password) {
  // สมมติว่า hashedPassword จะมีรูปแบบ "BASE64_SALT.BASE64_HASHED"
  const parts = hashedPassword.split('.', 2);
  if (parts.length !== 2) {
    return false;
  }

  const salt = Buffer.from(parts[0], 'base64');
  const passwordHashed = parts[1];

  // ทำ PBKDF2 ด้วยพารามิเตอร์เหมือน .NET
  const derivedKey = crypto.pbkdf2Sync(
    password,
    salt,
    10000,               // iterationCount
    32,                  // numBytesRequested (32 ไบต์)
    'sha512'             // HMACSHA512
  );

  // แปลงผลลัพธ์กลับเป็น base64
  const hashed = derivedKey.toString('base64');

  // เทียบข้อความที่ได้
  return passwordHashed === hashed;
}


exports.registerUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    const pool = await connectDB();
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.request()
      .input('username', sql.VarChar, username)
      .input('password', sql.VarChar, hashedPassword)
      .query(`
        INSERT INTO Users (username, password) 
        VALUES (@username, @password)
      `);

    return res.status(201).json({ message: 'User registered.' });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.loginUser = async (req, res) => {
  try {
    console.log("req.body" ,req.body);
    const { username, password } = req.body;
    const pool = await connectDB();

    const result = await pool.request()
      .input('username', sql.VarChar, username)
      .query(`
        SELECT * FROM [dbo].[Accounts] WHERE Username = @username
      `);

    const user = result.recordset[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials user' });
    }
    console.log("2 hashpassword" , user.Password);
/*     const match = await bcrypt.compare(password, user.password); */
    const match = verifyPassword(user.Password, password);

    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken({ userId: user.id, username: user.username });
    const cmpId = user.CmpId;
    const refreshToken = user.RefreshToken;
   
    return res.json({ token , cmpId ,refreshToken });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
