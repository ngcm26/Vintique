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
  res.render('home');
});

// Users route
app.get('/users', (req, res) => {
  const sql = 'SELECT * FROM users';
  connection.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }
    res.render('users', { users: results });
  });
});

// Login
app.get('/login', (req, res) => {
  res.render('login');
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
      res.redirect('/');
    } else {
      res.send('Invalid credentials');
    }
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.engine('handlebars', exphbs.engine({
  helpers: {
    ifCond: function (v1, operator, v2, options) {
      switch (operator) {
        case '==':
          return (v1 == v2) ? options.fn(this) : options.inverse(this);
        default:
          return options.inverse(this);
      }
    }
  }
}));


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
