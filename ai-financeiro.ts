const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('OK', {
    headers: {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}
  })
  if (req.method !== 'POST') return new Response('OK')

  let body: any
  try { body = await req.json() } catch { return new Response('{"error":"invalid json"}',{status:400}) }

  const { question, context, history } = body
  if (!question) return new Response('{"error":"missing question"}', {status:400})
  if (!ANTHROPIC_KEY) return new Response('{"error":"API key not configured"}', {status:500})

  const systemPrompt = `Você é a IA Financeira do Patrimoni — um assistente financeiro pessoal brilhante, direto e empático.

SUAS CARACTERÍSTICAS:
- Responde sempre em português brasileiro
- É objetivo e vai direto ao ponto
- Usa os dados reais do usuário para dar conselhos personalizados
- Formata valores como R$ 1.234,56
- Usa emojis com moderação (máximo 2 por resposta)
- Não repete os dados brutos — analisa e interpreta
- Quando algo preocupa, aponta com clareza mas sem alarmismo
- Quando algo é bom, celebra brevemente
- Máximo 3-4 parágrafos por resposta

REGRAS FINANCEIRAS QUE VOCÊ CONHECE:
- Reserva de emergência ideal: 6-12 meses de gastos
- Endividamento saudável: até 30% da renda em parcelas
- Regra 50/30/20: 50% necessidades, 30% desejos, 20% investimentos
- Nunca confunda aporte com rendimento
- Patrimônio Líquido = Ativos - Passivos`

  const messages: any[] = []
  if (history && Array.isArray(history)) {
    history.slice(-4).forEach((h: any) => messages.push(h))
  }
  messages.push({
    role: 'user',
    content: context
      ? `MEUS DADOS FINANCEIROS ATUAIS:\n${context}\n\nMINHA PERGUNTA: ${question}`
      : question
  })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      })
    })
    const data = await res.json()
    const text = data.content?.[0]?.text || 'Não consegui gerar uma resposta. Tente novamente.'
    return new Response(JSON.stringify({ response: text }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Erro ao chamar a IA: ' + e }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})
