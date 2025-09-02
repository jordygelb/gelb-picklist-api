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

// --------- picklists concluídas (tolerante) ---------
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
    return safeFail(res, e, []); // em erro, retorna vazio
  }
});

// ---------------------- agendas (rotas) ----------------------
// Reproduz a lógica do PHP: obtém IDs pelas scheduled_visits e
// busca o name em routes/{id}. Usa apenas nomes que começam com "ROTA ".
router.get('/agendas', async (req, res) => {
  const { start_date = '', end_date = '' } = req.query;
  try {
    // nomes "ROTA ..." observados em pick_lists (ajuda no fallback)
    let rotaNames = new Set();
    try {
      const pls = await vmget(
        `pick_lists?include=routes&pending_only=true&start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`
      );
      for (const p of (Array.isArray(pls) ? pls : [])) {
        for (const r of (p.routes || [])) {
          const n = r?.name || '';
          if (n.toUpperCase().startsWith('ROTA ')) rotaNames.add(n);
        }
      }
    } catch {}

    // ids vindo das visitas agendadas
    const vis = await vmget(
      `scheduled_visits?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`
    );
    const idsSet = new Set();
    for (const v of (Array.isArray(vis) ? vis : [])) {
      for (const svr of (v.scheduled_visit_routes || [])) {
        if (svr?.route_id) idsSet.add(svr.route_id);
      }
    }

    const rotas = [];
    for (const rid of Array.from(idsSet)) {
      try {
        const routeObj = await vmget(`routes/${encodeURIComponent(rid)}`);
        const nameApi = routeObj?.name || '';
        const name = (nameApi && nameApi.toUpperCase().startsWith('ROTA '))
          ? nameApi
          : (rotaNames.size ? [...rotaNames][0] : `Rota ${rid}`);
        rotas.push({ id: String(rid), name: String(name) });
      } catch {
        rotas.push({ id: String(rid), name: `Rota ${rid}` });
      }
    }

    rotas.sort((a,b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
    return ok(res, rotas);
  } catch (e) {
    return safeFail(res, e, []);
  }
});

// ---------------------- picklists ----------------------
// Nome = p.name || asset_number da máquina || p.asset_number || "Picklist {id}"
router.get('/picklists', async (req, res) => {
  const { rota = '', start_date = '', end_date = '' } = req.query;
  try {
    if (!rota) return ok(res, []);

    const pls = await vmget(
      `pick_lists?include=routes&pending_only=true&start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`
    );

    const machines = await vmget('machines').catch(() => []);
    const mapM = new Map();
    for (const m of (Array.isArray(machines) ? machines : [])) {
      mapM.set(m.id, m.asset_number || '');
    }

    const out = [];
    for (const p of (Array.isArray(pls) ? pls : [])) {
      const routes = p.routes || [];
      const matchesRota = routes.some(r => String(r.id) === String(rota));
      if (!matchesRota) continue;

      const nomePick = p.name || '';
      const mid      = p.machine_id || null;
      const label    = firstNonEmpty([nomePick, mapM.get(mid), p.asset_number, `Picklist ${p.id}`]);
      out.push({ id: String(p.id), nome: String(label) });
    }

    return ok(res, out);
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
