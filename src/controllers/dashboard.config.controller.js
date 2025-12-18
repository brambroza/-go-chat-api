
const { connectDB, sql } = require("../config/database");

exports.handlesetDashboardServiceConfig = async (req, res) => {
  try {
    const { cmpId, key, config, updatedBy } = req.body ?? {};
    if (!cmpId || !key || !config)
      return res.status(400).json({ error: "cmpId, key, config are required" });

    const configJson = JSON.stringify(config);

    const pool = await connectDB();
    const rs = await pool
      .request()
      .input("CmpId", sql.NVarChar(20), String(cmpId))
      .input("DashboardKey", sql.NVarChar(100), String(key))
      .input("ConfigJson", sql.NVarChar(sql.MAX), configJson)
      .input(
        "UpdatedBy",
        sql.NVarChar(100),
        updatedBy ? String(updatedBy) : null
      )
      .execute("dbo.UpsertDashboardServiceConfig");

    const row = rs.recordset?.[0];
    return res.json({
      ok: true,
      meta: {
        version: row.Version,
        updatedAt: row.UpdatedAt,
        updatedBy: row.UpdatedBy,
      },
      config: JSON.parse(row.ConfigJson),
    });
  } catch (error) {
    console.error("Error in handlesetDashboardServiceConfig:", error);
    res
      .status(500)
      .json({ error: "An error occurred while saving configuration" });
  }
};

exports.handlegetDashboardServiceConfig = async (req, res) => {
  try {
    const cmpId = String(req.query.cmpId || "");
    const key = String(req.query.key || "");
    if (!cmpId || !key)
      return res.status(400).json({ error: "cmpId and key are required" });

    const pool = await connectDB();
    const rs = await pool
      .request()
      .input("CmpId", sql.NVarChar(20), cmpId)
      .input("DashboardKey", sql.NVarChar(100), key).query(`
        SELECT TOP 1 ConfigId, CmpId, DashboardKey, Version, UpdatedAt, UpdatedBy, ConfigJson
        FROM dbo.Dashboard_Service_Configs
        WHERE CmpId=@CmpId AND DashboardKey=@DashboardKey AND IsActive=1
      `);

    if (rs.recordset.length === 0)
      return res.json({ found: false, config: null });

    const row = rs.recordset[0];
    return res.json({
      found: true,
      meta: {
        version: row.Version,
        updatedAt: row.UpdatedAt,
        updatedBy: row.UpdatedBy,
      },
      config: JSON.parse(row.ConfigJson),
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message ?? "server error" });
  }
};
