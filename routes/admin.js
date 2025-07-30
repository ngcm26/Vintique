// ========== ADMIN ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection } = require('../config/database');

// Admin Dashboard
router.get('/admin/dashboard', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  // Get basic stats for dashboard
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM users WHERE role = 'user') as total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'staff') as total_staff,
      (SELECT COUNT(*) FROM listings WHERE status = 'active') as active_listings,
      (SELECT COUNT(*) FROM orders WHERE status = 'paid') as total_orders
  `;
  
  callbackConnection.query(statsQuery, (err, stats) => {
    if (err) {
      console.error('Dashboard stats error:', err);
      return res.status(500).send('Database error');
    }
    
    res.render('staff/dashboard', {
      layout: 'admin', // Using admin layout
      activePage: 'dashboard',
      stats: stats[0] || { total_users: 0, total_staff: 0, active_listings: 0, total_orders: 0 }
    });
  });
});

// User Management
router.get('/admin/user_management', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  const usersQuery = `
    SELECT u.user_id, u.email, u.role, u.status, u.created_at,
           ui.first_name, ui.last_name, ui.username
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.role = 'user'
    ORDER BY u.created_at DESC
  `;
  
  callbackConnection.query(usersQuery, (err, users) => {
    if (err) {
      console.error('User management error:', err);
      return res.status(500).send('Database error');
    }
    
    res.render('staff/user_management', {
      layout: 'admin',
      activePage: 'user_management',
      users: users
    });
  });
});

// Staff Management (Admin only)
router.get('/admin/staff_management', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  const staffQuery = `
    SELECT u.user_id, u.email, u.role, u.status, u.created_at,
           ui.first_name, ui.last_name, ui.username
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.role IN ('staff', 'admin')
    ORDER BY u.created_at DESC
  `;
  
  callbackConnection.query(staffQuery, (err, staff) => {
    if (err) {
      console.error('Staff management error:', err);
      return res.status(500).send('Database error');
    }
    
    res.render('staff/staff_management', {
      layout: 'admin',
      activePage: 'staff_management',
      staff: staff
    });
  });
});

// Q&A Management
router.get('/admin/qa', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  const qaQuery = `
    SELECT q.qa_id, q.question, q.answer, q.status, q.created_at,
           u.email as user_email
    FROM qa q
    LEFT JOIN users u ON q.user_id = u.user_id
    ORDER BY q.created_at DESC
  `;
  
  callbackConnection.query(qaQuery, (err, qaList) => {
    if (err) {
      console.error('Q&A management error:', err);
      return res.status(500).send('Database error');
    }
    
    res.render('staff/qa_management', {
      layout: 'admin',
      activePage: 'qa',
      qaList: qaList
    });
  });
});

// Add Staff Member (Admin only)
router.post('/admin/add_staff', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const { email, password, first_name, last_name, phone } = req.body;
  
  if (!email || !password || !first_name || !last_name || !phone) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  
  // Check if email already exists
  const checkEmailQuery = 'SELECT * FROM users WHERE email = ?';
  callbackConnection.query(checkEmailQuery, [email], (err, existingUsers) => {
    if (err) {
      console.error('Check email error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Insert new staff member
    const insertUserQuery = 'INSERT INTO users (email, phone_number, password, role) VALUES (?, ?, ?, ?)';
    callbackConnection.query(insertUserQuery, [email, phone, password, 'staff'], (err, userResult) => {
      if (err) {
        console.error('Insert user error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      const userId = userResult.insertId;
      const insertInfoQuery = 'INSERT INTO user_information (user_id, username, first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?, ?, ?)';
      callbackConnection.query(insertInfoQuery, [userId, email.split('@')[0], first_name, last_name, email, phone], (err) => {
        if (err) {
          console.error('Insert user_info error:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({ success: true, message: 'Staff member added successfully' });
      });
    });
  });
});

// Suspend/Unsuspend User (Admin only)
router.post('/admin/toggle_user_status', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const { userId, action } = req.body;
  
  if (!userId || !action) {
    return res.status(400).json({ error: 'User ID and action are required' });
  }
  
  const newStatus = action === 'suspend' ? 'suspended' : 'active';
  const updateQuery = 'UPDATE users SET status = ? WHERE user_id = ?';
  
  callbackConnection.query(updateQuery, [newStatus, userId], (err) => {
    if (err) {
      console.error('Update user status error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({ 
      success: true, 
      message: `User ${action === 'suspend' ? 'suspended' : 'activated'} successfully` 
    });
  });
});

module.exports = router;
