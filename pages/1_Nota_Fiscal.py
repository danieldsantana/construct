# pages/1_Nota_Fiscal.py — CONSTRUCT
import streamlit as st
from datetime import date
from db.models import get_session, NotaFiscal, UnidadeFornecedor, Fornecedor
from db.auth import requer_operador, is_admin
from sqlalchemy.exc import IntegrityError
from ui import rodape

requer_operador()
st.set_page_config(page_title="Nota Fiscal · CONSTRUCT", page_icon="🧾", layout="wide")
st.title("🧾 Nota Fiscal")
st.divider()

# ── Estado de sessão ──────────────────────────────────────────────────────────
if "editar_nota_id"          not in st.session_state: st.session_state.editar_nota_id          = None
if "confirmar_excluir_nota"  not in st.session_state: st.session_state.confirmar_excluir_nota  = None

editando = st.session_state.editar_nota_id is not None

# Carrega nota em edição
nota_edit = None
if editando:
    s = get_session()
    nota_edit = s.get(NotaFiscal, st.session_state.editar_nota_id)
    s.close()

# ── Carrega fornecedores/unidades ─────────────────────────────────────────────
session = get_session()
unidades = (
    session.query(UnidadeFornecedor, Fornecedor)
    .join(Fornecedor, Fornecedor.id == UnidadeFornecedor.id_fornecedor)
    .order_by(Fornecedor.nome_fornecedor, UnidadeFornecedor.nome_unidade)
    .all()
)
session.close()

unidades_opcoes = {"— não informar —": None}
for u, f in unidades:
    label = f"{f.nome_fornecedor} — {u.nome_unidade}"
    unidades_opcoes[label] = u.id

# ── Formulário ────────────────────────────────────────────────────────────────
if editando:
    st.subheader(f"✏️ Editando Nota: {nota_edit.numero_nota}")
else:
    st.subheader("Novo Cadastro")

with st.form("form_nota", clear_on_submit=not editando):
    col1, col2, col3 = st.columns([2, 2, 3])

    with col1:
        numero_nota = st.text_input(
            "Número da Nota Fiscal *",
            value=nota_edit.numero_nota if editando else "",
            placeholder="Ex: 000123456"
        )
        data_emissao = st.date_input(
            "Data de Emissão *",
            value=nota_edit.data_emissao if editando else date.today()
        )

    with col2:
        valor = st.number_input(
            "Valor da Nota (R$)",
            min_value=0.0, step=0.01, format="%.2f",
            value=float(nota_edit.valor or 0) if editando else 0.0
        )
        peso = st.number_input(
            "Peso Bruto (kg)",
            min_value=0.0, step=0.1, format="%.3f",
            value=float(nota_edit.peso or 0) if editando else 0.0
        )

    with col3:
        # Unidade fornecedora
        unid_keys = list(unidades_opcoes.keys())
        unid_default = 0
        if editando and nota_edit.id_unidadef:
            for i, (k, v) in enumerate(unidades_opcoes.items()):
                if v == nota_edit.id_unidadef:
                    unid_default = i
                    break
        unidade_escolhida = st.selectbox("Fornecedor / Unidade", options=unid_keys, index=unid_default)

        drive_id = st.text_input(
            "ID do arquivo no Google Drive",
            value=nota_edit.identificador_drive_nota or "" if editando else "",
            placeholder="Cole o ID do arquivo (opcional)"
        )

    col_s, col_c = st.columns([4, 1])
    with col_s:
        submitted = st.form_submit_button(
            "💾 Salvar Alterações" if editando else "💾 Cadastrar Nota Fiscal",
            use_container_width=True, type="primary"
        )
    with col_c:
        cancelar = st.form_submit_button("✖ Cancelar", use_container_width=True)

if cancelar:
    st.session_state.editar_nota_id = None
    st.rerun()

if submitted:
    if not numero_nota.strip():
        st.error("O número da nota fiscal é obrigatório.")
    else:
        sv = get_session()
        try:
            id_unid = unidades_opcoes.get(unidade_escolhida)
            if editando:
                nota = sv.get(NotaFiscal, st.session_state.editar_nota_id)
                nota.numero_nota              = numero_nota.strip()
                nota.data_emissao             = data_emissao
                nota.valor                    = valor if valor > 0 else None
                nota.peso                     = peso if peso > 0 else None
                nota.id_unidadef              = id_unid
                nota.identificador_drive_nota = drive_id.strip() or None
                sv.commit()
                st.success(f"✅ Nota **{numero_nota}** atualizada!")
                st.session_state.editar_nota_id = None
            else:
                sv.add(NotaFiscal(
                    numero_nota              = numero_nota.strip(),
                    data_emissao             = data_emissao,
                    valor                    = valor if valor > 0 else None,
                    peso                     = peso if peso > 0 else None,
                    id_unidadef              = id_unid,
                    identificador_drive_nota = drive_id.strip() or None,
                    criado_por               = st.session_state.get("usuario_id"),
                ))
                sv.commit()
                st.success(f"✅ Nota **{numero_nota}** cadastrada!")
        except IntegrityError:
            sv.rollback()
            st.error(f"⚠️ Já existe uma nota com o número **{numero_nota}**.")
        except Exception as e:
            sv.rollback()
            st.error(f"❌ Erro: {e}")
        finally:
            sv.close()
        st.rerun()

# ── Lista de Notas ────────────────────────────────────────────────────────────
st.divider()
st.subheader("Notas Fiscais Cadastradas")

session = get_session()
try:
    notas = session.query(NotaFiscal).order_by(NotaFiscal.criado_em.desc()).all()

    if not notas:
        st.info("Nenhuma nota fiscal cadastrada ainda.")
    else:
        pendentes = [n for n in notas if n.id_recebimento is None]
        if pendentes:
            st.warning(f"⚠️ {len(pendentes)} nota(s) ainda sem romaneio: **{', '.join(n.numero_nota for n in pendentes)}**")

        # Confirmação de exclusão
        if st.session_state.confirmar_excluir_nota:
            nid = st.session_state.confirmar_excluir_nota
            nota_del = next((n for n in notas if n.id == nid), None)
            if nota_del:
                st.error(f"Tem certeza que deseja excluir a Nota **{nota_del.numero_nota}**? Esta ação não pode ser desfeita.")
                c1, c2 = st.columns(2)
                with c1:
                    if st.button("🗑️ Sim, excluir", use_container_width=True):
                        ds = get_session()
                        try:
                            ds.query(NotaFiscal).filter_by(id=nid).delete()
                            ds.commit()
                            st.session_state.confirmar_excluir_nota = None
                        except Exception as e:
                            ds.rollback()
                            st.error(f"Erro ao excluir: {e}")
                        finally:
                            ds.close()
                        st.rerun()
                with c2:
                    if st.button("✖ Cancelar", use_container_width=True):
                        st.session_state.confirmar_excluir_nota = None
                        st.rerun()

        # Cabeçalho da tabela
        h = st.columns([2, 1.5, 1.5, 1.5, 2.5, 1.5, 0.7, 0.7])
        for col, lbl in zip(h, ["**Número**", "**Emissão**", "**Valor (R$)**",
                                  "**Peso (kg)**", "**Fornecedor**", "**Romaneio**", "**✏️**", "**🗑️**"]):
            col.markdown(lbl)

        for n in notas:
            pode = is_admin() or n.criado_por == st.session_state.get("usuario_id")
            unid_nome = ""
            if n.unidade_fornecedor:
                unid_nome = f"{n.unidade_fornecedor.fornecedor.nome_fornecedor} / {n.unidade_fornecedor.nome_unidade}"

            c = st.columns([2, 1.5, 1.5, 1.5, 2.5, 1.5, 0.7, 0.7])
            c[0].write(n.numero_nota)
            c[1].write(n.data_emissao.strftime("%d/%m/%Y"))
            c[2].write(f"R$ {float(n.valor):,.2f}" if n.valor else "—")
            c[3].write(f"{float(n.peso):,.3f}" if n.peso else "—")
            c[4].write(unid_nome or "—")
            c[5].write(f"✅ ROM {n.recebimento.romaneio}" if n.id_recebimento and n.recebimento else "⏳ Pendente")

            if pode:
                if c[6].button("✏️", key=f"ed_nf_{n.id}", help="Editar"):
                    st.session_state.editar_nota_id = n.id
                    st.session_state.confirmar_excluir_nota = None
                    st.rerun()
                if c[7].button("🗑️", key=f"ex_nf_{n.id}", help="Excluir"):
                    st.session_state.confirmar_excluir_nota = n.id
                    st.session_state.editar_nota_id = None
                    st.rerun()
            else:
                c[6].write("—"); c[7].write("—")
finally:
    session.close()

rodape()
