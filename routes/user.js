// ========== USER ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection } = require('../config/database');
const { upload } = require('../config/multer');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');



// Home route
router.get('/', (req, res) => {
  res.render('users/home', { 
    title: 'Vintique - Sustainable Fashion Marketplace',
    layout: 'user',
    activePage: 'home'
  });
});

// User Home route
router.get('/home', (req, res) => {
  res.render('users/home', { layout: 'user', activePage: 'home' });
});

// Marketplace route
router.get('/marketplace', (req, res) => {
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
    
    res.render('users/marketplace', {
      layout: 'user',
      activePage: 'shop',
      listings: listings,
      user: req.session.user
    });
  });
});

// Post Product GET
router.get('/post_product', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  res.render('users/post_product', {
    layout: 'user',
    activePage: 'sell'
  });
});

// Post Product POST
router.post('/post_product', upload.array('images', 5), (req, res) => {
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
router.get('/my_listing', (req, res) => {
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
    });
  });
});

// Q&A route
router.get('/qa', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/qa', {
    layout: 'user',
    activePage: 'qa'
  });
});

// Messages route
router.get('/messages', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/messages', {
    layout: 'user',
    activePage: 'messages'
  });
});

// Cart route
router.get('/cart', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/cart', {
    layout: 'user',
    activePage: 'cart'
  });
});

// Orders route
router.get('/orders', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/orders', {
    layout: 'user',
    activePage: 'orders'
  });
});

// Account Settings route
router.get('/account-settings', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/account_setting', {
    layout: 'user',
    activePage: 'account'
  });
});

module.exports = router;


// --------------- User Feedback -------------------------
router.get('/feedback', (req, res) => {
  res.render('users/feedback', { 
    title: 'Feedback - Vintique',
    layout: 'user',
    activePage: 'feedback'
  });
});

router.post('/feedback', async (req, res) => {
  const { fullName, email, subject, message } = req.body;

  if (!fullName || !email || !subject || !message) {
    return res.render('users/feedback', {
      title: 'Feedback - Vintique',
      layout: 'user',
      activePage: 'feedback',
      errorMessage: 'Please fill in all fields.'
    });
  }

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    const [result] = await connection.execute(
      'INSERT INTO feedback (fullName, email, subject, message) VALUES (?, ?, ?, ?)',
      [fullName, email, subject, message]
    );

    await connection.end();

    res.render('users/feedback', {
      title: 'Feedback - Vintique',
      layout: 'user',
      activePage: 'feedback',
      successMessage: 'Thank you for your feedback!'
    });
  } catch (err) {
    console.error(err);
    res.render('users/feedback', {
      title: 'Feedback - Vintique',
      layout: 'user',
      activePage: 'feedback',
      errorMessage: 'Something went wrong. Please try again.'
    });
  }
});