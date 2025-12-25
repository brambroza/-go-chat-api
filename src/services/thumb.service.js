// thumb.service.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const sharp = require("sharp");

ffmpeg.setFfmpegPath(ffmpegStatic);

function sha1(str) {
  return crypto.createHash("sha1").update(str).digest("hex");
}

async function downloadToFile(
  url,
  outPath,
  { headers = {}, timeoutMs = 20000 } = {}
) {
  const resp = await axios.get(url, {
    responseType: "stream",
    timeout: timeoutMs,
    headers,
  });

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outPath);
    resp.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });
}

/**
 * สร้าง thumbnail (JPEG) จาก mp4 URL แล้วคืน path ของไฟล์ jpg ที่สร้างได้
 */
async function createJpegThumbnailFromMp4Url(mp4Url, options = {}) {
  const {
    seekSeconds = 1,
    width = 480,
    quality = 75,
    mp4RequestHeaders = {},
    timeoutMs = 20000,
    tmpDir = os.tmpdir(),
  } = options;

  const key = sha1(`${mp4Url}|${seekSeconds}|${width}|${quality}`);
  const tmpMp4 = path.join(tmpDir, `vid-${key}.mp4`);
  const tmpRaw = path.join(tmpDir, `raw-${key}.jpg`);
  const tmpOut = path.join(tmpDir, `thumb-${key}.jpg`);

  try {
    // 1) download mp4
    await downloadToFile(mp4Url, tmpMp4, {
      headers: mp4RequestHeaders,
      timeoutMs,
    });

    // 2) extract 1 frame
    await new Promise((resolve, reject) => {
      ffmpeg(tmpMp4)
        .inputOptions([`-ss ${seekSeconds}`])
        .outputOptions(["-frames:v 1"])
        .output(tmpRaw)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // 3) resize/compress jpeg
    await sharp(tmpRaw)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(tmpOut);

    // (option) ถ้าอยากชัวร์ < 1MB
    const stat = fs.statSync(tmpOut);
    if (stat.size > 1024 * 1024) {
      const buf = await sharp(tmpOut)
        .jpeg({ quality: Math.max(50, quality - 15), mozjpeg: true })
        .toBuffer();
      fs.writeFileSync(tmpOut, buf);
    }

    return tmpOut;
  } finally {
    // cleanup ไฟล์ชั่วคราวบางตัว (คง tmpOut ไว้ให้ caller ใช้)
    for (const p of [tmpMp4, tmpRaw]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  }
}

async function uploadJpegToServer(jpegPath, opt = {}) {
  const {
    cmpId = "230015",
    messageId,
    volumeBase = "/usr/src/app/uploads",
    subDir = "linechat",
    ext = ".jpg",
    publicBaseUrl = null,
  } = opt;

  if (!messageId)
    throw new Error("messageId is required (for thumbnail filename)");

  const uploadDirnew = path.join(volumeBase, `${cmpId}/${subDir}`);
  await fs.promises.mkdir(uploadDirnew, { recursive: true });

  const filename = `${messageId}${ext}`;
  const finalPath = path.join(uploadDirnew, filename);

  // แบบเดียวกับที่คุณใช้ (buffer -> writeFile)
  const buffer = await fs.promises.readFile(jpegPath);
  await fs.promises.writeFile(finalPath, buffer);

  // คืน public url ถ้าคุณมี base url สำหรับ serve ไฟล์นี้
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl}/${cmpId}/${subDir}/${filename}`
    : null;

  return { finalPath, publicUrl, filename };
}

/**
 * ฟังก์ชันหลัก: สร้าง thumb จาก mp4Url แล้วอัปโหลด -> คืน thumbUrl
 */
async function generateAndUploadThumb(mp4Url, options = {}) {
  const {
    thumb = {},       // option ตอนดึงเฟรม
    upload = {},      // (ตอนนี้คือ option สำหรับการ save ลงดิสก์)
    cleanup = true,   // ลบไฟล์ tmp หลังทำเสร็จ
  } = options;

  const jpegPath = await createJpegThumbnailFromMp4Url(mp4Url, thumb);

  try {
    const { publicUrl, finalPath } = await uploadJpegToServer(jpegPath, upload);

    // ถ้าคุณจะเอาไปใช้เป็น previewImageUrl ต้องมี publicUrl (LINE ต้องเข้าถึงได้)
    return { thumbUrl: publicUrl, finalPath };
  } finally {
    if (cleanup) {
      try { await fs.promises.unlink(jpegPath); } catch {}
    }
  }
}


module.exports = {
  createJpegThumbnailFromMp4Url,
  uploadJpegToServer,
  generateAndUploadThumb,
};
