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

// 1. Inicializar o Firebase Admin (Seguro para Nuvem e Local)
let serviceAccount;
if (process.env.FIREBASE_CONFIG) {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} else {
  try {
    serviceAccount = require('./firebase-key.json');
  } catch (e) {
    console.error("Aviso: Variável FIREBASE_CONFIG não encontrada e firebase-key.json ausente.");
  }
}

if (serviceAccount) {
  initializeApp({ credential: cert(serviceAccount) });
} else {
  console.error("Erro Crítico: Não foi possível carregar as credenciais do Firebase.");
}

const db = getFirestore();
const auth = getAuth();

// ⚙️ CONFIGURAÇÃO DO STORAGE DO MULTER
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Pasta onde as imagens vão ficar guardadas
  },
  filename: function (req, file, cb) {
    // Cria um nome único: TempoAtual-NomeOriginal
    const uniqueSuffix = Date.