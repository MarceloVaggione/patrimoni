-- =====================================================
-- PATRIMONI — MIGRATION V4 — PLANEJAMENTO
-- Execute no SQL Editor do Supabase
-- =====================================================

-- 1. METAS FINANCEIRAS
CREATE TABLE IF NOT EXISTS metas (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome             TEXT NOT NULL,
  tipo             TEXT NOT NULL DEFAULT 'outro',
  valor_alvo       DECIMAL(15,2) NOT NULL,
  valor_atual      DECIMAL(15,2) DEFAULT 0,
  prazo            DATE,
  conta_id         UUID REFERENCES contas(id) ON DELETE SET NULL,
  investimento_id  UUID REFERENCES investimentos(id) ON DELETE SET NULL,
  cor              TEXT DEFAULT '#3B82F6',
  ativa            BOOLEAN DEFAULT true,
  observacoes      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ASSINATURAS
CREATE TABLE IF NOT EXISTS assinaturas (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome             TEXT NOT NULL,
  valor            DECIMAL(15,2) NOT NULL,
  periodicidade    TEXT NOT NULL DEFAULT 'mensal',
  subcategoria     TEXT DEFAULT 'outros',
  cartao_id        UUID REFERENCES cartoes(id) ON DELETE SET NULL,
  conta_id         UUID REFERENCES contas(id) ON DELETE SET NULL,
  categoria_id     UUID REFERENCES categorias(id) ON DELETE SET NULL,
  dia_cobranca     INTEGER,
  proxima_cobranca DATE,
  ativa            BOOLEAN DEFAULT true,
  data_inicio      DATE,
  observacoes      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Desabilitar RLS
ALTER TABLE metas       DISABLE ROW LEVEL SECURITY;
ALTER TABLE assinaturas DISABLE ROW LEVEL SECURITY;

-- Verificação
SELECT 'metas'       AS tabela, COUNT(*) AS registros FROM metas
UNION ALL
SELECT 'assinaturas', COUNT(*) FROM assinaturas;
