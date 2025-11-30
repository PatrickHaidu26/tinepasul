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
app.set('trust proxy', true);
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
await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB });
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
      subject: 'Codul tău de verificare',
      text: `Codul tău este ${code}. Acesta expiră în 10 minute.`
    });
    console.log(`[send-code] sent to ${email}`);
    res.json({ ok: true, message: 'Am trimis un cod de 6 cifre.' });
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
      return res.status(400).json({ ok: false, message: 'Codul este invalid sau expirat.' });
    }
    codes.delete(key);

    // find user + pdf
    const user = await User.findOne({ email: key })
      .select('pdfBuffer pdfFilename pdfMime email')
      .lean();

    if (!user) return res.status(404).json({ ok: false, message: 'Adresa de email nu corespunde niciunui utilizator.' });
    if (!user.pdfBuffer?.buffer && !Buffer.isBuffer(user.pdfBuffer)) {
      return res.status(404).json({ ok: false, message: 'Nu există diplomă pentru acest utilizator.' });
    }

    const pdfBuf = Buffer.isBuffer(user.pdfBuffer)
      ? user.pdfBuffer
      : Buffer.from(user.pdfBuffer.buffer);

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Diploma ta în format PDF',
      text: 'Mulțumim! Aici este diploma ta în format PDF.',
      attachments: [{
        filename: user.pdfFilename || 'document.pdf',
        content: pdfBuf,
        contentType: user.pdfMime || 'application/pdf'
      }]
    });

    res.json({ ok: true, message: 'Am trimis diploma ta în format PDF.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'Nu am putut trimite diploma.' });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
