/**
 * =====================================================
 *  Cloudflare Worker — PIX Mercado Pago
 *  Paraíso dos Lanches
 * =====================================================
 *  ATENÇÃO: Nunca coloque o token aqui no código!
 *  Configure-o como variável secreta no Cloudflare:
 *  Workers → Settings → Variables → MP_ACCESS_TOKEN
 * =====================================================
 */

const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request, env) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // Só aceita POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método não permitido' }, 405);
    }

    // Verifica se o token está configurado
    if (!env.MP_ACCESS_TOKEN) {
      return jsonResponse({
        error: 'Token do Mercado Pago não configurado.',
        dica: 'Vá em Workers → Settings → Variables e adicione MP_ACCESS_TOKEN com seu Access Token de produção.'
      }, 500);
    }

    // Lê o body
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'JSON inválido no corpo da requisição' }, 400);
    }

    const { total, descricao, email } = body;

    if (!total || isNaN(total) || total <= 0) {
      return jsonResponse({ error: 'Campo "total" inválido ou ausente' }, 400);
    }

    // Monta o payload para o Mercado Pago
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: parseFloat(parseFloat(total).toFixed(2)),
      description: (descricao || 'Pedido Paraíso dos Lanches').slice(0, 200),
      payment_method_id: 'pix',
      payer: {
        email: email || 'cliente@paraisolanches.com',
      },
    };

    // Chama a API do Mercado Pago
    let mpResponse;
    try {
      mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return jsonResponse({
        error: 'Erro ao conectar com Mercado Pago',
        detail: err.message
      }, 502);
    }

    // Lê a resposta do Mercado Pago
    let mpData;
    try {
      mpData = await mpResponse.json();
    } catch {
      return jsonResponse({ error: 'Resposta inválida do Mercado Pago' }, 502);
    }

    // Trata erros retornados pelo Mercado Pago
    if (!mpResponse.ok) {
      const mpMsg =
        mpData?.message ||
        mpData?.cause?.[0]?.description ||
        JSON.stringify(mpData);

      return jsonResponse({
        error: 'Erro retornado pelo Mercado Pago',
        mp_message: mpMsg,
        status_http: mpResponse.status,
        detail: mpData,
      }, mpResponse.status);
    }

    // Extrai dados do PIX
    const pixInfo = mpData?.point_of_interaction?.transaction_data;

    if (!pixInfo || !pixInfo.qr_code) {
      return jsonResponse({
        error: 'PIX não foi gerado pelo Mercado Pago.',
        dica: 'Verifique se sua conta tem o PIX ativado e se está usando o token de PRODUÇÃO (não sandbox).',
        raw: mpData,
      }, 500);
    }

    // Retorna sucesso
    return jsonResponse({
      payment_id: mpData.id,
      status: mpData.status,
      qr_code: pixInfo.qr_code,
      qr_code_base64: pixInfo.qr_code_base64,
      total: mpData.transaction_amount,
    });
  },
};

// ---- Helpers ----

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
  });
}
