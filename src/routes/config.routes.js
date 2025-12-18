const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const {
  handlegetDashboardServiceConfig,
  handlesetDashboardServiceConfig,
} = require("../controllers/dashboard.config.controller");

 
router.get("/getconfigdashservice", authMiddleware, handlegetDashboardServiceConfig);

 
router.post("/setconfigdashservice", authMiddleware, handlesetDashboardServiceConfig);

 

module.exports = router;
