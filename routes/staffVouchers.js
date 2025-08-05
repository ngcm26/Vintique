const express = require('express');
const router = express.Router();
const { callbackConnection, createConnection } = require('../config/database');
const { requireAuth, requireStaff } = require('../middlewares/authMiddleware');

// GET /staff/vouchers – List all vouchers
router.get('/', requireStaff, async (req, res) => {
  let connection;
  try {
    connection = await createConnection();
    const [vouchers] = await connection.execute('SELECT * FROM vouchers ORDER BY created_at DESC');
    const today = new Date().toISOString().split('T')[0];

    // Active: status = active and not expired (counted in SQL, not JS)
    const [activeVouchers] = await connection.execute(
      `SELECT COUNT(*) as count FROM vouchers WHERE status = 'active' AND expiry_date >= ?`,
      [today]
    );
    const activeCount = activeVouchers[0].count;

    // Total Claims: count from user_vouchers table
    const [claims] = await connection.execute('SELECT COUNT(*) as total FROM user_vouchers');
    const totalClaims = claims[0].total;

    res.render('staff/vouchers/list', {
      layout: 'staff',
      title: 'Manage Vouchers',
      vouchers,
      totalClaims,
      activeCount,
      error: req.query.error
    });
  } catch (err) {
    console.error('Voucher list error:', err);
    res.status(500).render('staff/vouchers/list', {
      layout: 'staff',
      title: 'Manage Vouchers',
      vouchers: [],
      totalClaims: 0,
      activeCount: 0,
      error: 'Failed to load vouchers'
    });
  } finally {
    if (connection) await connection.end();
  }
});





// GET /staff/vouchers/new – Show create voucher form
router.get('/new', requireStaff, (req, res) => {
  res.render('staff/vouchers/new', {
    layout: 'staff',
    title: 'Create Voucher'
  });
});


// POST /staff/vouchers – Create new voucher
router.post('/', requireStaff, async (req, res) => {
  const { code, discount_type, discount_value, min_spend, expiry_date, usage_limit, status } = req.body;
  let connection;
  try {
    connection = await createConnection();
    await connection.execute(
      `INSERT INTO vouchers 
        (code, discount_type, discount_value, min_spend, expiry_date, usage_limit, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, discount_type, discount_value, min_spend || 0, expiry_date, usage_limit, status]
    );
    res.redirect('/staff/vouchers');
  } catch (err) {
    console.error('Create voucher error:', err);
    res.render('staff/vouchers/new', {
      layout: 'staff',
      title: 'Create Voucher',
      error: 'Failed to create voucher. Code must be unique.',
      formData: req.body
    });
  } finally {
    if (connection) await connection.end();
  }
});


// GET /staff/vouchers/:id/edit – Show edit voucher form
router.get('/:id/edit', requireStaff, async (req, res) => {
  const voucherId = req.params.id;
  let connection;
  try {
    connection = await createConnection();
    const [results] = await connection.execute('SELECT * FROM vouchers WHERE voucher_id = ?', [voucherId]);
    if (results.length === 0) {
      return res.status(404).render('staff/vouchers/list', {
        layout: 'staff',
        title: 'Manage Vouchers',
        vouchers: [],
        error: 'Voucher not found'
      });
    }
    res.render('staff/vouchers/edit', {
      layout: 'staff',
      title: 'Edit Voucher',
      voucher: results[0]
    });
  } catch (err) {
    console.error('Edit voucher form error:', err);
    res.status(500).send('Failed to load voucher for editing.');
  } finally {
    if (connection) await connection.end();
  }
});


// POST /staff/vouchers/:id – Update voucher in DB
router.post('/:id', requireStaff, async (req, res) => {
  const voucherId = req.params.id;
  const { code, discount_type, discount_value, min_spend, expiry_date, usage_limit, status } = req.body;
  let connection;
  try {
    connection = await createConnection();
    await connection.execute(
      `UPDATE vouchers 
       SET code=?, discount_type=?, discount_value=?, min_spend=?, expiry_date=?, usage_limit=?, status=? 
       WHERE voucher_id=?`,
      [code, discount_type, discount_value, min_spend || 0, expiry_date, usage_limit, status, voucherId]
    );
    res.redirect('/staff/vouchers');
  } catch (err) {
    console.error('Update voucher error:', err);
    // Reload edit page with error
    res.render('staff/vouchers/edit', {
      layout: 'staff',
      title: 'Edit Voucher',
      voucher: { ...req.body, voucher_id: voucherId },
      error: 'Failed to update voucher. Code must be unique.'
    });
  } finally {
    if (connection) await connection.end();
  }
});


// POST /staff/vouchers/:id/delete – Delete voucher
router.post('/:id/delete', requireStaff, async (req, res) => {
  const voucherId = req.params.id;
  let connection;
  try {
    connection = await createConnection();

    // 1. Delete all claims referencing this voucher
    await connection.execute('DELETE FROM user_vouchers WHERE voucher_id = ?', [voucherId]);

    // 2. Now it's safe to delete the voucher itself
    await connection.execute('DELETE FROM vouchers WHERE voucher_id = ?', [voucherId]);

    res.redirect('/staff/vouchers');
  } catch (err) {
    console.error('Delete voucher error:', err);
    res.status(500).send('Failed to delete voucher.');
  } finally {
    if (connection) await connection.end();
  }
});


module.exports = router;
