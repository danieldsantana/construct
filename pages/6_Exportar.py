# pages/6_Exportar.py — CONSTRUCT
import streamlit as st
from datetime import datetime, timezone, timedelta
from db.auth import requer_login, is_operador
from db.models import get_session
from exportar_recebimento import gerar_planilha
from sqlalchemy import text
from ui import rodape
import io

requer_login()

st.set_page_config(page_title="Exportar", page_icon="📥", layout="centered")
st.title("📥 Exportar Dados")
st.divider()

BRASILIA = timezone(timedelta(hours=-3))
agora    = datetime.now(BRASILIA).strftime("%Y-%m-%d_%H-%M")

session = get_session()
try:
    trechos = session.execute(
        text("SELECT id, sigla_trecho, nome_trecho FROM trecho ORDER BY id")
    ).fetchall()
    trechos = [dict(id=r[0], sigla=r[1], nome=r[2]) for r in trechos]

    # Verifica quais trechos têm recebimentos
    com_dados = set()
    for tr in trechos:
        n = session.execute(
            text("""SELECT COUNT(*) FROM material_recebido
                    WHERE id_trecho = :t"""),
            {"t": tr["id"]}
        ).scalar()
        if n:
            com_dados.add(tr["id"])
finally:
    session.close()

# ── Planilha de Recebimento ───────────────────────────────────────────────────
st.subheader("📊 Controle de Recebimento")
st.caption(
    "Planilha com materiais agrupados por tipo de torre, "
    "quantidades recebidas por NF e totais por canteiro."
)

if not com_dados:
    st.warning("Nenhum recebimento lançado ainda.")
else:
    trecho_opts = {
        f"{tr['sigla']} — {tr['nome']}": tr["id"]
        for tr in trechos if tr["id"] in com_dados
    }
    selecionado = st.selectbox("Trecho", list(trecho_opts.keys()))
    id_trecho   = trecho_opts[selecionado]
    sigla       = selecionado.split(" — ")[0].replace("-", "_")

    if st.button("⬇️ Gerar Planilha Excel", type="primary", use_container_width=True):
        with st.spinner("Gerando planilha..."):
            session = get_session()
            try:
                xlsx = gerar_planilha(session, id_trecho)
                st.download_button(
                    label="📄 Baixar Excel",
                    data=xlsx,
                    file_name=f"Recebimento_{sigla}_{agora}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True,
                )
            except Exception as e:
                st.error(f"Erro ao gerar planilha: {e}")
                raise
            finally:
                session.close()

st.divider()

# ── CSV (operadores e admins) ─────────────────────────────────────────────────
st.subheader("📋 Exportar CSV")

if not is_operador():
    st.caption("🔒 Disponível apenas para Operadores e Administradores.")
else:
    st.caption("Exporta as tabelas principais para CSV (backup / análise externa).")
    if st.button("⬇️ Gerar CSV", use_container_width=True):
        with st.spinner("Gerando..."):
            session = get_session()
            try:
                import pandas as pd
                buf = io.StringIO()

                def secao(titulo, query, params=None):
                    rows = session.execute(text(query), params or {}).fetchall()
                    cols = session.execute(text(query), params or {}).keys()
                    df   = pd.DataFrame(rows, columns=list(cols))
                    buf.write(f"### {titulo}\n")
                    df.to_csv(buf, index=False, encoding="utf-8")
                    buf.write("\n")

                secao("MATERIAIS", """
                    SELECT m.id, m.nome_material, m.categoria, m.unidade,
                           m.peso_galvanizado
                    FROM material m ORDER BY m.categoria, m.nome_material
                """)
                secao("NOTAS FISCAIS", """
                    SELECT nf.numero_nota, nf.data_emissao, nf.valor,
                           rm.romaneio, rm.data_recebimento,
                           ca.nome_canteiro, tr.sigla_trecho
                    FROM nota_fiscal nf
                    JOIN recebimento_materiais rm ON nf.id_recebimento = rm.id
                    JOIN canteiro ca ON rm.id_canteiro = ca.id
                    JOIN trecho tr ON rm.id_trecho = tr.id
                    ORDER BY rm.data_recebimento, nf.numero_nota
                """)
                secao("MATERIAL RECEBIDO", """
                    SELECT tr.sigla_trecho, nf.numero_nota,
                           m.nome_material, mr.quantidade
                    FROM material_recebido mr
                    JOIN nota_fiscal nf ON mr.id_nota = nf.id
                    JOIN material m ON mr.id_material = m.id
                    JOIN trecho tr ON mr.id_trecho = tr.id
                    ORDER BY tr.sigla_trecho, nf.numero_nota, m.nome_material
                """)
                secao("MATERIAL PREVISTO", """
                    SELECT tr.sigla_trecho, m.nome_material,
                           mp.quantidade_prev
                    FROM material_previsto mp
                    JOIN material m ON mp.id_material = m.id
                    JOIN trecho tr ON mp.id_trecho = tr.id
                    ORDER BY tr.sigla_trecho, m.nome_material
                """)

                st.download_button(
                    label="📋 Baixar CSV",
                    data=buf.getvalue().encode("utf-8-sig"),
                    file_name=f"construct_dados_{agora}.csv",
                    mime="text/csv",
                    use_container_width=True,
                )
            except Exception as e:
                st.error(f"Erro: {e}"); raise
            finally:
                session.close()

rodape()
