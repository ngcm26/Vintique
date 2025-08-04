const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { requireAuth } = require('../middlewares/authMiddleware');

// GET /vouchers/center – User can see available vouchers (active, not expired)
router.get('/center', async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const today = new Date().toISOString().split('T')[0];
    const [vouchers] = await connection.execute(
      `SELECT v.* FROM vouchers v
       WHERE v.status = 'active' AND v.expiry_date >= ?
       ORDER BY v.expiry_date ASC`, [today]);
    
    // Render the page with activePage set for CSS loading & navbar highlight
    res.render('users/vouchers/center', {
      layout: 'user',
      title: 'Voucher Center',
      activePage: 'voucherCenter',
      vouchers,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('User voucher center error:', err);
    res.status(500).render('users/vouchers/center', {
      layout: 'user',
      title: 'Voucher Center',
      activePage: 'voucherCenter',
      vouchers: [],
      error: 'Failed to load vouchers.'
    });
  } finally {
    if (connection) await connection.end();
  }
});


// POST /vouchers/:id/claim – User claims a voucher (adds to user_vouchers)
router.post('/:id/claim', requireAuth, async (req, res) => {
  const userId = req.session.user.user_id || req.session.user.id;
  const voucherId = req.params.id;
  let connection;
  try {
    connection = await createConnection();
    // Check if already claimed
    const [existing] = await connection.execute(
      `SELECT * FROM user_vouchers WHERE user_id = ? AND voucher_id = ?`, [userId, voucherId]);
    if (existing.length > 0) {
      return res.redirect('/vouchers/center?error=You already claimed this voucher.');
    }
    // Insert claim
    await connection.execute(
      `INSERT INTO user_vouchers (user_id, voucher_id) VALUES (?, ?)`,
      [userId, voucherId]);
    res.redirect('/vouchers/center?success=Voucher claimed!');
  } catch (err) {
    console.error('Claim voucher error:', err);
    res.redirect('/vouchers/center?error=Failed to claim voucher.');
  } finally {
    if (connection) await connection.end();
  }
});

// GET /vouchers/my-vouchers – Show user's claimed vouchers
router.get('/my-vouchers', requireAuth, async (req, res) => {
  const userId = req.session.user.user_id || req.session.user.id;
  let connection;
  try {
    connection = await createConnection();
    const [userVouchers] = await connection.execute(
      `SELECT v.*, uv.used, uv.claimed_at 
         FROM user_vouchers uv
         JOIN vouchers v ON uv.voucher_id = v.voucher_id
        WHERE uv.user_id = ?
        ORDER BY uv.claimed_at DESC`, [userId]);
    res.render('users/vouchers/my_vouchers', {
      layout: 'user',
      title: 'My Vouchers',
      vouchers: userVouchers,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error('My vouchers error:', err);
    res.status(500).render('users/vouchers/my_vouchers', {
      layout: 'user',
      title: 'My Vouchers',
      activePage: 'myVouchers', 
      vouchers: [],
      error: 'Failed to load your vouchers.'
    });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = router;
