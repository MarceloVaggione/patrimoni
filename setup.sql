-- =====================================================
-- FINANÇAS PESSOAIS — SETUP DO BANCO DE DADOS
-- Execute este script no SQL Editor do Supabase
-- =====================================================

-- 1. CATEGORIAS
CREATE TABLE IF NOT EXISTS categorias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  cor TEXT DEFAULT '#6B7280',
  icone TEXT DEFAULT '📦',
  tipo TEXT DEFAULT 'despesa',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CONTAS BANCÁRIAS
CREATE TABLE IF NOT EXISTS contas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT DEFAULT 'corrente',
  saldo DECIMAL(15,2) DEFAULT 0,
  cor TEXT DEFAULT '#3B82F6',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CARTÕES DE CRÉDITO
CREATE TABLE IF NOT EXISTS cartoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  limite DECIMAL(15,2) DEFAULT 0,
  dia_fechamento INTEGER DEFAULT 1,
  dia_vencimento INTEGER DEFAULT 10,
  cor TEXT DEFAULT '#8B5CF6',
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TRANSAÇÕES
CREATE TABLE IF NOT EXISTS transacoes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  descricao TEXT NOT NULL,
  valor DECIMAL(15,2) NOT NULL,
  tipo TEXT NOT NULL,
  categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
  conta_id UUID REFERENCES contas(id) ON DELETE SET NULL,
  cartao_id UUID REFERENCES cartoes(id) ON DELETE SET NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- CATEGORIAS PADRÃO
-- =====================================================
INSERT INTO categorias (nome, cor, icone, tipo) VALUES
  ('Alimentação',        '#F59E0B', '🍔', 'despesa'),
  ('Mercado',            '#10B981', '🛒', 'despesa'),
  ('Transporte',         '#3B82F6', '🚗', 'despesa'),
  ('Saúde',              '#EF4444', '🏥', 'despesa'),
  ('Moradia',            '#8B5CF6', '🏠', 'despesa'),
  ('Lazer',              '#EC4899', '🎮', 'despesa'),
  ('Educação',           '#14B8A6', '📚', 'despesa'),
  ('Roupas',             '#F97316', '👗', 'despesa'),
  ('Assinaturas',        '#6366F1', '📱', 'despesa'),
  ('Pets',               '#84CC16', '🐾', 'despesa'),
  ('Viagem',             '#0EA5E9', '✈️',  'despesa'),
  ('Outros',             '#6B7280', '📦', 'despesa'),
  ('Salário',            '#10B981', '💰', 'receita'),
  ('Freelance',          '#22D3EE', '💻', 'receita'),
  ('Investimentos',      '#A78BFA', '📈', 'receita'),
  ('Outros Rendimentos', '#34D399', '💵', 'receita')
ON CONFLICT DO NOTHING;

-- =====================================================
-- DESABILITAR RLS (uso pessoal — anon key)
-- =====================================================
ALTER TABLE categorias  DISABLE ROW LEVEL SECURITY;
ALTER TABLE contas      DISABLE ROW LEVEL SECURITY;
ALTER TABLE cartoes     DISABLE ROW LEVEL SECURITY;
ALTER TABLE transacoes  DISABLE ROW LEVEL SECURITY;
