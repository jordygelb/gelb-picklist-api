import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import router from './routes.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.options('*', cors()); // habilita respostas ao preflight (OPTIONS)
app.use(express.json());

// todas as rotas da API ficam em /api/...
app.use('/api', router);

// fallback 404
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
