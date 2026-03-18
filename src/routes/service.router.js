const express = require("express");
const router = express.Router();
const {
  setServiceTask,
  setShortenUrl,
} = require("../controllers/service.controller");

router.post("/setproblem", setServiceTask);
router.post("/shortedurl", setShortenUrl);

module.exports = router;
