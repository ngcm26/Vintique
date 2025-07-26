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
const uploadsDir = path.join(__dirname, 'public/uploads/messages');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, 'msg_' + uniqueSuffix + extension);
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

// Configure Handlebars
app.engine('handlebars', engine({
  defaultLayout: 'user',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  helpers: {
    eq: function(a, b) { return a === b; },
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
  next();
};

// ========== BASIC ROUTES ==========

// Home route
app.get('/', (req, res) => {
  res.render('users/home', { 
    title: 'Vintique - Sustainable Fashion Marketplace',
    layout: 'user',
    activePage: 'home'
  });
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
        u.*,
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
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      role: user.role
    };
    
    res.redirect('/');
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

// API: Get conversations list (for auto-refresh)
app.get('/api/conversations', requireAuth, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const userId = req.session.user.user_id;
    
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
    
    // Format conversations for display
    const formattedConversations = conversations.map(conv => {
      const isUserBuyer = conv.buyer_id === userId;
      
      // Get other user's name
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
    
    res.render('users/messages', {
      title: 'Messages - Vintique',
      layout: 'user',
      activePage: 'messages',
      conversations: formattedConversations,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.render('users/messages', {
      title: 'Messages - Vintique',
      layout: 'user',
      activePage: 'messages',
      conversations: [],
      error: 'Error loading messages',
      user: req.session.user
    });
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
    
    // Check if conversation already exists
    const [existingConv] = await connection.execute(`
      SELECT * FROM conversations 
      WHERE buyer_id = ? AND seller_id = ? AND listing_id = ?
    `, [buyerId, sellerId, listing_id]);
    
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
        INSERT INTO conversations (buyer_id, seller_id, buyer_username, seller_username, listing_id, created_at, updated_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())
      `, [buyerId, sellerId, buyerUsername, sellerUsername, listing_id]);
      
      conversationId = convResult.insertId;
    }
    
    // Create initial message
    const [buyerInfo] = await connection.execute(`
      SELECT ui.username, u.email 
      FROM users u 
      LEFT JOIN user_information ui ON u.user_id = ui.user_id 
      WHERE u.user_id = ?
    `, [buyerId]);
    
    const buyerUsername = buyerInfo[0]?.username || buyerInfo[0]?.email || 'Unknown';
    
    await connection.execute(`
      INSERT INTO messages (conversation_id, sender_id, sender_username, message_content, sender_type, sent_at)
      VALUES (?, ?, ?, ?, 'buyer', NOW())
    `, [conversationId, buyerId, buyerUsername, message.trim()]);
    
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
app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'Marketplace.html'));
});

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
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📧 Messages available at http://localhost:${PORT}/messages`);
  console.log(`❓ Q&A available at http://localhost:${PORT}/qa`);
  console.log(`🔧 Test DB at http://localhost:${PORT}/test-db`);
  console.log(`👥 View users at http://localhost:${PORT}/api/users`);
  console.log(`📦 View listings at http://localhost:${PORT}/api/listings`);
});