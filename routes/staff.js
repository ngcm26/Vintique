// ========== STAFF ROUTES ==========
const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database'); // Add createConnection import
const { requireAuth, requireStaff, requireAdmin } = require('../middlewares/authMiddleware');

// ... rest of your existing code stays exactly the same ...

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

// Q&A Management - COMPLETELY FIXED VERSION
router.get('/staff/qa', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.redirect('/login');
  }
  
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

    // Get answers for all questions
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
router.get('/api/qa/pending-count', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const query = 'SELECT COUNT(*) as pending_count FROM qa WHERE is_verified = 0';
  
  callbackConnection.query(query, (err, result) => {
    if (err) {
      console.error('Error getting pending count:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json({ pending_count: result[0].pending_count });
  });
});

// Search/filter questions for staff
router.get('/api/staff/qa/search', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    // Get answers for filtered questions
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
router.post('/api/qa/:qaId/answer', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
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

// Verify question (make it visible to public)
router.patch('/api/qa/:qaId/verify', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
router.delete('/api/qa/:qaId', (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

module.exports = router;



// --------------- Staff Feedback -------------------------
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
      const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // ms to days

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
        res.sendStatus(200); // success
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



router.patch('/feedback/:id', (req, res) => {
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



router.post('/feedback/reply', (req, res) => {
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