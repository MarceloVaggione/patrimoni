-- =====================================================
-- PATRIMONI — MIGRATION V2
-- Execute no SQL Editor do Supabase ANTES de usar
-- os novos módulos. Seguro para re-executar.
-- =====================================================

-- 1. Corrigir campo faltante em transacoes
ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS subtipo TEXT;
ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS recorrencia TEXT;
ALTER TABLE transacoes ADD COLUMN IF NOT EXISTS recorrencia_id UUID;

-- 2. Adicionar orçamento a categorias
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS orcamento_mensal DECIMAL(15,2);
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS subcategoria TEXT;

-- 3. ATIVOS
CREATE TABLE IF NOT EXISTS ativos (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome            TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'outro',
  valor_atual     DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_aquisicao DECIMAL(15,2),
  data_aquisicao  DATE,
  instituicao     TEXT,
  observacoes     TEXT,
  ativo           BOOLEAN DEFAULT true,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PASSIVOS
CREATE TABLE IF NOT EXISTS passivos (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome                 TEXT NOT NULL,
  tipo                 TEXT NOT NULL DEFAULT 'outro',
  saldo_devedor        DECIMAL(15,2) NOT NULL DEFAULT 0,
  valor_quitacao       DECIMAL(15,2),
  parcela_mensal       DECIMAL(15,2),
  parcelas_restantes   INTEGER,
  taxa_juros           DECIMAL(8,4),
  data_vencimento      DATE,
  instituicao          TEXT,
  ativo_relacionado_id UUID REFERENCES ativos(id) ON DELETE SET NULL,
  ativo                BOOLEAN DEFAULT true,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Desabilitar RLS (uso pessoal)
ALTER TABLE ativos   DISABLE ROW LEVEL SECURITY;
ALTER TABLE passivos DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
SELECT 'ativos'   AS tabela, COUNT(*) AS registros FROM ativos
UNION ALL
SELECT 'passivos' AS tabela, COUNT(*) AS registros FROM passivos;
