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
app.use(express.urlencoded({ extended: true })); // ✅ For form POSTs
app.use(express.static('public'));

// ✅ Make user data available in all templates
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

// Users route
app.get('/users', requireStaff, (req, res) => {
  const sql = 'SELECT * FROM users';
  connection.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('staff/user_management', { layout: 'staff', users: results });
  });
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

  // Check for unique username, email, and phone number in user_information
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

// Fixed login handler
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Join with user_information to get username
  const sql = `
    SELECT u.user_id, u.email, u.role, ui.username 
    FROM users u 
    LEFT JOIN user_information ui ON u.user_id = ui.user_id 
    WHERE u.email = ? AND u.password = ?
  `;
  
  connection.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('DB error');
    }

    if (results.length > 0) {
      req.session.user = {
        id: results[0].user_id,  // Fixed: use user_id instead of id
        username: results[0].username,
        role: results[0].role
      };
      
      if (results[0].role === 'staff') {
        res.redirect('/users');
      } else {
        res.redirect('/');
      }
    } else {
      res.render('login', { layout: 'user', activePage: 'login', error: 'Invalid email or password.' });
    }
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  const sql = 'SELECT * FROM users WHERE email = ? AND password = ?';
  connection.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('DB error');
    }

    if (results.length > 0) {
      req.session.user = {
        id: results[0].id,
        username: results[0].username,
        role: results[0].role
      };
      if (results[0].role === 'staff') {
        res.redirect('/users');
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

app.engine('handlebars', exphbs.engine({
  defaultLayout: 'user',
  helpers: {
    ifCond: function (v1, operator, v2, options) {
      switch (operator) {
        case '==':
          return (v1 == v2) ? options.fn(this) : options.inverse(this);
        default:
          return options.inverse(this);
      }
    },
    eq: function(a, b) { return a === b; }
  }
}));


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
