// servidor mínimo só pra validar deploy (vamos adicionar as rotas depois)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());

// endpoint de saúde para testes
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// fallback 404
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
