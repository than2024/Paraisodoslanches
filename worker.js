/**
 * =====================================================
 *  Cloudflare Worker — PIX Mercado Pago
 *  Paraíso dos Lanches
 * =====================================================
 *
 *  COMO CONFIGURAR NO CLOUDFLARE:
 *  1. Acesse dash.cloudflare.com → Workers & Pages → Create Worker
 *  2. Cole este código no editor
 *  3. Clique em "Settings" → "Variables" → "Add variable"
 *     Nome: MP_ACCESS_TOKEN
 *     Valor: APP_USR-536075043531739-052709-12987cff524735ee1f416faf995c454d-709709030
 *     Marque como "Secret"
 *  4. Salve e faça o deploy
 *  5. Copie a URL do Worker (ex: https://pix-paraiso.SEU-SUBDOMINIO.workers.dev)
 *  6. Cole essa URL no cardapio.html na variável WORKER_URL
 * =====================================================
 */

const ALLOWED_ORIGIN = '*'; // Troque pelo seu domínio em produção, ex: 'https://seusite.com'

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Só aceita POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método não permitido' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'JSON inválido' }, 400);
    }

    const { total, descricao, email } = body;

    if (!total || total <= 0) {
      return jsonResponse({ error: 'Total inválido' }, 400);
    }

    // ---- Cria pagamento PIX no Mercado Pago ----
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: parseFloat(total.toFixed(2)),
      description: descricao || 'Pedido Paraíso dos Lanches',
      payment_method_id: 'pix',
      payer: {
        email: email || 'cliente@paraisolanches.com',
      },
    };

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
      return jsonResponse({ error: 'Erro ao conectar com Mercado Pago', detail: err.message }, 502);
    }

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      return jsonResponse({ error: 'Erro no Mercado Pago', detail: mpData }, mpResponse.status);
    }

    const pixInfo = mpData.point_of_interaction?.transaction_data;

    if (!pixInfo) {
      return jsonResponse({ error: 'PIX não gerado pelo Mercado Pago', raw: mpData }, 500);
    }

    return jsonResponse({
      payment_id: mpData.id,
      status: mpData.status,
      qr_code: pixInfo.qr_code,           // copia e cola
      qr_code_base64: pixInfo.qr_code_base64, // imagem do QR Code
      total: mpData.transaction_amount,
    });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    },
  });
}
