/**
 * CLOUDFLARE WORKER — Paraíso dos Lanches
 * Deploy: https://dash.cloudflare.com → Workers → Create Worker → colar este código
 *
 * Variáveis de ambiente (Settings → Variables):
 *   MP_ACCESS_TOKEN  =  seu Access Token do Mercado Pago (começa com APP_USR-...)
 *   ALLOWED_ORIGIN   =  URL do seu site (ex: https://paraísodoslanches.com.br)
 */

const CORS = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS(origin) });
    }

    // ── POST /criar-pix ──────────────────────────────────────────
    if (url.pathname === "/criar-pix" && request.method === "POST") {
      try {
        const { itens, total, nome, cpf } = await request.json();

        if (!total || total <= 0) {
          return new Response(
            JSON.stringify({ erro: "Total inválido" }),
            { status: 400, headers: CORS(origin) }
          );
        }

        // Monta descrição compacta dos itens
        const descricao = itens
          .map((i) => `${i.nome} R$${i.preco.toFixed(2)}`)
          .join(" | ")
          .slice(0, 100);

        // Chama API do Mercado Pago
        const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            transaction_amount: parseFloat(total.toFixed(2)),
            description: descricao,
            payment_method_id: "pix",
            payer: {
              email: "cliente@paraisodoslanches.com.br",
              first_name: nome || "Cliente",
              identification: {
                type: "CPF",
                number: cpf ? cpf.replace(/\D/g, "") : "00000000000",
              },
            },
          }),
        });

        const dados = await mpRes.json();

        if (!mpRes.ok) {
          console.error("MP error:", JSON.stringify(dados));
          return new Response(
            JSON.stringify({ erro: dados.message || "Erro no Mercado Pago" }),
            { status: 502, headers: CORS(origin) }
          );
        }

        const pix = dados.point_of_interaction?.transaction_data;

        return new Response(
          JSON.stringify({
            id: dados.id,
            status: dados.status,
            qr_code: pix?.qr_code,
            qr_code_base64: pix?.qr_code_base64,
            expiracao: dados.date_of_expiration,
          }),
          { status: 200, headers: CORS(origin) }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ erro: err.message }),
          { status: 500, headers: CORS(origin) }
        );
      }
    }

    // ── GET /status/:id ──────────────────────────────────────────
    if (url.pathname.startsWith("/status/") && request.method === "GET") {
      const paymentId = url.pathname.split("/status/")[1];

      try {
        const mpRes = await fetch(
          `https://api.mercadopago.com/v1/payments/${paymentId}`,
          {
            headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
          }
        );

        const dados = await mpRes.json();

        return new Response(
          JSON.stringify({
            id: dados.id,
            status: dados.status,           // pending | approved | rejected
            status_detail: dados.status_detail,
          }),
          { status: 200, headers: CORS(origin) }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ erro: err.message }),
          { status: 500, headers: CORS(origin) }
        );
      }
    }

    // ── POST /webhook  (Mercado Pago → notificação) ──────────────
    if (url.pathname === "/webhook" && request.method === "POST") {
      // O MP envia notificação; podemos logar ou salvar em KV/D1
      const body = await request.json().catch(() => ({}));
      console.log("Webhook recebido:", JSON.stringify(body));
      // Aqui você pode salvar em Cloudflare KV ou D1 para notificar o caixa
      return new Response("ok", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};