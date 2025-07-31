// ========== DATABASE CONFIGURATION ==========
const mysql = require('mysql2/promise');
require('dotenv').config();

// Create database connection function for async/await
const createConnection = async () => {
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectTimeout: 60000
  };
  
  // Validate required environment variables
  const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file.`);
  }
  
  console.log('Attempting to connect to database with config:', {
    host: config.host,
    user: config.user,
    database: config.database,
    port: config.port,
    ssl: !!config.ssl
  });
  
  try {
    const connection = await mysql.createConnection(config);
    console.log('✅ Database connection successful');
    return connection;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
};

// MySQL connection for callback-based queries
const mysql_callback = require('mysql2');

// Validate required environment variables for callback connection
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}. Please check your .env file.`);
  process.exit(1);
}

const callbackConnection = mysql_callback.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectTimeout: 60000
});

callbackConnection.connect(err => {
  if (err) {
    console.error('❌ Error connecting to MySQL:', err);
    console.log('Continuing without database connection...');
  } else {
    console.log('✅ Connected to MySQL!');
  }
});

module.exports = {
  createConnection,
  callbackConnection
};
