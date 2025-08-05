// ========== STAFF ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');
const mysql = require('mysql2/promise');
const app = express();
app.use(express.json()); // ← Add this to parse JSON requests
app.use(express.urlencoded({ extended: true }));


router.get('/staff/dashboard', requireStaff, async (req, res) => {
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
    WHERE status = 'paid'
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
    layout: 'staff',
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

// Staff User Management route
router.get('/staff/user_management', requireStaff, (req, res) => {
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
    res.render('staff/user_management', { layout: 'staff', activePage: 'user_management', users });
  });
});

// Legacy users route
router.get('/users', requireStaff, (req, res) => {
  res.redirect('/staff/user_management');
});

// Q&A Management - FIXED VERSION FOR YOUR DATABASE STRUCTURE
router.get('/staff/qa', requireStaff, (req, res) => {
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

// Search/filter questions for staff - FIXED VERSION FOR YOUR DATABASE STRUCTURE
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
    INSERT INTO qa_answers (qa_id, answerer_id, answerer_username, answer_content, answered_at)
    VALUES (?, ?, ?, ?, NOW())
  `;

  const values = [
    qaId,
    req.session.user.id,
    req.session.user.username || req.session.user.email.split('@')[0],
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
    SELECT feedbackID, fullName, email, subject, message, createdAt, replied, archived
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
        replied: Boolean(item.replied),
        archived: item.archived,
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


router.patch('/feedback/archive/:id', requireStaff, (req, res) => {
  const feedbackId = req.params.id;
  const { archived } = req.body;

  if (typeof archived !== 'number' && typeof archived !== 'string') {
    return res.status(400).json({ error: 'Invalid archived value' });
  }

  callbackConnection.query(
    'UPDATE feedback SET archived = ? WHERE feedbackID = ?',
    [archived, feedbackId],
    (err, result) => {
      if (err) {
        console.error('Error archiving feedback:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      res.json({ success: true });
    }
  );
});


// Staff Manage Vouchers
router.get('/staff/vouchers/list', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [vouchers] = await connection.execute('SELECT * FROM vouchers ORDER BY created_at DESC');
    res.render('staff/vouchers/list', {
      layout: 'staff',
      activePage: 'voucher_management',
      vouchers,
      error: req.query.error
    });
  } catch (error) {
    console.error('Vouchers list error:', error);
    res.render('staff/vouchers/list', {
      layout: 'staff',
      activePage: 'voucher_management',
      vouchers: [],
      error: 'Failed to load vouchers'
    });
  } finally {
    if (connection) await connection.end();
  }
});


// ========== USER MANAGEMENT API ROUTES ==========

// Staff User Management API endpoints
router.patch('/users/:id', requireStaff, (req, res) => {
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
router.delete('/users/:id', requireStaff, (req, res) => {
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
router.patch('/users/:id/status', requireStaff, (req, res) => {
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
router.patch('/users/:id/ban', requireStaff, (req, res) => {
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

router.get('/profile/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    // 1. Get user info
    const [user] = await connection.query(`
      SELECT username, profile_image_url FROM user_information WHERE user_id = ?
    `, [userId]);

    // 2. Get reviews written by this user
    const [reviews] = await connection.query(`
      SELECT 
        r.reviewID,
        r.rating,
        r.reviewText,
        r.createdAt,
        l.title AS listingTitle,
        l.listing_id
      FROM reviews r
      JOIN listings l ON r.listingID = l.listing_id
      WHERE r.userID = ?
      ORDER BY r.createdAt DESC
    `, [userId]);

    // Optional: Format the dates
    const now = new Date();
    reviews.forEach(review => {
      const createdAt = new Date(review.createdAt);
      const daysAgo = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
      review.timeAgo = daysAgo === 0 ? 'Today' : `${daysAgo} day(s) ago`;
    });

    res.render('user/profile', {
      user: user[0],
      reviews
    });

  } catch (err) {
    console.error('Error fetching profile data:', err);
    res.status(500).send('Server error');
  }
});

// Staff Password Reset Route
router.post('/staff/:staffId/reset-password', requireAdmin, async (req, res) => {
  let connection;
  try {
    const { staffId } = req.params;
    
    connection = await createConnection();
    
    // Get staff member details
    const [staffMembers] = await connection.execute(`
      SELECT u.user_id, u.email, ui.first_name, ui.username
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.user_id = ? AND u.role IN ('staff', 'admin')
    `, [staffId]);
    
    if (staffMembers.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    
    const staffMember = staffMembers[0];
    
    // Clear any existing reset tokens for this user
    await connection.execute(`
      DELETE FROM password_reset_tokens WHERE user_id = ?
    `, [staffMember.user_id]);
    
    // Generate new reset token
    const { generateResetToken, sendPasswordResetEmail } = require('../utils/helpers');
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    // Insert new reset token
    await connection.execute(`
      INSERT INTO password_reset_tokens (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)
    `, [staffMember.user_id, staffMember.email, resetToken, expiresAt]);
    
    // Send password reset email
    const emailSent = await sendPasswordResetEmail(
      staffMember.email, 
      resetToken, 
      staffMember.first_name || staffMember.username || staffMember.email.split('@')[0]
    );
    
    if (!emailSent) {
      throw new Error('Failed to send password reset email');
    }
    
    console.log('✅ Staff password reset email sent successfully to:', staffMember.email);
    res.json({ success: true, message: 'Password reset email sent successfully' });
    
  } catch (error) {
    console.error('❌ Staff password reset error:', error);
    res.status(500).json({ error: 'Failed to send password reset email' });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;