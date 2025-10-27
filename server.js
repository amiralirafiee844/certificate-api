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

const app = express();
app.use(express.json({ limit: '10mb' }));
console.log('9. Express راه‌اندازی شد');

const certDir = path.join(__dirname, 'certificates');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync('/tmp/certificates', { recursive: true });
  console.log('10. پوشه certificates ساخته شد');
}

console.log('11. در حال تنظیم ایمیل...');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
console.log('12. ایمیل تنظیم شد');

// ✅ کلیدها را مستقیم از فایل بخوان
console.log('13. در حال لود کلیدها از فایل...');
let privateKey, publicKey;
try {
  privateKey = fs.readFileSync(path.join(__dirname, 'private.pem'), 'utf8');
  publicKey = fs.readFileSync(path.join(__dirname, 'public.pem'), 'utf8');
  console.log('14. کلیدها با موفقیت لود شدند');
} catch (err) {
  console.error('خطا در لود کلیدها از فایل:', err.message);
  process.exit(1);
}

app.post('/issue', async (req, res) => {
  console.log('درخواست صدور گواهی دریافت شد');
  try {
    const data = req.body;
    if (!data.name || !data.email || !data.course) {
      return res.status(400).json({ error: 'نام، ایمیل و دوره الزامی است' });
    }

    const certId = crypto.randomUUID();
    const issuedAt = new Date().toLocaleDateString('fa-IR');

    const certificate = {
      id: certId,
      data,
      issuedAt: new Date().toISOString(),
    };

    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(certificate));
    certificate.signature = sign.sign(privateKey, 'base64');

    const verifyUrl = `${process.env.VERIFY_URL}?cert=${encodeURIComponent(JSON.stringify(certificate))}`;

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const pdfPath = path.join(certDir, `${certId}.pdf`);
    const pdfStream = fs.createWriteStream(pdfPath);
    doc.pipe(pdfStream);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8f9fa');

   // فونت فارسی – استفاده از فونت سیستمی (DejaVuSans)
const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
if (!fs.existsSync(fontPath)) {
  console.error('فونت DejaVuSans پیدا نشد. در حال استفاده از فونت پیش‌فرض...');
  // اگر فونت نبود، از فونت داخلی PDFKit استفاده کن
  doc.font('Helvetica');
} else {
  doc.font(fontPath);
  console.log('فونت DejaVuSans با موفقیت لود شد');
}


    doc.fontSize(32).fillColor('#1a5fb4').text('گواهی پایان دوره', { align: 'center' }).moveDown(2);
    doc.fontSize(18).fillColor('#333');
    doc.text(`این گواهی به ${data.name} اعطا می‌شود`, { align: 'center' });
    doc.moveDown(0.5);
    doc.text(`برای شرکت در دوره ${data.course}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.text(`تاریخ صدور: ${issuedAt}`, { align: 'center' });

    try {
      const qrImage = await QRCode.toDataURL(verifyUrl);
      doc.image(qrImage, doc.page.width - 150, doc.page.height - 150, { width: 100 });
    } catch (err) {
      console.error('خطا در QR:', err);
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
        console.log('ایمیل با موفقیت ارسال شد');
        res.json({
          success: true,
          certificate,
          pdfUrl: `/certificates/${certId}.pdf`,
          verifyUrl
        });
      } catch (err) {
        console.error('خطا در ارسال ایمیل:', err.message);
        res.status(500).json({ error: 'خطا در ارسال ایمیل' });
      }
    });

    pdfStream.on('error', (err) => {
      console.error('خطا در نوشتن PDF:', err);
      res.status(500).json({ error: 'خطا در ساخت PDF' });
    });

  } catch (err) {
    console.error('خطا در صدور گواهی:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/verify', (req, res) => {
  console.log('درخواست تأیید گواهی');
  try {
    const { signature, ...data } = req.body;
    const verify = crypto.createVerify('SHA256');
    verify.update(JSON.stringify(data));
    const isValid = verify.verify(publicKey, signature, 'base64');
    res.json({ valid: isValid });
  } catch (err) {
    console.error('خطا در تأیید:', err.message);
    res.status(500).json({ error: 'خطا در تأیید' });
  }
});

app.use('/certificates', express.static(certDir));

const PORT = process.env.PORT || 3000;
console.log(`15. در حال راه‌اندازی سرور روی پورت ${PORT}...`);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API در پورت ${PORT} فعال است`);
  console.log(`آدرس لوکال: http://127.0.0.1:${PORT}`);
  console.log(`آدرس شبکه: http://192.168.200.9:${PORT}`);
  console.log(`تأیید: ${process.env.VERIFY_URL}`);
});
