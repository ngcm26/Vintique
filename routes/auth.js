const express = require('express');
const router = express.Router();
const { createConnection } = require('../config/database');
const { generateOTP, generateResetToken, sendVerificationEmail, sendPasswordResetEmail } = require('../utils/helpers');

// ======= LOGIN =======
router.get('/login', (req, res) => {
  const { message, verified, email, error } = req.query;
  
  // Clear session if there's a message (likely from password reset redirect)
  // This ensures the non-logged-in navbar is displayed
  if (message) {
    req.session.destroy(err => {
      if (err) console.error('Session clear error:', err);
    });
  }
  
  // If user just verified their email, pre-fill the email field
  const formData = verified && email ? { email } : {};
  
  res.render('users/login', {
    title: 'Login - Vintique',
    layout: 'user',
    activePage: 'login',
    message,
    error,
    formData
  });
});

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
        ui.username,
        ui.verified,
        COALESCE(ui.status, u.status) as status
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.email = ?
    `, [email]);

    if (users.length === 0) {
      return renderError('User not found');
    }

    const user = users[0];

    if (user.status === 'suspended') {
      return renderError('Your account has been suspended. Please contact support for assistance.');
    }

    if (user.password !== password) {
      return renderError('Invalid password');
    }

    if (user.verified === 0) {
      // Redirect to verification page for unverified users
      return res.redirect(`/verify?email=${encodeURIComponent(email)}&message=Please verify your email to continue.`);
    }

    req.session.user = {
      user_id: user.user_id,
      id: user.user_id,
      email: user.email,
      role: user.role,
      status: user.status, // This now uses the COALESCE result
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

    function renderError(msg) {
      return res.render('users/login', {
        layout: 'user',
        activePage: 'login',
        error: msg
      });
    }

  } catch (error) {
    console.error('Login error:', error);
    res.render('users/login', {
      layout: 'user',
      activePage: 'login',
      error: 'Login failed. Please try again.'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ======= REGISTER =======
router.get('/register', (req, res) => {
  res.render('register', { layout: 'user', activePage: 'register' });
});

router.post('/register', async (req, res) => {
  let connection;
  const { firstname, lastname, username, email, phone, password, confirmPassword } = req.body;

  try {
    connection = await createConnection();

    // Validation
    if (!firstname || !lastname || !username || !email || !phone || !password || !confirmPassword)
      return renderError('All fields are required.');
    if (password !== confirmPassword)
      return renderError('Passwords do not match.');
    if (password.length < 6)
      return renderError('Password must be at least 6 characters.');
    if (username.length < 3)
      return renderError('Username must be at least 3 characters.');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email))
      return renderError('Invalid email format.');

    const phoneRegex = /^[\d\-\+\(\)\s]+$/;
    const digitsOnly = phone.replace(/[^\d]/g, '');
    if (!phoneRegex.test(phone) || digitsOnly.length !== 8)
      return renderError('Phone number must be 8 digits.');

    // Check duplicates
    const [existingUsers] = await connection.execute(
      `SELECT email, phone_number FROM users WHERE email = ? OR phone_number = ?`,
      [email, phone]
    );
    if (existingUsers.length > 0) {
      let err = '';
      if (existingUsers.some(u => u.email === email)) err += 'Email already exists. ';
      if (existingUsers.some(u => u.phone_number === phone)) err += 'Phone number already exists.';
      return renderError(err.trim());
    }

    const [existingUsernames] = await connection.execute(
      `SELECT username FROM user_information WHERE username = ?`,
      [username]
    );
    if (existingUsernames.length > 0)
      return renderError('Username already exists.');

    // Begin transaction
    await connection.beginTransaction();

    // Insert into users
    const [userResult] = await connection.execute(
      `INSERT INTO users (email, phone_number, password, role, status, date_joined) VALUES (?, ?, ?, ?, ?, NOW())`,
      [email, phone, password, 'user', 'active']
    );
    const userId = userResult.insertId;

    // Insert or update user_information
    const [existingInfo] = await connection.execute(
      'SELECT user_id FROM user_information WHERE user_id = ?',
      [userId]
    );
    if (existingInfo.length === 0) {
      await connection.execute(
        'INSERT INTO user_information (user_id, username, first_name, last_name, email, phone_number, verified) VALUES (?, ?, ?, ?, ?, ?, 0)',
        [userId, username, firstname, lastname, email, phone]
      );
    } else {
      await connection.execute(
        `UPDATE user_information SET 
          username = ?, first_name = ?, last_name = ?, email = ?, phone_number = ?, verified = 0
        WHERE user_id = ?`,
        [username, firstname, lastname, email, phone, userId]
      );
    }

    // Generate and store OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await connection.execute(
      `INSERT INTO email_verification (user_id, email, otp, expires_at) VALUES (?, ?, ?, ?)`,
      [userId, email, otp, expiresAt]
    );

    // Send email
    const emailSent = await sendVerificationEmail(email, otp, username);
    if (!emailSent) throw new Error('Failed to send verification email');

    await connection.commit();
    return res.redirect(`/verify?email=${encodeURIComponent(email)}`);

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

    let err = 'Registration failed.';
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.message.includes('email')) err = 'Email already exists.';
      else if (error.message.includes('phone_number')) err = 'Phone number already exists.';
      else if (error.message.includes('username')) err = 'Username already exists.';
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

// ======= LOGOUT =======
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Logout error:', err);
    res.redirect('/');
  });
});

// ======= VERIFY EMAIL OTP =======
router.get('/verify', (req, res) => {
  const { email, message } = req.query;
  
  // If no email provided, redirect to login
  if (!email) {
    return res.redirect('/login?message=Please log in to verify your email.');
  }
  
  res.render('users/email_verification', {
    layout: 'user',
    title: 'Verify Email - Vintique',
    email,
    message
  });
});

router.post('/verify', async (req, res) => {
  let connection;
  const { email, otp } = req.body;

  console.log('🔍 Verification attempt:', { email, otp });

  try {
    connection = await createConnection();

    const [rows] = await connection.execute(`
      SELECT ev.user_id, ev.expires_at
      FROM email_verification ev
      WHERE ev.email = ? AND ev.otp = ?
      ORDER BY ev.created_at DESC
      LIMIT 1
    `, [email, otp]);

    console.log('🔍 Database query result:', { rowsFound: rows.length, user_id: rows[0]?.user_id });

    if (rows.length === 0) {
      console.log('❌ No OTP found for email/OTP combination');
      return res.render('users/email_verification', {
        layout: 'user',
        title: 'Verify Email - Vintique',
        email,
        message: '❌ Invalid OTP. Please try again.'
      });
    }

    const { user_id, expires_at } = rows[0];
    const now = new Date();
    console.log('🔍 OTP expiration check:', { 
      expires_at, 
      now: now.toISOString(), 
      isExpired: now > new Date(expires_at) 
    });
    
    if (now > new Date(expires_at)) {
      console.log('⏰ OTP expired');
      return res.render('users/email_verification', {
        layout: 'user',
        title: 'Verify Email - Vintique',
        email,
        message: '⏰ OTP expired. Please re-register or contact support.'
      });
    }

    console.log('✅ OTP valid, updating user verification status');
    
    await connection.execute(`
      UPDATE user_information SET verified = 1 WHERE user_id = ?
    `, [user_id]);

    await connection.execute(`
      DELETE FROM email_verification WHERE user_id = ?
    `, [user_id]);

    console.log('✅ Email verification completed successfully');
    return res.redirect(`/login?message=✅ Email verified. You may now log in.&verified=true&email=${encodeURIComponent(email)}`);

  } catch (error) {
    console.error('OTP verification error:', error);
    return res.render('users/email_verification', {
      layout: 'user',
      title: 'Verify Email - Vintique',
      email,
      message: '⚠️ Verification failed due to a server error.'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ======= RESEND VERIFICATION EMAIL =======
router.post('/resend-verification', async (req, res) => {
  let connection;
  const { email } = req.body;

  console.log('🔄 Resend verification attempt for:', email);

  try {
    connection = await createConnection();

    // Check if user exists and is not verified
    const [users] = await connection.execute(`
      SELECT u.user_id, ui.username, ui.verified
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.email = ?
    `, [email]);

    if (users.length === 0) {
      return res.json({ success: false, error: 'User not found' });
    }

    const user = users[0];
    
    if (user.verified === 1) {
      return res.json({ success: false, error: 'Email is already verified' });
    }

    // Delete any existing OTPs for this user
    await connection.execute(`
      DELETE FROM email_verification WHERE user_id = ?
    `, [user.user_id]);

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    // Insert new OTP
    await connection.execute(`
      INSERT INTO email_verification (user_id, email, otp, expires_at) VALUES (?, ?, ?, ?)
    `, [user.user_id, email, otp, expiresAt]);

    // Send new verification email
    const emailSent = await sendVerificationEmail(email, otp, user.username);
    if (!emailSent) {
      throw new Error('Failed to send verification email');
    }

    console.log('✅ Resend verification email sent successfully');
    return res.json({ success: true, message: 'Verification code sent successfully!' });

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    return res.json({ 
      success: false, 
      error: 'Failed to send verification code. Please try again.' 
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ======= FORGOT PASSWORD =======
router.get('/forgot-password', (req, res) => {
  res.render('users/forgot_password', {
    layout: 'user',
    title: 'Forgot Password - Vintique',
    activePage: 'forgot-password'
  });
});

router.post('/forgot-password', async (req, res) => {
  let connection;
  const { email } = req.body;

  console.log('🔐 Forgot password request for:', email);

  try {
    connection = await createConnection();

    // Check if user exists and get their role
    const [users] = await connection.execute(`
      SELECT u.user_id, u.role, ui.username, ui.first_name
      FROM users u
      LEFT JOIN user_information ui ON u.user_id = ui.user_id
      WHERE u.email = ?
    `, [email]);

    if (users.length === 0) {
      // Don't reveal if email exists or not for security
      return res.render('users/forgot_password', {
        layout: 'user',
        title: 'Forgot Password - Vintique',
        activePage: 'forgot-password',
        success: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    const user = users[0];

    // Prevent staff and admin from using user password reset
    if (user.role === 'staff' || user.role === 'admin') {
      console.log('❌ Staff/Admin attempted to use user password reset:', email);
      return res.render('users/forgot_password', {
        layout: 'user',
        title: 'Forgot Password - Vintique',
        activePage: 'forgot-password',
        error: 'Password reset for staff accounts must be initiated by an administrator. Please contact your administrator.'
      });
    }

    // Delete any existing reset tokens for this user
    await connection.execute(`
      DELETE FROM password_reset_tokens WHERE user_id = ?
    `, [user.user_id]);

    // Generate new reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Insert new reset token
    await connection.execute(`
      INSERT INTO password_reset_tokens (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)
    `, [user.user_id, email, resetToken, expiresAt]);

    // Send password reset email
    const emailSent = await sendPasswordResetEmail(email, resetToken, user.first_name || user.username || email.split('@')[0]);
    if (!emailSent) {
      throw new Error('Failed to send password reset email');
    }

    console.log('✅ Password reset email sent successfully');
    return res.render('users/forgot_password', {
      layout: 'user',
      title: 'Forgot Password - Vintique',
      activePage: 'forgot-password',
      success: 'If an account with that email exists, a password reset link has been sent.'
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error);
    return res.render('users/forgot_password', {
      layout: 'user',
      title: 'Forgot Password - Vintique',
      activePage: 'forgot-password',
      error: 'Failed to process password reset request. Please try again.'
    });
  } finally {
    if (connection) await connection.end();
  }
});

// ======= RESET PASSWORD =======
router.get('/reset-password/:token', async (req, res) => {
  let connection;
  const { token } = req.params;

  try {
    connection = await createConnection();

    // Check if token exists and is valid
    const [tokens] = await connection.execute(`
      SELECT prt.user_id, prt.email, prt.expires_at, prt.used, ui.first_name
      FROM password_reset_tokens prt
      LEFT JOIN user_information ui ON prt.user_id = ui.user_id
      WHERE prt.token = ?
    `, [token]);

    if (tokens.length === 0) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Invalid or expired reset link.',
        showForm: false
      });
    }

    const resetToken = tokens[0];
    const now = new Date();

    if (now > new Date(resetToken.expires_at)) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Reset link has expired. Please request a new one.',
        showForm: false
      });
    }

    if (resetToken.used) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'This reset link has already been used.',
        showForm: false
      });
    }

    return res.render('users/reset_password', {
      layout: 'user',
      title: 'Reset Password - Vintique',
      token,
      email: resetToken.email,
      showForm: true
    });

  } catch (error) {
    console.error('❌ Reset password token validation error:', error);
    return res.render('users/reset_password', {
      layout: 'user',
      title: 'Reset Password - Vintique',
      error: 'An error occurred while validating the reset link.'
    });
  } finally {
    if (connection) await connection.end();
  }
});

router.post('/reset-password', async (req, res) => {
  let connection;
  const { token, password, confirmPassword } = req.body;

  try {
    connection = await createConnection();

    // Validate passwords
    if (!password || !confirmPassword) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Both password fields are required.',
        token,
        showForm: true
      });
    }

    if (password !== confirmPassword) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Passwords do not match.',
        token,
        showForm: true
      });
    }

    if (password.length < 6) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Password must be at least 6 characters long.',
        token,
        showForm: true
      });
    }

    // Check if token exists and is valid
    const [tokens] = await connection.execute(`
      SELECT prt.user_id, prt.email, prt.expires_at, prt.used, u.password as current_password
      FROM password_reset_tokens prt
      LEFT JOIN users u ON prt.user_id = u.user_id
      WHERE prt.token = ?
    `, [token]);

    if (tokens.length === 0) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Invalid or expired reset link.',
        token,
        showForm: false
      });
    }

    const resetToken = tokens[0];
    const now = new Date();

    if (now > new Date(resetToken.expires_at)) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'Reset link has expired. Please request a new one.',
        token,
        showForm: false
      });
    }

    if (resetToken.used) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'This reset link has already been used.',
        token,
        showForm: false
      });
    }

    // Check if new password is the same as current password
    if (password === resetToken.current_password) {
      return res.render('users/reset_password', {
        layout: 'user',
        title: 'Reset Password - Vintique',
        error: 'New password cannot be the same as your current password. Please enter a different password.',
        token,
        email: resetToken.email,
        showForm: true
      });
    }

    // Update password
    await connection.execute(`
      UPDATE users SET password = ? WHERE user_id = ?
    `, [password, resetToken.user_id]);

    // Mark token as used
    await connection.execute(`
      UPDATE password_reset_tokens SET used = TRUE WHERE token = ?
    `, [token]);

    console.log('✅ Password reset completed successfully');
    return res.redirect('/login?message=✅ Password reset successful. You can now log in with your new password.');

  } catch (error) {
    console.error('❌ Reset password error:', error);
    return res.render('users/reset_password', {
      layout: 'user',
      title: 'Reset Password - Vintique',
      error: 'Failed to reset password. Please try again.',
      token,
      showForm: false
    });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;
