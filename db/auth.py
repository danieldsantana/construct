# db/auth.py — Autenticação e controle de acesso CONSTRUCT
import bcrypt
import streamlit as st
from db.models import get_session, Usuario


# ── Senhas ────────────────────────────────────────────────────────────────────

def hash_senha(senha: str) -> str:
    return bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()

def verificar_senha(senha: str, hash_: str) -> bool:
    return bcrypt.checkpw(senha.encode(), hash_.encode())


# ── Login / Logout ────────────────────────────────────────────────────────────

def fazer_login(login: str, senha: str) -> bool:
    session = get_session()
    try:
        usuario = session.query(Usuario).filter_by(login=login.strip(), ativo=True).first()
        if usuario and verificar_senha(senha, usuario.senha_hash):
            st.session_state.usuario_id     = usuario.id
            st.session_state.usuario_nome   = usuario.nome
            st.session_state.usuario_perfil = usuario.perfil
            return True
        return False
    finally:
        session.close()

def fazer_logout():
    for key in ["usuario_id", "usuario_nome", "usuario_perfil"]:
        st.session_state.pop(key, None)

def usuario_logado() -> bool:
    return "usuario_id" in st.session_state

def perfil_atual() -> str:
    return st.session_state.get("usuario_perfil", "")


# ── Verificações de permissão ─────────────────────────────────────────────────

def is_admin() -> bool:
    return perfil_atual() == "admin"

def is_operador() -> bool:
    return perfil_atual() in ("admin", "operador")

def is_visualizador() -> bool:
    return perfil_atual() in ("admin", "operador", "visualizador")


# ── Guardas de acesso (chamar no topo de cada página) ────────────────────────

def requer_login():
    if not usuario_logado():
        st.warning("Você precisa estar logado para acessar esta página.")
        st.stop()

def requer_operador():
    requer_login()
    if not is_operador():
        st.error("⛔ Acesso restrito. Seu perfil não tem permissão para esta ação.")
        st.stop()

def requer_admin():
    requer_login()
    if not is_admin():
        st.error("⛔ Acesso restrito a administradores.")
        st.stop()
