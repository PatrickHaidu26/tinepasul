import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import User from './models/User.js';

const [,, emailArg, pdfPathArg] = process.argv;
if (!emailArg || !pdfPathArg) {
  console.error('Usage: node seed.js <email> <path-to-pdf>');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB });
  const abs = path.resolve(pdfPathArg);
  const buf = fs.readFileSync(abs);

  const email = emailArg.toLowerCase();
  await User.findOneAndUpdate(
    { email },
    { email, pdfFilename: path.basename(abs), pdfMime: 'application/pdf', pdfBuffer: buf },
    { upsert: true, new: true }
  );

  console.log(`Seeded PDF for ${email}: ${abs}`);
  await mongoose.disconnect();
})();