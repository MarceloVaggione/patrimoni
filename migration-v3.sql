-- =====================================================
-- PATRIMONI — MIGRATION V3 — INVESTIMENTOS
-- Execute no SQL Editor do Supabase
-- =====================================================

-- 1. INVESTIMENTOS
CREATE TABLE IF NOT EXISTS investimentos (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        TEXT NOT NULL,
  instituicao TEXT,
  tipo        TEXT NOT NULL DEFAULT 'renda_fixa',
  valor_atual DECIMAL(15,2) NOT NULL DEFAULT 0,
  observacoes TEXT,
  ativo       BOOLEAN DEFAULT true,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MOVIMENTAÇÕES (aportes, resgates, rendimentos)
CREATE TABLE IF NOT EXISTS movimentacoes_investimento (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  investimento_id  UUID NOT NULL REFERENCES investimentos(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL,  -- 'aporte' | 'resgate' | 'rendimento'
  valor            DECIMAL(15,2) NOT NULL,
  data             DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Índice para performance
CREATE INDEX IF NOT EXISTS idx_mov_invest_id ON movimentacoes_investimento(investimento_id);
CREATE INDEX IF NOT EXISTS idx_mov_invest_data ON movimentacoes_investimento(data);

-- 4. Desabilitar RLS (uso pessoal)
ALTER TABLE investimentos              DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes_investimento DISABLE ROW LEVEL SECURITY;

-- Verificação
SELECT 'investimentos'             AS tabela, COUNT(*) AS registros FROM investimentos
UNION ALL
SELECT 'movimentacoes_investimento', COUNT(*) FROM movimentacoes_investimento;
