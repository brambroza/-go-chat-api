# เลือก base image เป็น Node
FROM node:18-alpine

# สร้างโฟลเดอร์ app
WORKDIR /usr/src/app

# คัดลอก package.json และ package-lock.json เข้าไป
COPY package*.json ./

# ติดตั้ง dependencies
RUN npm install

# คัดลอกซอร์สโค้ดทั้งหมด
COPY . .

# ระบุ port ที่จะ expose
EXPOSE 3000

# คำสั่งเมื่อ container start
CMD [ "node", "src/app.js" ]
