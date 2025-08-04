# Password Reset Feature Setup Guide

## Overview
This implementation adds a secure password reset functionality to your Vintique application using email links with secure tokens.

## Database Setup

### 1. Run the SQL Script
Execute the following SQL script in your database to create the password reset tokens table:

```sql
-- Password Reset Tokens Table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_user_id (user_id),
  INDEX idx_email (email),
  INDEX idx_expires_at (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### 2. Environment Variables
Make sure you have the following environment variables set in your `.env` file:

```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
BASE_URL=http://localhost:3000
```

## Features Implemented

### 1. Forgot Password Flow
- **Route**: `GET /forgot-password` - Shows the forgot password form
- **Route**: `POST /forgot-password` - Processes the email and sends reset link
- **Security**: Doesn't reveal if email exists or not
- **Token Expiration**: 1 hour

### 2. Password Reset Flow
- **Route**: `GET /reset-password/:token` - Validates token and shows reset form
- **Route**: `POST /reset-password` - Updates password and marks token as used
- **Security**: One-time use tokens, expiration check, password validation

### 3. Email Integration
- Uses existing email infrastructure
- Beautiful HTML email template
- Secure reset links with tokens

### 4. UI Components
- Forgot password page with form
- Reset password page with validation
- "Forgot Password" link added to login page
- Responsive design matching your existing style

## Security Features

1. **Secure Token Generation**: Uses crypto.randomBytes(32) for secure tokens
2. **Token Expiration**: Tokens expire after 1 hour
3. **One-Time Use**: Tokens are marked as used after password reset
4. **Email Validation**: Only sends reset emails to existing users
5. **Password Requirements**: Minimum 6 characters, confirmation required
6. **No Information Disclosure**: Doesn't reveal if email exists
7. **Current Password Check**: Prevents users from setting new password to same as current password

## Testing the Feature

1. **Start your server**
2. **Go to login page** - You should see "Forgot your password?" link
3. **Click the link** - Should take you to forgot password form
4. **Enter an email** - Should send reset email (if email exists)
5. **Check email** - Should receive reset link
6. **Click link** - Should take you to reset password form
7. **Enter new password** - Should update password and redirect to login

## Files Created/Modified

### New Files:
- `password_reset_setup.sql` - Database setup script
- `views/users/forgot_password.handlebars` - Forgot password page
- `views/users/reset_password.handlebars` - Reset password page
- `public/assets/css/users/forgot_password.css` - Forgot password styles
- `public/assets/css/users/reset_password.css` - Reset password styles

### Modified Files:
- `utils/helpers.js` - Added password reset functions
- `routes/auth.js` - Added password reset routes
- `views/users/login.handlebars` - Added forgot password link

## Troubleshooting

### Common Issues:

1. **Email not sending**: Check your EMAIL_USER and EMAIL_PASS environment variables
2. **Database errors**: Make sure the password_reset_tokens table was created
3. **Token not working**: Check if BASE_URL is set correctly in your .env file
4. **Styling issues**: Make sure the CSS files are accessible via `/assets/css/users/`

### Debug Steps:
1. Check server logs for any errors
2. Verify database table exists: `DESCRIBE password_reset_tokens;`
3. Test email configuration manually
4. Check browser console for any JavaScript errors

## Security Notes

- Tokens are cryptographically secure (32 bytes random)
- Tokens expire after 1 hour
- Tokens are single-use only
- No sensitive information is logged
- Email addresses are validated before processing
- Password requirements are enforced on both client and server side 