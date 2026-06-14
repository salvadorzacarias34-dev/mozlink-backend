const express = require('express');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const cors = require('cors');
const multer = require('multer'); // 📦 Importa o Multer para upload
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

// 🔥 Garante que a pasta 'uploads' existe no servidor
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// Servir a pasta de uploads de forma pública para o Frontend conseguir aceder às imagens
app.use('/uploads', express.static(uploadDir));

// 1. Inicializar o Firebase Admin
const serviceAccount = require('./firebase-key.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

// ⚙️ CONFIGURAÇÃO DO STORAGE DO MULTER
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Pasta onde as imagens vão ficar guardadas
  },
  filename: function (req, file, cb) {
    // Cria um nome único: TempoAtual-NomeOriginal
    const uniqueSuffix = Date.now() + '-' + file.originalname;
    cb(null, uniqueSuffix);
  }
});
const upload = multer({ storage: storage });

// ==================== ROTAS DA MOZLINK ====================

app.get('/', (req, res) => {
  res.send('Servidor da MozLink Rodando com Uploads Locais!');
});

// ROTA DE REGISTO
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

// ROTA DE LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRecord = await auth.getUserByEmail(email);
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    res.status(200).json({
      message: 'Login efetuado!',
      userId: userRecord.uid,
      utilizador: {
        name: userData.name || userRecord.displayName,
        email: userRecord.email,
        avatar: userData.avatar || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde"
      }
    });
  } catch (error) { res.status(400).json({ error: 'Credenciais inválidas.' }); }
});

// 📸 ROTA DE CRIAR POST
app.post('/api/posts', upload.single('imageFile'), async (req, res) => {
  const { userId, userName, userAvatar, content } = req.body;

  try {
    let imageUrl = null;
    
    if (req.file) {
      imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;
    }

    const newPost = {
      userId,
      userName,
      userAvatar,
      content,
      image: imageUrl,
      likes: [],
      comments: [],
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('posts').add(newPost);
    res.status(201).json({ message: 'Post criado com imagem real!', postId: docRef.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ROTA DE LISTAR POSTS
app.get('/api/posts', async (req, res) => {
  try {
    const snapshot = await db.collection('posts').orderBy('createdAt', 'desc').get();
    const posts = [];
    snapshot.forEach(doc => { posts.push({ id: doc.id, ...doc.data() }); });
    res.status(200).json(posts);
  } catch (error) { res.status(400).json({ error: error.message }); }
});

// ROTA DE LIKE
app.post('/api/posts/:id/like', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;
  try {
    const postRef = db.collection('posts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ error: 'Post não encontrado.' });
    
    let likes = postDoc.data().likes || [];
    if (likes.includes(userId)) { likes = likes.filter(id => id !== userId); } 
    else { likes.push(userId); }
    
    await postRef.update({ likes });
    res.status(200).json({ likesCount: likes.length, liked: likes.includes(userId) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

// ROTA DE COMENTAR
app.post('/api/posts/:id/comment', async (req, res) => {
  const postId = req.params.id;
  const { userId, userName, userAvatar, text } = req.body;
  if (!text || text.trim() === "") return res.status(400).json({ error: 'Vazio.' });

  try {
    const postRef = db.collection('posts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ error: 'Post não encontrado.' });

    const comments = postDoc.data().comments || [];
    comments.push({ userId, userName, userAvatar, text: text.trim(), createdAt: new Date().toISOString() });
    
    await postRef.update({ comments });
    res.status(200).json({ message: 'Comentário adicionado!', comments });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

// ROTA DE ELIMINAR POST
app.delete('/api/posts/:id', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;
  try {
    const postRef = db.collection('posts').doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) return res.status(404).json({ error: 'Não encontrado.' });
    if (postDoc.data().userId !== userId) return res.status(403).json({ error: 'Sem permissão.' });

    await postRef.delete();
    res.status(200).json({ message: 'Post eliminado!' });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

// 👤 1. ROTA DE BUSCAR DADOS DE UM UTILIZADOR ESPECÍFICO
app.get('/api/users/:id', async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'Utilizador não encontrado.' });
    }
    res.status(200).json(userDoc.data());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 🤝 2. ROTA DE ADICIONAR / REMOVER AMIGO (Follow / Unfollow Mútuo)
app.post('/api/users/follow', async (req, res) => {
  const { meuId, alvoId } = req.body;

  if (meuId === alvoId) return res.status(400).json({ error: "Não podes seguir-te a ti mesmo." });

  try {
    const meuRef = db.collection('users').doc(meuId);
    const alvoRef = db.collection('users').doc(alvoId);

    const meuDoc = await meuRef.get();
    const alvoDoc = await alvoRef.get();

    if (!meuDoc.exists || !alvoDoc.exists) return res.status(404).json({ error: "Utilizador não encontrado." });

    let meusAmigos = meuDoc.data().friends || [];
    let amigosDoAlvo = alvoDoc.data().friends || [];

    if (meusAmigos.includes(alvoId)) {
      meusAmigos = meusAmigos.filter(id => id !== alvoId);
      amigosDoAlvo = amigosDoAlvo.filter(id => id !== meuId);
    } else {
      meusAmigos.push(alvoId);
      amigosDoAlvo.push(meuId);
    }

    await meuRef.update({ friends: meusAmigos });
    await alvoRef.update({ friends: amigosDoAlvo });

    res.status(200).json({ message: "Relação de amizade updated!" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


// ==================== NOVAS ROTAS INTEGRADAS (OPÇÃO A & C) ====================

// 👤 ROTA PARA ATUALIZAR FOTO DE PERFIL OU CAPA (Opção A)
app.post('/api/users/:id/upload-photo', upload.single('photoFile'), async (req, res) => {
  const userId = req.params.id;
  const { type } = req.body; // 'avatar' ou 'coverPhoto'

  if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado.' });
  if (type !== 'avatar' && type !== 'coverPhoto') return res.status(400).json({ error: 'Tipo inválido.' });

  try {
    const imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;
    const userRef = db.collection('users').doc(userId);

    // Atualiza o campo dinamicamente (avatar ou coverPhoto) usando bracket notation
    await userRef.update({ [type]: imageUrl });

    res.status(200).json({ message: 'Foto atualizada com sucesso!', imageUrl });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 💬 ROTA PARA ENVIAR UMA MENSAGEM NO CHAT (Opção C)
app.post('/api/messages', async (req, res) => {
  const { remetenteId, destinatarioId, texto } = req.body;
  if (!texto || texto.trim() === "") return res.status(400).json({ error: 'Mensagem vazia.' });

  try {
    const novaMensagem = {
      remetenteId,
      destinatarioId,
      texto: texto.trim(),
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('messages').add(novaMensagem);
    res.status(201).json({ message: 'Mensagem enviada!', id: docRef.id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 📥 ROTA PARA CONVERSA ENTRE DOIS UTILIZADORES (Opção C)
app.get('/api/messages/:meuId/:outroId', async (req, res) => {
  const { meuId, outroId } = req.params;
  try {
    // Procura mensagens onde eu sou o remetente e ele o destinatário
    const snap1 = await db.collection('messages')
      .where('remetenteId', '==', meuId)
      .where('destinatarioId', '==', outroId)
      .get();

    // Procura mensagens onde ele é o remetente e eu o destinatário
    const snap2 = await db.collection('messages')
      .where('remetenteId', '==', outroId)
      .where('destinatarioId', '==', meuId)
      .get();

    const mensagens = [];
    snap1.forEach(doc => mensagens.push(doc.data()));
    snap2.forEach(doc => mensagens.push(doc.data()));

    // Ordena por data de criação de forma crescente para manter a ordem cronológica no chat
    mensagens.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.status(200).json(mensagens);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`Servidor MozLink ativo na porta ${PORT}`); });