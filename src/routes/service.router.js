const express = require("express");
const router = express.Router();
const { setServiceTask } = require("../controllers/service.controller");

router.post("/setproblem", setServiceTask);

module.exports = router;
