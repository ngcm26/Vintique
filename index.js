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
    // Check the route to determine upload directory
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
  
  // Check if account is suspended
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
  
  // Check if staff/admin account is suspended
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
  
  // Check if admin account is suspended
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
    
    // Get user from users table and join with user_information if it exists
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
    
    // Check if user is suspended (applies to both users and staff)
    if (user.status === 'suspended') {
      return res.render('users/login', { 
        error: 'Your account has been suspended',
        layout: 'user',
        activePage: 'login'
      });
    }
    
    // Simple password check (in production, use bcrypt)
    if (user.password !== password) {
      return res.render('users/login', { 
        error: 'Invalid password',
        layout: 'user',
        activePage: 'login'
      });
    }
    
    req.session.user = {
      user_id: user.user_id,
      id: user.user_id, // For compatibility
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      role: user.role,
      status: user.status
    };
    
    // Redirect based on user role
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
  connection.query(checkSql, [username, email, phone], (err, results) => {
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
      connection.query(insertUserSql, [email, phone, password, 'user'], (err, userResult) => {
        if (err) {
          connection.rollback(() => {});
          if (err.code === 'ER_DUP_ENTRY') {
            return res.render('register', { layout: 'user', activePage: 'register', error: 'Email or phone number already exists.' });
          }
          console.error('Insert users error:', err);
          return res.status(500).send('Database error');
        }
        const userId = userResult.insertId;
        const insertInfoSql = 'INSERT INTO user_information (user_id, username, first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?, ?, ?)';
        connection.query(insertInfoSql, [userId, username, firstname, lastname, email, phone], (err) => {
          if (err) {
            connection.rollback(() => {});
            console.error('Insert user_information error:', err);
            return res.status(500).send('Database error');
          }
          connection.commit(err => {
            if (err) {
              connection.rollback(() => {});
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
      layout: 'user',
      activePage: 'sell',
      error: 'All required fields and at least one image must be provided.'
    });
  }

  const insertListingSql = `INSERT INTO listings (user_id, title, description, brand, size, category, item_condition, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  connection.query(insertListingSql, [userId, title, description, brand, size, category, condition, price], (err, result) => {
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
    connection.query(imageSql, [imageValues], (err2) => {
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
    SELECT l.listing_id, l.title, l.price, l.category, l.item_condition, l.created_at, l.brand, l.size,
          (
            SELECT image_url FROM listing_images img2
            WHERE img2.listing_id = l.listing_id
            ORDER BY img2.image_id DESC
            LIMIT 1
          ) as image_url
    FROM listings l
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC`;
  connection.query(sql, [userId], (err, listings) => {
    if (err) return res.status(500).send('Database error');
    res.render('users/my_listing', {
      layout: 'user',
      activePage: 'mylistings',
      listings
    });
  });
});

// Edit Listing GET
app.get('/edit_listing/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const listingId = req.params.id;
  const sql = `SELECT * FROM listings WHERE listing_id = ?`;
  connection.query(sql, [listingId], (err, results) => {
    if (err || results.length === 0) return res.status(404).send('Listing not found');
    const listing = results[0];
    if (listing.user_id !== req.session.user.id) return res.status(403).send('Forbidden');
    // Fetch images
    const imgSql = 'SELECT image_url FROM listing_images WHERE listing_id = ? ORDER BY image_id DESC';
    connection.query(imgSql, [listingId], (err2, imgResults) => {
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
  connection.query(checkSql, [listingId], (err, results) => {
    if (err || results.length === 0) return res.status(404).send('Listing not found');
    if (results[0].user_id !== req.session.user.id) return res.status(403).send('Forbidden');
    const updateSql = `UPDATE listings SET title=?, description=?, brand=?, size=?, category=?, item_condition=?, price=? WHERE listing_id=?`;
    connection.query(updateSql, [title, description, brand, size, category, item_condition, price, listingId], (err2) => {
      if (err2) return res.status(500).send('Database error');
      // Handle deleted images (legacy, if you still submit the form)
      if (delete_images) {
        let imgsToDelete = [];
        try { imgsToDelete = JSON.parse(delete_images); } catch {}
        if (imgsToDelete.length > 0) {
          const delImgSql = 'DELETE FROM listing_images WHERE listing_id = ? AND image_url IN (?)';
          connection.query(delImgSql, [listingId, imgsToDelete], () => {});
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
        connection.query(imageSql, [imageValues], () => {
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
  connection.query(checkSql, [listingId], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ error: 'Listing not found' });
    if (results[0].user_id !== req.session.user.id) return res.status(403).json({ error: 'Forbidden' });

    const delImgSql = 'DELETE FROM listing_images WHERE listing_id = ? AND image_url = ?';
    connection.query(delImgSql, [listingId, imgUrl], err2 => {
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
            ORDER BY img2.image_id DESC
            LIMIT 1
          ) as image_url,
          ui.username
    FROM listings l
    LEFT JOIN user_information ui ON l.user_id = ui.user_id
    WHERE l.status = 'active'`;
  const params = [];
  if (req.session.user && req.session.user.role === 'user') {
    sql += ' AND l.user_id != ?';
    params.push(req.session.user.id);
  }
  sql += '\n    ORDER BY l.created_at DESC';
  connection.query(sql, params, (err, listings) => {
    if (err) return res.status(500).send('Database error');
    res.render('users/marketplace', { layout: 'user', activePage: 'shop', listings });
  });
});

// Mark listing as sold
app.post('/listings/:id/mark_sold', (req, res) => {
  const listingId = req.params.id;
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

  // Only the owner can mark as sold
  const checkSql = 'SELECT user_id FROM listings WHERE listing_id = ?';
  connection.query(checkSql, [listingId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (results.length === 0) return res.status(404).json({ error: 'Listing not found' });
    const listingOwner = results[0].user_id;
    if (req.session.user.id !== listingOwner) {
      return res.status(403).json({ error: 'You do not have permission to mark this listing as sold' });
    }
    const updateSql = "UPDATE listings SET status = 'sold' WHERE listing_id = ?";
    connection.query(updateSql, [listingId], (err2, result) => {
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
  connection.query(checkSql, [listingId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (results.length === 0) return res.status(404).json({ error: 'Listing not found' });

    const listingOwner = results[0].user_id;
    if (req.session.user.role !== 'staff' && req.session.user.id !== listingOwner) {
      return res.status(403).json({ error: 'You do not have permission to delete this listing' });
    }

    const deleteSql = 'DELETE FROM listings WHERE listing_id = ?';
    connection.query(deleteSql, [listingId], (err, result) => {
      if (err) return res.status(500).json({ error: 'Database error during deletion' });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Listing not found' });
      res.json({ success: true });
    });
  });
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
app.get('/account-settings/api', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = req.session.user.id;
  const sql = `SELECT username, first_name, last_name, email, phone_number, profile_image_url,
    address_name, address_street, address_city, address_state, address_country, address_postal_code, address_phone,
    address_name_2, address_street_2, address_city_2, address_state_2, address_country_2, address_postal_code_2, address_phone_2,
    address_name_3, address_street_3, address_city_3, address_state_3, address_country_3, address_postal_code_3, address_phone_3,
    default_address_index
    FROM user_information WHERE user_id = ?`;
  connection.query(sql, [userId], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: 'Database error or user not found' });
    res.json(results[0]);
  });
});

// API: Update user info for account settings
app.post('/account-settings/api', upload.single('profile_image'), (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = req.session.user.id;
  let {
    first_name, last_name, email, phone_number,
    address_name, address_street, address_city, address_state, address_country, address_postal_code, address_phone,
    address_name_2, address_street_2, address_city_2, address_state_2, address_country_2, address_postal_code_2, address_phone_2,
    address_name_3, address_street_3, address_city_3, address_state_3, address_country_3, address_postal_code_3, address_phone_3,
    default_address_index
  } = req.body;

  // Convert empty strings to null for address fields
  [
    'address_name', 'address_street', 'address_city', 'address_state', 'address_country', 'address_postal_code', 'address_phone',
    'address_name_2', 'address_street_2', 'address_city_2', 'address_state_2', 'address_country_2', 'address_postal_code_2', 'address_phone_2',
    'address_name_3', 'address_street_3', 'address_city_3', 'address_state_3', 'address_country_3', 'address_postal_code_3', 'address_phone_3'
  ].forEach(field => {
    if (req.body[field] === '') req.body[field] = null;
  });

  // Validate default_address_index
  let defaultIndex = parseInt(default_address_index, 10);
  if (![1, 2, 3].includes(defaultIndex)) defaultIndex = 1;

  let profile_image_url = req.body.current_profile_image_url;
  if (req.file) {
    profile_image_url = '/uploads/' + req.file.filename;
  }
  const sql = `UPDATE user_information SET first_name=?, last_name=?, email=?, phone_number=?, profile_image_url=?,
    address_name=?, address_street=?, address_city=?, address_state=?, address_country=?, address_postal_code=?, address_phone=?,
    address_name_2=?, address_street_2=?, address_city_2=?, address_state_2=?, address_country_2=?, address_postal_code_2=?, address_phone_2=?,
    address_name_3=?, address_street_3=?, address_city_3=?, address_state_3=?, address_country_3=?, address_postal_code_3=?, address_phone_3=?,
    default_address_index=?
    WHERE user_id=?`;
  connection.query(sql, [
    first_name, last_name, email, phone_number, profile_image_url,
    req.body.address_name, req.body.address_street, req.body.address_city, req.body.address_state, req.body.address_country, req.body.address_postal_code, req.body.address_phone,
    req.body.address_name_2, req.body.address_street_2, req.body.address_city_2, req.body.address_state_2, req.body.address_country_2, req.body.address_postal_code_2, req.body.address_phone_2,
    req.body.address_name_3, req.body.address_street_3, req.body.address_city_3, req.body.address_state_3, req.body.address_country_3, req.body.address_postal_code_3, req.body.address_phone_3,
    defaultIndex, userId
  ], (err, result) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ success: true, profile_image_url });
  });
});

// API: Change user password
app.post('/account-settings/password', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = req.session.user.id;
  const { current_password, new_password, confirm_password } = req.body;
  if (!current_password || !new_password || !confirm_password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (new_password !== confirm_password) {
    return res.status(400).json({ error: 'New passwords do not match.' });
  }
  // Check current password
  const sql = 'SELECT password FROM users WHERE user_id = ?';
  connection.query(sql, [userId], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: 'Database error or user not found.' });
    if (results[0].password !== current_password) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    // Update password
    const updateSql = 'UPDATE users SET password = ? WHERE user_id = ?';
    connection.query(updateSql, [new_password, userId], (err2) => {
      if (err2) return res.status(500).json({ error: 'Database error.' });
      res.json({ success: true });
    });
  });
});

// ========== STAFF ROUTES ==========

// Staff Dashboard route
app.get('/staff/dashboard', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    // Get dashboard statistics
    const [userStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN COALESCE(ui.status, 'active') = 'suspended' THEN 1 ELSE 0 END) as suspended_users
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.role = 'user'
    `);
    
    const [listingStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_listings,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_listings,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_listings
      FROM listings
    `);
    
    const [qaStats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_questions,
        SUM(CASE WHEN answer_content IS NOT NULL THEN 1 ELSE 0 END) as answered_questions
      FROM qa 
      WHERE is_verified = 1
    `);
    
    const [recentListings] = await connection.execute(`
      SELECT 
        l.*,
        ui.username,
        ui.first_name,
        ui.last_name
      FROM listings l
      LEFT JOIN user_information ui ON l.user_id = ui.user_id
      ORDER BY l.created_at DESC
      LIMIT 5
    `);
    
    const [recentUsers] = await connection.execute(`
      SELECT 
        u.*,
        ui.username,
        ui.first_name,
        ui.last_name,
        COALESCE(ui.status, 'active') as status
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.role = 'user'
      ORDER BY u.user_id DESC
      LIMIT 5
    `);
    
    const stats = {
      users: userStats[0],
      listings: listingStats[0],
      qa: qaStats[0]
    };
    
    res.render('staff/dashboard', { 
      layout: 'staff', 
      activePage: 'dashboard',
      stats,
      recentListings,
      recentUsers,
      user: req.session.user
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('staff/dashboard', { 
      layout: 'staff', 
      activePage: 'dashboard',
      error: 'Error loading dashboard',
      user: req.session.user
    });
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
  connection.query(sql, (err, results) => {
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
  let connection;
  try {
    connection = await createConnection();
    const currentUserId = req.session.user.user_id;
    
    // Get all staff and admin members except the current user
    const [staffMembers] = await connection.execute(`
      SELECT 
        u.user_id,
        u.email,
        u.phone_number,
        u.role,
        u.status,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.role IN ('staff', 'admin') AND u.user_id != ?
      ORDER BY u.user_id
    `, [currentUserId]);
    
    // Calculate KPI statistics
    const [kpiStats] = await connection.execute(`
      SELECT 
        SUM(CASE WHEN role = 'staff' THEN 1 ELSE 0 END) as totalStaff,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as totalAdmins,
        SUM(CASE WHEN role = 'staff' AND status = 'suspended' THEN 1 ELSE 0 END) as suspendedStaff,
        SUM(CASE WHEN role = 'admin' AND status = 'suspended' THEN 1 ELSE 0 END) as suspendedAdmins,
        SUM(CASE WHEN role = 'staff' AND status = 'active' THEN 1 ELSE 0 END) as activeStaff,
        SUM(CASE WHEN role = 'admin' AND status = 'active' THEN 1 ELSE 0 END) as activeAdmins
      FROM users
      WHERE role IN ('staff', 'admin')
    `);
    
    res.render('staff/staff_management', { 
      layout: 'staff', 
      activePage: 'staff_management',
      staffMembers,
      currentUser: req.session.user,
      totalStaff: kpiStats[0].totalStaff || 0,
      totalAdmins: kpiStats[0].totalAdmins || 0,
      suspendedStaff: kpiStats[0].suspendedStaff || 0,
      suspendedAdmins: kpiStats[0].suspendedAdmins || 0,
      activeStaff: kpiStats[0].activeStaff || 0,
      activeAdmins: kpiStats[0].activeAdmins || 0
    });
  } catch (error) {
    console.error('Staff management error:', error);
    res.render('staff/staff_management', { 
      layout: 'staff', 
      activePage: 'staff_management',
      error: 'Error loading staff data',
      staffMembers: [],
      currentUser: req.session.user
    });
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
  connection.query(checkSql, [username, email, phone, userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error during validation.' });
    if (results.length > 0) return res.status(400).json({ error: 'Username, email, or phone number already exists.' });
    connection.beginTransaction(err => {
      if (err) return res.status(500).json({ error: 'Database transaction error.' });
      const updateUsers = `UPDATE users SET email = ?, phone_number = ? WHERE user_id = ?`;
      connection.query(updateUsers, [email, phone, userId], err => {
        if (err) return connection.rollback(() => res.status(500).json({ error: 'Error updating users table.' }));
        const updateInfo = `UPDATE user_information SET username = ?, email = ?, phone_number = ?, status = ? WHERE user_id = ?`;
        connection.query(updateInfo, [username, email, phone, status, userId], err => {
          if (err) return connection.rollback(() => res.status(500).json({ error: 'Error updating user_information table.' }));
          connection.commit(err => {
            if (err) return connection.rollback(() => res.status(500).json({ error: 'Transaction commit error.' }));
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
  connection.query(checkRoleSql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    if (results.length === 0) return res.status(404).json({ error: 'User not found.' });
    if (results[0].role === 'staff') return res.status(403).json({ error: 'Cannot delete staff users.' });
    const deleteSql = 'DELETE FROM users WHERE user_id = ?';
    connection.query(deleteSql, [userId], (err, result) => {
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
  connection.query(updateStatusSql, [status, userId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Database error updating status.' });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true });
  });
});

// Staff Management API endpoints
app.patch('/staff/:id', requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const staffId = req.params.id;
    const { email, phone, role } = req.body;
    const currentUserId = req.session.user.user_id;
    
    // Prevent self-editing
    if (parseInt(staffId) === currentUserId) {
      return res.status(403).json({ error: 'Cannot edit your own account.' });
    }
    
    if (!email || !phone || !role) {
      return res.status(400).json({ error: 'Email, phone number, and role are required.' });
    }
    
    if (!['staff', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role value.' });
    }
    
    // Validate phone number format
    if (!/^\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Phone number must be exactly 8 digits long.' });
    }
    
    // Check if email already exists for another user
    const [existingUser] = await connection.execute(
      'SELECT user_id FROM users WHERE email = ? AND user_id != ?',
      [email, staffId]
    );
    
    if (existingUser.length > 0) {
      return res.status(409).json({ error: 'Email already exists.' });
    }
    
    // Check if phone number already exists for another user
    const [existingPhone] = await connection.execute(
      'SELECT user_id FROM users WHERE phone_number = ? AND user_id != ?',
      [phone, staffId]
    );
    
    if (existingPhone.length > 0) {
      return res.status(409).json({ error: 'Phone number already exists.' });
    }
    
    // Update user table
    await connection.execute(
      'UPDATE users SET email = ?, phone_number = ?, role = ? WHERE user_id = ?',
      [email, phone, role, staffId]
    );
    
    // Update user_information table
    await connection.execute(
      'UPDATE user_information SET email = ?, phone_number = ? WHERE user_id = ?',
      [email, phone, staffId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff update error:', error);
    res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Delete staff member
app.delete('/staff/:id', requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const staffId = req.params.id;
    const currentUserId = req.session.user.user_id;
    
    // Prevent self-deletion
    if (parseInt(staffId) === currentUserId) {
      return res.status(403).json({ error: 'Cannot delete your own account.' });
    }
    
    // Check if staff/admin member exists
    const [staffMember] = await connection.execute(
      'SELECT user_id, role FROM users WHERE user_id = ? AND role IN ("staff", "admin")',
      [staffId]
    );
    
    if (staffMember.length === 0) {
      return res.status(404).json({ error: 'Staff/Admin member not found.' });
    }
    
    // Delete staff member
    await connection.execute('DELETE FROM user_information WHERE user_id = ?', [staffId]);
    await connection.execute('DELETE FROM users WHERE user_id = ?', [staffId]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff deletion error:', error);
    res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Change staff status
app.patch('/staff/:id/status', requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const staffId = req.params.id;
    const { status } = req.body;
    const currentUserId = req.session.user.user_id;
    
    console.log('Status update request:', { staffId, status, currentUserId });
    
    // Prevent self-status-change
    if (parseInt(staffId) === currentUserId) {
      return res.status(403).json({ error: 'Cannot change your own status.' });
    }
    
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    
    const updateStatusSql = 'UPDATE users SET status = ? WHERE user_id = ? AND role IN ("staff", "admin")';
    const [result] = await connection.execute(updateStatusSql, [status, staffId]);
    
    console.log('Status update result:', { affectedRows: result.affectedRows, staffId, status });
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Staff/Admin member not found.' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff status update error:', error);
    res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Create staff member
app.post('/staff', requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    await connection.beginTransaction();

        const { email, role, phone, password } = req.body;
    
    // Validate input
    if (!email || !role || !phone || !password) {
      return res.status(400).json({ error: 'Email, role, phone number, and password are required.' });
    }

        if (!['staff', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be staff or admin.' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    
    // Validate phone number format (8 digits)
    if (!/^\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Phone number must be exactly 8 digits long.' });
    }
    
    // Check if email already exists
    const [existingUser] = await connection.execute(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );
    
    if (existingUser.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'Email already exists.' });
    }
    
    // Check if phone number already exists
    const [existingPhone] = await connection.execute(
      'SELECT user_id FROM users WHERE phone_number = ?',
      [phone]
    );
    
    if (existingPhone.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'Phone number already exists.' });
    }
    
    // Clean up any orphaned user_information records (in case of previous failed transactions)
    await connection.execute(
      'DELETE FROM user_information WHERE user_id NOT IN (SELECT user_id FROM users)'
    );

        // Insert staff member into users table
    const [result] = await connection.execute(
      'INSERT INTO users (email, phone_number, password, role, status) VALUES (?, ?, ?, ?, ?)',
      [email, phone, password, role, 'active']
    );
    
    const newStaffId = result.insertId;
    console.log('Created user with ID:', newStaffId);
    
    // Check if user_information record already exists
    const [existingInfo] = await connection.execute(
      'SELECT user_id FROM user_information WHERE user_id = ?',
      [newStaffId]
    );
    
    console.log('Existing user_information records for user_id', newStaffId, ':', existingInfo.length);
    
    if (existingInfo.length > 0) {
      console.log('Updating existing user_information record');
      // Update existing record
      await connection.execute(
        'UPDATE user_information SET username = ?, first_name = ?, last_name = ?, email = ?, phone_number = ? WHERE user_id = ?',
        [email.split('@')[0], 'Staff', 'Member', email, phone, newStaffId]
      );
    } else {
      console.log('Creating new user_information record');
      // Insert new user_information record
      await connection.execute(
        'INSERT INTO user_information (user_id, username, first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?, ?, ?)',
        [newStaffId, email.split('@')[0], 'Staff', 'Member', email, phone]
      );
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Staff member created successfully.',
      staffId: newStaffId
    });

  } catch (error) {
    console.error('Staff creation error:', error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    if (error.code === 'ER_DUP_ENTRY') {
      if (error.message.includes('email')) {
        return res.status(409).json({ error: 'Email already exists.' });
      }
      if (error.message.includes('phone_number')) {
        return res.status(409).json({ error: 'Phone number already exists.' });
      }
      return res.status(409).json({ error: 'User already exists.' });
    }

    res.status(500).json({ error: 'Database error: ' + error.message });
  } finally {
    if (connection) await connection.end();
  }
});


// ========== FAQ ROUTES ==========

// FAQ page - load the main Q&A interface
app.get('/qa', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    // Get all questions with answers and user information
    const [questions] = await connection.execute(`
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        answerer.email as answerer_email,
        answerer_info.first_name as answerer_first_name,
        answerer_info.last_name as answerer_last_name,
        answerer_info.username as answerer_username,
        COUNT(qv.vote_id) as helpful_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN users answerer ON q.answerer_id = answerer.user_id
      LEFT JOIN user_information answerer_info ON q.answerer_id = answerer_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      WHERE q.is_verified = 1
      GROUP BY q.qa_id
      ORDER BY q.asked_at DESC
    `);
    
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

// API: Get all questions (for auto-refresh)
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
        answerer.email as answerer_email,
        answerer_info.first_name as answerer_first_name,
        answerer_info.last_name as answerer_last_name,
        answerer_info.username as answerer_username,
        COUNT(qv.vote_id) as helpful_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN users answerer ON q.answerer_id = answerer.user_id
      LEFT JOIN user_information answerer_info ON q.answerer_id = answerer_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      WHERE q.is_verified = 1
    `;
    
    const params = [];
    
    if (category && category !== 'all') {
      query += ' AND q.category = ?';
      params.push(category);
    }
    
    if (status) {
      if (status === 'answered') {
        query += ' AND q.answer_content IS NOT NULL';
      } else if (status === 'pending') {
        query += ' AND q.answer_content IS NULL';
      }
    }
    
    if (search) {
      query += ' AND (q.question_text LIKE ? OR q.answer_content LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' GROUP BY q.qa_id ORDER BY q.asked_at DESC';
    
    const [questions] = await connection.execute(query, params);
    res.json(questions);
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Submit a new question
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
    
    // Insert new question
    const [result] = await connection.execute(`
      INSERT INTO qa (asker_id, asker_username, category, question_text, details, asked_at, is_verified)
      VALUES (?, ?, ?, ?, ?, NOW(), 1)
    `, [userId, username, category, question_text.trim(), details ? details.trim() : null]);
    
    // Get the created question with user info
    const [newQuestion] = await connection.execute(`
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        0 as helpful_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      WHERE q.qa_id = ?
    `, [result.insertId]);
    
    res.status(201).json(newQuestion[0]);
  } catch (error) {
    console.error('Error submitting question:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Submit an answer to a question
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
    
    // Get user information
    const [userInfo] = await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [userId]);
    
    const username = userInfo[0]?.username || userInfo[0]?.email || 'Unknown';
    
    // Update question with answer
    await connection.execute(`
      UPDATE qa 
      SET answer_content = ?, answerer_id = ?, answerer_username = ?, answered_at = NOW()
      WHERE qa_id = ?
    `, [answer_content.trim(), userId, username, questionId]);
    
    // Get the updated question
    const [updatedQuestion] = await connection.execute(`
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        answerer.email as answerer_email,
        answerer_info.first_name as answerer_first_name,
        answerer_info.last_name as answerer_last_name,
        answerer_info.username as answerer_username,
        COUNT(qv.vote_id) as helpful_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN users answerer ON q.answerer_id = answerer.user_id
      LEFT JOIN user_information answerer_info ON q.answerer_id = answerer_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      WHERE q.qa_id = ?
      GROUP BY q.qa_id
    `, [questionId]);
    
    res.json(updatedQuestion[0]);
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

// API: Search questions
app.get('/api/qa/search', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { q } = req.query;
    
    if (!q || q.trim() === '') {
      return res.json([]);
    }
    
    const searchTerm = `%${q.trim()}%`;
    
    const [questions] = await connection.execute(`
      SELECT 
        q.*,
        asker.email as asker_email,
        asker_info.first_name as asker_first_name,
        asker_info.last_name as asker_last_name,
        asker_info.username as asker_username,
        answerer.email as answerer_email,
        answerer_info.first_name as answerer_first_name,
        answerer_info.last_name as answerer_last_name,
        answerer_info.username as answerer_username,
        COUNT(qv.vote_id) as helpful_count
      FROM qa q
      LEFT JOIN users asker ON q.asker_id = asker.user_id
      LEFT JOIN user_information asker_info ON q.asker_id = asker_info.user_id
      LEFT JOIN users answerer ON q.answerer_id = answerer.user_id
      LEFT JOIN user_information answerer_info ON q.answerer_id = answerer_info.user_id
      LEFT JOIN qa_votes qv ON q.qa_id = qv.qa_id
      WHERE q.is_verified = 1 
        AND (q.question_text LIKE ? OR q.answer_content LIKE ? OR q.category LIKE ?)
      GROUP BY q.qa_id
      ORDER BY q.asked_at DESC
      LIMIT 20
    `, [searchTerm, searchTerm, searchTerm]);
    
    res.json(questions);
  } catch (error) {
    console.error('Error searching questions:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Get Q&A statistics
app.get('/api/qa/stats', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(*) as total_questions,
        SUM(CASE WHEN answer_content IS NOT NULL THEN 1 ELSE 0 END) as answered_questions,
        COUNT(DISTINCT asker_id) as unique_askers,
        COUNT(DISTINCT answerer_id) as unique_answerers
      FROM qa 
      WHERE is_verified = 1
    `);
    
    const [categoryStats] = await connection.execute(`
      SELECT 
        category,
        COUNT(*) as count,
        SUM(CASE WHEN answer_content IS NOT NULL THEN 1 ELSE 0 END) as answered
      FROM qa 
      WHERE is_verified = 1
      GROUP BY category
      ORDER BY count DESC
    `);
    
    const totalQuestions = stats[0].total_questions;
    const answeredQuestions = stats[0].answered_questions;
    const answerRate = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
    
    res.json({
      total_questions: totalQuestions,
      answered_questions: answeredQuestions,
      answer_rate: answerRate,
      unique_askers: stats[0].unique_askers,
      unique_answerers: stats[0].unique_answerers,
      category_breakdown: categoryStats
    });
  } catch (error) {
    console.error('Error fetching Q&A stats:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== MESSAGING ROUTES ==========

// Messages page - load the main messages interface
app.get('/messages', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
    // Get conversations with proper joins
    const [conversations] = await connection.execute(`
      SELECT 
        c.*,
        buyer.email as buyer_email,
        buyer_info.first_name as buyer_first_name,
        buyer_info.last_name as buyer_last_name,
        buyer_info.username as buyer_username,
        seller.email as seller_email,
        seller_info.first_name as seller_first_name,
        seller_info.last_name as seller_last_name,
        seller_info.username as seller_username,
        l.title as listing_title,
        l.price
      FROM conversations c
      LEFT JOIN users buyer ON c.buyer_id = buyer.user_id
      LEFT JOIN user_information buyer_info ON c.buyer_id = buyer_info.user_id
      LEFT JOIN users seller ON c.seller_id = seller.user_id  
      LEFT JOIN user_information seller_info ON c.seller_id = seller_info.user_id
      LEFT JOIN listings l ON c.listing_id = l.listing_id
      WHERE (c.buyer_id = ? OR c.seller_id = ?)
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    `, [userId, userId]);
    
    const formattedConversations = conversations.map(conv => {
      const isUserBuyer = conv.buyer_id === userId;
      let otherUserName;
      if (isUserBuyer) {
        otherUserName = conv.seller_first_name && conv.seller_last_name 
          ? `${conv.seller_first_name} ${conv.seller_last_name}`
          : conv.seller_username || conv.seller_email || 'Unknown User';
      } else {
        otherUserName = conv.buyer_first_name && conv.buyer_last_name 
          ? `${conv.buyer_first_name} ${conv.buyer_last_name}`
          : conv.buyer_username || conv.buyer_email || 'Unknown User';
      }
      
      return {
        ...conv,
        other_user_name: otherUserName,
        is_user_buyer: isUserBuyer,
        last_message_preview: 'Click to view messages',
        unread_count: 0
      };
    });
    
    // Render the messages template with properly serialized data
    res.render('users/messages', {
      title: 'Messages - Vintique',
      layout: 'user',
      activePage: 'messages',
      conversations: formattedConversations,
      conversationsJson: JSON.stringify(formattedConversations),
      user: req.session.user,
      userJson: JSON.stringify(req.session.user)
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.render('users/messages', {
      title: 'Messages - Vintique',
      layout: 'user',
      activePage: 'messages',
      conversations: [],
      conversationsJson: JSON.stringify([]),
      error: 'Error loading conversations',
      user: req.session.user,
      userJson: JSON.stringify(req.session.user || {})
    });
  } finally {
    if (connection) await connection.end();
  }
});

// API endpoint to get conversations (for AJAX requests)
app.get('/api/conversations', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
    // Get conversations with proper joins
    const [conversations] = await connection.execute(`
      SELECT 
        c.*,
        buyer.email as buyer_email,
        buyer_info.first_name as buyer_first_name,
        buyer_info.last_name as buyer_last_name,
        buyer_info.username as buyer_username,
        seller.email as seller_email,
        seller_info.first_name as seller_first_name,
        seller_info.last_name as seller_last_name,
        seller_info.username as seller_username,
        l.title as listing_title,
        l.price
      FROM conversations c
      LEFT JOIN users buyer ON c.buyer_id = buyer.user_id
      LEFT JOIN user_information buyer_info ON c.buyer_id = buyer_info.user_id
      LEFT JOIN users seller ON c.seller_id = seller.user_id  
      LEFT JOIN user_information seller_info ON c.seller_id = seller_info.user_id
      LEFT JOIN listings l ON c.listing_id = l.listing_id
      WHERE (c.buyer_id = ? OR c.seller_id = ?)
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
    `, [userId, userId]);
    
    const formattedConversations = conversations.map(conv => {
      const isUserBuyer = conv.buyer_id === userId;
      let otherUserName;
      if (isUserBuyer) {
        otherUserName = conv.seller_first_name && conv.seller_last_name 
          ? `${conv.seller_first_name} ${conv.seller_last_name}`
          : conv.seller_username || conv.seller_email || 'Unknown User';
      } else {
        otherUserName = conv.buyer_first_name && conv.buyer_last_name 
          ? `${conv.buyer_first_name} ${conv.buyer_last_name}`
          : conv.buyer_username || conv.buyer_email || 'Unknown User';
      }
      
      return {
        ...conv,
        other_user_name: otherUserName,
        is_user_buyer: isUserBuyer,
        last_message_preview: 'Click to view messages',
        unread_count: 0
      };
    });
    
    res.json(formattedConversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Get messages for a specific conversation
app.get('/api/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { conversationId } = req.params;
    const userId = req.session.user.user_id;
    
    // Check if user is part of this conversation
    const [conversationCheck] = await connection.execute(`
      SELECT * FROM conversations 
      WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
    `, [conversationId, userId, userId]);
    
    if (conversationCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get messages with sender information
    const [messages] = await connection.execute(`
      SELECT 
        m.*,
        u.email,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM messages m
      JOIN users u ON m.sender_id = u.user_id
      LEFT JOIN user_information ui ON m.sender_id = ui.user_id
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at ASC
    `, [conversationId]);
    
    // Mark messages as read for the current user
    await connection.execute(`
      UPDATE messages 
      SET is_read = 1 
      WHERE conversation_id = ? AND sender_id != ? AND is_read = 0
    `, [conversationId, userId]);
    
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Send a new message (updated to handle images)
app.post('/api/conversations/:conversationId/messages', requireAuth, upload.single('image'), async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { conversationId } = req.params;
    const { message_content } = req.body;
    const userId = req.session.user.user_id;
    
    // Check if we have either text or image
    if ((!message_content || message_content.trim() === '') && !req.file) {
      return res.status(400).json({ error: 'Message content or image is required' });
    }
    
    // Check if user is part of this conversation
    const [conversationCheck] = await connection.execute(`
      SELECT * FROM conversations 
      WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
    `, [conversationId, userId, userId]);
    
    if (conversationCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const conversation = conversationCheck[0];
    const senderType = conversation.buyer_id === userId ? 'buyer' : 'seller';
    
    // Get sender username
    const [senderInfo] = await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [userId]);
    
    const senderUsername = senderInfo[0]?.username || senderInfo[0]?.email || 'Unknown';
    
    // Handle image upload
    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/messages/${req.file.filename}`;
    }
    
    // Insert new message
    const [result] = await connection.execute(`
      INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, image_url, sender_type, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [conversationId, userId, senderUsername, message_content || null, imageUrl, senderType]);
    
    // Update conversation's last_message_at
    await connection.execute(`
      UPDATE conversations 
      SET last_message_at = NOW()
      WHERE conversation_id = ?
    `, [conversationId]);
    
    // Get the created message with user info
    const [newMessage] = await connection.execute(`
      SELECT 
        m.*,
        u.email,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM messages m
      JOIN users u ON m.sender_id = u.user_id
      LEFT JOIN user_information ui ON m.sender_id = ui.user_id
      WHERE m.message_id = ?
    `, [result.insertId]);
    
    res.status(201).json(newMessage[0]);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Create a new conversation
app.post('/api/conversations', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { seller_email, listing_id, initial_message } = req.body;
    const buyerId = req.session.user.user_id;
    
    if (!seller_email || !initial_message) {
      return res.status(400).json({ error: 'Seller email and initial message are required' });
    }
    
    // Find seller by email
    const [sellerResult] = await connection.execute(`
      SELECT user_id FROM users WHERE email = ?
    `, [seller_email]);
    
    if (sellerResult.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    const sellerId = sellerResult[0].user_id;
    
    // Don't allow users to message themselves
    if (sellerId === buyerId) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }
    
    // Handle undefined listing_id properly
    const listingIdParam = listing_id || null;
    
    // Check if conversation already exists
    let existingConvQuery;
    let existingConvParams;
    
    if (listingIdParam) {
      existingConvQuery = `
        SELECT * FROM conversations 
        WHERE buyer_id = ? AND seller_id = ? AND listing_id = ?
      `;
      existingConvParams = [buyerId, sellerId, listingIdParam];
    } else {
      existingConvQuery = `
        SELECT * FROM conversations 
        WHERE buyer_id = ? AND seller_id = ? AND listing_id IS NULL
      `;
      existingConvParams = [buyerId, sellerId];
    }
    
    const [existingConv] = await connection.execute(existingConvQuery, existingConvParams);
    
    let conversationId;
    
    if (existingConv.length > 0) {
      conversationId = existingConv[0].conversation_id;
    } else {
      // Get usernames for the conversation
      const [buyerInfo] = await connection.execute(`
        SELECT ui.username, u.email 
        FROM users u 
        LEFT JOIN user_information ui ON u.user_id = ui.user_id 
        WHERE u.user_id = ?
      `, [buyerId]);
      
      const [sellerInfo] = await connection.execute(`
        SELECT ui.username, u.email 
        FROM users u 
        LEFT JOIN user_information ui ON u.user_id = ui.user_id 
        WHERE u.user_id = ?
      `, [sellerId]);
      
      const buyerUsername = buyerInfo[0]?.username || buyerInfo[0]?.email || 'Unknown';
      const sellerUsername = sellerInfo[0]?.username || sellerInfo[0]?.email || 'Unknown';
      
      // Create new conversation
      const [convResult] = await connection.execute(`
        INSERT INTO conversations (buyer_id, seller_id, buyer_username, seller_username, listing_id, last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())
      `, [buyerId, sellerId, buyerUsername, sellerUsername, listingIdParam]);
      
      conversationId = convResult.insertId;
    }
    
    // Create initial message
    const buyerUsername = (await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [buyerId]))[0][0]?.username || (await connection.execute(`SELECT email FROM users WHERE user_id = ?`, [buyerId]))[0][0]?.email || 'Unknown';
    
    const [messageResult] = await connection.execute(`
      INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sender_type, sent_at)
      VALUES (?, ?, ?, ?, 'buyer', NOW())
    `, [conversationId, buyerId, buyerUsername, initial_message.trim()]);
    
    res.status(201).json({
      conversation_id: conversationId,
      message_id: messageResult.insertId
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// API: Start a conversation from listing page
app.post('/start-conversation', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { listing_id, message } = req.body;
    const buyerId = req.session.user.user_id;
    
    if (!listing_id || !message) {
      return res.status(400).json({ error: 'Listing ID and message are required' });
    }
    
    // Get listing and seller info
    const [listings] = await connection.execute(`
      SELECT l.*, u.email as seller_email
      FROM listings l
      JOIN users u ON l.user_id = u.user_id
      WHERE l.listing_id = ?
    `, [listing_id]);
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    const listing = listings[0];
    const sellerId = listing.user_id;
    
    // Don't allow users to message themselves
    if (sellerId === buyerId) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }
    
    // Check if conversation already exists (buyer/seller only, ignore listing)
    const [existingConv] = await connection.execute(`
      SELECT * FROM conversations 
      WHERE buyer_id = ? AND seller_id = ?
    `, [buyerId, sellerId]);
    
    let conversationId;
    
    if (existingConv.length > 0) {
      conversationId = existingConv[0].conversation_id;
    } else {
      // Get usernames for the conversation
      const [buyerInfo] = await connection.execute(`
        SELECT ui.username, u.email 
        FROM users u 
        LEFT JOIN user_information ui ON u.user_id = ui.user_id 
        WHERE u.user_id = ?
      `, [buyerId]);
      
      const [sellerInfo] = await connection.execute(`
        SELECT ui.username, u.email 
        FROM users u 
        LEFT JOIN user_information ui ON u.user_id = ui.user_id 
        WHERE u.user_id = ?
      `, [sellerId]);
      
      const buyerUsername = buyerInfo[0]?.username || buyerInfo[0]?.email || 'Unknown';
      const sellerUsername = sellerInfo[0]?.username || sellerInfo[0]?.email || 'Unknown';
      
      // Create new conversation (store the most recent listing_id for context)
      const [convResult] = await connection.execute(`
        INSERT INTO conversations (buyer_id, seller_id, buyer_username, seller_username, listing_id, created_at, updated_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())
      `, [buyerId, sellerId, buyerUsername, sellerUsername, listing_id]);
      
      conversationId = convResult.insertId;
    }
    
    // Create initial message, include listing_id for context if possible
    const [buyerInfo] = await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [buyerId]);
    
    const buyerUsername = buyerInfo[0]?.username || buyerInfo[0]?.email || 'Unknown';
    
    // Try to include listing_id in the message if the column exists
    try {
      await connection.execute(`
        INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sender_type, sent_at, listing_id)
        VALUES (?, ?, ?, ?, 'buyer', NOW(), ?)
      `, [conversationId, buyerId, buyerUsername, message.trim(), listing_id]);
    } catch (err) {
      // fallback if listing_id column does not exist
      await connection.execute(`
        INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sender_type, sent_at)
        VALUES (?, ?, ?, ?, 'buyer', NOW())
      `, [conversationId, buyerId, buyerUsername, message.trim()]);
    }
    
    res.json({
      success: true,
      conversation_id: conversationId,
      message: 'Conversation started successfully!'
    });
  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== OTHER ROUTES ==========

// Test routes
app.get('/product-details', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'product-details.html'));
});

// API route to get all users (for testing)
app.get('/api/users', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [users] = await connection.execute(`
      SELECT 
        u.user_id, 
        u.email, 
        u.role,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
    `);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
  }
});

// API route to get all listings (for testing)
app.get('/api/listings', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [listings] = await connection.execute(`
      SELECT 
        l.*, 
        u.email,
        ui.first_name,
        ui.last_name,
        ui.username
      FROM listings l 
      JOIN users u ON l.user_id = u.user_id 
      LEFT JOIN user_information ui ON l.user_id = ui.user_id
      WHERE l.status = 'active'
      ORDER BY l.created_at DESC
    `);
    res.json(listings);
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({ error: 'Server error' });
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
