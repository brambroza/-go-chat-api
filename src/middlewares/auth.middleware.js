const { verifyToken } = require('../utils/jwt.util');

module.exports = (req, res, next) => {
  const authorization = req.headers['authorization'];
  if (!authorization) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authorization.split(' ')[1]; // Bearer <token>
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ message: 'Invalid token' });
  }

  req.user = decoded; // เพิ่ม user เข้า req
  next();
};
