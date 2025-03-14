exports.verifySignature = (authHeader, body) => {
    // Shopee อาจส่ง signature มาใน header 
    // แล้วเราต้องใช้ secret ที่ได้รับตอน register
    // ตัวอย่าง pseudo-code
    // const mySignature = createHmac('sha256', process.env.SHOPEE_SECRET).update(JSON.stringify(body)).digest('base64');
    // if (authHeader !== mySignature) throw new Error('Invalid signature');
  };
  