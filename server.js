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

// ایجاد برنامه Express
const app = express();
app.use(express.json({ limit: '10mb' }));
console.log('9. Express راه‌اندازی شد');

// مسیر ذخیره گواهی‌ها
const certDir = path.join(__dirname, 'certificates');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
  console.log('10. پوشه certificates ساخته شد');
}

// تنظیمات ایمیل
console.log('11. در حال تنظیم ایمیل...');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
console.log('12. ایمیل تنظیم شد');

// کلیدهای RSA
console.log('13. در حال لود کلیدها...');
let privateKey, publicKey;
try {
  privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
  publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
  console.log('14. کلیدها با موفقیت لود شدند');
} catch (err) {
  console.error('خطا در لود کلیدها:', err.message);
  process.exit(1);
}

// مسیر صدور گواهی
app.post('/api/issue', async (req, res) => {
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

    // ساخت PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const pdfPath = path.join(certDir, `${certId}.pdf`);
    const pdfStream = fs.createWriteStream(pdfPath);
    doc.pipe(pdfStream);

    // پس‌زمینه و فونت
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8f9fa');
    const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (!fs.existsSync(fontPath)) {
      console.error('فونت DejaVuSans پیدا نشد. استفاده از فونت پیش‌فرض...');
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
  } catch (err) {
    console.error('خطا در صدور گواهی:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// مسیر تأیید گواهی
app.post('/api/verify', (req, res) => {
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

// سرو فایل‌های PDF
app.use('/certificates', express.static(certDir));

// راه‌اندازی سرور
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API در پورت ${PORT} فعال است`);
  console.log(`🌐 آدرس Railway: ${process.env.VERIFY_URL || 'تنظیم نشده'}`);
});
