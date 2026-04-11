const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db'); // runs migrations on import

const imagesRouter           = require('./routes/images');
const tagsRouter             = require('./routes/tags');
const bulkRouter             = require('./routes/bulk');
const smartCollectionsRouter = require('./routes/smartCollections');

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

app.use('/images', express.static(path.join(__dirname, '..', 'storage', 'images')));
app.use('/thumbs', express.static(path.join(__dirname, '..', 'storage', 'thumbs')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/images',            imagesRouter);
app.use('/api/tags',              tagsRouter);
app.use('/api/gots/bulk',         bulkRouter);
app.use('/api/smart-collections', smartCollectionsRouter);

app.listen(PORT, () => {
  console.log(`GotchaBoard running at http://localhost:${PORT}`);
});
