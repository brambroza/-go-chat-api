const { getIO } = require("../utils/socket");

exports.setServiceTask = async (req, res) => {
  try {
    const io = getIO();
    io.emit("helpdesk:update", {
      service: "update",
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("rateProblem error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.setShortenUrl = async (req, res) => {
  try {
    const { url, alias } = req.body;

    if (!url) {
      return res.status(400).json({ message: "url is required" });
    }

    const params = new URLSearchParams({
      format: "simple",
      url,
    });

    if (alias) {
      params.append("shorturl", alias);
    }

    const response = await fetch(
      `https://is.gd/create.php?${params.toString()}`,
      {
        method: "GET",
      },
    );

    const text = await response.text();

    if (!response.ok || text.startsWith("Error:")) {
      return res.status(400).json({
        message: "Short URL creation failed",
        provider: "is.gd",
        detail: text,
      });
    }

    return res.json({
      shortUrl: text.trim(),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
      detail: error.message,
    });
  }
};
