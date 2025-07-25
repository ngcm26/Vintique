const express = require('express');
const app = express();
require('dotenv').config();
const mysql = require('mysql2');
const exphbs = require('express-handlebars');
const session = require('express-session');

app.set('view engine', 'handlebars');

app.use(session({
  secret: process.env.SESSION_SECRET || 'vintique_secret_key',
  resave: false,
  saveUninitialized: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Make user data available in all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Staff-only middleware
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'staff') {
    return res.status(403).send('Access denied. Staff only.');
  }
  next();
}

// MySQL connection
const connection = mysql.createConnection({
  host: 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

connection.connect(err => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    process.exit(1);
  }
  console.log('Connected to MySQL!');
});

// Home route
app.get('/', (req, res) => {
  if (req.session.user && req.session.user.role === 'staff') {
    res.render('staff/dashboard', { layout: 'staff' });
  } else {
    res.render('users/home', { activePage: 'home' });
  }
});

// Staff User Management route - FIXED QUERY
app.get('/staff/user_management', requireStaff, (req, res) => {
  const sql = `SELECT u.user_id, ui.username, u.email, u.phone_number as phone, 
               COALESCE(ui.status, 'active') as status, u.role
               FROM users u
               LEFT JOIN user_information ui ON u.user_id = ui.user_id
               WHERE u.role = 'user'`;
  
  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }
    
    // Map DB status to isBanned for template
    const users = results.map(u => ({
      ...u,
      isBanned: u.status === 'suspended'
    }));
    
    console.log('Users data:', users); // Debug log
    res.render('staff/user_management', { layout: 'staff', users });
  });
});

// Legacy users route (keeping for compatibility)
app.get('/users', requireStaff, (req, res) => {
  res.redirect('/staff/user_management');
});

// Staff Management route
app.get('/staff/staff_management', requireStaff, (req, res) => {
  res.render('staff/staff_management', { layout: 'staff' });
});

// Login
app.get('/login', (req, res) => {
  res.render('login', { layout: 'user', activePage: 'login' });
});

// Register
app.get('/register', (req, res) => {
  res.render('register', { layout: 'user', activePage: 'register' });
});

// Registration handler
app.post('/register', (req, res) => {
  const { firstname, lastname, username, email, phone, password, confirmPassword } = req.body;

  // Basic validation
  if (!firstname || !lastname || !username || !email || !phone || !password || !confirmPassword) {
    return res.render('register', { layout: 'user', activePage: 'register', error: 'All fields are required.' });
  }
  if (password !== confirmPassword) {
    return res.render('register', { layout: 'user', activePage: 'register', error: 'Passwords do not match.' });
  }

  // Check for unique username, email, and phone number
  const checkSql = 'SELECT * FROM user_information WHERE username = ? OR email = ? OR phone_number = ?';
  connection.query(checkSql, [username, email, phone], (err, results) => {
    if (err) {
      console.error('Check unique error:', err);
      return res.status(500).send('Database error');
    }
    if (results.length > 0) {
      let errorMsg = '';
      if (results.some(u => u.username === username)) errorMsg += 'Username already exists. ';
      if (results.some(u => u.email === email)) errorMsg += 'Email already exists. ';
      if (results.some(u => u.phone_number === phone)) errorMsg += 'Phone number already exists. ';
      return res.render('register', { layout: 'user', activePage: 'register', error: errorMsg.trim() });
    }

    // Start transaction
    connection.beginTransaction(err => {
      if (err) {
        console.error('Transaction start error:', err);
        return res.status(500).send('Database error');
      }
      
      // Insert into users table
      const insertUserSql = 'INSERT INTO users (email, phone_number, password, role) VALUES (?, ?, ?, ?)';
      connection.query(insertUserSql, [email, phone, password, 'user'], (err, userResult) => {
        if (err) {
          connection.rollback(() => {});
          if (err.code === 'ER_DUP_ENTRY') {
            return res.render('register', { layout: 'user', activePage: 'register', error: 'Email or phone number already exists.' });
          }
          console.error('Insert users error:', err);
          return res.status(500).send('Database error');
        }
        
        const userId = userResult.insertId;
        
        // Update the user_information record created by the trigger
        const updateInfoSql = 'UPDATE user_information SET username = ?, first_name = ?, last_name = ?, email = ?, phone_number = ? WHERE user_id = ?';
        connection.query(updateInfoSql, [username, firstname, lastname, email, phone, userId], (err, infoResult) => {
          if (err) {
            connection.rollback(() => {});
            console.error('Update user_information error:', err);
            return res.status(500).send('Database error');
          }
          
          connection.commit(err => {
            if (err) {
              connection.rollback(() => {});
              console.error('Transaction commit error:', err);
              return res.status(500).send('Database error');
            }
            
            console.log('Registration successful for user:', username);
            res.redirect('/login');
          });
        });
      });
    });
  });
});

// FIXED Login handler (removed duplicate)
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Join with user_information to get username and status
  const sql = `
    SELECT u.user_id, u.email, u.role, ui.username, COALESCE(ui.status, 'active') as status
    FROM users u 
    LEFT JOIN user_information ui ON u.user_id = ui.user_id 
    WHERE u.email = ? AND u.password = ?
  `;
  
  connection.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).send('Database error');
    }

    if (results.length > 0) {
      const user = results[0];
      
      // Check if user is suspended
      if (user.status === 'suspended') {
        return res.render('login', { 
          layout: 'user', 
          activePage: 'login', 
          error: 'Your account has been suspended. Please contact support.' 
        });
      }

      req.session.user = {
        id: user.user_id,
        username: user.username,
        role: user.role
      };
      
      if (user.role === 'staff') {
        res.redirect('/');
      } else {
        res.redirect('/');
      }
    } else {
      res.render('login', { layout: 'user', activePage: 'login', error: 'Invalid email or password.' });
    }
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// --- STAFF USER MANAGEMENT API ENDPOINTS ---

// Edit user (username, email, phone, status) - Fixed
app.patch('/users/:id', requireStaff, (req, res) => {
  const userId = req.params.id;
  const { username, email, phone, status } = req.body;

  // Basic validation
  if (!username || !email || !phone || !status) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  // Check for duplicate username/email/phone across both tables
  const checkSql = `
    SELECT u.user_id 
    FROM vintiquedb.users u
    LEFT JOIN vintiquedb.user_information ui ON u.user_id = ui.user_id
    WHERE (ui.username = ? OR u.email = ? OR u.phone_number = ?) 
      AND u.user_id != ?
  `;

  connection.query(checkSql, [username, email, phone, userId], (err, results) => {
    if (err) {
      console.error('Check duplicate error:', err);
      return res.status(500).json({ error: 'Database error during validation.' });
    }

    if (results.length > 0) {
      return res.status(400).json({ error: 'Username, email, or phone number already exists.' });
    }

    // Begin transaction
    connection.beginTransaction(err => {
      if (err) {
        console.error('Transaction start error:', err);
        return res.status(500).json({ error: 'Database transaction error.' });
      }

      const updateUsers = `
        UPDATE vintiquedb.users 
        SET email = ?, phone_number = ? 
        WHERE user_id = ?
      `;

      connection.query(updateUsers, [email, phone, userId], err => {
        if (err) {
          console.error('Update users error:', err);
          return connection.rollback(() => res.status(500).json({ error: 'Error updating users table.' }));
        }

        const updateInfo = `
          UPDATE vintiquedb.user_information
          SET username = ?, email = ?, phone_number = ?, status = ?
          WHERE user_id = ?
        `;

        connection.query(updateInfo, [username, email, phone, status, userId], err => {
          if (err) {
            console.error('Update user_information error:', err);
            return connection.rollback(() => res.status(500).json({ error: 'Error updating user_information table.' }));
          }

          connection.commit(err => {
            if (err) {
              console.error('Transaction commit error:', err);
              return connection.rollback(() => res.status(500).json({ error: 'Transaction commit error.' }));
            }
            res.json({ success: true });
          });
        });
      });
    });
  });
});


// Delete user
app.delete('/users/:id', requireStaff, (req, res) => {
  const userId = req.params.id;
  
  // Make sure we're not deleting a staff user
  const checkRoleSql = 'SELECT role FROM users WHERE user_id = ?';
  connection.query(checkRoleSql, [userId], (err, results) => {
    if (err) {
      console.error('Check role error:', err);
      return res.status(500).json({ error: 'Database error.' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    if (results[0].role === 'staff') {
      return res.status(403).json({ error: 'Cannot delete staff users.' });
    }

    const deleteSql = 'DELETE FROM users WHERE user_id = ?';
    connection.query(deleteSql, [userId], (err, result) => {
      if (err) {
        console.error('Delete user error:', err);
        return res.status(500).json({ error: 'Database error during deletion.' });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }
      
      res.json({ success: true });
    });
  });
});

// Change user status (active/suspended)
app.patch('/users/:id/status', requireStaff, (req, res) => {
  const userId = req.params.id;
  const { status } = req.body;
  
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be "active" or "suspended".' });
  }

  const updateStatusSql = 'UPDATE user_information SET status = ? WHERE user_id = ?';
  connection.query(updateStatusSql, [status, userId], (err, result) => {
    if (err) {
      console.error('Update status error:', err);
      return res.status(500).json({ error: 'Database error updating status.' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    res.json({ success: true });
  });
});

// Configure Handlebars
app.engine('handlebars', exphbs.engine({
  defaultLayout: 'user',
  helpers: {
    ifCond: function (v1, operator, v2, options) {
      switch (operator) {
        case '==':
          return (v1 == v2) ? options.fn(this) : options.inverse(this);
        case '!=':
          return (v1 != v2) ? options.fn(this) : options.inverse(this);
        default:
          return options.inverse(this);
      }
    },
    eq: function(a, b) { return a === b; }
  }
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));