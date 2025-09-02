import axios from 'axios';

const { VMPAY_BASE = '', VMPAY_TOKEN = '' } = process.env;

// cliente para a VMpay (timeout simples)
export const api = axios.create({
  baseURL: VMPAY_BASE.replace(/\/$/, ''),
  timeout: 15000
});

// GET na VMpay adicionando o token como querystring
export async function vmget(path) {
  if (!VMPAY_BASE || !VMPAY_TOKEN) {
    const err = new Error('VMpay não configurado (VMPAY_BASE/VMPAY_TOKEN).');
    err.status = 501;
    throw err;
  }
  const url = `${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(VMPAY_TOKEN)}`;
  const { data } = await api.get(url);
  return data;
}
