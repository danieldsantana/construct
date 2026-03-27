# pages/3_Estoque.py — CONSTRUCT
import streamlit as st
import pandas as pd
from db.models import get_session, Material, MaterialRecebido, MaterialPrevisto, Trecho, RecebimentoMateriais
from db.auth import requer_login
from sqlalchemy import func
from ui import rodape

requer_login()
st.set_page_config(page_title="Estoque · CONSTRUCT", page_icon="📊", layout="wide")
st.title("📊 Estoque")
st.divider()

session = get_session()

trechos        = session.query(Trecho).order_by(Trecho.sigla_trecho).all()
trechos_ativos = trechos  # todos os trechos cadastrados

# ── Query: recebido por material e trecho ─────────────────────────────────────
recebido_rows = (
    session.query(
        Material.id.label("mat_id"),
        Material.nome_material.label("nome"),
        Material.unidade.label("unidade"),
        Material.categoria.label("categoria"),
        MaterialRecebido.id_trecho.label("id_trecho"),
        func.sum(MaterialRecebido.quantidade).label("qtd_rec"),
    )
    .join(MaterialRecebido, MaterialRecebido.id_material == Material.id)
    .group_by(Material.id, Material.nome_material, Material.unidade,
              Material.categoria, MaterialRecebido.id_trecho)
    .all()
)

# Query: itens sem trecho
sem_trecho_rows = (
    session.query(
        Material.id.label("mat_id"),
        Material.nome_material.label("nome"),
        Material.unidade.label("unidade"),
        Material.categoria.label("categoria"),
        MaterialRecebido.id.label("mr_id"),
        MaterialRecebido.quantidade.label("qtd"),
        MaterialRecebido.id_recebimento.label("id_rec"),
    )
    .join(Material, Material.id == MaterialRecebido.id_material)
    .filter(MaterialRecebido.id_trecho == None)
    .all()
)

# Query: previsto por material e trecho
previsto_rows = (
    session.query(
        MaterialPrevisto.id_material.label("mat_id"),
        MaterialPrevisto.id_trecho.label("id_trecho"),
        MaterialPrevisto.quantidade_prev.label("qtd_prev"),
    ).all()
)

# Mapa de id_trecho -> sigla
# Mapa de id_trecho -> sigla  (dict simples, independente da sessão)
trecho_sigla  = {t.id: t.sigla_trecho for t in trechos}
siglas_ativas = [t.sigla_trecho for t in trechos_ativos]  # lista simples
session.close()

# ── Filtros ───────────────────────────────────────────────────────────────────
col_f1, col_f2, col_f3 = st.columns([3, 2, 2])
with col_f1:
    busca = st.text_input("🔍 Buscar material", placeholder="Ex: parafuso, tronco, para-raio...")
with col_f2:
    cats = sorted(set(r.categoria for r in recebido_rows)) if recebido_rows else []
    cat_filtro = st.selectbox("Categoria", ["Todas"] + cats)
with col_f3:
    pass  # espaço

# ── Métricas rápidas ──────────────────────────────────────────────────────────
total_itens = sum(float(r.qtd_rec) for r in recebido_rows if r.id_trecho is not None)
sem_trecho_qtd = len(sem_trecho_rows)

col_m1, col_m2, col_m3 = st.columns(3)
col_m1.metric("Total de Itens Recebidos (com trecho)", f"{total_itens:,.0f}".replace(",", "."))
col_m2.metric("Itens Sem Trecho Definido", sem_trecho_qtd,
              delta="⚠️ Pendentes" if sem_trecho_qtd > 0 else None,
              delta_color="inverse" if sem_trecho_qtd > 0 else "off")
col_m3.metric("Tipos de Material com Recebimento", len(set(r.mat_id for r in recebido_rows)))

st.divider()

# ── Abas ──────────────────────────────────────────────────────────────────────
aba_geral, aba_trecho, aba_sem_trecho = st.tabs([
    "📦 Recebido vs Previsto",
    "🗂️ Por Trecho",
    f"⚠️ Sem Trecho ({sem_trecho_qtd})"
])

# Monta dataframe base
def build_df(busca, cat_filtro):
    data = {}
    for r in recebido_rows:
        key = (r.mat_id, r.nome, r.unidade, r.categoria)
        if key not in data:
            data[key] = {}
        sigla = trecho_sigla.get(r.id_trecho, "SEM_TRECHO") if r.id_trecho else "SEM_TRECHO"
        data[key][sigla] = data[key].get(sigla, 0) + float(r.qtd_rec)

    prev_map = {}
    for p in previsto_rows:
        sigla = trecho_sigla.get(p.id_trecho, "")
        if p.mat_id not in prev_map:
            prev_map[p.mat_id] = {}
        prev_map[p.mat_id][sigla] = float(p.qtd_prev)

    rows = []
    for (mat_id, nome, unidade, categoria), por_trecho in data.items():
        row = {"mat_id": mat_id, "Material": nome, "Unid.": unidade, "Categoria": categoria}
        for sigla in siglas_ativas:          # ← usa lista simples de strings
            rec  = por_trecho.get(sigla, 0)
            prev = prev_map.get(mat_id, {}).get(sigla, 0)
            row[f"Prev {sigla}"]  = prev
            row[f"Rec {sigla}"]   = rec
            row[f"Saldo {sigla}"] = rec - prev
        rows.append(row)

    df = pd.DataFrame(rows)
    if not df.empty and "mat_id" in df.columns:
        df = df.drop(columns=["mat_id"])

    if busca and len(busca) >= 2:
        df = df[df["Material"].str.contains(busca, case=False, na=False)]
    if cat_filtro != "Todas":
        df = df[df["Categoria"] == cat_filtro]

    return df

with aba_geral:
    df = build_df(busca, cat_filtro)
    if df.empty:
        st.info("Nenhum dado encontrado para os filtros selecionados.")
    else:
        saldo_cols = [c for c in df.columns if c.startswith("Saldo")]

        def highlight_saldo(val):
            if isinstance(val, (int, float)) and val < 0:
                return "color: #c0392b; font-weight: bold"
            return ""

        df_exib = df.drop(columns=["Categoria"])
        if saldo_cols:
            styled = df_exib.style.map(highlight_saldo, subset=saldo_cols)
        else:
            styled = df_exib.style
        st.dataframe(styled, use_container_width=True, hide_index=True, height=500)
        st.caption(f"Exibindo {len(df)} material(is). Saldo negativo = déficit em relação ao previsto.")

with aba_trecho:
    trecho_sel_key = st.selectbox(
        "Selecione o trecho",
        options=[f"{t.sigla_trecho} — {t.nome_trecho}" for t in trechos_ativos],
        key="sel_trecho_aba"
    )
    sigla_sel = trecho_sel_key.split(" — ")[0] if trecho_sel_key else (siglas_ativas[0] if siglas_ativas else "")

    df_t = build_df(busca, cat_filtro)
    colunas_trecho = ["Material", "Unid.", f"Prev {sigla_sel}", f"Rec {sigla_sel}", f"Saldo {sigla_sel}"]
    colunas_existentes = [c for c in colunas_trecho if c in df_t.columns]
    df_t = df_t[colunas_existentes]
    df_t = df_t[df_t[f"Rec {sigla_sel}"] > 0] if f"Rec {sigla_sel}" in df_t.columns else df_t

    if df_t.empty:
        st.info(f"Nenhum material recebido para {sigla_sel} ainda.")
    else:
        saldo_col = f"Saldo {sigla_sel}"
        if saldo_col in df_t.columns:
            styled_t = df_t.style.map(
                lambda v: "color: #c0392b; font-weight: bold" if isinstance(v, (int, float)) and v < 0 else "",
                subset=[saldo_col]
            )
        else:
            styled_t = df_t.style
        st.dataframe(styled_t, use_container_width=True, hide_index=True, height=500)

with aba_sem_trecho:
    st.markdown("Itens recebidos **sem trecho definido**. Edite cada item para associá-lo ao trecho correto.")

    if not sem_trecho_rows:
        st.success("✅ Todos os itens recebidos têm trecho definido.")
    else:
        # Agrupa por recebimento para exibição
        s_edit = get_session()
        trechos_edit = s_edit.query(Trecho).order_by(Trecho.sigla_trecho).all()
        trecho_edit_opcoes = {f"{t.sigla_trecho} — {t.nome_trecho}": t.id for t in trechos_edit}

        for row in sem_trecho_rows:
            with st.expander(f"📦 {row.nome} — {float(row.qtd):,.0f} {row.unidade}"):
                rec_info = s_edit.get(RecebimentoMateriais, row.id_rec)
                st.caption(f"Romaneio: **{rec_info.romaneio if rec_info else '—'}**")
                trecho_novo = st.selectbox(
                    "Definir trecho",
                    options=list(trecho_edit_opcoes.keys()),
                    key=f"trecho_sem_{row.mr_id}"
                )
                if st.button("💾 Salvar trecho", key=f"salvar_trecho_{row.mr_id}"):
                    upd = s_edit.get(MaterialRecebido, row.mr_id)
                    upd.id_trecho = trecho_edit_opcoes[trecho_novo]
                    s_edit.commit()
                    st.success("Trecho atualizado!")
                    st.rerun()

        s_edit.close()

rodape()
