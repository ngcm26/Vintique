// ========== HELPER FUNCTIONS ==========
const nodemailer = require('nodemailer');
require('dotenv').config();

// Debug environment variables
const debugEnvVars = () => {
  console.log('🔍 Environment Variables Debug:');
  console.log('  EMAIL_USER:', process.env.EMAIL_USER ? `"${process.env.EMAIL_USER}"` : 'NOT SET');
  console.log('  EMAIL_PASS:', process.env.EMAIL_PASS ? 'SET (length: ' + process.env.EMAIL_PASS.length + ')' : 'NOT SET');
  console.log('  NODE_ENV:', process.env.NODE_ENV || 'NOT SET');
  console.log('  PORT:', process.env.PORT || 'NOT SET');
  
  // Check if .env file exists
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  console.log('  .env file exists:', fs.existsSync(envPath));
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const hasEmailUser = envContent.includes('EMAIL_USER');
    const hasEmailPass = envContent.includes('EMAIL_PASS');
    console.log('  .env contains EMAIL_USER:', hasEmailUser);
    console.log('  .env contains EMAIL_PASS:', hasEmailPass);
  }
};

// Create transporter with multiple fallback options
const createTransporter = async () => {
  // Debug environment variables first
  debugEnvVars();
  
  // Check if credentials are available
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('❌ Email credentials not configured. Please set EMAIL_USER and EMAIL_PASS in .env file');
    console.error('💡 Make sure your .env file is in the root directory and contains:');
    console.error('   EMAIL_USER=your-gmail@gmail.com');
    console.error('   EMAIL_PASS=your-app-password');
    return null;
  }

  console.log('📧 Email configuration:', {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS ? '***configured***' : 'NOT SET'
  });

  // Try different configurations
  const configs = [
    // Configuration 1: Standard Gmail with SSL
    {
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      secure: true,
      port: 465,
      connectionTimeout: 30000,
      greetingTimeout: 20000,
      socketTimeout: 30000
    },
    // Configuration 2: Gmail with TLS
    {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 30000,
      greetingTimeout: 20000,
      socketTimeout: 30000
    },
    // Configuration 3: Gmail with different port
    {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      connectionTimeout: 30000,
      greetingTimeout: 20000,
      socketTimeout: 30000
    }
  ];

  // Try each configuration
  for (let i = 0; i < configs.length; i++) {
    try {
      console.log(`🔧 Trying email configuration ${i + 1}...`);
      const transporter = nodemailer.createTransport(configs[i]);
      
      // Test the connection
      await transporter.verify();
      console.log(`✅ Email configuration ${i + 1} works!`);
      return transporter;
    } catch (error) {
      console.log(`❌ Configuration ${i + 1} failed:`, error.message);
      if (i === configs.length - 1) {
        console.error('❌ All email configurations failed');
        return null;
      }
    }
  }
};

// Generate OTP for email verification
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send verification email
const sendVerificationEmail = async (email, otp, username) => {
  try {
    // Create transporter
    const transporter = await createTransporter();
    if (!transporter) {
      console.error('❌ Could not create email transporter');
      
      // Fallback: Use Ethereal Email for testing
      console.log('🔄 Trying Ethereal Email as fallback...');
      const testTransporter = await createTestTransporter();
      if (testTransporter) {
        console.log('✅ Using Ethereal Email for testing');
        return await sendWithTransporter(testTransporter, email, otp, username);
      }
      
      return false;
    }

    return await sendWithTransporter(transporter, email, otp, username);
  } catch (error) {
    console.error('❌ Email sending error:', {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response
    });
    
    // Provide specific error messages for common issues
    if (error.code === 'EAUTH') {
      console.error('🔐 Authentication failed. Check your email credentials.');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('⏰ Connection timeout. Check your internet connection and firewall settings.');
    } else if (error.code === 'ECONNECTION') {
      console.error('🌐 Connection failed. Check your network settings.');
    }
    
    return false;
  }
};

// Create test transporter using Ethereal Email
const createTestTransporter = async () => {
  try {
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
  } catch (error) {
    console.error('❌ Failed to create test transporter:', error.message);
    return null;
  }
};

// Send email with given transporter
const sendWithTransporter = async (transporter, email, otp, username) => {
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

  console.log('📧 Attempting to send email to:', email);
  const result = await transporter.sendMail(mailOptions);
  console.log('✅ Email sent successfully:', result.messageId);
  
  // If using Ethereal, log the preview URL
  if (result.messageId.includes('ethereal')) {
    console.log('🔗 Preview URL:', nodemailer.getTestMessageUrl(result));
  }
  
  return true;
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

module.exports = {
  generateOTP,
  sendVerificationEmail,
  formatDate,
  timeAgo
};
