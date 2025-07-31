// ========== EMAIL TROUBLESHOOTER ==========
const nodemailer = require('nodemailer');
require('dotenv').config();

const troubleshootEmail = async () => {
  console.log('🔍 EMAIL TROUBLESHOOTER STARTING...\n');
  
  // Step 1: Check Environment Variables
  console.log('📋 STEP 1: Environment Variables Check');
  console.log('=====================================');
  console.log('EMAIL_USER:', process.env.EMAIL_USER ? `"${process.env.EMAIL_USER}"` : '❌ NOT SET');
  console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? `"${'*'.repeat(process.env.EMAIL_PASS.length)}"` : '❌ NOT SET');
  console.log('NODE_ENV:', process.env.NODE_ENV || 'NOT SET');
  console.log('');
  
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('❌ SOLUTION: Add EMAIL_USER and EMAIL_PASS to your .env file');
    console.log('   EMAIL_USER=your-gmail@gmail.com');
    console.log('   EMAIL_PASS=your-app-password');
    return;
  }
  
  // Step 2: Validate Email Format
  console.log('📧 STEP 2: Email Format Validation');
  console.log('==================================');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = emailRegex.test(process.env.EMAIL_USER);
  console.log('Email format valid:', isValidEmail ? '✅' : '❌');
  
  if (!isValidEmail) {
    console.log('❌ SOLUTION: Use a valid email address (e.g., user@gmail.com)');
    return;
  }
  
  // Step 3: Check if it's a Gmail address
  console.log('📧 STEP 3: Gmail Address Check');
  console.log('==============================');
  const isGmail = process.env.EMAIL_USER.includes('@gmail.com');
  console.log('Is Gmail address:', isGmail ? '✅' : '❌');
  
  if (!isGmail) {
    console.log('⚠️  WARNING: This script is optimized for Gmail. Other providers may need different settings.');
  }
  
  // Step 4: Test Different SMTP Configurations
  console.log('🔧 STEP 4: SMTP Configuration Testing');
  console.log('====================================');
  
  const configs = [
    {
      name: 'Gmail with SSL (Port 465)',
      config: {
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        secure: true,
        port: 465
      }
    },
    {
      name: 'Gmail with TLS (Port 587)',
      config: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        tls: {
          rejectUnauthorized: false
        }
      }
    },
    {
      name: 'Gmail with TLS (Port 587) - Strict',
      config: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      }
    }
  ];
  
  for (let i = 0; i < configs.length; i++) {
    const { name, config } = configs[i];
    console.log(`\n🔧 Testing ${name}...`);
    
    try {
      const transporter = nodemailer.createTransport(config);
      await transporter.verify();
      console.log(`✅ ${name} - SUCCESS!`);
      
      // Test sending a simple email
      try {
        const result = await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_USER, // Send to yourself for testing
          subject: 'Vintique Email Test',
          text: 'This is a test email from Vintique email troubleshooting script.'
        });
        console.log(`📧 Test email sent successfully! Message ID: ${result.messageId}`);
        console.log('✅ This configuration works! Use this in your app.');
        return;
      } catch (sendError) {
        console.log(`❌ Test email failed: ${sendError.message}`);
      }
    } catch (error) {
      console.log(`❌ ${name} - FAILED: ${error.message}`);
      
      // Provide specific solutions based on error
      if (error.code === 'EAUTH') {
        console.log('🔐 SOLUTION: Check your email credentials. Make sure you\'re using an App Password, not your regular password.');
        console.log('   - Enable 2-Factor Authentication on your Google account');
        console.log('   - Generate an App Password: Google Account → Security → 2-Step Verification → App passwords');
      } else if (error.code === 'ETIMEDOUT') {
        console.log('⏰ SOLUTION: Connection timeout. Check your internet connection and firewall settings.');
      } else if (error.code === 'ECONNECTION') {
        console.log('🌐 SOLUTION: Connection failed. Check your network settings and try again.');
      } else if (error.message.includes('Invalid login')) {
        console.log('🔐 SOLUTION: Invalid login credentials. Double-check your email and app password.');
      } else if (error.message.includes('Less secure app access')) {
        console.log('🔐 SOLUTION: Enable "Less secure app access" or use an App Password.');
      }
    }
  }
  
  // Step 5: Common Solutions
  console.log('\n💡 STEP 5: Common Solutions');
  console.log('===========================');
  console.log('1. 🔐 Use App Password instead of regular password');
  console.log('2. 🔒 Enable 2-Factor Authentication on your Google account');
  console.log('3. 📧 Make sure your Gmail account is not locked');
  console.log('4. 🌐 Check your internet connection');
  console.log('5. 🔥 Check your firewall/antivirus settings');
  console.log('6. 📱 Try from a different network (mobile hotspot)');
  
  console.log('\n📞 If all else fails, try using Ethereal Email for testing:');
  console.log('   - The app will automatically fall back to Ethereal Email');
  console.log('   - This allows you to test email functionality without Gmail issues');
};

// Run the troubleshooter if this file is executed directly
if (require.main === module) {
  troubleshootEmail().catch(console.error);
}

module.exports = { troubleshootEmail }; 