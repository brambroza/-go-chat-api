const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// กำหนด options เพื่ออธิบายเอกสาร OpenAPI
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'My Chat API',
      version: '1.0.0',
      description: 'API documentation for Chat Service (LINE, FB, TikTok, Shopee, Lazada, WhatsApp, etc.)'
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Local server'
      }
      // ถ้ามี production/staging server ก็เพิ่มได้
    ]
  },
  // ส่วนนี้ใช้บอกว่าจะให้ swagger-jsdoc ไปอ่านไฟล์ไหนเพื่อเก็บ comment
  // globs หรือ patterns ของไฟล์ที่มี Swagger comment
  apis: [
    './src/routes/*.js', 
    './src/controllers/*.js'
  ]
};

// สร้างสเปค (spec) ขึ้นมา
const specs = swaggerJsdoc(options);

// สร้างฟังก์ชันสำหรับใช้งานใน app
function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
}

module.exports = { setupSwagger };
