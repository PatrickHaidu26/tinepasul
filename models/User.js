import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    pdfFilename: { type: String, default: 'document.pdf' },
    pdfMime: { type: String, default: 'application/pdf' },
    pdfBuffer: { type: Buffer, required: true } // simple single PDF stored here
  },
  { timestamps: true }
);

// always store lowercased email
UserSchema.pre('save', function (next) {
  if (this.isModified('email') && typeof this.email === 'string') {
    this.email = this.email.toLowerCase();
  }
  next();
});

export default mongoose.model('User', UserSchema);