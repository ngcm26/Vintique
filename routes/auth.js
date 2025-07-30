const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { generateOTP, sendVerificationEmail } = require('../utils/helpers');

// Login route
router.get('/login', (req, res) => {
  res.render('users/login', {
    title: 'Login - Vintique',
    layout: 'user',
    activePage: 'login',
    message: req.query.message
  });
});

// Login handler
router.post('/login', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { email, password } = req.body;

    const [users] = await connection.execute(`
      SELECT 
        u.user_id,
        u.email,
        u.phone_number,
        u.password,
        u.role,
        u.status,
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

    if (user.status === 'suspended') {
      return res.render('users/login', {
        error: 'Your account has been suspended',
        layout: 'user',
        activePage: 'login'
      });
    }

    if (user.password !== password) {
      return res.render('users/login', {
        error: 'Invalid password',
        layout: 'user',
        activePage: 'login'
      });
    }

    req.session.user = {
      user_id: user.user_id,
      id: user.user_id,
      email: user.email,
      role: user.role,
      status: user.status,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username
    };

    if (user.role === 'admin') {
      res.redirect('/admin/dashboard');
    } else if (user.role === 'staff') {
      res.redirect('/staff/dashboard');
    } else {
      res.redirect('/');
    }

  } catch (error) {
    console.error('Login error:', error);
    res.render('users/login', {
      error: 'Login failed. Please try again.',
      layout: 'user',
      activePage: 'login'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Register route
router.get('/register', (req, res) => {
  res.render('register', { layout: 'user', activePage: 'register' });
});

// Registration handler
router.post('/register', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const { firstname, lastname, username, email, phone, password, confirmPassword } = req.body;

    // Validation
    if (!firstname || !lastname || !username || !email || !phone || !password || !confirmPassword) {
      return renderError('All fields are required.');
    }
    if (password !== confirmPassword) {
      return renderError('Passwords do not match.');
    }
    if (password.length < 6) {
      return renderError('Password must be at least 6 characters.');
    }
    if (username.length < 3) {
      return renderError('Username must be at least 3 characters.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return renderError('Invalid email format.');
    }

    const phoneRegex = /^[\d\-\+\(\)\s]+$/;
    const digitsOnly = phone.replace(/[^\d]/g, '');
    if (!phoneRegex.test(phone) || digitsOnly.length !== 8) {
      return renderError('Phone number must be 8 digits.');
    }

    // Check existing email/phone
    const [existingUsers] = await connection.execute(`
      SELECT email, phone_number FROM users WHERE email = ? OR phone_number = ?
    `, [email, phone]);

    if (existingUsers.length > 0) {
      let err = '';
      if (existingUsers.some(u => u.email === email)) err += 'Email already exists. ';
      if (existingUsers.some(u => u.phone_number === phone)) err += 'Phone number already exists.';
      return renderError(err.trim());
    }

    // Check existing username
    const [existingUsernames] = await connection.execute(`
      SELECT username FROM user_information WHERE username = ?
    `, [username]);

    if (existingUsernames.length > 0) {
      return renderError('Username already exists.');
    }

    // Transaction begin
    await connection.beginTransaction();

    // Insert into users
    const [userResult] = await connection.execute(
      'INSERT INTO users (email, phone_number, password, role, status, date_joined) VALUES (?, ?, ?, ?, ?, NOW())',
      [email, phone, password, 'user', 'active']
    );
    const userId = userResult.insertId;

    // Insert into user_information
    // Check if trigger already inserted a row
    const [existingInfo] = await connection.execute(
        'SELECT user_id FROM user_information WHERE user_id = ?',
        [userId]
    );
    
    if (existingInfo.length === 0) {
        await connection.execute(
        'INSERT INTO user_information (user_id, username, first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, username, firstname, lastname, email, phone]
        );
    } else {
        // Optionally, UPDATE fallback data created by the trigger
        await connection.execute(
        `UPDATE user_information SET 
            username = ?, 
            first_name = ?, 
            last_name = ?, 
            email = ?, 
            phone_number = ? 
        WHERE user_id = ?`,
        [username, firstname, lastname, email, phone, userId]
        );
    }  

    await connection.commit();
    return res.redirect('/login?message=Registration successful! Please log in.');

    function renderError(msg) {
      return res.render('register', {
        layout: 'user',
        activePage: 'register',
        error: msg,
        formData: req.body
      });
    }

  } catch (error) {
    console.error('Registration error:', error);
    if (connection) await connection.rollback();

    let err = 'Registration failed. ';
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.message.includes('email')) err = 'Email already exists.';
      else if (error.message.includes('phone_number')) err = 'Phone number already exists.';
      else if (error.message.includes('username')) err = 'Username already exists.';
      else err = 'Account already exists.';
    }

    return res.render('register', {
      layout: 'user',
      activePage: 'register',
      error: err,
      formData: req.body
    });
  } finally {
    if (connection) await connection.end();
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/');
  });
});

module.exports = router;
