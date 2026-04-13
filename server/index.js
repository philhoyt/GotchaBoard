const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const STORAGE_DIR = process.env.GOTCHA_STORAGE || path.join(__dirname, '..', 'storage');

const upload = multer({
  dest: path.join(STORAGE_DIR, 'temp'),
  limits: { fileSize: 50 * 1024 * 1024 },
});

require('./db'); // runs migrations on import

const imagesRouter           = require('./routes/images');
const tagsRouter             = require('./routes/tags');
const bulkRouter             = require('./routes/bulk');
const smartCollectionsRouter = require('./routes/smartCollections');
const discoverRouter         = require('./routes/discover');
const transferRouter         = require('./routes/transfer');
const importPinterestRouter  = require('./routes/importPinterest');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

app.use('/images', express.static(path.join(STORAGE_DIR, 'images')));
app.use('/thumbs', express.static(path.join(STORAGE_DIR, 'thumbs')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/images/upload', upload.single('image'), (req, res, next) => imagesRouter.handleUpload(req, res, next));
app.use('/api/images',            imagesRouter);
app.use('/api/tags',              tagsRouter);
app.use('/api/gots/bulk',         bulkRouter);
app.use('/api/smart-collections', smartCollectionsRouter);
app.use('/api/discover',          discoverRouter);
app.use('/api/transfer',          transferRouter);
app.use('/api/import/pinterest',  importPinterestRouter);

const server = app.listen(PORT, () => {
  console.log(`GotchaBoard running at http://localhost:${PORT}`);
  const { startJobs } = require('./jobs/discoverJob');
  startJobs();
});

module.exports = { app, server, PORT };
