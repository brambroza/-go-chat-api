const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const {
  handlegetDashboardServiceConfig,
  handlesetDashboardServiceConfig,
} = require("../controllers/dashboard.config.controller");

 
router.post("/getconfigdashservice", authMiddleware, handlegetDashboardServiceConfig);

 
router.get("/setconfigdashservice", authMiddleware, handlesetDashboardServiceConfig);

 

module.exports = router;
