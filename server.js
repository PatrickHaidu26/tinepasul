import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import User from './models/User.js';

const app = express();
app.use(express.json());
// --- CORS using library (reflect any origin, including file:// which is 'null') ---
app.use(cors({
  origin: 'https://tinepasul.info',
}));
// Ensure preflight requests are handled for any route
app.use(express.static('public'));

// --- rate limit (tweak for prod) ---
const limiter = rateLimit({ windowMs: 60_000, max: 20, skip: (req) => req.method === 'OPTIONS' });
app.use('/api/', limiter);

// --- connect Mongo ---
await mongoose.connect(process.env.MONGO_URI);
console.log('MongoDB connected');

// --- mail transport (SMTP). Swap to SendGrid/Postmark if you prefer. ---
const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 10000);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  auth: {type: 'login', user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  
});

// --- validation ---
const emailSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/)
});

// --- ephemeral code store (use Redis with TTL in prod) ---
const codes = new Map(); // email(lowercased) -> { code, expiresAt }
const lc = s => (s || '').toLowerCase();

// --- routes ---
app.post('/api/send-code', async (req, res) => {
  try {
    const { email } = emailSchema.parse(req.body);
    const key = lc(email);
    const code = (Math.floor(100000 + Math.random() * 900000)).toString();
    const expiresAt = Date.now() + 10 * 60_000; // 10 minutes
    codes.set(key, { code, expiresAt });
    
    console.log(`[send-code] sending to ${email}`);
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Your verification code',
      text: `Your code is ${code}. It expires in 10 minutes.`
    });
    console.log(`[send-code] sent to ${email}`);
    res.json({ ok: true, message: 'We sent you a 6-digit code.' });
  } catch (e) {
    console.error('[send-code] error', e);
    // Differentiate validation vs SMTP issues
    const status = e?.name === 'ZodError' ? 400 : 502;
    res.status(status).json({ ok: false, message: e.message || 'Failed to send code' });
  }
});

app.post('/api/verify-and-send', async (req, res) => {
  try {
    const { email, code } = verifySchema.parse(req.body);
    const key = lc(email);
    const entry = codes.get(key);

    if (!entry || entry.code !== code || Date.now() > entry.expiresAt) {
      return res.status(400).json({ ok: false, message: 'Invalid or expired code.' });
    }
    codes.delete(key);

    // find user + pdf
    const user = await User.findOne({ email: key })
      .select('pdfBuffer pdfFilename pdfMime email')
      .lean();

    if (!user) return res.status(404).json({ ok: false, message: 'No user for this email.' });
    if (!user.pdfBuffer?.buffer && !Buffer.isBuffer(user.pdfBuffer)) {
      return res.status(404).json({ ok: false, message: 'No PDF stored for this user.' });
    }

    const pdfBuf = Buffer.isBuffer(user.pdfBuffer)
      ? user.pdfBuffer
      : Buffer.from(user.pdfBuffer.buffer);

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Your requested PDF',
      text: 'Thanks! Here is your PDF.',
      attachments: [{
        filename: user.pdfFilename || 'document.pdf',
        content: pdfBuf,
        contentType: user.pdfMime || 'application/pdf'
      }]
    });

    res.json({ ok: true, message: 'PDF sent! Check your inbox.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'Could not send email.' });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));