import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const TOKEN   = Deno.env.get('TELEGRAM_TOKEN') ?? ''
const SB_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SB_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const API = 'https://api.telegram.org/bot' + TOKEN

async function call(method: string, body: any) {
  await fetch(API + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}
async function reply(chatId: number, text: string, extra?: any) {
  await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })
}
async function answerCb(id: string) {
  await call('answerCallbackQuery', { callback_query_id: id })
}

// ── Transcrição de áudio via Groq Whisper ──────────────────
async function transcribeAudio(fileId: string): Promise<string|null> {
  if (!OPENAI_KEY) return null
  try {
    // 1. Obter path do arquivo no Telegram
    const fileRes = await fetch(`${API}/getFile?file_id=${fileId}`)
    const fileData = await fileRes.json()
    const filePath = fileData.result?.file_path
    if (!filePath) return null

    // 2. Baixar o áudio
    const audioUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) return null
    const audioBlob = await audioRes.blob()

    // 3. Enviar para Groq Whisper
    const form = new FormData()
    form.append('file', new File([audioBlob], 'audio.ogg', { type: 'audio/ogg' }))
    form.append('model', 'whisper-1')
    form.append('language', 'pt')
    form.append('response_format', 'text')

    const groqRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY },
      body: form
    })
    if (!groqRes.ok) return null
    const transcricao = (await groqRes.text()).trim()
    return transcricao || null
  } catch(e) {
    console.warn('Erro transcrição:', e)
    return null
  }
}

// ── Processamento da transação (texto) ─────────────────────
async function processarTexto(chatId: number, text: string, sb: any) {
  const low = text.toLowerCase()

  // Verificar se tem pendente aguardando nome de categoria
  const { data: pendNome } = await sb.from('bot_pendentes').select('*')
    .eq('chat_id', chatId).eq('estado', 'aguardando_nome_cat')
    .order('created_at', { ascending: false }).limit(1)

  if (pendNome && pendNome.length > 0 && !text.startsWith('/')) {
    const pend = pendNome[0]
    const tipo = pend.dados.tipo || 'despesa'
    const { data: novaCat } = await sb.from('categorias').insert({
      nome: text, icone: tipo === 'receita' ? '💵' : '📦', cor: '#6B7280', tipo
    }).select().single()
    if (novaCat) {
      const tx = pend.dados
      tx.categoria_id = novaCat.id
      const { error } = await sb.from('transacoes').insert(tx)
      await sb.from('bot_pendentes').delete().eq('id', pend.id)
      if (error) { await reply(chatId, 'Erro: ' + error.message) }
      else {
        const sinal = tx.tipo === 'receita' ? '+' : '-'
        await reply(chatId, 'Categoria "' + text + '" criada e lancado!\n\nDescricao: ' + tx.descricao + '\nValor: ' + sinal + 'R$ ' + parseFloat(tx.valor).toFixed(2).replace('.', ','))
      }
    }
    return
  }

  // Comandos
  if (text === '/start' || text === '/ajuda') {
    const help = [
      'Financas Bot — Patrimoni', '',
      'Formatos de texto:', '<code>50 nubank restaurante</code>',
      '<code>150 sicoob mercado</code>', '<code>recebi 5000 salario</code>', '',
      'Tambem aceita mensagens de voz! 🎤', 'Fale naturalmente: "gastei 80 no almoço no nubank"', '',
      '/saldo — saldo das contas', '/faturas — faturas dos cartoes', '/ajuda — esta mensagem'
    ].join('\n')
    await reply(chatId, help); return
  }
  if (text === '/saldo') {
    const { data: contas } = await sb.from('contas').select('nome,saldo').eq('ativo', true)
    if (!contas || !contas.length) { await reply(chatId, 'Nenhuma conta cadastrada.'); return }
    const total = contas.reduce((s: number, c: any) => s + parseFloat(c.saldo), 0)
    const linhas = contas.map((c: any) => '- ' + c.nome + ': R$ ' + parseFloat(c.saldo).toFixed(2).replace('.', ','))
    linhas.push('\nTotal: R$ ' + total.toFixed(2).replace('.', ','))
    await reply(chatId, '<b>Saldo das Contas</b>\n\n' + linhas.join('\n')); return
  }
  if (text === '/faturas') {
    const { data: cartoes } = await sb.from('cartoes').select('*').eq('ativo', true)
    if (!cartoes || !cartoes.length) { await reply(chatId, 'Nenhum cartao cadastrado.'); return }
    const now = new Date()
    const linhas: string[] = []
    for (const c of cartoes) {
      const f = c.dia_fechamento
      const inicio = now.getDate() >= f ? new Date(now.getFullYear(), now.getMonth(), f) : new Date(now.getFullYear(), now.getMonth()-1, f)
      const fim    = now.getDate() >= f ? new Date(now.getFullYear(), now.getMonth()+1, f-1) : new Date(now.getFullYear(), now.getMonth(), f-1)
      const { data: txs } = await sb.from('transacoes').select('valor')
        .eq('cartao_id', c.id).eq('tipo', 'despesa')
        .gte('data', inicio.toISOString().split('T')[0])
        .lte('data', fim.toISOString().split('T')[0])
      const total = (txs||[]).reduce((s: number, t: any) => s + Math.abs(parseFloat(t.valor)), 0)
      linhas.push('- ' + c.nome + ': R$ ' + total.toFixed(2).replace('.', ',') + ' (vence dia ' + c.dia_vencimento + ')')
    }
    await reply(chatId, '<b>Faturas Atuais</b>\n\n' + linhas.join('\n')); return
  }

  // Lançar transação
  const matchValor = text.match(/(\d+[.,]?\d*)/)
  if (!matchValor) { await reply(chatId, 'Nao entendi o valor.\nExemplo: <code>50 nubank restaurante</code>'); return }
  const valor = parseFloat(matchValor[1].replace(',', '.'))
  const isReceita = /receb|receita|entrada|salario/i.test(text)
  const tipo = isReceita ? 'receita' : 'despesa'

  const cartoes: any[] = (await sb.from('cartoes').select('*').eq('ativo', true)).data || []
  const contas: any[]  = (await sb.from('contas').select('*').eq('ativo', true)).data || []
  const cats: any[]    = (await sb.from('categorias').select('*').eq('tipo', tipo)).data || []

  const cartao = cartoes.find((c: any) => c.nome.toLowerCase().split(' ').some((w: string) => w.length > 2 && low.includes(w)))
  const conta  = !cartao ? contas.find((c: any) => c.nome.toLowerCase().split(' ').some((w: string) => w.length > 2 && low.includes(w))) : null
  const cat    = cats.find((c: any) => c.nome.toLowerCase().split(' ').some((w: string) => w.length > 3 && low.includes(w)))

  let desc = text.replace(/\d+[.,]?\d*/g,'').replace(/receb\w*|receita|entrada|salario/gi,'').trim().replace(/\s+/g,' ')
  if (!desc) desc = isReceita ? 'Receita' : 'Gasto'
  desc = desc.charAt(0).toUpperCase() + desc.slice(1)

  const payload: any = {
    data: new Date().toISOString().split('T')[0],
    descricao: desc, valor, tipo,
    subtipo: isReceita ? null : 'variavel',
    categoria_id: cat?.id || null,
    conta_id:  conta?.id || null,
    cartao_id: cartao?.id || null,
    observacao: 'Via Telegram',
  }

  // Categoria encontrada → lança direto
  if (cat) {
    const { error } = await sb.from('transacoes').insert(payload)
    if (error) { await reply(chatId, 'Erro: ' + error.message); return }
    const onde = cartao ? 'Cartao: ' + cartao.nome : conta ? 'Conta: ' + conta.nome : 'Sem conta/cartao'
    await reply(chatId, (isReceita ? 'Lancado!' : 'Lancado!') + '\n\nDescricao: ' + desc +
      '\nValor: ' + (isReceita?'+':'-') + 'R$ ' + valor.toFixed(2).replace('.', ',') +
      '\nCategoria: ' + cat.nome + '\n' + onde)
    return
  }

  // Categoria não encontrada → salvar pendente + mostrar botões
  const { data: pendente } = await sb.from('bot_pendentes')
    .insert({ chat_id: chatId, dados: payload, estado: 'aguardando_categoria' }).select().single()
  if (!pendente) { await reply(chatId, 'Erro interno.'); return }

  const keyboard: any[] = []
  for (let i = 0; i < cats.length; i += 2) {
    const row: any[] = [{ text: cats[i].icone + ' ' + cats[i].nome, callback_data: 'cat:' + cats[i].id + ':' + pendente.id }]
    if (cats[i+1]) row.push({ text: cats[i+1].icone + ' ' + cats[i+1].nome, callback_data: 'cat:' + cats[i+1].id + ':' + pendente.id })
    keyboard.push(row)
  }
  keyboard.push([{ text: '+ Nova categoria', callback_data: 'nova:' + pendente.id }])
  await reply(chatId, 'Nao reconheci a categoria de "<b>' + desc + '</b>". Qual categoria?', { reply_markup: { inline_keyboard: keyboard } })
}

// ── Servidor principal ─────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('OK')
  let body: any
  try { body = await req.json() } catch { return new Response('OK') }

  const sb = createClient(SB_URL, SB_KEY)

  // ── Callback Query (botões) ──────────────────────────────
  const cb = body?.callback_query
  if (cb) {
    const cbId = cb.id, cbChat = cb.message.chat.id, cbMsgId = cb.message.message_id
    const data: string = cb.data
    await answerCb(cbId)
    await call('editMessageReplyMarkup', { chat_id: cbChat, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } })

    if (data.startsWith('cat:')) {
      const [,catId,pendId] = data.split(':')
      const { data: pend } = await sb.from('bot_pendentes').select('dados').eq('id', pendId).single()
      if (!pend) { await reply(cbChat, 'Transacao expirada. Manda de novo!'); return new Response('OK') }
      const tx = pend.dados; tx.categoria_id = catId
      const { error } = await sb.from('transacoes').insert(tx)
      await sb.from('bot_pendentes').delete().eq('id', pendId)
      if (error) { await reply(cbChat, 'Erro: ' + error.message) }
      else {
        const { data: catData } = await sb.from('categorias').select('nome').eq('id', catId).single()
        const sinal = tx.tipo === 'receita' ? '+' : '-'
        const onde = tx.cartao_id ? 'Cartao definido' : tx.conta_id ? 'Conta definida' : 'Sem conta/cartao'
        await reply(cbChat, 'Lancado!\n\nDescricao: ' + tx.descricao + '\nValor: ' + sinal + 'R$ ' + parseFloat(tx.valor).toFixed(2).replace('.', ',') + '\nCategoria: ' + (catData?.nome||'') + '\n' + onde)
      }
    } else if (data.startsWith('nova:')) {
      const pendId = data.split(':')[1]
      await sb.from('bot_pendentes').update({ estado: 'aguardando_nome_cat' }).eq('id', pendId)
      await reply(cbChat, 'Qual o nome da nova categoria? (ex: <code>Academia</code>)')
    }
    return new Response('OK')
  }

  // ── Mensagem normal ──────────────────────────────────────
  const msg = body?.message
  if (!msg) return new Response('OK')
  const chatId: number = msg.chat.id

  // 🎤 ÁUDIO / VOZ
  const voiceObj = msg.voice || msg.audio
  if (voiceObj) {
    if (!OPENAI_KEY) {
      await reply(chatId, '⚠️ Transcrição de áudio não configurada.\n\nAdicione a variável <code>OPENAI_API_KEY</code> nos Secrets do Supabase.')
      return new Response('OK')
    }
    await reply(chatId, '🎤 Transcrevendo seu áudio...')
    const transcricao = await transcribeAudio(voiceObj.file_id)
    if (!transcricao) {
      await reply(chatId, '❌ Não consegui transcrever o áudio. Tente falar mais claramente ou use texto.')
      return new Response('OK')
    }
    await reply(chatId, '📝 Entendi: "<i>' + transcricao + '</i>"\n\nProcessando...')
    await processarTexto(chatId, transcricao, sb)
    return new Response('OK')
  }

  // 💬 TEXTO
  if (!msg.text) return new Response('OK')
  await processarTexto(chatId, msg.text.trim(), sb)
  return new Response('OK')
})
