const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'public/uploads');
const messagesUploadDir = path.join(__dirname, 'public/uploads/messages');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(messagesUploadDir)) {
  fs.mkdirSync(messagesUploadDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (req.route && req.route.path.includes('messages')) {
      cb(null, messagesUploadDir);
    } else {
      cb(null, uploadsDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    if (req.route && req.route.path.includes('messages')) {
      cb(null, 'msg_' + uniqueSuffix + extension);
    } else {
      cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Create database connection function
const createConnection = async () => {
  return await mysql.createConnection({
    host: 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'aaronBlackford!',
    database: process.env.DB_NAME || 'vintiquedb'
  });
};

// Configure Handlebars with proper helper registration
app.engine('handlebars', engine({
  defaultLayout: 'user',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  helpers: {
    eq: function(a, b) { 
      return a === b; 
    },
    ne: function(a, b) { 
      return a !== b; 
    },
    gt: function(a, b) { 
      return a > b; 
    },
    lt: function(a, b) { 
      return a < b; 
    },
    gte: function(a, b) { 
      return a >= b; 
    },
    lte: function(a, b) { 
      return a <= b; 
    },
    and: function(a, b) { 
      return a && b; 
    },
    or: function(a, b) { 
      return a || b; 
    },
    not: function(a) { 
      return !a; 
    },
    formatDate: function(date) {
      return new Date(date).toLocaleDateString();
    },
    timeAgo: function(date) {
      const now = new Date();
      const messageDate = new Date(date);
      const diffInMinutes = Math.floor((now - messageDate) / (1000 * 60));
      
      if (diffInMinutes < 1) return 'Just now';
      if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
      if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;
      return `${Math.floor(diffInMinutes / 1440)} days ago`;
    },
    json: function(context) {
      return JSON.stringify(context);
    },
    conditionClass: function (c) {
      switch ((c || '').toLowerCase()) {
        case 'like-new':
        case 'excellent':
        case 'good': return 'is-good';
        case 'fair': return 'is-fair';
        default: return '';
      }
    },
    capitalize: function(s) {
      return (s || '').replace(/\b\w/g, m => m.toUpperCase());
    },
    substring: function(str, start, length) {
      return str.substring(start, start + length);
    }
  }
}));

app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'vintique_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Make user data available in all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// ========== AUTHENTICATION MIDDLEWARE ==========
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  if (req.session.user.status === 'suspended') {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
    });
    return res.redirect('/login');
  }
  
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.redirect('/login');
  }
  
  if (req.session.user.status === 'suspended') {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
    });
    return res.redirect('/login');
  }
  
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  if (req.session.user.status === 'suspended') {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
    });
    return res.redirect('/login');
  }
  
  next();
};

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// MySQL connection for callback-based queries
const mysql_callback = require('mysql2');
const connection = mysql_callback.createConnection({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

connection.connect(err => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    process.exit(1);
  }
  console.log('Connected to MySQL!');
});

// ========== BASIC ROUTES ==========

// Home route
app.get('/', (req, res) => {
  res.render('users/home', { 
    title: 'Vintique - Sustainable Fashion Marketplace',
    layout: 'user',
    activePage: 'home'
  });
});

// User Home route
app.get('/home', (req, res) => {
  res.render('users/home', { layout: 'user', activePage: 'home' });
});

// Test routes
app.get('/hello', (req, res) => {
  res.send('Hello! Server is working!');
});

app.get('/debug', (req, res) => {
  res.json({ 
    user: req.session.user,
    loggedIn: !!req.session.user,
    sessionId: req.sessionID
  });
});

app.get('/test-db', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [rows] = await connection.execute('SELECT 1 as test');
    res.json({ message: 'Database connection successful', data: rows });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== MARKETPLACE ROUTES ==========

// Marketplace page
app.get('/marketplace', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    // Fetch all active listings with user information
    const [listings] = await connection.execute(`
      SELECT 
        l.*,
        ui.username,
        u.email,
        u.user_id as seller_user_id
      FROM listings l
      LEFT JOIN users u ON l.seller_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE l.status = 'active'
      ORDER BY l.created_at DESC
    `);
    
    res.render('users/marketplace', {
      title: 'Marketplace - Vintique',
      layout: 'user',
      activePage: 'marketplace',
      listings: listings,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching marketplace listings:', error);
    res.render('users/marketplace', {
      title: 'Marketplace - Vintique',
      layout: 'user',
      activePage: 'marketplace',
      listings: [],
      error: 'Error loading marketplace',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// My Listings page
app.get('/my_listing', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    // Fetch user's listings
    const [listings] = await connection.execute(`
      SELECT * FROM listings 
      WHERE seller_id = ? 
      ORDER BY created_at DESC
    `, [req.session.user.user_id]);
    
    res.render('users/my_listing', {
      title: 'My Listings - Vintique',
      layout: 'user',
      activePage: 'my_listing',
      listings: listings,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching user listings:', error);
    res.render('users/my_listing', {
      title: 'My Listings - Vintique',
      layout: 'user',
      activePage: 'my_listing',
      listings: [],
      error: 'Error loading your listings',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Individual listing page
app.get('/listing/:id', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const listingId = req.params.id;
    
    // Fetch the specific listing with seller information
    const [listings] = await connection.execute(`
      SELECT 
        l.*,
        ui.username,
        ui.first_name,
        ui.last_name,
        u.email,
        u.user_id as seller_user_id
      FROM listings l
      LEFT JOIN users u ON l.seller_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE l.listing_id = ? AND l.status = 'active'
    `, [listingId]);
    
    if (listings.length === 0) {
      return res.status(404).render('error', {
        title: 'Listing Not Found - Vintique',
        layout: 'user',
        error: 'Listing not found or no longer available',
        user: req.session.user
      });
    }
    
    const listing = listings[0];
    
    res.render('users/listing_detail', {
      title: `${listing.title} - Vintique`,
      layout: 'user',
      activePage: 'marketplace',
      listing: listing,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).render('error', {
      title: 'Error - Vintique',
      layout: 'user',
      error: 'Error loading listing',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== MESSAGES ROUTES ==========

// Messages page
app.get('/messages', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
    // Fetch conversations for the current user
    const [conversations] = await connection.execute(`
      SELECT 
        c.*,
        CASE 
          WHEN c.buyer_id = ? THEN seller_info.username
          ELSE buyer_info.username
        END as other_user_name,
        CASE 
          WHEN c.buyer_id = ? THEN seller_info.first_name
          ELSE buyer_info.first_name
        END as other_first_name,
        CASE 
          WHEN c.buyer_id = ? THEN seller_info.last_name
          ELSE buyer_info.last_name
        END as other_last_name,
        l.title as listing_title,
        l.listing_id,
        (SELECT message_content FROM messages 
         WHERE conversation_id = c.conversation_id 
         ORDER BY sent_at DESC LIMIT 1) as last_message_preview,
        (SELECT sent_at FROM messages 
         WHERE conversation_id = c.conversation_id 
         ORDER BY sent_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages 
         WHERE conversation_id = c.conversation_id 
         AND sender_id != ? AND is_read = 0) as unread_count
      FROM conversations c
      LEFT JOIN users seller ON c.seller_id = seller.user_id
      LEFT JOIN user_information seller_info ON seller.user_id = seller_info.user_id
      LEFT JOIN users buyer ON c.buyer_id = buyer.user_id
      LEFT JOIN user_information buyer_info ON buyer.user_id = buyer_info.user_id
      LEFT JOIN listings l ON c.listing_id = l.listing_id
      WHERE c.buyer_id = ? OR c.seller_id = ?
      ORDER BY COALESCE(
        (SELECT sent_at FROM messages WHERE conversation_id = c.conversation_id ORDER BY sent_at DESC LIMIT 1),
        c.created_at
      ) DESC
    `, [userId, userId, userId, userId, userId, userId]);
    
    res.render('users/messages', {
      title: 'Messages - Vintique',
      layout: 'user',
      activePage: 'messages',
      conversations: conversations,
      conversationsJson: JSON.stringify(conversations),
      userJson: JSON.stringify(req.session.user),
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.render('users/messages', {
      title: 'Messages - Vintique',
      layout: 'user',
      activePage: 'messages',
      conversations: [],
      conversationsJson: JSON.stringify([]),
      userJson: JSON.stringify(req.session.user),
      error: 'Error loading messages',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== LISTING MANAGEMENT ROUTES ==========

// Mark listing as sold
app.post('/listings/:id/mark_sold', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const listingId = req.params.id;
    const userId = req.session.user.user_id;
    
    // Check if the listing belongs to the current user
    const [listings] = await connection.execute(`
      SELECT * FROM listings WHERE listing_id = ? AND seller_id = ?
    `, [listingId, userId]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found or you do not have permission to modify it' });
    }
    
    // Update the listing status to sold
    await connection.execute(`
      UPDATE listings SET status = 'sold' WHERE listing_id = ?
    `, [listingId]);
    
    res.json({ success: true, message: 'Listing marked as sold' });
  } catch (error) {
    console.error('Error marking listing as sold:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// Delete listing
app.delete('/listings/:id', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const listingId = req.params.id;
    const userId = req.session.user.user_id;
    
    // Check if the listing belongs to the current user
    const [listings] = await connection.execute(`
      SELECT * FROM listings WHERE listing_id = ? AND seller_id = ?
    `, [listingId, userId]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found or you do not have permission to delete it' });
    }
    
    // Delete the listing
    await connection.execute(`
      DELETE FROM listings WHERE listing_id = ?
    `, [listingId]);
    
    res.json({ success: true, message: 'Listing deleted successfully' });
  } catch (error) {
    console.error('Error deleting listing:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// Edit listing page
app.get('/edit_listing/:id', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const listingId = req.params.id;
    const userId = req.session.user.user_id;
    
    // Fetch the listing that belongs to the current user
    const [listings] = await connection.execute(`
      SELECT * FROM listings WHERE listing_id = ? AND seller_id = ?
    `, [listingId, userId]);
    
    if (listings.length === 0) {
      return res.status(404).render('error', {
        title: 'Listing Not Found - Vintique',
        layout: 'user',
        error: 'Listing not found or you do not have permission to edit it',
        user: req.session.user
      });
    }
    
    const listing = listings[0];
    
    res.render('users/edit_listing', {
      title: 'Edit Listing - Vintique',
      layout: 'user',
      activePage: 'my_listing',
      listing: listing,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching listing for edit:', error);
    res.status(500).render('error', {
      title: 'Error - Vintique',
      layout: 'user',
      error: 'Error loading listing for editing',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== API ROUTES FOR LISTINGS ==========

// Get all listings API
app.get('/api/listings', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    const [listings] = await connection.execute(`
      SELECT 
        l.*,
        ui.username,
        u.email
      FROM listings l
      LEFT JOIN users u ON l.seller_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE l.status = 'active'
      ORDER BY l.created_at DESC
    `);
    
    res.json(listings);
  } catch (error) {
    console.error('Error fetching listings API:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// Get single listing API
app.get('/api/listings/:id', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const listingId = req.params.id;
    
    const [listings] = await connection.execute(`
      SELECT 
        l.*,
        ui.username,
        ui.first_name,
        ui.last_name,
        u.email
      FROM listings l
      LEFT JOIN users u ON l.seller_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE l.listing_id = ? AND l.status = 'active'
    `, [listingId]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    res.json(listings[0]);
  } catch (error) {
    console.error('Error fetching single listing API:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== MESSAGING API ROUTES ==========

// Get messages for a conversation
app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const conversationId = req.params.id;
    const userId = req.session.user.user_id;
    
    // Verify user has access to this conversation
    const [conversations] = await connection.execute(`
      SELECT * FROM conversations 
      WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
    `, [conversationId, userId, userId]);
    
    if (conversations.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Fetch messages
    const [messages] = await connection.execute(`
      SELECT 
        m.*,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at ASC
    `, [conversationId]);
    
    // Mark messages as read
    await connection.execute(`
      UPDATE messages SET is_read = 1 
      WHERE conversation_id = ? AND sender_id != ?
    `, [conversationId, userId]);
    
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// Send a message
app.post('/api/conversations/:id/messages', requireAuth, upload.single('image'), async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const conversationId = req.params.id;
    const userId = req.session.user.user_id;
    const { message_content } = req.body;
    
    // Verify user has access to this conversation
    const [conversations] = await connection.execute(`
      SELECT * FROM conversations 
      WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
    `, [conversationId, userId, userId]);
    
    if (conversations.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Check if we have either text or image
    if (!message_content && !req.file) {
      return res.status(400).json({ error: 'Message content or image is required' });
    }
    
    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/messages/${req.file.filename}`;
    }
    
    // Insert message
    const [result] = await connection.execute(`
      INSERT INTO messages (conversation_id, sender_id, message_content, image_url, sent_at, is_read)
      VALUES (?, ?, ?, ?, NOW(), 0)
    `, [conversationId, userId, message_content || null, imageUrl]);
    
    res.json({ 
      success: true, 
      message_id: result.insertId,
      message: 'Message sent successfully' 
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// Start a new conversation
app.post('/start-conversation', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { listing_id, message } = req.body;
    const buyerId = req.session.user.user_id;
    
    // Get the listing and seller information
    const [listings] = await connection.execute(`
      SELECT seller_id FROM listings WHERE listing_id = ?
    `, [listing_id]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    const sellerId = listings[0].seller_id;
    
    // Check if conversation already exists
    const [existingConversations] = await connection.execute(`
      SELECT conversation_id FROM conversations 
      WHERE listing_id = ? AND buyer_id = ? AND seller_id = ?
    `, [listing_id, buyerId, sellerId]);
    
    let conversationId;
    
    if (existingConversations.length > 0) {
      conversationId = existingConversations[0].conversation_id;
    } else {
      // Create new conversation
      const [result] = await connection.execute(`
        INSERT INTO conversations (listing_id, buyer_id, seller_id, created_at)
        VALUES (?, ?, ?, NOW())
      `, [listing_id, buyerId, sellerId]);
      
      conversationId = result.insertId;
    }
    
    // Send the initial message
    await connection.execute(`
      INSERT INTO messages (conversation_id, sender_id, message_content, sent_at, is_read)
      VALUES (?, ?, ?, NOW(), 0)
    `, [conversationId, buyerId, message]);
    
    res.json({ 
      success: true, 
      conversation_id: conversationId 
    });
  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// Create a new conversation from messages page
app.post('/api/conversations', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { seller_email, initial_message } = req.body;
    const buyerId = req.session.user.user_id;
    
    // Find the seller by email
    const [sellers] = await connection.execute(`
      SELECT user_id FROM users WHERE email = ?
    `, [seller_email]);
    
    if (sellers.length === 0) {
      return res.status(404).json({ error: 'User not found with that email' });
    }
    
    const sellerId = sellers[0].user_id;
    
    if (sellerId === buyerId) {
      return res.status(400).json({ error: 'You cannot start a conversation with yourself' });
    }
    
    // Create new conversation
    const [result] = await connection.execute(`
      INSERT INTO conversations (buyer_id, seller_id, created_at)
      VALUES (?, ?, NOW())
    `, [buyerId, sellerId]);
    
    const conversationId = result.insertId;
    
    // Send the initial message
    await connection.execute(`
      INSERT INTO messages (conversation_id, sender_id, message_content, sent_at, is_read)
      VALUES (?, ?, ?, NOW(), 0)
    `, [conversationId, buyerId, initial_message]);
    
    res.json({ 
      success: true, 
      conversation_id: conversationId 
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== AUTHENTICATION ROUTES ==========

// Login route
app.get('/login', (req, res) => {
  res.render('users/login', { 
    title: 'Login - Vintique',
    layout: 'user',
    activePage: 'login'
  });
});

// Login handler
app.post('/login', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { email, password } = req.body;
    
    const [users] = await connection.execute(`
      SELECT 
        u.user_id,
        u.email,
        u.phone_number,
        u.password,
        u.role,
        u.status,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.email = ?
    `, [email]);
    
    if (users.length === 0) {
      return res.render('users/login', { 
        error: 'User not found',
        layout: 'user',
        activePage: 'login'
      });
    }
    
    const user = users[0];
    
    if (user.status === 'suspended') {
      return res.render('users/login', { 
        error: 'Your account has been suspended',
        layout: 'user',
        activePage: 'login'
      });
    }
    
    if (user.password !== password) {
      return res.render('users/login', { 
        error: 'Invalid password',
        layout: 'user',
        activePage: 'login'
      });
    }
    
    req.session.user = {
      user_id: user.user_id,
      id: user.user_id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      role: user.role,
      status: user.status
    };
    
    if (user.role === 'staff' || user.role === 'admin') {
      res.redirect('/staff/dashboard');
    } else {
      res.redirect('/');
    }
  } catch (error) {
    console.error('Login error:', error);
    res.render('users/login', { 
      error: 'Server error',
      layout: 'user',
      activePage: 'login'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Register routes
app.get('/register', (req, res) => {
  res.render('register', { layout: 'user', activePage: 'register' });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

// ========== FAQ ROUTES ==========

// User Q&A page - only show verified questions
app.get('/qa', requireAuth, async (req, res) => {
  if (req.session.user && (req.session.user.role === 'staff' || req.session.user.role === 'admin')) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      // Don't redirect API requests
    } else {
      return res.redirect('/staff/qa');
    }
  }

  let connection;
  try {
    connection = await createConnection();
    // Get only VERIFIED questions for regular users
    const [questions] = await connection.execute(`
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        COUNT(DISTINCT qv.vote_id) as helpful_count,
        COUNT(DISTINCT qa_ans.answer_id) as answer_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      LEFT JOIN qa_answers qa_ans ON q.qa_id = qa_ans.qa_id
      WHERE q.is_verified = 1
      GROUP BY q.qa_id
      ORDER BY q.asked_at DESC
    `);

    // Get answers for each verified question
    for (let question of questions) {
      const [answers] = await connection.execute(`
        SELECT 
          qa_ans.*,
          answerer.email as answerer_email,
          answerer_info.first_name as answerer_first_name,
          answerer_info.last_name as answerer_last_name,
          answerer_info.username as answerer_username
        FROM qa_answers qa_ans
        LEFT JOIN users answerer ON qa_ans.answerer_id = answerer.user_id
        LEFT JOIN user_information answerer_info ON qa_ans.answerer_id = answerer_info.user_id
        WHERE qa_ans.qa_id = ?
        ORDER BY qa_ans.answered_at ASC
      `, [question.qa_id]);
      
      question.answers = answers || [];
    }

    res.render('users/qa', {
      title: 'Q&A - Vintique',
      layout: 'user',
      activePage: 'qa',
      questions: questions,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching Q&A:', error);
    res.render('users/qa', {
      title: 'Q&A - Vintique',
      layout: 'user',
      activePage: 'qa',
      questions: [],
      error: 'Error loading Q&A',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Staff Q&A moderation page - show ALL questions with verification status
app.get('/staff/qa', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    // Get ALL questions (verified and unverified) for staff moderation
    const [questions] = await connection.execute(`
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        COUNT(DISTINCT qv.vote_id) as helpful_count,
        COUNT(DISTINCT qa_ans.answer_id) as answer_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      LEFT JOIN qa_answers qa_ans ON q.qa_id = qa_ans.qa_id
      GROUP BY q.qa_id
      ORDER BY q.is_verified ASC, q.asked_at DESC
    `);

    // Get answers for each question
    for (let question of questions) {
      const [answers] = await connection.execute(`
        SELECT 
          qa_ans.*,
          answerer.email as answerer_email,
          answerer_info.first_name as answerer_first_name,
          answerer_info.last_name as answerer_last_name,
          answerer_info.username as answerer_username
        FROM qa_answers qa_ans
        LEFT JOIN users answerer ON qa_ans.answerer_id = answerer.user_id
        LEFT JOIN user_information answerer_info ON qa_ans.answerer_id = answerer_info.user_id
        WHERE qa_ans.qa_id = ?
        ORDER BY qa_ans.answered_at ASC
      `, [question.qa_id]);
      
      question.answers = answers || [];
    }

    res.render('staff/qa_management', {
      title: 'Q&A Management - Vintique',
      layout: 'staff',
      activePage: 'qa',
      questions: questions,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching Q&A:', error);
    res.render('staff/qa_management', {
      title: 'Q&A Management - Vintique',
      layout: 'staff',
      activePage: 'qa',
      questions: [],
      error: 'Error loading Q&A',
      user: req.session.user
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== Q&A API ROUTES ==========

// API: Get all questions (only verified for users)
app.get('/api/qa', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { category, status, search } = req.query;
    
    let query = `
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        COUNT(DISTINCT qv.vote_id) as helpful_count,
        COUNT(DISTINCT qa_ans.answer_id) as answer_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      LEFT JOIN qa_answers qa_ans ON q.qa_id = qa_ans.qa_id
      WHERE q.is_verified = 1
    `;
    
    const params = [];
    
    if (category && category !== 'all') {
      query += ' AND q.category = ?';
      params.push(category);
    }
    
    if (status) {
      if (status === 'answered') {
        query += ' AND EXISTS (SELECT 1 FROM qa_answers WHERE qa_answers.qa_id = q.qa_id)';
      } else if (status === 'pending') {
        query += ' AND NOT EXISTS (SELECT 1 FROM qa_answers WHERE qa_answers.qa_id = q.qa_id)';
      }
    }
    
    if (search) {
      query += ' AND (q.question_text LIKE ? OR EXISTS (SELECT 1 FROM qa_answers WHERE qa_answers.qa_id = q.qa_id AND qa_answers.answer_content LIKE ?))';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' GROUP BY q.qa_id ORDER BY q.asked_at DESC';
    
    const [questions] = await connection.execute(query, params);

    // Get answers for each question
    for (let question of questions) {
      const [answers] = await connection.execute(`
        SELECT 
          qa_ans.*,
          answerer.email as answerer_email,
          answerer_info.first_name as answerer_first_name,
          answerer_info.last_name as answerer_last_name,
          answerer_info.username as answerer_username
        FROM qa_answers qa_ans
        LEFT JOIN users answerer ON qa_ans.answerer_id = answerer.user_id
        LEFT JOIN user_information answerer_info ON qa_ans.answerer_id = answerer_info.user_id
        WHERE qa_ans.qa_id = ?
        ORDER BY qa_ans.answered_at ASC
      `, [question.qa_id]);
      
      question.answers = answers || [];
    }
    
    res.json(questions);
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Submit a new question (now requires manual verification)
app.post('/api/qa', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { category, question_text, details } = req.body;
    const userId = req.session.user.user_id;
    
    if (!category || !question_text) {
      return res.status(400).json({ error: 'Category and question are required' });
    }
    
    // Get user information
    const [userInfo] = await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [userId]);
    
    const username = userInfo[0]?.username || userInfo[0]?.email || 'Unknown';
    
    // Insert new question - REQUIRES MANUAL VERIFICATION (is_verified = 0)
    const [result] = await connection.execute(`
      INSERT INTO qa (asker_id, asker_username, category, question_text, details, asked_at, is_verified)
      VALUES (?, ?, ?, ?, ?, NOW(), 0)
    `, [userId, username, category, question_text.trim(), details ? details.trim() : null]);
    
    res.status(201).json({
      message: 'Question submitted successfully! It will be reviewed by our moderators before being published.',
      qa_id: result.insertId
    });
  } catch (error) {
    console.error('Error submitting question:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Submit an answer to a question (with duplicate prevention)
app.post('/api/qa/:questionId/answer', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { questionId } = req.params;
    const { answer_content } = req.body;
    const userId = req.session.user.user_id;
    
    if (!answer_content || answer_content.trim() === '') {
      return res.status(400).json({ error: 'Answer content is required' });
    }
    
    // Check if question exists
    const [questionCheck] = await connection.execute(`
      SELECT * FROM qa WHERE qa_id = ? AND is_verified = 1
    `, [questionId]);
    
    if (questionCheck.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Check for duplicate answers from the same user with similar content
    const [duplicateCheck] = await connection.execute(`
      SELECT * FROM qa_answers 
      WHERE qa_id = ? AND answerer_id = ? AND answer_content = ?
    `, [questionId, userId, answer_content.trim()]);
    
    if (duplicateCheck.length > 0) {
      return res.status(400).json({ error: 'You have already submitted this answer' });
    }
    
    // Get user information
    const [userInfo] = await connection.execute(`
      SELECT ui.username, u.email, u.role
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [userId]);
    
    const username = userInfo[0]?.username || userInfo[0]?.email || 'Unknown';
    
    // Insert new answer into qa_answers table
    const [result] = await connection.execute(`
      INSERT INTO qa_answers (qa_id, answerer_id, answerer_username, answer_content, answered_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [questionId, userId, username, answer_content.trim()]);
    
    // Get the created answer with user info
    const [newAnswer] = await connection.execute(`
      SELECT 
        qa_ans.*,
        answerer.email as answerer_email,
        answerer_info.first_name as answerer_first_name,
        answerer_info.last_name as answerer_last_name,
        answerer_info.username as answerer_username
      FROM qa_answers qa_ans
      LEFT JOIN users answerer ON qa_ans.answerer_id = answerer.user_id
      LEFT JOIN user_information answerer_info ON qa_ans.answerer_id = answerer_info.user_id
      WHERE qa_ans.answer_id = ?
    `, [result.insertId]);
    
    res.status(201).json(newAnswer[0]);
  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Vote helpful on a question
app.post('/api/qa/:questionId/vote', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { questionId } = req.params;
    const userId = req.session.user.user_id;
    
    // Check if question exists
    const [questionCheck] = await connection.execute(`
      SELECT * FROM qa WHERE qa_id = ? AND is_verified = 1
    `, [questionId]);
    
    if (questionCheck.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Check if user already voted
    const [existingVote] = await connection.execute(`
      SELECT * FROM qa_votes WHERE qa_id = ? AND user_id = ?
    `, [questionId, userId]);
    
    let voted = false;
    
    if (existingVote.length > 0) {
      // Remove vote
      await connection.execute(`
        DELETE FROM qa_votes WHERE qa_id = ? AND user_id = ?
      `, [questionId, userId]);
      voted = false;
    } else {
      // Add vote
      await connection.execute(`
        INSERT INTO qa_votes (qa_id, user_id, voted_at) VALUES (?, ?, NOW())
      `, [questionId, userId]);
      voted = true;
    }
    
    // Get updated vote count
    const [voteCount] = await connection.execute(`
      SELECT COUNT(*) as count FROM qa_votes WHERE qa_id = ?
    `, [questionId]);
    
    res.json({
      voted: voted,
      vote_count: voteCount[0].count
    });
  } catch (error) {
    console.error('Error voting:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Get user's vote status for questions
app.get('/api/qa/votes/status', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
    const [votes] = await connection.execute(`
      SELECT qa_id FROM qa_votes WHERE user_id = ?
    `, [userId]);
    
    const votedQuestions = votes.map(vote => vote.qa_id);
    res.json(votedQuestions);
  } catch (error) {
    console.error('Error fetching vote status:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Get pending questions count for dashboard
app.get('/api/qa/pending-count', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [result] = await connection.execute(`
      SELECT COUNT(*) as pending_count FROM qa WHERE is_verified = 0
    `);
    
    res.json({ pending_count: result[0].pending_count });
  } catch (error) {
    console.error('Error getting pending count:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== STAFF Q&A MODERATION API ENDPOINTS ==========

// Staff: Answer a question (with duplicate prevention)
app.post('/api/staff/qa/:id/answer', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const qaId = req.params.id;
    const { answer_content } = req.body;
    const staffId = req.session.user.user_id;
    
    if (!answer_content || answer_content.trim() === '') {
      return res.status(400).json({ error: 'Answer content is required.' });
    }
    
    // Check for duplicate answers from the same staff member with similar content
    const [duplicateCheck] = await connection.execute(`
      SELECT * FROM qa_answers 
      WHERE qa_id = ? AND answerer_id = ? AND answer_content = ?
    `, [qaId, staffId, answer_content.trim()]);
    
    if (duplicateCheck.length > 0) {
      return res.status(400).json({ error: 'You have already submitted this answer' });
    }
    
    // Get staff username
    const [staffInfo] = await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [staffId]);
    
    const staffUsername = staffInfo[0]?.username || staffInfo[0]?.email || 'Staff';
    
    // Insert new answer into qa_answers table
    await connection.execute(`
      INSERT INTO qa_answers (qa_id, answerer_id, answerer_username, answer_content, answered_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [qaId, staffId, staffUsername, answer_content.trim()]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff answer error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Staff: Verify a question
app.patch('/api/qa/:id/verify', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const qaId = req.params.id;
    
    await connection.execute(`
      UPDATE qa SET is_verified = 1 WHERE qa_id = ?
    `, [qaId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff verify error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Staff: Delete a question
app.delete('/api/qa/:id', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const qaId = req.params.id;
    
    // Delete all answers first (foreign key constraint)
    await connection.execute(`
      DELETE FROM qa_answers WHERE qa_id = ?
    `, [qaId]);
    
    // Delete all votes
    await connection.execute(`
      DELETE FROM qa_votes WHERE qa_id = ?
    `, [qaId]);
    
    // Delete the question
    await connection.execute(`
      DELETE FROM qa WHERE qa_id = ?
    `, [qaId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff delete error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== CLEANUP ROUTE FOR EXISTING DUPLICATES (OPTIONAL) ==========

// Add this route to clean up existing duplicates - use once then remove
app.get('/cleanup-duplicate-answers', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    // Find duplicate answers (same qa_id, answerer_id, and answer_content)
    const [duplicates] = await connection.execute(`
      SELECT qa_id, answerer_id, answer_content, COUNT(*) as count, 
             GROUP_CONCAT(answer_id ORDER BY answered_at ASC) as answer_ids
      FROM qa_answers 
      GROUP BY qa_id, answerer_id, answer_content
      HAVING COUNT(*) > 1
    `);
    
    let deletedCount = 0;
    
    for (const duplicate of duplicates) {
      // Keep the first answer, delete the rest
      const answerIds = duplicate.answer_ids.split(',');
      const idsToDelete = answerIds.slice(1); // Remove first ID, keep the rest for deletion
      
      if (idsToDelete.length > 0) {
        await connection.execute(`
          DELETE FROM qa_answers WHERE answer_id IN (${idsToDelete.map(() => '?').join(',')})
        `, idsToDelete);
        
        deletedCount += idsToDelete.length;
      }
    }
    
    res.json({
      message: `Cleanup completed successfully`,
      duplicateGroups: duplicates.length,
      answersDeleted: deletedCount,
      details: duplicates.map(d => ({
        qa_id: d.qa_id,
        answerer_id: d.answerer_id,
        duplicates_found: d.count,
        answer_preview: d.answer_content.substring(0, 50) + '...'
      }))
    });
    
  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
    res.status(500).json({ error: 'Error during cleanup', details: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== STAFF DASHBOARD ROUTE ==========

// Staff Dashboard route
app.get('/staff/dashboard', requireStaff, (req, res) => {
  res.render('staff/dashboard', {
    title: 'Staff Dashboard - Vintique',
    layout: 'staff',
    activePage: 'dashboard',
    user: req.session.user
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Handle graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT (Ctrl+C). Shutting down gracefully...');
  
  // Close database connection
  if (connection) {
    connection.end((err) => {
      if (err) {
        console.error('Error closing database connection:', err);
      } else {
        console.log('Database connection closed.');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});