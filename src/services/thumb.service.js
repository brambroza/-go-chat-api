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

function ffprobeDurationSeconds(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      const sec = Number(data?.format?.duration || 0);
      resolve(Number.isFinite(sec) ? sec : 0);
    });
  });
}

function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function buildOverlaySvg({ width, height, durationText, iconSize }) {
  // iconSize คร่าว ๆ ให้สัมพันธ์กับความกว้าง
  const icon = Math.round(iconSize || Math.max(56, Math.min(96, width * 0.18)));
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);

  // วงกลมดำโปร่ง + สามเหลี่ยม play สีขาว
  const r = Math.round(icon / 2);
  const triW = Math.round(icon * 0.36);
  const triH = Math.round(icon * 0.42);
  const x1 = cx - Math.round(triW * 0.35);
  const y1 = cy - Math.round(triH / 2);
  const x2 = x1;
  const y2 = cy + Math.round(triH / 2);
  const x3 = cx + Math.round(triW * 0.65);
  const y3 = cy;

  // แถบเวลา (มุมขวาล่าง) แบบ youtube-ish
  const margin = Math.round(Math.max(10, width * 0.02));
  const fontSize = Math.round(Math.max(18, Math.min(28, width * 0.05)));
  const paddingX = Math.round(fontSize * 0.55);
  const paddingY = Math.round(fontSize * 0.35);
  const boxH = fontSize + paddingY * 2;
  const boxW = Math.round(
    durationText.length * (fontSize * 0.6) + paddingX * 2
  );
  const boxX = width - margin - boxW;
  const boxY = height - margin - boxH;
  const textX = boxX + paddingX;
  const textY = boxY + Math.round(boxH * 0.72);
  const rx = Math.round(boxH * 0.25);

  return Buffer.from(
    `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <!-- play icon -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(0,0,0,0.45)"/>
  <polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3}" fill="white"/>

  <!-- duration box -->
  <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${rx}" ry="${rx}" fill="rgba(0,0,0,0.65)"/>
  <text x="${textX}" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="white">${durationText}</text>
</svg>`.trim(),
    "utf8"
  );
}

async function addPlayIconAndDuration(jpegPath, durationSeconds, opt = {}) {
  const { quality = 75, iconSize } = opt;

  const base = sharp(jpegPath);
  const meta = await base.metadata();
  const width = meta.width || 480;
  const height = meta.height || 270;

  const durationText = formatDuration(durationSeconds);
  const overlay = buildOverlaySvg({ width, height, durationText, iconSize });

  const outBuf = await base
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  await fs.promises.writeFile(jpegPath, outBuf);
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
    overlay = { enabled: true },
  } = options;

  const key = sha1(`${mp4Url}|${seekSeconds}|${width}|${quality}`);
  const tmpMp4 = path.join(tmpDir, `vid-${key}.mp4`);
  const tmpRaw = path.join(tmpDir, `raw-${key}.jpg`);
  const tmpOut = path.join(tmpDir, `thumb-${key}.jpg`);

  try {
    let durationSec = 0;
    // 1) download mp4
    await downloadToFile(mp4Url, tmpMp4, {
      headers: mp4RequestHeaders,
      timeoutMs,
    });

    if (overlay?.enabled) {
      try {
        durationSec = await ffprobeDurationSeconds(tmpMp4);
      } catch {}
    }

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

    if (overlay?.enabled) {
      await addPlayIconAndDuration(tmpOut, durationSec, {
        quality,
        iconSize: overlay.iconSize,
      });
    }

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

/* async function uploadJpegToServer(jpegPath, opt = {}) {
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

 
  const buffer = await fs.promises.readFile(jpegPath);
  await fs.promises.writeFile(finalPath, buffer);

 
  const publicUrl = publicBaseUrl
    ? `${publicBaseUrl}/${cmpId}/${subDir}/${filename}`
    : null;

  return { finalPath, publicUrl, filename };
} */

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

  // ✅ atomic write: เขียนลง tmp ก่อน แล้วค่อย rename ไปชื่อจริง
  const tmpPath = finalPath + ".tmp";

  const buffer = await fs.promises.readFile(jpegPath);

  try {
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, finalPath);
  } catch (e) {
    // กันไฟล์ .tmp ค้าง
    try {
      await fs.promises.unlink(tmpPath);
    } catch {}
    throw e;
  }

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
    thumb = {}, // option ตอนดึงเฟรม
    upload = {}, // (ตอนนี้คือ option สำหรับการ save ลงดิสก์)
    cleanup = true, // ลบไฟล์ tmp หลังทำเสร็จ
  } = options;

  const jpegPath = await createJpegThumbnailFromMp4Url(mp4Url, thumb);

  try {
    const { publicUrl, finalPath } = await uploadJpegToServer(jpegPath, upload);

    // ถ้าคุณจะเอาไปใช้เป็น previewImageUrl ต้องมี publicUrl (LINE ต้องเข้าถึงได้)
    return { thumbUrl: publicUrl, finalPath };
  } finally {
    if (cleanup) {
      try {
        await fs.promises.unlink(jpegPath);
      } catch {}
    }
  }
}

async function createThumbForLocalMp4(mp4Path, opt = {}) {
  const {
    cmpId = "230015",
    messageId,
    volumeBase = "/usr/src/app/uploads",
    subDir = "linechat",
    ext = ".jpg",
    publicBaseUrl = null,
    seekSeconds = 1,
    width = 480,
    quality = 75,
    overlay = { enabled: true },
  } = opt;

  if (!messageId)
    throw new Error("messageId is required (for thumbnail filename)");
  if (!mp4Path) throw new Error("mp4Path is required");

  // เช็กไฟล์ mp4 มีจริง
  if (!fs.existsSync(mp4Path)) {
    throw new Error(`MP4 file not found: ${mp4Path}`);
  }

  const uploadDirnew = path.join(volumeBase, `${cmpId}/${subDir}`);
  await fs.promises.mkdir(uploadDirnew, { recursive: true });

  const filename = `${messageId}${ext}`; // เช่น 5936....jpg
  const finalThumbPath = path.join(uploadDirnew, filename);

  // ทำ raw ชั่วคราวไว้ใน tmp แล้วค่อย compress ลง finalThumbPath
  const tmpRaw = path.join(
    os.tmpdir(),
    `raw-${sha1(mp4Path)}-${Date.now()}.jpg`
  );

  let durationSec = 0;
  if (overlay?.enabled) {
    try {
      durationSec = await ffprobeDurationSeconds(mp4Path);
    } catch {}
  }
  try {
    // extract 1 frame จาก mp4 local
    await new Promise((resolve, reject) => {
      ffmpeg(mp4Path)
        .inputOptions([`-ss ${seekSeconds}`])
        .outputOptions(["-frames:v 1"])
        .output(tmpRaw)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // resize/compress -> เขียนลงตำแหน่งจริงใน uploads
    await sharp(tmpRaw)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(finalThumbPath);

    if (overlay?.enabled) {
      await addPlayIconAndDuration(finalThumbPath, durationSec, {
        quality,
        iconSize: overlay.iconSize,
      });
    }

    // กันเกิน 1MB
    const stat = fs.statSync(finalThumbPath);
    if (stat.size > 1024 * 1024) {
      const buf = await sharp(finalThumbPath)
        .jpeg({ quality: Math.max(50, quality - 15), mozjpeg: true })
        .toBuffer();
      fs.writeFileSync(finalThumbPath, buf);
    }

    const publicUrl = publicBaseUrl
      ? `${publicBaseUrl}/${cmpId}/${subDir}/${filename}`
      : null;

    return { thumbPath: finalThumbPath, thumbUrl: publicUrl, filename };
  } finally {
    try {
      if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
    } catch {}
  }
}

module.exports = {
  createJpegThumbnailFromMp4Url,
  uploadJpegToServer,
  generateAndUploadThumb,
  createThumbForLocalMp4,
};
