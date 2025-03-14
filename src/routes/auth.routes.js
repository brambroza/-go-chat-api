const express = require('express');
const { registerUser, loginUser } = require('../controllers/auth.controller');
const router = express.Router();



/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: ลงทะเบียนผู้ใช้ใหม่
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Bad request
 */
router.post('/register', registerUser);


/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: ล็อกอิน
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Return JWT token
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', loginUser);


module.exports = router;


