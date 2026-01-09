
const { getIO } = require("../utils/socket");


exports.setServiceTask = async (req, res) => { 
  try { 
    const io = getIO();
    io.emit("helpdesk:update", {
       "service":"update"
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("rateProblem error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};