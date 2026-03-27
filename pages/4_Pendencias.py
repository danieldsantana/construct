# pages/4_Pendencias.py — CONSTRUCT
import streamlit as st
from datetime import date
from db.models import get_session, Pendencia, NotaFiscal, RecebimentoMateriais, Material
from db.auth import requer_operador, is_admin
from sqlalchemy import or_
from ui import rodape

requer_operador()
st.set_page_config(page_title="Pendências · CONSTRUCT", page_icon="⚠️", layout="wide")
st.title("⚠️ Pendências")
st.markdown("Registre materiais faltantes ou qualquer inconformidade identificada no recebimento.")
st.divider()

# ── Estado ────────────────────────────────────────────────────────────────────
if "editar_pend_id"         not in st.session_state: st.session_state.editar_pend_id         = None
if "confirmar_excluir_pend" not in st.session_state: st.session_state.confirmar_excluir_pend = None

editando = st.session_state.editar_pend_id is not None
pend_edit = None

if editando:
    s = get_session()
    pend_edit = s.get(Pendencia, st.session_state.editar_pend_id)
    s.close()

# ── Dados de domínio ──────────────────────────────────────────────────────────
session = get_session()
notas_db = session.query(NotaFiscal).order_by(NotaFiscal.numero_nota).all()
recs_db  = session.query(RecebimentoMateriais).order_by(RecebimentoMateriais.romaneio).all()
session.close()

notas_opcoes = {"— não vincular —": None}
for n in notas_db:
    notas_opcoes[f"NF {n.numero_nota}  ({n.data_emissao.strftime('%d/%m/%Y')})"] = n.id

recs_opcoes = {"— não vincular —": None}
for r in recs_db:
    recs_opcoes[f"ROM {r.romaneio}"] = r.id

# ── Formulário ────────────────────────────────────────────────────────────────
if editando:
    st.subheader(f"✏️ Editando Pendência #{pend_edit.id}")
else:
    st.subheader("Novo Registro")

# Busca de material (fora do form para reagir em tempo real)
st.markdown("**Material com pendência** (opcional para pendências genéricas)")
termo_mat = st.text_input("Buscar material", placeholder="Ex: tronco superior, parafuso M20...",
                           key="busca_pend_mat", label_visibility="collapsed")

resultados_mat = []
if termo_mat and len(termo_mat) >= 2:
    sm = get_session()
    resultados_mat = sm.query(Material).filter(Material.nome_material.ilike(f"%{termo_mat}%")).limit(20).all()
    sm.close()

mat_pend_opcoes = {"— sem material específico —": None}
for m in resultados_mat:
    mat_pend_opcoes[f"[{m.categoria.upper()[:3]}] {m.nome_material} [{m.unidade}]"] = m.id

mat_edit_key = "— sem material específico —"
if editando and pend_edit.id_material:
    sm2 = get_session()
    mat_atual = sm2.get(Material, pend_edit.id_material)
    sm2.close()
    if mat_atual:
        chave = f"[{mat_atual.categoria.upper()[:3]}] {mat_atual.nome_material} [{mat_atual.unidade}]"
        if chave not in mat_pend_opcoes:
            mat_pend_opcoes = {chave: mat_atual.id, **mat_pend_opcoes}
        mat_edit_key = chave

mat_escolhido = st.selectbox("Material", options=list(mat_pend_opcoes.keys()),
                               index=list(mat_pend_opcoes.keys()).index(mat_edit_key),
                               key="sel_mat_pend", label_visibility="collapsed")

with st.form("form_pendencia", clear_on_submit=not editando):
    col1, col2 = st.columns(2)
    with col1:
        descricao = st.text_area(
            "Descrição da Pendência *",
            value=pend_edit.descricao if editando else "",
            placeholder="Descreva o problema encontrado..."
        )
        campo_afetado = st.text_input(
            "Campo / Área afetada",
            value=pend_edit.campo_afetado or "" if editando else "",
            placeholder="Ex: nota fiscal, volume, parafuso..."
        )

    with col2:
        qtd_faltante = st.number_input(
            "Quantidade Faltante",
            min_value=0.0, step=1.0, format="%.2f",
            value=float(pend_edit.quantidade_faltante or 0) if editando else 0.0
        )
        nota_key_default = 0
        if editando and pend_edit.id_nota:
            for i, (k, v) in enumerate(notas_opcoes.items()):
                if v == pend_edit.id_nota:
                    nota_key_default = i; break
        nota_escolhida = st.selectbox("Nota Fiscal vinculada",
                                       options=list(notas_opcoes.keys()), index=nota_key_default)

        rec_key_default = 0
        if editando and pend_edit.id_recebimento:
            for i, (k, v) in enumerate(recs_opcoes.items()):
                if v == pend_edit.id_recebimento:
                    rec_key_default = i; break
        rec_escolhido = st.selectbox("Romaneio vinculado",
                                      options=list(recs_opcoes.keys()), index=rec_key_default)

    col_s, col_c = st.columns([4, 1])
    with col_s:
        submitted = st.form_submit_button(
            "💾 Salvar Alterações" if editando else "💾 Registrar Pendência",
            use_container_width=True, type="primary"
        )
    with col_c:
        cancelar = st.form_submit_button("✖ Cancelar", use_container_width=True)

if cancelar:
    st.session_state.editar_pend_id = None
    st.rerun()

if submitted:
    if not descricao.strip():
        st.error("A descrição é obrigatória.")
    else:
        sv = get_session()
        try:
            id_mat = mat_pend_opcoes.get(mat_escolhido)
            id_nota = notas_opcoes.get(nota_escolhida)
            id_rec  = recs_opcoes.get(rec_escolhido)

            if editando:
                p = sv.get(Pendencia, st.session_state.editar_pend_id)
                p.descricao          = descricao.strip()
                p.campo_afetado      = campo_afetado.strip() or None
                p.quantidade_faltante = qtd_faltante if qtd_faltante > 0 else None
                p.id_nota            = id_nota
                p.id_recebimento     = id_rec
                p.id_material        = id_mat
                sv.commit()
                st.success("✅ Pendência atualizada!")
                st.session_state.editar_pend_id = None
            else:
                sv.add(Pendencia(
                    descricao           = descricao.strip(),
                    data_pendencia      = date.today(),
                    campo_afetado       = campo_afetado.strip() or None,
                    quantidade_faltante = qtd_faltante if qtd_faltante > 0 else None,
                    id_nota             = id_nota,
                    id_recebimento      = id_rec,
                    id_material         = id_mat,
                    status_resolucao    = "aberta",
                    criado_por          = st.session_state.get("usuario_id"),
                ))
                sv.commit()
                st.success("✅ Pendência registrada!")
        except Exception as e:
            sv.rollback()
            st.error(f"❌ Erro: {e}")
        finally:
            sv.close()
        st.rerun()

# ── Lista ─────────────────────────────────────────────────────────────────────
st.divider()
st.subheader("Pendências Registradas")

col_f1, _ = st.columns([2, 4])
with col_f1:
    filtro_status = st.selectbox("Filtrar por status", ["Todas", "⏳ Abertas", "✅ Resolvidas"])

ls = get_session()
query = ls.query(Pendencia).order_by(Pendencia.criado_em.desc())
if filtro_status == "⏳ Abertas":
    query = query.filter(Pendencia.status_resolucao == "aberta")
elif filtro_status == "✅ Resolvidas":
    query = query.filter(Pendencia.status_resolucao == "resolvida")
pendencias = query.all()

dados_pend = []
for p in pendencias:
    nota_num = ls.get(NotaFiscal, p.id_nota).numero_nota if p.id_nota else "—"
    mat_nome = ls.get(Material, p.id_material).nome_material if p.id_material else "—"
    dados_pend.append({
        "id": p.id, "descricao": p.descricao,
        "nota": nota_num, "material": mat_nome,
        "qtd": float(p.quantidade_faltante) if p.quantidade_faltante else None,
        "campo": p.campo_afetado or "—",
        "status": p.status_resolucao,
        "data": p.data_pendencia.strftime("%d/%m/%Y"),
        "data_res": p.data_resolucao.strftime("%d/%m/%Y") if p.data_resolucao else "—",
        "criado_por": p.criado_por,
    })
ls.close()

if not dados_pend:
    st.info("Nenhuma pendência registrada.")
else:
    abertas = sum(1 for d in dados_pend if d["status"] == "aberta")
    if abertas:
        st.warning(f"⏳ {abertas} pendência(s) em aberto.")

    # Confirmação de exclusão
    if st.session_state.confirmar_excluir_pend:
        pid = st.session_state.confirmar_excluir_pend
        pd_del = next((d for d in dados_pend if d["id"] == pid), None)
        if pd_del:
            st.error(f"Excluir pendência: **{pd_del['descricao'][:60]}...**?")
            c1, c2 = st.columns(2)
            with c1:
                if st.button("🗑️ Sim, excluir", use_container_width=True):
                    ds = get_session()
                    try:
                        ds.query(Pendencia).filter_by(id=pid).delete()
                        ds.commit()
                        st.session_state.confirmar_excluir_pend = None
                    except Exception as e:
                        ds.rollback(); st.error(f"Erro: {e}")
                    finally:
                        ds.close()
                    st.rerun()
            with c2:
                if st.button("✖ Cancelar", use_container_width=True):
                    st.session_state.confirmar_excluir_pend = None
                    st.rerun()

    h = st.columns([0.8, 3, 1.5, 2, 1, 1, 0.6, 0.7, 0.6])
    for col, lbl in zip(h, ["**Data**", "**Descrição**", "**NF**", "**Material**",
                              "**Qtd**", "**Status**", "**✔**", "**✏️**", "**🗑️**"]):
        col.markdown(lbl)

    for d in dados_pend:
        pode = is_admin() or d["criado_por"] == st.session_state.get("usuario_id")
        c = st.columns([0.8, 3, 1.5, 2, 1, 1, 0.6, 0.7, 0.6])
        c[0].write(d["data"])
        c[1].write(d["descricao"][:80] + ("..." if len(d["descricao"]) > 80 else ""))
        c[2].write(d["nota"])
        c[3].write(d["material"][:30] + "..." if len(d["material"]) > 30 else d["material"])
        c[4].write(f"{d['qtd']:,.0f}" if d["qtd"] else "—")
        c[5].write("✅ Resolvida" if d["status"] == "resolvida" else "⏳ Aberta")

        # Botão resolver/reabrir
        if d["status"] == "aberta":
            if c[6].button("✔", key=f"res_p_{d['id']}", help="Marcar resolvida"):
                rs = get_session()
                try:
                    upd = rs.get(Pendencia, d["id"])
                    upd.status_resolucao = "resolvida"
                    upd.data_resolucao   = date.today()
                    rs.commit()
                except Exception as e:
                    rs.rollback(); st.error(f"Erro: {e}")
                finally:
                    rs.close()
                st.rerun()
        else:
            if c[6].button("↩", key=f"reab_p_{d['id']}", help="Reabrir"):
                rs = get_session()
                try:
                    upd = rs.get(Pendencia, d["id"])
                    upd.status_resolucao = "aberta"
                    upd.data_resolucao   = None
                    rs.commit()
                except Exception as e:
                    rs.rollback(); st.error(f"Erro: {e}")
                finally:
                    rs.close()
                st.rerun()

        if pode:
            if c[7].button("✏️", key=f"ed_p_{d['id']}"):
                st.session_state.editar_pend_id = d["id"]
                st.session_state.confirmar_excluir_pend = None
                st.rerun()
            if c[8].button("🗑️", key=f"ex_p_{d['id']}"):
                st.session_state.confirmar_excluir_pend = d["id"]
                st.session_state.editar_pend_id = None
                st.rerun()
        else:
            c[7].write("—"); c[8].write("—")

rodape()
