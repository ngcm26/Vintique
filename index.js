// ========== IMPORTS AND SETUP ==========
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ========== CONFIGURATION ==========
// Initialize Stripe with error handling
let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } else {
    console.warn('Warning: STRIPE_SECRET_KEY not found in environment variables. Stripe functionality will be disabled.');
    stripe = null;
  }
} catch (error) {
  console.warn('Warning: Failed to initialize Stripe. Stripe functionality will be disabled.');
  stripe = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE SETUP ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Configure Handlebars with proper helper registration
app.engine('handlebars', engine({
  defaultLayout: 'user',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  helpers: {
    eq: function(a, b) { 
      return a === b; 
    },
    gt: function(a, b) { 
      return a > b; 
    },
    formatDate: function(date) {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },
    timeAgo: function(date) {
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
    },
    conditionClass: function(condition) {
      const conditionMap = {
        'new': 'badge-success',
        'like new': 'badge-info',
        'good': 'badge-warning',
        'fair': 'badge-secondary',
        'poor': 'badge-danger'
      };
      return conditionMap[condition.toLowerCase()] || 'badge-secondary';
    },
    capitalize: function(str) {
      if (typeof str !== 'string') return '';
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
  }
}));

app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// ========== MIDDLEWARE ==========
// Global middleware to make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.isLoggedIn = !!req.session.user;
  next();
});

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// ========== AUTHENTICATION MIDDLEWARE ==========
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
};

// ========== ROUTE IMPORTS ==========
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const staffRoutes = require('./routes/staff');
const adminRoutes = require('./routes/admin');
const chatbotRoutes = require('./routes/chatbot');

// ========== ROUTE REGISTRATION ==========
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', staffRoutes);
app.use('/', adminRoutes);
app.use('/chat', chatbotRoutes);

// ========== TEST EMAIL ROUTE (REMOVE IN PRODUCTION) ==========
app.get('/test-email', async (req, res) => {
  const { sendVerificationEmail } = require('./utils/helpers');
  
  console.log('🧪 Testing email configuration...');
  console.log('📧 Environment variables:', {
    EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
    EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'NOT SET'
  });
  
  // Check .env file
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  const envExists = fs.existsSync(envPath);
  
  console.log('📁 .env file exists:', envExists);
  if (envExists) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');
      const emailUserLine = lines.find(line => line.startsWith('EMAIL_USER='));
      const emailPassLine = lines.find(line => line.startsWith('EMAIL_PASS='));
      
      console.log('📝 .env file contents:');
      console.log('  EMAIL_USER line:', emailUserLine ? 'FOUND' : 'NOT FOUND');
      console.log('  EMAIL_PASS line:', emailPassLine ? 'FOUND' : 'NOT FOUND');
    } catch (error) {
      console.log('❌ Error reading .env file:', error.message);
    }
  }
  
  try {
    const result = await sendVerificationEmail('test@example.com', '123456', 'TestUser');
    res.json({ 
      success: result, 
      message: result ? 'Email sent successfully' : 'Email failed',
      env: {
        EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
        EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'NOT SET',
        envFileExists: envExists
      }
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

// ========== EMAIL TROUBLESHOOTER ROUTE (REMOVE IN PRODUCTION) ==========
app.get('/troubleshoot-email', async (req, res) => {
  console.log('🔍 Starting email troubleshooter...');
  
  // Capture console output
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(' '));
    originalLog(...args);
  };
  
  try {
    const { troubleshootEmail } = require('./utils/email-troubleshooter');
    await troubleshootEmail();
    
    // Restore console.log
    console.log = originalLog;
    
    res.json({ 
      success: true, 
      message: 'Email troubleshooter completed.',
      logs: logs,
      summary: {
        emailUser: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
        emailPass: process.env.EMAIL_PASS ? 'SET' : 'NOT SET',
        isGmail: process.env.EMAIL_USER ? process.env.EMAIL_USER.includes('@gmail.com') : false,
        hasTimeoutErrors: logs.some(log => log.includes('ETIMEDOUT')),
        hasAuthErrors: logs.some(log => log.includes('EAUTH')),
        hasConnectionErrors: logs.some(log => log.includes('ECONNECTION'))
      }
    });
  } catch (error) {
    // Restore console.log
    console.log = originalLog;
    
    res.json({ 
      success: false, 
      error: error.message,
      stack: error.stack,
      logs: logs
    });
  }
});

// ========== EMAIL TROUBLESHOOTER PAGE (REMOVE IN PRODUCTION) ==========
app.get('/email-troubleshooter', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'email-troubleshooter.handlebars'));
});

// ========== ENV CHECK ROUTE (REMOVE IN PRODUCTION) ==========
app.get('/check-env', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  
  res.json({
    envVars: {
      EMAIL_USER: process.env.EMAIL_USER ? 'SET' : 'NOT SET',
      EMAIL_PASS: process.env.EMAIL_PASS ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'NOT SET',
      PORT: process.env.PORT || 'NOT SET'
    },
    envFile: {
      exists: fs.existsSync(envPath),
      path: envPath
    },
    currentDir: __dirname,
    rootDir: path.dirname(__dirname)
  });
});

// ========== ERROR HANDLING ==========
// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { 
    error: 'Page not found',
    layout: 'user'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('💥 Global error handler caught:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });
  
  // Don't leak error details in production
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred. Please try again later.'
    : error.message;
  
  res.status(500).render('error', { 
    error: errorMessage,
    layout: 'user'
  });
});

// ========== SERVER STARTUP ==========
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});