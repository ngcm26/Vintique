// ========== AUTHENTICATION MIDDLEWARE ==========
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  // Check if user account is suspended
  if (req.session.user.status === 'suspended') {
    req.session.destroy();
    return res.redirect('/login?error=Your account has been suspended. Please contact support for assistance.');
  }
  
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session.user || (req.session.user.role !== 'staff' && req.session.user.role !== 'admin')) {
    return res.redirect('/login');
  }
  
  // Check if user account is suspended
  if (req.session.user.status === 'suspended') {
    req.session.destroy();
    return res.redirect('/login?error=Your account has been suspended. Please contact support for assistance.');
  }
  
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  
  // Check if user account is suspended
  if (req.session.user.status === 'suspended') {
    req.session.destroy();
    return res.redirect('/login?error=Your account has been suspended. Please contact support for assistance.');
  }
  
  next();
};


module.exports = {
  requireAuth,
  requireStaff,
  requireAdmin
};