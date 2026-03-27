# pages/2_Recebimento.py — CONSTRUCT
import streamlit as st
from datetime import date
from db.models import get_session, RecebimentoMateriais, NotaFiscal, MaterialRecebido, Material, Canteiro, Trecho
from db.auth import requer_operador, is_admin
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from ui import rodape

requer_operador()
st.set_page_config(page_title="Recebimento · CONSTRUCT", page_icon="📦", layout="wide")
st.title("📦 Recebimento")
st.divider()

# ── Cache de domínio ──────────────────────────────────────────────────────────
@st.cache_data(ttl=300)
def carregar_canteiros():
    s = get_session()
    dados = [(c.id, c.nome_canteiro) for c in s.query(Canteiro).order_by(Canteiro.nome_canteiro).all()]
    s.close()
    return dados

@st.cache_data(ttl=300)
def carregar_trechos():
    s = get_session()
    dados = [(t.id, t.sigla_trecho, t.nome_trecho) for t in s.query(Trecho).order_by(Trecho.sigla_trecho).all()]
    s.close()
    return dados

@st.cache_data(ttl=60)
def buscar_materiais(termo):
    s = get_session()
    if termo.isdigit():
        results = s.query(Material).filter(Material.id == int(termo)).all()
    else:
        results = (s.query(Material)
            .filter(Material.nome_material.ilike(f"%{termo}%"))
            .order_by(Material.nome_material).limit(30).all())
    dados = [(m.id, m.nome_material, m.unidade, m.categoria) for m in results]
    s.close()
    return dados

def gerar_codigo_sr(data_receb: date) -> str:
    """Gera SR-YYYYMMDD-NNN sequencial por dia."""
    prefixo = f"SR-{data_receb.strftime('%Y%m%d')}-"
    s = get_session()
    existentes = s.query(RecebimentoMateriais).filter(
        RecebimentoMateriais.romaneio.like(f"{prefixo}%")
    ).count()
    s.close()
    return f"{prefixo}{str(existentes + 1).zfill(3)}"

# ── Estado de sessão ──────────────────────────────────────────────────────────
if "itens_receb"             not in st.session_state: st.session_state.itens_receb              = []
if "editar_receb_id"         not in st.session_state: st.session_state.editar_receb_id          = None
if "confirmar_excluir_receb" not in st.session_state: st.session_state.confirmar_excluir_receb  = None
if "sem_romaneio"            not in st.session_state: st.session_state.sem_romaneio             = False

editando   = st.session_state.editar_receb_id is not None
receb_edit = None

session = get_session()

canteiros_list = carregar_canteiros()
trechos_list   = carregar_trechos()

cant_opcoes   = {nome: cid for cid, nome in canteiros_list}
trecho_opcoes = {"— sem trecho definido —": None}
for tid, sigla, nome in trechos_list:
    trecho_opcoes[f"{sigla} — {nome}"] = tid

if editando:
    receb_edit = session.get(RecebimentoMateriais, st.session_state.editar_receb_id)
    if not st.session_state.itens_receb:
        st.session_state.itens_receb = [{
            "material_id":   it.id_material,
            "nome_material": it.material.nome_material,
            "unidade":       it.material.unidade,
            "quantidade":    float(it.quantidade),
            "id_trecho":     it.id_trecho,
            "sigla_trecho":  it.trecho.sigla_trecho if it.trecho else "—",
            "id_nota":       it.id_nota,
        } for it in receb_edit.materiais_recebidos]
    # Detectar se é SR
    if receb_edit.romaneio and receb_edit.romaneio.startswith("SR-"):
        st.session_state.sem_romaneio = True

session.close()

# ── Formulário ────────────────────────────────────────────────────────────────
if editando:
    st.subheader(f"✏️ Editando Romaneio: {receb_edit.romaneio}")
else:
    st.subheader("Novo Lançamento")

# SEÇÃO 1 — Cabeçalho
st.markdown("**1. Identificação do Recebimento**")

col1, col2, col3 = st.columns(3)

with col3:
    data_rec = st.date_input(
        "Data de Recebimento *",
        value=receb_edit.data_recebimento if editando else date.today()
    )

with col1:
    c_rom, c_chk = st.columns([3, 2])
    with c_chk:
        st.markdown("<div style='margin-top:28px'></div>", unsafe_allow_html=True)
        sem_rom = st.checkbox(
            "Sem Romaneio",
            value=st.session_state.sem_romaneio,
            key="chk_sem_rom"
        )
        st.session_state.sem_romaneio = sem_rom

    with c_rom:
        if sem_rom:
            codigo_sr = gerar_codigo_sr(data_rec)
            if editando and receb_edit.romaneio.startswith("SR-"):
                codigo_sr = receb_edit.romaneio
            st.text_input("Romaneio", value=codigo_sr, disabled=True, label_visibility="visible")
            romaneio_num = codigo_sr
        else:
            romaneio_num = st.text_input(
                "Número do Romaneio *",
                value=receb_edit.romaneio if (editando and receb_edit.romaneio and not receb_edit.romaneio.startswith("SR-")) else "",
                placeholder="Ex: ROM-2025-001"
            )

with col2:
    cant_keys    = list(cant_opcoes.keys())
    cant_default = 0
    if editando and receb_edit.canteiro:
        try: cant_default = cant_keys.index(receb_edit.canteiro.nome_canteiro)
        except ValueError: cant_default = 0
    canteiro_nome = st.selectbox("Local de Recebimento *", options=cant_keys, index=cant_default)

st.divider()

# SEÇÃO 2 — Notas Fiscais
st.markdown("**2. Notas Fiscais**")

session2 = get_session()
notas_disp = session2.query(NotaFiscal).filter(
    or_(
        NotaFiscal.id_recebimento == None,
        NotaFiscal.id_recebimento == (st.session_state.editar_receb_id or -1)
    )
).order_by(NotaFiscal.numero_nota).all()

notas_opcoes   = {f"{n.numero_nota}  —  {n.data_emissao.strftime('%d/%m/%Y')}": n.id for n in notas_disp}
notas_edit_ids = [n.id for n in receb_edit.notas_fiscais] if editando else []
notas_default  = [k for k, v in notas_opcoes.items() if v in notas_edit_ids]
session2.close()

if not notas_opcoes:
    st.warning("Nenhuma nota fiscal pendente. Cadastre notas na tela anterior antes de lançar o recebimento.")
    notas_escolhidas = []
else:
    notas_escolhidas = st.multiselect(
        "Selecione as notas fiscais deste recebimento *",
        options=list(notas_opcoes.keys()),
        default=notas_default,
        help="Apenas notas sem romaneio aparecem aqui."
    )

st.divider()

# SEÇÃO 3 — Materiais
st.markdown("**3. Materiais Recebidos**")
st.caption("Informe o trecho de destino para cada item. Se não souber ainda, deixe 'sem trecho definido' e complete depois na tela de Estoque.")

col_busca, col_qtd, col_trecho, col_nota_item, col_btn = st.columns([3, 1.5, 2, 2, 1])

with col_busca:
    termo = st.text_input("Buscar material", placeholder="Digite nome ou código...",
                           key="busca_mat", label_visibility="collapsed")

resultados = []
if termo and len(termo) >= 1:
    mat_raw = buscar_materiais(termo)
    resultados = mat_raw
else:
    mat_raw = []

mat_opcoes = {"— selecione —": None}
for mid, mnome, munid, mcat in mat_raw:
    mat_opcoes[f"[{mcat.upper()[:3]}] {mnome} [{munid}]"] = (mid, mnome, munid)

with col_busca:
    mat_key = st.selectbox("Material", options=list(mat_opcoes.keys()),
                            label_visibility="collapsed", key="sel_mat")
with col_qtd:
    qtd_input = st.number_input("Qtd", min_value=0.0, step=1.0, format="%.2f",
                                 key="qtd_mat", label_visibility="collapsed")
with col_trecho:
    trecho_key = st.selectbox("Trecho", options=list(trecho_opcoes.keys()),
                               key="sel_trecho", label_visibility="collapsed")
with col_nota_item:
    notas_item_opcoes = {"— nota não informada —": None}
    for k in notas_escolhidas:
        notas_item_opcoes[k] = notas_opcoes[k]
    nota_item_key = st.selectbox("Nota do item", options=list(notas_item_opcoes.keys()),
                                  key="sel_nota_item", label_visibility="collapsed")
with col_btn:
    if st.button("➕", use_container_width=True, help="Adicionar item"):
        if mat_key == "— selecione —" or mat_opcoes[mat_key] is None:
            st.warning("Selecione um material.")
        elif qtd_input <= 0:
            st.warning("Informe uma quantidade maior que zero.")
        else:
            mid, mnome, munid = mat_opcoes[mat_key]
            st.session_state.itens_receb.append({
                "material_id":   mid,
                "nome_material": mnome,
                "unidade":       munid,
                "quantidade":    qtd_input,
                "id_trecho":     trecho_opcoes[trecho_key],
                "sigla_trecho":  trecho_key.split(" — ")[0] if trecho_opcoes[trecho_key] else "—",
                "id_nota":       notas_item_opcoes[nota_item_key],
            })
            st.rerun()

# Lista de itens adicionados
if st.session_state.itens_receb:
    st.markdown("**Itens adicionados:**")
    h = st.columns([4, 1, 1, 1.5, 0.5])
    for col, lbl in zip(h, ["**Material**", "**Unid.**", "**Qtd**", "**Trecho**", ""]):
        col.markdown(lbl)

    for i, item in enumerate(st.session_state.itens_receb):
        c = st.columns([4, 1, 1, 1.5, 0.5])
        c[0].write(item["nome_material"])
        c[1].write(item["unidade"])
        c[2].write(f"{item['quantidade']:,.0f}")
        c[3].write(item["sigla_trecho"])
        if c[4].button("🗑️", key=f"del_item_{i}"):
            st.session_state.itens_receb.pop(i)
            st.rerun()

    st.caption(f"Total: **{len(st.session_state.itens_receb)}** item(ns)")
else:
    st.info("Nenhum material adicionado ainda.")

st.divider()

# ── Ações ─────────────────────────────────────────────────────────────────────
col_salvar, col_cancelar, col_limpar = st.columns([4, 1, 1])
salvar = col_salvar.button("💾 Salvar Recebimento", use_container_width=True, type="primary")

if col_cancelar.button("✖ Cancelar", use_container_width=True):
    st.session_state.editar_receb_id = None
    st.session_state.itens_receb     = []
    st.session_state.sem_romaneio    = False
    st.rerun()

if col_limpar.button("🔄 Limpar itens", use_container_width=True):
    st.session_state.itens_receb = []
    st.rerun()

if salvar:
    erros = []
    if not sem_rom and not romaneio_num.strip():
        erros.append("Número do romaneio obrigatório (ou marque 'Sem Romaneio').")
    if not notas_escolhidas:
        erros.append("Selecione ao menos uma nota fiscal.")
    if not st.session_state.itens_receb:
        erros.append("Adicione ao menos um material.")
    for e in erros: st.error(e)

    if not erros:
        sv = get_session()
        try:
            if editando:
                rec = sv.get(RecebimentoMateriais, st.session_state.editar_receb_id)
                rec.romaneio         = romaneio_num.strip()
                rec.id_canteiro      = cant_opcoes[canteiro_nome]
                rec.data_recebimento = data_rec
                for nf in sv.query(NotaFiscal).filter_by(id_recebimento=rec.id).all():
                    nf.id_recebimento = None
                sv.query(MaterialRecebido).filter_by(id_recebimento=rec.id).delete()
                sv.flush()
            else:
                rec = RecebimentoMateriais(
                    romaneio         = romaneio_num.strip(),
                    id_canteiro      = cant_opcoes[canteiro_nome],
                    data_recebimento = data_rec,
                    criado_por       = st.session_state.get("usuario_id"),
                )
                sv.add(rec)
                sv.flush()

            for nk in notas_escolhidas:
                nf = sv.get(NotaFiscal, notas_opcoes[nk])
                nf.id_recebimento = rec.id

            for item in st.session_state.itens_receb:
                sv.add(MaterialRecebido(
                    id_recebimento = rec.id,
                    id_material    = item["material_id"],
                    quantidade     = item["quantidade"],
                    id_trecho      = item["id_trecho"],
                    id_nota        = item["id_nota"],
                ))

            sv.commit()
            st.success(f"✅ Recebimento **{romaneio_num}** salvo com sucesso!")
            st.session_state.itens_receb     = []
            st.session_state.editar_receb_id = None
            st.session_state.sem_romaneio    = False
        except IntegrityError:
            sv.rollback()
            st.error(f"⚠️ Já existe um romaneio com o número **{romaneio_num}**.")
        except Exception as e:
            sv.rollback()
            st.error(f"❌ Erro: {e}")
        finally:
            sv.close()
        st.rerun()

# ── Lista de Recebimentos ─────────────────────────────────────────────────────
st.divider()
st.subheader("Recebimentos Lançados")

# Filtro por nota fiscal
filtro_nota = st.text_input(
    "🔍 Pesquisar por nota fiscal",
    placeholder="Digite o número da nota...",
    key="filtro_nota_receb"
)

ls = get_session()

if filtro_nota.strip():
    # Buscar recebimentos que contêm a nota pesquisada
    nfs_match = ls.query(NotaFiscal).filter(
        NotaFiscal.numero_nota.ilike(f"%{filtro_nota.strip()}%")
    ).all()
    ids_receb = {nf.id_recebimento for nf in nfs_match if nf.id_recebimento}
    if ids_receb:
        recebimentos = ls.query(RecebimentoMateriais).filter(
            RecebimentoMateriais.id.in_(ids_receb)
        ).order_by(RecebimentoMateriais.criado_em.desc()).all()
    else:
        recebimentos = []
else:
    recebimentos = ls.query(RecebimentoMateriais).order_by(RecebimentoMateriais.criado_em.desc()).all()

dados_receb = []
for r in recebimentos:
    notas_nums = ", ".join(n.numero_nota for n in r.notas_fiscais)
    n_itens    = ls.query(MaterialRecebido).filter_by(id_recebimento=r.id).count()
    sem_trecho = ls.query(MaterialRecebido).filter_by(id_recebimento=r.id, id_trecho=None).count()
    cant_nome  = r.canteiro.nome_canteiro if r.canteiro else "—"
    dados_receb.append({
        "id": r.id, "romaneio": r.romaneio, "canteiro": cant_nome,
        "data": r.data_recebimento.strftime("%d/%m/%Y"),
        "notas": notas_nums or "—", "n_itens": n_itens,
        "sem_trecho": sem_trecho, "criado_por": r.criado_por,
    })
ls.close()

if not dados_receb:
    msg = f"Nenhum recebimento encontrado para a nota **{filtro_nota}**." if filtro_nota.strip() else "Nenhum recebimento lançado ainda."
    st.info(msg)
else:
    # Confirmação de exclusão
    if st.session_state.confirmar_excluir_receb:
        rid = st.session_state.confirmar_excluir_receb
        rd  = next((d for d in dados_receb if d["id"] == rid), None)
        if rd:
            st.error(f"Excluir romaneio **{rd['romaneio']}**? Todos os itens e vínculos de notas serão removidos.")
            c1, c2 = st.columns(2)
            with c1:
                if st.button("🗑️ Sim, excluir", use_container_width=True):
                    ds = get_session()
                    try:
                        for nf in ds.query(NotaFiscal).filter_by(id_recebimento=rid).all():
                            nf.id_recebimento = None
                        ds.query(MaterialRecebido).filter_by(id_recebimento=rid).delete()
                        ds.query(RecebimentoMateriais).filter_by(id=rid).delete()
                        ds.commit()
                        st.session_state.confirmar_excluir_receb = None
                    except Exception as e:
                        ds.rollback(); st.error(f"Erro: {e}")
                    finally:
                        ds.close()
                    st.rerun()
            with c2:
                if st.button("✖ Cancelar exclusão", use_container_width=True):
                    st.session_state.confirmar_excluir_receb = None
                    st.rerun()

    h = st.columns([1.5, 2, 1.5, 2, 1, 1, 0.6, 0.6])
    for col, lbl in zip(h, ["**Romaneio**", "**Canteiro**", "**Data**", "**Notas**",
                              "**Itens**", "**Sem Trecho**", "**✏️**", "**🗑️**"]):
        col.markdown(lbl)

    for d in dados_receb:
        pode = is_admin() or d["criado_por"] == st.session_state.get("usuario_id")
        c = st.columns([1.5, 2, 1.5, 2, 1, 1, 0.6, 0.6])
        c[0].write(d["romaneio"])
        c[1].write(d["canteiro"])
        c[2].write(d["data"])
        c[3].write(d["notas"])
        c[4].write(d["n_itens"])
        c[5].write(f"⚠️ {d['sem_trecho']}" if d["sem_trecho"] > 0 else "✅ 0")
        if pode:
            if c[6].button("✏️", key=f"ed_rec_{d['id']}"):
                st.session_state.editar_receb_id = d["id"]
                st.session_state.itens_receb     = []
                st.session_state.confirmar_excluir_receb = None
                st.rerun()
            if c[7].button("🗑️", key=f"ex_rec_{d['id']}"):
                st.session_state.confirmar_excluir_receb = d["id"]
                st.session_state.editar_receb_id = None
                st.rerun()
        else:
            c[6].write("—"); c[7].write("—")

rodape()
