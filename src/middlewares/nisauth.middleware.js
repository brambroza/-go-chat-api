// NIS auth middleware (M-RT1) — เหมือน auth.middleware เดิม แต่ verify ด้วย verifyNisToken
// (token NIS ออกโดย coreapi → ต้องเช็คกับ JWT_NIS_SECRET ไม่ใช่ JWT_SECRET ของ chat)
const { verifyNisToken } = require("../utils/nisjwt.util");

module.exports = (req, res, next) => {
  const authorization = req.headers["authorization"];
  if (!authorization) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authorization.split(" ")[1]; // Bearer <token>
  const decoded = verifyNisToken(token);

  if (!decoded) {
    return res.status(401).json({ message: "Invalid token" });
  }

  req.user = decoded; // { sub, role, aid, sid }
  next();
};
