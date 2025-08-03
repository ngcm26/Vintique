// ========== FILE UPLOAD CONFIGURATION ==========
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', 'public/uploads');
const messagesUploadDir = path.join(__dirname, '..', 'public/uploads/messages');
const profilePhotoDir = path.join(__dirname, '..', 'public/uploads/profilephoto');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(messagesUploadDir)) {
  fs.mkdirSync(messagesUploadDir, { recursive: true });
}

if (!fs.existsSync(profilePhotoDir)) {
  fs.mkdirSync(profilePhotoDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // More specific route detection for messages
    const isMessageRoute = req.url.includes('/api/conversations/') && req.url.includes('/messages');
    const isAccountRoute = req.url.includes('account-settings');
    
    if (isMessageRoute) {
      console.log('📁 Uploading to messages directory');
      cb(null, messagesUploadDir);
    } else if (isAccountRoute) {
      console.log('📁 Uploading to profile photo directory');
      cb(null, profilePhotoDir);
    } else {
      console.log('📁 Uploading to default directory');
      cb(null, uploadsDir);
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    
    const isMessageRoute = req.url.includes('/api/conversations/') && req.url.includes('/messages');
    const isAccountRoute = req.url.includes('account-settings');
    
    if (isMessageRoute) {
      cb(null, 'msg_' + uniqueSuffix + extension);
    } else if (isAccountRoute) {
      cb(null, 'profile_' + uniqueSuffix + extension);
    } else {
      cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
    }
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

module.exports = {
  upload,
  uploadsDir,
  messagesUploadDir,
  profilePhotoDir
};