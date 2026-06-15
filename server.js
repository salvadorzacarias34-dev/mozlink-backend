const express = require('express');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// URL base para as imagens (Funciona no Render e Localmente)
const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'http://localhost:5000';

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

app.use('/uploads', express.static(uploadDir));

let serviceAccount;
if (process.env.FIREBASE_CONFIG) {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  try {
    serviceAccount = require('./firebase-key.json');
  } catch (e) {
    console.error("Aviso: Variável FIREBASE_CONFIG não encontrada.");
  }
}

if (serviceAccount) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const auth = getAuth();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// ROTAS
app.get('/', (req, res) => res.send('Servidor MozLink Ativo!'));

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const userRecord = await auth.createUser({ email, password, displayName: name });
    await db.collection('users').doc(userRecord.uid).set({
      name, email,
      avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde",
      coverPhoto: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe",
      createdAt: new Date().toISOString(),
      friends: []
    });
    res.status(201).json({ message: 'Utilizador criado!', userId: userRecord.uid });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRecord = await auth.getUserByEmail(email);
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    res.status(200).json({
      userId: userRecord.uid,
      utilizador: { name: userData.name || userRecord.displayName, avatar: userData.avatar }
    });
  } catch (error) { res.status(400).json({ error: 'Credenciais inválidas.' }); }
});

// POSTS
app.post('/api/posts', upload.single('imageFile'), async (req, res) => {
  const { userId, userName, userAvatar, content } = req.body;
  let imageUrl = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : null;
  try {
    const docRef = await db.collection('posts').add({ userId, userName, userAvatar, content, image: imageUrl, likes: [], comments: [], createdAt: new Date().toISOString() });
    res.status(201).json({ postId: docRef.id });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get('/api/posts', async (req, res) => {
  const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
  res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
});

// LISTAR TODOS OS UTILIZADORES (Para a Sidebar)
app.get('/api/users/all', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) { res.status(400).json({ error: error.message }); }
});

// FOTOS DE PERFIL
app.post('/api/users/:id/upload-photo', upload.single('photoFile'), async (req, res) => {
  const { type } = req.body;
  const imageUrl = `${BASE_URL}/uploads/${req.file.filename}`;
  await db.collection('users').doc(req.params.id).update({ [type]: imageUrl });
  res.json({ imageUrl });
});

// CHAT
app.post('/api/messages', async (req, res) => {
  const { remetenteId, destinatarioId, texto } = req.body;
  await db.collection('messages').add({ remetenteId, destinatarioId, texto, createdAt: new Date().toISOString() });
  res.status(201).json({ message: 'Enviada!' });
});

app.get('/api/messages/:meuId/:outroId', async (req, res) => {
  const { meuId, outroId } = req.params;
  const snap1 = await db.collection('messages').where('remetenteId', '==', meuId).where('destinatarioId', '==', outroId).get();
  const snap2 = await db.collection('messages').where('remetenteId', '==', outroId).where('destinatarioId', '==', meuId).get();
  const msgs = [...snap1.docs, ...snap2.docs].map(doc => doc.data());
  msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(msgs);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor ativo na porta ${PORT}`));
