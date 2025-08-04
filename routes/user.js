// ========== USER ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { upload } = require('../config/multer');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configuration is handled by config/database.js

// ========== HELPER FUNCTIONS ==========

// Helper to get user ID from session
const getUserId = (req) => req.session.user.id || req.session.user.user_id;

// Helper to check authentication
const requireUserAuth = (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return true;
};

// Helper to fix image URLs
const fixImageUrl = (imageUrl) => {
  if (!imageUrl || imageUrl === 'null') {
    return '/assets/logo.png';
  }
  return imageUrl.startsWith('/uploads/') ? imageUrl : `/uploads/${imageUrl}`;
};

// Helper to process listing images
const processListingImages = (listings) => {
  return listings.map(listing => ({
    ...listing,
    image_url: fixImageUrl(listing.image_url)
  }));
};

// Helper to get user username
const getUserUsername = (user) => {
  return user.username || user.email.split('@')[0];
};

// Helper for database error handling
const handleDbError = (err, res, customMessage = 'Database error') => {
  console.error(customMessage + ':', err);
  return res.status(500).json({ error: customMessage });
};

// Helper to verify listing ownership
const verifyListingOwnership = (listingId, userId, callback) => {
  const verifyQuery = 'SELECT listing_id FROM listings WHERE listing_id = ? AND user_id = ?';
  callbackConnection.query(verifyQuery, [listingId, userId], callback);
};

// Helper to get listing with images
const getListingWithImages = (listingId, callback) => {
  const listingQuery = `
    SELECT 
      l.listing_id, 
      l.title, 
      l.description, 
      l.price, 
      l.category, 
      l.item_condition, 
      l.brand, 
      l.size,
      l.status,
      l.created_at,
      l.user_id,
      u.email as username,
      (
        SELECT image_url 
        FROM listing_images li 
        WHERE li.listing_id = l.listing_id 
        ORDER BY li.image_id ASC 
        LIMIT 1
      ) as image_url
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.user_id
    WHERE l.listing_id = ? AND l.status = 'active'
  `;
  
  callbackConnection.query(listingQuery, [listingId], callback);
};

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

// Marketplace route - FIXED VERSION
/* 
changed marketplace sql query from:
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

to that because i need the username to be a username instead of the email address -kangren 
*/
router.get('/marketplace', (req, res) => {
  let sql = `
    SELECT 
      l.listing_id, 
      l.title, 
      l.price, 
      l.category, 
      l.item_condition, 
      l.created_at, 
      l.brand, 
      l.size,
      (
        SELECT image_url 
        FROM listing_images img2
        WHERE img2.listing_id = l.listing_id
        ORDER BY img2.image_id ASC
        LIMIT 1
      ) as image_url,
      COALESCE(ui.username, 'Unknown') as username
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.user_id
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE l.status = 'active'
  `;

  const params = [];
  if (req.session.user && req.session.user.role === 'user') {
    sql += ' AND l.user_id != ?';
    params.push(getUserId(req));
  }
  sql += '\n    ORDER BY l.created_at DESC';
  
  callbackConnection.query(sql, params, (err, listings) => {
    if (err) return handleDbError(err, res, 'Failed to load marketplace');
    
    // Use helper function to process images
    const processedListings = processListingImages(listings);
    
    res.render('users/marketplace', {
      layout: 'user',
      activePage: 'shop',
      listings: processedListings,
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
  if (!req.session.user || (!req.session.user.id && !req.session.user.user_id)) {
    return res.status(401).send('You must be logged in to post a product.');
  }
  const userId = req.session.user.id || req.session.user.user_id;
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
      idx === 0 // First image is cover
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
  const userId = getUserId(req);
  const sql = `
    SELECT l.listing_id, l.title, l.price, l.category, l.item_condition, l.status, l.created_at, l.updated_at, l.brand, l.size,
          (
            SELECT image_url FROM listing_images img2
            WHERE img2.listing_id = l.listing_id
            ORDER BY img2.image_id ASC
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
    if (err) return handleDbError(err, res, 'Failed to load my listings');
    res.render('users/my_listing', {
      layout: 'user',
      activePage: 'mylistings',
      listings
    });
  });
});

// Product Detail Route
router.get('/listing/:id', (req, res) => {
  const listingId = req.params.id;
  
  getListingWithImages(listingId, (err, listings) => {
    if (err) {
      console.error('Database error:', err);
      return res.render('users/product_detail', {
        layout: 'user',
        error: 'Database error occurred'
      });
    }
    
    if (listings.length === 0) {
      return res.render('users/product_detail', {
        layout: 'user',
        error: 'Product not found or no longer available'
      });
    }
    
    const listing = listings[0];
    
    // Fix image URL using helper
    listing.image_url = fixImageUrl(listing.image_url);
    
    // Get all additional images for this listing
    const imagesQuery = `
      SELECT image_url 
      FROM listing_images 
      WHERE listing_id = ? AND is_main = 0
      ORDER BY image_id ASC
    `;
    
    callbackConnection.query(imagesQuery, [listingId], (imgErr, images) => {
      if (imgErr) {
        console.error('Images error:', imgErr);
        images = [];
      }
      
      // Fix additional image URLs using helper
      const additionalImages = images.map(img => fixImageUrl(img.image_url));
      
      listing.additional_images = additionalImages;
      
      res.render('users/product_detail', {
        layout: 'user',
        listing: listing,
        user: req.session.user,
        userJson: JSON.stringify(req.session.user || null)
      });
    });
  });
});

// Edit Listing Route
router.get('/edit_listing/:id', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  
  const listingId = req.params.id;
  const userId = req.session.user.id || req.session.user.user_id;
  
  // Get listing details with images
  const listingQuery = `
    SELECT 
      l.listing_id, 
      l.title, 
      l.description, 
      l.price, 
      l.category, 
      l.item_condition, 
      l.brand, 
      l.size,
      l.user_id
    FROM listings l
    WHERE l.listing_id = ? AND l.user_id = ?
  `;
  
  callbackConnection.query(listingQuery, [listingId, userId], (err, listings) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    
    if (listings.length === 0) {
      return res.status(404).send('Listing not found or you do not have permission to edit it');
    }
    
    const listing = listings[0];
    
    // Get all images for this listing
    const imagesQuery = `
      SELECT image_url 
      FROM listing_images 
      WHERE listing_id = ?
      ORDER BY is_main DESC, image_id ASC
    `;
    
    callbackConnection.query(imagesQuery, [listingId], (imgErr, images) => {
      if (imgErr) {
        console.error('Images error:', imgErr);
        images = [];
      }
      
      // Fix image URLs
      const listingImages = images.map(img => {
        if (!img.image_url || img.image_url === 'null') {
          return '/assets/logo.png';
        } else if (!img.image_url.startsWith('/uploads/')) {
          return `/uploads/${img.image_url}`;
        }
        return img.image_url;
      });
      
      listing.images = listingImages;
      
      res.render('users/edit_listing', {
        layout: 'user',
        activePage: 'mylistings',
        listing: listing
      });
    });
  });
});

// Update Listing Route
router.post('/edit_listing/:id', upload.array('images', 5), (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.redirect('/login');
  }
  
  const listingId = req.params.id;
  const userId = req.session.user.id || req.session.user.user_id;
  const { title, description, brand, size, category, item_condition, price } = req.body;
  const newImages = req.files;
  
  if (!title || !description || !category || !item_condition || !price) {
    return res.status(400).send('All required fields must be provided.');
  }
  
  // First verify the listing belongs to the user
  const verifyQuery = 'SELECT listing_id FROM listings WHERE listing_id = ? AND user_id = ?';
  callbackConnection.query(verifyQuery, [listingId, userId], (err, result) => {
    if (err) {
      console.error('Verify listing error:', err);
      return res.status(500).send('Database error');
    }
    
    if (result.length === 0) {
      return res.status(403).send('You do not have permission to edit this listing');
    }
    
    // Update the listing
    const updateListingQuery = `
      UPDATE listings 
      SET title = ?, description = ?, brand = ?, size = ?, category = ?, item_condition = ?, price = ?, updated_at = NOW()
      WHERE listing_id = ? AND user_id = ?
    `;
    
    callbackConnection.query(updateListingQuery, [title, description, brand, size, category, item_condition, price, listingId, userId], (err) => {
      if (err) {
        console.error('Update listing error:', err);
        return res.status(500).send('Database error');
      }
      
      // Add new images if any
      if (newImages && newImages.length > 0) {
        const imageValues = newImages.map(img => [
          listingId,
          '/uploads/' + img.filename,
          0 // Not main image by default
        ]);
        
        const insertImagesQuery = 'INSERT INTO listing_images (listing_id, image_url, is_main) VALUES ?';
        callbackConnection.query(insertImagesQuery, [imageValues], (imgErr) => {
          if (imgErr) {
            console.error('Insert images error:', imgErr);
          }
        });
      }
      
      res.redirect('/my_listing');
    });
  });
});

// Mark as Sold Route
router.post('/listings/:id/mark_sold', (req, res) => {
  if (!requireUserAuth(req, res)) return;
  
  const listingId = req.params.id;
  const userId = getUserId(req);
  
  const updateQuery = `
    UPDATE listings 
    SET status = 'sold', updated_at = NOW() 
    WHERE listing_id = ? AND user_id = ?
  `;
  
  callbackConnection.query(updateQuery, [listingId, userId], (err, result) => {
    if (err) {
      console.error('Mark as sold error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Listing not found or you do not have permission' });
    }
    
    res.json({ success: true, message: 'Listing marked as sold' });
  });
});

// Delete Listing Route
router.delete('/listings/:id', (req, res) => {
  console.log('=== DELETE LISTING REQUEST ===');
  console.log('User session:', req.session.user);
  console.log('Listing ID:', req.params.id);
  
  if (!requireUserAuth(req, res)) return;
  
  const listingId = req.params.id;
  const userId = getUserId(req);
  
  console.log('Processing delete for listing:', listingId, 'by user:', userId);
  
  // First verify the listing belongs to the user
  const verifyQuery = 'SELECT listing_id, status FROM listings WHERE listing_id = ? AND user_id = ?';
  
  callbackConnection.query(verifyQuery, [listingId, userId], (err, result) => {
    if (err) {
      console.error('❌ Database error during verification:', err);
      return res.status(500).json({ error: 'Database error during verification' });
    }
    
    if (result.length === 0) {
      console.log('❌ Listing not found or user does not have permission');
      return res.status(404).json({ error: 'Listing not found or you do not have permission' });
    }
    
    const listing = result[0];
    console.log('✅ Listing verified:', listing);
    
    // Check if listing has active orders
    const checkOrdersQuery = `
      SELECT oi.order_item_id, o.status as order_status, o.order_id
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      WHERE oi.listing_id = ?
    `;
    
    callbackConnection.query(checkOrdersQuery, [listingId], (err, orders) => {
      if (err) {
        console.error('❌ Error checking orders:', err);
        return res.status(500).json({ error: 'Error checking orders' });
      }
      
      console.log('📦 Found orders for listing:', orders.length);
      
      // If there are completed or shipped orders, prevent deletion
      const activeOrders = orders.filter(order => 
        order.order_status === 'completed' || 
        order.order_status === 'shipped' || 
        order.order_status === 'paid'
      );
      
      if (activeOrders.length > 0) {
        console.log('❌ Cannot delete listing with active orders:', activeOrders.length);
        return res.status(400).json({ 
          error: 'Cannot delete listing with active orders. Please contact support if you need to remove this listing.' 
        });
      }
      
      // Start transaction
      callbackConnection.beginTransaction((err) => {
        if (err) {
          console.error('❌ Transaction error:', err);
          return res.status(500).json({ error: 'Database transaction error' });
        }
        
        console.log('🔄 Transaction started');
        
        // Delete order items for this listing (cancelled/pending orders only)
        const deleteOrderItemsQuery = `
          DELETE oi FROM order_items oi
          JOIN orders o ON oi.order_id = o.order_id
          WHERE oi.listing_id = ? AND o.status IN ('pending', 'cancelled')
        `;
        
        callbackConnection.query(deleteOrderItemsQuery, [listingId], (err, result) => {
          if (err) {
            console.error('❌ Error deleting order items:', err);
            return callbackConnection.rollback(() => {
              res.status(500).json({ error: 'Error deleting related orders' });
            });
          }
          
          console.log('✅ Deleted order items:', result.affectedRows);
          
          // Delete cart items for this listing
          const deleteCartItemsQuery = 'DELETE FROM cart WHERE listing_id = ?';
          callbackConnection.query(deleteCartItemsQuery, [listingId], (err, result) => {
            if (err) {
              console.error('❌ Error deleting cart items:', err);
              return callbackConnection.rollback(() => {
                res.status(500).json({ error: 'Error deleting cart items' });
              });
            }
            
            console.log('✅ Deleted cart items:', result.affectedRows);
            
            // Delete images
            const deleteImagesQuery = 'DELETE FROM listing_images WHERE listing_id = ?';
            callbackConnection.query(deleteImagesQuery, [listingId], (err, result) => {
              if (err) {
                console.error('❌ Error deleting images:', err);
                return callbackConnection.rollback(() => {
                  res.status(500).json({ error: 'Error deleting listing images' });
                });
              }
              
                          console.log('✅ Deleted images:', result.affectedRows);
              
              // Delete conversations for this listing
              const deleteConversationsQuery = 'DELETE FROM conversations WHERE listing_id = ?';
              callbackConnection.query(deleteConversationsQuery, [listingId], (err, result) => {
                if (err) {
                  console.error('❌ Error deleting conversations:', err);
                  return callbackConnection.rollback(() => {
                    res.status(500).json({ error: 'Error deleting conversations' });
                  });
                }
                
                console.log('✅ Deleted conversations:', result.affectedRows);
                
                // Finally delete the listing
                const deleteListingQuery = 'DELETE FROM listings WHERE listing_id = ? AND user_id = ?';
                callbackConnection.query(deleteListingQuery, [listingId, userId], (err, result) => {
                  if (err) {
                    console.error('❌ Error deleting listing:', err);
                    return callbackConnection.rollback(() => {
                      res.status(500).json({ error: 'Error deleting listing' });
                    });
                  }
                  
                  if (result.affectedRows === 0) {
                    console.log('❌ No listing was deleted');
                    return callbackConnection.rollback(() => {
                      res.status(404).json({ error: 'Listing not found or you do not have permission' });
                    });
                  }
                  
                  console.log('✅ Listing deleted successfully');
                  
                  callbackConnection.commit((err) => {
                    if (err) {
                      console.error('❌ Commit error:', err);
                      return callbackConnection.rollback(() => {
                        res.status(500).json({ error: 'Error committing transaction' });
                      });
                    }
                    
                    console.log('✅ Transaction committed successfully');
                    res.json({ success: true, message: 'Listing deleted successfully' });
                  });
                }); // End of delete listing query
              }); // End of delete conversations query
            }); // End of delete images query
          }); // End of delete cart items query
        }); // End of delete order items query
      }); // End of beginTransaction
    }); // End of checkOrdersQuery
  }); // End of verifyQuery
}); // End of router.delete

// Delete Image Route
router.post('/delete_image', (req, res) => {
  if (!requireUserAuth(req, res)) return;
  
  const { imgUrl, listingId } = req.body;
  const userId = getUserId(req);
  
  if (!imgUrl || !listingId) {
    return res.status(400).json({ error: 'Image URL and listing ID are required' });
  }
  
  // Verify the listing belongs to the user
  const verifyQuery = 'SELECT listing_id FROM listings WHERE listing_id = ? AND user_id = ?';
  callbackConnection.query(verifyQuery, [listingId, userId], (err, result) => {
    if (err) {
      console.error('Verify listing error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (result.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to delete this image' });
    }
    
    // Delete the image from database
    const deleteQuery = 'DELETE FROM listing_images WHERE listing_id = ? AND image_url = ?';
    callbackConnection.query(deleteQuery, [listingId, imgUrl], (err, result) => {
      if (err) {
        console.error('Delete image error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Image not found' });
      }
      
      res.json({ success: true, message: 'Image deleted successfully' });
    });
  });
});

// Q&A route
router.get('/qa', (req, res) => {
  const qaQuery = `
    SELECT 
      q.qa_id,
      q.asker_id,
      q.asker_username,
      u.email as asker_email,
      q.category,
      q.question_text,
      q.details,
      q.asked_at,
      q.is_verified,
      COALESCE((SELECT COUNT(*) FROM qa_votes WHERE qa_id = q.qa_id), 0) as helpful_count,
      q.created_at
    FROM qa q
    LEFT JOIN users u ON q.asker_id = u.user_id
    WHERE q.is_verified = 1
    ORDER BY q.asked_at DESC
  `;

  callbackConnection.query(qaQuery, (err, questions) => {
    if (err) {
      console.error('Q&A page error:', err);
      return res.render('users/qa', {
        layout: 'user',
        activePage: 'qa',
        error: 'Failed to load questions',
        questions: []
      });
    }

    if (questions.length === 0) {
      return res.render('users/qa', {
        layout: 'user',
        activePage: 'qa',
        questions: []
      });
    }

    const questionIds = questions.map(q => q.qa_id);
    const answersQuery = `
      SELECT 
        qa_ans.qa_id,
        qa_ans.answerer_id,
        qa_ans.answerer_username,
        u.email as answerer_email,
        qa_ans.answer_content,
        qa_ans.answered_at
      FROM qa_answers qa_ans
      LEFT JOIN users u ON qa_ans.answerer_id = u.user_id
      WHERE qa_ans.qa_id IN (${questionIds.map(() => '?').join(',')})
      ORDER BY qa_ans.answered_at ASC
    `;

    callbackConnection.query(answersQuery, questionIds, (err, answers) => {
      if (err) {
        console.error('Q&A answers error:', err);
        answers = [];
      }

      const answersByQuestionId = {};
      if (answers) {
        answers.forEach(answer => {
          if (!answersByQuestionId[answer.qa_id]) {
            answersByQuestionId[answer.qa_id] = [];
          }
          answersByQuestionId[answer.qa_id].push(answer);
        });
      }

      questions.forEach(question => {
        question.answers = answersByQuestionId[question.qa_id] || [];
      });

      res.render('users/qa', {
        layout: 'user',
        activePage: 'qa',
        questions: questions
      });
    });
  });
});

// Cart route
router.get('/cart', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.id || req.session.user.user_id;
    const now = new Date().toISOString().split('T')[0];

    // Fetch user's available vouchers
    const [userVouchers] = await connection.execute(
      `SELECT v.*
       FROM user_vouchers uv
       JOIN vouchers v ON uv.voucher_id = v.voucher_id
       WHERE uv.user_id = ? AND v.status = 'active' AND v.expiry_date >= ?
       ORDER BY v.expiry_date ASC`,
      [userId, now]
    );

    res.render('users/cart', {
      layout: 'user',
      activePage: 'cart',
      userVouchers // <--- this will be available in your handlebars
    });
  } catch (error) {
    console.error('Cart page error:', error);
    res.status(500).render('error', { 
      error: 'Failed to load cart page',
      layout: 'user'
    });
  } finally {
    if (connection) await connection.end();
  }
});


// Checkout route
router.get('/checkout', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id || req.session.user.id;
    
    // Get cart items
    const [cartItems] = await connection.execute(`
      SELECT c.cart_id, c.quantity,
             l.listing_id, l.title, l.price, l.item_condition, l.category,
             u.email as seller_username,
             (
               SELECT image_url 
               FROM listing_images li 
               WHERE li.listing_id = l.listing_id 
               ORDER BY li.is_main DESC, li.image_id ASC 
               LIMIT 1
             ) as image_url
      FROM cart c
      JOIN listings l ON c.listing_id = l.listing_id
      JOIN users u ON l.user_id = u.user_id
      WHERE c.user_id = ? AND l.status = 'active'
    `, [userId]);
    
    if (cartItems.length === 0) {
      return res.redirect('/cart?error=empty');
    }
    
    // Calculate total
    const subtotal = cartItems.reduce((total, item) => {
      return total + (parseFloat(item.price) * item.quantity);
    }, 0);
    
    const shipping = subtotal >= 50 ? 0 : 5.99;
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + shipping + tax;
    
    // Process images
    const processedCartItems = cartItems.map(item => ({
      ...item,
      image_url: item.image_url ? `/uploads/${item.image_url}` : '/assets/logo.png'
    }));

    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Inside your try block after fetching cartItems and calculating totals
    const [userVouchers] = await connection.execute(
      `SELECT v.*
        FROM user_vouchers uv
        JOIN vouchers v ON uv.voucher_id = v.voucher_id
        WHERE uv.user_id = ? AND v.status = 'active' AND v.expiry_date >= ?
        ORDER BY v.expiry_date ASC`, [userId, now]);

    
    res.render('users/checkout', {
      layout: 'user',
      activePage: 'checkout',
      cartItems: processedCartItems,
      total: total.toFixed(2),
      subtotal: subtotal.toFixed(2),
      shipping: shipping.toFixed(2),
      tax: tax.toFixed(2),
      userVouchers
    });
    
  } catch (error) {
    console.error('Checkout page error:', error);
    res.status(500).render('error', { 
      error: 'Failed to load checkout page',
      layout: 'user'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Checkout success route
router.get('/checkout/success', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/checkout_success', {
    layout: 'user',
    activePage: 'checkout'
  });
});

// ========== ACCOUNT SETTINGS ROUTES ==========

// Account settings page
router.get('/account-settings', (req, res) => {
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
router.get('/account-settings/api', async (req, res) => {
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
router.post('/account-settings/api', upload.single('profile_image'), async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'user') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
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
    
    // Clean up address fields - convert empty/undefined to null
    addressFields.forEach(field => {
      if (req.body[field] === '' || req.body[field] === undefined || req.body[field] === 'undefined' || req.body[field] === null) {
        req.body[field] = null;
      }
    });
    
    // Also handle undefined values for main fields
    if (first_name === undefined || first_name === 'undefined') first_name = null;
    if (last_name === undefined || last_name === 'undefined') last_name = null;
    if (email === undefined || email === 'undefined') email = null;
    if (phone_number === undefined || phone_number === 'undefined') phone_number = null;

    // Validate default_address_index
    let defaultIndex = 1; // Default to 1
    if (default_address_index !== undefined && default_address_index !== null && default_address_index !== '') {
      const parsed = parseInt(default_address_index, 10);
      if ([1, 2, 3].includes(parsed)) {
        defaultIndex = parsed;
      }
    }

    let profile_image_url = req.body.current_profile_image_url || null;
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
      // Full update with all fields - ensure all parameters are properly handled
      sql = `UPDATE user_information SET first_name=?, last_name=?, email=?, phone_number=?, profile_image_url=?,
        address_name=?, address_street=?, address_city=?, address_state=?, address_country=?, address_postal_code=?, address_phone=?,
        address_name_2=?, address_street_2=?, address_city_2=?, address_state_2=?, address_country_2=?, address_postal_code_2=?, address_phone_2=?,
        address_name_3=?, address_street_3=?, address_city_3=?, address_state_3=?, address_country_3=?, address_postal_code_3=?, address_phone_3=?,
        default_address_index=?
        WHERE user_id=?`;
      
      // Ensure all parameters are properly defined (not undefined)
      params = [
        first_name || null, 
        last_name || null, 
        email || null, 
        phone_number || null, 
        profile_image_url || null,
        req.body.address_name || null, 
        req.body.address_street || null, 
        req.body.address_city || null, 
        req.body.address_state || null, 
        req.body.address_country || null, 
        req.body.address_postal_code || null, 
        req.body.address_phone || null,
        req.body.address_name_2 || null, 
        req.body.address_street_2 || null, 
        req.body.address_city_2 || null, 
        req.body.address_state_2 || null, 
        req.body.address_country_2 || null, 
        req.body.address_postal_code_2 || null, 
        req.body.address_phone_2 || null,
        req.body.address_name_3 || null, 
        req.body.address_street_3 || null, 
        req.body.address_city_3 || null, 
        req.body.address_state_3 || null, 
        req.body.address_country_3 || null, 
        req.body.address_postal_code_3 || null, 
        req.body.address_phone_3 || null,
        defaultIndex, 
        userId
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
    
    // Log the SQL and params for debugging
    console.log('SQL Query:', sql);
    console.log('Parameters:', params);
    console.log('Parameter types:', params.map(p => typeof p));
    
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
router.post('/account-settings/password', async (req, res) => {
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
router.get('/api/user/addresses', requireAuth, async (req, res) => {
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
});

// Messages page route - FIXED VERSION FOR YOUR DATABASE SCHEMA
router.get('/messages', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userId = req.session.user.id || req.session.user.user_id;
  console.log('Loading messages for user:', userId);
  
  const conversationsQuery = `
    SELECT 
      c.conversation_id,
      c.buyer_id,
      c.seller_id,
      c.listing_id,
      c.buyer_username,
      c.seller_username,
      c.created_at,
      c.updated_at,
      c.status,
      
      CASE 
        WHEN c.buyer_id = ? THEN c.seller_username
        ELSE c.buyer_username
      END as other_user_name,
      
      l.title as listing_title,
      l.price as listing_price,
      
      (SELECT message_content 
       FROM messages m2 
       WHERE m2.conversation_id = c.conversation_id 
       ORDER BY m2.sent_at DESC 
       LIMIT 1) as last_message_preview,
       
      (SELECT sent_at 
       FROM messages m2 
       WHERE m2.conversation_id = c.conversation_id 
       ORDER BY m2.sent_at DESC 
       LIMIT 1) as last_message_time,
       
      (SELECT COUNT(*) 
       FROM messages m3 
       WHERE m3.conversation_id = c.conversation_id 
       AND m3.sender_id != ? 
       AND m3.is_read = 0) as unread_count
       
    FROM conversations c
    LEFT JOIN listings l ON c.listing_id = l.listing_id
    WHERE c.buyer_id = ? OR c.seller_id = ?
    ORDER BY COALESCE(
      (SELECT sent_at FROM messages m2 WHERE m2.conversation_id = c.conversation_id ORDER BY m2.sent_at DESC LIMIT 1),
      c.created_at
    ) DESC
  `;

  callbackConnection.query(conversationsQuery, [userId, userId, userId, userId], (err, conversations) => {
    if (err) {
      console.error('Error loading conversations:', err);
      return res.render('users/messages', {
        layout: 'user',
        activePage: 'messages',
        conversations: [],
        conversationsJson: JSON.stringify([]),
        userJson: JSON.stringify(req.session.user),
        error: 'Failed to load conversations'
      });
    }

    console.log('Found conversations:', conversations.length);

    const processedConversations = conversations.map(conv => ({
      ...conv,
      other_user_name: conv.other_user_name || 'Unknown User',
      last_message_preview: conv.last_message_preview || 'No messages yet'
    }));

    res.render('users/messages', {
      layout: 'user',
      activePage: 'messages',
      conversations: processedConversations,
      conversationsJson: JSON.stringify(processedConversations),
      userJson: JSON.stringify(req.session.user)
    });
  });
});

// Route to handle "Message Seller" from product details - FINAL FIXED VERSION
router.post('/start-conversation', (req, res) => {
  console.log('=== START CONVERSATION REQUEST ===');
  console.log('Request body:', req.body);
  console.log('User session:', req.session.user);
  
  if (!req.session.user) {
    console.log('❌ User not authenticated');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const buyerId = req.session.user.id || req.session.user.user_id;
  const { listing_id, message } = req.body;

  console.log('Processing request:', {
    buyerId,
    listing_id,
    messageLength: message?.length
  });

  if (!listing_id || !message) {
    console.log('❌ Missing required fields');
    return res.status(400).json({ error: 'Listing ID and message are required' });
  }

  // First, get buyer information (username/email)
  const getBuyerQuery = `
    SELECT u.user_id, u.email, ui.username
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.user_id = ?
  `;

  callbackConnection.query(getBuyerQuery, [buyerId], (err, buyerData) => {
    if (err) {
      console.error('❌ Error getting buyer data:', err);
      return res.status(500).json({ error: 'Database error while getting buyer info' });
    }

    if (buyerData.length === 0) {
      console.log('❌ Buyer not found');
      return res.status(404).json({ error: 'User not found' });
    }

    const buyer = buyerData[0];
    const buyerUsername = buyer.username || buyer.email.split('@')[0];

    console.log('✅ Buyer found:', { buyerId, buyerUsername, email: buyer.email });

    // Get listing and seller information
    const listingQuery = `
      SELECT l.listing_id, l.title, l.user_id as seller_id, u.email as seller_email, ui.username as seller_username
      FROM listings l
      JOIN users u ON l.user_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE l.listing_id = ? AND l.status = 'active'
    `;

    console.log('🔍 Searching for listing:', listing_id);

    callbackConnection.query(listingQuery, [listing_id], (err, listings) => {
      if (err) {
        console.error('❌ Error finding listing:', err);
        return res.status(500).json({ error: 'Database error while finding listing' });
      }

      console.log('📦 Listing query result:', listings);

      if (listings.length === 0) {
        console.log('❌ Listing not found');
        return res.status(404).json({ error: 'Listing not found or no longer available' });
      }

      const listing = listings[0];
      const sellerUsername = listing.seller_username || listing.seller_email.split('@')[0];

      console.log('✅ Listing found:', {
        listing_id: listing.listing_id,
        title: listing.title,
        seller_id: listing.seller_id,
        sellerUsername
      });

      if (listing.seller_id === buyerId) {
        console.log('❌ User trying to message themselves');
        return res.status(400).json({ error: 'Cannot message yourself about your own listing' });
      }

      // Check if conversation already exists
      const existingConvQuery = `
        SELECT conversation_id 
        FROM conversations 
        WHERE buyer_id = ? AND seller_id = ? AND listing_id = ?
      `;

      console.log('🔍 Checking for existing conversation');

      callbackConnection.query(existingConvQuery, [buyerId, listing.seller_id, listing_id], (err, existing) => {
        if (err) {
          console.error('❌ Error checking existing conversation:', err);
          return res.status(500).json({ error: 'Database error while checking conversations' });
        }

        console.log('💬 Existing conversation check:', existing.length > 0 ? 'Found' : 'Not found');

        if (existing.length > 0) {
          // Conversation exists, send message to existing conversation
          const conversationId = existing[0].conversation_id;
          console.log('✅ Using existing conversation:', conversationId);
          
          const insertMessageQuery = `
            INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sent_at, is_read, message_type, sender_type)
            VALUES (?, ?, ?, ?, NOW(), 0, 'text', 'buyer')
          `;

          console.log('📝 Inserting message to existing conversation');

          callbackConnection.query(insertMessageQuery, [conversationId, buyerId, buyerUsername, message], (err, messageResult) => {
            if (err) {
              console.error('❌ Error sending message to existing conversation:', err);
              return res.status(500).json({ error: 'Failed to send message: ' + err.message });
            }

            console.log('✅ Message sent to existing conversation');

            res.json({ 
              success: true, 
              conversation_id: conversationId,
              message: 'Message sent successfully',
              existing: true
            });
          });
        } else {
          // Create new conversation with all required fields
          console.log('🆕 Creating new conversation');
          
          const createConvQuery = `
            INSERT INTO conversations (buyer_id, seller_id, listing_id, buyer_username, seller_username, created_at, updated_at, status)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 'active')
          `;

          const convParams = [buyerId, listing.seller_id, listing_id, buyerUsername, sellerUsername];
          console.log('🆕 Conversation params:', convParams);

          callbackConnection.query(createConvQuery, convParams, (err, convResult) => {
            if (err) {
              console.error('❌ Error creating conversation:', err);
              return res.status(500).json({ error: 'Failed to create conversation: ' + err.message });
            }

            const conversationId = convResult.insertId;
            console.log('✅ New conversation created:', conversationId);

            // Send the initial message
            const insertMessageQuery = `
              INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sent_at, is_read, message_type, sender_type)
              VALUES (?, ?, ?, ?, NOW(), 0, 'text', 'buyer')
            `;

            console.log('📝 Inserting initial message');

            callbackConnection.query(insertMessageQuery, [conversationId, buyerId, buyerUsername, message], (err, messageResult) => {
              if (err) {
                console.error('❌ Error sending initial message:', err);
                
                // Clean up the conversation if message fails
                callbackConnection.query('DELETE FROM conversations WHERE conversation_id = ?', [conversationId], (cleanupErr) => {
                  if (cleanupErr) {
                    console.error('Error cleaning up conversation:', cleanupErr);
                  }
                });
                
                return res.status(500).json({ error: 'Failed to send initial message: ' + err.message });
              }

              console.log('✅ Initial message sent successfully');

              res.json({ 
                success: true, 
                conversation_id: conversationId,
                message: 'Conversation started successfully',
                existing: false
              });
            });
          });
        }
      });
    });
  });
});

// API: Get messages for a conversation - FIXED VERSION
router.get('/api/conversations/:conversationId/messages', (req, res) => {
  if (!requireUserAuth(req, res)) return;

  const conversationId = req.params.conversationId;
  const userId = getUserId(req);

  // First, verify user has access to this conversation
  const accessQuery = `
    SELECT conversation_id 
    FROM conversations 
    WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
  `;

  callbackConnection.query(accessQuery, [conversationId, userId, userId], (err, access) => {
    if (err) {
      console.error('Error checking conversation access:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (access.length === 0) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }

    // Get all messages for this conversation - Updated for your schema
    const messagesQuery = `
      SELECT 
        m.message_id,
        m.conversation_id,
        m.sender_id,
        m.sender_username,
        m.message_content,
        m.image_url,
        m.sent_at,
        m.is_read,
        m.message_type,
        m.sender_type,
        m.is_deleted,
        m.deleted_for_user,
        
        -- Get conversation info for context
        c.listing_id
        
      FROM messages m
      LEFT JOIN conversations c ON m.conversation_id = c.conversation_id
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at ASC
    `;

    callbackConnection.query(messagesQuery, [conversationId], (err, messages) => {
      if (err) {
        console.error('Error loading messages:', err);
        return res.status(500).json({ error: 'Failed to load messages' });
      }

      // Mark messages as read for the current user
      const markReadQuery = `
        UPDATE messages 
        SET is_read = 1 
        WHERE conversation_id = ? AND sender_id != ? AND is_read = 0
      `;

      callbackConnection.query(markReadQuery, [conversationId, userId], (markErr) => {
        if (markErr) {
          console.warn('Error marking messages as read:', markErr);
        }
      });

      res.json(messages);
    });
  });
});

// API: Send a message - FIXED VERSION WITH IMAGE SUPPORT
router.post('/api/conversations/:conversationId/messages', upload.single('image'), (req, res) => {
  console.log('=== MESSAGE SEND API CALLED ===');
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  console.log('Request file:', req.file);
  console.log('Session user:', req.session.user);

  if (!req.session.user) {
    console.log('❌ User not authenticated');
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conversationId = req.params.conversationId;
  const userId = req.session.user.id || req.session.user.user_id;

  // Handle both FormData (with image) and JSON (text only) requests
  let messageContent = null;
  let imageFile = null;

  if (req.file) {
    // This is a FormData request with an image
    messageContent = req.body.message_content || null;
    imageFile = req.file;
    console.log('📷 Image upload detected:', imageFile.filename);
  } else if (req.body && typeof req.body === 'object') {
    // This is a JSON request (text only)
    messageContent = req.body.message_content;
    console.log('📝 Text-only message detected');
  } else {
    console.log('❌ Invalid request format');
    return res.status(400).json({ error: 'Invalid request format' });
  }

  console.log('Message content:', messageContent);
  console.log('Image file:', imageFile ? imageFile.filename : 'None');

  // Validate that we have either text or image
  if (!messageContent && !imageFile) {
    console.log('❌ No content provided');
    return res.status(400).json({ error: 'Message content or image is required' });
  }

  // Get user's username
  const getUserQuery = `
    SELECT u.email, ui.username
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.user_id = ?
  `;

  callbackConnection.query(getUserQuery, [userId], (err, userData) => {
    if (err) {
      console.error('Error getting user data:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (userData.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userData[0];
    const username = user.username || user.email.split('@')[0];

    // Verify access to conversation
    const accessQuery = `
      SELECT conversation_id, buyer_id, seller_id 
      FROM conversations 
      WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
    `;

    callbackConnection.query(accessQuery, [conversationId, userId, userId], (err, access) => {
      if (err) {
        console.error('Error checking conversation access:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (access.length === 0) {
        return res.status(403).json({ error: 'Access denied to this conversation' });
      }

      const conversation = access[0];
      const senderType = conversation.buyer_id === userId ? 'buyer' : 'seller';

      // Prepare image URL if image was uploaded - FIXED PATH
      const imageUrl = imageFile ? `/uploads/messages/${imageFile.filename}` : null;

      // For image-only messages, provide a default content to avoid null constraint
      const finalMessageContent = messageContent || (imageFile ? '[Image]' : null);

      // Insert the message
      const insertQuery = `
        INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, image_url, sent_at, is_read, message_type, sender_type)
        VALUES (?, ?, ?, ?, ?, NOW(), 0, ?, ?)
      `;

      const messageType = imageFile ? 'image' : 'text';
      const values = [
        conversationId, 
        userId, 
        username, 
        finalMessageContent, 
        imageUrl, 
        messageType, 
        senderType
      ];

      console.log('💾 Inserting message with values:', values);

      callbackConnection.query(insertQuery, values, (err, result) => {
        if (err) {
          console.error('Error sending message:', err);
          return res.status(500).json({ error: 'Failed to send message' });
        }

        // Update conversation timestamp
        const updateConvQuery = `
          UPDATE conversations 
          SET updated_at = NOW() 
          WHERE conversation_id = ?
        `;

        callbackConnection.query(updateConvQuery, [conversationId], (updateErr) => {
          if (updateErr) {
            console.warn('Error updating conversation timestamp:', updateErr);
          }
        });

        console.log('✅ Message sent successfully');

        res.json({ 
          success: true, 
          message_id: result.insertId,
          message: 'Message sent successfully'
        });
      });
    });
  });
});

// API: Start a new conversation
router.post('/api/conversations', (req, res) => {
  if (!requireUserAuth(req, res)) return;

  const buyerId = getUserId(req);
  const { seller_email, initial_message, listing_id } = req.body;

  if (!seller_email || !initial_message) {
    return res.status(400).json({ error: 'Seller email and initial message are required' });
  }

  // Get buyer username
  const getBuyerQuery = `
    SELECT u.email, ui.username
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.user_id = ?
  `;

  callbackConnection.query(getBuyerQuery, [buyerId], (err, buyerData) => {
    if (err) {
      console.error('Error getting buyer data:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (buyerData.length === 0) {
      return res.status(404).json({ error: 'Buyer not found' });
    }

    const buyerUsername = buyerData[0].username || buyerData[0].email.split('@')[0];

    // Find the seller by email
    const findSellerQuery = `
      SELECT u.user_id, u.email, ui.username
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.email = ?
    `;
    
    callbackConnection.query(findSellerQuery, [seller_email], (err, sellers) => {
      if (err) {
        console.error('Error finding seller:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (sellers.length === 0) {
        return res.status(404).json({ error: 'Seller not found' });
      }

      const seller = sellers[0];
      const sellerId = seller.user_id;
      const sellerUsername = seller.username || seller.email.split('@')[0];

      if (sellerId === buyerId) {
        return res.status(400).json({ error: 'Cannot start conversation with yourself' });
      }

      // Check if conversation already exists
      const existingConvQuery = `
        SELECT conversation_id 
        FROM conversations 
        WHERE buyer_id = ? AND seller_id = ? AND listing_id ${listing_id ? '= ?' : 'IS NULL'}
      `;

      const queryParams = listing_id ? [buyerId, sellerId, listing_id] : [buyerId, sellerId];

      callbackConnection.query(existingConvQuery, queryParams, (err, existing) => {
        if (err) {
          console.error('Error checking existing conversation:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (existing.length > 0) {
          // Conversation exists, just send the message
          const conversationId = existing[0].conversation_id;
          
          const insertMessageQuery = `
            INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sent_at, is_read, message_type, sender_type)
            VALUES (?, ?, ?, ?, NOW(), 0, 'text', 'buyer')
          `;

          callbackConnection.query(insertMessageQuery, [conversationId, buyerId, buyerUsername, initial_message], (err) => {
            if (err) {
              console.error('Error sending message to existing conversation:', err);
              return res.status(500).json({ error: 'Failed to send message' });
            }

            res.json({ 
              success: true, 
              conversation_id: conversationId,
              message: 'Message sent to existing conversation'
            });
          });
        } else {
          // Create new conversation
          const createConvQuery = `
            INSERT INTO conversations (buyer_id, seller_id, listing_id, buyer_username, seller_username, created_at, updated_at, status)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 'active')
          `;

          const convParams = [buyerId, sellerId, listing_id || null, buyerUsername, sellerUsername];

          callbackConnection.query(createConvQuery, convParams, (err, convResult) => {
            if (err) {
              console.error('Error creating conversation:', err);
              return res.status(500).json({ error: 'Failed to create conversation' });
            }

            const conversationId = convResult.insertId;

            // Send the initial message
            const insertMessageQuery = `
              INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sent_at, is_read, message_type, sender_type)
              VALUES (?, ?, ?, ?, NOW(), 0, 'text', 'buyer')
            `;

            callbackConnection.query(insertMessageQuery, [conversationId, buyerId, buyerUsername, initial_message], (err) => {
              if (err) {
                console.error('Error sending initial message:', err);
                return res.status(500).json({ error: 'Failed to send initial message' });
              }

              res.json({ 
                success: true, 
                conversation_id: conversationId,
                message: 'Conversation started successfully'
              });
            });
          });
        }
      });
    });
  });
});

// API: Delete a message - FIXED VERSION
router.delete('/api/conversations/:conversationId/messages/:messageId', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conversationId = req.params.conversationId;
  const messageId = req.params.messageId;
  const userId = req.session.user.id || req.session.user.user_id;
  const { delete_type } = req.body;

  console.log('Delete message request:', { conversationId, messageId, userId, delete_type });

  if (!['for_me', 'for_everyone'].includes(delete_type)) {
    return res.status(400).json({ error: 'Invalid delete type' });
  }

  // Verify access to conversation
  const accessQuery = `
    SELECT conversation_id 
    FROM conversations 
    WHERE conversation_id = ? AND (buyer_id = ? OR seller_id = ?)
  `;

  callbackConnection.query(accessQuery, [conversationId, userId, userId], (err, access) => {
    if (err) {
      console.error('Error checking conversation access:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (access.length === 0) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }

    // Check if user owns the message
    const messageQuery = `
      SELECT sender_id, is_deleted, deleted_for_user 
      FROM messages 
      WHERE message_id = ? AND conversation_id = ?
    `;

    callbackConnection.query(messageQuery, [messageId, conversationId], (err, messages) => {
      if (err) {
        console.error('Error checking message:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (messages.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = messages[0];

      if (delete_type === 'for_everyone' && message.sender_id !== userId) {
        return res.status(403).json({ error: 'You can only delete your own messages for everyone' });
      }

      if (delete_type === 'for_everyone') {
        // Delete for everyone - mark as deleted but keep content as placeholder
        const updateQuery = `
          UPDATE messages 
          SET is_deleted = 1, message_content = '[This message was deleted]', image_url = NULL
          WHERE message_id = ?
        `;

        callbackConnection.query(updateQuery, [messageId], (err, result) => {
          if (err) {
            console.error('Error deleting message for everyone:', err);
            return res.status(500).json({ error: 'Failed to delete message' });
          }

          if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Message not found' });
          }

          console.log('Message deleted for everyone successfully');
          res.json({ 
            success: true, 
            message: 'Message deleted for everyone'
          });
        });
      } else {
        // Delete for me - add user to deleted_for_user list
        let deletedForUser = [];
        if (message.deleted_for_user) {
          try {
            deletedForUser = JSON.parse(message.deleted_for_user);
          } catch (e) {
            deletedForUser = [];
          }
        }

        if (!deletedForUser.includes(userId)) {
          deletedForUser.push(userId);
        }

        const updateQuery = `
          UPDATE messages 
          SET deleted_for_user = ?
          WHERE message_id = ?
        `;

        callbackConnection.query(updateQuery, [JSON.stringify(deletedForUser), messageId], (err, result) => {
          if (err) {
            console.error('Error deleting message for user:', err);
            return res.status(500).json({ error: 'Failed to delete message' });
          }

          if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Message not found' });
          }

          console.log('Message deleted for user successfully');
          res.json({ 
            success: true, 
            message: 'Message deleted for you'
          });
        });
      }
    });
  });
});

// ========== Q&A API ROUTES ==========

// Submit new question
router.post('/api/qa', (req, res) => {
  if (!requireUserAuth(req, res)) return;

  const { category, question_text, details } = req.body;

  if (!category || !question_text) {
    return res.status(400).json({ error: 'Category and question are required' });
  }

  const insertQuery = `
    INSERT INTO qa (asker_id, asker_username, category, question_text, details, asked_at, is_verified, created_at)
    VALUES (?, ?, ?, ?, ?, NOW(), 0, NOW())
  `;

  const userId = getUserId(req);
  const username = getUserUsername(req.session.user);

  const values = [
    userId,
    username,
    category,
    question_text,
    details || null
  ];

  callbackConnection.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error('Error submitting question:', err);
      return res.status(500).json({ error: 'Failed to submit question' });
    }

    res.json({ 
      success: true, 
      message: 'Question submitted for review',
      qa_id: result.insertId
    });
  });
});

// Submit answer to question
router.post('/api/qa/:qaId/answer', (req, res) => {
  if (!requireUserAuth(req, res)) return;

  const qaId = req.params.qaId;
  const { answer_content } = req.body;

  if (!answer_content) {
    return res.status(400).json({ error: 'Answer content is required' });
  }

  const insertQuery = `
    INSERT INTO qa_answers (qa_id, answerer_id, answerer_username, answer_content, answered_at)
    VALUES (?, ?, ?, ?, NOW())
  `;

  const userId = getUserId(req);
  const username = getUserUsername(req.session.user);

  const values = [
    qaId,
    userId,
    username,
    answer_content
  ];

  callbackConnection.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error('Error submitting answer:', err);
      return res.status(500).json({ error: 'Failed to submit answer' });
    }

    res.json({ 
      success: true, 
      message: 'Answer submitted successfully',
      answer_id: result.insertId
    });
  });
});

// Vote helpful on question
router.post('/api/qa/:qaId/vote', (req, res) => {
  if (!requireUserAuth(req, res)) return;

  const qaId = req.params.qaId;
  const userId = getUserId(req);

  // Check if user already voted
  const checkVoteQuery = 'SELECT * FROM qa_votes WHERE qa_id = ? AND user_id = ?';
  
  callbackConnection.query(checkVoteQuery, [qaId, userId], (err, existingVotes) => {
    if (err) {
      console.error('Error checking vote:', err);
      return res.status(500).json({ error: 'Failed to check vote status' });
    }

    if (existingVotes.length > 0) {
      // Remove vote
      const deleteVoteQuery = 'DELETE FROM qa_votes WHERE qa_id = ? AND user_id = ?';
      callbackConnection.query(deleteVoteQuery, [qaId, userId], (err) => {
        if (err) {
          console.error('Error removing vote:', err);
          return res.status(500).json({ error: 'Failed to remove vote' });
        }

        // Get updated count from votes table
        const getCountQuery = 'SELECT COUNT(*) as helpful_count FROM qa_votes WHERE qa_id = ?';
        callbackConnection.query(getCountQuery, [qaId], (err, result) => {
          if (err) {
            console.error('Error getting count:', err);
            return res.status(500).json({ error: 'Failed to get updated count' });
          }

          res.json({ 
            voted: false, 
            vote_count: result[0].helpful_count 
          });
        });
      });
    } else {
      // Add vote
      const insertVoteQuery = 'INSERT INTO qa_votes (qa_id, user_id, voted_at) VALUES (?, ?, NOW())';
      callbackConnection.query(insertVoteQuery, [qaId, userId], (err) => {
        if (err) {
          console.error('Error adding vote:', err);
          return res.status(500).json({ error: 'Failed to add vote' });
        }

        // Get updated count from votes table
        const getCountQuery = 'SELECT COUNT(*) as helpful_count FROM qa_votes WHERE qa_id = ?';
        callbackConnection.query(getCountQuery, [qaId], (err, result) => {
          if (err) {
            console.error('Error getting count:', err);
            return res.status(500).json({ error: 'Failed to get updated count' });
          }

          res.json({ 
            voted: true, 
            vote_count: result[0].helpful_count 
          });
        });
      });
    }
  });
});

// Get user's vote status for questions
router.get('/api/qa/votes/status', (req, res) => {
  if (!requireUserAuth(req, res)) return;

  const userId = getUserId(req);
  const query = 'SELECT qa_id FROM qa_votes WHERE user_id = ?';
  
  callbackConnection.query(query, [userId], (err, votes) => {
    if (err) {
      console.error('Error getting vote status:', err);
      return res.status(500).json({ error: 'Failed to get vote status' });
    }

    const votedQuestions = votes.map(vote => vote.qa_id);
    res.json(votedQuestions);
  });
});

// --------------- User Feedback -------------------------
router.get('/feedback', (req, res) => {
  res.render('users/feedback', { 
    title: 'Feedback - Vintique',
    layout: 'user',
    activePage: 'feedback'
  });
});

router.post('/feedback', (req, res) => {
  const { fullName, email, subject, message } = req.body;

  if (!fullName || !email || !subject || !message) {
    return res.render('users/feedback', {
      title: 'Feedback - Vintique',
      layout: 'user',
      activePage: 'feedback',
      errorMessage: 'Please fill in all fields.'
    });
  }

  callbackConnection.query(
    'INSERT INTO feedback (fullName, email, subject, message) VALUES (?, ?, ?, ?)',
    [fullName, email, subject, message],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.render('users/feedback', {
          title: 'Feedback - Vintique',
          layout: 'user',
          activePage: 'feedback',
          errorMessage: 'Something went wrong. Please try again.'
        });
      }

      res.render('users/feedback', {
        title: 'Feedback - Vintique',
        layout: 'user',
        activePage: 'feedback',
        successMessage: 'Thank you for your feedback!'
      });
    }
  );
});

// ========== CART API ROUTES ==========

// Get cart items
router.get('/api/cart', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.id || req.session.user.user_id;
  const cartQuery = `
    SELECT 
      c.cart_id,
      c.listing_id,
      c.quantity,
      c.added_at,
      l.title,
      l.price,
      l.item_condition,
      l.status,
      (SELECT image_url FROM listing_images li WHERE li.listing_id = l.listing_id ORDER BY li.is_main DESC, li.image_id ASC LIMIT 1) as image_url,
      u.email as seller_username
    FROM cart c
    JOIN listings l ON c.listing_id = l.listing_id
    JOIN users u ON l.user_id = u.user_id
    WHERE c.user_id = ?
    ORDER BY c.added_at DESC
  `;
  
  callbackConnection.query(cartQuery, [userId], (err, items) => {
    if (err) {
      return handleDbError(err, res, 'Cart query error');
    }
    
    // Fix image URLs using helper
    const processedItems = processListingImages(items);
    
    res.json({ items: processedItems });
  });
});

// Add item to cart
router.post('/api/cart', (req, res) => {
  if (!requireUserAuth(req, res)) return;
  
  const userId = getUserId(req);
  const { listing_id, quantity = 1 } = req.body;
  
  if (!listing_id) {
    return res.status(400).json({ error: 'Listing ID is required' });
  }
  
  // Check if listing exists and is available
  const checkListingQuery = `
    SELECT listing_id, title, user_id, status 
    FROM listings 
    WHERE listing_id = ? AND status = 'active'
  `;
  
  callbackConnection.query(checkListingQuery, [listing_id], (err, listings) => {
    if (err) {
    }
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found or no longer available' });
    }
    
    const listing = listings[0];
    
    // Check if user is trying to add their own item
    if (listing.user_id === userId) {
      return res.status(400).json({ error: 'You cannot add your own items to cart' });
    }
    
    // Check if item is already in cart
    const checkCartQuery = 'SELECT cart_id FROM cart WHERE user_id = ? AND listing_id = ?';
    callbackConnection.query(checkCartQuery, [userId, listing_id], (err, cartItems) => {
      if (err) {
        console.error('Check cart error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (cartItems.length > 0) {
        return res.status(409).json({ error: 'Item is already in your cart' });
      }
      
      // Add to cart
      const insertCartQuery = `
        INSERT INTO cart (user_id, listing_id, quantity, added_at)
        VALUES (?, ?, ?, NOW())
      `;
      
      callbackConnection.query(insertCartQuery, [userId, listing_id, quantity], (err, result) => {
        if (err) {
          console.error('Add to cart error:', err);
          return res.status(500).json({ error: 'Failed to add item to cart' });
        }
        
        res.json({ 
          success: true, 
          message: `"${listing.title}" added to cart!`,
          cart_id: result.insertId
        });
      });
    });
  });
});

// Update cart item quantity
router.put('/api/cart/:cartId', (req, res) => {
  if (!requireUserAuth(req, res)) return;
  
  const userId = getUserId(req);
  const cartId = req.params.cartId;
  const { quantity } = req.body;
  
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'Valid quantity is required' });
  }
  
  const updateQuery = 'UPDATE cart SET quantity = ? WHERE cart_id = ? AND user_id = ?';
  callbackConnection.query(updateQuery, [quantity, cartId, userId], (err, result) => {
    if (err) {
      console.error('Update cart quantity error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Item not found in cart' });
    }
    
    res.json({ success: true, message: 'Cart quantity updated' });
  });
});

// Remove item from cart
router.delete('/api/cart/:cartId', (req, res) => {
  if (!requireUserAuth(req, res)) return;
  
  const userId = getUserId(req);
  const cartId = req.params.cartId;
  
  const deleteQuery = 'DELETE FROM cart WHERE cart_id = ? AND user_id = ?';
  callbackConnection.query(deleteQuery, [cartId, userId], (err, result) => {
    if (err) {
      console.error('Remove from cart error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Item not found in cart' });
    }
    
    res.json({ success: true, message: 'Item removed from cart' });
  });
});

// Clear entire cart
router.delete('/api/cart', (req, res) => {
  if (!requireUserAuth(req, res)) return;
  
  const userId = getUserId(req);
  const deleteQuery = 'DELETE FROM cart WHERE user_id = ?';
  
  callbackConnection.query(deleteQuery, [userId], (err, result) => {
    if (err) {
      console.error('Clear cart error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({ success: true, message: 'Cart cleared successfully' });
  });
});

// API: Get a single listing (for product cards in messages)
router.get('/api/listings/:listingId', (req, res) => {
  const listingId = req.params.listingId;

  const listingQuery = `
    SELECT 
      l.listing_id,
      l.title,
      l.price,
      l.category,
      l.item_condition,
      l.brand,
      l.size,
      l.description,
      (SELECT image_url FROM listing_images li WHERE li.listing_id = l.listing_id ORDER BY li.is_main DESC, li.image_id ASC LIMIT 1) as image_url
    FROM listings l
    WHERE l.listing_id = ? AND l.status = 'active'
  `;

  callbackConnection.query(listingQuery, [listingId], (err, listings) => {
    if (err) {
      return handleDbError(err, res, 'Error fetching listing');
    }

    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const listing = listings[0];
    
    // Fix image URL using helper
    listing.image_url = fixImageUrl(listing.image_url);

    res.json(listing);
  });
});

// API: Get all listings (fallback)
router.get('/api/listings', (req, res) => {
  const listingsQuery = `
    SELECT 
      l.listing_id,
      l.title,
      l.price,
      l.category,
      l.item_condition,
      l.brand,
      l.size,
      l.description,
      (SELECT image_url FROM listing_images li WHERE li.listing_id = l.listing_id ORDER BY li.is_main DESC, li.image_id ASC LIMIT 1) as image_url
    FROM listings l
    WHERE l.status = 'active'
    ORDER BY l.created_at DESC
  `;

  callbackConnection.query(listingsQuery, (err, listings) => {
    if (err) {
      return handleDbError(err, res, 'Error fetching listings');
    }

    // Fix image URLs using helper
    const processedListings = processListingImages(listings);

    res.json(processedListings);
  });
});

// -------------------------- Product Review Routing -----------------------------
router.get('/api/listings/:listingId/reviews', (req, res) => {
  const listingId = req.params.listingId;

  const reviewQuery = `
    SELECT 
      r.reviewID,
      r.rating,
      r.reviewText,
      r.createdAt,
      u.user_id,
      ui.username,
      ui.profile_image_url
    FROM reviews r
    JOIN users u ON r.userID = u.user_id
    JOIN user_information ui ON u.user_id = ui.user_id
    WHERE r.listingID = ? AND r.approved = 1
    ORDER BY r.createdAt DESC
  `;

  callbackConnection.query(reviewQuery, [listingId], (err, results) => {
    if (err) {
      console.error('Error fetching reviews:', err);
      return res.status(500).json({ error: 'Database error while fetching reviews' });
    }

    const now = new Date();

    const formattedReviews = results.map(review => {
      const createdAt = new Date(review.createdAt);
      const diffTime = now - createdAt;
      const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return {
        reviewID: review.reviewID,
        rating: review.rating,
        reviewText: review.reviewText,
        createdAt: review.createdAt,
        user_id: review.user_id,
        username: review.username,
        profile_image_url: review.profile_image_url,
        timeAgo: daysAgo === 0 ? 'Today' : `${daysAgo} day(s) ago`
      };
    });

    res.render('your-review-view', { reviews: formattedReviews });
  });
});

// Orders History
router.get('/orders', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  const userId = req.session.user.user_id || req.session.user.id;

  const conn = await createConnection();

  try {
    // Fetch purchases (orders where user is buyer)
    const [purchases] = await conn.execute(
      `SELECT o.*, l.title AS listing_title, u.email AS seller_email, li.image_url AS listing_image, l.listing_id as listing_id,
              oi.quantity, oi.price, oi.order_item_id as orderItemId, r.reviewID IS NOT NULL AS hasReviewed
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN listings l ON oi.listing_id = l.listing_id
       JOIN users u ON l.user_id = u.user_id
       LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
       LEFT JOIN reviews r ON r.userID = o.user_id AND r.orderItemID = oi.order_item_id
       WHERE o.user_id = ?`, [userId]
    );

    // Fetch sales (orders where user is the seller)
    const [sales] = await conn.execute(
      `SELECT o.*, l.title AS listing_title, o.user_id AS buyer_id, u.email AS buyer_email, li.image_url AS listing_image,
              oi.quantity, oi.price
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN listings l ON oi.listing_id = l.listing_id
       JOIN users u ON o.user_id = u.user_id
       LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
       WHERE l.user_id = ?`, [userId]
    );

    await conn.end();

    res.render('users/orders', {
      layout: 'user',
      activePage: 'orders',
      purchases,
      sales
    });
  } catch (error) {
    console.error('Orders page error:', error);
    await conn.end();
    res.status(500).send('Database error');
  }
});

// Get order details
router.get('/orders/details/:orderId', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.user_id || req.session.user.id;
  const orderId = req.params.orderId;

  const conn = await createConnection();

  try {
    // Check order ownership (as buyer or seller)
    const [orders] = await conn.execute(
      `SELECT * FROM orders WHERE order_id = ? AND (user_id = ? OR order_id IN 
        (SELECT order_id FROM order_items oi JOIN listings l ON oi.listing_id = l.listing_id WHERE l.user_id = ?))`,
      [orderId, userId, userId]
    );
    
    if (orders.length === 0) {
      await conn.end();
      return res.status(404).json({ error: "Order not found or not authorized" });
    }
    
    const order = orders[0];

    // Get items
    const [items] = await conn.execute(
      `SELECT oi.*, l.title AS listing_title, l.description AS listing_description, li.image_url AS listing_image
       FROM order_items oi
       JOIN listings l ON oi.listing_id = l.listing_id
       LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
       WHERE oi.order_id = ?`, [orderId]
    );

    await conn.end();
    res.json({ order, items });
  } catch (error) {
    console.error('Order details error:', error);
    await conn.end();
    res.status(500).json({ error: 'Database error' });
  }
});


router.post('/orders/mark-received/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

  const orderId = req.params.orderId;
  const userId = req.session.user.user_id || req.session.user.id;

  const conn = await createConnection();

  try {
    // Check if user is the buyer for this order
    const [result] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_id = ? AND user_id = ?`,
      [orderId, userId]
    );
    if (!result[0].cnt) {
      await conn.end();
      return res.status(403).json({ error: "Unauthorized" });
    }

    await conn.execute(`UPDATE orders SET status = 'completed' WHERE order_id = ?`, [orderId]);
    await conn.end();

    res.json({ success: true });
  } catch (err) {
    await conn.end();
    res.status(500).json({ error: "Database error" });
  }
});



// Archived Orders History
router.get('/orders/archived', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userId = req.session.user.user_id || req.session.user.id;
  const conn = await createConnection();

  try {
    // Fetch archived purchases
    const [purchases] = await conn.execute(
      `SELECT o.*, l.title AS listing_title, u.email AS seller_email, li.image_url AS listing_image, l.listing_id as listing_id,
              oi.quantity, oi.price, oi.order_item_id as orderItemId, r.reviewID IS NOT NULL AS hasReviewed
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN listings l ON oi.listing_id = l.listing_id
       JOIN users u ON l.user_id = u.user_id
       LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
       LEFT JOIN reviews r ON r.userID = o.user_id AND r.orderItemID = oi.order_item_id
       WHERE o.user_id = ? AND o.archived = 1`, [userId]
    );

    // Fetch archived sales
    const [sales] = await conn.execute(
      `SELECT o.*, l.title AS listing_title, o.user_id AS buyer_id, u.email AS buyer_email, li.image_url AS listing_image,
              oi.quantity, oi.price
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN listings l ON oi.listing_id = l.listing_id
       JOIN users u ON o.user_id = u.user_id
       LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
       WHERE l.user_id = ? AND o.archived = 1`, [userId]
    );

    await conn.end();

    res.render('users/orders_archived', {
      layout: 'user',
      activePage: 'orders',
      purchases,
      sales
    });
  } catch (error) {
    console.error('Archived orders page error:', error);
    await conn.end();
    res.status(500).send('Database error');
  }
});


// ========== STRIPE API ENDPOINTS ==========

// Get Stripe publishable key
router.get('/api/stripe/get-publishable-key', (req, res) => {
  try {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return res.status(503).json({ 
        error: 'Stripe publishable key not configured.' 
      });
    }
    
    res.json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (error) {
    console.error('Error getting publishable key:', error);
    res.status(500).json({ error: 'Failed to get publishable key.' });
  }
});

// Create Stripe payment intent
router.post('/api/stripe/create-payment-intent', requireAuth, async (req, res) => {
  let connection;
  try {
    // Check if Stripe is configured
    if (!global.stripe) {
      return res.status(503).json({ 
        error: 'Payment processing is currently unavailable. Please contact support.' 
      });
    }
    
    connection = await createConnection();
    const { order_id, amount } = req.body;
    
    // Create Stripe checkout session
    const session = await global.stripe.checkout.sessions.create({
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
router.post('/api/stripe/verify-payment', requireAuth, async (req, res) => {
  let connection;
  try {
    // Check if Stripe is configured
    if (!global.stripe) {
      return res.status(503).json({ 
        error: 'Payment processing is currently unavailable.' 
      });
    }
    
    const { sessionId, orderId } = req.body;
    
    if (!sessionId || !orderId) {
      return res.status(400).json({ error: 'Session ID and Order ID are required.' });
    }
    
    // Retrieve the session from Stripe
    const session = await global.stripe.checkout.sessions.retrieve(sessionId);
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
router.post('/api/checkout', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id || req.session.user.id;
    
                    // Debug: Log the entire request body
                console.log('=== CHECKOUT DEBUG ===');
                console.log('Request body:', JSON.stringify(req.body, null, 2));
                console.log('Content-Type:', req.get('Content-Type'));
                
                // Extract shipping fields from nested object
                const shippingAddress = req.body.shipping_address || {};
                const shipping_address_name = shippingAddress.name;
                const shipping_address_street = shippingAddress.street;
                const shipping_address_city = shippingAddress.city;
                const shipping_address_state = shippingAddress.state;
                const shipping_address_country = shippingAddress.country;
                const shipping_address_postal_code = shippingAddress.postal_code;
                const shipping_address_phone = shippingAddress.phone;
                
                // Debug: Log extracted values
                console.log('Extracted shipping fields:');
                console.log('- shipping_address_name:', shipping_address_name);
                console.log('- shipping_address_street:', shipping_address_street);
                console.log('- shipping_address_city:', shipping_address_city);
                console.log('- shipping_address_state:', shipping_address_state);
                console.log('- shipping_address_country:', shipping_address_country);
                console.log('- shipping_address_postal_code:', shipping_address_postal_code);
                console.log('- shipping_address_phone:', shipping_address_phone);
                console.log('=====================');
                
                // Validate shipping address fields
                const requiredFields = ['shipping_address_name', 'shipping_address_street', 'shipping_address_city', 'shipping_address_state', 'shipping_address_postal_code', 'shipping_address_phone'];
                const missingFields = requiredFields.filter(field => {
                  const fieldValue = {
                    shipping_address_name,
                    shipping_address_street,
                    shipping_address_city,
                    shipping_address_state,
                    shipping_address_postal_code,
                    shipping_address_phone
                  }[field];
                  return !fieldValue;
                });
    
    if (missingFields.length > 0) {
      console.log('Missing fields:', missingFields);
      return res.status(400).json({ error: `Missing required shipping fields: ${missingFields.join(', ')}` });
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
      // Create order with shipping address information
      const [orderResult] = await connection.execute(`
        INSERT INTO orders (
          user_id, 
          total_amount, 
          status,
          shipping_address_name,
          shipping_address_street,
          shipping_address_city,
          shipping_address_state,
          shipping_address_country,
          shipping_address_postal_code,
          shipping_address_phone
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId, 
        total,
        shipping_address_name,
        shipping_address_street,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_address_postal_code,
        shipping_address_phone
      ]);
      
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
router.post('/api/checkout/single', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id || req.session.user.id;
    // Extract shipping fields from nested object
    const shippingAddress = req.body.shipping_address || {};
    const shipping_address_name = shippingAddress.name;
    const shipping_address_street = shippingAddress.street;
    const shipping_address_city = shippingAddress.city;
    const shipping_address_state = shippingAddress.state;
    const shipping_address_country = shippingAddress.country;
    const shipping_address_postal_code = shippingAddress.postal_code;
    const shipping_address_phone = shippingAddress.phone;
    
    const { listing_id } = req.body;
    
    if (!listing_id) {
      return res.status(400).json({ error: 'Listing ID is required.' });
    }
    
    // Validate shipping address fields
    const requiredFields = ['shipping_address_name', 'shipping_address_street', 'shipping_address_city', 'shipping_address_state', 'shipping_address_postal_code', 'shipping_address_phone'];
    const missingFields = requiredFields.filter(field => {
      const fieldValue = {
        shipping_address_name,
        shipping_address_street,
        shipping_address_city,
        shipping_address_state,
        shipping_address_postal_code,
        shipping_address_phone
      }[field];
      return !fieldValue;
    });
    
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required shipping fields: ${missingFields.join(', ')}` });
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
      // Create order with shipping address information
      const [orderResult] = await connection.execute(`
        INSERT INTO orders (
          user_id, 
          total_amount, 
          status,
          shipping_address_name,
          shipping_address_street,
          shipping_address_city,
          shipping_address_state,
          shipping_address_country,
          shipping_address_postal_code,
          shipping_address_phone
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId, 
        total,
        shipping_address_name,
        shipping_address_street,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_address_postal_code,
        shipping_address_phone
      ]);
      
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

module.exports = router;


// ------------------------------- User Profile -----------------------------------------------

router.get('/user/:username', (req, res) => {
  const username = req.params.username;

  const sql = `
    SELECT u.user_id, u.email, ui.username, ui.first_name, ui.last_name,
       ui.profile_image_url
FROM users u
JOIN user_information ui ON u.user_id = ui.user_id
WHERE ui.username = ?


  `;

  callbackConnection.query(sql, [username], (err, users) => {
    if (err) {
      console.error('Error fetching user profile:', err);
      return res.status(500).send('Internal Server Error');
    }

    if (users.length === 0) {
      return res.status(404).render('users/user_not_found', {
        layout: 'user',
        message: 'User not found.'
      });
    }

    const user = users[0];

    // Now get the user's listings (if you want to show them)
    const listingSql = `
      SELECT l.listing_id, l.title, l.price, l.category, l.item_condition, l.created_at,
        (
        SELECT image_url 
        FROM listing_images img2
        WHERE img2.listing_id = l.listing_id
        ORDER BY img2.image_id ASC
        LIMIT 1
      ) as image_url
      FROM listings l
      WHERE l.user_id = ?
        AND l.status = 'active'
      ORDER BY l.created_at DESC
    `;

    callbackConnection.query(listingSql, [user.user_id], (err, listings) => {
      if (err) {
        console.error('Error fetching listings:', err);
        return res.status(500).send('Error loading user listings.');
      }

      listings.forEach(listing => {
        listing.image_url = listing.image_url
          ? `/uploads/${listing.image_url}`
          : '/assets/logo.png';
      });

      res.render('users/profile_display', {
        layout: 'user',
        profileUser: user,
        listings: listings,
        activePage: null,
        user: req.session.user // current logged in user (if any)
      });
    });
  });
});



// -------------------------------------- Adding review after completed orders ------------------------------------------

router.post('/reviews/add', (req, res) => {
  const { listing_id, order_item_id, rating, reviewText } = req.body;
  const userID = req.session.user.user_id || req.session.user.id;


  if (!listing_id || !order_item_id || !rating) {
    return res.status(400).send('Missing required fields.');
  }

  // First, get sellerID from listings table
  const getSellerSql = 'SELECT user_id AS sellerID FROM listings WHERE listing_id = ?';

  callbackConnection.query(getSellerSql, [listing_id], (err, listingRows) => {
    if (err) {
      console.error('Error fetching seller:', err);
      return res.status(500).send('Server error.');
    }

    if (listingRows.length === 0) {
      return res.status(400).send('Invalid listing.');
    }

    const sellerID = listingRows[0].sellerID;

    // Insert the review now
    const insertReviewSql = `
      INSERT INTO reviews (userID, sellerID, listingID, orderItemID, rating, reviewText)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    callbackConnection.query(
      insertReviewSql,
      [userID, sellerID, listing_id, order_item_id, rating, reviewText],
      (err, result) => {
        if (err) {
          console.error('Error inserting review:', err);
          return res.status(500).send('Server error.');
        }

        // Success, redirect or render a page as needed
        res.redirect('/purchases'); 
      }
    );
  });
});

// Test database connection
router.get('/test-db', (req, res) => {
  console.log('Testing database connection...');
  
  const testQuery = 'SELECT 1 as test';
  callbackConnection.query(testQuery, (err, result) => {
    if (err) {
      console.error('❌ Database test failed:', err);
      return res.status(500).json({ 
        error: 'Database connection failed',
        details: err.message 
      });
    }
    
    console.log('✅ Database test successful:', result);
    res.json({ 
      success: true, 
      message: 'Database connection is working',
      result: result 
    });
  });
});
