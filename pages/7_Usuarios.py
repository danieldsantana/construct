# pages/6_Usuarios.py — CONSTRUCT
import streamlit as st
from db.auth import requer_admin, hash_senha
from db.models import get_session, Usuario
from sqlalchemy.exc import IntegrityError
from ui import rodape

requer_admin()
st.set_page_config(page_title="Usuários · CONSTRUCT", page_icon="👥", layout="wide")
st.title("👥 Gestão de Usuários")
st.divider()

PERFIS = {"admin": "Administrador", "operador": "Operador", "visualizador": "Visualizador"}

if "editar_usuario_id"          not in st.session_state: st.session_state.editar_usuario_id          = None
if "confirmar_excluir_usuario"  not in st.session_state: st.session_state.confirmar_excluir_usuario  = None

editando = st.session_state.editar_usuario_id is not None
u_edit = None
if editando:
    s = get_session()
    u_edit = s.get(Usuario, st.session_state.editar_usuario_id)
    s.close()

if editando:
    st.subheader(f"✏️ Editando: {u_edit.nome} {u_edit.sobrenome or ''}")
else:
    st.subheader("Novo Usuário")

with st.form("form_usuario", clear_on_submit=not editando):
    col1, col2 = st.columns(2)
    with col1:
        nome      = st.text_input("Nome *", value=u_edit.nome if editando else "", placeholder="Daniel")
        login     = st.text_input("Login *", value=u_edit.login if editando else "", placeholder="daniel.santana")
        email     = st.text_input("E-mail", value=u_edit.email or "" if editando else "")
    with col2:
        sobrenome = st.text_input("Sobrenome", value=u_edit.sobrenome or "" if editando else "")
        funcao    = st.text_input("Função", value=u_edit.funcao or "" if editando else "", placeholder="Analista Técnico")
        perfil_idx = list(PERFIS.keys()).index(u_edit.perfil) if editando else 1
        perfil    = st.selectbox("Perfil *", options=list(PERFIS.keys()),
                                  index=perfil_idx, format_func=lambda x: PERFIS[x])

    ativo = st.checkbox("Usuário ativo", value=u_edit.ativo if editando else True)

    st.markdown("**Senha**")
    col_s1, col_s2 = st.columns(2)
    with col_s1:
        senha = st.text_input("Nova senha" if editando else "Senha *", type="password",
                               help="Deixe em branco para manter a atual." if editando else "")
    with col_s2:
        senha_confirm = st.text_input("Confirmar senha", type="password")

    col_b1, col_b2 = st.columns([4, 1])
    with col_b1:
        submitted = st.form_submit_button(
            "💾 Salvar Alterações" if editando else "💾 Criar Usuário",
            use_container_width=True, type="primary")
    with col_b2:
        cancelar = st.form_submit_button("✖ Cancelar", use_container_width=True)

if cancelar:
    st.session_state.editar_usuario_id = None
    st.rerun()

if submitted:
    erros = []
    if not nome.strip():  erros.append("Nome obrigatório.")
    if not login.strip(): erros.append("Login obrigatório.")
    if not editando and not senha: erros.append("Senha obrigatória para novo usuário.")
    if senha and senha != senha_confirm: erros.append("As senhas não coincidem.")
    if senha and len(senha) < 6: erros.append("Senha deve ter ao menos 6 caracteres.")
    for e in erros: st.error(e)

    if not erros:
        sv = get_session()
        try:
            if editando:
                u = sv.get(Usuario, st.session_state.editar_usuario_id)
                u.nome      = nome.strip()
                u.sobrenome = sobrenome.strip() or None
                u.email     = email.strip() or None
                u.funcao    = funcao.strip() or None
                u.login     = login.strip()
                u.perfil    = perfil
                u.ativo     = ativo
                if senha: u.senha_hash = hash_senha(senha)
                sv.commit()
                st.success(f"✅ Usuário **{nome}** atualizado!")
                st.session_state.editar_usuario_id = None
            else:
                sv.add(Usuario(
                    nome       = nome.strip(),
                    sobrenome  = sobrenome.strip() or None,
                    email      = email.strip() or None,
                    funcao     = funcao.strip() or None,
                    login      = login.strip(),
                    senha_hash = hash_senha(senha),
                    perfil     = perfil,
                    ativo      = ativo,
                ))
                sv.commit()
                st.success(f"✅ Usuário **{nome}** criado!")
        except IntegrityError:
            sv.rollback()
            st.error(f"⚠️ Login **{login}** já existe.")
        except Exception as e:
            sv.rollback(); st.error(f"Erro: {e}")
        finally:
            sv.close()
        st.rerun()

# ── Lista ─────────────────────────────────────────────────────────────────────
st.divider()
st.subheader("Usuários Cadastrados")

session = get_session()
usuarios = session.query(Usuario).order_by(Usuario.nome).all()
dados = [{
    "id": u.id,
    "nome_completo": f"{u.nome} {u.sobrenome or ''}".strip(),
    "login": u.login, "email": u.email or "—",
    "funcao": u.funcao or "—",
    "perfil": PERFIS.get(u.perfil, u.perfil),
    "ativo": u.ativo,
    "proprio": u.id == st.session_state.get("usuario_id"),
} for u in usuarios]
session.close()

if st.session_state.confirmar_excluir_usuario:
    uid = st.session_state.confirmar_excluir_usuario
    u_del = next((d for d in dados if d["id"] == uid), None)
    if u_del:
        st.error(f"Excluir **{u_del['nome_completo']}**?")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("🗑️ Sim, excluir", use_container_width=True):
                ds = get_session()
                try:
                    ds.query(Usuario).filter_by(id=uid).delete()
                    ds.commit(); st.session_state.confirmar_excluir_usuario = None
                except Exception as e:
                    ds.rollback(); st.error(f"Erro: {e}")
                finally:
                    ds.close()
                st.rerun()
        with c2:
            if st.button("✖ Cancelar", use_container_width=True):
                st.session_state.confirmar_excluir_usuario = None
                st.rerun()

h = st.columns([2, 2, 2, 1.5, 1.5, 1, 0.6, 0.6])
for col, lbl in zip(h, ["**Nome**", "**Login**", "**E-mail**",
                          "**Função**", "**Perfil**", "**Status**", "**✏️**", "**🗑️**"]):
    col.markdown(lbl)

for d in dados:
    c = st.columns([2, 2, 2, 1.5, 1.5, 1, 0.6, 0.6])
    c[0].write(d["nome_completo"] + (" *(você)*" if d["proprio"] else ""))
    c[1].write(d["login"])
    c[2].write(d["email"])
    c[3].write(d["funcao"])
    c[4].write(d["perfil"])
    c[5].write("✅" if d["ativo"] else "🔴")
    if c[6].button("✏️", key=f"ed_u_{d['id']}"):
        st.session_state.editar_usuario_id = d["id"]
        st.session_state.confirmar_excluir_usuario = None
        st.rerun()
    if d["proprio"]:
        c[7].write("—")
    else:
        if c[7].button("🗑️", key=f"ex_u_{d['id']}"):
            st.session_state.confirmar_excluir_usuario = d["id"]
            st.session_state.editar_usuario_id = None
            st.rerun()

rodape()
