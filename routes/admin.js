// ========== ADMIN ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');
const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '', //Add your own password here
  database: 'vintiquedb',
  port: 3306
};

router.get('/admin/dashboard', requireAdmin, async (req, res) => {
  const connection = await createConnection();

  // 1. User Stats
  const [userStats] = await connection.execute(`
    SELECT 
      COUNT(*) AS total_users,
      SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_users
    FROM users
    WHERE role = 'user'
  `);

  // 2. Listing Stats
  const [listingStats] = await connection.execute(`
    SELECT
      COUNT(*) AS total_listings,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_listings,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold_listings
    FROM listings
  `);

  // 3. Q&A Stats
  const [qaStats] = await connection.execute(`
    SELECT
      COUNT(*) AS total_questions,
      SUM(CASE WHEN answer_content IS NOT NULL AND answer_content <> '' THEN 1 ELSE 0 END) AS answered_questions
    FROM qa
  `);

  // 4. Recent Listings (with seller name)
  const [recentListings] = await connection.execute(`
    SELECT l.*, u.email, u.role, u.status, u.user_id, u.phone_number
    FROM listings l
    JOIN users u ON l.user_id = u.user_id
    ORDER BY l.created_at DESC
    LIMIT 5
  `);

  // 5. Recent Users
  const [recentUsers] = await connection.execute(`
    SELECT user_id, email, role, status, date_joined, phone_number
    FROM users
    WHERE role = 'user'
    ORDER BY date_joined DESC
    LIMIT 5
  `);

  // 6. Sales Over Time (chart, group by month)
  const [salesChart] = await connection.execute(`
    SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(total_amount) AS sales
    FROM orders
    WHERE status = 'Completed'
    GROUP BY month
    ORDER BY month DESC
    LIMIT 6
  `);

  // 7. Top Reported Users
  const [reportChart] = await connection.execute(`
    SELECT u.email, COUNT(*) AS reports
    FROM reports r
    JOIN users u ON r.reported_user_id = u.user_id
    WHERE r.reported_user_id IS NOT NULL
    GROUP BY r.reported_user_id
    ORDER BY reports DESC
    LIMIT 5
  `);


  console.log('SALES LABELS:', JSON.stringify(Array.isArray(salesChart) && salesChart.length ? salesChart.map(r => r.month).reverse() : []));
  console.log('SALES VALUES:', JSON.stringify(Array.isArray(salesChart) && salesChart.length ? salesChart.map(r => Number(r.sales)).reverse() : []));
  console.log('REPORT LABELS:', JSON.stringify(Array.isArray(reportChart) && reportChart.length ? reportChart.map(r => r.email) : []));
  console.log('REPORT VALUES:', JSON.stringify(Array.isArray(reportChart) && reportChart.length ? reportChart.map(r => Number(r.reports)) : []));

  res.render('staff/dashboard', {
    layout: 'admin',
    activePage: 'dashboard',
    user: req.session.user,
    stats: {
      users: userStats[0] || { total_users: 0, suspended_users: 0 },
      listings: listingStats[0] || { total_listings: 0, active_listings: 0, sold_listings: 0 },
      qa: qaStats[0] || { total_questions: 0, answered_questions: 0 }
    },
    recentListings,
    recentUsers,
    salesLabels: JSON.stringify(Array.isArray(salesChart) && salesChart.length ? salesChart.map(r => r.month).reverse() : []),
    salesValues: JSON.stringify(Array.isArray(salesChart) && salesChart.length ? salesChart.map(r => Number(r.sales)).reverse() : []),
    reportLabels: JSON.stringify(Array.isArray(reportChart) && reportChart.length ? reportChart.map(r => r.email) : []),
    reportValues: JSON.stringify(Array.isArray(reportChart) && reportChart.length ? reportChart.map(r => Number(r.reports)) : []),
  });

  await connection.end();
});

// Admin User Management
router.get('/admin/user_management', requireAdmin, (req, res) => {
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
    res.render('staff/user_management', { layout: 'admin', activePage: 'user_management', users });
  });
});

// Staff Management route
router.get('/admin/staff_management', requireAdmin, async (req, res) => {
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
      layout: 'admin', 
      activePage: 'staff_management',
      staffMembers,
      currentUser: req.session.user,
      isAdmin: req.session.user.role === 'admin',
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
      layout: 'admin', 
      activePage: 'staff_management',
      error: 'Error loading staff data',
      staffMembers: [],
      currentUser: req.session.user,
      isAdmin: req.session.user.role === 'admin'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Q&A Management - FIXED TO MATCH YOUR DATABASE SCHEMA
router.get('/admin/qa', requireAdmin, (req, res) => {
  // Use the same query structure as your staff routes for consistency
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
    ORDER BY q.asked_at DESC
  `;
  
  callbackConnection.query(qaQuery, (err, questions) => {
    if (err) {
      console.error('Q&A management error:', err);
      return res.render('staff/qa_management', {
        layout: 'admin',
        activePage: 'qa',
        error: 'Failed to load questions',
        questions: []
      });
    }

    if (questions.length === 0) {
      return res.render('staff/qa_management', {
        layout: 'admin',
        activePage: 'qa',
        questions: []
      });
    }

    // Get answers for all questions - INCLUDE answer_id!
    const questionIds = questions.map(q => q.qa_id);
    const answersQuery = `
      SELECT 
        answer_id,
        qa_id,
        answerer_id,
        answerer_username,
        u.email as answerer_email,
        answer_content,
        answered_at
      FROM qa_answers qa_ans
      LEFT JOIN users u ON qa_ans.answerer_id = u.user_id
      WHERE qa_id IN (${questionIds.map(() => '?').join(',')})
      ORDER BY answered_at ASC
    `;

    callbackConnection.query(answersQuery, questionIds, (err, answers) => {
      if (err) {
        console.error('Q&A answers error:', err);
        // Continue without answers rather than failing completely
        answers = [];
      }

      // Group answers by question ID
      const answersByQuestionId = {};
      answers.forEach(answer => {
        if (!answersByQuestionId[answer.qa_id]) {
          answersByQuestionId[answer.qa_id] = [];
        }
        answersByQuestionId[answer.qa_id].push(answer);
      });

      // Add answers to questions
      questions.forEach(question => {
        question.answers = answersByQuestionId[question.qa_id] || [];
      });

      res.render('staff/qa_management', {
        layout: 'admin',
        activePage: 'qa',
        questions: questions
      });
    });
  });
});

// Feedback Management
router.get('/admin/feedback_management', requireAdmin, (req, res) => {
  const feedbackQuery = `
    SELECT 
      feedbackID,
      fullName,
      email,
      subject,
      message,
      replied,
      createdAt as CreatedAt
    FROM feedback
    ORDER BY createdAt DESC
  `;

  callbackConnection.query(feedbackQuery, (err, feedbackList) => {
    if (err) {
      console.error('Feedback management error:', err);
      return res.render('staff/feedback_management', {
        layout: 'admin',
        activePage: 'feedback_management',
        error: 'Failed to load feedback',
        feedbackList: []
      });
    }

    res.render('staff/feedback_management', {
      layout: 'admin',
      activePage: 'feedback_management',
      feedbackList: feedbackList || []
    });
  });
});

// ========== FEEDBACK MANAGEMENT API ROUTES ==========

// Admin Feedback Reply
router.post('/admin/feedback_management/reply', requireAdmin, (req, res) => {
  const { feedbackId, email, subject, message } = req.body;
  const userID = req.session?.user?.user_id;

  if (!feedbackId || !message || !userID) {
    return res.status(400).json({ error: 'Missing feedback ID, message, or user ID' });
  }

  // Update the 'replied' column in the feedback table
  const updateQuery = `
    UPDATE feedback SET replied = 1 WHERE feedbackID = ?
  `;

  callbackConnection.query(updateQuery, [feedbackId], (updateErr, updateResult) => {
    if (updateErr) {
      console.error('Error updating replied column:', updateErr);
      return res.status(500).json({ error: 'Failed to update feedback replied status.' });
    }

    res.status(200).json({
      success: true,
      updated: updateResult.affectedRows
    });
  });
});

// Admin Feedback Get by ID
router.get('/admin/feedback_management/:id', requireAdmin, (req, res) => {
  const id = req.params.id;

  callbackConnection.query(
    'SELECT * FROM feedback WHERE feedbackID = ?',
    [id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.json(rows[0]);
    }
  );
});

// Admin Feedback Update
router.put('/admin/feedback_management/:id', requireAdmin, (req, res) => {
  const feedbackId = req.params.id;
  const { subject, message, replied } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }

  callbackConnection.query(
    'UPDATE feedback SET subject = ?, message = ?, replied = ? WHERE feedbackID = ?',
    [subject, message, replied || 0, feedbackId],
    (err, result) => {
      if (err) {
        console.error('Feedback update error:', err);
        return res.status(500).json({ error: 'Database error.' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Feedback not found.' });
      }
      res.json({ success: true });
    }
  );
});

// Admin Feedback Delete
router.delete('/admin/feedback_management/:id', requireAdmin, (req, res) => {
  const feedbackId = req.params.id;

  callbackConnection.query(
    'DELETE FROM feedback WHERE feedbackID = ?',
    [feedbackId],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }

      if (result.affectedRows === 1) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Feedback not found' });
      }
    }
  );
});

// ========== STAFF MANAGEMENT API ROUTES ==========

// Staff Management API endpoints
router.patch('/staff/:id', requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const staffId = req.params.id;
    const { email, phone, role, status } = req.body;
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
    
    // Validate status if provided
    if (status && !['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
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
    
    // Update users table only (staff/admin don't have user_information records)
    const updateUserSql = status 
      ? 'UPDATE users SET email = ?, phone_number = ?, role = ?, status = ? WHERE user_id = ?'
      : 'UPDATE users SET email = ?, phone_number = ?, role = ? WHERE user_id = ?';
    
    const userParams = status ? [email, phone, role, status, staffId] : [email, phone, role, staffId];
    await connection.execute(updateUserSql, userParams);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Staff update error:', error);
    res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) await connection.end();
  }
});

// Delete staff member
router.delete('/staff/:id', requireAdmin, async (req, res) => {
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
    
    // Delete staff member from users table only (staff/admin don't have user_information records)
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
router.patch('/staff/:id/status', requireAdmin, async (req, res) => {
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
    
    // Update users table only (staff/admin don't have user_information records)
    const updateUserSql = 'UPDATE users SET status = ? WHERE user_id = ? AND role IN ("staff", "admin")';
    const [userResult] = await connection.execute(updateUserSql, [status, staffId]);
    
    console.log('Status update result:', { 
      userAffectedRows: userResult.affectedRows, 
      staffId, 
      status 
    });
    
    if (userResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Staff/Admin member not found in users table.' });
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
router.post('/staff', requireAdmin, async (req, res) => {
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
    
    // Insert staff member into users table only (staff/admin don't need user_information records)
    const [result] = await connection.execute(
      'INSERT INTO users (email, phone_number, password, role, status) VALUES (?, ?, ?, ?, ?)',
      [email, phone, password, role, 'active']
    );
    
    const newStaffId = result.insertId;
    console.log('Created staff member with ID:', newStaffId);

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

// ========== USER MANAGEMENT API ROUTES ==========

// Admin User Management API endpoints
router.patch('/users/:id', requireAdmin, (req, res) => {
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
    callbackConnection.beginTransaction(err => {
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
router.delete('/users/:id', requireAdmin, (req, res) => {
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
router.patch('/users/:id/status', requireAdmin, (req, res) => {
  const userId = req.params.id;
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  
  // Update both user_information and users tables
  const updateInfoSql = 'UPDATE user_information SET status = ? WHERE user_id = ?';
  const updateUserSql = 'UPDATE users SET status = ? WHERE user_id = ?';
  
  callbackConnection.query(updateInfoSql, [status, userId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Database error updating user_information status.' });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found in user_information.' });
    
    // Update users table
    callbackConnection.query(updateUserSql, [status, userId], (err2, result2) => {
      if (err2) return res.status(500).json({ error: 'Database error updating users status.' });
      if (result2.affectedRows === 0) return res.status(404).json({ error: 'User not found in users table.' });
      res.json({ success: true });
    });
  });
});

// Toggle user suspend status (for frontend compatibility)
router.patch('/users/:id/ban', requireAdmin, (req, res) => {
  const userId = req.params.id;
  const { banned } = req.body;
  
  if (typeof banned !== 'boolean') {
    return res.status(400).json({ error: 'Banned field must be a boolean.' });
  }
  
  const newStatus = banned ? 'suspended' : 'active';
  const updateInfoSql = 'UPDATE user_information SET status = ? WHERE user_id = ?';
  const updateUserSql = 'UPDATE users SET status = ? WHERE user_id = ?';
  
  callbackConnection.query(updateInfoSql, [newStatus, userId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Database error updating user_information status.' });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found in user_information.' });
    
    // Update users table
    callbackConnection.query(updateUserSql, [newStatus, userId], (err2, result2) => {
      if (err2) return res.status(500).json({ error: 'Database error updating users status.' });
      if (result2.affectedRows === 0) return res.status(404).json({ error: 'User not found in users table.' });
      res.json({ success: true });
    });
  });
});



// Suspend/Unsuspend User (Admin only)
router.post('/admin/toggle_user_status', requireAdmin, (req, res) => {
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


// Admin Manage Vouchers
router.get('/admin/vouchers', requireAdmin, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [vouchers] = await connection.execute(`
      SELECT v.*, 
             COALESCE(COUNT(uv.voucher_id), 0) as used_count
      FROM vouchers v
      LEFT JOIN user_vouchers uv ON v.voucher_id = uv.voucher_id
      GROUP BY v.voucher_id
      ORDER BY v.created_at DESC
    `);
    const today = new Date().toISOString().split('T')[0];

    // Active: status = active and not expired (counted in SQL, not JS)
    const [activeVouchers] = await connection.execute(
      `SELECT COUNT(*) as count FROM vouchers WHERE status = 'active' AND expiry_date >= ?`,
      [today]
    );
    const activeCount = activeVouchers[0].count;

    // Total Claims: count from user_vouchers table
    const [claims] = await connection.execute('SELECT COUNT(*) as total FROM user_vouchers');
    const totalClaims = claims[0].total;

    res.render('staff/vouchers/list', {
      layout: 'admin',
      activePage: 'voucher_management',
      vouchers,
      totalClaims,
      activeCount,
      error: req.query.error
    });
  } catch (error) {
    console.error('Vouchers list error:', error);
    res.render('staff/vouchers/list', {
      layout: 'admin',
      activePage: 'voucher_management',
      vouchers: [],
      totalClaims: 0,
      activeCount: 0,
      error: 'Failed to load vouchers'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Admin Create Voucher Form
router.get('/admin/vouchers/new', requireAdmin, (req, res) => {
  res.render('staff/vouchers/new', {
    layout: 'admin',
    title: 'Create Voucher'
  });
});

// Admin Create Voucher
router.post('/admin/vouchers', requireAdmin, async (req, res) => {
  const { code, discount_type, discount_value, min_spend, expiry_date, usage_limit, status } = req.body;
  let connection;
  try {
    connection = await createConnection();
    await connection.execute(
      `INSERT INTO vouchers 
        (code, discount_type, discount_value, min_spend, expiry_date, usage_limit, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, discount_type, discount_value, min_spend || 0, expiry_date, usage_limit, status]
    );
    res.redirect('/admin/vouchers');
  } catch (err) {
    console.error('Create voucher error:', err);
    res.render('staff/vouchers/new', {
      layout: 'admin',
      title: 'Create Voucher',
      error: 'Failed to create voucher. Code must be unique.',
      formData: req.body
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Admin Edit Voucher Form
router.get('/admin/vouchers/:id/edit', requireAdmin, async (req, res) => {
  const voucherId = req.params.id;
  let connection;
  try {
    connection = await createConnection();
    const [results] = await connection.execute('SELECT * FROM vouchers WHERE voucher_id = ?', [voucherId]);
    if (results.length === 0) {
      return res.status(404).render('staff/vouchers/list', {
        layout: 'admin',
        title: 'Manage Vouchers',
        vouchers: [],
        error: 'Voucher not found'
      });
    }
    res.render('staff/vouchers/edit', {
      layout: 'admin',
      title: 'Edit Voucher',
      voucher: results[0]
    });
  } catch (err) {
    console.error('Edit voucher form error:', err);
    res.status(500).send('Failed to load voucher for editing.');
  } finally {
    if (connection) await connection.end();
  }
});

// Admin Update Voucher
router.post('/admin/vouchers/:id', requireAdmin, async (req, res) => {
  const voucherId = req.params.id;
  const { code, discount_type, discount_value, min_spend, expiry_date, usage_limit, status } = req.body;
  let connection;
  try {
    connection = await createConnection();
    await connection.execute(
      `UPDATE vouchers 
       SET code=?, discount_type=?, discount_value=?, min_spend=?, expiry_date=?, usage_limit=?, status=? 
       WHERE voucher_id=?`,
      [code, discount_type, discount_value, min_spend || 0, expiry_date, usage_limit, status, voucherId]
    );
    res.redirect('/admin/vouchers');
  } catch (err) {
    console.error('Update voucher error:', err);
    res.render('staff/vouchers/edit', {
      layout: 'admin',
      title: 'Edit Voucher',
      voucher: { ...req.body, voucher_id: voucherId },
      error: 'Failed to update voucher. Code must be unique.'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Admin Delete Voucher
router.post('/admin/vouchers/:id/delete', requireAdmin, async (req, res) => {
  const voucherId = req.params.id;
  let connection;
  try {
    connection = await createConnection();

    // 1. Delete all claims referencing this voucher
    await connection.execute('DELETE FROM user_vouchers WHERE voucher_id = ?', [voucherId]);

    // 2. Now it's safe to delete the voucher itself
    await connection.execute('DELETE FROM vouchers WHERE voucher_id = ?', [voucherId]);

    res.redirect('/admin/vouchers');
  } catch (err) {
    console.error('Delete voucher error:', err);
    res.status(500).send('Failed to delete voucher.');
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;