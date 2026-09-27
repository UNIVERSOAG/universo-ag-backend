require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });
const TOKEN_PATH = path.join(__dirname, 'tokens.json');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

if (fs.existsSync(TOKEN_PATH)) {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oauth2Client.setCredentials(tokens);
}

app.get('/auth/google', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes
  });

  res.json({ authUrl: url });
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('No se proporcionó el código de autorización.');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    res.send('Autenticación completada con éxito. Ya puedes cerrar esta ventana.');
  } catch (error) {
    console.error('Error al intercambiar el código por tokens:', error);
    res.status(500).send('Error en el proceso de autenticación.');
  }
});

app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Es obligatorio adjuntar un archivo de video.' });
  }

  if (!oauth2Client.credentials || !oauth2Client.credentials.access_token) {
    fs.unlinkSync(req.file.path);
    return res.status(401).json({ 
      error: 'Servidor no autenticado con YouTube. Visita /auth/google primero.' 
    });
  }

  const videoFilePath = req.file.path;
  const { title, description, tags, privacyStatus } = req.body;

  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title || 'UNIVERSO AG - Short',
          description: description || 'Contenido oficial de UNIVERSO AG.',
          tags: tags ? tags.split(',') : ['UNIVERSO AG', 'Shorts'],
          categoryId: '24'
        },
        status: {
          privacyStatus: privacyStatus || 'private',
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoFilePath)
      }
    });

    fs.unlinkSync(videoFilePath);

    res.status(200).json({
      message: 'Video subido con éxito.',
      videoId: response.data.id,
      videoUrl: `https://www.youtube.com/watch?v=${response.data.id}`
    });

  } catch (error) {
    if (fs.existsSync(videoFilePath)) {
      fs.unlinkSync(videoFilePath);
    }
    console.error('Error al subir el video a YouTube:', error.response ? error.response.data : error);
    res.status(500).json({ 
      error: 'Fallo al subir el video a YouTube API.',
      details: error.response ? error.response.data : error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
