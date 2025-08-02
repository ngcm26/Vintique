// ========== USER ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { upload } = require('../config/multer');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');
const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '', //Add your own password here
  database: 'vintiquedb',
  port: 3306
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
    params.push(req.session.user.id || req.session.user.user_id);
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
  const userId = req.session.user.id || req.session.user.user_id;
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

// Product Detail Route
router.get('/listing/:id', (req, res) => {
  const listingId = req.params.id;
  
  // Get listing details with all images
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
        ORDER BY li.is_main DESC, li.image_id ASC 
        LIMIT 1
      ) as image_url
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.user_id
    WHERE l.listing_id = ? AND l.status = 'active'
  `;
  
  callbackConnection.query(listingQuery, [listingId], (err, listings) => {
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
    
    // Fix image URL
    if (!listing.image_url || listing.image_url === 'null') {
      listing.image_url = '/assets/logo.png';
    } else if (!listing.image_url.startsWith('/uploads/')) {
      listing.image_url = `/uploads/${listing.image_url}`;
    }
    
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
      
      // Fix additional image URLs
      const additionalImages = images.map(img => {
        if (!img.image_url || img.image_url === 'null') {
          return '/assets/logo.png';
        } else if (!img.image_url.startsWith('/uploads/')) {
          return `/uploads/${img.image_url}`;
        }
        return img.image_url;
      });
      
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const listingId = req.params.id;
  const userId = req.session.user.id || req.session.user.user_id;
  
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const listingId = req.params.id;
  const userId = req.session.user.id || req.session.user.user_id;
  
  // Start transaction
  callbackConnection.beginTransaction((err) => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // First delete images
    const deleteImagesQuery = 'DELETE FROM listing_images WHERE listing_id = ?';
    callbackConnection.query(deleteImagesQuery, [listingId], (err) => {
      if (err) {
        return callbackConnection.rollback(() => {
          console.error('Delete images error:', err);
          res.status(500).json({ error: 'Error deleting listing images' });
        });
      }
      
      // Then delete the listing
      const deleteListingQuery = 'DELETE FROM listings WHERE listing_id = ? AND user_id = ?';
      callbackConnection.query(deleteListingQuery, [listingId, userId], (err, result) => {
        if (err) {
          return callbackConnection.rollback(() => {
            console.error('Delete listing error:', err);
            res.status(500).json({ error: 'Error deleting listing' });
          });
        }
        
        if (result.affectedRows === 0) {
          return callbackConnection.rollback(() => {
            res.status(404).json({ error: 'Listing not found or you do not have permission' });
          });
        }
        
        callbackConnection.commit((err) => {
          if (err) {
            return callbackConnection.rollback(() => {
              console.error('Commit error:', err);
              res.status(500).json({ error: 'Error deleting listing' });
            });
          }
          
          res.json({ success: true, message: 'Listing deleted successfully' });
        });
      });
    });
  });
});

// Delete Image Route
router.post('/delete_image', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const { imgUrl, listingId } = req.body;
  const userId = req.session.user.id || req.session.user.user_id;
  
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
router.get('/cart', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.render('users/cart', {
    layout: 'user',
    activePage: 'cart'
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conversationId = req.params.conversationId;
  const userId = req.session.user.id || req.session.user.user_id;

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

// API: Send a message - FIXED VERSION
router.post('/api/conversations/:conversationId/messages', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conversationId = req.params.conversationId;
  const userId = req.session.user.id || req.session.user.user_id;
  const { message_content } = req.body;

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

      if (!message_content || message_content.trim() === '') {
        return res.status(400).json({ error: 'Message content is required' });
      }

      const conversation = access[0];
      const senderType = conversation.buyer_id === userId ? 'buyer' : 'seller';

      // Insert the message
      const insertQuery = `
        INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sent_at, is_read, message_type, sender_type)
        VALUES (?, ?, ?, ?, NOW(), 0, 'text', ?)
      `;

      callbackConnection.query(insertQuery, [conversationId, userId, username, message_content.trim(), senderType], (err, result) => {
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const buyerId = req.session.user.id || req.session.user.user_id;
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { category, question_text, details } = req.body;

  if (!category || !question_text) {
    return res.status(400).json({ error: 'Category and question are required' });
  }

  const insertQuery = `
    INSERT INTO qa (asker_id, asker_username, category, question_text, details, asked_at, is_verified, created_at)
    VALUES (?, ?, ?, ?, ?, NOW(), 0, NOW())
  `;

  const userId = req.session.user.id || req.session.user.user_id;
  const username = req.session.user.username || req.session.user.email.split('@')[0];

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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const qaId = req.params.qaId;
  const { answer_content } = req.body;

  if (!answer_content) {
    return res.status(400).json({ error: 'Answer content is required' });
  }

  const insertQuery = `
    INSERT INTO qa_answers (qa_id, answerer_id, answerer_username, answer_content, answered_at)
    VALUES (?, ?, ?, ?, NOW())
  `;

  const userId = req.session.user.id || req.session.user.user_id;
  const username = req.session.user.username || req.session.user.email.split('@')[0];

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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const qaId = req.params.qaId;
  const userId = req.session.user.id || req.session.user.user_id;

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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const userId = req.session.user.id || req.session.user.user_id;
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
      console.error('Cart query error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Fix image URLs
    items.forEach(item => {
      if (!item.image_url || item.image_url === 'null') {
        item.image_url = '/assets/logo.png';
      } else if (!item.image_url.startsWith('/uploads/')) {
        item.image_url = `/uploads/${item.image_url}`;
      }
    });
    
    res.json({ items: items });
  });
});

// Add item to cart
router.post('/api/cart', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.id || req.session.user.user_id;
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
      console.error('Check listing error:', err);
      return res.status(500).json({ error: 'Database error' });
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

// Remove item from cart
router.delete('/api/cart/:cartId', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.id || req.session.user.user_id;
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.id || req.session.user.user_id;
  const deleteQuery = 'DELETE FROM cart WHERE user_id = ?';
  
  callbackConnection.query(deleteQuery, [userId], (err, result) => {
    if (err) {
      console.error('Clear cart error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({ success: true, message: 'Cart cleared successfully' });
  });
});

// ========== CHECKOUT API ROUTES ==========

// Single item checkout (Buy Now)
router.post('/api/checkout/single', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.id || req.session.user.user_id;
  const { listing_id } = req.body;
  
  if (!listing_id) {
    return res.status(400).json({ error: 'Listing ID is required' });
  }
  
  // Get listing details
  const listingQuery = `
    SELECT listing_id, title, price, user_id, status
    FROM listings 
    WHERE listing_id = ? AND status = 'active'
  `;
  
  callbackConnection.query(listingQuery, [listing_id], (err, listings) => {
    if (err) {
      console.error('Listing query error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found or no longer available' });
    }
    
    const listing = listings[0];
    
    if (listing.user_id === userId) {
      return res.status(400).json({ error: 'You cannot purchase your own items' });
    }
    
    const subtotal = parseFloat(listing.price);
    const shipping = subtotal >= 50 ? 0 : 5.99;
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + shipping + tax;
    
    // Create order
    const createOrderQuery = `
      INSERT INTO orders (user_id, total_amount, status, created_at)
      VALUES (?, ?, 'pending', NOW())
    `;
    
    callbackConnection.query(createOrderQuery, [userId, total], (err, orderResult) => {
      if (err) {
        console.error('Create order error:', err);
        return res.status(500).json({ error: 'Failed to create order' });
      }
      
      const orderId = orderResult.insertId;
      
      // Add order item
      const addItemQuery = `
        INSERT INTO order_items (order_id, listing_id, quantity, price)
        VALUES (?, ?, 1, ?)
      `;
      
      callbackConnection.query(addItemQuery, [orderId, listing_id, listing.price], (err) => {
        if (err) {
          console.error('Add order item error:', err);
          return res.status(500).json({ error: 'Failed to add order item' });
        }
        
        res.json({
          success: true,
          order_id: orderId,
          total: total,
          message: 'Order created successfully'
        });
      });
    });
  });
});

// Regular cart checkout
router.post('/api/checkout', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const userId = req.session.user.id || req.session.user.user_id;
  const { shipping_address } = req.body;
  
  // Get cart items
  const cartQuery = `
    SELECT 
      c.cart_id,
      c.listing_id,
      c.quantity,
      l.price,
      l.title,
      l.user_id as seller_id,
      l.status
    FROM cart c
    JOIN listings l ON c.listing_id = l.listing_id
    WHERE c.user_id = ?
  `;
  
  callbackConnection.query(cartQuery, [userId], (err, cartItems) => {
    if (err) {
      console.error('Cart query error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    // Check if all items are still available
    const unavailableItems = cartItems.filter(item => item.status !== 'active');
    if (unavailableItems.length > 0) {
      return res.status(400).json({ 
        error: 'Some items in your cart are no longer available',
        unavailable_items: unavailableItems.map(item => item.title)
      });
    }
    
    // Calculate totals
    const subtotal = cartItems.reduce((total, item) => {
      return total + (parseFloat(item.price) * item.quantity);
    }, 0);
    
    const shipping = subtotal >= 50 ? 0 : 5.99;
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + shipping + tax;
    
    // Create order
    const createOrderQuery = `
      INSERT INTO orders (user_id, total_amount, shipping_address, status, created_at)
      VALUES (?, ?, ?, 'pending', NOW())
    `;
    
    const shippingAddressJson = JSON.stringify(shipping_address);
    
    callbackConnection.query(createOrderQuery, [userId, total, shippingAddressJson], (err, orderResult) => {
      if (err) {
        console.error('Create order error:', err);
        return res.status(500).json({ error: 'Failed to create order' });
      }
      
      const orderId = orderResult.insertId;
      
      // Add order items
      const orderItemsData = cartItems.map(item => [
        orderId,
        item.listing_id,
        item.quantity,
        item.price
      ]);
      
      const addItemsQuery = `
        INSERT INTO order_items (order_id, listing_id, quantity, price)
        VALUES ?
      `;
      
      callbackConnection.query(addItemsQuery, [orderItemsData], (err) => {
        if (err) {
          console.error('Add order items error:', err);
          return res.status(500).json({ error: 'Failed to add order items' });
        }
        
        // Clear cart after successful order creation
        const clearCartQuery = 'DELETE FROM cart WHERE user_id = ?';
        callbackConnection.query(clearCartQuery, [userId], (err) => {
          if (err) {
            console.warn('Clear cart warning:', err);
            // Don't fail the order if cart clearing fails
          }
          
          res.json({
            success: true,
            order_id: orderId,
            total: total,
            message: 'Order created successfully'
          });
        });
      });
    });
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
      console.error('Error fetching listing:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (listings.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const listing = listings[0];
    
    // Fix image URL
    if (!listing.image_url || listing.image_url === 'null') {
      listing.image_url = '/assets/logo.png';
    } else if (!listing.image_url.startsWith('/uploads/')) {
      listing.image_url = `/uploads/${listing.image_url}`;
    }

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
      console.error('Error fetching listings:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Fix image URLs
    listings.forEach(listing => {
      if (!listing.image_url || listing.image_url === 'null') {
        listing.image_url = '/assets/logo.png';
      } else if (!listing.image_url.startsWith('/uploads/')) {
        listing.image_url = `/uploads/${listing.image_url}`;
      }
    });

    res.json(listings);
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
    ui.user_id,
    ui.username,
    ui.profile_image_url
  FROM reviews r
  JOIN user_information ui ON r.userID = ui.user_id
  WHERE r.listingID = ? AND r.approved = 1
  ORDER BY r.createdAt DESC
`;


  callbackConnection.query(reviewQuery, [listingId], (err, results) => {
    if (err) {
      console.error('Error fetching reviews:', err);
      return res.status(500).json({ error: 'Database error while fetching reviews' });
    }

    res.json({ reviews: results });
  });
});

// Orders History
router.get('/orders', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  const userId = req.session.user.user_id || req.session.user.id;

  const conn = await mysql.createConnection(dbConfig);

  try {
    // Fetch purchases (orders where user is buyer)
    const [purchases] = await conn.execute(
      `SELECT o.*, l.title AS listing_title, u.email AS seller_email, li.image_url AS listing_image,
              oi.quantity, oi.price
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN listings l ON oi.listing_id = l.listing_id
       JOIN users u ON l.user_id = u.user_id
       LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
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

  const conn = await mysql.createConnection(dbConfig);

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

router.post('/orders/update-status/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const orderId = req.params.orderId;
  const { status } = req.body;
  const userId = req.session.user.user_id || req.session.user.id;

  // Only allow update if user is the seller of ANY item in the order
  const conn = await require('mysql2/promise').createConnection(dbConfig);
  try {
    const [result] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM order_items oi 
        JOIN listings l ON oi.listing_id = l.listing_id
        WHERE oi.order_id = ? AND l.user_id = ?`, [orderId, userId]
    );
    if (!result[0].cnt) {
      await conn.end();
      return res.status(403).json({ error: "Unauthorized" });
    }

    await conn.execute(`UPDATE orders SET status = ? WHERE order_id = ?`, [status, orderId]);
    await conn.end();
    res.json({ success: true });
  } catch (err) {
    await conn.end();
    res.status(500).json({ error: "Database error" });
  }
});


router.post('/orders/mark-received/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const orderId = req.params.orderId;
  const userId = req.session.user.user_id || req.session.user.id;
  const conn = await require('mysql2/promise').createConnection(dbConfig);
  try {
    // Only allow if this user is buyer for the order
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

router.post('/orders/archive/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

  const userId = req.session.user.user_id || req.session.user.id;
  const orderId = req.params.orderId;
  const conn = await require('mysql2/promise').createConnection(dbConfig);

  try {
    // Only allow archive if user is buyer or seller of this order
    const [result] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM orders o
        LEFT JOIN order_items oi ON o.order_id = oi.order_id
        LEFT JOIN listings l ON oi.listing_id = l.listing_id
       WHERE o.order_id = ? AND (o.user_id = ? OR l.user_id = ?)`,
      [orderId, userId, userId]
    );
    if (!result[0].cnt) {
      await conn.end();
      return res.status(403).json({ error: "Unauthorized" });
    }
    await conn.execute(`UPDATE orders SET archived = 1 WHERE order_id = ?`, [orderId]);
    await conn.end();
    res.json({ success: true });
  } catch (err) {
    await conn.end();
    res.status(500).json({ error: "Database error" });
  }
});

router.get('/orders/archived', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const userId = req.session.user.user_id || req.session.user.id;

  const conn = await require('mysql2/promise').createConnection(dbConfig);

  // Get archived purchases and sales
  const [purchases] = await conn.execute(
    `SELECT o.*, l.title AS listing_title, u.email AS seller_email, li.image_url AS listing_image, oi.quantity, oi.price
     FROM orders o
     JOIN order_items oi ON o.order_id = oi.order_id
     JOIN listings l ON oi.listing_id = l.listing_id
     JOIN users u ON l.user_id = u.user_id
     LEFT JOIN listing_images li ON l.listing_id = li.listing_id AND li.is_main = 1
     WHERE o.user_id = ? AND o.archived = 1`, [userId]
  );

  const [sales] = await conn.execute(
    `SELECT o.*, l.title AS listing_title, o.user_id AS buyer_id, u.email AS buyer_email, li.image_url AS listing_image, oi.quantity, oi.price
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
});


router.post('/orders/delete/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

  const userId = req.session.user.user_id || req.session.user.id;
  const orderId = req.params.orderId;
  const conn = await require('mysql2/promise').createConnection(dbConfig);

  try {
    // Only allow if user is buyer or seller and order is archived & cancelled
    const [result] = await conn.execute(
      `SELECT COUNT(*) AS cnt FROM orders o
        LEFT JOIN order_items oi ON o.order_id = oi.order_id
        LEFT JOIN listings l ON oi.listing_id = l.listing_id
       WHERE o.order_id = ? AND o.archived = 1 AND o.status = 'cancelled' AND (o.user_id = ? OR l.user_id = ?)`,
      [orderId, userId, userId]
    );
    if (!result[0].cnt) {
      await conn.end();
      return res.status(403).json({ error: "Unauthorized or not cancellable" });
    }
    // Delete order and cascade to order_items (if foreign key is ON DELETE CASCADE)
    await conn.execute(`DELETE FROM orders WHERE order_id = ?`, [orderId]);
    await conn.end();
    res.json({ success: true });
  } catch (err) {
    await conn.end();
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;

