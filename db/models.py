# db/models.py — CONSTRUCT
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Numeric,
    Date, ForeignKey, DateTime, Text, Boolean
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

Base = declarative_base()


# ──────────────────────────────────────────────
# CLIENTES E OBRA
# ──────────────────────────────────────────────

class Cliente(Base):
    __tablename__ = "cliente"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    nome_cliente  = Column(String(200), nullable=False)
    cnpj_cliente  = Column(String(20), unique=True, nullable=True)

    obras = relationship("Obra", back_populates="cliente")


class Obra(Base):
    __tablename__ = "obra"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    id_cliente     = Column(Integer, ForeignKey("cliente.id"), nullable=True)
    nome_obra      = Column(String(200), nullable=False)
    data_contrato  = Column(Date, nullable=True)

    cliente  = relationship("Cliente", back_populates="obras")
    trechos  = relationship("Trecho", back_populates="obra")


# ──────────────────────────────────────────────
# TRECHOS E CANTEIROS
# ──────────────────────────────────────────────

class Trecho(Base):
    __tablename__ = "trecho"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    id_obra       = Column(Integer, ForeignKey("obra.id"), nullable=True)
    nome_trecho   = Column(String(200), nullable=False)   # "Buritirama → Barra"
    sigla_trecho  = Column(String(10), nullable=False)    # "T1", "T2"

    obra      = relationship("Obra", back_populates="trechos")
    canteiros = relationship("Canteiro", back_populates="trecho")
    torres    = relationship("Torre", back_populates="trecho")


class Canteiro(Base):
    """Local físico de recebimento — independente do trecho."""
    __tablename__ = "canteiro"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    nome_canteiro  = Column(String(100), nullable=False, unique=True)
    id_trecho      = Column(Integer, ForeignKey("trecho.id"), nullable=True)  # associação logística opcional

    trecho     = relationship("Trecho", back_populates="canteiros")
    recebimentos = relationship("RecebimentoMateriais", back_populates="canteiro")


# ──────────────────────────────────────────────
# FORNECEDORES
# ──────────────────────────────────────────────

class Fornecedor(Base):
    __tablename__ = "fornecedor"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    nome_fornecedor  = Column(String(200), nullable=False)

    unidades = relationship("UnidadeFornecedor", back_populates="fornecedor")


class UnidadeFornecedor(Base):
    """Filiais/unidades que emitem notas separadas."""
    __tablename__ = "unidade_fornecedor"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    id_fornecedor = Column(Integer, ForeignKey("fornecedor.id"), nullable=False)
    nome_unidade  = Column(String(200), nullable=False)
    cnpj_unidade  = Column(String(20), unique=True, nullable=True)

    fornecedor    = relationship("Fornecedor", back_populates="unidades")
    notas_fiscais = relationship("NotaFiscal", back_populates="unidade_fornecedor")


# ──────────────────────────────────────────────
# RECEBIMENTO
# ──────────────────────────────────────────────

class RecebimentoMateriais(Base):
    """Equivalente ao romaneio — agrupa notas de um mesmo recebimento físico."""
    __tablename__ = "recebimento_materiais"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    data_recebimento  = Column(Date, nullable=False)
    id_canteiro       = Column(Integer, ForeignKey("canteiro.id"), nullable=True)
    romaneio          = Column(String(50), nullable=True)
    criado_por        = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    criado_em         = Column(DateTime, default=datetime.utcnow)

    canteiro      = relationship("Canteiro", back_populates="recebimentos")
    notas_fiscais = relationship("NotaFiscal", back_populates="recebimento")
    materiais_recebidos = relationship("MaterialRecebido", back_populates="recebimento")


class NotaFiscal(Base):
    """Uma nota pertence a um romaneio; um romaneio pode ter múltiplas notas."""
    __tablename__ = "nota_fiscal"

    id                       = Column(Integer, primary_key=True, autoincrement=True)
    numero_nota              = Column(String(50), nullable=False, unique=True)
    data_emissao             = Column(Date, nullable=False)
    id_unidadef              = Column(Integer, ForeignKey("unidade_fornecedor.id"), nullable=True)
    valor                    = Column(Numeric(12, 2), nullable=True)
    peso                     = Column(Numeric(10, 3), nullable=True)
    id_recebimento           = Column(Integer, ForeignKey("recebimento_materiais.id"), nullable=True)
    identificador_drive_nota = Column(String(200), nullable=True)
    criado_por               = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    criado_em                = Column(DateTime, default=datetime.utcnow)

    unidade_fornecedor  = relationship("UnidadeFornecedor", back_populates="notas_fiscais")
    recebimento         = relationship("RecebimentoMateriais", back_populates="notas_fiscais")
    materiais_recebidos = relationship("MaterialRecebido", back_populates="nota")
    pendencias          = relationship("Pendencia", back_populates="nota_fiscal")


# ──────────────────────────────────────────────
# MATERIAIS
# ──────────────────────────────────────────────

class Material(Base):
    """Volumes, parafusos, para-raios, stubs — tudo na mesma tabela."""
    __tablename__ = "material"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    nome_material     = Column(String(300), nullable=False)
    unidade           = Column(String(20), nullable=False)
    categoria         = Column(String(50), nullable=False)   # "volume", "parafuso", "para-raio", "stub", "gabarito"
    peso_galvanizado  = Column(Numeric(10, 3), nullable=True)

    materiais_recebidos  = relationship("MaterialRecebido", back_populates="material")
    materiais_previstos  = relationship("MaterialPrevisto", back_populates="material")
    formacoes_componente = relationship("FormacaoComponente", back_populates="material")
    parafusos_componente = relationship("ParafusoComponente", back_populates="material")


class MaterialRecebido(Base):
    """O que foi efetivamente recebido. id_trecho nullable para lançar sem trecho definido."""
    __tablename__ = "material_recebido"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    id_material     = Column(Integer, ForeignKey("material.id"), nullable=False)
    id_recebimento  = Column(Integer, ForeignKey("recebimento_materiais.id"), nullable=False)
    id_nota         = Column(Integer, ForeignKey("nota_fiscal.id"), nullable=True)
    id_trecho       = Column(Integer, ForeignKey("trecho.id"), nullable=True)   # nullable: trecho a definir depois
    quantidade      = Column(Numeric(10, 3), nullable=False)

    material    = relationship("Material", back_populates="materiais_recebidos")
    recebimento = relationship("RecebimentoMateriais", back_populates="materiais_recebidos")
    nota        = relationship("NotaFiscal", back_populates="materiais_recebidos")
    trecho      = relationship("Trecho")


class MaterialPrevisto(Base):
    """Calculado automaticamente. Nunca inserido manualmente."""
    __tablename__ = "material_previsto"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    id_material     = Column(Integer, ForeignKey("material.id"), nullable=False)
    id_trecho       = Column(Integer, ForeignKey("trecho.id"), nullable=False)
    quantidade_prev = Column(Numeric(10, 3), nullable=False)

    material = relationship("Material", back_populates="materiais_previstos")
    trecho   = relationship("Trecho")

    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint("id_material", "id_trecho"),
    )


# ──────────────────────────────────────────────
# TORRES — TIPOS E COMPOSIÇÃO
# ──────────────────────────────────────────────

class TorreGrupo(Base):
    __tablename__ = "torre_grupo"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    torre_grupo_nome = Column(String(50), nullable=False)   # "Estaiada", "Autoportante"

    tipos = relationship("TorreTipo", back_populates="grupo")


class TorreTipo(Base):
    __tablename__ = "torre_tipo"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    torre_tipo         = Column(String(20), nullable=False)   # "C61CRE", "C4EL"
    id_torre_grupo     = Column(Integer, ForeignKey("torre_grupo.id"), nullable=True)
    quantidade_mastros = Column(Integer, nullable=False, default=1)

    grupo       = relationship("TorreGrupo", back_populates="tipos")
    componentes = relationship("Componente", back_populates="torre_tipo")
    torres      = relationship("Torre", back_populates="torre_tipo")


class AlturaTorre(Base):
    __tablename__ = "altura_torre"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    altura_util_metros = Column(Numeric(5, 1), nullable=False)


class Componente(Base):
    """Sempre vinculado a um tipo de torre. 'Tronco Superior C61CRE' ≠ 'Tronco Superior C4EL'."""
    __tablename__ = "componente"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    id_torre_tipo   = Column(Integer, ForeignKey("torre_tipo.id"), nullable=False)
    nome_componente = Column(String(200), nullable=False)

    torre_tipo           = relationship("TorreTipo", back_populates="componentes")
    formacoes_componente = relationship("FormacaoComponente", back_populates="componente")
    formacoes_altura     = relationship("FormacaoAltura", back_populates="componente")
    parafusos            = relationship("ParafusoComponente", back_populates="componente")


class FormacaoComponente(Base):
    """Quais volumes (materiais) formam um componente."""
    __tablename__ = "formacao_componente"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    id_componente = Column(Integer, ForeignKey("componente.id"), nullable=False)
    id_material   = Column(Integer, ForeignKey("material.id"), nullable=False)

    componente = relationship("Componente", back_populates="formacoes_componente")
    material   = relationship("Material", back_populates="formacoes_componente")


class FormacaoAltura(Base):
    """Para cada combinação tipo+altura, quantos de cada componente são necessários."""
    __tablename__ = "formacao_altura"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    id_torre_tipo   = Column(Integer, ForeignKey("torre_tipo.id"), nullable=False)
    id_altura_torre = Column(Integer, ForeignKey("altura_torre.id"), nullable=False)
    id_componente   = Column(Integer, ForeignKey("componente.id"), nullable=False)
    quantidade      = Column(Integer, nullable=False)

    torre_tipo   = relationship("TorreTipo")
    altura_torre = relationship("AlturaTorre")
    componente   = relationship("Componente", back_populates="formacoes_altura")

    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint("id_torre_tipo", "id_altura_torre", "id_componente"),
    )


class ParafusoComponente(Base):
    """Parafusos por componente — para cálculo do previsto. Parafusos são a granel."""
    __tablename__ = "parafuso_componente"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    id_componente = Column(Integer, ForeignKey("componente.id"), nullable=False)
    id_material   = Column(Integer, ForeignKey("material.id"), nullable=False)
    quantidade    = Column(Integer, nullable=False)

    componente = relationship("Componente", back_populates="parafusos")
    material   = relationship("Material", back_populates="parafusos_componente")

    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint("id_componente", "id_material"),
    )


# ──────────────────────────────────────────────
# TORRES INDIVIDUAIS
# ──────────────────────────────────────────────

class Torre(Base):
    """Cada torre física da lista de construção."""
    __tablename__ = "torre"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    torre_nome      = Column(String(50), nullable=False)   # "0/1", "47/2"
    id_trecho       = Column(Integer, ForeignKey("trecho.id"), nullable=False)
    id_torre_tipo   = Column(Integer, ForeignKey("torre_tipo.id"), nullable=False)
    id_altura_torre = Column(Integer, ForeignKey("altura_torre.id"), nullable=False)
    # Pés para autoportantes (NULL para estaiadas e cross-rope)
    id_mat_pe_a     = Column(Integer, ForeignKey("componente.id"), nullable=True)
    id_mat_pe_b     = Column(Integer, ForeignKey("componente.id"), nullable=True)
    id_mat_pe_c     = Column(Integer, ForeignKey("componente.id"), nullable=True)
    id_mat_pe_d     = Column(Integer, ForeignKey("componente.id"), nullable=True)

    trecho      = relationship("Trecho", back_populates="torres")
    torre_tipo  = relationship("TorreTipo", back_populates="torres")
    altura_torre = relationship("AlturaTorre")


# ──────────────────────────────────────────────
# PENDÊNCIAS
# ──────────────────────────────────────────────

class Pendencia(Base):
    """Registro de não conformidades e qualquer problema no recebimento."""
    __tablename__ = "pendencia"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    descricao        = Column(Text, nullable=False)
    data_pendencia   = Column(Date, nullable=False)
    campo_afetado    = Column(String(100), nullable=True)
    status_resolucao = Column(String(20), nullable=False, default="aberta")   # "aberta", "resolvida"
    data_resolucao   = Column(Date, nullable=True)
    id_nota          = Column(Integer, ForeignKey("nota_fiscal.id"), nullable=True)
    id_recebimento   = Column(Integer, ForeignKey("recebimento_materiais.id"), nullable=True)
    id_material      = Column(Integer, ForeignKey("material.id"), nullable=True)
    quantidade_faltante = Column(Numeric(10, 3), nullable=True)
    criado_por       = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    criado_em        = Column(DateTime, default=datetime.utcnow)

    nota_fiscal  = relationship("NotaFiscal", back_populates="pendencias")
    recebimento  = relationship("RecebimentoMateriais")
    material     = relationship("Material")


# ──────────────────────────────────────────────
# USUÁRIOS
# ──────────────────────────────────────────────

class Usuario(Base):
    __tablename__ = "usuario"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    nome        = Column(String(100), nullable=False)
    sobrenome   = Column(String(100), nullable=True)
    email       = Column(String(150), nullable=True)
    funcao      = Column(String(100), nullable=True)
    login       = Column(String(50), nullable=False, unique=True)
    senha_hash  = Column(String(200), nullable=False)
    perfil      = Column(String(20), nullable=False, default="operador")   # admin / operador / visualizador
    ativo       = Column(Boolean, default=True, nullable=False)
    criado_em   = Column(DateTime, default=datetime.utcnow)


# ──────────────────────────────────────────────
# ENGINE & SESSION
# ──────────────────────────────────────────────

def get_engine():
    url = os.getenv("DATABASE_URL")
    if not url:
        try:
            import streamlit as st
            url = st.secrets["DATABASE_URL"]
        except Exception:
            pass
    if not url:
        raise ValueError(
            "Variável DATABASE_URL não encontrada.\n"
            "Verifique o arquivo .env na raiz do projeto."
        )
    return create_engine(url, pool_pre_ping=True)


def get_session():
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    return Session()


def criar_tabelas():
    engine = get_engine()
    Base.metadata.create_all(engine)
    print("✅ Tabelas criadas com sucesso.")


if __name__ == "__main__":
    criar_tabelas()
