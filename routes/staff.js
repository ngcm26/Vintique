// ========== STAFF ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');
const mysql = require('mysql2/promise');

// Staff Dashboard
router.get('/staff/dashboard', requireStaff, (req, res) => {
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

// User Management - accessible to both staff and admin
router.get('/staff/user_management', requireStaff, (req, res) => {
  const usersQuery = `
    SELECT u.user_id, u.email, u.role, u.status, u.date_joined,
           ui.first_name, ui.last_name, ui.username, ui.phone_number
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.role = 'user'
    ORDER BY u.date_joined DESC
  `;
  
  callbackConnection.query(usersQuery, (err, users) => {
    if (err) {
      console.error('User management error:', err);
      return res.status(500).send('Database error');
    }
    
    // Transform the data to match the template expectations
    const transformedUsers = users.map(user => ({
      ...user,
      phone: user.phone_number || 'N/A',
      isBanned: user.status === 'suspended',
      created_at: user.date_joined // Add alias for consistency
    }));
    
    res.render('staff/user_management', {
      layout: 'staff',
      activePage: 'user_management',
      users: transformedUsers
    });
  });
});

// Staff Management - accessible to both staff and admin, but with different permissions
router.get('/staff/staff_management', requireStaff, (req, res) => {
  const staffQuery = `
    SELECT u.user_id, u.email, u.role, u.status, u.date_joined,
           ui.first_name, ui.last_name, ui.username, ui.phone_number
    FROM users u
    LEFT JOIN user_information ui ON u.user_id = ui.user_id
    WHERE u.role IN ('staff', 'admin')
    ORDER BY u.date_joined DESC
  `;
  
  callbackConnection.query(staffQuery, (err, staff) => {
    if (err) {
      console.error('Staff management error:', err);
      return res.status(500).send('Database error');
    }
    
    // Transform the data to include created_at alias
    const transformedStaff = staff.map(member => ({
      ...member,
      created_at: member.date_joined // Add alias for consistency
    }));
    
    res.render('staff/staff_management', {
      layout: 'staff',
      activePage: 'staff_management',
      staffMembers: transformedStaff,
      currentUser: req.session.user,
      isAdmin: req.session.user.role === 'admin'
    });
  });
});

// Q&A Management - accessible to both staff and admin
router.get('/staff/qa', requireStaff, (req, res) => {
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
    ORDER BY q.asked_at DESC
  `;
  
  callbackConnection.query(qaQuery, (err, questions) => {
    if (err) {
      console.error('Q&A management error:', err);
      return res.render('staff/qa_management', {
        layout: 'staff',
        activePage: 'qa',
        error: 'Failed to load questions',
        questions: []
      });
    }

    if (questions.length === 0) {
      return res.render('staff/qa_management', {
        layout: 'staff',
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
        layout: 'staff',
        activePage: 'qa',
        questions: questions
      });
    });
  });
});

// ========== Q&A API ROUTES FOR STAFF ==========

// Get pending count for badge
router.get('/api/qa/pending-count', requireStaff, (req, res) => {
  const query = 'SELECT COUNT(*) as pending_count FROM qa WHERE is_verified = 0';
  
  callbackConnection.query(query, (err, result) => {
    if (err) {
      console.error('Error getting pending count:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ pending_count: result[0].pending_count });
  });
});

// Search/filter questions for staff - FIXED VERSION WITH ANSWER_ID
router.get('/api/staff/qa/search', requireStaff, (req, res) => {
  const { search, status } = req.query;
  let whereConditions = [];
  let params = [];

  if (search) {
    whereConditions.push('(q.question_text LIKE ? OR q.details LIKE ? OR q.category LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (status === 'pending') {
    whereConditions.push('q.is_verified = 0');
  } else if (status === 'verified') {
    whereConditions.push('q.is_verified = 1');
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

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
    ${whereClause}
    ORDER BY q.asked_at DESC
  `;

  callbackConnection.query(qaQuery, params, (err, questions) => {
    if (err) {
      console.error('Search Q&A error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (questions.length === 0) {
      return res.json([]);
    }

    // Get answers for filtered questions - INCLUDE answer_id!
    const questionIds = questions.map(q => q.qa_id);
    const answersQuery = `
      SELECT 
        answer_id,
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
        console.error('Search Q&A answers error:', err);
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

      res.json(questions);
    });
  });
});

// Submit answer to question (staff)
router.post('/api/qa/:qaId/answer', requireStaff, (req, res) => {
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
      console.error('Error submitting staff answer:', err);
      return res.status(500).json({ error: 'Failed to submit answer' });
    }

    res.json({ 
      success: true, 
      message: 'Answer submitted successfully',
      answer_id: result.insertId
    });
  });
});

// NEW: Delete individual answer
router.delete('/api/qa/answers/:answerId', requireStaff, (req, res) => {
  const answerId = req.params.answerId;

  console.log(`Staff ${req.session.user.email} attempting to delete answer ${answerId}`);

  // First, check if the answer exists
  const checkAnswerQuery = 'SELECT answer_id, qa_id FROM qa_answers WHERE answer_id = ?';
  
  callbackConnection.query(checkAnswerQuery, [answerId], (err, answers) => {
    if (err) {
      console.error('Error checking answer existence:', err);
      return res.status(500).json({ error: 'Database error while checking answer' });
    }

    if (answers.length === 0) {
      console.log(`Answer ${answerId} not found`);
      return res.status(404).json({ error: 'Answer not found' });
    }

    const answer = answers[0];
    const qaId = answer.qa_id;

    // Delete the answer
    const deleteAnswerQuery = 'DELETE FROM qa_answers WHERE answer_id = ?';
    
    callbackConnection.query(deleteAnswerQuery, [answerId], (err, result) => {
      if (err) {
        console.error('Error deleting answer:', err);
        return res.status(500).json({ error: 'Failed to delete answer' });
      }

      if (result.affectedRows === 0) {
        console.log(`No rows affected when deleting answer ${answerId}`);
        return res.status(404).json({ error: 'Answer not found or already deleted' });
      }

      console.log(`Answer ${answerId} deleted successfully by staff ${req.session.user.email}`);

      res.json({ 
        success: true, 
        message: 'Answer deleted successfully',
        answer_id: answerId,
        qa_id: qaId
      });
    });
  });
});

// Verify question (make it visible to public)
router.patch('/api/qa/:qaId/verify', requireStaff, (req, res) => {
  const qaId = req.params.qaId;
  const updateQuery = 'UPDATE qa SET is_verified = 1 WHERE qa_id = ?';

  callbackConnection.query(updateQuery, [qaId], (err, result) => {
    if (err) {
      console.error('Error verifying question:', err);
      return res.status(500).json({ error: 'Failed to verify question' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ 
      success: true, 
      message: 'Question verified and published successfully' 
    });
  });
});

// Delete question
router.delete('/api/qa/:qaId', requireStaff, (req, res) => {
  const qaId = req.params.qaId;

  // Start transaction to delete question and related data
  callbackConnection.beginTransaction((err) => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Delete answers first (foreign key constraint)
    const deleteAnswersQuery = 'DELETE FROM qa_answers WHERE qa_id = ?';
    callbackConnection.query(deleteAnswersQuery, [qaId], (err) => {
      if (err) {
        return callbackConnection.rollback(() => {
          console.error('Error deleting answers:', err);
          res.status(500).json({ error: 'Failed to delete question answers' });
        });
      }

      // Delete votes
      const deleteVotesQuery = 'DELETE FROM qa_votes WHERE qa_id = ?';
      callbackConnection.query(deleteVotesQuery, [qaId], (err) => {
        if (err) {
          return callbackConnection.rollback(() => {
            console.error('Error deleting votes:', err);
            res.status(500).json({ error: 'Failed to delete question votes' });
          });
        }

        // Finally delete the question
        const deleteQuestionQuery = 'DELETE FROM qa WHERE qa_id = ?';
        callbackConnection.query(deleteQuestionQuery, [qaId], (err, result) => {
          if (err) {
            return callbackConnection.rollback(() => {
              console.error('Error deleting question:', err);
              res.status(500).json({ error: 'Failed to delete question' });
            });
          }

          if (result.affectedRows === 0) {
            return callbackConnection.rollback(() => {
              res.status(404).json({ error: 'Question not found' });
            });
          }

          callbackConnection.commit((err) => {
            if (err) {
              return callbackConnection.rollback(() => {
                console.error('Commit error:', err);
                res.status(500).json({ error: 'Failed to delete question' });
              });
            }

            res.json({ 
              success: true, 
              message: 'Question deleted successfully' 
            });
          });
        });
      });
    });
  });
});

// Staff Feedback Management
router.get('/staff/feedback_management', requireStaff, (req, res) => {
  callbackConnection.query(`
    SELECT feedbackID, fullName, email, subject, message, createdAt, replied
    FROM feedback 
    ORDER BY createdAt DESC
  `, (error, feedbacks) => {
    if (error) {
      console.error('Error fetching feedback:', error);
      return res.render('staff/feedback_management', {
        layout: 'staff',
        activePage: 'feedback_management',
        error: 'Failed to load feedback.',
        feedbackList: []
      });
    }

    const formattedFeedback = feedbacks.map(item => {
      const createdAt = new Date(item.createdAt);
      const now = new Date();
      const diffTime = now - createdAt;
      const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return {
        id: item.feedbackID,
        name: item.fullName,
        email: item.email,
        subject: item.subject,
        message: item.message,
        replied: item.replied,
        CreatedAt: daysAgo === 0 ? 'Today' : `${daysAgo} day(s) ago`
      };
    });

    res.render('staff/feedback_management', {
      layout: 'staff',
      activePage: 'feedback_management',
      feedbackList: formattedFeedback
    });
  });
});

router.delete('/feedback/:id', requireStaff, (req, res) => {
  const feedbackId = req.params.id;

  callbackConnection.query(
    'DELETE FROM feedback WHERE feedbackID = ?',
    [feedbackId],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Server error');
      }

      if (result.affectedRows === 1) {
        res.sendStatus(200);
      } else {
        res.status(404).send('Feedback not found');
      }
    }
  );
});

router.get('/staff/feedback_management/:id', requireStaff, (req, res) => {
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

router.patch('/feedback/:id', requireStaff, (req, res) => {
  const feedbackId = req.params.id;
  const { subject, message, replied } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }

  callbackConnection.query(
    'UPDATE feedback SET subject = ?, message = ?, replied = ? WHERE feedbackID = ?',
    [subject, message, replied || null, feedbackId],
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

router.post('/feedback/reply', requireStaff, (req, res) => {
  const { feedbackID, message } = req.body;
  const userID = req.session?.user?.user_id;

  if (!feedbackID || !message || !userID) {
    return res.status(400).json({ error: 'Missing feedback ID, message, or user ID' });
  }

  const insertQuery = `
    INSERT INTO feedback_reply (message, feedbackID, userID)
    VALUES (?, ?, ?)
  `;

  callbackConnection.query(insertQuery, [message, feedbackID, userID], (err, result) => {
    if (err) {
      console.error('Error saving reply:', err);
      return res.status(500).json({ error: 'Database error saving reply' });
    }

    // Now update the 'replied' column in the feedback table
    const updateQuery = `
      UPDATE feedback SET replied = ? WHERE feedbackID = ?
    `;

    callbackConnection.query(updateQuery, [message, feedbackID], (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error updating replied column:', updateErr);
        return res.status(500).json({ error: 'Failed to update feedback replied status.' });
      }

      res.status(200).json({
        success: true,
        replyID: result.insertId,
        updated: updateResult.affectedRows
      });
    });
  });
});

// ========== STAFF MANAGEMENT API ROUTES ==========

// Create new staff member
router.post('/staff', requireAdmin, (req, res) => {
  const { email, role, phone, password } = req.body;

  if (!email || !role || !phone || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (!['staff', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Check if email already exists
  const checkEmailQuery = 'SELECT user_id FROM users WHERE email = ?';
  callbackConnection.query(checkEmailQuery, [email], (err, existingUsers) => {
    if (err) {
      console.error('Error checking email:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Create user
    const createUserQuery = 'INSERT INTO users (email, password, role, status) VALUES (?, ?, ?, ?)';
    callbackConnection.query(createUserQuery, [email, password, role, 'active'], (err, result) => {
      if (err) {
        console.error('Error creating user:', err);
        return res.status(500).json({ error: 'Failed to create user' });
      }

      const userId = result.insertId;

      // Create user information
      const createUserInfoQuery = 'INSERT INTO user_information (user_id, phone_number) VALUES (?, ?)';
      callbackConnection.query(createUserInfoQuery, [userId, phone], (err) => {
        if (err) {
          console.error('Error creating user info:', err);
          return res.status(500).json({ error: 'Failed to create user information' });
        }

        res.json({ success: true, message: 'Staff member created successfully' });
      });
    });
  });
});

// Update staff member
router.patch('/staff/:staffId', requireAdmin, (req, res) => {
  const staffId = req.params.staffId;
  const { email, phone, role } = req.body;

  if (!email || !phone || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (!['staff', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Update user
  const updateUserQuery = 'UPDATE users SET email = ?, role = ? WHERE user_id = ?';
  callbackConnection.query(updateUserQuery, [email, role, staffId], (err, result) => {
    if (err) {
      console.error('Error updating user:', err);
      return res.status(500).json({ error: 'Failed to update user' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Update user information
    const updateUserInfoQuery = 'UPDATE user_information SET phone_number = ? WHERE user_id = ?';
    callbackConnection.query(updateUserInfoQuery, [phone, staffId], (err) => {
      if (err) {
        console.error('Error updating user info:', err);
        return res.status(500).json({ error: 'Failed to update user information' });
      }

      res.json({ success: true, message: 'Staff member updated successfully' });
    });
  });
});

// Toggle staff status
router.patch('/staff/:staffId/status', requireAdmin, (req, res) => {
  const staffId = req.params.staffId;
  const { status } = req.body;

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updateQuery = 'UPDATE users SET status = ? WHERE user_id = ?';
  callbackConnection.query(updateQuery, [status, staffId], (err, result) => {
    if (err) {
      console.error('Error updating status:', err);
      return res.status(500).json({ error: 'Failed to update status' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    res.json({ success: true, message: `Staff member ${status === 'active' ? 'activated' : 'suspended'} successfully` });
  });
});

// Delete staff member
router.delete('/staff/:staffId', requireAdmin, (req, res) => {
  const staffId = req.params.staffId;

  // Check if trying to delete self
  if (parseInt(staffId) === req.session.user.user_id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  const deleteQuery = 'DELETE FROM users WHERE user_id = ?';
  callbackConnection.query(deleteQuery, [staffId], (err, result) => {
    if (err) {
      console.error('Error deleting staff member:', err);
      return res.status(500).json({ error: 'Failed to delete staff member' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    res.json({ success: true, message: 'Staff member deleted successfully' });
  });
});

// ========== USER MANAGEMENT API ROUTES ==========

// Toggle user ban status
router.patch('/users/:userId/ban', requireStaff, (req, res) => {
  const userId = req.params.userId;
  const { banned } = req.body;

  const newStatus = banned ? 'suspended' : 'active';
  const updateQuery = 'UPDATE users SET status = ? WHERE user_id = ? AND role = "user"';
  
  callbackConnection.query(updateQuery, [newStatus, userId], (err, result) => {
    if (err) {
      console.error('Error updating user status:', err);
      return res.status(500).json({ error: 'Failed to update user status' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      message: `User ${banned ? 'suspended' : 'activated'} successfully` 
    });
  });
});

// Update user information
router.patch('/users/:userId', requireStaff, (req, res) => {
  const userId = req.params.userId;
  const { username, email, phone } = req.body;

  if (!username || !email) {
    return res.status(400).json({ error: 'Username and email are required' });
  }

  // Update user information
  const updateUserInfoQuery = 'UPDATE user_information SET username = ?, phone_number = ? WHERE user_id = ?';
  callbackConnection.query(updateUserInfoQuery, [username, phone || null, userId], (err) => {
    if (err) {
      console.error('Error updating user info:', err);
      return res.status(500).json({ error: 'Failed to update user information' });
    }

    // Update user email
    const updateUserQuery = 'UPDATE users SET email = ? WHERE user_id = ? AND role = "user"';
    callbackConnection.query(updateUserQuery, [email, userId], (err, result) => {
      if (err) {
        console.error('Error updating user:', err);
        return res.status(500).json({ error: 'Failed to update user' });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true, message: 'User updated successfully' });
    });
  });
});

// Delete user
router.delete('/users/:userId', requireStaff, (req, res) => {
  const userId = req.params.userId;

  const deleteQuery = 'DELETE FROM users WHERE user_id = ? AND role = "user"';
  callbackConnection.query(deleteQuery, [userId], (err, result) => {
    if (err) {
      console.error('Error deleting user:', err);
      return res.status(500).json({ error: 'Failed to delete user' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted successfully' });
  });
});

module.exports = router;



// Chatbot dashboard
router.get('/staff/dashboard-intents', async (req, res) => {
  const conn = await mysql.createConnection(dbConfig);

  const [topIntents] = await conn.execute(`
    SELECT intent, COUNT(*) AS count
    FROM chatbotmessages
    WHERE intent IS NOT NULL
    GROUP BY intent
    ORDER BY count DESC
    LIMIT 5;
  `);

  await conn.end();
  res.json(topIntents); // or pass to Handlebars view
});


//Daily intent count for chatbot dashboard section
router.get('/staff/dashboard-intents-daily', async (req, res) => {
  const conn = await mysql.createConnection(dbConfig);

  const [rows] = await conn.execute(`
    SELECT DATE(createdAt) AS date, intent, COUNT(*) AS count
    FROM chatbotmessages
    WHERE intent IS NOT NULL AND intent != 'openai'
    GROUP BY DATE(createdAt), intent
    ORDER BY DATE(createdAt)
  `);

  await conn.end();

  // Transform data into { [intent]: { dates: [], counts: [] } }
  const intentMap = {};
  const allDatesSet = new Set();

  rows.forEach(({ date, intent, count }) => {
    allDatesSet.add(date);
    if (!intentMap[intent]) {
      intentMap[intent] = {};
    }
    intentMap[intent][date] = count;
  });

  const allDates = Array.from(allDatesSet).sort();

  const datasets = Object.keys(intentMap).map(intent => {
    const data = allDates.map(date => intentMap[intent][date] || 0);
    return {
      label: intent,
      data: data,
      fill: false,
      borderWidth: 2
    };
  });

  res.json({ labels: allDates, datasets });
});
