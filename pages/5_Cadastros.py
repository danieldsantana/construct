# pages/5_Cadastros.py — CONSTRUCT
import streamlit as st
from db.models import (get_session, Canteiro, Trecho, Fornecedor, UnidadeFornecedor,
                        Material, TorreGrupo, TorreTipo, Torre, AlturaTorre, Obra, Cliente)
from db.auth import requer_operador, is_admin
from sqlalchemy.exc import IntegrityError
from ui import rodape

requer_operador()
st.set_page_config(page_title="Cadastros · CONSTRUCT", page_icon="⚙️", layout="wide")
st.title("⚙️ Cadastros")
st.divider()

aba_mat, aba_cant, aba_forn, aba_torres = st.tabs([
    "📦 Materiais",
    "📍 Canteiros",
    "🏭 Fornecedores",
    "🏗️ Torres",
])

CATEGORIAS = ["v. estrutura", "fixador", "ferragem", "para-raios", "stub", "gabarito", "outro"]

# ─────────────────────────────────────────────────────────────────────────────
# ABA 1 — MATERIAIS
# ─────────────────────────────────────────────────────────────────────────────
with aba_mat:
    st.subheader("Cadastro de Materiais")
    st.caption("Volumes, parafusos, para-raios, stubs — todos cadastrados aqui.")

    if "edit_mat_id" not in st.session_state: st.session_state.edit_mat_id = None

    edit_mat = None
    if st.session_state.edit_mat_id:
        sm = get_session()
        edit_mat = sm.get(Material, st.session_state.edit_mat_id)
        sm.close()

    with st.form("form_material", clear_on_submit=not bool(st.session_state.edit_mat_id)):
        col1, col2, col3 = st.columns([3, 1, 2])
        with col1:
            nome_mat = st.text_input("Nome do Material *",
                value=edit_mat.nome_material if edit_mat else "",
                placeholder="Ex: EMB C61CRE (TRONCO COMUM SUP - C61CRE) (VOL.1/5)")
        with col2:
            unidade_mat = st.text_input("Unidade *",
                value=edit_mat.unidade if edit_mat else "un",
                placeholder="un, kg, cx...")
        with col3:
            cat_idx = CATEGORIAS.index(edit_mat.categoria) if edit_mat and edit_mat.categoria in CATEGORIAS else 0
            categoria_mat = st.selectbox("Categoria *", options=CATEGORIAS, index=cat_idx)

        col4, col5 = st.columns([2, 4])
        with col4:
            peso_mat = st.number_input("Peso Galvanizado (kg)",
                min_value=0.0, step=0.001, format="%.3f",
                value=float(edit_mat.peso_galvanizado or 0) if edit_mat else 0.0)

        col_s, col_c = st.columns([4, 1])
        with col_s:
            sub_mat = st.form_submit_button(
                "💾 Salvar Alterações" if edit_mat else "➕ Adicionar Material",
                use_container_width=True, type="primary")
        with col_c:
            can_mat = st.form_submit_button("✖ Cancelar", use_container_width=True)

    if can_mat:
        st.session_state.edit_mat_id = None
        st.rerun()

    if sub_mat:
        if not nome_mat.strip():
            st.error("Nome do material obrigatório.")
        else:
            sv = get_session()
            try:
                if edit_mat:
                    m = sv.get(Material, st.session_state.edit_mat_id)
                    m.nome_material = nome_mat.strip()
                    m.unidade = unidade_mat.strip()
                    m.categoria = categoria_mat
                    m.peso_galvanizado = peso_mat if peso_mat > 0 else None
                    sv.commit()
                    st.success(f"✅ Material atualizado!")
                    st.session_state.edit_mat_id = None
                else:
                    sv.add(Material(
                        nome_material    = nome_mat.strip(),
                        unidade          = unidade_mat.strip(),
                        categoria        = categoria_mat,
                        peso_galvanizado = peso_mat if peso_mat > 0 else None,
                    ))
                    sv.commit()
                    st.success(f"✅ Material **{nome_mat}** adicionado!")
            except Exception as e:
                sv.rollback(); st.error(f"Erro: {e}")
            finally:
                sv.close()
            st.rerun()

    st.divider()
    # Filtros
    col_f1, col_f2 = st.columns([3, 2])
    with col_f1:
        busca_mat = st.text_input("🔍 Buscar por nome ou ID", placeholder="Ex: tronco, 142...", key="busca_mat")
    with col_f2:
        cat_filt_mat = st.selectbox("Filtrar por categoria", ["Todas"] + CATEGORIAS, key="cat_filt_mat")

    sm2 = get_session()
    q = sm2.query(Material).order_by(Material.categoria, Material.nome_material)
    if cat_filt_mat != "Todas":
        q = q.filter(Material.categoria == cat_filt_mat)
    materiais_lista = q.all()
    sm2.close()

    # Aplicar busca por nome ou ID
    if busca_mat.strip():
        termo = busca_mat.strip().lower()
        materiais_lista = [
            m for m in materiais_lista
            if termo in m.nome_material.lower() or termo == str(m.id)
        ]

    st.caption(f"{len(materiais_lista)} material(is) encontrado(s)")

    if materiais_lista:
        h = st.columns([0.8, 4, 1, 1.5, 1.5, 0.6, 0.6])
        for col, lbl in zip(h, ["**ID**", "**Nome**", "**Unid.**", "**Categoria**", "**Peso (kg)**", "**✏️**", "**🗑️**"]):
            col.markdown(lbl)
        for m in materiais_lista:
            c = st.columns([0.8, 4, 1, 1.5, 1.5, 0.6, 0.6])
            c[0].write(f"`{m.id}`")
            c[1].write(m.nome_material)
            c[2].write(m.unidade)
            c[3].write(m.categoria)
            c[4].write(f"{float(m.peso_galvanizado):,.3f}" if m.peso_galvanizado else "—")
            if c[5].button("✏️", key=f"ed_m_{m.id}"):
                st.session_state.edit_mat_id = m.id; st.rerun()
            if c[6].button("🗑️", key=f"ex_m_{m.id}"):
                ds = get_session()
                try:
                    ds.query(Material).filter_by(id=m.id).delete()
                    ds.commit(); st.rerun()
                except Exception as e:
                    ds.rollback(); st.error(f"Não é possível excluir: {e}")
                finally:
                    ds.close()

# ─────────────────────────────────────────────────────────────────────────────
# ABA 2 — CANTEIROS
# ─────────────────────────────────────────────────────────────────────────────
with aba_cant:
    st.subheader("Canteiros de Obra")

    if "edit_cant_id" not in st.session_state: st.session_state.edit_cant_id = None

    from sqlalchemy.orm import joinedload

    sc = get_session()
    trechos_c = sc.query(Trecho).order_by(Trecho.sigla_trecho).all()
    sc.close()
    trecho_c_opcoes = {"— não vincular —": None}
    for t in trechos_c:
        trecho_c_opcoes[f"{t.sigla_trecho} — {t.nome_trecho}"] = t.id

    edit_cant = None
    if st.session_state.edit_cant_id:
        sc_e = get_session()
        edit_cant = sc_e.query(Canteiro).options(joinedload(Canteiro.trecho)).get(st.session_state.edit_cant_id)
        sc_e.close()

    # Montar índice padrão do trecho no selectbox
    trecho_c_keys = list(trecho_c_opcoes.keys())
    cant_trecho_idx = 0
    if edit_cant and edit_cant.trecho:
        chave = f"{edit_cant.trecho.sigla_trecho} — {edit_cant.trecho.nome_trecho}"
        if chave in trecho_c_keys:
            cant_trecho_idx = trecho_c_keys.index(chave)

    with st.form("form_canteiro", clear_on_submit=not bool(st.session_state.edit_cant_id)):
        col1, col2 = st.columns([3, 2])
        with col1:
            nome_cant = st.text_input("Nome do Canteiro *",
                value=edit_cant.nome_canteiro if edit_cant else "",
                placeholder="Ex: Barra, Buritirama, Correntina...")
        with col2:
            trecho_c_key = st.selectbox("Trecho associado (opcional)",
                options=trecho_c_keys, index=cant_trecho_idx)
        col_s, col_c = st.columns([4, 1])
        with col_s:
            sub_cant = st.form_submit_button(
                "💾 Salvar Alterações" if edit_cant else "➕ Adicionar Canteiro",
                use_container_width=True, type="primary")
        with col_c:
            can_cant = st.form_submit_button("✖ Cancelar", use_container_width=True)

    if can_cant:
        st.session_state.edit_cant_id = None; st.rerun()

    if sub_cant:
        if not nome_cant.strip():
            st.error("Nome do canteiro obrigatório.")
        else:
            sv = get_session()
            try:
                if edit_cant:
                    obj = sv.get(Canteiro, st.session_state.edit_cant_id)
                    obj.nome_canteiro = nome_cant.strip()
                    obj.id_trecho = trecho_c_opcoes.get(trecho_c_key)
                    sv.commit(); st.success("✅ Canteiro atualizado!")
                    st.session_state.edit_cant_id = None
                else:
                    sv.add(Canteiro(nome_canteiro=nome_cant.strip(),
                                    id_trecho=trecho_c_opcoes.get(trecho_c_key)))
                    sv.commit(); st.success(f"✅ Canteiro **{nome_cant}** adicionado!")
            except IntegrityError:
                sv.rollback(); st.error("Já existe um canteiro com esse nome.")
            except Exception as e:
                sv.rollback(); st.error(f"Erro: {e}")
            finally:
                sv.close()
            st.rerun()

    st.divider()
    busca_cant = st.text_input("🔍 Buscar canteiro", placeholder="Ex: Barra, Correntina...", key="busca_cant")
    sc2 = get_session()
    canteiros_lista = (sc2.query(Canteiro)
                         .options(joinedload(Canteiro.trecho))
                         .order_by(Canteiro.nome_canteiro).all())
    if busca_cant.strip():
        canteiros_lista = [c for c in canteiros_lista if busca_cant.strip().lower() in c.nome_canteiro.lower()]

    if canteiros_lista:
        h = st.columns([3, 2, 0.5, 0.5])
        for col, lbl in zip(h, ["**Canteiro**", "**Trecho**", "**✏️**", "**🗑️**"]):
            col.markdown(lbl)
        for c in canteiros_lista:
            col1, col2, col3, col4 = st.columns([3, 2, 0.5, 0.5])
            col1.write(c.nome_canteiro)
            col2.write(c.trecho.sigla_trecho if c.trecho else "—")
            if col3.button("✏️", key=f"ed_c_{c.id}"):
                st.session_state.edit_cant_id = c.id; st.rerun()
            if col4.button("🗑️", key=f"ex_c_{c.id}"):
                ds = get_session()
                try:
                    ds.query(Canteiro).filter_by(id=c.id).delete()
                    ds.commit(); st.rerun()
                except Exception as e:
                    ds.rollback(); st.error(f"Não é possível excluir: {e}")
                finally:
                    ds.close()
    sc2.close()

# ─────────────────────────────────────────────────────────────────────────────
# ABA 3 — FORNECEDORES
# ─────────────────────────────────────────────────────────────────────────────
with aba_forn:
    st.subheader("Fornecedores e Unidades")

    if "edit_forn_id" not in st.session_state: st.session_state.edit_forn_id = None
    if "edit_unid_id" not in st.session_state: st.session_state.edit_unid_id = None

    col_forn, col_unid = st.columns(2)

    with col_forn:
        st.markdown("**Fornecedores**")

        edit_forn = None
        if st.session_state.edit_forn_id:
            sf_e = get_session()
            edit_forn = sf_e.get(Fornecedor, st.session_state.edit_forn_id)
            sf_e.close()

        with st.form("form_forn", clear_on_submit=not bool(st.session_state.edit_forn_id)):
            nome_forn = st.text_input("Nome do Fornecedor *",
                value=edit_forn.nome_fornecedor if edit_forn else "",
                placeholder="Ex: Brametal")
            col_sf, col_cf = st.columns([4, 1])
            with col_sf:
                sub_forn = st.form_submit_button(
                    "💾 Salvar Alterações" if edit_forn else "➕ Adicionar",
                    use_container_width=True, type="primary")
            with col_cf:
                can_forn = st.form_submit_button("✖", use_container_width=True)

        if can_forn:
            st.session_state.edit_forn_id = None; st.rerun()

        if sub_forn:
            if not nome_forn.strip():
                st.error("Nome obrigatório.")
            else:
                sv = get_session()
                try:
                    if edit_forn:
                        obj = sv.get(Fornecedor, st.session_state.edit_forn_id)
                        obj.nome_fornecedor = nome_forn.strip()
                        sv.commit(); st.success("✅ Fornecedor atualizado!")
                        st.session_state.edit_forn_id = None
                    else:
                        sv.add(Fornecedor(nome_fornecedor=nome_forn.strip()))
                        sv.commit(); st.success(f"✅ {nome_forn} adicionado!")
                except Exception as e:
                    sv.rollback(); st.error(f"Erro: {e}")
                finally:
                    sv.close()
                st.rerun()

        busca_forn = st.text_input("🔍 Buscar fornecedor", key="busca_forn")
        sf = get_session()
        forns = sf.query(Fornecedor).order_by(Fornecedor.nome_fornecedor).all()
        sf.close()
        if busca_forn.strip():
            forns = [f for f in forns if busca_forn.strip().lower() in f.nome_fornecedor.lower()]
        for f in forns:
            c1, c2, c3 = st.columns([4, 0.5, 0.5])
            c1.write(f.nome_fornecedor)
            if c2.button("✏️", key=f"ed_f_{f.id}"):
                st.session_state.edit_forn_id = f.id; st.rerun()
            if c3.button("🗑️", key=f"ex_f_{f.id}"):
                ds = get_session()
                try:
                    ds.query(Fornecedor).filter_by(id=f.id).delete()
                    ds.commit(); st.rerun()
                except Exception as e:
                    ds.rollback(); st.error(f"Erro: {e}")
                finally:
                    ds.close()

    with col_unid:
        st.markdown("**Unidades / Filiais**")
        sf2 = get_session()
        forns2 = sf2.query(Fornecedor).order_by(Fornecedor.nome_fornecedor).all()
        sf2.close()
        forn_u_opcoes = {f.nome_fornecedor: f.id for f in forns2}

        edit_unid = None
        if st.session_state.edit_unid_id:
            su_e = get_session()
            edit_unid = su_e.get(UnidadeFornecedor, st.session_state.edit_unid_id)
            su_e.close()

        forn_u_keys = list(forn_u_opcoes.keys()) or ["— cadastre um fornecedor —"]
        unid_forn_idx = 0
        if edit_unid:
            sf3 = get_session()
            forn_do_unid = sf3.get(Fornecedor, edit_unid.id_fornecedor)
            sf3.close()
            if forn_do_unid and forn_do_unid.nome_fornecedor in forn_u_keys:
                unid_forn_idx = forn_u_keys.index(forn_do_unid.nome_fornecedor)

        with st.form("form_unid", clear_on_submit=not bool(st.session_state.edit_unid_id)):
            forn_u_key = st.selectbox("Fornecedor *", options=forn_u_keys, index=unid_forn_idx)
            nome_unid  = st.text_input("Nome da Unidade *",
                value=edit_unid.nome_unidade if edit_unid else "",
                placeholder="Ex: Filial SP")
            cnpj_unid  = st.text_input("CNPJ",
                value=edit_unid.cnpj_unidade if edit_unid and edit_unid.cnpj_unidade else "",
                placeholder="00.000.000/0000-00")
            col_su, col_cu = st.columns([4, 1])
            with col_su:
                sub_unid = st.form_submit_button(
                    "💾 Salvar Alterações" if edit_unid else "➕ Adicionar Unidade",
                    use_container_width=True, type="primary")
            with col_cu:
                can_unid = st.form_submit_button("✖", use_container_width=True)

        if can_unid:
            st.session_state.edit_unid_id = None; st.rerun()

        if sub_unid and nome_unid.strip() and forn_u_key in forn_u_opcoes:
            sv = get_session()
            try:
                if edit_unid:
                    obj = sv.get(UnidadeFornecedor, st.session_state.edit_unid_id)
                    obj.id_fornecedor = forn_u_opcoes[forn_u_key]
                    obj.nome_unidade  = nome_unid.strip()
                    obj.cnpj_unidade  = cnpj_unid.strip() or None
                    sv.commit(); st.success("✅ Unidade atualizada!")
                    st.session_state.edit_unid_id = None
                else:
                    sv.add(UnidadeFornecedor(
                        id_fornecedor = forn_u_opcoes[forn_u_key],
                        nome_unidade  = nome_unid.strip(),
                        cnpj_unidade  = cnpj_unid.strip() or None,
                    ))
                    sv.commit(); st.success("✅ Unidade adicionada!")
            except IntegrityError:
                sv.rollback(); st.error("CNPJ já cadastrado.")
            except Exception as e:
                sv.rollback(); st.error(f"Erro: {e}")
            finally:
                sv.close()
            st.rerun()

        su = get_session()
        unids = (su.query(UnidadeFornecedor, Fornecedor)
                   .join(Fornecedor, Fornecedor.id == UnidadeFornecedor.id_fornecedor)
                   .order_by(Fornecedor.nome_fornecedor, UnidadeFornecedor.nome_unidade).all())
        su.close()
        for u, f in unids:
            c1, c2, c3, c4 = st.columns([2, 2, 0.5, 0.5])
            c1.write(f.nome_fornecedor)
            c2.write(u.nome_unidade)
            if c3.button("✏️", key=f"ed_u_{u.id}"):
                st.session_state.edit_unid_id = u.id; st.rerun()
            if c4.button("🗑️", key=f"ex_u_{u.id}"):
                ds = get_session()
                try:
                    ds.query(UnidadeFornecedor).filter_by(id=u.id).delete()
                    ds.commit(); st.rerun()
                except Exception as e:
                    ds.rollback(); st.error(f"Erro: {e}")
                finally:
                    ds.close()

# ─────────────────────────────────────────────────────────────────────────────
# ABA 4 — TORRES (visualização + importação futura)
# ─────────────────────────────────────────────────────────────────────────────
with aba_torres:
    st.subheader("Torres por Trecho")
    st.caption("As torres são importadas da Lista de Construção (Excel) via script de importação. Esta tela exibe o que foi importado.")

    st_t = get_session()
    trechos_t = st_t.query(Trecho).order_by(Trecho.sigla_trecho).all()
    st_t.close()

    if not trechos_t:
        st.info("Nenhum trecho cadastrado. Execute o seed para popular os dados iniciais.")
    else:
        trecho_t_key = st.selectbox("Trecho",
            options=[f"{t.sigla_trecho} — {t.nome_trecho}" for t in trechos_t],
            key="sel_trecho_torres")
        sigla_t = trecho_t_key.split(" — ")[0]

        col_bt, col_bt2 = st.columns([3, 2])
        with col_bt:
            busca_torre = st.text_input("🔍 Buscar torre", placeholder="Ex: 63/2, C61CR...", key="busca_torre")

        from sqlalchemy.orm import joinedload
        st2 = get_session()
        trecho_obj = st2.query(Trecho).filter_by(sigla_trecho=sigla_t).first()
        torres_lista = []
        if trecho_obj:
            torres_lista = (st2.query(Torre)
                .options(joinedload(Torre.torre_tipo), joinedload(Torre.altura_torre))
                .filter_by(id_trecho=trecho_obj.id)
                .order_by(Torre.torre_nome).all())

        if busca_torre.strip():
            termo_t = busca_torre.strip().lower()
            torres_lista = [
                t for t in torres_lista
                if termo_t in (t.torre_nome or "").lower()
                or (t.torre_tipo and termo_t in t.torre_tipo.torre_tipo.lower())
            ]

        st.metric("Torres encontradas", len(torres_lista))

        if torres_lista:
            h = st.columns([2, 2, 2])
            for col, lbl in zip(h, ["**Nome**", "**Tipo**", "**Altura Hu (m)**"]):
                col.markdown(lbl)
            for t in torres_lista:
                c = st.columns([2, 2, 2])
                c[0].write(t.torre_nome)
                c[1].write(t.torre_tipo.torre_tipo if t.torre_tipo else "—")
                c[2].write(f"{float(t.altura_torre.altura_util_metros):.1f}" if t.altura_torre else "—")
        else:
            st.info("Nenhuma torre encontrada para este trecho/filtro.")
        st2.close()

rodape()
