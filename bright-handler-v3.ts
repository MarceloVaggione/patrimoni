import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOKEN    = Deno.env.get('TELEGRAM_TOKEN') ?? ''
const SB_URL   = Deno.env.get('SUPABASE_URL') ?? ''
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const API = 'https://api.telegram.org/bot' + TOKEN

async function call(method: string, body: any) {
  await fetch(API + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
}
async function reply(chatId: number, text: string, extra?: any) {
  await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })
}
async function answerCb(id: string) {
  await call('answerCallbackQuery', { callback_query_id: id })
}

// ── Transcrição via OpenAI Whisper ─────────────────────────
async function transcribeAudio(fileId: string): Promise<string|null> {
  if (!OPENAI_KEY) return null
  try {
    const fileRes = await fetch(`${API}/getFile?file_id=${fileId}`)
    const fileData = await fileRes.json()
    const filePath = fileData.result?.file_path
    if (!filePath) return null
    const audioRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`)
    if (!audioRes.ok) return null
    const form = new FormData()
    form.append('file', new File([await audioRes.blob()], 'audio.ogg', { type: 'audio/ogg' }))
    form.append('model', 'whisper-1')
    form.append('language', 'pt')
    form.append('response_format', 'text')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + OPENAI_KEY }, body: form
    })
    if (!res.ok) return null
    return (await res.text()).trim() || null
  } catch { return null }
}

// ── Limpeza de descrição ───────────────────────────────────
function limparDescricao(text: string, isReceita: boolean): string {
  let desc = text
    .replace(/R\$\s*/gi, '')           // Remove R$
    .replace(/reais/gi, '')            // Remove "reais"
    .replace(/\d+[.,]?\d*/g, '')       // Remove números
    .replace(/receb\w*|receita|entrada|salario/gi, '')
    .replace(/gast\w*|pagu\w*|compre\w*/gi, '') // Remove "gastei", "paguei", "comprei"
    .replace(/\s+/g, ' ').trim()
  if (!desc) desc = isReceita ? 'Receita' : 'Gasto'
  return desc.charAt(0).toUpperCase() + desc.slice(1)
}

// ── Teclado de pagamento ───────────────────────────────────
function buildPagamentoKeyboard(pendId: string, cartoes: any[], contas: any[]) {
  const keyboard: any[] = []
  // Cartões (2 por linha)
  for (let i = 0; i < cartoes.length; i += 2) {
    const row: any[] = [{ text: '💳 ' + cartoes[i].nome, callback_data: 'pgto_c:' + cartoes[i].id + ':' + pendId }]
    if (cartoes[i+1]) row.push({ text: '💳 ' + cartoes[i+1].nome, callback_data: 'pgto_c:' + cartoes[i+1].id + ':' + pendId })
    keyboard.push(row)
  }
  // Contas (2 por linha)
  for (let i = 0; i < contas.length; i += 2) {
    const row: any[] = [{ text: '🏦 ' + contas[i].nome, callback_data: 'pgto_a:' + contas[i].id + ':' + pendId }]
    if (contas[i+1]) row.push({ text: '🏦 ' + contas[i+1].nome, callback_data: 'pgto_a:' + contas[i+1].id + ':' + pendId })
    keyboard.push(row)
  }
  keyboard.push([{ text: '💸 Sem vínculo', callback_data: 'pgto_n::' + pendId }])
  return keyboard
}

// ── Teclado de categorias ──────────────────────────────────
function buildCatKeyboard(pendId: string, cats: any[]) {
  const keyboard: any[] = []
  for (let i = 0; i < cats.length; i += 2) {
    const row: any[] = [{ text: cats[i].icone + ' ' + cats[i].nome, callback_data: 'cat:' + cats[i].id + ':' + pendId }]
    if (cats[i+1]) row.push({ text: cats[i+1].icone + ' ' + cats[i+1].nome, callback_data: 'cat:' + cats[i+1].id + ':' + pendId })
    keyboard.push(row)
  }
  keyboard.push([{ text: '+ Nova categoria', callback_data: 'nova:' + pendId }])
  return keyboard
}

// ── Finalizar lançamento ───────────────────────────────────
async function finalizarLancamento(chatId: number, tx: any, sb: any) {
  const { error } = await sb.from('transacoes').insert(tx)
  if (error) { await reply(chatId, 'Erro ao salvar: ' + error.message); return }
  const catData = tx.categoria_id
    ? (await sb.from('categorias').select('nome').eq('id', tx.categoria_id).single()).data
    : null
  const sinal = tx.tipo === 'receita' ? '+' : '-'
  const pagamento = tx.cartao_id
    ? '💳 ' + ((await sb.from('cartoes').select('nome').eq('id', tx.cartao_id).single()).data?.nome || 'Cartao')
    : tx.conta_id
      ? '🏦 ' + ((await sb.from('contas').select('nome').eq('id', tx.conta_id).single()).data?.nome || 'Conta')
      : '💸 Sem vínculo'
  await reply(chatId,
    '✅ <b>Lancado!</b>\n\n' +
    '📝 ' + tx.descricao + '\n' +
    '💰 ' + sinal + 'R$ ' + parseFloat(tx.valor).toFixed(2).replace('.', ',') + '\n' +
    '🏷 ' + (catData?.nome || 'Sem categoria') + '\n' +
    pagamento
  )
}

// ── Processar texto ────────────────────────────────────────
async function processarTexto(chatId: number, text: string, sb: any) {
  const low = text.toLowerCase()

  // Estado: aguardando nome de nova categoria
  const { data: pendNome } = await sb.from('bot_pendentes').select('*')
    .eq('chat_id', chatId).eq('estado', 'aguardando_nome_cat')
    .order('created_at', { ascending: false }).limit(1)
  if (pendNome?.length > 0 && !text.startsWith('/')) {
    const pend = pendNome[0]; const tipo = pend.dados.tipo || 'despesa'
    const { data: novaCat } = await sb.from('categorias').insert({
      nome: text, icone: tipo === 'receita' ? '💵' : '📦', cor: '#6B7280', tipo
    }).select().single()
    if (novaCat) {
      const tx = { ...pend.dados, categoria_id: novaCat.id }
      await sb.from('bot_pendentes').delete().eq('id', pend.id)
      await finalizarLancamento(chatId, tx, sb)
    }
    return
  }

  // Comandos
  if (text === '/start' || text === '/ajuda') {
    await reply(chatId, '🤖 <b>Patrimoni Bot</b>\n\n🎤 Voz: "Gastei 80 no almoço"\n💬 Texto: <code>80 nubank restaurante</code>\n\n/saldo /faturas')
    return
  }
  if (text === '/saldo') {
    const { data: contas } = await sb.from('contas').select('nome,saldo').eq('ativo', true)
    if (!contas?.length) { await reply(chatId, 'Nenhuma conta.'); return }
    const total = contas.reduce((s: number, c: any) => s + parseFloat(c.saldo), 0)
    await reply(chatId, '<b>💰 Saldo</b>\n\n' +
      contas.map((c: any) => '- ' + c.nome + ': R$ ' + parseFloat(c.saldo).toFixed(2).replace('.', ',')).join('\n') +
      '\n\n<b>Total: R$ ' + total.toFixed(2).replace('.', ',') + '</b>')
    return
  }
  if (text === '/faturas') {
    const { data: cartoes } = await sb.from('cartoes').select('*').eq('ativo', true)
    if (!cartoes?.length) { await reply(chatId, 'Nenhum cartao.'); return }
    const now = new Date(); const linhas: string[] = []
    for (const c of cartoes) {
      const f = c.dia_fechamento
      const ini = now.getDate()>=f ? new Date(now.getFullYear(),now.getMonth(),f) : new Date(now.getFullYear(),now.getMonth()-1,f)
      const fim = now.getDate()>=f ? new Date(now.getFullYear(),now.getMonth()+1,f-1) : new Date(now.getFullYear(),now.getMonth(),f-1)
      const { data: txs } = await sb.from('transacoes').select('valor').eq('cartao_id',c.id).eq('tipo','despesa').gte('data',ini.toISOString().split('T')[0]).lte('data',fim.toISOString().split('T')[0])
      const total = (txs||[]).reduce((s: number, t: any) => s+Math.abs(parseFloat(t.valor)), 0)
      linhas.push('- ' + c.nome + ': R$ ' + total.toFixed(2).replace('.',',') + ' (vence dia ' + c.dia_vencimento + ')')
    }
    await reply(chatId, '<b>💳 Faturas</b>\n\n' + linhas.join('\n')); return
  }

  // Lançar transação
  const matchValor = text.match(/(\d+[.,]?\d*)/)
  if (!matchValor) { await reply(chatId, 'Não entendi o valor.\nEx: <code>50 nubank restaurante</code>'); return }
  const valor = parseFloat(matchValor[1].replace(',', '.'))
  const isReceita = /receb|receita|entrada|salario/i.test(text)
  const tipo = isReceita ? 'receita' : 'despesa'

  const cartoes: any[] = (await sb.from('cartoes').select('*').eq('ativo', true)).data || []
  const contas: any[]  = (await sb.from('contas').select('*').eq('ativo', true)).data || []
  const cats: any[]    = (await sb.from('categorias').select('*').eq('tipo', tipo)).data || []

  const cartao = cartoes.find((c: any) => c.nome.toLowerCase().split(' ').some((w: string) => w.length>2 && low.includes(w)))
  const conta  = !cartao ? contas.find((c: any) => c.nome.toLowerCase().split(' ').some((w: string) => w.length>2 && low.includes(w))) : null
  const cat    = cats.find((c: any) => c.nome.toLowerCase().split(' ').some((w: string) => w.length>3 && low.includes(w)))

  const desc = limparDescricao(text, isReceita)

  const payload: any = {
    data: new Date().toISOString().split('T')[0],
    descricao: desc, valor, tipo,
    subtipo: isReceita ? null : 'variavel',
    categoria_id: cat?.id || null,
    conta_id:  conta?.id || null,
    cartao_id: cartao?.id || null,
    observacao: 'Via Telegram',
  }

  // Se não souber o meio de pagamento → perguntar primeiro
  if (!cartao && !conta && !isReceita) {
    const { data: pendente } = await sb.from('bot_pendentes')
      .insert({ chat_id: chatId, dados: payload, estado: 'aguardando_pagamento' }).select().single()
    if (!pendente) { await reply(chatId, 'Erro interno.'); return }
    const keyboard = buildPagamentoKeyboard(pendente.id, cartoes, contas)
    await reply(chatId,
      '📝 ' + desc + ' · R$ ' + valor.toFixed(2).replace('.', ',') + '\n\n<b>Como foi o pagamento?</b>',
      { reply_markup: { inline_keyboard: keyboard } }
    )
    return
  }

  // Se não souber a categoria → perguntar
  if (!cat) {
    const { data: pendente } = await sb.from('bot_pendentes')
      .insert({ chat_id: chatId, dados: payload, estado: 'aguardando_categoria' }).select().single()
    if (!pendente) { await reply(chatId, 'Erro interno.'); return }
    await reply(chatId, 'Qual categoria para "<b>' + desc + '</b>"?',
      { reply_markup: { inline_keyboard: buildCatKeyboard(pendente.id, cats) } })
    return
  }

  // Tudo identificado → lança direto
  await finalizarLancamento(chatId, payload, sb)
}

// ── Servidor principal ─────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('OK')
  let body: any
  try { body = await req.json() } catch { return new Response('OK') }
  const sb = createClient(SB_URL, SB_KEY)

  // Callback Query (botões)
  const cb = body?.callback_query
  if (cb) {
    const cbId=cb.id, cbChat=cb.message.chat.id, cbMsgId=cb.message.message_id
    const data: string = cb.data
    await answerCb(cbId)
    await call('editMessageReplyMarkup', { chat_id: cbChat, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } })

    // Seleção de categoria
    if (data.startsWith('cat:')) {
      const [,catId,pendId] = data.split(':')
      const { data: pend } = await sb.from('bot_pendentes').select('dados').eq('id', pendId).single()
      if (!pend) { await reply(cbChat, 'Expirado. Manda de novo!'); return new Response('OK') }
      const tx = { ...pend.dados, categoria_id: catId }
      await sb.from('bot_pendentes').delete().eq('id', pendId)
      // Se ainda não tem pagamento → perguntar
      if (!tx.cartao_id && !tx.conta_id && tx.tipo !== 'receita') {
        const { data: pd } = await sb.from('bot_pendentes').insert({ chat_id: cbChat, dados: tx, estado: 'aguardando_pagamento' }).select().single()
        if (pd) {
          const cartoes = (await sb.from('cartoes').select('*').eq('ativo',true)).data || []
          const contas  = (await sb.from('contas').select('*').eq('ativo',true)).data || []
          await reply(cbChat, '<b>Como foi o pagamento?</b>', { reply_markup: { inline_keyboard: buildPagamentoKeyboard(pd.id, cartoes, contas) } })
          return new Response('OK')
        }
      }
      await finalizarLancamento(cbChat, tx, sb)
    }
    // Nova categoria
    else if (data.startsWith('nova:')) {
      await sb.from('bot_pendentes').update({ estado: 'aguardando_nome_cat' }).eq('id', data.split(':')[1])
      await reply(cbChat, 'Qual o nome da nova categoria? (ex: <code>Academia</code>)')
    }
    // Seleção de pagamento: pgto_c = cartão, pgto_a = conta, pgto_n = nenhum
    else if (data.startsWith('pgto_')) {
      const parts = data.split(':')
      const tipo_pgto = parts[0] // pgto_c, pgto_a, pgto_n
      const refId = parts[1]     // id do cartão ou conta
      const pendId = parts[2]
      const { data: pend } = await sb.from('bot_pendentes').select('dados').eq('id', pendId).single()
      if (!pend) { await reply(cbChat, 'Expirado. Manda de novo!'); return new Response('OK') }
      const tx = { ...pend.dados }
      if (tipo_pgto === 'pgto_c') tx.cartao_id = refId
      if (tipo_pgto === 'pgto_a') tx.conta_id  = refId
      await sb.from('bot_pendentes').delete().eq('id', pendId)
      // Se não tem categoria → perguntar
      if (!tx.categoria_id) {
        const cats = (await sb.from('categorias').select('*').eq('tipo', tx.tipo)).data || []
        const { data: pd } = await sb.from('bot_pendentes').insert({ chat_id: cbChat, dados: tx, estado: 'aguardando_categoria' }).select().single()
        if (pd) {
          await reply(cbChat, 'Qual categoria para "<b>' + tx.descricao + '</b>"?',
            { reply_markup: { inline_keyboard: buildCatKeyboard(pd.id, cats) } })
          return new Response('OK')
        }
      }
      await finalizarLancamento(cbChat, tx, sb)
    }
    return new Response('OK')
  }

  // Mensagem
  const msg = body?.message
  if (!msg) return new Response('OK')
  const chatId: number = msg.chat.id

  // Áudio / voz
  const voiceObj = msg.voice || msg.audio
  if (voiceObj) {
    if (!OPENAI_KEY) { await reply(chatId, '⚠️ OPENAI_API_KEY não configurada.'); return new Response('OK') }
    await reply(chatId, '🎤 Transcrevendo...')
    const transcricao = await transcribeAudio(voiceObj.file_id)
    if (!transcricao) { await reply(chatId, '❌ Não consegui transcrever. Tente texto.'); return new Response('OK') }
    await reply(chatId, '📝 Entendi: "<i>' + transcricao + '</i>"\nProcessando...')
    await processarTexto(chatId, transcricao, sb)
    return new Response('OK')
  }

  if (!msg.text) return new Response('OK')
  await processarTexto(chatId, msg.text.trim(), sb)
  return new Response('OK')
})
