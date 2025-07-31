// ========== STAFF ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection } = require('../config/database');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');



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



// --------------- Staff Feedback -------------------------
router.get('/staff/feedback_management', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();

    const [feedbacks] = await connection.execute(`
      SELECT feedbackID, fullName, email, subject, message, createdAt, replied
      FROM feedback 
      ORDER BY createdAt DESC
    `);
    ///const [stats] = await connection.execute(`SELECT SUM(CASE WHEN replied != NULL) as totalReplied,SUM(*) as totalFeedback`);

  
    const formattedFeedback = feedbacks.map(item => {
      const createdAt = new Date(item.createdAt);
      const now = new Date();
      const diffTime = now - createdAt;
      const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // convert ms to days

      return {
        id: item.feedbackID,
        name: item.fullName,
        email: item.email,
        subject: item.subject,
        message: item.message,
        CreatedAt: daysAgo === 0 ? 'Today' : `${daysAgo} day(s) ago`
      };
    });
    res.render('staff/feedback_management', {
      layout: 'staff',
      activePage: 'feedback_management',
      feedbackList: formattedFeedback
    });



  } catch (err) {
    console.error('Error fetching feedback:', err);
    res.render('staff/feedback_management', {
      layout: 'staff',
      activePage: 'feedback_management',
      error: 'Failed to load feedback.',
      feedbackList: []
    });
  } finally {
    if (connection) await connection.end();
  }
});

router.delete('/feedback/:id', requireStaff, async (req, res) => {
  const feedbackId = req.params.id;
  let connection;
  try {
    connection = await createConnection();
    const [result] = await connection.execute(
      'DELETE FROM feedback WHERE feedbackID = ?',
      [feedbackId]
    );

    if (result.affectedRows === 1) {
      res.sendStatus(200); // success
    } else {
      res.status(404).send('Feedback not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  } finally {
    if (connection) await connection.end();
  }
});



router.get('/staff/feedback_management/:id', requireStaff, async (req, res) => {
  const id = req.params.id;
  let connection;
  try {
    connection = await createConnection();
    const [rows] = await connection.execute('SELECT * FROM feedback WHERE feedbackID = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    if (connection) await connection.end();
}
});



router.patch('/feedback/:id', async (req, res) => {
  const feedbackId = req.params.id;
  const { subject, message, replied } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }

  let connection;
  try {
    connection = await createConnection(); // or use your existing connection method

    const [result] = await connection.execute(
      'UPDATE feedback SET subject = ?, message = ?, replied = ? WHERE feedbackID = ?',
      [subject, message, replied || null, feedbackId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Feedback not found.' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Feedback update error:', error);
    res.status(500).json({ error: 'Database error.' });
  } finally {
    if (connection) await connection.end();
  }
});