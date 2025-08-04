// ========== HELPER FUNCTIONS ==========
const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter with simplified configuration
const createTransporter = async () => {
  // Check if credentials are available
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('❌ Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in .env file');
    return null;
  }

  // Use a single, reliable Gmail configuration
  const config = {
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    secure: true,
    port: 465
  };

  try {
    const transporter = nodemailer.createTransport(config);
    await transporter.verify();
    return transporter;
  } catch (error) {
    console.error('❌ Email configuration failed:', error.message);
    return null;
  }
};

// Generate OTP for email verification
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate secure reset token
const generateResetToken = () => {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
};

// Send verification email
const sendVerificationEmail = async (email, otp, username) => {
  try {
    const transporter = await createTransporter();
    if (!transporter) {
      console.error('❌ Could not create email transporter');
      return false;
    }

    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@vintique.com',
      to: email,
      subject: 'Vintique - Email Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #FFD700, #FFA500); padding: 20px; border-radius: 10px; text-align: center;">
            <h1 style="color: #333; margin: 0;">Vintique</h1>
            <p style="color: #333; margin: 10px 0;">Email Verification</p>
          </div>
          <div style="padding: 20px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2 style="color: #333;">Hello ${username}!</h2>
            <p style="color: #555; line-height: 1.6;">Thank you for registering with Vintique. To complete your registration, please use the verification code below:</p>
            <div style="background: #fff; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
              <h1 style="color: #FFD700; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
            </div>
            <p style="color: #555; line-height: 1.6;">This code will expire in 10 minutes. If you didn't request this verification, please ignore this email.</p>
            <p style="color: #555; line-height: 1.6;">Best regards,<br>The Vintique Team</p>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error.message);
    return false;
  }
};

// Format date helper
const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Calculate time ago
const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  
  return Math.floor(seconds) + ' seconds ago';
};

// Send password reset email
const sendPasswordResetEmail = async (email, resetToken, username) => {
  try {
    const transporter = await createTransporter();
    if (!transporter) {
      console.error('❌ Could not create email transporter');
      return false;
    }

    const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@vintique.com',
      to: email,
      subject: 'Vintique - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #FFD700, #FFA500); padding: 20px; border-radius: 10px; text-align: center;">
            <h1 style="color: #333; margin: 0;">Vintique</h1>
            <p style="color: #333; margin: 10px 0;">Password Reset Request</p>
          </div>
          <div style="padding: 20px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2 style="color: #333;">Hello ${username}!</h2>
            <p style="color: #555; line-height: 1.6;">We received a request to reset your password for your Vintique account.</p>
            <p style="color: #555; line-height: 1.6;">Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: #FFD700; color: #333; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #555; line-height: 1.6;">This link will expire in 1 hour for security reasons.</p>
            <p style="color: #555; line-height: 1.6;">If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
            <p style="color: #555; line-height: 1.6;">Best regards,<br>The Vintique Team</p>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Password reset email sending error:', error.message);
    return false;
  }
};

module.exports = {
  generateOTP,
  generateResetToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
  formatDate,
  timeAgo
};
