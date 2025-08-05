// ========== IMPORTS AND SETUP ==========
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import database configuration
const { createConnection, callbackConnection } = require('./config/database');

// Import multer configuration
const { upload } = require('./config/multer');

// Import authentication middleware
const { requireAuth, requireStaff, requireAdmin } = require('./middlewares/authMiddleware');

// ========== CONFIGURATION ==========
// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file.`);
  process.exit(1);
}

// Initialize Stripe with error handling
let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // Make Stripe globally available
    global.stripe = stripe;
    console.log('✅ Stripe initialized successfully');
  } else {
    console.warn('Warning: STRIPE_SECRET_KEY not found in environment variables. Stripe functionality will be disabled.');
    stripe = null;
    global.stripe = null;
  }
} catch (error) {
  console.warn('Warning: Failed to initialize Stripe. Stripe functionality will be disabled.');
  stripe = null;
  global.stripe = null;
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
const exphbs = require('express-handlebars');
const hbs = exphbs.create({
  defaultLayout: 'user',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  helpers: {
    eq: (a, b) => a === b,
    gt: (a, b) => a > b,
    formatDate: (date) => new Date(date).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }),
    timeAgo: (date) => {
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
    conditionClass: (condition) => {
      const conditionMap = {
        'new': 'badge-success',
        'like new': 'badge-info',
        'good': 'badge-warning',
        'fair': 'badge-secondary',
        'poor': 'badge-danger'
      };
      return conditionMap[condition?.toLowerCase()] || 'badge-secondary';
    },
    capitalize: (str) => typeof str === 'string'
      ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '',
    isExpired: (expiryDate) => {
      if (!expiryDate) return false;
      const now = new Date();
      const expiry = new Date(expiryDate);
      return expiry < now;
    },
    substring: (str, start, end) => typeof str === 'string' ? str.substring(start, end) : '',
    add: (a, b) => Number(a) + Number(b),
    subtract: (a, b) => Number(a) - Number(b),
    multiply: (a, b) => Number(a) * Number(b),
    hasActiveListings: (listings) => {
      return listings && listings.some(listing => listing.status === 'active');
    },
    hasSoldListings: (listings) => {
      return listings && listings.some(listing => listing.status === 'sold');
    },
    divide: (a, b) => b ? Number(a) / Number(b) : 0,
    or: (a, b) => a || b,
    includes: function(array, value) {
      if (!array) return false;
      // Convert all values to string for safe comparison (since voucher_id may be int or string)
      return array.map(String).includes(String(value));
    }
  }
});

app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');


// ========== MIDDLEWARE ==========
// Global middleware to make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.isLoggedIn = !!req.session.user;
  next();
});

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Serve placeholder images
app.use('/placeholder', express.static(path.join(__dirname, 'placeholder')));

// ========== AUTHENTICATION MIDDLEWARE ==========
// Authentication middleware is imported from middlewares/authMiddleware.js

// ========== ROUTE IMPORTS ==========
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const staffRoutes = require('./routes/staff');
const adminRoutes = require('./routes/admin');
const chatbotRoutes = require('./routes/chatbot');
const staffVoucherRoutes = require('./routes/staffVouchers'); 
const voucherRoutes = require('./routes/vouchers');       


// ========== ROUTE REGISTRATION ==========
app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', staffRoutes);
app.use('/', adminRoutes);
app.use('/chat', chatbotRoutes);
app.use('/staff/vouchers', staffVoucherRoutes);
app.use('/vouchers', voucherRoutes);  

// ========== DATABASE CONNECTION HEALTH CHECK ==========
// Test database connection on startup
callbackConnection.ping((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    console.log('⚠️  Application will continue but database features may not work properly.');
  } else {
    console.log('✅ Database connection is healthy');
  }
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
    body: req.body,
    session: req.session?.user ? { 
      user_id: req.session.user.id || req.session.user.user_id,
      email: req.session.user.email,
      role: req.session.user.role 
    } : 'No session'
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