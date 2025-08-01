// ========== USER ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database'); // Add createConnection import
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

// Q&A route - FIXED VERSION
router.get('/qa', (req, res) => {
  // Q&A page should be accessible to all users, but certain features require login
  const qaQuery = `
    SELECT 
      q.qa_id,
      q.asker_id,
      q.asker_username,
      q.asker_email,
      q.category,
      q.question_text,
      q.details,
      q.asked_at,
      q.is_verified,
      q.helpful_count,
      q.created_at
    FROM qa q
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

    // For each question, get its answers
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
        qa_id,
        answerer_id,
        answerer_username,
        answerer_email,
        answer_content,
        answered_at
      FROM qa_answers
      WHERE qa_id IN (${questionIds.map(() => '?').join(',')})
      ORDER BY answered_at ASC
    `;

    callbackConnection.query(answersQuery, questionIds, (err, answers) => {
      if (err) {
        console.error('Q&A answers error:', err);
        // Continue without answers rather than failing completely
      }

      // Group answers by question ID
      const answersByQuestionId = {};
      if (answers) {
        answers.forEach(answer => {
          if (!answersByQuestionId[answer.qa_id]) {
            answersByQuestionId[answer.qa_id] = [];
          }
          answersByQuestionId[answer.qa_id].push(answer);
        });
      }

      // Add answers to questions
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
    INSERT INTO qa (asker_id, asker_username, asker_email, category, question_text, details, asked_at, is_verified, helpful_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, 0, NOW())
  `;

  const values = [
    req.session.user.id,
    req.session.user.username || req.session.user.email.split('@')[0],
    req.session.user.email,
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
    INSERT INTO qa_answers (qa_id, answerer_id, answerer_username, answerer_email, answer_content, answered_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;

  const values = [
    qaId,
    req.session.user.id,
    req.session.user.username || req.session.user.email.split('@')[0],
    req.session.user.email,
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
  const userId = req.session.user.id;

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

        // Update helpful count
        const updateCountQuery = 'UPDATE qa SET helpful_count = helpful_count - 1 WHERE qa_id = ?';
        callbackConnection.query(updateCountQuery, [qaId], (err) => {
          if (err) {
            console.error('Error updating count:', err);
            return res.status(500).json({ error: 'Failed to update count' });
          }

          // Get updated count
          const getCountQuery = 'SELECT helpful_count FROM qa WHERE qa_id = ?';
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
      });
    } else {
      // Add vote
      const insertVoteQuery = 'INSERT INTO qa_votes (qa_id, user_id, voted_at) VALUES (?, ?, NOW())';
      callbackConnection.query(insertVoteQuery, [qaId, userId], (err) => {
        if (err) {
          console.error('Error adding vote:', err);
          return res.status(500).json({ error: 'Failed to add vote' });
        }

        // Update helpful count
        const updateCountQuery = 'UPDATE qa SET helpful_count = helpful_count + 1 WHERE qa_id = ?';
        callbackConnection.query(updateCountQuery, [qaId], (err) => {
          if (err) {
            console.error('Error updating count:', err);
            return res.status(500).json({ error: 'Failed to update count' });
          }

          // Get updated count
          const getCountQuery = 'SELECT helpful_count FROM qa WHERE qa_id = ?';
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
      });
    }
  });
});

// Get user's vote status for questions
router.get('/api/qa/votes/status', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const userId = req.session.user.id;
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

// ========== MESSAGES ROUTES ==========

// Messages page route - FIXED VERSION WITH PROPER DATA LOADING
router.get('/messages', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userId = req.session.user.id;
  console.log('Loading messages for user:', userId);
  
  // Get all conversations for the user
  const conversationsQuery = `
    SELECT 
      c.conversation_id,
      c.buyer_id,
      c.seller_id,
      c.listing_id,
      c.created_at,
      c.updated_at,
      c.status,
      
      -- Get the other user's info
      CASE 
        WHEN c.buyer_id = ? THEN seller_info.first_name
        ELSE buyer_info.first_name
      END as other_user_name,
      
      CASE 
        WHEN c.buyer_id = ? THEN seller_info.email
        ELSE buyer_info.email
      END as other_user_email,
      
      -- Get listing info
      l.title as listing_title,
      l.price as listing_price,
      
      -- Get last message info
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
       
      -- Count unread messages
      (SELECT COUNT(*) 
       FROM messages m3 
       WHERE m3.conversation_id = c.conversation_id 
       AND m3.sender_id != ? 
       AND m3.is_read = 0) as unread_count
       
    FROM conversations c
    
    -- Join to get buyer info
    LEFT JOIN users buyer_user ON c.buyer_id = buyer_user.user_id
    LEFT JOIN user_information buyer_info ON buyer_user.user_id = buyer_info.user_id
    
    -- Join to get seller info  
    LEFT JOIN users seller_user ON c.seller_id = seller_user.user_id
    LEFT JOIN user_information seller_info ON seller_user.user_id = seller_info.user_id
    
    -- Join to get listing info
    LEFT JOIN listings l ON c.listing_id = l.listing_id
    
    WHERE c.buyer_id = ? OR c.seller_id = ?
    ORDER BY COALESCE(
      (SELECT sent_at FROM messages m2 WHERE m2.conversation_id = c.conversation_id ORDER BY m2.sent_at DESC LIMIT 1),
      c.created_at
    ) DESC
  `;

  callbackConnection.query(conversationsQuery, [userId, userId, userId, userId, userId], (err, conversations) => {
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

    // Process conversations to handle null names
    const processedConversations = conversations.map(conv => ({
      ...conv,
      other_user_name: conv.other_user_name || conv.other_user_email || 'Unknown User',
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

// API: Get messages for a conversation
router.get('/api/conversations/:conversationId/messages', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conversationId = req.params.conversationId;
  const userId = req.session.user.id;

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

    // Get all messages for this conversation
    const messagesQuery = `
      SELECT 
        m.message_id,
        m.conversation_id,
        m.sender_id,
        m.message_content,
        m.image_url,
        m.sent_at,
        m.is_read,
        m.message_type,
        
        -- Get sender info
        ui.first_name,
        ui.last_name,
        u.email as sender_email,
        
        -- Get listing info if it exists
        c.listing_id
        
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.user_id
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
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

// API: Send a message
router.post('/api/conversations/:conversationId/messages', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conversationId = req.params.conversationId;
  const userId = req.session.user.id;
  const { message_content } = req.body;

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

    if (!message_content || message_content.trim() === '') {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Insert the message
    const insertQuery = `
      INSERT INTO messages (conversation_id, sender_id, message_content, sent_at, is_read, message_type)
      VALUES (?, ?, ?, NOW(), 0, 'text')
    `;

    callbackConnection.query(insertQuery, [conversationId, userId, message_content.trim()], (err, result) => {
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

// API: Start a new conversation
router.post('/api/conversations', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const buyerId = req.session.user.id;
  const { seller_email, initial_message, listing_id } = req.body;

  if (!seller_email || !initial_message) {
    return res.status(400).json({ error: 'Seller email and initial message are required' });
  }

  // Find the seller by email
  const findSellerQuery = 'SELECT user_id FROM users WHERE email = ?';
  
  callbackConnection.query(findSellerQuery, [seller_email], (err, sellers) => {
    if (err) {
      console.error('Error finding seller:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (sellers.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const sellerId = sellers[0].user_id;

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
          INSERT INTO messages (conversation_id, sender_id, message_content, sent_at, is_read, message_type)
          VALUES (?, ?, ?, NOW(), 0, 'text')
        `;

        callbackConnection.query(insertMessageQuery, [conversationId, buyerId, initial_message], (err) => {
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
          INSERT INTO conversations (buyer_id, seller_id, listing_id, created_at, updated_at, status)
          VALUES (?, ?, ?, NOW(), NOW(), 'active')
        `;

        const convParams = [buyerId, sellerId, listing_id || null];

        callbackConnection.query(createConvQuery, convParams, (err, convResult) => {
          if (err) {
            console.error('Error creating conversation:', err);
            return res.status(500).json({ error: 'Failed to create conversation' });
          }

          const conversationId = convResult.insertId;

          // Send the initial message
          const insertMessageQuery = `
            INSERT INTO messages (conversation_id, sender_id, message_content, sent_at, is_read, message_type)
            VALUES (?, ?, ?, NOW(), 0, 'text')
          `;

          callbackConnection.query(insertMessageQuery, [conversationId, buyerId, initial_message], (err) => {
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


/// ------------------------ Product Review Routing ------------------------------
router.get('/api/listings/:listingId/reviews', (req, res) => {
  const listingId = req.params.listingId;

  const reviewQuery = `
    SELECT 
      r.reviewID,
      r.rating,
      r.reviewText,
      r.createdAt,
      u.user_id,
      u.username,
      u.profile_picture
    FROM reviews r
    JOIN users u ON r.userID = u.user_id
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

module.exports = router;