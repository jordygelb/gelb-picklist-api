import express from 'express';
import { pool, ensureCompletedTable } from './db.js';
import { vmget } from './vmpay.js';

const router = express.Router();

const ok = (res, data) => res.status(200).json(data);
const safeFail = (res, err, fallback) => {
  console.error('[API ERROR]', err?.message || err);
  const status = err?.status || err?.response?.status || 500;
  if (fallback !== undefined) return res.status(200).json(fallback);
  return res.status(status).json({ error: err?.message || 'Erro inesperado' });
};

// util para pegar o primeiro valor não vazio
function firstNonEmpty(list, fallback = '') {
  for (const v of list) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
}

// ---------------------- saúde ----------------------
router.get('/health', (_req, res) => ok(res, { ok: true }));

// ---------------------- auth ----------------------
router.post('/auth', async (req, res) => {
  const { email = '', senha = '' } = req.body || {};
  try {
    const [has] = await pool.query("SHOW TABLES LIKE 'usuarios'");
    if (has.length) {
      const [rows] = await pool.query(
        "SELECT id, nome, email FROM usuarios WHERE email = :email AND (senha = MD5(:senha) OR senha = :senha) LIMIT 1",
        { email, senha }
      );
      if (rows.length) return ok(res, rows[0]);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
  } catch (e) {
    console.warn('Auth: sem MySQL, usando fallback');
  }
  return ok(res, { id: 1, nome: 'ESTOQUE POA', email: email || 'estoque.poa@gelb.com.br' });
});

// --------- picklists concluídas (MySQL, tolerante) ---------
router.get('/completedPicklists', async (req, res) => {
  const operadorId = Number(req.query.operadorId || 0);
  if (!operadorId) return ok(res, []);
  try {
    await ensureCompletedTable();
    const [rows] = await pool.query(
      "SELECT picklist_id FROM completed_picklists WHERE operador_id = :op",
      { op: operadorId }
    );
    return ok(res, rows.map(r => String(r.picklist_id)));
  } catch (e) {
    return safeFail(res, e, []); // em erro, devolve lista vazia
  }
});

// ---------------------- agendas (rotas) ----------------------
// tenta vários campos possíveis para id e nome
router.get('/agendas', async (req, res) => {
  const { start_date = '', end_date = '' } = req.query;
  try {
    const raw = await vmget(
      `scheduled_visits?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`
    );
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

    const rotas = arr.map((r, i) => {
      const id = firstNonEmpty([
        r.route_id, r.id, r.route?.id, r.code, r.number, i + 1
      ]);
      const name = firstNonEmpty([
        r.route_name,
        r.name,
        r.title,
        r.description,
        r.label,
        r.route?.name,
        r.route?.title,
        `Rota ${id}`
      ]);
      return { id: String(id), name: String(name) };
    });

    return ok(res, rotas);
  } catch (e) {
    return safeFail(res, e, []);
  }
});

// ---------------------- picklists ----------------------
// idem: tenta diversos campos para id e nome
router.get('/picklists', async (req, res) => {
  const { rota = '', start_date = '', end_date = '' } = req.query;
  try {
    const raw = await vmget(
      `pick_lists?route_id=${encodeURIComponent(rota)}&start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`
    );
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

    const pls = arr.map((p) => {
      const id = firstNonEmpty([
        p.id, p.pick_list_id, p.code, p.number, p.uid, p.uuid
      ]);
      const nome = firstNonEmpty([
        p.name,
        p.title,
        p.display_name,
        p.description,
        p.code,
        p.pick_list?.name,
        `Picklist ${id}`
      ]);
      return { id: String(id), nome: String(nome) };
    });

    return ok(res, pls);
  } catch (e) {
    return safeFail(res, e, []);
  }
});

// ---------------------- itens ----------------------
router.get('/items', async (req, res) => {
  const picklistId = String(req.query.picklistId || '');
  if (!picklistId) return ok(res, []);
  try {
    const det = await vmget(`pick_lists/${encodeURIComponent(picklistId)}`);
    const start = det?.created_at || '';
    const updated = det?.updated_at || '';
    const end = updated && updated !== start
      ? new Date(new Date(updated).getTime() + 1000).toISOString()
      : new Date().toISOString();

    let page = 1, perPage = 100, out = [];
    while (true) {
      const items = await vmget(
        `pick_list_items?pick_list_id=${encodeURIComponent(picklistId)}&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&include=planogram_item.planogram,planogram_item.good&page=${page}&per_page=${perPage}`
      );
      const arr = Array.isArray(items) ? items : [];
      for (const rec of arr) {
        const pl = rec?.planogram_item || {};
        const gd = pl?.good || {};
        const pg = pl?.planogram || {};
        const q = Number(pl?.quantity || 0);
        if (q <= 0) continue;
        out.push({
          id: pl.id,
          canaleta: pg.slot || pg.code || '-',
          ean: gd.barcode || '',
          descricao: gd.name || '',
          quantidade: q,
          image_url: gd.image || ''
        });
      }
      if (arr.length < perPage) break;
      page++;
    }
    return ok(res, out);
  } catch (e) {
    if (e?.status === 404 || e?.response?.status === 404) return ok(res, []);
    return safeFail(res, e);
  }
});

// ---------------------- concluir picklist ----------------------
router.post('/completePicklist', async (req, res) => {
  const { operadorId, picklistId } = req.body || {};
  if (!operadorId || !picklistId) return res.status(400).json({ error: 'Dados insuficientes' });
  try {
    await ensureCompletedTable();
    await pool.query(
      "INSERT INTO completed_picklists (operador_id, picklist_id) VALUES (:op, :pl) ON DUPLICATE KEY UPDATE completed_at = NOW()",
      { op: Number(operadorId), pl: String(picklistId) }
    );
    return ok(res, { ok: true });
  } catch (e) {
    return safeFail(res, e, { ok: true });
  }
});

export default router;
