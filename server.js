require('dotenv').config();
console.log('1. dotenv لود شد');

const express = require('express');
console.log('2. express لود شد');

const PDFDocument = require('pdfkit');
console.log('3. pdfkit لود شد');

const QRCode = require('qrcode');
console.log('4. qrcode لود شد');

const fs = require('fs');
console.log('5. fs لود شد');

const path = require('path');
console.log('6. path لود شد');

const crypto = require('crypto');
console.log('7. crypto لود شد');

const nodemailer = require('nodemailer');
console.log('8. nodemailer لود شد');

// --- تنظیمات Railway ---
const app = express();
app.use(express.json({ limit: '10mb' }));
console.log('9. Express راه‌اندازی شد');

// پوشه موقت برای PDF (در Railway فقط /tmp قابل نوشتن است)
const certDir = '/tmp/certificates';
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
  console.log('10. پوشه /tmp/certificates ساخته شد');
}

// --- کلیدها از Environment Variables ---
console.log('11. در حال لود کلیدها از متغیرهای محیطی...');
let privateKey, publicKey;

try {
  privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
  publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
  if (!privateKey || !publicKey) throw new Error('کلیدها خالی هستند');
  console.log('12. کلیدها با موفقیت لود شدند');
} catch (err) {
  console.error('❌ خطا در لود کلیدها:', err.message);
  process.exit(1);
}

// --- تنظیم ایمیل ---
console.log('13. در حال تنظیم ایمیل...');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
console.log('14. ایمیل تنظیم شد');

// --- Route اصلی برای تست ---
app.get('/', (req, res) => {
  res.json({
    message: 'API گواهی دیجیتال من‌لاگ فعال است!',
    endpoints: {
      issue: 'POST /api/issue',
      verify: 'POST /api/verify',
      pdf: 'GET /certificates/:id.pdf'
    },
    domain: 'https://certificate-api-production.up.railway.app'
  });
});

// --- صدور گواهی ---
app.post('/api/issue', async (req, res) => {
  console.log('📥 درخواست صدور گواهی دریافت شد');
  try {
    const data = req.body;
    if (!data.name || !data.email || !data.course) {
      return res.status(400).json({ error: 'نام، ایمیل و دوره الزامی است' });
    }

    const certId = crypto.randomUUID().split('-')[0];
    const issuedAt = new Date().toISOString();

    const certificate = { id: certId, data, issuedAt };
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(certificate));
    certificate.signature = sign.sign(privateKey, 'base64');

    const verifyUrl = `${process.env.VERIFY_URL}?cert=${encodeURIComponent(JSON.stringify(certificate))}`;
    const pdfPath = path.join(certDir, `${certId}.pdf`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const pdfStream = fs.createWriteStream(pdfPath);
    doc.pipe(pdfStream);

    // فونت فارسی (اگر نبود از Helvetica)
    const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (fs.existsSync(fontPath)) {
      doc.font(fontPath);
    } else {
      doc.font('Helvetica');
    }

    doc.fontSize(32).fillColor('#1a5fb4').text('گواهی پایان دوره', { align: 'center' }).moveDown(2);
    doc.fontSize(18).fillColor('#333');
    doc.text(`این گواهی به ${data.name} اعطا می‌شود`, { align: 'center' });
    doc.moveDown(0.5);
    doc.text(`برای شرکت در دوره ${data.course}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.text(`تاریخ صدور: ${new Date(issuedAt).toLocaleDateString('fa-IR')}`, { align: 'center' });

    // QR کد
    try {
      const qrImage = await QRCode.toDataURL(verifyUrl);
      doc.image(qrImage, doc.page.width - 150, doc.page.height - 150, { width: 100 });
    } catch (err) {
      doc.text('QR کد قابل تولید نیست', { align: 'center' });
    }

    doc.end();

    pdfStream.on('finish', async () => {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: data.email,
        subject: `گواهی ${data.course}`,
        html: `
          <h2>تبریک ${data.name}!</h2>
          <p>گواهی شما با موفقیت صادر شد.</p>
          <p><a href="${verifyUrl}">تأیید مدرک</a></p>
        `,
        attachments: [{ filename: 'گواهی.pdf', path: pdfPath }]
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log('📤 ایمیل ارسال شد');
        res.json({
          success: true,
          certificate,
          pdfUrl: `https://certificate-api-production.up.railway.app/certificates/${certId}.pdf`,
          verifyUrl
        });
      } catch (err) {
        console.error('خطا در ارسال ایمیل:', err.message);
        res.status(500).json({ error: 'خطا در ارسال ایمیل' });
      }
    });

    pdfStream.on('error', (err) => {
      console.error('خطا در نوشتن PDF:', err.message);
      res.status(500).json({ error: 'خطا در ساخت PDF' });
    });

  } catch (err) {
    console.error('خطا در صدور گواهی:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- تأیید گواهی ---
app.post('/api/verify', (req, res) => {
  console.log('🔍 درخواست تأیید گواهی دریافت شد');
  try {
    const { signature, ...data } = req.body;
    const verify = crypto.createVerify('SHA256');
    verify.update(JSON.stringify(data));
    const isValid = verify.verify(publicKey, signature, 'base64');
    res.json({ valid: isValid });
  } catch (err) {
    console.error('❌ خطا در تأیید گواهی:', err.message);
    res.status(500).json({ error: 'خطا در تأیید' });
  }
});

// --- سرو فایل‌های PDF ---
app.get('/certificates/:filename', (req, res) => {
  const filePath = path.join(certDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'گواهی پیدا نشد' });
  }
});

// --- پورت Railway ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API روی پورت ${PORT} فعال شد`);
  console.log(`🌐 آدرس: https://certificate-api-production.up.railway.app`);
});
