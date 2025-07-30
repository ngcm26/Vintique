// ========== STAFF ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection } = require('../config/database');

// Staff Dashboard
router.get('/staff/dashboard', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.redirect('/login');
  }
  
  // Get basic stats for dashboard
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM users WHERE role = 'user') as total_users,
      (SELECT COUNT(*) FROM listings WHERE status = 'active') as active_listings,
      (SELECT COUNT(*) FROM orders WHERE status = 'paid') as total_orders
  `;
  
  callbackConnection.query(statsQuery, (err, stats) => {
    if (err) {
      console.error('Dashboard stats error:', err);
      return res.status(500).send('Database error');
    }
    
    res.render('staff/dashboard', {
      layout: 'staff',
      activePage: 'dashboard',
      stats: stats[0] || { total_users: 0, active_listings: 0, total_orders: 0 }
    });
  });
});

// User Management
router.get('/staff/user_management', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
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
      layout: 'staff',
      activePage: 'user_management',
      users: users
    });
  });
});

// Staff Management
router.get('/staff/staff_management', (req, res) => {
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
      layout: 'staff',
      activePage: 'staff_management',
      staff: staff
    });
  });
});

// Q&A Management
router.get('/staff/qa', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
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
      layout: 'staff',
      activePage: 'qa',
      qaList: qaList
    });
  });
});

module.exports = router;
