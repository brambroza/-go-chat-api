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

    if (!url || !url.trim()) {
      return res.status(400).json({ message: "URL is required" });
    }

    // cleanuri ใช้แค่ url
    // alias รับมาได้ แต่ยังไม่ได้ใช้
    void alias;

    const formData = new URLSearchParams();
    formData.append("url", url);

    const providerResponse = await fetch(
      "https://cleanuri.com/api/v1/shorten",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      },
    );

    const rawText = await providerResponse.text();

    let providerData;
    try {
      providerData = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        message: "Invalid response from short URL provider",
        raw: rawText,
      });
    }

    if (!providerResponse.ok) {
      return res.status(502).json({
        message:
          providerData.error || `Provider error (${providerResponse.status})`,
      });
    }

    if (!providerData.result_url) {
      return res.status(502).json({
        message: providerData.error || "Short URL provider failed",
      });
    }

    return res.json({
      shortUrl: providerData.result_url,
    });
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
};
