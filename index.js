const express = require('express');
const app = express();
require('dotenv').config();
const mysql = require('mysql2');
const exphbs = require('express-handlebars');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

app.set('view engine', 'handlebars');

app.use(session({
  secret: process.env.SESSION_SECRET || 'vintique_secret_key',
  resave: false,
  saveUninitialized: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Make user data available in all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Staff-only middleware
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'staff') {
    return res.status(403).send('Access denied. Staff only.');
  }
  next();
}

// Multer storage config for uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'));
    }
    cb(null, true);
  }
});

// Serve uploads statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// MySQL connection
const connection = mysql.createConnection({
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

// Home route
app.get('/', (req, res) => {
  if (req.session.user && req.session.user.role === 'staff') {
    res.render('staff/dashboard', { layout: 'staff' });
  } else {
    res.render('users/home', { activePage: 'home' });
  }
});

// User Home route
app.get('/home', (req, res) => {
  res.render('users/home', { layout: 'user', activePage: 'home' });
});

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
    res.render('staff/user_management', { layout: 'staff', users });
  });
});

// Legacy users route
app.get('/users', requireStaff, (req, res) => {
  res.redirect('/staff/user_management');
});

// Staff Management route
app.get('/staff/staff_management', requireStaff, (req, res) => {
  res.render('staff/staff_management', { layout: 'staff' });
});

// Login & Register
app.get('/login', (req, res) => {
  res.render('login', { layout: 'user', activePage: 'login' });
});
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
        const updateInfoSql = 'UPDATE user_information SET username = ?, first_name = ?, last_name = ?, email = ?, phone_number = ? WHERE user_id = ?';
        connection.query(updateInfoSql, [username, firstname, lastname, email, phone, userId], (err) => {
          if (err) {
            connection.rollback(() => {});
            console.error('Update user_information error:', err);
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

// Login handler
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const sql = `
    SELECT u.user_id, u.email, u.role, ui.username, COALESCE(ui.status, 'active') as status
    FROM users u 
    LEFT JOIN user_information ui ON u.user_id = ui.user_id 
    WHERE u.email = ? AND u.password = ?
  `;
  connection.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).send('Database error');
    }
    if (results.length > 0) {
      const user = results[0];
      if (user.status === 'suspended') {
        return res.render('login', { layout: 'user', activePage: 'login', error: 'Your account has been suspended.' });
      }
      req.session.user = { id: user.user_id, username: user.username, role: user.role };
      res.redirect('/');
    } else {
      res.render('login', { layout: 'user', activePage: 'login', error: 'Invalid email or password.' });
    }
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// --- STAFF USER MANAGEMENT API ENDPOINTS ---
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
    FROM vintiquedb.users u
    LEFT JOIN vintiquedb.user_information ui ON u.user_id = ui.user_id
    WHERE (ui.username = ? OR u.email = ? OR u.phone_number = ?) 
      AND u.user_id != ?
  `;
  connection.query(checkSql, [username, email, phone, userId], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error during validation.' });
    if (results.length > 0) return res.status(400).json({ error: 'Username, email, or phone number already exists.' });
    connection.beginTransaction(err => {
      if (err) return res.status(500).json({ error: 'Database transaction error.' });
      const updateUsers = `UPDATE vintiquedb.users SET email = ?, phone_number = ? WHERE user_id = ?`;
      connection.query(updateUsers, [email, phone, userId], err => {
        if (err) return connection.rollback(() => res.status(500).json({ error: 'Error updating users table.' }));
        const updateInfo = `UPDATE vintiquedb.user_information SET username = ?, email = ?, phone_number = ?, status = ? WHERE user_id = ?`;
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

// --- DELETE LISTING ENDPOINT ---
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

// Configure Handlebars
app.engine('handlebars', exphbs.engine({
  defaultLayout: 'user',
  helpers: {
    ifCond: function (v1, operator, v2, options) {
      switch (operator) {
        case '==':
          return (v1 == v2) ? options.fn(this) : options.inverse(this);
        case '!=':
          return (v1 != v2) ? options.fn(this) : options.inverse(this);
        default:
          return options.inverse(this);
      }
    },
    eq: function(a, b) { return a === b; },
    formatDate: function(date) {
      const now = new Date();
      const created = new Date(date);
      const diffMs = now - created;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return '1 day';
      return diffDays + ' days';
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
