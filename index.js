const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'public/uploads');
const messagesUploadDir = path.join(__dirname, 'public/uploads/messages');
const profilePhotoDir = path.join(__dirname, 'public/uploads/profilephoto');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(messagesUploadDir)) {
  fs.mkdirSync(messagesUploadDir, { recursive: true });
}

if (!fs.existsSync(profilePhotoDir)) {
  fs.mkdirSync(profilePhotoDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (req.route && req.route.path.includes('messages')) {
      cb(null, messagesUploadDir);
    } else if (req.route && req.route.path.includes('account-settings')) {
      cb(null, profilePhotoDir);
    } else {
      cb(null, uploadsDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    if (req.route && req.route.path.includes('messages')) {
      cb(null, 'msg_' + uniqueSuffix + extension);
    } else if (req.route && req.route.path.includes('account-settings')) {
      cb(null, 'profile_' + uniqueSuffix + extension);
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
    add: function(a, b) {
      return a + b;
    },
    formatDate: function(date) {
      return new Date(date).toLocaleDateString();
    },
    timeAgo: function(date) {
      if (!date || date === 'null' || date === 'undefined') {
        return 'Date unavailable';
      }
      
      const now = new Date();
      const messageDate = new Date(date);
      
      // Check if the date is valid
      if (isNaN(messageDate.getTime())) {
        return 'Date unavailable';
      }
      
      const diffInMinutes = Math.floor((now - messageDate) / (1000 * 60));
      const diffInDays = Math.floor(diffInMinutes / 1440);
      
      if (diffInMinutes < 1) return 'Just now';
      if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
      if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;
      if (diffInDays < 7) return `${diffInDays} days ago`;
      if (diffInDays < 30) return `${diffInDays} days ago`;
      
      // Calculate months and years
      const diffInMonths = Math.floor(diffInDays / 30);
      const diffInYears = Math.floor(diffInDays / 365);
      
      if (diffInYears >= 1) {
        return diffInYears === 1 ? '1 year ago' : `${diffInYears} years ago`;
      } else if (diffInMonths >= 1) {
        return diffInMonths === 1 ? '1 month ago' : `${diffInMonths} months ago`;
      } else {
        return messageDate.toLocaleDateString();
      }
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
  secret: process.env.SESSION_SECRET,
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
const callbackConnection = mysql_callback.createConnection({
  host: 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '261104',
  database: process.env.DB_NAME || 'vintiquedb'
});

callbackConnection.connect(err => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    console.log('Continuing without database connection...');
  } else {
    console.log('Connected to MySQL!');
  }
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

// Test product detail route with mock data
app.get('/test-product/:id', (req, res) => {
  const mockListing = {
    listing_id: req.params.id,
    title: 'Test Product',
    description: 'This is a test product for debugging purposes.',
    price: 99.99,
    category: 'clothing',
    brand: 'Test Brand',
    size: 'M',
    item_condition: 'excellent',
    username: 'testuser',
    is_verified: true,
    image_url: '/assets/logo.png',
    additional_images: [],
    created_at: new Date()
  };
  
  res.render('users/product_detail', { 
    layout: 'user', 
    activePage: 'shop', 
    listing: mockListing,
    user: req.session.user 
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

// Register routes
app.get('/register', (req, res) => {
  res.render('register', { layout: 'user', activePage: 'register' });
});

// Registration handler
app.post('/register', (req, res) => {
  const { firstname, lastname, username, email, phone, password, confirmPassword } = req.body;
  
  if (!firstname || !lastname || !username || !email || !phone || !password || !confirmPassword) {
    return res.render('register', { layout: 'user', activePage: 'register', error: 'All fields are required.' });
  }
  
  if (password !== confirmPassword) {
    return res.render('register', { layout: 'user', activePage: 'register', error: 'Passwords do not match.' });
  }

  const checkSql = 'SELECT * FROM user_information WHERE username = ? OR email = ? OR phone_number = ?';
      callbackConnection.query(checkSql, [username, email, phone], (err, results) => {
    if (err) {
      console.error('Check unique error:', err);
      return res.status(500).send('Database error');
    }
    if (results.length > 0) {
      let errorMsg = '';
      if (results.some(u => u.username === username)) errorMsg += 'Username already exists. ';
      if (results.some(u => u.email === email)) errorMsg += 'Email already exists. ';
      if (results.some(u => u.phone_number === phone)) errorMsg += 'Phone number already exists. ';
      return res.render('register', { layout: 'user', activePage: 'register', error: errorMsg.trim() });
    }

    connection.beginTransaction(err => {
      if (err) {
        console.error('Transaction start error:', err);
        return res.status(500).send('Database error');
      }
      const insertUserSql = 'INSERT INTO users (email, phone_number, password, role) VALUES (?, ?, ?, ?)';
      callbackConnection.query(insertUserSql, [email, phone, password, 'user'], (err, userResult) => {
        if (err) {
          callbackConnection.rollback(() => {});
          if (err.code === 'ER_DUP_ENTRY') {
            return res.render('register', { layout: 'user', activePage: 'register', error: 'Email or phone number already exists.' });
          }
          console.error('Insert users error:', err);
          return res.status(500).send('Database error');
        }
        const userId = userResult.insertId;
        const insertInfoSql = 'INSERT INTO user_information (user_id, username, first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?, ?, ?)';
                  callbackConnection.query(insertInfoSql, [userId, username, firstname, lastname, email, phone], (err) => {
          if (err) {
            callbackConnection.rollback(() => {});
            console.error('Insert user_information error:', err);
            return res.status(500).send('Database error');
          }
                      callbackConnection.commit(err => {
              if (err) {
                callbackConnection.rollback(() => {});
                console.error('Transaction commit error:', err);
                return res.status(500).send('Database error');
              }
              res.redirect('/login');
            });
        });
      });
    });
  });
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

// ========== PRODUCT ROUTES ==========

// Post Product GET
app.get('/post_product', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  res.render('users/post_product', {
    layout: 'user',
    activePage: 'sell'
  });
});

// Post Product POST
app.post('/post_product', upload.array('images', 5), (req, res) => {
  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send('You must be logged in to post a product.');
  }
  const userId = req.session.user.id;
  const { title, description, brand, size, category, condition, price } = req.body;
  const images = req.files;

  if (!title || !description || !category || !condition || !price || !images || images.length === 0) {
    return res.render('users/post_product', {
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
      activePage: 'sell',
      error: 'All required fields and at least one image must be provided.'
    });
  }

  const insertListingSql = `INSERT INTO listings (user_id, title, description, brand, size, category, item_condition, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  callbackConnection.query(insertListingSql, [userId, title, description, brand, size, category, condition, price], (err, result) => {
    if (err) {
      console.error('Insert listing error:', err);
      return res.status(500).send('Database error');
    }
    const listingId = result.insertId;
    const imageSql = `INSERT INTO listing_images (listing_id, image_url, is_main) VALUES ?`;
    const imageValues = images.map((img, idx) => [
      listingId,
      '/uploads/' + img.filename,
      idx === images.length - 1 // Last image is cover
    ]);
    callbackConnection.query(imageSql, [imageValues], (err2) => {
      if (err2) {
        console.error('Insert images error:', err2);
        return res.status(500).send('Database error');
      }
      res.render('users/post_product', {
        layout: 'user',
        activePage: 'sell',
        success: 'Product posted successfully!'
      });
    });
  });
});

// My Listing GET
app.get('/my_listing', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  const userId = req.session.user.id;
  const sql = `
    SELECT l.listing_id, l.title, l.price, l.category, l.item_condition, l.status, l.created_at, l.updated_at, l.brand, l.size,
          (
            SELECT image_url FROM listing_images img2
            WHERE img2.listing_id = l.listing_id
            ORDER BY img2.image_id DESC
            LIMIT 1
          ) as image_url,
          COALESCE(
            latest_order.created_at,
            CASE WHEN l.status = 'sold' THEN l.updated_at ELSE NULL END
          ) as sold_date
    FROM listings l
    LEFT JOIN (
      SELECT oi.listing_id, MAX(o.created_at) as created_at
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      WHERE o.status IN ('paid', 'completed')
      GROUP BY oi.listing_id
    ) latest_order ON l.listing_id = latest_order.listing_id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC`;
  callbackConnection.query(sql, [userId], (err, listings) => {
    if (err) return res.status(500).send('Database error');
    res.render('users/my_listing', {
      layout: 'user',
      activePage: 'mylistings',
      listings
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
  });
});

// Edit Listing GET
app.get('/edit_listing/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const listingId = req.params.id;
  const sql = `SELECT * FROM listings WHERE listing_id = ?`;
  callbackConnection.query(sql, [listingId], (err, results) => {
    if (err || results.length === 0) return res.status(404).send('Listing not found');
    const listing = results[0];
    if (listing.user_id !== req.session.user.id) return res.status(403).send('Forbidden');
    // Fetch images
    const imgSql = 'SELECT image_url FROM listing_images WHERE listing_id = ? ORDER BY image_id DESC';
    callbackConnection.query(imgSql, [listingId], (err2, imgResults) => {
      listing.images = imgResults ? imgResults.map(img => img.image_url) : [];
      res.render('users/edit_listing', { layout: 'user', listing });
    });
  });
});

// Edit Listing POST
app.post('/edit_listing/:id', upload.array('images', 5), (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const listingId = req.params.id;
  const { title, description, brand, size, category, item_condition, price, delete_images } = req.body;
  // Only allow update if user owns the listing
  const checkSql = 'SELECT user_id FROM listings WHERE listing_id = ?';
  callbackConnection.query(checkSql, [listingId], (err, results) => {
    if (err || results.length === 0) return res.status(404).send('Listing not found');
    if (results[0].user_id !== req.session.user.id) return res.status(403).send('Forbidden');
    const updateSql = `UPDATE listings SET title=?, description=?, brand=?, size=?, category=?, item_condition=?, price=? WHERE listing_id=?`;
    callbackConnection.query(updateSql, [title, description, brand, size, category, item_condition, price, listingId], (err2) => {
      if (err2) return res.status(500).send('Database error');
      // Handle deleted images (legacy, if you still submit the form)
      if (delete_images) {
        let imgsToDelete = [];
        try { imgsToDelete = JSON.parse(delete_images); } catch {}
        if (imgsToDelete.length > 0) {
          const delImgSql = 'DELETE FROM listing_images WHERE listing_id = ? AND image_url IN (?)';
          callbackConnection.query(delImgSql, [listingId, imgsToDelete], () => {});
          // Delete files from filesystem
          imgsToDelete.forEach(imgUrl => {
            if (imgUrl.startsWith('/uploads/')) {
              const filePath = path.join(__dirname, 'public', imgUrl);
              fs.unlink(filePath, err => { if (err) console.error('Failed to delete file:', filePath, err); });
            }
          });
        }
      }
      // Handle new images if uploaded
      if (req.files && req.files.length > 0) {
        const imageSql = `INSERT INTO listing_images (listing_id, image_url, is_main) VALUES ?`;
        const imageValues = req.files.map((img, idx) => [listingId, '/uploads/' + img.filename, idx === req.files.length - 1]);
        callbackConnection.query(imageSql, [imageValues], () => {
          res.redirect('/my_listing');
        });
      } else {
        res.redirect('/my_listing');
      }
    });
  });
});

// Delete image immediately (AJAX)
app.post('/delete_image', (req, res) => {
  const { imgUrl, listingId } = req.body;
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  // Verify listing ownership
  const checkSql = 'SELECT user_id FROM listings WHERE listing_id = ?';
  callbackConnection.query(checkSql, [listingId], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ error: 'Listing not found' });
    if (results[0].user_id !== req.session.user.id) return res.status(403).json({ error: 'Forbidden' });

    const delImgSql = 'DELETE FROM listing_images WHERE listing_id = ? AND image_url = ?';
    callbackConnection.query(delImgSql, [listingId, imgUrl], err2 => {
      if (err2) return res.status(500).json({ error: 'Database error' });

      // Delete file from filesystem
      if (imgUrl && imgUrl.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, 'public', imgUrl);
        fs.unlink(filePath, err3 => { if (err3) console.error('File deletion error:', err3); });
      }
      res.json({ success: true });
    });
  });
});

// Marketplace route
app.get('/marketplace', (req, res) => {
  let sql = `
    SELECT l.listing_id, l.title, l.price, l.category, l.item_condition, l.created_at, l.brand, l.size,
          (
            SELECT image_url FROM listing_images img2
            WHERE img2.listing_id = l.listing_id
            ORDER BY img2.is_main DESC, img2.image_id ASC
            LIMIT 1
          ) as image_url,
          COALESCE(u.email, 'Unknown') as username
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.user_id
    WHERE l.status = 'active'`;
  const params = [];
  if (req.session.user && req.session.user.role === 'user') {
    sql += ' AND l.user_id != ?';
    params.push(req.session.user.id);
  }
  sql += '\n    ORDER BY l.created_at DESC';
  callbackConnection.query(sql, params, (err, listings) => {
    if (err) return res.status(500).send('Database error');
    
    // Handle cases where no image is found
    listings.forEach(listing => {
      if (!listing.image_url || listing.image_url === 'null') {
        listing.image_url = '/assets/logo.png';
      } else {
        // Ensure the image URL has the correct path
        listing.image_url = listing.image_url.startsWith('/uploads/') ? listing.image_url : `/uploads/${listing.image_url}`;
      }
    });
    
    res.render('users/marketplace', { layout: 'user', activePage: 'shop', listings });
  });
});

// Cart page route
app.get('/cart', (req, res) => {
  res.render('users/cart', { layout: 'user', activePage: 'cart', user: req.session.user });
});

// Checkout success page
app.get('/checkout/success', (req, res) => {
  res.render('users/checkout_success', { 
    layout: 'user', 
    activePage: 'cart', 
    user: req.session.user,
    session_id: req.query.session_id 
  });
});



// Product detail page
app.get('/listing/:id', (req, res) => {
  const listingId = req.params.id;
  
  const sql = `
    SELECT l.*, 
           COALESCE(u.email, 'Unknown') as username,
           COALESCE(GROUP_CONCAT(li.image_url ORDER BY li.is_main DESC, li.image_id ASC), '') as image_urls
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.user_id
    LEFT JOIN listing_images li ON l.listing_id = li.listing_id
    WHERE l.listing_id = ?
    GROUP BY l.listing_id`;
    
  callbackConnection.query(sql, [listingId], (err, results) => {
    if (err) {
      console.error('Database error in product detail:', err);
      return res.status(500).render('users/product_detail', { 
        layout: 'user', 
        activePage: 'shop', 
        error: 'Database connection error. Please try again later.',
        user: req.session.user 
      });
    }
    if (results.length === 0) {
      return res.status(404).render('users/product_detail', { 
        layout: 'user', 
        activePage: 'shop', 
        error: 'Product not found.',
        user: req.session.user 
      });
    }
    
    const listing = results[0];
    
    // Parse image URLs
    if (listing.image_urls) {
      const imageUrls = listing.image_urls.split(',').map(url => {
        // Clean up the URL and ensure it has the correct path
        const cleanUrl = url.trim();
        if (cleanUrl && cleanUrl !== 'null') {
          return cleanUrl.startsWith('/uploads/') ? cleanUrl : `/uploads/${cleanUrl}`;
        }
        return null;
      }).filter(url => url !== null);
      
      if (imageUrls.length > 0) {
        listing.image_url = imageUrls[0]; // Main image
        listing.additional_images = imageUrls.slice(1); // Additional images
      } else {
        listing.image_url = '/assets/logo.png'; // Default image
        listing.additional_images = [];
      }
    } else {
      listing.image_url = '/assets/logo.png'; // Default image
      listing.additional_images = [];
    }
    
    res.render('users/product_detail', { 
      layout: 'user', 
      activePage: 'shop', 
      listing,
      user: req.session.user 
    });
  });
});

// Mark listing as sold
app.post('/listings/:id/mark_sold', (req, res) => {
  const listingId = req.params.id;
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  // Only the owner can mark as sold
  const checkSql = 'SELECT user_id FROM listings WHERE listing_id = ?';
  callbackConnection.query(checkSql, [listingId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (results.length === 0) return res.status(404).json({ error: 'Listing not found' });
    const listingOwner = results[0].user_id;
    if (req.session.user.id !== listingOwner) {
      return res.status(403).json({ error: 'You do not have permission to mark this listing as sold' });
    }
    const updateSql = "UPDATE listings SET status = 'sold', updated_at = NOW() WHERE listing_id = ?";
    callbackConnection.query(updateSql, [listingId], (err2, result) => {
      if (err2) return res.status(500).json({ error: 'Database error during update' });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Listing not found' });
      res.json({ success: true });
    });
  });
});

// Delete listing endpoint
app.delete('/listings/:id', (req, res) => {
  const listingId = req.params.id;
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  const checkSql = 'SELECT user_id FROM listings WHERE listing_id = ?';
  callbackConnection.query(checkSql, [listingId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (results.length === 0) return res.status(404).json({ error: 'Listing not found' });

    const listingOwner = results[0].user_id;
    if (req.session.user.role !== 'staff' && req.session.user.id !== listingOwner) {
      return res.status(403).json({ error: 'You do not have permission to delete this listing' });
    }

    const deleteSql = 'DELETE FROM listings WHERE listing_id = ?';
    callbackConnection.query(deleteSql, [listingId], (err, result) => {
      if (err) return res.status(500).json({ error: 'Database error during deletion' });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Listing not found' });
      res.json({ success: true });
    });
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

// ========== ACCOUNT SETTINGS ROUTES ==========

// Account settings page
app.get('/account-settings', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  res.render('users/account_setting', {
    layout: 'user',
    activePage: 'account',
    user: req.session.user
  });
});

// API: Get user info for account settings
app.get('/account-settings/api', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.id;
    const sql = `SELECT username, first_name, last_name, email, phone_number, profile_image_url,
      address_name, address_street, address_city, address_state, address_country, address_postal_code, address_phone,
      address_name_2, address_street_2, address_city_2, address_state_2, address_country_2, address_postal_code_2, address_phone_2,
      address_name_3, address_street_3, address_city_3, address_state_3, address_country_3, address_postal_code_3, address_phone_3,
      default_address_index
      FROM user_information WHERE user_id = ?`;
    
    const [results] = await connection.execute(sql, [userId]);
    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(results[0]);
  } catch (error) {
    console.error('Account settings API error:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Update user info for account settings
app.post('/account-settings/api', upload.single('profile_image'), async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.id;
    let {
      first_name, last_name, email, phone_number,
      address_name, address_street, address_city, address_state, address_country, address_postal_code, address_phone,
      address_name_2, address_street_2, address_city_2, address_state_2, address_country_2, address_postal_code_2, address_phone_2,
      address_name_3, address_street_3, address_city_3, address_state_3, address_country_3, address_postal_code_3, address_phone_3,
      default_address_index
    } = req.body;
    
    // If this is just a profile image upload (no other fields), get current user data
    if (!first_name && !last_name && !email && !phone_number && req.file) {
      const [currentUser] = await connection.execute(
        'SELECT first_name, last_name, email, phone_number, profile_image_url FROM user_information WHERE user_id = ?',
        [userId]
      );
      
      if (currentUser.length > 0) {
        const user = currentUser[0];
        first_name = user.first_name;
        last_name = user.last_name;
        email = user.email;
        phone_number = user.phone_number;
        // Keep existing address fields as null since we're not updating them
      }
    }

    // Convert empty strings and undefined values to null for address fields
    const addressFields = [
      'address_name', 'address_street', 'address_city', 'address_state', 'address_country', 'address_postal_code', 'address_phone',
      'address_name_2', 'address_street_2', 'address_city_2', 'address_state_2', 'address_country_2', 'address_postal_code_2', 'address_phone_2',
      'address_name_3', 'address_street_3', 'address_city_3', 'address_state_3', 'address_country_3', 'address_postal_code_3', 'address_phone_3'
    ];
    
    addressFields.forEach(field => {
      if (req.body[field] === '' || req.body[field] === undefined || req.body[field] === 'undefined') {
        req.body[field] = null;
      }
    });
    
    // Also handle undefined values for main fields
    if (first_name === undefined) first_name = null;
    if (last_name === undefined) last_name = null;
    if (email === undefined) email = null;
    if (phone_number === undefined) phone_number = null;

    // Validate default_address_index
    let defaultIndex = parseInt(default_address_index, 10);
    if (![1, 2, 3].includes(defaultIndex)) defaultIndex = 1;

    let profile_image_url = req.body.current_profile_image_url;
    if (req.file) {
      profile_image_url = '/uploads/profilephoto/' + req.file.filename;
    }
    
    // Check if we have address data or other fields to update
    const hasAddressData = req.body.address_name || req.body.address_street || req.body.address_city || 
                          req.body.address_name_2 || req.body.address_street_2 || req.body.address_city_2 ||
                          req.body.address_name_3 || req.body.address_street_3 || req.body.address_city_3 ||
                          default_address_index;
    
    const hasPersonalData = first_name || last_name || email || phone_number;
    
    // If this is just a profile image upload (no other fields), use a simpler query
    let sql, params;
    
    if (req.file && !hasPersonalData && !hasAddressData) {
      // Only updating profile image
      sql = `UPDATE user_information SET profile_image_url = ? WHERE user_id = ?`;
      params = [profile_image_url, userId];
    } else {
      // Full update with all fields
      sql = `UPDATE user_information SET first_name=?, last_name=?, email=?, phone_number=?, profile_image_url=?,
        address_name=?, address_street=?, address_city=?, address_state=?, address_country=?, address_postal_code=?, address_phone=?,
        address_name_2=?, address_street_2=?, address_city_2=?, address_state_2=?, address_country_2=?, address_postal_code_2=?, address_phone_2=?,
        address_name_3=?, address_street_3=?, address_city_3=?, address_state_3=?, address_country_3=?, address_postal_code_3=?, address_phone_3=?,
        default_address_index=?
        WHERE user_id=?`;
      
      params = [
        first_name, last_name, email, phone_number, profile_image_url,
        req.body.address_name, req.body.address_street, req.body.address_city, req.body.address_state, req.body.address_country, req.body.address_postal_code, req.body.address_phone,
        req.body.address_name_2, req.body.address_street_2, req.body.address_city_2, req.body.address_state_2, req.body.address_country_2, req.body.address_postal_code_2, req.body.address_phone_2,
        req.body.address_name_3, req.body.address_street_3, req.body.address_city_3, req.body.address_state_3, req.body.address_country_3, req.body.address_postal_code_3, req.body.address_phone_3,
        defaultIndex, userId
      ];
    }
    
    // Debug: Log the parameters to see what's being sent
    console.log('Profile update parameters:', {
      userId,
      first_name,
      last_name,
      email,
      phone_number,
      profile_image_url,
      defaultIndex,
      hasAddressData,
      hasPersonalData,
      addressFields: {
        address_name: req.body.address_name,
        address_street: req.body.address_street,
        address_city: req.body.address_city,
        address_name_2: req.body.address_name_2,
        address_street_2: req.body.address_street_2,
        address_city_2: req.body.address_city_2,
        address_name_3: req.body.address_name_3,
        address_street_3: req.body.address_street_3,
        address_city_3: req.body.address_city_3
      }
    });
    
    await connection.execute(sql, params);
    
    res.json({ success: true, profile_image_url });
  } catch (error) {
    console.error('Account settings update error:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Change user password
app.post('/account-settings/password', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.id;
    const { current_password, new_password, confirm_password } = req.body;
    
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'New passwords do not match.' });
    }
    
    // Check current password
    const [users] = await connection.execute('SELECT password FROM users WHERE user_id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (users[0].password !== current_password) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    
    // Update password
    await connection.execute('UPDATE users SET password = ? WHERE user_id = ?', [new_password, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Database error: ' + error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Get user addresses for checkout
app.get('/api/user/addresses', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.id;
    
    // First check if user exists in user_information table
    const checkUserSql = `SELECT user_id FROM user_information WHERE user_id = ?`;
    const [userCheck] = await connection.execute(checkUserSql, [userId]);
    
    if (userCheck.length === 0) {
      // Create user_information entry if it doesn't exist
      const createUserInfoSql = `INSERT INTO user_information (user_id, username, email, phone_number) 
                                SELECT user_id, email, email, phone_number FROM users WHERE user_id = ?`;
      await connection.execute(createUserInfoSql, [userId]);
    }
    
    const sql = `SELECT 
      address_name, address_street, address_city, address_state, address_country, address_postal_code, address_phone,
      address_name_2, address_street_2, address_city_2, address_state_2, address_country_2, address_postal_code_2, address_phone_2,
      address_name_3, address_street_3, address_city_3, address_state_3, address_country_3, address_postal_code_3, address_phone_3,
      default_address_index
      FROM user_information WHERE user_id = ?`;
    
    const [results] = await connection.execute(sql, [userId]);
    
    if (results.length === 0) {
      return res.json({ addresses: [] });
    }
    
    const userData = results[0];
    const addresses = [];
    
    // Process address 1
    if (userData.address_street || userData.address_city || userData.address_country) {
      addresses.push({
        name: userData.address_name || 'Address 1',
        street: userData.address_street,
        city: userData.address_city,
        state: userData.address_state,
        country: userData.address_country,
        postal_code: userData.address_postal_code,
        phone: userData.address_phone,
        isDefault: userData.default_address_index === 1
      });
    }
    
    // Process address 2
    if (userData.address_street_2 || userData.address_city_2 || userData.address_country_2) {
      addresses.push({
        name: userData.address_name_2 || 'Address 2',
        street: userData.address_street_2,
        city: userData.address_city_2,
        state: userData.address_state_2,
        country: userData.address_country_2,
        postal_code: userData.address_postal_code_2,
        phone: userData.address_phone_2,
        isDefault: userData.default_address_index === 2
      });
    }
    
    // Process address 3
    if (userData.address_street_3 || userData.address_city_3 || userData.address_country_3) {
      addresses.push({
        name: userData.address_name_3 || 'Address 3',
        street: userData.address_street_3,
        city: userData.address_city_3,
        state: userData.address_state_3,
        country: userData.address_country_3,
        postal_code: userData.address_postal_code_3,
        phone: userData.address_phone_3,
        isDefault: userData.default_address_index === 3
      });
    }
    
    res.json({ addresses });
  } catch (error) {
    console.error('Error fetching user addresses:', error);
    res.status(500).json({ error: 'Database error' });
  } finally {
    if (connection) await connection.end();
  }
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

// Staff User Management route
app.get('/staff/user_management', requireStaff, (req, res) => {
  const sql = `SELECT u.user_id, ui.username, u.email, u.phone_number as phone, 
               COALESCE(ui.status, 'active') as status, u.role
               FROM users u
               LEFT JOIN user_information ui ON u.user_id = ui.user_id
               WHERE u.role = 'user'`;
  callbackConnection.query(sql, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    const users = results.map(u => ({ ...u, isBanned: u.status === 'suspended' }));
    res.render('staff/user_management', { layout: 'staff', activePage: 'user_management', users });
  });
});

// Legacy users route
app.get('/users', requireStaff, (req, res) => {
  res.redirect('/staff/user_management');
});

// Staff Management route
app.get('/staff/staff_management', requireAdmin, async (req, res) => {
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

// Staff User Management API endpoints
app.patch('/users/:id', requireStaff, (req, res) => {
  const userId = req.params.id;
  const { username, email, phone, status } = req.body;
  if (!username || !email || !phone || !status) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }
  const checkSql = `
    SELECT u.user_id 
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE (ui.username = ? OR u.email = ? OR u.phone_number = ?) 
      AND u.user_id != ?
  `;
  callbackConnection.query(checkSql, [username, email, phone, userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error during validation.' });
    if (results.length > 0) return res.status(400).json({ error: 'Username, email, or phone number already exists.' });
    connection.beginTransaction(err => {
      if (err) return res.status(500).json({ error: 'Database transaction error.' });
      const updateUsers = `UPDATE users SET email = ?, phone_number = ? WHERE user_id = ?`;
      callbackConnection.query(updateUsers, [email, phone, userId], err => {
        if (err) return callbackConnection.rollback(() => res.status(500).json({ error: 'Error updating users table.' }));
        const updateInfo = `UPDATE user_information SET username = ?, email = ?, phone_number = ?, status = ? WHERE user_id = ?`;
        callbackConnection.query(updateInfo, [username, email, phone, status, userId], err => {
          if (err) return callbackConnection.rollback(() => res.status(500).json({ error: 'Error updating user_information table.' }));
                      callbackConnection.commit(err => {
              if (err) return callbackConnection.rollback(() => res.status(500).json({ error: 'Transaction commit error.' }));
              res.json({ success: true });
            });
        });
      });
    });
  });
});

// Delete user
app.delete('/users/:id', requireStaff, (req, res) => {
  const userId = req.params.id;
  const checkRoleSql = 'SELECT role FROM users WHERE user_id = ?';
  callbackConnection.query(checkRoleSql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (results.length === 0) return res.status(404).json({ error: 'User not found.' });
    if (results[0].role === 'staff') return res.status(403).json({ error: 'Cannot delete staff users.' });
    const deleteSql = 'DELETE FROM users WHERE user_id = ?';
    callbackConnection.query(deleteSql, [userId], (err, result) => {
      if (err) return res.status(500).json({ error: 'Database error during deletion.' });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });
      res.json({ success: true });
    });
  });
});

// Change user status
app.patch('/users/:id/status', requireStaff, (req, res) => {
  const userId = req.params.id;
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const updateStatusSql = 'UPDATE user_information SET status = ? WHERE user_id = ?';
  callbackConnection.query(updateStatusSql, [status, userId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Database error updating status.' });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true });
  });
});

// Staff Management API endpoints
app.patch('/staff/:id', requireAdmin, async (req, res) => {
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

// ========== CART API ENDPOINTS ==========

// Get user's cart items
app.get('/api/cart', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
    const [cartItems] = await connection.execute(`
      SELECT c.cart_id, c.quantity, c.added_at,
             l.listing_id, l.title, l.price, l.item_condition, l.category,
             u.email as seller_username,
             (SELECT image_url FROM listing_images li 
              WHERE li.listing_id = l.listing_id 
              ORDER BY li.is_main DESC, li.image_id ASC 
              LIMIT 1) as image_url
      FROM cart c
      JOIN listings l ON c.listing_id = l.listing_id
      JOIN users u ON l.user_id = u.user_id
      WHERE c.user_id = ? AND l.status = 'active'
      ORDER BY c.added_at DESC
    `, [userId]);
    
    // Handle cases where no image is found
    cartItems.forEach(item => {
      if (!item.image_url || item.image_url === 'null') {
        item.image_url = '/assets/logo.png';
      } else {
        item.image_url = item.image_url.startsWith('/uploads/') ? item.image_url : `/uploads/${item.image_url}`;
      }
    });
    
    res.json({ items: cartItems });
  } catch (error) {
    console.error('Cart load error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Add item to cart
app.post('/api/cart', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    const { listing_id, quantity = 1 } = req.body;
    
    if (!listing_id) {
      return res.status(400).json({ error: 'Listing ID is required.' });
    }
    
    // Check if listing exists and is active
    const [listings] = await connection.execute(`
      SELECT listing_id, user_id, title FROM listings 
      WHERE listing_id = ? AND status = 'active'
    `, [listing_id]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found or not available.' });
    }
    
    // Check if user is trying to add their own listing
    if (listings[0].user_id === userId) {
      return res.status(400).json({ error: 'You cannot add your own listing to cart.' });
    }
    
    // Check if item already exists in cart
    const [existingItems] = await connection.execute(`
      SELECT cart_id, quantity FROM cart 
      WHERE user_id = ? AND listing_id = ?
    `, [userId, listing_id]);
    
    if (existingItems.length > 0) {
      // Item already in cart - return error
      return res.status(400).json({ 
        error: `"${listings[0].title}" is already in your cart.`,
        alreadyInCart: true 
      });
    } else {
      // Add new item
      await connection.execute(`
        INSERT INTO cart (user_id, listing_id, quantity) VALUES (?, ?, ?)
      `, [userId, listing_id, quantity]);
      res.json({ 
        success: true, 
        message: `"${listings[0].title}" added to cart!` 
      });
    }
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Update cart item quantity
app.put('/api/cart/:cartId/quantity', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    const cartId = req.params.cartId;
    const { change } = req.body;
    
    // Get current cart item
    const [cartItems] = await connection.execute(`
      SELECT quantity FROM cart WHERE cart_id = ? AND user_id = ?
    `, [cartId, userId]);
    
    if (cartItems.length === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }
    
    const newQuantity = cartItems[0].quantity + change;
    
    if (newQuantity <= 0) {
      // Remove item if quantity becomes 0 or less
      await connection.execute(`
        DELETE FROM cart WHERE cart_id = ?
      `, [cartId]);
      res.json({ success: true, message: 'Item removed from cart.' });
    } else {
      // Update quantity
      await connection.execute(`
        UPDATE cart SET quantity = ? WHERE cart_id = ?
      `, [newQuantity, cartId]);
      res.json({ success: true, message: 'Quantity updated.' });
    }
  } catch (error) {
    console.error('Update quantity error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Remove item from cart
app.delete('/api/cart/:cartId', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    const cartId = req.params.cartId;
    
    const [result] = await connection.execute(`
      DELETE FROM cart WHERE cart_id = ? AND user_id = ?
    `, [cartId, userId]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }
    
    res.json({ success: true, message: 'Item removed from cart.' });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Clear entire cart
app.delete('/api/cart', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
    await connection.execute(`
      DELETE FROM cart WHERE user_id = ?
    `, [userId]);
    
    res.json({ success: true, message: 'Cart cleared.' });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== STRIPE API ENDPOINTS ==========

// Create Stripe payment intent
app.post('/api/stripe/create-payment-intent', requireAuth, async (req, res) => {
  let connection;
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return res.status(503).json({ 
        error: 'Payment processing is currently unavailable. Please contact support.' 
      });
    }
    
    connection = await createConnection();
    const { order_id, amount } = req.body;
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Order #${order_id}`,
            description: 'Vintique Purchase',
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order_id}`,
      cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order_id}&cancelled=true`,
      metadata: {
        order_id: order_id
      }
    });
    
    res.json({
      sessionId: session.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
    
  } catch (error) {
    console.error('Stripe payment intent error:', error);
    res.status(500).json({ error: 'Payment setup failed.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Manual payment verification endpoint
app.post('/api/stripe/verify-payment', requireAuth, async (req, res) => {
  let connection;
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return res.status(503).json({ 
        error: 'Payment processing is currently unavailable.' 
      });
    }
    
    const { sessionId, orderId } = req.body;
    
    if (!sessionId || !orderId) {
      return res.status(400).json({ error: 'Session ID and Order ID are required.' });
    }
    
    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('Payment status:', session.payment_status);
    
    connection = await createConnection();
    
    if (session.payment_status === 'paid') {
      // Start transaction
      await connection.beginTransaction();
      
      try {
        // Update order status to paid
        await connection.execute(`
          UPDATE orders SET status = 'paid' WHERE order_id = ?
        `, [orderId]);
        
        // Get order items to mark listings as sold
        const [orderItems] = await connection.execute(`
          SELECT listing_id FROM order_items WHERE order_id = ?
        `, [orderId]);
        
        // Mark all listings in the order as sold
        for (const item of orderItems) {
          await connection.execute(`
            UPDATE listings SET status = 'sold' WHERE listing_id = ?
          `, [item.listing_id]);
        }
        
        // Commit transaction
        await connection.commit();
        
        res.json({ 
          success: true, 
          payment_status: 'paid',
          message: 'Payment verified successfully. Items marked as sold.',
          items_sold: orderItems.length
        });
      } catch (error) {
        // Rollback on error
        await connection.rollback();
        throw error;
      }
    } else {
      // Update order status to failed
      await connection.execute(`
        UPDATE orders SET status = 'failed' WHERE order_id = ?
      `, [orderId]);
      
      res.json({ 
        success: false, 
        payment_status: session.payment_status,
        message: 'Payment was not completed.' 
      });
    }
    
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed.' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== CHECKOUT API ENDPOINTS ==========

// Create order from cart
app.post('/api/checkout', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    const { shipping_address } = req.body;
    
    // Validate shipping address
    if (!shipping_address) {
      return res.status(400).json({ error: 'Shipping address is required.' });
    }
    
    // Get cart items
    const [cartItems] = await connection.execute(`
      SELECT c.cart_id, c.quantity,
             l.listing_id, l.title, l.price, l.item_condition,
             u.email as seller_username
      FROM cart c
      JOIN listings l ON c.listing_id = l.listing_id
      JOIN users u ON l.user_id = u.user_id
      WHERE c.user_id = ? AND l.status = 'active'
    `, [userId]);
    
    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }
    
    // Calculate total
    const subtotal = cartItems.reduce((total, item) => {
      return total + (parseFloat(item.price) * item.quantity);
    }, 0);
    
    const shipping = subtotal >= 50 ? 0 : 5.99;
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + shipping + tax;
    
    // Start transaction
    await connection.beginTransaction();
    
    try {
      // Create order with shipping address
      let orderResult;
      try {
        // Try to insert with shipping address columns
        [orderResult] = await connection.execute(`
          INSERT INTO orders (user_id, total_amount, status, shipping_address_name, shipping_address_street, 
                            shipping_address_city, shipping_address_state, shipping_address_country, 
                            shipping_address_postal_code, shipping_address_phone) 
          VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
        `, [userId, total, shipping_address.name, shipping_address.street, shipping_address.city, 
            shipping_address.state, shipping_address.country, shipping_address.postal_code, shipping_address.phone]);
      } catch (dbError) {
        // If shipping address columns don't exist, fall back to basic order creation
        console.warn('Shipping address columns not found, creating order without address:', dbError.message);
        [orderResult] = await connection.execute(`
          INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, 'pending')
        `, [userId, total]);
      }
      
      const orderId = orderResult.insertId;
      
      // Create order items
      for (const item of cartItems) {
        await connection.execute(`
          INSERT INTO order_items (order_id, listing_id, quantity, price) 
          VALUES (?, ?, ?, ?)
        `, [orderId, item.listing_id, item.quantity, item.price]);
      }
      
      // Clear cart
      await connection.execute(`
        DELETE FROM cart WHERE user_id = ?
      `, [userId]);
      
      // Commit transaction
      await connection.commit();
      
      res.json({ 
        success: true, 
        order_id: orderId,
        total: total,
        message: 'Order created successfully.'
      });
      
    } catch (error) {
      // Rollback on error
      await connection.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Server error during checkout.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Create order for single item (Buy Now)
app.post('/api/checkout/single', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    const { listing_id, shipping_address } = req.body;
    
    if (!listing_id) {
      return res.status(400).json({ error: 'Listing ID is required.' });
    }
    
    // Validate shipping address
    if (!shipping_address) {
      return res.status(400).json({ error: 'Shipping address is required.' });
    }
    
    // Get listing details
    const [listings] = await connection.execute(`
      SELECT l.listing_id, l.title, l.price, l.item_condition, l.user_id,
             u.email as seller_username
      FROM listings l
      JOIN users u ON l.user_id = u.user_id
      WHERE l.listing_id = ? AND l.status = 'active'
    `, [listing_id]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found or not available.' });
    }
    
    const listing = listings[0];
    
    // Check if user is trying to buy their own listing
    if (listing.user_id === userId) {
      return res.status(400).json({ error: 'You cannot purchase your own listing.' });
    }
    
    // Calculate total
    const subtotal = parseFloat(listing.price);
    const shipping = subtotal >= 50 ? 0 : 5.99;
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + shipping + tax;
    
    // Start transaction
    await connection.beginTransaction();
    
    try {
      // Create order with shipping address
      let orderResult;
      try {
        // Try to insert with shipping address columns
        [orderResult] = await connection.execute(`
          INSERT INTO orders (user_id, total_amount, status, shipping_address_name, shipping_address_street, 
                            shipping_address_city, shipping_address_state, shipping_address_country, 
                            shipping_address_postal_code, shipping_address_phone) 
          VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
        `, [userId, total, shipping_address.name, shipping_address.street, shipping_address.city, 
            shipping_address.state, shipping_address.country, shipping_address.postal_code, shipping_address.phone]);
      } catch (dbError) {
        // If shipping address columns don't exist, fall back to basic order creation
        console.warn('Shipping address columns not found, creating order without address:', dbError.message);
        [orderResult] = await connection.execute(`
          INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, 'pending')
        `, [userId, total]);
      }
      
      const orderId = orderResult.insertId;
      
      // Create order item
      await connection.execute(`
        INSERT INTO order_items (order_id, listing_id, quantity, price) 
        VALUES (?, ?, 1, ?)
      `, [orderId, listing.listing_id, listing.price]);
      
      // Commit transaction
      await connection.commit();
      
      res.json({ 
        success: true, 
        order_id: orderId,
        total: total,
        message: 'Order created successfully.'
      });
      
    } catch (error) {
      // Rollback on error
      await connection.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('Single item checkout error:', error);
    res.status(500).json({ error: 'Server error during checkout.' });
  } finally {
    if (connection) await connection.end();
  }
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
